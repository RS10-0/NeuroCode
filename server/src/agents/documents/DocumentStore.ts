import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";
import { documents } from "../../ai/config";
import type { DocumentFormat, GeneratedDocument } from "../../ai/types";

import type { RenderedDocument } from "./render";

/*
 * Where a generated file lives.
 *
 * files/FileStore.ts is the obvious model and it is the wrong
 * one, for a reason that is specific rather than aesthetic. Its
 * retention is thirty minutes and it lives in a Map that a
 * restart empties — which is exactly right for an ATTACHMENT,
 * whose whole purpose is to answer the question being asked
 * with it. A scheduled run generates a report at four in the
 * morning and its owner opens the email at nine. An in-process
 * store loses that file to any deploy, any restart, and to the
 * retention window itself: the one delivery this feature exists
 * for is the one that store cannot make.
 *
 * So the bytes are in a table, and the promise FileStore
 * actually makes is kept a different way. That promise is "a
 * file must not become permanently reachable because somebody
 * knows a URL", and it holds here because the id is a v4 uuid,
 * the route demands a session and matches user_id, a stranger's
 * id is indistinguishable from a missing one, and the row
 * expires. There is no signed public URL and no anonymous path.
 *
 * The service-role client bypasses RLS, so — as in MemoryStore
 * and ScheduleStore — the explicit `.eq("user_id", ...)` on
 * every query below IS the boundary, not belt and braces.
 * There is deliberately no read in this file that takes an id
 * without also taking an owner.
 */

/* Everything except `content`. The bytes are large and almost
   no caller wants them, so asking for them by default would
   move a megabyte across the wire to build a list. */
const COLUMNS =
  "id, user_id, agent_id, run_id, title, filename, format, bytes, pages, row_count, sheets, degraded, created_at, expires_at";

interface DocumentRow {
  id: string;
  user_id: string;
  agent_id: string;
  run_id: string | null;
  title: string;
  filename: string;
  format: string;
  bytes: number;
  pages: number | null;
  row_count: number | null;
  sheets: number | null;
  degraded: string | null;
  created_at: string;
  expires_at: string;
}

export interface StoredDocument extends GeneratedDocument {
  agentId: string;
  runId: string | null;
  createdAt: string;
  expiresAt: string;
}

function storeError(message: string, detail: string): AiRuntimeError {
  return new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

const FORMATS: DocumentFormat[] = ["pdf", "xlsx", "docx"];

/* Normalised on the way out, the way AgentStore and MemoryStore
   both do it: a row written by an older build must not become
   an unhandled branch three files later. */
function asFormat(value: unknown): DocumentFormat {
  return FORMATS.includes(value as DocumentFormat)
    ? (value as DocumentFormat)
    : "pdf";
}

function toStored(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    agentId: row.agent_id,
    runId: row.run_id,
    title: row.title,
    filename: row.filename,
    format: asFormat(row.format),
    bytes: Number(row.bytes) || 0,
    ...(row.pages === null ? {} : { pages: Number(row.pages) }),
    ...(row.row_count === null ? {} : { rows: Number(row.row_count) }),
    ...(row.sheets === null ? {} : { sheets: Number(row.sheets) }),
    ...(row.degraded ? { degraded: row.degraded } : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/* =========================================================
   WRITING
========================================================= */

export interface PutInput {
  userId: string;
  agentId: string;
  runId?: string | null;
  title: string;
  rendered: RenderedDocument;
}

export async function put(input: PutInput): Promise<StoredDocument> {
  const { rendered } = input;

  const expiresAt = new Date(
    Date.now() + Math.max(1, documents.retentionDays) * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("agent_documents")
    .insert({
      user_id: input.userId,
      agent_id: input.agentId,
      run_id: input.runId ?? null,
      title: input.title,
      filename: rendered.filename,
      format: rendered.format,
      bytes: rendered.bytes.length,
      /* Base64 rather than bytea. See §A4 of the design doc and
         the header of migration 0018: bytea over PostgREST
         comes back in whatever `bytea_output` the session is
         set to, which makes the wire format depend on a
         database setting rather than on the code decoding it. */
      content: rendered.bytes.toString("base64"),
      pages: rendered.pages ?? null,
      row_count: rendered.rows ?? null,
      sheets: rendered.sheets ?? null,
      degraded: rendered.degraded ?? null,
      expires_at: expiresAt,
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    throw storeError(
      "The document was made but could not be saved.",
      `agent_documents insert failed: ${error.message}`
    );
  }

  if (!data) {
    throw storeError(
      "The document was made but could not be saved.",
      "agent_documents insert returned no row"
    );
  }

  /*
   * Pruned after the insert, not before, so the new document is
   * inside the count it is measured against — and so a learner
   * at their ceiling sees their newest file kept and their
   * oldest dropped, rather than their newest refused.
   *
   * The same way round FileStore.put evicts, and for the same
   * reason it gives: the older ones are by definition the ones
   * whose conversation has moved on.
   *
   * A failure here is logged and swallowed. The document
   * exists, the learner can open it, and a retention pass that
   * did not run is a thing the hourly sweep will do anyway —
   * turning it into a failed turn would be the tidying-up
   * breaking the feature.
   */
  const pruned = await supabase.rpc("agent_documents_prune", {
    p_user_id: input.userId,
    p_agent_id: input.agentId,
    p_keep_per_agent: documents.keepPerAgent,
    p_keep_per_user: documents.keepPerUser,
  });

  if (pruned.error) {
    console.error(
      `[documents] prune failed for agent ${input.agentId}: ${pruned.error.message}`
    );
  }

  return toStored(data as DocumentRow);
}

/* =========================================================
   READING
========================================================= */

/*
 * One document's metadata and its bytes, for the download
 * route.
 *
 * Null covers four cases on purpose — no such id, an expired
 * id, somebody else's id, and a malformed id — because the
 * caller can only be told one thing and telling them which
 * would be telling them that an id they guessed belongs to
 * someone. The same choice `FileStore.get` makes, and the same
 * one `DELETE /api/ai/keys/:id` makes.
 */
export async function fetchForOwner(
  userId: string,
  documentId: string
): Promise<{ meta: StoredDocument; bytes: Buffer } | null> {
  if (!documentId || documentId.length > 64) {
    return null;
  }

  const { data, error } = await supabase
    .from("agent_documents")
    .select(`${COLUMNS}, content`)
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    /*
     * A malformed uuid fails in the cast rather than matching
     * nothing, which is a 400 from PostgREST and not a fault.
     * Treated as a miss for the same reason the others are.
     */
    if (error.code === "22P02") {
      return null;
    }

    throw storeError(
      "Unable to open that document.",
      `agent_documents select failed: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  const row = data as DocumentRow & { content: string };

  /* Expiry is checked here as well as swept, so a file past its
     window is unreachable the moment it expires rather than at
     the next sweep. The FileStore rule: checked on read, swept
     on write. */
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return {
    meta: toStored(row),
    bytes: Buffer.from(row.content, "base64"),
  };
}

/* What a run produced. Read by the Test panel's history, the
   schedule run card, and — the one that matters — the mail
   outbox, which builds an email's attachment list out of this
   rather than out of anything the answer said. */
export async function listForRun(
  userId: string,
  runId: string
): Promise<StoredDocument[]> {
  const { data, error } = await supabase
    .from("agent_documents")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw storeError(
      "Unable to list that run's files.",
      `agent_documents select failed: ${error.message}`
    );
  }

  return ((data ?? []) as DocumentRow[]).map(toStored);
}

/*
 * The bytes for one document, without an owner predicate.
 *
 * The ONE function in this file that does not take a user id,
 * and it is not a hole: it is reached only from the mail drain,
 * which has already resolved the notification's owner and is
 * attaching that owner's own file to that owner's own email.
 * It takes an id the caller got from `listForRun` under a user
 * predicate, so the scoping happened one call earlier.
 *
 * It is separate rather than folded into `fetchForOwner`
 * because a function that takes an optional owner is a function
 * somebody will eventually call without one.
 */
export async function bytesForAttachment(
  documentId: string
): Promise<Buffer | null> {
  const { data, error } = await supabase
    .from("agent_documents")
    .select("content")
    .eq("id", documentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return Buffer.from((data as { content: string }).content, "base64");
}

export async function listForAgent(
  userId: string,
  agentId: string,
  limit = 20
): Promise<StoredDocument[]> {
  const { data, error } = await supabase
    .from("agent_documents")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, limit));

  if (error) {
    throw storeError(
      "Unable to list this agent's files.",
      `agent_documents select failed: ${error.message}`
    );
  }

  return ((data ?? []) as DocumentRow[]).map(toStored);
}

/* =========================================================
   RETENTION
========================================================= */

/*
 * Expired documents everywhere, and retired data records past
 * their restore window.
 *
 * Called from the scheduler tick's existing hourly branch, next
 * to the schedule sweep. No timer of its own — the argument
 * FileStore's header makes about a module that starts one on
 * import still holds, and there is already a process-level
 * service whose job is being woken up.
 */
export async function sweep(retiredDays: number): Promise<number> {
  const { data, error } = await supabase.rpc("agent_documents_sweep", {
    p_retired_days: retiredDays,
  });

  if (error) {
    throw storeError(
      "Unable to sweep expired documents.",
      `agent_documents_sweep failed: ${error.message}`
    );
  }

  return Number(data ?? 0);
}
