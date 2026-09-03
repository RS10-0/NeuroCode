import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import type { LookupFunction } from "node:net";

import { actions } from "../../../ai/config";
import { BlockedAddressError, blockedReason, checkUrl } from "./addresses";

/*
 * Making an outbound call on a learner's behalf.
 *
 * Written against node:http rather than fetch, and that is the
 * whole design rather than a preference. fetch gives no way to
 * control name resolution, which means no way to guarantee that
 * the address a guard approved is the address the socket opens.
 * node:http takes a `lookup` option, so the check and the
 * connection become the same act — see addresses.ts on why the
 * gap between them is the vulnerability.
 *
 * Everything else here is a limit:
 *
 *   Redirects are followed by hand, never by the client, so
 *   every hop goes back through the same guard. A permitted
 *   host that answers 302 Location: http://169.254.169.254/ is
 *   the standard way past a checker that only looks at the URL
 *   it was given.
 *
 *   The response is read with a byte counter and the socket is
 *   destroyed the moment it is exceeded — not trusted to
 *   Content-Length, which the far end is free to understate or
 *   omit entirely.
 *
 *   Request and response headers are both filtered. An agent
 *   does not get to set Host, and a redirect does not get to
 *   carry an Authorization header to a different origin.
 */

export interface HttpCallInput {
  url: string;
  method: string;
  /* Headers the caller adds — a saved connection's auth. Never
     anything the model wrote. */
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpCallResult {
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  truncated: boolean;
  /* Every URL actually contacted, in order. Shown to the owner
     so a redirect chain is visible rather than implied. */
  chain: string[];
}

/*
 * The resolver, and the security boundary.
 *
 * Node calls this instead of its own DNS when opening the
 * socket, so whatever it hands back is precisely what gets
 * connected to. Every candidate address is judged; the first
 * allowed one wins; if none is allowed the connection fails
 * with a sentence a learner can act on.
 *
 * `all: true` matters. A host with both a public AAAA and a
 * private A record would otherwise be approved or refused
 * depending on which one Node happened to prefer that day.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      /* The empty address is required by the signature and
         ignored by Node, which checks the error first. */
      callback(error, "", 0);
      return;
    }

    let refusal: string | null = null;

    for (const entry of addresses) {
      const reason = blockedReason(entry.address);

      if (!reason) {
        if (typeof options === "object" && options?.all === true) {
          callback(null, [{ address: entry.address, family: entry.family }]);
        } else {
          callback(null, entry.address, entry.family);
        }

        return;
      }

      refusal = refusal ?? reason;
    }

    const blocked = new BlockedAddressError(
      `${hostname} resolves to ${refusal ?? "an address that cannot be reached"}, so it cannot be requested.`
    ) as NodeJS.ErrnoException;

    blocked.code = "ENEUROLINKBLOCKED";

    callback(blocked, "", 0);
  });
};

/* Headers a caller may never set: they either belong to the
   transport or would let a request lie about where it is
   going. */
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "proxy-authorization",
]);

function safeHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (RESERVED_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    out[key] = value;
  }

  return out;
}

function once(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal | undefined
): Promise<{
  response: IncomingMessage;
  text: string;
  bytes: number;
  truncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";

    /*
     * The two are annotated as one type rather than left to
     * inference. TypeScript resolves a call on a union of two
     * overloaded functions by trying the last overload only,
     * which here is the (URL, options) form — so an options
     * object gets checked against `URL` and every field on it
     * is reported as unknown.
     */
    const send: typeof httpRequest = secure ? httpsRequest : httpRequest;

    const options: RequestOptions = {
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || (secure ? "443" : "80"),
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        /* Named honestly. An agent calling somebody's API on
           a student's behalf should be identifiable as one,
           not disguised as a browser. */
        "user-agent": "BuildGentic-Agent/1.0 (+https://buildgentic.com)",
        accept: "*/*",
        ...headers,
        ...(body === undefined
          ? {}
          : { "content-length": String(Buffer.byteLength(body)) }),
      },
      /* The security boundary. See guardedLookup. */
      lookup: guardedLookup,
      timeout: actions.http.timeoutMs,
    };

    const req = send(options, (response) => {
      const cap = Math.max(1_000, actions.http.maxResponseBytes);
      const chunks: Buffer[] = [];

      let bytes = 0;
      let truncated = false;

      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;

        if (bytes > cap) {
          truncated = true;
          chunks.push(
            chunk.subarray(0, Math.max(0, cap - (bytes - chunk.length)))
          );
          response.destroy();
          return;
        }

        chunks.push(chunk);
      });

      response.on("end", () =>
        resolve({
          response,
          text: Buffer.concat(chunks).toString("utf8"),
          bytes,
          truncated,
        })
      );

      response.on("close", () => {
        if (truncated) {
          resolve({
            response,
            text: Buffer.concat(chunks).toString("utf8"),
            bytes,
            truncated,
          });
        }
      });

      response.on("error", reject);
    });

    req.on("error", reject);

    req.on("timeout", () => {
      req.destroy(
        new Error(
          `The server did not respond within ${actions.http.timeoutMs}ms.`
        )
      );
    });

    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error("The request was cancelled."));
      } else {
        signal.addEventListener(
          "abort",
          () => req.destroy(new Error("The request was cancelled.")),
          {
            once: true,
          }
        );
      }
    }

    if (body !== undefined) {
      req.write(body);
    }

    req.end();
  });
}

export async function httpCall(input: HttpCallInput): Promise<HttpCallResult> {
  const chain: string[] = [];

  let target = checkUrl(input.url);
  let method = input.method.toUpperCase();
  let body = input.body;
  let headers = safeHeaders(input.headers);

  for (let hop = 0; ; hop += 1) {
    chain.push(target.url.toString());

    const { response, text, bytes, truncated } = await once(
      target.url,
      method,
      headers,
      body,
      input.signal
    );

    const status = response.statusCode ?? 0;
    const location = response.headers.location;

    const isRedirect =
      status >= 300 &&
      status < 400 &&
      typeof location === "string" &&
      location.length > 0;

    if (!isRedirect) {
      return {
        status,
        contentType: String(response.headers["content-type"] ?? "")
          .split(";")[0]
          .trim(),
        body: text,
        bytes,
        truncated,
        chain,
      };
    }

    if (hop >= Math.max(0, actions.http.maxRedirects)) {
      throw new BlockedAddressError(
        `That address redirected more than ${actions.http.maxRedirects} times without arriving anywhere.`
      );
    }

    const next = checkUrl(new URL(location, target.url).toString());

    /*
     * Credentials do not follow a redirect to a different
     * origin.
     *
     * A saved connection's token is scoped to the service it
     * belongs to. An endpoint that 302s somewhere else — by
     * design, by compromise, or by an open redirect somebody
     * found — must not be able to forward that token to the
     * new destination. Same origin keeps it; anything else
     * drops it.
     */
    if (next.url.origin !== target.url.origin) {
      headers = Object.fromEntries(
        Object.entries(headers).filter(
          ([key]) =>
            key.toLowerCase() !== "authorization" &&
            key.toLowerCase() !== "cookie" &&
            !key.toLowerCase().startsWith("x-api")
        )
      );
    }

    /* 303 always becomes GET; 301 and 302 do in practice,
       because that is what every client does and what every
       server therefore expects. */
    if (
      status === 303 ||
      ((status === 301 || status === 302) && method === "POST")
    ) {
      method = "GET";
      body = undefined;
    }

    target = next;
  }
}
