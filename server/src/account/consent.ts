import { randomBytes } from "node:crypto";

import { hashToken } from "../ai/crypto";
import { mailEnabled, publicSiteBaseUrl } from "../ai/config";
import { sendMail } from "../agents/schedule/mail";
import { disconnectAccount, listAccounts } from "../agents/email/AccountStore";
import { supabase } from "../lib/supabase";
import {
  AccountError,
  deleteAccount,
  writeAgeBand,
  writeConsentGranted,
} from "./AgeGate";
import {
  consentConfirmationText,
  consentExpiry,
  consentNoticeText,
  isExpired,
  mayResend,
  normaliseEmail,
  type AgeBand,
} from "./rules";

/*
 * Asking a parent, and acting on the answer.
 *
 * THE TOKENS. Each email carries one random token — 32 bytes,
 * base64url — and the table holds only its SHA-256, the shape
 * deployment and extension tokens already use. Approving needs
 * the token from the email; a copy of the table does not have
 * it.
 *
 * THE LINKS put the token in the URL FRAGMENT (#token=…), not
 * the query string. A fragment never leaves the browser, so it
 * is not in Vercel's request log, not in Render's, and not in a
 * Referer header. The page reads it and POSTs it.
 *
 * A link being OPENED does nothing. School and work mail
 * scanners follow links to check them, and a consent spent by a
 * scanner would be a consent nobody gave. Only the POST from the
 * page — after a person has typed their name and ticked the box —
 * decides anything.
 */

const TOKEN_BYTES = 32;

interface ConsentRow {
  id: string;
  user_id: string;
  parent_email: string;
  status: "pending" | "granted" | "declined" | "revoked";
  requested_at: string;
  expires_at: string;
  emails_sent: number;
  last_sent_at: string;
}

const COLUMNS =
  "id, user_id, parent_email, status, requested_at, expires_at, emails_sent, last_sent_at";

function mintToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashToken(token) };
}

/* A token from a request body, or null. Bounded, so a hostile
   caller cannot make the server hash a megabyte. */
function readToken(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 && raw.length <= 200 ? raw : null;
}

async function childOf(userId: string): Promise<{ name: string; email: string | null }> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    throw new AccountError(404, "not_found", "That account no longer exists.");
  }

  const meta = data.user.user_metadata as { username?: unknown } | undefined;
  const name =
    typeof meta?.username === "string" && meta.username.trim()
      ? meta.username.trim()
      : "Your child";

  return { name, email: data.user.email ?? null };
}

async function sendNotice(input: {
  childName: string;
  parentEmail: string;
  token: string;
}): Promise<void> {
  const result = await sendMail({
    to: input.parentEmail,
    subject: `${input.childName} would like to use BuildGentic — your OK is needed`,
    text: consentNoticeText({
      childName: input.childName,
      siteUrl: publicSiteBaseUrl,
      link: `${publicSiteBaseUrl}/parent-consent#token=${input.token}`,
    }),
  });

  if (!result.ok) {
    throw new AccountError(
      502,
      "email_failed",
      "We couldn't send the email to your parent just now. Try again in a minute."
    );
  }
}

/* =========================================================
   THE CHILD'S SIDE
========================================================= */

/*
 * Record the age answer, and if it is under 13, ask a parent.
 *
 * Under 13 needs a working mail setup BEFORE anything is
 * written. Recording "pending" against a server that cannot send
 * would leave a child stuck behind a waiting screen for a parent
 * who will never be asked.
 */
export async function answerAge(input: {
  userId: string;
  band: AgeBand;
  parentEmail?: unknown;
}): Promise<{ sentTo: string | null }> {
  if (input.band !== "under_13") {
    await writeAgeBand(input.userId, input.band);
    return { sentTo: null };
  }

  if (!mailEnabled()) {
    throw new AccountError(
      503,
      "email_unavailable",
      "We can't send emails to parents right now, so accounts for under-13s can't be set up yet. Please try again later."
    );
  }

  const parentEmail = normaliseEmail(input.parentEmail);

  if (!parentEmail) {
    throw new AccountError(400, "invalid_email", "Enter your parent or guardian's email address.");
  }

  const child = await childOf(input.userId);

  /* The cheapest trick there is, refused. It does not stop a
     second address of the child's own — nothing an email flow
     does can — but it stops the one that needs no effort. */
  if (child.email && child.email.toLowerCase() === parentEmail) {
    throw new AccountError(
      400,
      "same_email",
      "That's the email for this account. We need a parent or guardian's own email address."
    );
  }

  await writeAgeBand(input.userId, "under_13");

  /*
   * A mailbox connected before the age was known goes now.
   * Under-13 accounts cannot use Email Agent, and a connection
   * that outlives the rule is the rule not applying. Best
   * effort: a failed revoke is logged, never allowed to stop
   * the consent request.
   */
  try {
    for (const account of await listAccounts(input.userId)) {
      await disconnectAccount(input.userId, account.id);
    }
  } catch (error) {
    console.error(`[age] could not disconnect email for ${input.userId}: ${describe(error)}`);
  }

  await startRequest({
    userId: input.userId,
    childName: child.name,
    parentEmail,
    requestedAt: new Date(),
    emailsSent: 1,
  });

  return { sentTo: parentEmail };
}

async function startRequest(input: {
  userId: string;
  childName: string;
  parentEmail: string;
  requestedAt: Date;
  emailsSent: number;
}): Promise<void> {
  const { token, hash } = mintToken();

  /* At most one live request: a new one replaces the old, and
     the old email's link stops working at once. */
  await supabase
    .from("parental_consents")
    .delete()
    .eq("user_id", input.userId)
    .eq("status", "pending");

  const { error } = await supabase.from("parental_consents").insert({
    user_id: input.userId,
    parent_email: input.parentEmail,
    consent_token_hash: hash,
    status: "pending",
    requested_at: input.requestedAt.toISOString(),
    expires_at: consentExpiry(input.requestedAt).toISOString(),
    emails_sent: input.emailsSent,
    last_sent_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`consent insert failed: ${error.message}`);
  }

  await sendNotice({ childName: input.childName, parentEmail: input.parentEmail, token });
}

async function pendingRequestOf(userId: string): Promise<ConsentRow | null> {
  const { data, error } = await supabase
    .from("parental_consents")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new Error(`consent lookup failed: ${error.message}`);
  }

  return (data as ConsentRow | null) ?? null;
}

/* What the waiting screen shows. */
export async function pendingSummary(userId: string): Promise<{
  parentEmail: string;
  expiresAt: string;
} | null> {
  const row = await pendingRequestOf(userId);
  return row ? { parentEmail: row.parent_email, expiresAt: row.expires_at } : null;
}

/*
 * Send again, optionally to a different address.
 *
 * A changed address keeps the ORIGINAL request date, so the
 * seven days are not reset by changing it — otherwise changing
 * the address every six days would keep an unconsented account
 * alive forever. The send count carries over too, so changing
 * the address is not a way around the limit.
 */
export async function resendRequest(input: {
  userId: string;
  parentEmail?: unknown;
}): Promise<{ sentTo: string }> {
  if (!mailEnabled()) {
    throw new AccountError(503, "email_unavailable", "We can't send emails right now. Try again later.");
  }

  const row = await pendingRequestOf(input.userId);

  if (!row) {
    throw new AccountError(409, "not_pending", "There is no request waiting for a parent.");
  }

  const verdict = mayResend(
    { emailsSent: row.emails_sent, lastSentAt: new Date(row.last_sent_at) },
    new Date()
  );

  if (!verdict.ok) {
    throw new AccountError(
      429,
      "resend_limited",
      "That's a lot of emails for now. Give your parent a little time, then try again.",
      verdict.retryAfterSeconds
    );
  }

  const parentEmail =
    input.parentEmail === undefined ? row.parent_email : normaliseEmail(input.parentEmail);

  if (!parentEmail) {
    throw new AccountError(400, "invalid_email", "Enter your parent or guardian's email address.");
  }

  const child = await childOf(input.userId);

  if (child.email && child.email.toLowerCase() === parentEmail) {
    throw new AccountError(
      400,
      "same_email",
      "That's the email for this account. We need a parent or guardian's own email address."
    );
  }

  await startRequest({
    userId: input.userId,
    childName: child.name,
    parentEmail,
    requestedAt: new Date(row.requested_at),
    emailsSent: verdict.nextCount,
  });

  return { sentTo: parentEmail };
}

/* =========================================================
   THE PARENT'S SIDE
========================================================= */

async function requestByToken(raw: unknown): Promise<ConsentRow> {
  const token = readToken(raw);

  const { data, error } = token
    ? await supabase
        .from("parental_consents")
        .select(COLUMNS)
        .eq("consent_token_hash", hashToken(token))
        .maybeSingle()
    : { data: null, error: null };

  if (error) {
    throw new Error(`consent lookup failed: ${error.message}`);
  }

  const row = data as ConsentRow | null;

  if (!row || row.status !== "pending" || isExpired(new Date(row.expires_at), new Date())) {
    throw new AccountError(
      410,
      "link_expired",
      "This link has expired or has already been used."
    );
  }

  return row;
}

/* What the parent's page shows before they decide. */
export async function describeRequest(token: unknown): Promise<{
  childName: string;
  expiresAt: string;
}> {
  const row = await requestByToken(token);
  const child = await childOf(row.user_id);

  return { childName: child.name, expiresAt: row.expires_at };
}

export async function decideRequest(input: {
  token: unknown;
  decision: unknown;
  parentName: unknown;
}): Promise<{ outcome: "approved" | "declined"; childName: string }> {
  const row = await requestByToken(input.token);
  const child = await childOf(row.user_id);

  if (input.decision === "decline") {
    await supabase
      .from("parental_consents")
      .update({ status: "declined", decided_at: new Date().toISOString() })
      .eq("id", row.id);

    await deleteAccount(row.user_id);

    return { outcome: "declined", childName: child.name };
  }

  if (input.decision !== "approve") {
    throw new AccountError(400, "invalid_request", "Choose to approve or decline.");
  }

  const parentName =
    typeof input.parentName === "string" ? input.parentName.trim().slice(0, 120) : "";

  if (parentName.length < 2) {
    throw new AccountError(400, "name_required", "Type your full name to sign.");
  }

  const { token: revokeToken, hash: revokeHash } = mintToken();

  /* Conditional on still being pending, so two tabs approving at
     once produce one approval rather than two revoke links. */
  const { data: updated, error } = await supabase
    .from("parental_consents")
    .update({
      status: "granted",
      parent_name: parentName,
      decided_at: new Date().toISOString(),
      revoke_token_hash: revokeHash,
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");

  if (error) {
    throw new Error(`consent approve failed: ${error.message}`);
  }

  if (!updated || updated.length === 0) {
    throw new AccountError(410, "link_expired", "This link has already been used.");
  }

  await writeConsentGranted(row.user_id);

  /*
   * The confirmation is the "plus" in email-plus: a second
   * message to the parent, after the fact, carrying the way to
   * undo it. A failure to send is logged rather than undoing the
   * approval — the parent has agreed, on our page, with their
   * name — and the privacy policy tells them how to reach us.
   */
  const confirmation = await sendMail({
    to: row.parent_email,
    subject: `You approved ${child.name}'s BuildGentic account`,
    text: consentConfirmationText({
      childName: child.name,
      parentName,
      siteUrl: publicSiteBaseUrl,
      revokeLink: `${publicSiteBaseUrl}/parent-consent#revoke=${revokeToken}`,
    }),
  });

  if (!confirmation.ok) {
    console.error(`[age] confirmation email failed for consent ${row.id}: ${confirmation.error}`);
  }

  return { outcome: "approved", childName: child.name };
}

async function grantedByRevokeToken(raw: unknown): Promise<ConsentRow> {
  const token = readToken(raw);

  const { data, error } = token
    ? await supabase
        .from("parental_consents")
        .select(COLUMNS)
        .eq("revoke_token_hash", hashToken(token))
        .eq("status", "granted")
        .maybeSingle()
    : { data: null, error: null };

  if (error) {
    throw new Error(`consent lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new AccountError(
      410,
      "link_expired",
      "This link no longer works. The account may already have been deleted."
    );
  }

  return data as ConsentRow;
}

export async function describeRevoke(token: unknown): Promise<{ childName: string }> {
  const row = await grantedByRevokeToken(token);
  const child = await childOf(row.user_id);
  return { childName: child.name };
}

/* Withdrawing consent deletes the account; the cascade takes
   the consent row with it. */
export async function revokeConsent(token: unknown): Promise<{ childName: string }> {
  const row = await grantedByRevokeToken(token);
  const child = await childOf(row.user_id);

  await deleteAccount(row.user_id);

  return { childName: child.name };
}

/* =========================================================
   THE SWEEP
========================================================= */

/*
 * Delete accounts whose parent never answered.
 *
 * COPPA allows holding a child's and parent's contact details to
 * ask for consent, and expects them gone if consent does not
 * come. Seven days is the window the notice promised.
 *
 * Checks the account's own state again before deleting, so an
 * account approved a moment ago — between the read and the
 * delete — is never removed. Bounded per tick; anything left is
 * picked up ten minutes later.
 */
export async function sweepExpiredConsents(): Promise<number> {
  const { data, error } = await supabase
    .from("parental_consents")
    .select("id, user_id")
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .limit(25);

  if (error) {
    throw new Error(`consent sweep failed: ${error.message}`);
  }

  let deleted = 0;

  for (const row of (data ?? []) as Array<{ id: string; user_id: string }>) {
    const { data: scope } = await supabase
      .from("user_account_scope")
      .select("consent_status")
      .eq("user_id", row.user_id)
      .maybeSingle();

    if ((scope as { consent_status?: string } | null)?.consent_status !== "pending") {
      continue;
    }

    try {
      await deleteAccount(row.user_id);
      deleted += 1;
    } catch (error) {
      console.error(`[age] sweep could not delete ${row.user_id}: ${describe(error)}`);
    }
  }

  return deleted;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
