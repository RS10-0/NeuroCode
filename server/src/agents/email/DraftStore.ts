import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";
import { email as config } from "../../ai/config";
/*
 * The event shape lives in ai/types.ts beside GeneratedDocument,
 * because it is part of the runtime's stream contract rather
 * than part of this table. Re-exported so callers of this store
 * do not have to know that.
 */
export type { DraftedEmailEvent as DraftedEmail } from "../../ai/types";
/*
 * The validator lives in ./addresses, a leaf module, so the
 * tools can import it without importing this file and the
 * Supabase client behind it. Re-exported here because the send
 * route validates again on the way out — a row could have been
 * written by an older build, and the check that matters most is
 * the one immediately before the bytes leave.
 */
export { cleanAddresses, isValidAddress } from "./addresses";
export type { AddressCheck } from "./addresses";

/*
 * The approval queue.
 *
 * THIS FILE IS THE SEND GATE, and the shape of it is the whole
 * argument: `createDraft` is reachable from a tool, and
 * `markSent` is not. There is no function here that both writes
 * a row and delivers a message, because there is no moment at
 * which one turn may do both.
 *
 * So the worst a fully-compromised turn can do to somebody's
 * correspondence is put a paragraph in a tray. A person then
 * reads it, and a person then presses a button, and only then
 * does anything leave.
 *
 * Service-role throughout. Migration 0019 grants the browser
 * SELECT so the tray can render, and nothing else — a browser
 * that could update `status` could mark a draft sent without
 * sending it, and a browser that could insert one could put
 * words in an agent's mouth. Every mutation is a function here,
 * with the explicit `.eq("user_id", ...)` that the service role
 * makes load-bearing.
 */

/*
 * `sending` is a claim rather than a state anybody chose. See
 * `claimForSend` — it is held for the second a provider call
 * takes, and it is what makes a double-click send once.
 */
export type DraftStatus = "draft" | "sending" | "sent" | "discarded";

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
  status: DraftStatus;
  providerMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
  expiresAt: string;
  /*
   * WHAT SHAPED THIS DRAFT, when a captured web page did.
   *
   * Null on every draft written before Phase 4 and on every one
   * written without page context, which is most of them.
   *
   * This is the one place page context is deliberately RETAINED
   * — see the note on `sourcePage` in CreateDraftInput for why
   * a rule that otherwise holds everywhere is broken here on
   * purpose.
   */
  sourcePage: DraftSourcePage | null;
}

/*
 * The provenance of a draft that a web page influenced.
 *
 * `text` is the whole capture, as the model saw it. Not a
 * summary and not the URL alone, because the point of showing
 * it is that a person can notice when the draft and the page do
 * not match — and an injected instruction lives in the text. A
 * learner told only that `example.com` was used has been told
 * nothing they can act on.
 */
export interface DraftSourcePage {
  url: string;
  title: string;
  mode: "selection" | "page";
  text: string;
  /*
   * Whether `text` is the whole of what was on the page.
   *
   * False for almost every capture. When it is true the send
   * screen has to say so, because a learner who reads a
   * capture to the end and finds nothing alarming has drawn a
   * conclusion the text did not support — the part that would
   * have alarmed them may simply not be here.
   */
  truncated: boolean;
}

const COLUMNS =
  "id, user_id, agent_id, account_id, to_addresses, cc_addresses, subject, body, reply_to_message_id, thread_id, status, provider_message_id, sent_at, created_at, expires_at, source_page_url, source_page_title, source_page_text, source_capture_mode, source_page_truncated";

interface DraftRow {
  id: string;
  user_id: string;
  agent_id: string;
  account_id: string | null;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
  subject: string;
  body: string;
  reply_to_message_id: string | null;
  thread_id: string | null;
  status: string;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  expires_at: string;
  source_page_url: string | null;
  source_page_title: string | null;
  source_page_text: string | null;
  source_capture_mode: string | null;
  source_page_truncated: boolean | null;
}

/*
 * Present only when all of it is.
 *
 * A row carrying a URL but no text is not half a provenance, it
 * is a provenance that cannot do its job — the send screen
 * would show an address and no captured text, which is exactly
 * the "cheap version" §2.3.1 rejects. Treating a partial row as
 * absent is the honest reading, and it also means a
 * hand-written row cannot produce a screen that implies the
 * page has been disclosed when it has not.
 */
function toSourcePage(row: DraftRow): DraftSourcePage | null {
  if (
    typeof row.source_page_url !== "string" ||
    typeof row.source_page_text !== "string" ||
    (row.source_capture_mode !== "selection" &&
      row.source_capture_mode !== "page")
  ) {
    return null;
  }

  return {
    url: row.source_page_url,
    title: row.source_page_title ?? "",
    mode: row.source_capture_mode,
    text: row.source_page_text,
    /*
     * NULL READS AS "NOT TRUNCATED", which is the one place
     * this mapper does not treat a missing piece as fatal.
     *
     * The strict all-or-nothing test above is about whether
     * there is a disclosure to make at all. This is a detail
     * OF that disclosure, and it is absent on every draft
     * written between 0020 and 0021 — rows with real
     * provenance and no opinion about truncation. Refusing
     * those would delete a working disclosure to avoid
     * understating one line of it.
     *
     * The direction is the safe one only because the
     * application always writes the flag alongside the text
     * now, so a null here means "written before the column
     * existed" rather than "written and unknown". 0021's
     * truncated_needs_text constraint is what keeps that true.
     */
    truncated: row.source_page_truncated === true,
  };
}

function asStatus(value: unknown): DraftStatus {
  return value === "sent" || value === "discarded" || value === "sending"
    ? value
    : "draft";
}

function toDraft(row: DraftRow): EmailDraftRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    accountId: row.account_id,
    to: row.to_addresses ?? [],
    cc: row.cc_addresses ?? [],
    subject: row.subject,
    body: row.body,
    replyToMessageId: row.reply_to_message_id,
    threadId: row.thread_id,
    status: asStatus(row.status),
    providerMessageId: row.provider_message_id,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sourcePage: toSourcePage(row),
  };
}

/* =========================================================
   WRITES
========================================================= */

export interface CreateDraftInput {
  userId: string;
  agentId: string;
  accountId: string;
  runId?: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  threadId?: string;
  /*
   * The page that was in front of the learner on the turn that
   * wrote this draft, when there was one.
   *
   * A DELIBERATE EXCEPTION TO THE NO-RETENTION RULE, and the
   * only one besides a model-chosen `data_set` write. Page
   * context is otherwise never stored: not by the extension,
   * not in `ai_usage` — which holds counts and no content — not
   * as a memory, and nowhere else at all.
   *
   * It is stored here because a drafted reply is the one place
   * where a captured page stops being a private turn and
   * becomes something that LEAVES THE BUILDING. Everywhere else
   * the worst a hostile page achieves is a bad answer on the
   * learner's own screen. Here it could shape a message that
   * goes to a person.
   *
   * `email_send`'s whole design rests on one sentence in
   * capabilities.ts: every send is you, pressing a button, on a
   * message you have read. Page context quietly weakens that,
   * because a learner reading a draft sees the words and not
   * what produced them — and a draft that reads perfectly
   * reasonably may have been shaped by a paragraph its author
   * wrote specifically to shape it. So the send-confirmation
   * view shows the capture, and that requires it to still
   * exist.
   *
   * Holding it only while the panel is open would be worse than
   * useless: the guarantee would evaporate in the gap between
   * drafting and sending, which is precisely the gap it exists
   * to cover.
   *
   * IT NEEDS NO RETENTION PATH OF ITS OWN. These are columns on
   * a row `sweep_email_drafts` already deletes, so provenance
   * dies with the draft it describes, in the same statement,
   * and cannot outlive it.
   */
  sourcePage?: DraftSourcePage;
}

export async function createDraft(
  input: CreateDraftInput
): Promise<EmailDraftRecord> {
  const { data, error } = await supabase
    .from("agent_email_drafts")
    .insert({
      user_id: input.userId,
      agent_id: input.agentId,
      account_id: input.accountId,
      run_id: input.runId ?? null,
      to_addresses: input.to,
      cc_addresses: input.cc,
      subject: input.subject.slice(0, config.maxSubjectChars),
      body: input.body.slice(0, config.maxBodyChars),
      reply_to_message_id: input.replyToMessageId ?? null,
      thread_id: input.threadId ?? null,
      status: "draft",
      /*
       * All four together or all four null. The reader treats a
       * partial row as no provenance at all, so writing one
       * would produce a draft that looks unaffected by a page
       * that in fact shaped it — the failure this whole feature
       * exists to prevent.
       */
      source_page_url: input.sourcePage?.url ?? null,
      source_page_title: input.sourcePage?.title ?? null,
      source_page_text: input.sourcePage?.text ?? null,
      source_capture_mode: input.sourcePage?.mode ?? null,
      /* `?? null` rather than `?? false`, so a draft with no
         page context stores no opinion about truncation —
         0021's constraint refuses the other shape anyway. */
      source_page_truncated: input.sourcePage?.truncated ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error(`[email] saving a draft failed: ${error.message}`);

    throw new AiRuntimeError("internal_error", "Could not save that draft.");
  }

  return toDraft(data as DraftRow);
}

/* =========================================================
   READS
========================================================= */

export async function listDrafts(
  userId: string,
  agentId: string,
  limit = 30
): Promise<EmailDraftRecord[]> {
  const { data, error } = await supabase
    .from("agent_email_drafts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[email] listing drafts failed: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not load this agent's drafts."
    );
  }

  return (data ?? []).map((row) => toDraft(row as DraftRow));
}

/* Null for both "no such draft" and "somebody else's draft",
   which the caller turns into a 404 — the only thing another
   learner's id should ever look like. */
export async function getDraft(
  userId: string,
  draftId: string
): Promise<EmailDraftRecord | null> {
  const { data, error } = await supabase
    .from("agent_email_drafts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("id", draftId)
    .maybeSingle();

  if (error) {
    console.error(`[email] loading a draft failed: ${error.message}`);

    throw new AiRuntimeError("internal_error", "Could not load that draft.");
  }

  return data ? toDraft(data as DraftRow) : null;
}

/* =========================================================
   THE TWO TERMINAL WRITES
========================================================= */

/*
 * Called by the send route, AFTER the provider has accepted the
 * message, and by nothing else.
 *
 * Matches only the row this caller CLAIMED — status `sending`,
 * which `claimForSend` set before the provider was reached. So
 * the pair is a claim and a settle, and the race is decided at
 * the claim, before anything has left, rather than here after
 * both messages have gone.
 *
 * Returns null when nothing matched, which the route reports as
 * "this has already been sent" rather than as an error.
 */
export async function markSent(input: {
  userId: string;
  draftId: string;
  providerMessageId: string;
}): Promise<EmailDraftRecord | null> {
  const { data, error } = await supabase
    .from("agent_email_drafts")
    .update({
      status: "sent",
      provider_message_id: input.providerMessageId,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("id", input.draftId)
    .eq("status", "sending")
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`[email] marking a draft sent failed: ${error.message}`);

    /*
     * The message HAS gone. This is the one failure in the
     * capability where the world and the database disagree and
     * the world is ahead — so it is logged loudly and reported
     * honestly rather than being turned into "the send failed",
     * which would invite somebody to send it twice.
     */
    throw new AiRuntimeError(
      "internal_error",
      "The message was sent, but BuildGentic could not record it. Check your Sent folder before sending again."
    );
  }

  return data ? toDraft(data as DraftRow) : null;
}

/*
 * A draft claimed, so that nothing else can send it while the
 * provider call is in flight.
 *
 * Without this, two clicks a second apart both read a `draft`
 * row, both call Gmail, and the person sends the same reply
 * twice — with `markSent` afterwards refusing only the second
 * WRITE, long after both messages have left. The compare-and-set
 * has to happen BEFORE the provider is reached, not after.
 *
 * The claim is released by `markSent` on success, and by
 * `releaseClaim` on failure, so a send that fails at Gmail
 * leaves a draft somebody can try again.
 */
export async function claimForSend(
  userId: string,
  draftId: string
): Promise<EmailDraftRecord | null> {
  const { data, error } = await supabase
    .from("agent_email_drafts")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", draftId)
    .eq("status", "draft")
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`[email] claiming a draft failed: ${error.message}`);

    throw new AiRuntimeError("internal_error", "Could not send that draft.");
  }

  return data ? toDraft(data as DraftRow) : null;
}

export async function releaseClaim(
  userId: string,
  draftId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_email_drafts")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", draftId)
    .eq("status", "sending");

  if (error) {
    console.error(`[email] releasing a draft claim failed: ${error.message}`);
  }
}

export async function discardDraft(
  userId: string,
  draftId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_email_drafts")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", draftId)
    .in("status", ["draft", "sending"]);

  if (error) {
    console.error(`[email] discarding a draft failed: ${error.message}`);

    throw new AiRuntimeError("internal_error", "Could not discard that draft.");
  }
}

/*
 * Drafts written during one scheduled run.
 *
 * The sibling of documents/DocumentStore.listForRun, and it
 * exists for the same reason: the notification's body says what
 * the run produced, and it is built from rows rather than from
 * the run's prose. A run that says it drafted three replies and
 * wrote none produces an email that lists none.
 */
export async function listForRun(
  userId: string,
  runId: string
): Promise<EmailDraftRecord[]> {
  const { data, error } = await supabase
    .from("agent_email_drafts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[email] listing a run's drafts failed: ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => toDraft(row as DraftRow));
}
