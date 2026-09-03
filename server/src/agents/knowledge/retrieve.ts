import { supabase } from "../../lib/supabase";
import {
  retrieval,
  retrievalMinSimilarity,
  retrievalRelativeFloor,
} from "../../ai/config";
import {
  embed,
  resolveEmbedding,
  toVectorLiteral,
} from "../../ai/EmbeddingRuntime";
import { embeddingModelKey } from "../../ai/embeddingModels";
import { normalizeError } from "../../ai/errors";
import type { RetrievalReason } from "../../ai/types";
import {
  renderRetrievedContext,
  type RenderedContext,
  type RetrievedPassage,
} from "./context";

/*
 * Finding the parts of an agent's knowledge that a question is
 * actually about.
 *
 * The read half of retrieval, and the one rule that governs the
 * whole file: this never throws. An agent that cannot look
 * something up must still answer, because the alternative is a
 * deployed endpoint that starts returning 503s when an
 * embedding provider has a bad ten minutes — and because the
 * question a learner asked is very often one their knowledge
 * does not cover at all, which is a normal outcome and not a
 * fault.
 *
 * So every failure below becomes a reason code and an empty
 * result. The runtime carries on, the answer is produced
 * without the extra context, the Builder is told what happened,
 * and the embedding attempt's own ai_usage row already carries
 * the real error code for anybody reading the ledger.
 *
 * Scope is the other thing to be exact about. Both the user id
 * and the agent id are filtered on, in SQL, inside a function
 * granted to the service role alone. Neither ever comes off a
 * request body: the browser path resolves the agent through
 * AgentStore under the caller's own id, and the deployed path
 * inherits the owner from the deployment row.
 */

export interface RetrieveInput {
  userId: string;
  agentId: string;
  /* The question being answered — the last user turn, and only
     that. Earlier turns describe a conversation, not a lookup. */
  query: string;
  signal?: AbortSignal;
}

export interface RetrievalOutcome extends RenderedContext {
  reason?: RetrievalReason;
}

const EMPTY: RenderedContext = { text: "", sources: [], chars: 0 };

interface SearchRow {
  chunk_id: string;
  knowledge_id: string;
  title: string;
  ordinal: number;
  content: string;
  char_count: number;
  similarity: number;
}

/*
 * Whether this agent has anything searchable at all, for the
 * model about to be used.
 *
 * Asked first, and asked as a count rather than a select. It
 * saves a provider call, a quota slot and a usage row for every
 * agent whose knowledge has not been indexed yet — which is
 * every agent, briefly, immediately after this phase ships. It
 * is also what lets "nothing is indexed" and "nothing matched"
 * be different sentences in the Builder, which they should be:
 * one is a state to fix and the other is an answer.
 */
async function hasIndex(
  userId: string,
  agentId: string,
  modelKey: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from("agent_knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .eq("embedding_model", modelKey);

  if (error) {
    throw new Error(`agent_knowledge_chunks count failed: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export async function retrieveKnowledge(
  input: RetrieveInput
): Promise<RetrievalOutcome> {
  const query = input.query.trim();

  if (!query) {
    return { ...EMPTY, reason: "no_match" };
  }

  try {
    const resolved = await resolveEmbedding(input.userId);

    if (!resolved.model) {
      return { ...EMPTY, reason: "unavailable" };
    }

    const modelKey = embeddingModelKey(resolved.model);

    if (!(await hasIndex(input.userId, input.agentId, modelKey))) {
      return { ...EMPTY, reason: "none_indexed" };
    }

    /*
     * One text, one provider call, one usage row — counted
     * against the embedding quota key, not the learner's chat
     * allowance. See the note in config.ts on why those are
     * separate windows.
     */
    const outcome = await embed({
      userId: input.userId,
      texts: [query],
      purpose: "query",
      feature: "agent_retrieval",
      agentId: input.agentId,
      signal: input.signal,
    });

    const vector = outcome.vectors[0];

    if (!vector) {
      return { ...EMPTY, reason: "unavailable" };
    }

    const { data, error } = await supabase.rpc("agent_knowledge_search", {
      p_user_id: input.userId,
      p_agent_id: input.agentId,
      p_embedding: toVectorLiteral(vector),
      p_embedding_model: outcome.modelKey,
      p_limit: Math.max(1, retrieval.topK),
      /*
       * The floor is what makes "I do not know" possible.
       * Without it every question retrieves the six
       * least-irrelevant chunks in the library and an agent
       * asked about the weather starts quoting a chemistry note.
       */
      p_min_similarity: retrievalMinSimilarity,
    });

    if (error) {
      throw new Error(`agent_knowledge_search failed: ${error.message}`);
    }

    const rows = ((data ?? []) as SearchRow[]).filter(
      (row) => typeof row.content === "string" && row.content.trim().length > 0
    );

    if (rows.length === 0) {
      return { ...EMPTY, reason: "no_match" };
    }

    const passages: RetrievedPassage[] = rows.map((row) => ({
      knowledgeId: row.knowledge_id,
      title: row.title,
      ordinal: Number(row.ordinal),
      content: row.content,
      similarity: Number(row.similarity),
    }));

    /* The SQL already orders by distance; re-sorted here so the
       rendering does not depend on a promise made elsewhere. */
    passages.sort((a, b) => b.similarity - a.similarity);

    /*
     * The relative floor, applied here rather than in SQL
     * because it needs the best score before it can judge the
     * rest — and a query that has to find its own maximum first
     * cannot use the vector index to do it.
     *
     * The absolute floor decided whether this agent knows
     * anything about the question. This decides how much of what
     * it found is worth sending: a passage at 0.58 next to one
     * at 0.79 shares the question's vocabulary rather than
     * answering it, and sending both invites the model to blend
     * them.
     *
     * The best match always survives its own floor, so this can
     * never turn a match into no match.
     */
    const kept =
      retrievalRelativeFloor > 0
        ? passages.filter(
            (passage) =>
              passage.similarity >=
              passages[0].similarity * retrievalRelativeFloor
          )
        : passages;

    return renderRetrievedContext(kept);
  } catch (error) {
    /*
     * Logged and swallowed. The learner asked a question and is
     * about to get an answer; turning a lookup failure into a
     * refusal would be the wrong trade every time.
     */
    const failure = normalizeError(error);

    console.error(
      `[retrieval] agent ${input.agentId}: ${failure.code} — ${
        failure.internalDetail ?? failure.message
      }`
    );

    return { ...EMPTY, reason: "unavailable" };
  }
}
