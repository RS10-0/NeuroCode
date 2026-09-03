import { memory, memoryMinSimilarity } from "../../ai/config";
import {
  embed,
  resolveEmbedding,
  toVectorLiteral,
} from "../../ai/EmbeddingRuntime";
import { embeddingModelKey } from "../../ai/embeddingModels";
import { normalizeError } from "../../ai/errors";
import type {
  MemoryReason,
  RecalledMemory,
} from "../../ai/types";
import { listForScope, searchScope, touch } from "./MemoryStore";
import { NOTHING, renderMemory, type RenderedMemory } from "./context";
import type { MemoryScope } from "./scope";

/*
 * Deciding what an agent walks into a conversation already
 * knowing.
 *
 * The read half of Memory, and the one rule that governs the
 * whole file: this never throws. An agent that cannot reach its
 * memories must still answer, because the alternative is a
 * deployed endpoint that starts returning 503s when the
 * database has a bad ten minutes — and because most turns do
 * not depend on remembering anything.
 *
 * So every failure below becomes a reason code and an empty
 * result. The runtime carries on, the answer is produced
 * without the context, and the Builder is told what happened.
 *
 * THE SELECTION STRATEGY is the interesting part, and it is
 * deliberately not the one knowledge retrieval uses.
 *
 * Retrieval is a pure vector search: embed the question, take
 * what matches, and an agent asked about photosynthesis reads
 * the biology pages. That is right for a library, and it is
 * wrong for memory, for a reason that shows up in the very
 * first interaction. A new conversation opens with "hi" or "can
 * you help me with something". Embed that and nothing matches
 * anything, so a purely semantic recall hands back nothing, and
 * an agent somebody has worked with for a month greets them as
 * a stranger. That is exactly the failure this whole capability
 * exists to fix, so a design that reintroduces it on the first
 * message of every conversation is not a design worth having.
 *
 * So there are two tiers.
 *
 *   Everything fits    — send all of it. No embedding call, no
 *                        vector, nothing to fail. This is the
 *                        common case and stays the common case,
 *                        because a well-behaved store is small.
 *
 *   Everything does not — carry the most recently useful
 *                        `alwaysInclude` whatever was asked,
 *                        then fill what room is left with the
 *                        memories most like the question.
 *
 * The floor is what makes the greeting case work. The semantic
 * fill is what makes the twentieth memory as reachable as the
 * second. And if embedding is unavailable — no model on this
 * power source, provider down, quota spent — the fill falls
 * back to rank and the turn says `ranked`. Memory degrades; it
 * never disappears.
 */

export interface RecallInput {
  scope: MemoryScope;
  /* The question being answered — the last user turn, and only
     that. Earlier turns describe a conversation, not a lookup;
     the same argument retrieval makes. Only used by the
     semantic tier, so an empty one costs nothing. */
  query: string;
  signal?: AbortSignal;
}

export interface RecallOutcome extends RenderedMemory {
  reason?: MemoryReason;
  /* How many the scope holds in total, so the Builder can say
     "carried 8 of 41" rather than implying it carried all of
     them. */
  held: number;
}

const EMPTY: RecallOutcome = { ...NOTHING, held: 0 };

/*
 * A memory in the running to be carried.
 *
 * Deliberately narrower than what the store hands back. The
 * ranked tier's rows carry an `embedding_model`, which matters
 * to nothing downstream of the search, and the semantic tier's
 * do not carry one at all — so the two would not be one type
 * unless this dropped the column both tiers agree to ignore.
 */
type Candidate = RecalledMemory & { useCount: number };

/*
 * Ranked order: reinforcement first, recency second.
 *
 * `updated_at` already orders the rows coming out of the store,
 * so this only has to break its ties — but it breaks them the
 * right way. Two memories written in the same minute are not
 * equally valuable; the one that has been carried into nine
 * previous prompts has proved itself and the one that has never
 * been used has not.
 */
function ranked<T extends { useCount: number; updatedAt: string }>(
  entries: T[]
): T[] {
  return entries.slice().sort((a, b) => {
    if (b.useCount !== a.useCount) {
      return b.useCount - a.useCount;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/* Characters one memory costs in the rendered block, near
   enough. The label and the bullet are a couple of dozen; this
   only has to decide whether everything fits, and the renderer
   enforces the real budget afterwards. */
function costOf(entry: RecalledMemory): number {
  return entry.content.length + 32;
}

export async function recallMemory(
  input: RecallInput
): Promise<RecallOutcome> {
  try {
    const stored = await listForScope(input.scope);

    if (stored.length === 0) {
      return { ...EMPTY, reason: "none" };
    }

    const held: Candidate[] = stored.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      content: entry.content,
      updatedAt: entry.updatedAt,
      useCount: entry.useCount,
    }));

    const budget = Math.max(0, memory.contextChars);
    const total = held.reduce((sum, entry) => sum + costOf(entry), 0);

    /*
     * The whole scope fits. Send it, and make no provider call
     * of any kind.
     *
     * Worth being explicit that this is the intended common
     * case rather than a shortcut. A memory store that is
     * behaving — extraction merging duplicates, the cap
     * evicting what is unused — holds tens of short sentences,
     * and tens of short sentences fit three thousand
     * characters. An agent should be able to remember for
     * months without ever embedding anything.
     */
    if (budget === 0 || total <= budget) {
      return finish(input, ranked(held), held.length);
    }

    /*
     * Over budget. The floor goes in on rank alone.
     */
    const byRank = ranked(held);
    const floor = byRank.slice(0, Math.max(1, memory.alwaysInclude));

    let spent = floor.reduce((sum, entry) => sum + costOf(entry), 0);
    const chosen: Candidate[] = [...floor];
    const taken = new Set(floor.map((entry) => entry.id));

    const room = budget - spent;

    /*
     * Then relevance, for whatever room is left.
     *
     * `resolveEmbedding` first, and as a cheap check rather
     * than an attempt: if this power source has no embedding
     * model there is no point spending a quota slot to discover
     * it, and the ranked fill below is a perfectly good answer.
     */
    if (room > 0 && input.query.trim()) {
      const filled = await semanticFill({
        input,
        room,
        exclude: [...taken],
      });

      if (filled === null) {
        /*
         * Embedding was unavailable or failed. Fill by rank
         * instead and SAY SO, because "why did it not know
         * that?" has two different answers — one is "your
         * memory is bigger than one prompt" and the other is
         * "the part that picks the relevant ones was down" —
         * and only the owner can tell them apart from the
         * label.
         */
        return finish(
          input,
          fillByRank(byRank, chosen, taken, budget, spent),
          held.length,
          "ranked"
        );
      }

      for (const entry of filled) {
        const cost = costOf(entry);

        if (spent + cost > budget) {
          break;
        }

        chosen.push(entry);
        taken.add(entry.id);
        spent += cost;
      }
    }

    return finish(
      input,
      fillByRank(byRank, chosen, taken, budget, spent),
      held.length
    );
  } catch (error) {
    /*
     * Logged and swallowed. Somebody asked a question and is
     * about to get an answer; turning a failed memory read into
     * a refusal would be the wrong trade every time.
     */
    const failure = normalizeError(error);

    console.error(
      `[memory] agent ${input.scope.agentId}: recall failed — ${failure.code}: ${
        failure.internalDetail ?? failure.message
      }`
    );

    return { ...EMPTY, reason: "unavailable" };
  }
}

/*
 * Tops up whatever room is left, in rank order.
 *
 * Runs after the semantic tier as well as instead of it. A
 * question that matched two memories strongly should still
 * arrive with the other four the budget can hold rather than
 * leaving the space empty — the point of the budget is to be
 * used.
 */
function fillByRank(
  byRank: Candidate[],
  chosen: Candidate[],
  taken: Set<string>,
  budget: number,
  spent: number
): Candidate[] {
  let used = spent;

  for (const entry of byRank) {
    if (taken.has(entry.id)) {
      continue;
    }

    const cost = costOf(entry);

    if (used + cost > budget) {
      continue;
    }

    chosen.push(entry);
    taken.add(entry.id);
    used += cost;
  }

  return chosen;
}

/*
 * The semantic tier.
 *
 * Returns null — distinct from an empty array — when embedding
 * could not happen at all. The caller turns null into the
 * `ranked` reason and an empty array into an ordinary fill,
 * because "the relevance search found nothing else worth
 * adding" and "there was no relevance search" are different
 * facts about the same turn.
 *
 * Never throws: every failure is a null.
 */
async function semanticFill(args: {
  input: RecallInput;
  room: number;
  exclude: string[];
}): Promise<Candidate[] | null> {
  const { input } = args;

  try {
    const resolved = await resolveEmbedding(
      input.scope.kind === "owner" ? input.scope.userId : input.scope.ownerId
    );

    if (!resolved.model) {
      return null;
    }

    /*
     * One text, one provider call, one usage row — counted
     * against the memory quota key, not the learner's chat
     * allowance. See the note in config.ts on why those are
     * separate windows.
     */
    const outcome = await embed({
      userId:
        input.scope.kind === "owner" ? input.scope.userId : input.scope.ownerId,
      texts: [input.query.trim()],
      purpose: "query",
      feature: "agent_memory",
      agentId: input.scope.agentId,
      signal: input.signal,
    });

    const vector = outcome.vectors[0];

    if (!vector) {
      return null;
    }

    /*
     * Filtered by the same model key the vectors were written
     * with. Two embedding models produce numbers of the same
     * width that mean entirely different things, so a question
     * embedded by one must never be compared against memories
     * embedded by another — the results would be noise
     * presented as relevance. Since an agent's embedding model
     * follows its power source, this is what makes switching an
     * agent from BuildGentic's key to its owner's degrade to the
     * ranked tier instead of quietly returning nonsense.
     */
    return await searchScope({
      scope: input.scope,
      embedding: toVectorLiteral(vector),
      embeddingModel: outcome.modelKey || embeddingModelKey(resolved.model),
      limit: Math.max(1, memory.topK),
      minSimilarity: memoryMinSimilarity,
      exclude: args.exclude,
    });
  } catch (error) {
    const failure = normalizeError(error);

    console.error(
      `[memory] agent ${input.scope.agentId}: relevance search failed — ${
        failure.code
      }: ${failure.internalDetail ?? failure.message}`
    );

    return null;
  }
}

/*
 * Renders, and records that these were used.
 *
 * The `touch` is deliberately not awaited. It is two round
 * trips of bookkeeping that improve ranking on some future
 * turn, and nobody's answer should wait for it — but it also
 * must not become an unhandled rejection, hence the catch.
 */
function finish(
  input: RecallInput,
  chosen: Candidate[],
  held: number,
  reason?: MemoryReason
): RecallOutcome {
  const rendered = renderMemory(
    chosen.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      content: entry.content,
      updatedAt: entry.updatedAt,
      ...(entry.similarity === undefined
        ? {}
        : { similarity: entry.similarity }),
    }))
  );

  if (rendered.memories.length > 0) {
    void touch(
      input.scope,
      rendered.memories.map((entry) => entry.id)
    ).catch((error: unknown) => {
      console.error(
        `[memory] agent ${input.scope.agentId}: could not record use — ${String(
          error
        )}`
      );
    });
  }

  return {
    ...rendered,
    held,
    ...(reason ? { reason } : {}),
  };
}
