import { authHeaders } from "../../lib/api";

/*
 * The browser's side of email.
 *
 * ONE FUNCTION IN THIS FILE CAUSES A MESSAGE TO LEAVE, and it
 * is the only thing in the entire product that can. `sendDraft`
 * is called from exactly one place — a button, under a draft, on
 * a screen a person is looking at — and nothing in the runtime
 * can reach it.
 *
 * The rest of this file is about being honest about state. The
 * tray is fetched from rows rather than derived from what an
 * agent said, so a draft is a draft until the server says it is
 * sent, and no amount of confident prose can move it.
 *
 * NO TOKEN EVER ARRIVES HERE. `EmailAccountSummary` has no
 * field for one, which is not carefulness on this side but a
 * fact about the server: the route builds its response from a
 * type that has no token to omit.
 */

const BASE = "/api/agents";

export type EmailGrant = "read" | "draft" | "send" | "organize";

export interface EmailAccountSummary {
  id: string;
  provider: string;
  emailAddress: string;
  /* What the person actually allowed on Google's consent
     screen, which may be less than was asked for. The UI says
     so rather than letting a tool fail later. */
  grants: EmailGrant[];
  connectedAt: string;
  lastUsedAt: string | null;
}

export interface EmailStatus {
  /* Whether this server can run the flow at all. False means a
     missing client id or secret — an operator problem, and the
     screen says so instead of offering a button that leads to a
     Google error page. */
  configured: boolean;
  provider: string;
  accounts: EmailAccountSummary[];
}

export type EmailDraftStatus = "draft" | "sending" | "sent" | "discarded";

/*
 * The web page that shaped this draft, when one did.
 *
 * Null on every draft written from the Builder, from a
 * schedule, or from the extension without a page — which is
 * most of them. Present only when a captured page was in the
 * prompt that wrote the reply.
 *
 * The whole captured text is here, not a summary, and the
 * send-confirmation view renders it. That is the point: a
 * learner reading a draft sees the words and not what produced
 * them, and a draft that reads perfectly reasonably may have
 * been shaped by a paragraph its author wrote specifically to
 * shape it. Showing the address alone would show the one part
 * that cannot carry the payload.
 */
export interface DraftSourcePage {
  url: string;
  title: string;
  mode: "selection" | "page";
  text: string;
  /* Whether the capture hit its cap, so `text` is the top of
     the page rather than the whole of it. The send screen has
     to say so: a learner who reads to the end of a truncated
     capture and finds nothing has been told less than they
     think. */
  truncated: boolean;
}

export interface EmailDraftRecord {
  id: string;
  agentId: string;
  accountId: string | null;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  replyToMessageId: string | null;
  threadId: string | null;
  status: EmailDraftStatus;
  providerMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
  expiresAt: string;
  sourcePage: DraftSourcePage | null;
}

/* =========================================================
   THE ACCOUNT
========================================================= */

export async function fetchEmailStatus(): Promise<EmailStatus> {
  const response = await fetch(`${BASE}/email/status`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not check your email connection.");
  }

  return (await response.json()) as EmailStatus;
}

/*
 * Starts the flow and hands back the URL to send the browser
 * to.
 *
 * Two steps rather than one navigation, because the request
 * that proves who is asking needs a bearer token and a browser
 * following a link does not carry one. So the session is proved
 * in a fetch, and the navigation happens afterwards with a URL
 * the caller already holds.
 *
 * `agentId` decides which permissions Google is asked for. An
 * agent that can only read produces a consent screen asking to
 * read — being asked for permission to send mail by something
 * that cannot send mail is how people learn to click through
 * consent screens without reading them.
 */
export async function startEmailConnect(input: {
  agentId?: string;
  returnPath?: string;
}): Promise<string> {
  const response = await fetch(`${BASE}/email/connect`, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };

  if (!response.ok || !body.url) {
    throw new Error(body.error ?? "Could not start connecting that account.");
  }

  return body.url;
}

export async function disconnectEmailAccount(accountId: string): Promise<void> {
  const response = await fetch(`${BASE}/email/accounts/${accountId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not disconnect that account.");
  }
}

/* =========================================================
   THE TRAY
========================================================= */

export async function listEmailDrafts(
  agentId: string
): Promise<{ drafts: EmailDraftRecord[]; canSend: boolean }> {
  const response = await fetch(`${BASE}/${agentId}/email/drafts`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not load this agent's drafts.");
  }

  const body = (await response.json()) as {
    drafts?: EmailDraftRecord[];
    canSend?: boolean;
  };

  return { drafts: body.drafts ?? [], canSend: body.canSend === true };
}

/*
 * THE SEND.
 *
 * Everything about this capability is arranged so that this
 * function is called from a click and from nowhere else. There
 * is no send tool in the runtime, so no turn — in the Test
 * panel, on a schedule, through a deployment — has any path to
 * this endpoint.
 *
 * The error is passed through verbatim, unlike most in this
 * project, because every refusal the server can give here is
 * something the person can act on: the agent is not allowed to
 * send, the mailbox was connected without that permission, the
 * draft has already gone. A generic sentence would leave them
 * pressing the button again.
 */
export async function sendDraft(
  agentId: string,
  draftId: string
): Promise<EmailDraftRecord> {
  const response = await fetch(
    `${BASE}/${agentId}/email/drafts/${draftId}/send`,
    { method: "POST", headers: await authHeaders() }
  );

  const body = (await response.json().catch(() => ({}))) as {
    draft?: EmailDraftRecord;
    error?: string;
  };

  if (!response.ok || !body.draft) {
    throw new Error(body.error ?? "That message could not be sent.");
  }

  return body.draft;
}

export async function discardDraft(
  agentId: string,
  draftId: string
): Promise<void> {
  const response = await fetch(`${BASE}/${agentId}/email/drafts/${draftId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not discard that draft.");
  }
}
