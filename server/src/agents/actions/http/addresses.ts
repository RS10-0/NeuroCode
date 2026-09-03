import { isIP } from "node:net";

/*
 * Deciding whether an address is somewhere an agent may go.
 *
 * This file is the reason the http_request tool can exist at
 * all. Everything else about that tool is plumbing; this is the
 * part that stops a student's agent — or a prompt injected into
 * one — from using this server as a proxy into the network the
 * server is sitting in.
 *
 * The attack is not exotic. A server that fetches a URL
 * somebody else chose can be asked for
 * http://169.254.169.254/latest/meta-data/, which on most cloud
 * hosts returns credentials, or for http://localhost:3001/,
 * which is BuildGentic's own API answering from inside its own
 * trust boundary, or for any of the private ranges, which is
 * whatever else is on the network. The agent then reads the
 * response out loud.
 *
 * Two rules, and the second is the one that gets forgotten.
 *
 * A name is not an address. Checking the hostname against a
 * list is worthless: `evil.example` can have an A record
 * pointing at 127.0.0.1, and there is no textual property of
 * the string "evil.example" that reveals it. Only the resolved
 * address can be judged.
 *
 * And the address that was checked must be the address that is
 * connected to. Resolving a name, approving the result, and
 * then handing the NAME to a fetch that resolves it again is
 * a DNS-rebinding hole: the second lookup can return something
 * the first did not. That is why this module exports a
 * `lookup` rather than a `check` — it is passed directly to
 * Node's HTTP client as its resolver, so the address it
 * approves is by construction the address the socket uses.
 * There is no window between the two.
 */

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

/* Only these two. `file:`, `ftp:`, `data:` and the rest are
   either not network requests at all or not ones this server
   has any business making. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    value = value * 256 + octet;
  }

  return value;
}

/*
 * Every IPv4 range that is not the public internet.
 *
 * Written as prefix lengths rather than as start/end pairs so
 * each line can be read against the RFC that defines it.
 */
const V4_BLOCKS: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "this network"],
  ["10.0.0.0", 8, "a private network"],
  ["100.64.0.0", 10, "carrier-grade NAT space"],
  ["127.0.0.0", 8, "this machine"],
  ["169.254.0.0", 16, "link-local space, which is where cloud metadata lives"],
  ["172.16.0.0", 12, "a private network"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation space"],
  ["192.168.0.0", 16, "a private network"],
  ["198.18.0.0", 15, "benchmarking space"],
  ["198.51.100.0", 24, "documentation space"],
  ["203.0.113.0", 24, "documentation space"],
  ["224.0.0.0", 4, "multicast space"],
  ["240.0.0.0", 4, "reserved space"],
];

function blockedV4(address: string): string | null {
  const value = ipv4ToInt(address);

  if (value === null) {
    return "an address that could not be read";
  }

  for (const [base, bits, label] of V4_BLOCKS) {
    const baseValue = ipv4ToInt(base);

    if (baseValue === null) {
      continue;
    }

    /* >>> 0 because a /8 mask overflows a signed 32-bit int,
       and the sign bit turns every comparison inside out. */
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

    if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) {
      return label;
    }
  }

  return null;
}

function blockedV6(address: string): string | null {
  const lower = address.toLowerCase().split("%")[0];

  /*
   * IPv4-mapped and IPv4-compatible forms — ::ffff:127.0.0.1
   * is loopback wearing a different notation, and a checker
   * that only understands colons waves it straight through.
   */
  const mapped = lower.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);

  if (mapped) {
    return blockedV4(mapped[1]);
  }

  const hextetMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);

  if (hextetMapped) {
    const high = Number.parseInt(hextetMapped[1], 16);
    const low = Number.parseInt(hextetMapped[2], 16);

    return blockedV4(
      [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".")
    );
  }

  if (lower === "::" || lower === "::1") {
    return "this machine";
  }

  /* fc00::/7 — unique local. */
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) {
    return "a private network";
  }

  /* fe80::/10 — link-local. */
  if (/^fe[89ab][0-9a-f]:/.test(lower)) {
    return "link-local space";
  }

  /* ff00::/8 — multicast. */
  if (/^ff[0-9a-f]{2}:/.test(lower)) {
    return "multicast space";
  }

  /* 64:ff9b::/96 — NAT64, which translates straight back into
     IPv4 space and would otherwise be a way around the v4
     table above. */
  if (lower.startsWith("64:ff9b:")) {
    return "NAT64 translation space";
  }

  return null;
}

/*
 * The single judgement, used both when validating a URL and
 * again inside the resolver at connect time.
 *
 * Returns a human sentence when the address is refused, null
 * when it is allowed.
 */
export function blockedReason(address: string): string | null {
  const family = isIP(address);

  if (family === 4) {
    return blockedV4(address);
  }

  if (family === 6) {
    return blockedV6(address);
  }

  return "an address that could not be read";
}

/* =========================================================
   STAYING INSIDE A CONNECTION

   A saved connection is a credential plus a leash: the token
   goes only to the host its owner tied it to. This is the
   leash, and it is a pure function on purpose — the rule is
   too important to be reachable only by persuading a language
   model to attempt the attack, which is what testing it
   through the runtime amounts to.

   The trick it exists to stop is that `new URL(path, base)`
   does NOT always produce something under `base`. An absolute
   URL replaces it outright, and a protocol-relative "//host"
   replaces the authority while keeping the scheme. Either one
   turns "a path under api.example.com" into "somewhere else
   entirely, with your key attached".
========================================================= */

export type ResolvedAgainstBase =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export function resolveAgainstBase(
  baseUrl: string,
  raw: string
): ResolvedAgainstBase {
  /* The trailing slash matters: without it, `new URL` treats
     the last path segment as a file and resolves siblings
     against its parent. */
  const base = new URL(`${baseUrl.replace(/\/+$/, "")}/`);

  let joined: URL;

  try {
    joined = new URL(raw, base);
  } catch {
    return {
      ok: false,
      reason: "That path could not be combined with the connection's address.",
    };
  }

  if (joined.origin !== base.origin) {
    return {
      ok: false,
      reason: `it resolves to ${joined.origin}, which is outside this connection`,
    };
  }

  /*
   * Path containment, checked on the DECODED path.
   *
   * `URL` normalises "../" away before this sees it, so the
   * ordinary traversal is already handled — but a base with a
   * path prefix still has to be honoured, or a connection
   * scoped to /v1 would reach /admin on the same host.
   */
  const prefix = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;

  if (!joined.pathname.startsWith(prefix)) {
    return {
      ok: false,
      reason: `it resolves to ${joined.pathname}, which is outside this connection`,
    };
  }

  return { ok: true, url: joined };
}

export interface CheckedUrl {
  url: URL;
  hostname: string;
}

/*
 * Everything that can be judged from the URL text alone.
 *
 * Deliberately does NOT resolve anything. A URL is checked
 * here for shape, and checked for destination later, in the
 * resolver — splitting it that way is what removes the gap
 * between the two.
 */
export function checkUrl(raw: string): CheckedUrl {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError(
      "That is not a valid URL. It needs to start with http:// or https://."
    );
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedAddressError(
      `${url.protocol.replace(":", "")} addresses cannot be requested. Use http or https.`
    );
  }

  if (url.username || url.password) {
    /* Credentials in a URL are a way to smuggle a secret into
       a place it will be logged, and are not how any API this
       is meant to reach expects to be authenticated. */
    throw new BlockedAddressError(
      "Remove the username and password from the URL. Use a saved connection for credentials."
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (!hostname) {
    throw new BlockedAddressError("That URL has no host in it.");
  }

  /*
   * A literal IP in the URL is judged immediately. Not because
   * the resolver would miss it — it would not — but because
   * refusing it here produces a much clearer message than a
   * connection failure, and this is the form somebody
   * experimenting will type first.
   */
  if (isIP(hostname)) {
    const reason = blockedReason(hostname);

    if (reason) {
      throw new BlockedAddressError(
        `${hostname} is ${reason}, so it cannot be requested.`
      );
    }
  }

  /*
   * `localhost` never reaches the resolver check on some
   * systems, because it can be answered from a hosts file with
   * whatever somebody put there. Named explicitly.
   */
  if (/^localhost$/i.test(hostname) || /\.localhost$/i.test(hostname)) {
    throw new BlockedAddressError(
      "localhost is this machine, so it cannot be requested."
    );
  }

  return { url, hostname };
}
