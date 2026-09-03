import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";
import { dataStore as config } from "../../ai/config";

import { isValidKey } from "./keys";
import { agentOf, ownerOf, scopeKeyOf, type DataScope } from "./scope";

/*
 * Everything that touches the agent_data table.
 *
 * One rule governs the whole file, and it is the rule
 * MemoryStore states at the top of itself: the service-role
 * client bypasses RLS, so the explicit `user_id`, `agent_id`
 * and `scope_key` predicates below are not belt and braces.
 * THEY ARE THE BOUNDARY. Dropping any one of them is not a bug
 * that produces an error — it is a bug that produces one
 * learner reading another's records, or one agent computing
 * from a different agent's.
 *
 * Every function therefore takes a scope rather than an id, and
 * `scopeMatch()` below is the only place those predicates are
 * written. There is deliberately no scoped query in this file
 * that builds its own filter, and no read that takes a key
 * without also taking a scope.
 *
 * THE ONE PLACE THIS DIVERGES FROM MEMORY ON PURPOSE: at the
 * ceiling, a write is REFUSED rather than making room.
 * `MemoryStore.evictIfFull` drops the least recently used row,
 * because a memory is the machine's own inference and
 * forgetting the thing it has not needed in longest is what a
 * person expects from something called memory. These are
 * records the owner asked the agent to keep. Silently dropping
 * the oldest row of a running log is data loss its owner never
 * sees and cannot diagnose — and in a log, the oldest row is
 * the one with the most history behind it. A refusal is
 * something a person can act on; an eviction is not.
 */

const COLUMNS =
  "id, agent_id, user_id, key, value, label, revision, deleted_at, created_at, updated_at";

/* The read path the model reaches never needs timestamps or the
   revision, and `data_list` never needs the value at all. */
const LIST_COLUMNS = "key, label, updated_at, value";

interface DataRow {
  id: string;
  agent_id: string;
  user_id: string;
  key: string;
  value: string;
  label: string | null;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/* One record as the owner's Data screen sees it. */
export interface StoredRecord {
  id: string;
  key: string;
  value: string;
  label: string | null;
  revision: number;
  /* Present on a retired record, which the screen offers to
     restore until the sweep takes it. */
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* What `data_list` hands the model: names and sizes, never
   contents. A listing that carried values would make one step
   able to pull the whole store into the prompt, which is what
   the per-result budget exists to prevent. */
export interface RecordSummary {
  key: string;
  label: string | null;
  chars: number;
  updatedAt: string;
}

function storeError(message: string, detail: string): AiRuntimeError {
  return new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

/*
 * The scope predicates, written once.
 *
 * Three of them, and each is load-bearing:
 *
 *   user_id   — one learner cannot read another's.
 *   agent_id  — one of a learner's agents cannot read another
 *               of their own. The predicate the whole ownership
 *               model rests on.
 *   scope_key — the owner's records and a deployed caller's
 *               would be different drawers. Applied today even
 *               though only one kind is ever constructed,
 *               because a filter added later is a filter
 *               somebody forgets on one query.
 *
 * Returned as one object for `.match()` rather than as three
 * chained `.eq()` calls, for the reason MemoryStore gives: a
 * helper taking and returning PostgREST's fluent builder would
 * have to be generic over a type TypeScript gives up on, and an
 * object is harder to use wrongly — there is no way to apply
 * two of the three.
 */
function scopeMatch(scope: DataScope): Record<string, string> {
  return {
    user_id: ownerOf(scope),
    agent_id: agentOf(scope),
    scope_key: scopeKeyOf(scope),
  };
}

/* =========================================================
   KEYS

   Validated in keys.ts, which is a leaf module importing
   nothing but config — see its header for why that separation
   is load-bearing rather than tidy, and for the argument about
   why a key's charset is a security decision.

   Re-exported here so a caller that already has the store does
   not need a second import for the validator that guards it.
========================================================= */

export { isValidKey, explainKey } from "./keys";

/* =========================================================
   READS
========================================================= */

export async function getRecord(
  scope: DataScope,
  key: string
): Promise<StoredRecord | null> {
  const { data, error } = await supabase
    .from("agent_data")
    .select(COLUMNS)
    .match(scopeMatch(scope))
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw storeError(
      "Unable to read that record.",
      `agent_data select failed: ${error.message}`
    );
  }

  return data ? toStored(data as DataRow) : null;
}

/*
 * The keys in a scope, newest first, optionally under a prefix.
 *
 * The prefix is escaped before it reaches `like`, which is the
 * one place a model-written string becomes part of a query
 * pattern. PostgREST parameterises the value, so this is not
 * about injection — it is that `%` and `_` are wildcards in
 * LIKE, and a key containing one would otherwise match records
 * it does not name. `_` in particular is a legal key character
 * and would silently match any character at that position.
 */
export async function listRecords(
  scope: DataScope,
  options: { prefix?: string; limit?: number } = {}
): Promise<RecordSummary[]> {
  let query = supabase
    .from("agent_data")
    .select(LIST_COLUMNS)
    .match(scopeMatch(scope))
    .is("deleted_at", null);

  if (options.prefix) {
    const escaped = options.prefix.replace(/[\\%_]/g, (match) => `\\${match}`);
    query = query.like("key", `${escaped}%`);
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, options.limit ?? config.maxRecords));

  if (error) {
    throw storeError(
      "Unable to list this agent's records.",
      `agent_data select failed: ${error.message}`
    );
  }

  return (
    (data ?? []) as Array<{
      key: string;
      label: string | null;
      updated_at: string;
      value: string;
    }>
  ).map((row) => ({
    key: row.key,
    label: row.label,
    chars: row.value.length,
    updatedAt: row.updated_at,
  }));
}

/*
 * The keys that go into the action block, alphabetically.
 *
 * Alphabetical rather than newest-first, and that is not a
 * cosmetic choice: prefixed keys sort together, so an agent
 * reading the block sees `habits/2026-09-01` next to
 * `habits/2026-09-02` and can infer the convention it was using
 * last week. Recency ordering would scatter them.
 */
export async function indexKeys(scope: DataScope): Promise<string[]> {
  if (config.indexKeys <= 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("agent_data")
    .select("key")
    .match(scopeMatch(scope))
    .is("deleted_at", null)
    .order("key", { ascending: true })
    .limit(config.indexKeys);

  if (error) {
    throw storeError(
      "Unable to read this agent's records.",
      `agent_data select failed: ${error.message}`
    );
  }

  /*
   * Filtered against the validator on the way OUT as well as on
   * the way in.
   *
   * The CHECK constraint means a row cannot hold a key this
   * rejects, so this can never drop anything — which is exactly
   * why it is cheap enough to keep. It is the last line before
   * a stored string enters the system prompt, and a row written
   * by hand in the SQL Editor, or by a build whose validator
   * was weaker, must not be the thing that gets there.
   */
  return ((data ?? []) as Array<{ key: string }>)
    .map((row) => row.key)
    .filter((key) => isValidKey(key));
}

/* Everything, including retired rows, for the owner's screen. */
export async function listForOwner(
  userId: string,
  agentId: string
): Promise<StoredRecord[]> {
  const { data, error } = await supabase
    .from("agent_data")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, config.maxRecords) * 2)
    .returns<DataRow[]>();

  if (error) {
    throw storeError(
      "Unable to load this agent's records.",
      `agent_data select failed: ${error.message}`
    );
  }

  return (data ?? []).map(toStored);
}

export interface StoreUsage {
  records: number;
  chars: number;
  maxRecords: number;
  maxChars: number;
}

export async function usage(scope: DataScope): Promise<StoreUsage> {
  const { data, error } = await supabase
    .from("agent_data")
    .select("value, key")
    .match(scopeMatch(scope))
    .is("deleted_at", null);

  if (error) {
    throw storeError(
      "Unable to measure this agent's records.",
      `agent_data select failed: ${error.message}`
    );
  }

  const rows = (data ?? []) as Array<{ value: string; key: string }>;

  return {
    records: rows.length,
    chars: rows.reduce((sum, row) => sum + row.value.length + row.key.length, 0),
    maxRecords: config.maxRecords,
    maxChars: config.maxTotalChars,
  };
}

function toStored(row: DataRow): StoredRecord {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    label: row.label,
    revision: Number(row.revision) || 1,
    retiredAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* =========================================================
   WRITES
========================================================= */

export type PutStatus =
  | "created"
  | "updated"
  | "restored"
  | "full_records"
  | "full_chars";

export interface PutResult {
  status: PutStatus;
  records: number;
  chars: number;
  revision: number;
}

/*
 * Stores one record, or updates the one it names.
 *
 * Through a database function rather than a select-then-insert,
 * for the reason `agent_schedule_settle` is one statement: the
 * cap check and the write must not be separable. Two API
 * processes writing the two-hundredth record simultaneously
 * would each read 199 and each insert, and the store would sit
 * one over its ceiling for ever — quietly, since nothing reads
 * a ceiling except the thing that just passed it.
 *
 * Returns a status rather than throwing on a full store,
 * because "your store is full" is a message the agent has to be
 * able to read and pass on to a person. A refusal that arrives
 * as an exception is a failed turn; one that arrives as a
 * result is a sentence the learner gets to act on.
 */
export async function putRecord(
  scope: DataScope,
  key: string,
  value: string,
  label?: string
): Promise<PutResult> {
  const { data, error } = await supabase.rpc("agent_data_put", {
    p_user_id: ownerOf(scope),
    p_agent_id: agentOf(scope),
    p_key: key,
    p_value: value,
    p_label: label ?? null,
    p_max_records: config.maxRecords,
    p_max_total_chars: config.maxTotalChars,
    p_deployment_id: scope.kind === "deployment" ? scope.deploymentId : null,
    p_subject: scope.kind === "deployment" ? scope.subject : "",
  });

  if (error) {
    throw storeError(
      "Unable to save that record.",
      `agent_data_put failed: ${error.message}`
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: string; records: number; total_chars: number; revision: number }
    | undefined;

  if (!row) {
    throw storeError(
      "Unable to save that record.",
      "agent_data_put returned no row"
    );
  }

  return {
    status: row.status as PutStatus,
    records: Number(row.records) || 0,
    chars: Number(row.total_chars) || 0,
    revision: Number(row.revision) || 0,
  };
}

/*
 * Retires a record. Soft, and that is a doctrine rather than a
 * detail.
 *
 * MemoryStore's deletion section states the rule this codebase
 * holds to: a person can delete a memory, and nothing — no
 * conversation, no document, no web page, no model output —
 * can. A habit tracker in which nothing can ever be removed is
 * broken, so this feature needs a delete the agent may call.
 *
 * The resolution is that model output may RETIRE a record — it
 * stops counting against the caps, stops appearing in every
 * read above, and is swept a week later — and only a person
 * DESTROYS one, from the Data screen, where retired records are
 * listed with a Restore button until then.
 *
 * So the doctrine is intact. What the model got was a verb that
 * is not destruction.
 */
export async function retireRecord(
  scope: DataScope,
  key: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_data")
    .update({ deleted_at: new Date().toISOString() })
    .match(scopeMatch(scope))
    .eq("key", key)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    throw storeError(
      "Unable to remove that record.",
      `agent_data retire failed: ${error.message}`
    );
  }

  return (data ?? []).length > 0;
}

/* =========================================================
   OWNER-FACING MUTATIONS

   The only writes a request can cause, and the asymmetry is the
   security model stated as an API: a person can edit, restore
   and destroy a record, and nothing a model writes can destroy
   one.
========================================================= */

export async function restoreRecord(
  userId: string,
  agentId: string,
  recordId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_data")
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq("id", recordId)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .not("deleted_at", "is", null)
    .select("id");

  if (error) {
    throw storeError(
      "Unable to restore that record.",
      `agent_data restore failed: ${error.message}`
    );
  }

  return (data ?? []).length > 0;
}

/*
 * Destroys one record.
 *
 * False for both "no such record" and "not this agent's",
 * deliberately. The route turns that into a 404, which is the
 * only thing another agent's id should ever look like — the
 * same choice `deleteMemory` makes.
 */
export async function destroyRecord(
  userId: string,
  agentId: string,
  recordId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_data")
    .delete()
    .eq("id", recordId)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .select("id");

  if (error) {
    throw storeError(
      "Unable to delete that record.",
      `agent_data delete failed: ${error.message}`
    );
  }

  return (data ?? []).length > 0;
}

export async function clearRecords(
  userId: string,
  agentId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("agent_data")
    .delete()
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .select("id");

  if (error) {
    throw storeError(
      "Unable to clear this agent's records.",
      `agent_data clear failed: ${error.message}`
    );
  }

  return (data ?? []).length;
}
