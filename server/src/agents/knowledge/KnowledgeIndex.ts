import { supabase } from "../../lib/supabase";
import { retrieval } from "../../ai/config";
import {
  embed,
  noEmbeddingModelError,
  resolveEmbedding,
  toVectorLiteral,
} from "../../ai/EmbeddingRuntime";
import { embeddingModelKey } from "../../ai/embeddingModels";
import { AiRuntimeError, normalizeError } from "../../ai/errors";
import type { AgentRecord } from "../AgentStore";
import { listKnowledge } from "../AgentStore";
import {
  chunkText,
  contentHash,
  defaultChunkOptions,
  type ChunkOptions,
} from "./chunk";

/*
 * Making an agent's knowledge searchable.
 *
 * The write half of retrieval: text in, chunks and vectors out,
 * one state row per entry saying what happened.
 *
 * Three rules hold everywhere below, and between them they are
 * the whole safety story of this file.
 *
 * Nothing is ever destroyed. An entry that cannot be indexed —
 * because the provider is down, because the owner's only API
 * key is one that cannot embed, because a batch failed halfway
 * — keeps `agent_knowledge.status = 'inline'`, which means both
 * composers keep pasting it into the system prompt exactly as
 * they did before this phase existed. Failure here is a
 * no-op, not a loss.
 *
 * Ownership is an explicit predicate, not a policy. This module
 * runs on the service role, which bypasses RLS, so the
 * `.eq("user_id", ...)` on every query is the only thing
 * standing between one learner and another's — the same rule
 * CredentialStore and DeploymentStore state.
 *
 * Every vector costs money, so nothing is embedded twice. The
 * content hash proves a set of chunks still matches its text,
 * and a chunk count proves it was embedded by the model about
 * to be searched with. Both have to be true for an entry to be
 * skipped, and skipping is the common case: a learner saving a
 * typo fix re-embeds one entry, not their whole library.
 */

export type IndexState =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed"
  | "unsupported";

/* What the Builder is told about one entry. */
export interface KnowledgeEntryState {
  knowledgeId: string;
  title: string;
  charCount: number;
  position: number;
  state: IndexState;
  chunkCount: number;
  indexedAt: string | null;
  /* Written for the owner. Never reaches an external caller. */
  error: string | null;
  /*
   * True while this entry is still being pasted into the system
   * prompt in full rather than retrieved. Read from
   * agent_knowledge.status, which is the column both composers
   * actually branch on — so this is the truth about behaviour
   * rather than a second opinion about it.
   */
  inline: boolean;
}

export interface KnowledgeStatus {
  /* Null when this agent's power source cannot embed at all. */
  embeddingModel: {
    id: string;
    displayName: string;
    provider: string;
  } | null;
  /* Why not, when it cannot. Written for the owner. */
  unavailableReason: string | null;
  retrievalEnabled: boolean;
  entries: KnowledgeEntryState[];
  /* Entries that still need work. Zero means fully indexed. */
  pending: number;
  totalChunks: number;
}

export interface IndexOutcome extends KnowledgeStatus {
  /* Entries this call actually embedded. */
  indexed: number;
  /*
   * Entries left for a follow-up call, because this one hit its
   * chunk budget. The client loops while this is above zero.
   */
  remaining: number;
}

interface IndexRow {
  knowledge_id: string;
  agent_id: string;
  user_id: string;
  state: string;
  embedding_model: string | null;
  chunk_count: number;
  content_hash: string | null;
  error: string | null;
  claimed_at: string | null;
  indexed_at: string | null;
}

const INDEX_COLUMNS =
  "knowledge_id, agent_id, user_id, state, embedding_model, chunk_count, content_hash, error, claimed_at, indexed_at";

export const RETRIEVAL_CAPABILITY = "knowledge_retrieval";

export function retrievalEnabledFor(agent: AgentRecord): boolean {
  return agent.capabilities.includes(RETRIEVAL_CAPABILITY);
}

function fail(message: string, detail: string): never {
  throw new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

function asState(value: unknown): IndexState {
  return value === "indexing" ||
    value === "indexed" ||
    value === "failed" ||
    value === "unsupported"
    ? value
    : "pending";
}

/* =========================================================
   STATE
========================================================= */

async function readIndexRows(
  userId: string,
  agentId: string
): Promise<Map<string, IndexRow>> {
  const { data, error } = await supabase
    .from("agent_knowledge_index")
    .select(INDEX_COLUMNS)
    .eq("agent_id", agentId)
    .eq("user_id", userId);

  if (error) {
    fail(
      "Unable to load this agent's knowledge index.",
      `agent_knowledge_index select failed: ${error.message}`
    );
  }

  return new Map(
    ((data ?? []) as IndexRow[]).map((row) => [row.knowledge_id, row])
  );
}

async function writeIndexRow(row: {
  knowledgeId: string;
  agentId: string;
  userId: string;
  state: IndexState;
  embeddingModel?: string | null;
  chunkCount?: number;
  contentHash?: string | null;
  error?: string | null;
  claimedAt?: string | null;
  indexedAt?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("agent_knowledge_index").upsert(
    {
      knowledge_id: row.knowledgeId,
      agent_id: row.agentId,
      user_id: row.userId,
      state: row.state,
      embedding_model: row.embeddingModel ?? null,
      chunk_count: row.chunkCount ?? 0,
      content_hash: row.contentHash ?? null,
      error: row.error ?? null,
      claimed_at: row.claimedAt ?? null,
      indexed_at: row.indexedAt ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "knowledge_id" }
  );

  if (error) {
    fail(
      "Unable to record this agent's knowledge index.",
      `agent_knowledge_index upsert failed: ${error.message}`
    );
  }
}

/*
 * Flips the column both composers branch on.
 *
 * `indexed` means "this entry now arrives through retrieval, so
 * stop pasting it into every prompt". `inline` means the
 * opposite, and is what every failure path sets — which is why
 * a broken index degrades to the old behaviour instead of to an
 * agent that has forgotten what it knew.
 */
async function setEntryStatus(
  userId: string,
  knowledgeId: string,
  status: "inline" | "indexed"
): Promise<void> {
  const { error } = await supabase
    .from("agent_knowledge")
    .update({ status })
    .eq("id", knowledgeId)
    .eq("user_id", userId);

  if (error) {
    fail(
      "Unable to update this agent's knowledge.",
      `agent_knowledge status update failed: ${error.message}`
    );
  }
}

/* =========================================================
   CHUNK STORAGE
========================================================= */

async function countChunks(
  userId: string,
  knowledgeId: string,
  modelKey: string
): Promise<number> {
  const { count, error } = await supabase
    .from("agent_knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("knowledge_id", knowledgeId)
    .eq("user_id", userId)
    .eq("embedding_model", modelKey);

  if (error) {
    fail(
      "Unable to read this agent's knowledge index.",
      `agent_knowledge_chunks count failed: ${error.message}`
    );
  }

  return count ?? 0;
}

/*
 * Clears an entry's chunks, for one embedding model or for all
 * of them.
 *
 * All of them when the text has changed, because chunks from
 * every model are then describing something that no longer
 * exists. Just one when only the model has changed, because the
 * others are still perfectly good descriptions of the same
 * text — which is what makes switching an agent between
 * BuildGentic's AI and its owner's and back again free the second
 * time.
 */
async function clearChunks(
  userId: string,
  knowledgeId: string,
  modelKey?: string
): Promise<void> {
  let query = supabase
    .from("agent_knowledge_chunks")
    .delete()
    .eq("knowledge_id", knowledgeId)
    .eq("user_id", userId);

  if (modelKey) {
    query = query.eq("embedding_model", modelKey);
  }

  const { error } = await query;

  if (error) {
    fail(
      "Unable to update this agent's knowledge index.",
      `agent_knowledge_chunks delete failed: ${error.message}`
    );
  }
}

async function insertChunks(
  rows: Array<{
    knowledge_id: string;
    agent_id: string;
    user_id: string;
    ordinal: number;
    content: string;
    char_count: number;
    embedding: string;
    embedding_model: string;
  }>
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from("agent_knowledge_chunks").insert(rows);

  if (error) {
    fail(
      "Unable to store this agent's knowledge index.",
      `agent_knowledge_chunks insert failed: ${error.message}`
    );
  }
}

/* =========================================================
   READING THE STATE
========================================================= */

export async function knowledgeStatus(
  userId: string,
  agent: AgentRecord
): Promise<KnowledgeStatus> {
  const entries = await listKnowledge(userId, agent.id);
  const rows = await readIndexRows(userId, agent.id);

  let embeddingModel: KnowledgeStatus["embeddingModel"] = null;
  let unavailableReason: string | null = null;
  let modelKey: string | null = null;

  try {
    const resolved = await resolveEmbedding(userId);

    if (resolved.model) {
      modelKey = embeddingModelKey(resolved.model);
      embeddingModel = {
        id: resolved.model.id,
        displayName: resolved.model.displayName,
        provider: resolved.model.provider,
      };
    } else {
      unavailableReason = noEmbeddingModelError(resolved.source).message;
    }
  } catch (error) {
    /*
     * A BYOK power source with no keys at all throws rather than
     * returning null. That is not an error to propagate here —
     * "this agent cannot index yet" is a perfectly good status,
     * and the Builder shows it as a sentence rather than a
     * failed request.
     */
    unavailableReason = normalizeError(error).message;
  }

  const states: KnowledgeEntryState[] = entries.map((entry) => {
    const row = rows.get(entry.id);
    const empty = entry.content.trim().length === 0;

    let state = asState(row?.state);

    /*
     * Indexed by a model this agent can no longer reach — almost
     * always because its power source moved. The chunks are
     * still there and still valid for that model, but they
     * cannot answer a question embedded by this one, so the
     * honest state is "needs indexing" rather than "indexed".
     */
    if (
      state === "indexed" &&
      modelKey &&
      row?.embedding_model &&
      row.embedding_model !== modelKey
    ) {
      state = "pending";
    }

    if (!modelKey && !empty) {
      state = "unsupported";
    }

    return {
      knowledgeId: entry.id,
      title: entry.title,
      charCount: entry.charCount,
      position: entry.position,
      state,
      chunkCount: Number(row?.chunk_count ?? 0),
      indexedAt: row?.indexed_at ?? null,
      error: row?.error ?? unavailableReason,
      inline: entry.status !== "indexed",
    };
  });

  return {
    embeddingModel,
    unavailableReason,
    retrievalEnabled: retrievalEnabledFor(agent),
    entries: states,
    pending: states.filter(
      (entry) =>
        entry.charCount > 0 &&
        (entry.state === "pending" || entry.state === "indexing")
    ).length,
    totalChunks: states.reduce((total, entry) => total + entry.chunkCount, 0),
  };
}

/* =========================================================
   INDEXING
========================================================= */

export interface IndexOptions {
  /* Re-embeds everything, even entries whose hash still
     matches. The Builder's "Re-index" button. */
  force?: boolean;
  signal?: AbortSignal;
}

/*
 * A claim another request made and has not finished.
 *
 * Two tabs pressing Save at the same moment is the ordinary
 * case. Ten minutes would match the usage reaper, but an
 * indexing run is seconds rather than minutes, so a shorter
 * window means a genuinely crashed run blocks its entry for
 * two minutes rather than for ten.
 */
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

function claimIsLive(row: IndexRow | undefined): boolean {
  if (!row || row.state !== "indexing" || !row.claimed_at) {
    return false;
  }

  return Date.now() - Date.parse(row.claimed_at) < CLAIM_TIMEOUT_MS;
}

export async function indexAgent(
  userId: string,
  agent: AgentRecord,
  options: IndexOptions = {}
): Promise<IndexOutcome> {
  const entries = await listKnowledge(userId, agent.id);
  const rows = await readIndexRows(userId, agent.id);

  const resolved = await resolveEmbedding(userId).catch(
    (error: unknown) => ({ source: null, model: null, error })
  );

  /* ----- nothing here can embed ----- */

  if (!("model" in resolved) || !resolved.model) {
    const reason =
      "error" in resolved
        ? normalizeError(resolved.error).message
        : noEmbeddingModelError(resolved.source!).message;

    /*
     * Every entry is marked unsupported and every entry is put
     * back to `inline`. The agent keeps working; it simply keeps
     * working the old way, and its owner is told exactly why in
     * a sentence naming what they could connect.
     */
    for (const entry of entries) {
      await writeIndexRow({
        knowledgeId: entry.id,
        agentId: agent.id,
        userId,
        state: "unsupported",
        error: reason,
      });

      if (entry.status !== "inline") {
        await setEntryStatus(userId, entry.id, "inline");
      }
    }

    return {
      ...(await knowledgeStatus(userId, agent)),
      indexed: 0,
      remaining: 0,
    };
  }

  const model = resolved.model;
  const modelKey = embeddingModelKey(model);
  const chunkOptions: ChunkOptions = defaultChunkOptions(model.maxInputChars);

  let indexed = 0;
  let remaining = 0;
  let chunkBudget = Math.max(1, retrieval.maxChunksPerRequest);

  for (const entry of entries) {
    const row = rows.get(entry.id);

    /* Somebody else is already on it. */
    if (claimIsLive(row) && !options.force) {
      remaining += 1;
      continue;
    }

    /* ----- empty entries ----- */

    if (entry.content.trim().length === 0) {
      await clearChunks(userId, entry.id);
      await writeIndexRow({
        knowledgeId: entry.id,
        agentId: agent.id,
        userId,
        state: "indexed",
        embeddingModel: modelKey,
        chunkCount: 0,
        contentHash: contentHash({
          title: entry.title,
          content: entry.content,
          options: chunkOptions,
        }),
        indexedAt: new Date().toISOString(),
      });

      /*
       * Left inline. An empty entry contributes nothing either
       * way, and marking it `indexed` would make the Builder
       * claim a document is searchable when there is nothing in
       * it to search.
       */
      if (entry.status !== "inline") {
        await setEntryStatus(userId, entry.id, "inline");
      }

      continue;
    }

    const hash = contentHash({
      title: entry.title,
      content: entry.content,
      options: chunkOptions,
    });

    const textUnchanged = row?.content_hash === hash;

    /* ----- already current ----- */

    if (!options.force && textUnchanged) {
      /*
       * The text has not moved. Whether this is finished depends
       * only on whether vectors exist for the model about to be
       * searched with — which is a count, not an embedding, so
       * checking costs nothing and switching an agent back to a
       * previous power source re-uses what is already there.
       */
      const existing = await countChunks(userId, entry.id, modelKey);

      if (existing > 0) {
        await writeIndexRow({
          knowledgeId: entry.id,
          agentId: agent.id,
          userId,
          state: "indexed",
          embeddingModel: modelKey,
          chunkCount: existing,
          contentHash: hash,
          indexedAt: row?.indexed_at ?? new Date().toISOString(),
        });

        if (entry.status !== "indexed") {
          await setEntryStatus(userId, entry.id, "indexed");
        }

        continue;
      }
    }

    const chunks = chunkText(entry.content, chunkOptions);

    if (chunks.length === 0) {
      remaining += 1;
      continue;
    }

    /*
     * The budget stops one request from running until a proxy
     * gives up on it. An entry is never split across two calls —
     * a half-embedded entry would be a half-answered agent — so
     * the first entry always runs even if it is over budget on
     * its own, and everything after it waits for the next call.
     */
    if (chunks.length > chunkBudget && indexed > 0) {
      remaining += 1;
      continue;
    }

    await writeIndexRow({
      knowledgeId: entry.id,
      agentId: agent.id,
      userId,
      state: "indexing",
      embeddingModel: modelKey,
      chunkCount: row?.chunk_count ?? 0,
      contentHash: row?.content_hash ?? null,
      claimedAt: new Date().toISOString(),
      indexedAt: row?.indexed_at ?? null,
    });

    try {
      const outcome = await embed({
        userId,
        texts: chunks.map((chunk) => chunk.content),
        purpose: "document",
        feature: "agent_index",
        agentId: agent.id,
        signal: options.signal,
      });

      /*
       * Old chunks go before new ones arrive. All models' when
       * the text changed, this model's when it did not — see
       * clearChunks.
       */
      await clearChunks(
        userId,
        entry.id,
        textUnchanged ? outcome.modelKey : undefined
      );

      await insertChunks(
        chunks.map((chunk, index) => ({
          knowledge_id: entry.id,
          agent_id: agent.id,
          user_id: userId,
          ordinal: chunk.ordinal,
          content: chunk.content,
          char_count: chunk.content.length,
          embedding: toVectorLiteral(outcome.vectors[index]),
          embedding_model: outcome.modelKey,
        }))
      );

      await writeIndexRow({
        knowledgeId: entry.id,
        agentId: agent.id,
        userId,
        state: "indexed",
        embeddingModel: outcome.modelKey,
        chunkCount: chunks.length,
        contentHash: hash,
        indexedAt: new Date().toISOString(),
      });

      /* Only now does the composer stop inlining it. */
      await setEntryStatus(userId, entry.id, "indexed");

      indexed += 1;
      chunkBudget -= chunks.length;

      if (chunkBudget <= 0) {
        /* Everything after this entry waits for the next call. */
        remaining += entries.length - entries.indexOf(entry) - 1;
        break;
      }
    } catch (error) {
      const failure = normalizeError(error);

      await writeIndexRow({
        knowledgeId: entry.id,
        agentId: agent.id,
        userId,
        state: "failed",
        embeddingModel: modelKey,
        chunkCount: row?.chunk_count ?? 0,
        contentHash: null,
        error: failure.message,
        indexedAt: row?.indexed_at ?? null,
      });

      /*
       * Back to inline, so a failed index costs the agent
       * nothing it had before. This is the line that makes the
       * whole feature safe to turn on.
       */
      await setEntryStatus(userId, entry.id, "inline");

      /*
       * A quota refusal or a dead provider will refuse the next
       * entry too, so the run stops rather than producing one
       * identical failure per entry — and stops without throwing,
       * because the entries already indexed are real.
       */
      if (
        failure.code === "rate_limited" ||
        failure.code === "quota_exceeded" ||
        failure.code === "token_quota_exceeded" ||
        failure.code === "too_many_concurrent" ||
        failure.code === "platform_budget_exceeded" ||
        failure.code === "provider_unavailable" ||
        failure.code === "provider_not_configured" ||
        failure.code === "cancelled" ||
        failure.code === "timeout"
      ) {
        remaining += Math.max(
          0,
          entries.length - entries.indexOf(entry) - 1
        );
        break;
      }
    }
  }

  return {
    ...(await knowledgeStatus(userId, agent)),
    indexed,
    remaining,
  };
}
