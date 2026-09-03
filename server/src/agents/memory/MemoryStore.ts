import { createHash } from "node:crypto";

import { supabase } from "../../lib/supabase";
import { memory } from "../../ai/config";
import { AiRuntimeError } from "../../ai/errors";
import type {
  MemoryKind,
  MemoryScopeKind,
  RecalledMemory,
} from "../../ai/types";
import { ownerOf, scopeKeyOf, subjectLabel, type MemoryScope } from "./scope";

/*
 * Everything that touches the agent_memories table.
 *
 * One rule governs the whole file, and it is the same rule
 * AgentStore states at the top of itself: the service-role
 * client bypasses RLS, so the explicit `.eq("user_id", ...)`
 * and `.eq("agent_id", ...)` on every query below are not
 * belt-and-braces. They ARE the boundary. Dropping either one
 * is not a bug that produces an error — it is a bug that
 * produces one learner reading another's memories, or one
 * agent answering out of a different agent's.
 *
 * Every function therefore takes a scope rather than an id, and
 * `scopeMatch()` below is the only place those predicates are
 * written. There is deliberately no scoped query in this file
 * that builds its own filter.
 *
 * Nothing here calls a model or an embedding provider. Writes
 * arrive with their vector already computed, or with none at
 * all — see recall.ts and write.ts for why the second case has
 * to keep working.
 */

/* Everything the owner may see. There is no column on this
   table that is not the owner's to read, but the list is
   spelled out anyway so a later column has to be added
   deliberately rather than by growing a `*`. */
const COLUMNS =
  "id, agent_id, user_id, deployment_id, subject, kind, content, fingerprint, origin, source_feature, embedding_model, use_count, revision, created_at, updated_at, last_used_at";

/* The read path never needs the vector, the fingerprint or the
   embedding model, and the vector is by far the largest thing
   on the row. Asking for it on every turn would move three
   kilobytes of floats across the wire to be thrown away. */
const RECALL_COLUMNS =
  "id, kind, content, updated_at, use_count, embedding_model";

interface MemoryRow {
  id: string;
  agent_id: string;
  user_id: string;
  deployment_id: string | null;
  subject: string;
  kind: string;
  content: string;
  fingerprint: string;
  origin: string;
  source_feature: string | null;
  embedding_model: string | null;
  use_count: number;
  revision: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

interface RecallRow {
  id: string;
  kind: string;
  content: string;
  updated_at: string;
  use_count: number;
  embedding_model: string | null;
}

interface SearchRow {
  id: string;
  kind: string;
  content: string;
  updated_at: string;
  use_count: number;
  similarity: number;
}

/*
 * One memory as the owner's Memory screen sees it.
 *
 * Carries the scope, because the screen shows the owner's own
 * memories alongside a count of what their deployment has
 * learned from other people, and a row with no way to say which
 * it is would make the second look like the first.
 */
export interface StoredMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  origin: "learned" | "manual";
  scope: MemoryScopeKind;
  /* Short label for a deployed caller, or "shared". Absent on
     the owner's own memories, which need no disambiguating. */
  subject?: string;
  useCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

function fail(message: string, detail: string): never {
  throw new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

/*
 * Normalised on the way out, the same way AgentStore does it
 * and for the same reason: a row written by an older build, or
 * by hand in the SQL editor, must not become an unhandled
 * branch three files later.
 */
const KINDS: MemoryKind[] = [
  "profile",
  "preference",
  "goal",
  "project",
  "fact",
];

export function asKind(value: unknown): MemoryKind {
  return KINDS.includes(value as MemoryKind) ? (value as MemoryKind) : "fact";
}

/*
 * The dedupe key.
 *
 * Case, punctuation and whitespace are stripped before hashing,
 * so "She is a junior." and "she is a junior" are one memory
 * rather than two. That matters more than it sounds: an
 * extraction call run on two consecutive turns about the same
 * subject will phrase the same fact slightly differently almost
 * every time, and without this the store fills with paraphrases
 * of one sentence and then evicts the things that mattered to
 * make room for them.
 *
 * It is deliberately not clever. Near-duplicate detection by
 * embedding would catch more, and would also merge two genuinely
 * different facts that happen to be about the same topic — which
 * is a worse failure, because the merged one is silently wrong
 * rather than merely redundant.
 */
export function fingerprintOf(content: string): string {
  const normalised = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return createHash("sha256").update(normalised).digest("hex").slice(0, 40);
}

/*
 * The scope predicates, written once.
 *
 * Three of them, and each one is load-bearing:
 *
 *   user_id   — one learner cannot read another's.
 *   agent_id  — one of a learner's agents cannot read another
 *               of their own. This is the predicate the whole
 *               ownership model rests on.
 *   scope_key — the owner's Builder memories and a deployed
 *               caller's are different drawers.
 *
 * Returned as one object for `.match()` rather than applied as
 * three chained `.eq()` calls, which is not a style choice: a
 * helper that took a query builder and returned it would have
 * to be generic over PostgREST's fluent type, and that type is
 * recursive enough that TypeScript gives up on it. An object is
 * also harder to use wrongly — there is no way to apply two of
 * the three.
 */
function scopeMatch(scope: MemoryScope): Record<string, string> {
  return {
    user_id: ownerOf(scope),
    agent_id: scope.agentId,
    scope_key: scopeKeyOf(scope),
  };
}

/* =========================================================
   READS
========================================================= */

/*
 * Everything in one scope, newest first.
 *
 * The ranked tier of recall, and on most turns the whole of it:
 * a scope that fits the context budget is sent in full and no
 * vector is touched at all.
 *
 * Ordered by `updated_at` rather than `created_at` on purpose.
 * A memory that was re-stated last week has been reinforced,
 * and reinforcement is the signal worth ranking on — the
 * alternative is an agent whose oldest facts are permanently
 * first in the queue however irrelevant they have become.
 *
 * Capped at `maxMemories` so a scope that somehow grew past the
 * ceiling cannot make one turn read an unbounded number of rows.
 */
export async function listForScope(
  scope: MemoryScope
): Promise<Array<RecalledMemory & { embeddingModel: string | null; useCount: number }>> {
  const { data, error } = await supabase
    .from("agent_memories")
    .select(RECALL_COLUMNS)
    .match(scopeMatch(scope))
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, memory.maxMemories));

  if (error) {
    throw new Error(`agent_memories select failed: ${error.message}`);
  }

  return ((data ?? []) as RecallRow[]).map((row) => ({
    id: row.id,
    kind: asKind(row.kind),
    content: row.content,
    updatedAt: row.updated_at,
    useCount: Number(row.use_count) || 0,
    embeddingModel: row.embedding_model,
  }));
}

/*
 * The semantic tier: the memories most like the question, out
 * of the ones the ranked tier did not already take.
 *
 * Reached only when a scope has outgrown the context budget.
 * Never called otherwise, which is why an agent with eleven
 * memories makes no embedding call at all.
 */
export async function searchScope(input: {
  scope: MemoryScope;
  embedding: string;
  embeddingModel: string;
  limit: number;
  minSimilarity: number;
  exclude: string[];
}): Promise<Array<RecalledMemory & { useCount: number }>> {
  const { data, error } = await supabase.rpc("agent_memory_search", {
    p_user_id: ownerOf(input.scope),
    p_agent_id: input.scope.agentId,
    p_scope_key: scopeKeyOf(input.scope),
    p_embedding: input.embedding,
    p_embedding_model: input.embeddingModel,
    p_limit: Math.max(1, input.limit),
    p_min_similarity: input.minSimilarity,
    p_exclude: input.exclude,
  });

  if (error) {
    throw new Error(`agent_memory_search failed: ${error.message}`);
  }

  return ((data ?? []) as SearchRow[])
    .filter((row) => typeof row.content === "string" && row.content.trim())
    .map((row) => ({
      id: row.id,
      kind: asKind(row.kind),
      content: row.content,
      updatedAt: row.updated_at,
      useCount: Number(row.use_count) || 0,
      similarity: Number(row.similarity),
    }));
}

/*
 * Everything this agent holds, across every scope, for the
 * owner's Memory screen.
 *
 * The one read in this file that deliberately crosses scopes,
 * and it is safe because it crosses them WITHIN one agent
 * belonging to one learner: the route has already resolved the
 * agent under the caller's own id, and both predicates below
 * still apply. What it does not do — and what nothing in this
 * file can do — is cross an agent boundary.
 *
 * The owner sees their deployment's memories as well as their
 * own because it is their agent, their storage and their bill,
 * and because "clear everything this agent has learned about
 * anyone" has to be a thing a person can actually do. The
 * subject is a digest, so what they see is that three different
 * people used it, not who those people are.
 */
export async function listForAgent(
  userId: string,
  agentId: string
): Promise<StoredMemory[]> {
  const { data, error } = await supabase
    .from("agent_memories")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("updated_at", { ascending: false })
    /* Bounded so a screen cannot be made to render an unbounded
       list. A scope is capped at maxMemories and a deployment
       may have several subjects, so this is generous rather
       than tight. */
    .limit(Math.max(1, memory.maxMemories) * 8);

  if (error) {
    fail(
      "Unable to load what this agent remembers.",
      `agent_memories select failed: ${error.message}`
    );
  }

  return ((data ?? []) as MemoryRow[]).map(toStored);
}

function toStored(row: MemoryRow): StoredMemory {
  const scope: MemoryScopeKind = row.deployment_id ? "deployment" : "owner";

  return {
    id: row.id,
    kind: asKind(row.kind),
    content: row.content,
    origin: row.origin === "manual" ? "manual" : "learned",
    scope,
    ...(scope === "deployment" ? { subject: subjectLabel(row.subject) } : {}),
    useCount: Number(row.use_count) || 0,
    revision: Number(row.revision) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

/* How many memories one scope holds, without loading any. Used
   to decide whether a write needs to evict first. */
export async function countScope(scope: MemoryScope): Promise<number> {
  const { count, error } = await supabase
    .from("agent_memories")
    .select("id", { count: "exact", head: true })
    .match(scopeMatch(scope));

  if (error) {
    throw new Error(`agent_memories count failed: ${error.message}`);
  }

  return count ?? 0;
}

/* =========================================================
   WRITES

   Reached from exactly one place — write.ts — and never from a
   route. What an agent remembers is a conclusion this server
   reached, so there is no path by which a request body becomes
   a memory, and no RLS write policy on the table to provide
   one.
========================================================= */

export interface MemoryDraft {
  kind: MemoryKind;
  content: string;
  /* Vector literal, or null when embedding was unavailable.
     Null is a first-class case: memory must not depend on an
     embedding provider being up. */
  embedding: string | null;
  embeddingModel: string | null;
  sourceFeature: string;
}

export interface WriteOutcome {
  id: string;
  replaced: boolean;
}

/*
 * Stores one memory, or updates the one it duplicates.
 *
 * The fingerprint is the identity: writing "they are a senior"
 * twice in one scope updates a row rather than adding one, and
 * bumps `updated_at`, which moves it back to the front of the
 * ranked tier. That is exactly the behaviour wanted — a fact
 * somebody has now said twice is a fact worth carrying.
 *
 * `replaceId` is the supersede path, and it is the one write
 * that can be influenced by model output. It is bounded hard:
 * write.ts only ever passes an id that was in the set IT sent
 * to the extraction call, so the worst a hostile conversation
 * can do is overwrite a memory the agent had already recalled
 * in that same turn, inside the caller's own scope. There is no
 * argument to this function, and no verb in the extractor's
 * vocabulary, that deletes anything.
 */
export async function upsertMemory(
  scope: MemoryScope,
  draft: MemoryDraft,
  replaceId?: string
): Promise<WriteOutcome> {
  const fingerprint = fingerprintOf(draft.content);
  const now = new Date().toISOString();

  const existing = await findByFingerprint(scope, fingerprint);

  /*
   * The same fact again. Bump it rather than writing a second
   * row — which the unique key would refuse anyway, and a
   * refusal here would fail a turn over something that is not a
   * problem.
   */
  if (existing) {
    const { error } = await supabase
      .from("agent_memories")
      .update({
        content: draft.content,
        kind: draft.kind,
        updated_at: now,
        revision: existing.revision + 1,
        ...(draft.embedding
          ? {
              embedding: draft.embedding,
              embedding_model: draft.embeddingModel,
            }
          : {}),
      })
      .eq("id", existing.id)
      .eq("user_id", ownerOf(scope));

    if (error) {
      throw new Error(`agent_memories update failed: ${error.message}`);
    }

    return { id: existing.id, replaced: true };
  }

  /*
   * Superseding a memory the agent recalled this turn. The old
   * row keeps its id and its history — the learner sees an
   * updated memory rather than one vanishing and another
   * appearing, which is the honest description of what
   * happened when somebody says they used to be a junior and
   * are now a senior.
   */
  if (replaceId) {
    const { data, error } = await supabase
      .from("agent_memories")
      .update({
        content: draft.content,
        kind: draft.kind,
        fingerprint,
        updated_at: now,
        ...(draft.embedding
          ? {
              embedding: draft.embedding,
              embedding_model: draft.embeddingModel,
            }
          : { embedding: null, embedding_model: null }),
      })
      .eq("id", replaceId)
      .match(scopeMatch(scope))
      .select("id, revision");

    if (error) {
      throw new Error(`agent_memories supersede failed: ${error.message}`);
    }

    const row = (data ?? [])[0] as { id: string } | undefined;

    if (row) {
      /* The revision bump is a second statement rather than an
         expression because PostgREST has no way to say
         `revision = revision + 1` in an update body. */
      await bumpRevision(scope, row.id);
      return { id: row.id, replaced: true };
    }

    /*
     * The id did not resolve inside this scope. Reachable when
     * the extraction call invented an ordinal, or when the
     * memory was deleted between the recall and the write. Not
     * an error: fall through and store it as new, which is what
     * the model was trying to express anyway.
     */
  }

  await evictIfFull(scope);

  const { data, error } = await supabase
    .from("agent_memories")
    .insert({
      agent_id: scope.agentId,
      user_id: ownerOf(scope),
      deployment_id: scope.kind === "deployment" ? scope.deploymentId : null,
      subject: scope.kind === "deployment" ? scope.subject : "",
      kind: draft.kind,
      content: draft.content,
      fingerprint,
      origin: "learned",
      source_feature: draft.sourceFeature,
      embedding: draft.embedding,
      embedding_model: draft.embeddingModel,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`agent_memories insert failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("agent_memories insert returned no row.");
  }

  return { id: (data as { id: string }).id, replaced: false };
}

async function findByFingerprint(
  scope: MemoryScope,
  fingerprint: string
): Promise<{ id: string; revision: number } | null> {
  const { data, error } = await supabase
    .from("agent_memories")
    .select("id, revision")
    .match(scopeMatch(scope))
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (error) {
    throw new Error(`agent_memories fingerprint lookup failed: ${error.message}`);
  }

  return data ? (data as { id: string; revision: number }) : null;
}

async function bumpRevision(scope: MemoryScope, id: string): Promise<void> {
  const { data } = await supabase
    .from("agent_memories")
    .select("revision")
    .match(scopeMatch(scope))
    .eq("id", id)
    .maybeSingle();

  const revision = Number((data as { revision?: number } | null)?.revision ?? 1);

  await supabase
    .from("agent_memories")
    .update({ revision: revision + 1 })
    .eq("id", id)
    .eq("user_id", ownerOf(scope));
}

/*
 * Makes room, when the scope is at its ceiling.
 *
 * Evicts rather than refusing, and the choice matters. A
 * refusal means an agent that silently stops learning at some
 * point months from now that its owner never sees and cannot
 * diagnose. Eviction means it forgot the thing it had not used
 * in longest — which is what a person expects from something
 * called memory, and which the Memory screen shows them
 * happening.
 *
 * Least recently USED, not least recently written. A memory
 * that keeps being carried into prompts is a memory that keeps
 * being useful, however old it is; `last_used_at` is null for
 * one that has never been carried, and nulls sort first here,
 * which is correct — something written once and never recalled
 * is the best thing to lose.
 */
async function evictIfFull(scope: MemoryScope): Promise<void> {
  const held = await countScope(scope);
  const ceiling = Math.max(1, memory.maxMemories);

  if (held < ceiling) {
    return;
  }

  const { data, error } = await supabase
    .from("agent_memories")
    .select("id")
    .match(scopeMatch(scope))
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: true })
    .limit(held - ceiling + 1);

  if (error) {
    throw new Error(`agent_memories eviction select failed: ${error.message}`);
  }

  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);

  if (ids.length === 0) {
    return;
  }

  const { error: removeError } = await supabase
    .from("agent_memories")
    .delete()
    .in("id", ids)
    .eq("user_id", ownerOf(scope))
    .eq("agent_id", scope.agentId);

  if (removeError) {
    throw new Error(`agent_memories eviction failed: ${removeError.message}`);
  }
}

/*
 * Records that these memories were actually carried into a
 * prompt.
 *
 * Fire and forget from the caller's point of view — see
 * recall.ts. A failure here costs nothing but slightly worse
 * ranking later, and an answer must never be delayed or refused
 * because a counter did not increment.
 *
 * `last_used_at` is what eviction sorts on and `use_count` is
 * what breaks ties in the ranked tier, so between them this is
 * the whole of the reinforcement signal.
 */
/*
 * Attaches a vector to a memory that was written without one.
 *
 * The second half of the write, and it runs after the answer
 * has already been reported — see write.ts. Splitting it out is
 * what stops the slowest part of remembering (a provider round
 * trip) from delaying the moment a memory becomes usable: a row
 * with no vector is already reachable through the ranked tier
 * of recall, which is the tier that carries it in the common
 * case anyway.
 *
 * Scoped like every other write here. A backfill that ran
 * against an id alone would be a write with no ownership
 * predicate on it, which is the one thing this file does not
 * have.
 */
export async function attachEmbedding(
  scope: MemoryScope,
  memoryId: string,
  embedding: string,
  embeddingModel: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_memories")
    .update({ embedding, embedding_model: embeddingModel })
    .eq("id", memoryId)
    .match(scopeMatch(scope));

  if (error) {
    throw new Error(`agent_memories embedding update failed: ${error.message}`);
  }
}

export async function touch(
  scope: MemoryScope,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const { data, error } = await supabase
    .from("agent_memories")
    .select("id, use_count")
    .match(scopeMatch(scope))
    .in("id", ids);

  if (error) {
    throw new Error(`agent_memories touch select failed: ${error.message}`);
  }

  const now = new Date().toISOString();

  /*
   * One statement per row, because PostgREST cannot express
   * `use_count = use_count + 1` and cannot update rows to
   * different values in one call. Bounded by the recall budget
   * — at most a dozen — and it happens off the answer's path.
   */
  await Promise.all(
    ((data ?? []) as Array<{ id: string; use_count: number }>).map((row) =>
      supabase
        .from("agent_memories")
        .update({
          use_count: (Number(row.use_count) || 0) + 1,
          last_used_at: now,
        })
        .eq("id", row.id)
        .eq("user_id", ownerOf(scope))
    )
  );
}

/* =========================================================
   OWNER-FACING DELETION

   The only mutations a request can cause, and both of them
   remove rather than add. That asymmetry is the security model
   stated as an API: a person can delete a memory, and nothing —
   no conversation, no document, no web page, no model output —
   can.
========================================================= */

/*
 * Forgets one memory.
 *
 * False for both "no such memory" and "not this agent's",
 * deliberately. The route turns that into a 404, which is the
 * only thing another agent's id should ever look like — the
 * same choice DELETE /api/ai/keys/:id makes.
 */
export async function deleteMemory(
  userId: string,
  agentId: string,
  memoryId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_memories")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .select("id");

  if (error) {
    fail(
      "Unable to forget that memory.",
      `agent_memories delete failed: ${error.message}`
    );
  }

  return (data ?? []).length > 0;
}

export type ClearTarget = "owner" | "deployment" | "all";

/*
 * Forgets everything, or everything on one side.
 *
 * Three targets because they are three different intentions. A
 * learner clearing their own memories is starting over with
 * their own agent; clearing the deployment's is erasing what
 * strangers told it, which is a data-protection action they may
 * have to take on somebody else's behalf; and "all" is what the
 * button on the Memory screen does.
 */
export async function clearMemories(
  userId: string,
  agentId: string,
  target: ClearTarget
): Promise<number> {
  let query = supabase
    .from("agent_memories")
    .delete()
    .eq("user_id", userId)
    .eq("agent_id", agentId);

  if (target === "owner") {
    query = query.is("deployment_id", null);
  } else if (target === "deployment") {
    query = query.not("deployment_id", "is", null);
  }

  const { data, error } = await query.select("id");

  if (error) {
    fail(
      "Unable to clear this agent's memory.",
      `agent_memories clear failed: ${error.message}`
    );
  }

  return (data ?? []).length;
}
