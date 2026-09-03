import { email as config } from "../../../ai/config";
import {
  EmailProviderError,
  type EmailAddress,
  type EmailDraftContent,
  type EmailGrant,
  type EmailMessage,
  type EmailProvider,
  type EmailSummary,
  type EmailTokenSet,
} from "../types";

/*
 * Gmail.
 *
 * Plain `fetch` against Google's HTTP API, no SDK — the way
 * every provider adapter in ai/providers/ is written and for the
 * same reasons: one fewer dependency in a server that spawns
 * child processes, and a request shape that can be read here
 * rather than in somebody else's source.
 *
 * THE SCOPES, AND THE ONE THING THEY CANNOT DO.
 *
 * Google's Gmail scopes map almost exactly onto BuildGentic's
 * four grants, with one gap that has to be stated rather than
 * glossed:
 *
 *   read     -> gmail.readonly
 *   draft    -> gmail.compose
 *   send     -> gmail.send
 *   organize -> gmail.modify
 *
 * THERE IS NO GOOGLE SCOPE THAT PERMITS DRAFTING BUT FORBIDS
 * SENDING. `gmail.compose` grants both. So the send gate is not
 * and cannot be a scope guarantee — it is BuildGentic's, and it
 * is structural rather than contractual: there is no send tool
 * in the catalogue, so no model turn can reach `send()` below.
 * The only caller is the route a person presses a button on.
 *
 * Saying that here matters because the natural assumption when
 * reading a scope list is that Google is enforcing the split.
 * It is not. We are.
 *
 * AND `https://mail.google.com/` IS NEVER REQUESTED. That is the
 * full-access scope, it carries IMAP, SMTP and permanent
 * deletion, and nothing in this capability needs any of the
 * three. `gmail.modify` is the ceiling — which can still trash a
 * message, so the no-delete rule is enforced by not shipping a
 * tool for it rather than by the scope being unable to.
 *
 * ONE OPERATIONAL FACT AN OPERATOR NEEDS BEFORE SHIPPING.
 *
 * All four of these are RESTRICTED scopes. A Google Cloud
 * project using them with users outside the project requires
 * OAuth verification and an annual third-party security
 * assessment. In Testing mode the project works today for the
 * developer and for test users added by hand in the console,
 * which is what the MVP runs on. This is not something the code
 * can arrange.
 */

const OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const SCOPE_FOR: Record<EmailGrant, string> = {
  read: "https://www.googleapis.com/auth/gmail.readonly",
  draft: "https://www.googleapis.com/auth/gmail.compose",
  send: "https://www.googleapis.com/auth/gmail.send",
  organize: "https://www.googleapis.com/auth/gmail.modify",
};

/*
 * Gmail's own labels, which are constants rather than names.
 *
 * Listed because the agent is told about them by name and
 * because `archive` means "remove INBOX" — a fact about Gmail
 * that nothing above the adapter should have to know.
 */
const SYSTEM_LABELS = new Set([
  "INBOX",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

/* =========================================================
   TRANSPORT
========================================================= */

interface GoogleErrorBody {
  error?: { message?: string; status?: string } | string;
  error_description?: string;
}

/*
 * One request, with the timeout and the error mapping every
 * call in this file needs.
 *
 * Google's own message is read but never forwarded: it can name
 * the project, the quota and an internal endpoint, none of
 * which is a learner's business and all of which is an
 * operator's. So it goes to the log and a written sentence goes
 * to the caller — the same posture GeminiProvider takes.
 */
async function call<T>(
  url: string,
  init: RequestInit & { accessToken?: string }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  if (init.accessToken) {
    headers.authorization = `Bearer ${init.accessToken}`;
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (response.ok) {
      /* 204 on a revoke, and a JSON parse of an empty body
         throws. Every caller that expects nothing passes void. */
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const raw = await response.text().catch(() => "");
    let detail = raw.slice(0, 300);

    try {
      const parsed = JSON.parse(raw) as GoogleErrorBody;
      const message =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error?.message;

      detail = (message ?? parsed.error_description ?? detail).slice(0, 300);
    } catch {
      /* Not JSON. The truncated body is the best detail there
         is, and it is going to a log rather than to a person. */
    }

    throw mapStatus(response.status, detail);
  } catch (error) {
    if (error instanceof EmailProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new EmailProviderError(
        "unavailable",
        `Gmail did not answer within ${config.timeoutMs}ms.`
      );
    }

    throw new EmailProviderError(
      "unavailable",
      "Gmail could not be reached.",
      error instanceof Error ? error.message : undefined
    );
  } finally {
    clearTimeout(timer);
  }
}

function mapStatus(status: number, detail: string): EmailProviderError {
  if (status === 401) {
    return new EmailProviderError(
      "unauthorized",
      "This mailbox's authorisation has expired.",
      detail
    );
  }

  if (status === 403) {
    /*
     * 403 is two different problems wearing one number, and
     * they need opposite advice. A missing scope is fixed by
     * reconnecting; a rate limit is fixed by waiting. Google
     * distinguishes them in the message body and nowhere else.
     */
    const rateLimited = /rate|quota|limit/i.test(detail);

    return rateLimited
      ? new EmailProviderError(
          "rate_limited",
          "Gmail is rate-limiting this account. Try again shortly.",
          detail
        )
      : new EmailProviderError(
          "forbidden",
          "This mailbox was not connected with permission for that. Reconnect it and allow the permission you need.",
          detail
        );
  }

  if (status === 404) {
    return new EmailProviderError(
      "not_found",
      "That message no longer exists, or that id is not one of yours.",
      detail
    );
  }

  if (status === 429) {
    return new EmailProviderError(
      "rate_limited",
      "Gmail is rate-limiting this account. Try again shortly.",
      detail
    );
  }

  if (status >= 500) {
    return new EmailProviderError(
      "unavailable",
      "Gmail is having trouble. Try again shortly.",
      detail
    );
  }

  return new EmailProviderError(
    "invalid",
    "Gmail refused that request.",
    detail
  );
}

/* =========================================================
   PARSING

   Everything below turns Google's wire shapes into this
   project's, and none of it trusts what it is given: a header
   may be absent, repeated, or hostile, and a body may be
   multipart nested four deep with no text part at all.
========================================================= */

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function headerOf(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) {
    return "";
  }

  const lower = name.toLowerCase();
  const found = headers.find((entry) => entry.name?.toLowerCase() === lower);

  return found?.value ?? "";
}

/*
 * "Ada Lovelace <ada@example.com>, bob@example.com" into parts.
 *
 * Deliberately not a full RFC 5322 parser. A display name may
 * legally contain a quoted comma and this will split it in the
 * wrong place — which produces a slightly wrong NAME on a list
 * nobody acts on programmatically, and never a wrong ADDRESS,
 * because the address is taken from inside the angle brackets.
 * A real parser is a dependency and a class of bug for a
 * cosmetic gain.
 */
function parseAddresses(raw: string): EmailAddress[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 25)
    .map((part) => {
      const match = /^(.*?)\s*<([^>]+)>$/.exec(part);

      if (match) {
        return {
          name: match[1].replace(/^"|"$/g, "").trim() || null,
          address: match[2].trim(),
        };
      }

      return { name: null, address: part };
    });
}

function firstAddress(raw: string): EmailAddress {
  const parsed = parseAddresses(raw);
  return parsed[0] ?? { name: null, address: "" };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    .toString("utf8");
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/*
 * HTML down to something readable.
 *
 * Not a renderer and not a sanitiser — the output goes into a
 * prompt, never into a page, so there is nothing to sanitise
 * FOR. What it has to do is stop a marketing email's worth of
 * markup eating the whole body budget and leaving no words in
 * it. Script and style are dropped whole, because their
 * contents are not text a person would have seen.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * Depth-first for a text part, plain preferred over HTML.
 *
 * Bounded depth because a message is somebody else's input and
 * a pathologically nested multipart is a cheap way to make a
 * recursive walk expensive. Ten is far past anything a real
 * mail client produces.
 */
function extractBody(part: GmailPart | undefined, depth = 0): string {
  if (!part || depth > 10) {
    return "";
  }

  const mime = (part.mimeType ?? "").toLowerCase();

  if (mime === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const child of part.parts) {
      const found = extractBody(child, depth + 1);

      if (found) {
        return found;
      }
    }
  }

  if (mime === "text/html" && part.body?.data) {
    return htmlToText(decodeBase64Url(part.body.data));
  }

  return "";
}

function collectAttachments(
  part: GmailPart | undefined,
  into: EmailMessage["attachments"] = [],
  depth = 0
): EmailMessage["attachments"] {
  if (!part || depth > 10 || into.length >= 20) {
    return into;
  }

  if (part.filename && part.body?.attachmentId) {
    into.push({
      filename: part.filename.slice(0, 200),
      mimeType: part.mimeType ?? "application/octet-stream",
      bytes: Number(part.body.size ?? 0),
    });
  }

  for (const child of part.parts ?? []) {
    collectAttachments(child, into, depth + 1);
  }

  return into;
}

function toDate(message: GmailMessage): string {
  const headerDate = headerOf(message.payload?.headers, "date");
  const parsed = headerDate ? Date.parse(headerDate) : NaN;

  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  /* `internalDate` is epoch milliseconds as a string and is
     always present. The header is preferred only because it is
     what the sender meant. */
  const internal = Number(message.internalDate);

  return Number.isFinite(internal) && internal > 0
    ? new Date(internal).toISOString()
    : new Date(0).toISOString();
}

function toSummary(message: GmailMessage): EmailSummary {
  const headers = message.payload?.headers;
  const labels = message.labelIds ?? [];

  return {
    id: message.id,
    threadId: message.threadId,
    from: firstAddress(headerOf(headers, "from")),
    to: parseAddresses(headerOf(headers, "to")),
    subject: headerOf(headers, "subject").slice(0, 400) || "(no subject)",
    date: toDate(message),
    snippet: (message.snippet ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, config.snippetChars),
    unread: labels.includes("UNREAD"),
    labels,
    hasAttachments: collectAttachments(message.payload).length > 0,
  };
}

function toMessage(message: GmailMessage): EmailMessage {
  const headers = message.payload?.headers;
  const raw = extractBody(message.payload).replace(/\r\n/g, "\n").trim();
  const truncated = raw.length > config.bodyChars;

  return {
    ...toSummary(message),
    cc: parseAddresses(headerOf(headers, "cc")),
    body: truncated ? raw.slice(0, config.bodyChars) : raw,
    bodyTruncated: truncated,
    attachments: collectAttachments(message.payload),
  };
}

/* =========================================================
   OUTBOUND MIME

   Building the one message this adapter ever sends.

   THE CR/LF STRIPPING IS THE SECURITY-LOAD-BEARING PART, and it
   is worth being explicit about why, because it looks like
   tidying.

   A MIME message is headers, a blank line, then a body. A
   newline inside a header VALUE therefore ends that header and
   starts another one — so a subject containing "\nBcc:
   somebody@example.com" is not a strange subject, it is an
   extra recipient. The model writes the subject and the
   recipients. That is the whole attack, and stripping the two
   characters is the whole defence.
========================================================= */

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/*
 * RFC 2047 for anything that is not plain ASCII.
 *
 * A raw UTF-8 subject in a header is not legal and clients
 * render it as mojibake — which would make every non-English
 * reply this agent writes look broken in exactly the place a
 * person is judging whether to send it.
 */
function encodeHeaderValue(value: string): string {
  const clean = headerSafe(value);

  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }

  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function buildMime(
  from: string,
  draft: EmailDraftContent,
  references: { messageId?: string } = {}
): string {
  const lines = [
    `From: ${headerSafe(from)}`,
    `To: ${draft.to.map(headerSafe).join(", ")}`,
  ];

  if (draft.cc.length > 0) {
    lines.push(`Cc: ${draft.cc.map(headerSafe).join(", ")}`);
  }

  lines.push(`Subject: ${encodeHeaderValue(draft.subject)}`);

  /*
   * Threading headers, when this is a reply.
   *
   * `In-Reply-To` and `References` carry the RFC message-id of
   * what is being answered — which is NOT the Gmail api id, and
   * conflating the two is why replies sometimes start their own
   * thread. The caller fetches the real one and passes it here.
   */
  if (references.messageId) {
    const id = headerSafe(references.messageId);
    lines.push(`In-Reply-To: ${id}`, `References: ${id}`);
  }

  lines.push(
    "MIME-Version: 1.0",
    /*
     * text/plain, with no HTML alternative, and it is the same
     * decision schedule/mail.ts documents: an HTML part hands
     * whatever the model wrote a rendering context — markup, a
     * pixel, a link whose text does not match its target. A
     * reply written by an agent is exactly the message that
     * should not have one.
     */
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(draft.body, "utf8").toString("base64")
  );

  return lines.join("\r\n");
}

/* =========================================================
   LABELS
========================================================= */

interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

/*
 * Names to ids, for the organise call.
 *
 * A label this mailbox does not have is REFUSED rather than
 * created, and the refusal names what does exist. Creating one
 * silently is how an agent ends up with eleven near-identical
 * labels after a fortnight — and "the model invented a category
 * and then made it real" is the shape of failure this
 * capability can least afford.
 */
async function resolveLabels(
  accessToken: string,
  names: string[]
): Promise<{ ids: string[]; unknown: string[]; available: string[] }> {
  if (names.length === 0) {
    return { ids: [], unknown: [], available: [] };
  }

  const data = await call<{ labels?: GmailLabel[] }>(`${API}/labels`, {
    method: "GET",
    accessToken,
  });

  const labels = data.labels ?? [];
  const byName = new Map<string, string>();

  for (const label of labels) {
    byName.set(label.name.toLowerCase(), label.id);
  }

  const ids: string[] = [];
  const unknown: string[] = [];

  for (const name of names) {
    const upper = name.toUpperCase();

    /* A system label may be named by its constant, which is
       what the agent is told they are called. */
    if (SYSTEM_LABELS.has(upper)) {
      ids.push(upper);
      continue;
    }

    const id = byName.get(name.toLowerCase());

    if (id) {
      ids.push(id);
    } else {
      unknown.push(name);
    }
  }

  return {
    ids,
    unknown,
    available: labels
      .filter((label) => label.type !== "system")
      .map((label) => label.name)
      .slice(0, 40),
  };
}

/* =========================================================
   THE ADAPTER
========================================================= */

function credentials(): { clientId: string; clientSecret: string } {
  const { clientId, clientSecret } = config.gmail;

  if (!clientId || !clientSecret) {
    throw new EmailProviderError(
      "invalid",
      "This server is not set up to connect Gmail accounts."
    );
  }

  return { clientId, clientSecret };
}

async function tokenRequest(
  body: Record<string, string>
): Promise<EmailTokenSet> {
  const data = await call<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  if (!data.access_token) {
    throw new EmailProviderError(
      "unauthorized",
      "Google did not return an access token."
    );
  }

  return {
    accessToken: data.access_token,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    ...(data.expires_in ? { expiresIn: data.expires_in } : {}),
    ...(data.scope ? { scope: data.scope } : {}),
  };
}

export const gmailProvider: EmailProvider = {
  id: "gmail",
  displayName: "Gmail",

  supports() {
    return true;
  },

  authorizeUrl({ state, codeChallenge, grants }) {
    const { clientId } = credentials();

    const scopes = [
      "openid",
      "email",
      ...grants.map((grant) => SCOPE_FOR[grant]),
    ];

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: config.gmail.redirectUri,
      response_type: "code",
      scope: [...new Set(scopes)].join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      /*
       * `offline` is what makes a refresh token exist at all,
       * and `consent` is what makes it come back on a REPEAT
       * authorisation.
       *
       * Without the second, Google returns a refresh token only
       * the very first time a person authorises this client —
       * so somebody who disconnects and reconnects gets an
       * access token that works for an hour and a mailbox that
       * silently stops working after lunch. It is the single
       * most common way to get this flow wrong.
       */
      access_type: "offline",
      prompt: "consent",
      /* So a person adding `send` later keeps the scopes they
         already granted rather than trading them. */
      include_granted_scopes: "true",
    });

    return `${OAUTH_AUTHORIZE}?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier }) {
    const { clientId, clientSecret } = credentials();

    return tokenRequest({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: config.gmail.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });
  },

  async refresh(refreshToken) {
    const { clientId, clientSecret } = credentials();

    return tokenRequest({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });
  },

  async revoke(token) {
    /* Best effort, per the interface. A failure here is logged
       by the caller and does not stop the row being deleted. */
    await call<void>(OAUTH_REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  },

  async identify(accessToken) {
    const data = await call<{ emailAddress?: string }>(`${API}/profile`, {
      method: "GET",
      accessToken,
    });

    if (!data.emailAddress) {
      throw new EmailProviderError(
        "unavailable",
        "Google did not say which mailbox this is."
      );
    }

    return data.emailAddress;
  },

  async list(accessToken, options) {
    const max = Math.max(
      1,
      Math.min(options.maxResults, config.listHardMax)
    );

    const query = [options.query?.trim(), options.unreadOnly ? "is:unread" : ""]
      .filter(Boolean)
      .join(" ");

    const params = new URLSearchParams({ maxResults: String(max) });

    if (query) {
      params.set("q", query);
    }

    const listing = await call<{
      messages?: Array<{ id: string; threadId: string }>;
    }>(`${API}/messages?${params.toString()}`, {
      method: "GET",
      accessToken,
    });

    const ids = (listing.messages ?? []).map((entry) => entry.id);

    if (ids.length === 0) {
      return [];
    }

    /*
     * Gmail's list returns ids and nothing else, so the headers
     * cost one request each. They are fetched in parallel with
     * `format=metadata`, which is the cheap shape: headers and
     * the snippet, no body, no attachment bytes.
     *
     * `allSettled` rather than `all` because one message that
     * has been deleted between the list and the get should cost
     * that message, not the whole listing. A triage missing one
     * row is a smaller failure than a triage that errored.
     */
    const settled = await Promise.allSettled(
      ids.map((id) =>
        call<GmailMessage>(
          `${API}/messages/${encodeURIComponent(id)}?format=metadata` +
            "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date",
          { method: "GET", accessToken }
        )
      )
    );

    const summaries: EmailSummary[] = [];

    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        summaries.push(toSummary(entry.value));
      }
    }

    return summaries;
  },

  async get(accessToken, messageId) {
    const message = await call<GmailMessage>(
      `${API}/messages/${encodeURIComponent(messageId)}?format=full`,
      { method: "GET", accessToken }
    );

    return toMessage(message);
  },

  async thread(accessToken, threadId) {
    const data = await call<{ messages?: GmailMessage[] }>(
      `${API}/threads/${encodeURIComponent(threadId)}?format=full`,
      { method: "GET", accessToken }
    );

    return (data.messages ?? []).map(toMessage);
  },

  async send(accessToken, draft) {
    const from = await gmailProvider.identify(accessToken);

    /*
     * The RFC message-id of what is being replied to, fetched
     * rather than guessed.
     *
     * Gmail's api id and the Message-ID header are different
     * strings for the same message, and only the header threads
     * correctly in other people's clients. A failure to fetch
     * it costs the threading, not the send.
     */
    let references: { messageId?: string } = {};

    if (draft.replyToMessageId) {
      try {
        const original = await call<GmailMessage>(
          `${API}/messages/${encodeURIComponent(draft.replyToMessageId)}` +
            "?format=metadata&metadataHeaders=Message-ID",
          { method: "GET", accessToken }
        );

        const messageId = headerOf(original.payload?.headers, "message-id");

        if (messageId) {
          references = { messageId };
        }
      } catch (error) {
        console.error(
          `[email] could not read the message-id being replied to: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
      }
    }

    const result = await call<{ id?: string; threadId?: string }>(
      `${API}/messages/send`,
      {
        method: "POST",
        accessToken,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          raw: encodeBase64Url(buildMime(from, draft, references)),
          ...(draft.threadId ? { threadId: draft.threadId } : {}),
        }),
      }
    );

    if (!result.id) {
      throw new EmailProviderError(
        "unavailable",
        "Gmail accepted the message but did not say what it was called."
      );
    }

    return { messageId: result.id, threadId: result.threadId ?? "" };
  },

  async organize(accessToken, input) {
    const addNames = input.addLabels ?? [];
    const removeNames = [...(input.removeLabels ?? [])];

    if (input.archive) {
      removeNames.push("INBOX");
    }

    if (input.markRead) {
      removeNames.push("UNREAD");
    }

    if (input.markUnread) {
      addNames.push("UNREAD");
    }

    const add = await resolveLabels(accessToken, addNames);
    const remove = await resolveLabels(accessToken, removeNames);
    const unknown = [...add.unknown, ...remove.unknown];

    if (unknown.length > 0) {
      const available = add.available.length > 0 ? add.available : remove.available;

      throw new EmailProviderError(
        "invalid",
        `This mailbox has no label called ${unknown
          .map((name) => `"${name}"`)
          .join(", ")}.${
          available.length > 0
            ? ` The labels it does have are: ${available.join(", ")}.`
            : " It has no labels of its own yet."
        } Use one of those, or ask the person to make the label first.`
      );
    }

    /*
     * `batchModify` rather than one request per message. It
     * takes up to a thousand ids and returns 204; the cap that
     * matters is `email.maxOrganizeIds`, applied by the tool
     * before this is reached.
     */
    await call<void>(`${API}/messages/batchModify`, {
      method: "POST",
      accessToken,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: input.messageIds,
        ...(add.ids.length > 0 ? { addLabelIds: add.ids } : {}),
        ...(remove.ids.length > 0 ? { removeLabelIds: remove.ids } : {}),
      }),
    });

    return { changed: input.messageIds.length };
  },
};
