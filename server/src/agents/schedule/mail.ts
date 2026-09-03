import { mail, mailEnabled } from "../../ai/config";

/*
 * Sending one email.
 *
 * Plain `fetch` against Resend's HTTP API, no SDK — the way
 * every provider adapter in ai/providers/ is written, and for
 * the same reasons: one fewer dependency in a server that spawns
 * child processes, and a request shape that can be read here
 * rather than in somebody else's source.
 *
 * TWO THINGS IN THIS FILE ARE SECURITY DECISIONS RATHER THAN
 * PREFERENCES, and both are about the same risk: the body of one
 * of these emails is model output, and that model output may
 * quote arbitrary bytes that an API returned to a tool.
 *
 * THE BODY IS text/plain, WITH NO HTML PART. Rendering fetched
 * content as HTML in somebody's inbox hands it a rendering
 * context — markup, a tracking pixel, a link whose text does not
 * match its target. Plain text has none of those. It is also,
 * incidentally, the format a digest is easiest to read in.
 *
 * THE RECIPIENT IS NOT A PARAMETER THIS MODULE DECIDES. It is
 * passed in by the notifier, which reads it from auth.users. No
 * caller can supply one, because no caller has one to supply.
 */

/*
 * A file travelling with the message.
 *
 * ADDED IN PHASE 3, AND IT DOES NOT LOOSEN THE RULE ABOVE.
 *
 * That rule is about a RENDERING CONTEXT. An HTML body hands
 * fetched bytes markup, a tracking pixel and a link whose text
 * does not match its target, inside a client that renders it
 * automatically the moment the message is opened. An attachment
 * gets none of that: it is inert until a person chooses to open
 * it, and then it opens in the program for its type rather than
 * in the mail client.
 *
 * And the bytes are not fetched. They were produced by this
 * server's own renderers from a block list it validated first —
 * see agents/documents/. Each of those writers documents what
 * it cannot emit, and the verification suite asserts the
 * absence: no /JavaScript, /OpenAction or /EmbeddedFile in a
 * PDF; no vbaProject.bin, no formula element and no external
 * relationship in an xlsx or a docx. That list is the argument
 * for this field existing.
 *
 * The body is still text/plain with no `html` key, unchanged.
 */
export interface MailAttachment {
  /* Already sanitised by documents/render.ts::filenameFor,
     which strips CR, LF and quotes — the characters that turn a
     filename into header injection. */
  filename: string;
  contentBase64: string;
}

export interface MailInput {
  to: string;
  subject: string;
  /* Plain text. Never HTML — see above. */
  text: string;
  attachments?: MailAttachment[];
}

export type MailResult = { ok: true } | { ok: false; error: string };

const ENDPOINT = "https://api.resend.com/emails";

/* Long enough for a slow provider, short enough that a hung
   send cannot hold up a tick. */
const TIMEOUT_MS = 10_000;

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!mailEnabled()) {
    /*
     * Not an error. Email is off, which is a supported
     * configuration and the default one — the notification is
     * already in the feed, which is the copy that always exists.
     */
    return { ok: false, error: "email is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mail.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: mail.from,
        to: [input.to],
        subject: input.subject,
        /* `text` only. There is deliberately no `html` key. */
        text: input.text,
        ...(input.attachments && input.attachments.length > 0
          ? {
              attachments: input.attachments.map((file) => ({
                filename: file.filename,
                content: file.contentBase64,
              })),
            }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      /*
       * The provider's own words, bounded and logged rather than
       * shown: a 422 usually means the from-address is not
       * verified, which is an operator problem, and the operator
       * is the one reading the log.
       */
      const detail = (await response.text().catch(() => "")).slice(0, 200);

      return {
        ok: false,
        error: `provider returned ${response.status}${detail ? `: ${detail}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: `no response within ${TIMEOUT_MS}ms` };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "the send failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
