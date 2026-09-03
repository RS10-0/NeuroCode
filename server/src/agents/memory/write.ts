import { memory } from "../../ai/config";
import { embed, resolveEmbedding, toVectorLiteral } from "../../ai/EmbeddingRuntime";
import { normalizeError } from "../../ai/errors";
import type {
  ChatMessage,
  MemoryWriteReason,
  RecalledMemory,
  WrittenMemory,
} from "../../ai/types";
import {
  attachEmbedding,
  upsertMemory,
  type MemoryDraft,
} from "./MemoryStore";
import { buildExtractPrompt, parseExtraction } from "./extract";
import { ownerOf, type MemoryScope } from "./scope";

/*
 * Writing down what was worth remembering.
 *
 * The half of Memory that spends money, and — like
 * websearch/search.ts, whose shape it copies — it never throws.
 * Somebody asked a question and is getting an answer; a failure
 * to remember must not become a failure to reply.
 *
 * THE MODEL CALL GOES BACK THROUGH `runChat`, and that is the
 * whole design rather than a shortcut. The alternative was a
 * second path to a provider, with its own credential lookup, its
 * own timeout handling and its own usage row — precisely the
 * drift the runtime exists to prevent. Going round again means
 * the extraction is admitted by the same gate, timed by the same
 * timers, recorded in the same table and refused by the same
 * rules as the answer it accompanies. It is also what makes BYOK
 * correct for free: a BYOK agent extracts on its owner's key,
 * because that is what `runChat` resolves for that owner.
 *
 * Recursion is bounded structurally rather than by a depth
 * counter: the body built below sets every capability flag to
 * false, so the inner call cannot reach this function, the web
 * search, the retrieval or the file reader again.
 *
 * WHAT THE EXTRACTOR IS GIVEN is the security boundary, and it
 * is enforced here rather than in the prompt. It receives the
 * conversation's user and assistant turns and nothing else — not
 * `options.body.system`, which by the time the runtime calls
 * this has had retrieved knowledge, web results, file text and
 * the memory block itself appended to it. A document cannot
 * argue its way into somebody's memory if it is never in the
 * room. See extract.ts for the other three defences.
 */

export interface MemoryWriteInput {
  scope: MemoryScope;
  /* The agent's own instructions, so the extractor knows what
     kind of thing this agent is for. The owner's configuration
     and trusted as such — NOT the composed system prompt. */
  instructions?: string;
  messages: ChatMessage[];
  /* What was recalled this turn, in the order it was rendered.
     Doubles as the dedupe list and as the only handles the
     model gets for superseding. */
  known: RecalledMemory[];
  /* Which side of the product is talking, for the usage row and
     the stored memory's provenance. */
  sourceFeature: "agent_test" | "agent_public";
  model: string;
  signal?: AbortSignal;
  /* Runs the extraction prompt through the runtime. Injected
     rather than imported so this module never imports
     AiRuntime, which imports it — the same seam
     websearch/search.ts uses. */
  ask: (input: {
    system: string;
    messages: ChatMessage[];
    maxOutputTokens: number;
    temperature: number;
  }) => Promise<string>;
}

export interface MemoryWriteOutcome {
  written: WrittenMemory[];
  reason?: MemoryWriteReason;
}

const NOTHING: MemoryWriteOutcome = { written: [] };

/*
 * The turns the extraction call reads.
 *
 * Trimmed at both ends. `extractTurns` bounds how far back it
 * looks, because re-reading a forty-turn conversation on every
 * turn would make the cheapest call in the exchange the most
 * expensive one — and anything durable said forty turns ago was
 * already extracted when it was said.
 *
 * Each turn is also capped, for the same reason: somebody who
 * pastes an essay into the chat should not have that essay sent
 * a second time to be searched for facts about them. The cap is
 * generous enough that an ordinary message is never touched.
 */
function recentTurns(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-Math.max(2, memory.extractTurns)).map((message) => ({
    role: message.role,
    content:
      message.content.length > 2_000
        ? `${message.content.slice(0, 2_000)}…`
        : message.content,
  }));
}

/*
 * Whether this turn is worth spending a call on.
 *
 * The cheapest saving in the capability: "ok", "thanks", "yes
 * please" and "what about the other one" are a large share of
 * all turns and contain nothing durable by construction. One
 * length comparison removes most of the extraction calls a busy
 * conversation would otherwise make.
 *
 * Measured on the last user turn only. An assistant turn can be
 * long and say nothing about the person, and is not a source of
 * memories anyway.
 */
function worthReading(messages: ChatMessage[]): boolean {
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return (lastUser?.content.trim().length ?? 0) >= memory.minUserChars;
}

export async function writeMemories(
  input: MemoryWriteInput
): Promise<MemoryWriteOutcome> {
  if (!worthReading(input.messages)) {
    return { ...NOTHING, reason: "trivial" };
  }

  try {
    const prompt = buildExtractPrompt({
      instructions: input.instructions,
      messages: recentTurns(input.messages),
      known: input.known,
      now: new Date(),
    });

    const reply = await input.ask({
      system: prompt.system,
      messages: prompt.messages,
      maxOutputTokens: Math.max(64, memory.extractTokens),
      /*
       * Zero. This is a classification, not a composition:
       * asked the same question twice about the same
       * conversation it should give the same answer, and any
       * creativity here shows up as invented facts about a
       * person that are then stored forever.
       */
      temperature: 0,
    });

    const extraction = parseExtraction(reply);

    if (!extraction || extraction.memories.length === 0) {
      return { ...NOTHING, reason: "nothing_new" };
    }

    /*
     * WRITTEN FIRST, EMBEDDED AFTERWARDS.
     *
     * The order matters and it was the other way round to begin
     * with, which was wrong for a reason only measurement
     * showed: an extraction call plus an embedding call in
     * sequence took the better part of ten seconds, and for all
     * of that time the fact somebody had just stated was not
     * yet remembered.
     *
     * A memory with no vector is not a broken memory. It is
     * already reachable through the ranked tier of recall,
     * which is the tier that carries it in the common case
     * anyway — the vector only decides what survives when a
     * scope has outgrown its context budget. So the row goes in
     * as soon as the extraction returns, and the vector catches
     * up a second later.
     *
     * That also removes an entire class of failure: an
     * embedding provider having a bad minute used to cost the
     * memory itself, and now costs nothing but a slower path to
     * relevance matching.
     */
    const written: WrittenMemory[] = [];

    for (const candidate of extraction.memories) {
      /*
       * The supersede path, resolved HERE and only here.
       *
       * `replaces` is an ordinal into the list this server sent
       * to the extraction call, so it is bounded by what the
       * agent had already recalled this turn. A number outside
       * that list — hallucinated, or written into the
       * conversation by somebody hoping to overwrite a memory
       * they cannot see — resolves to undefined, and the
       * memory is stored as new instead. There is no arithmetic
       * a reply can do that reaches a row this turn did not
       * already have in hand.
       */
      const replaceId =
        candidate.replaces !== undefined &&
        candidate.replaces >= 1 &&
        candidate.replaces <= input.known.length
          ? input.known[candidate.replaces - 1].id
          : undefined;

      const draft: MemoryDraft = {
        kind: candidate.kind,
        content: candidate.content,
        /* Filled in by backfillEmbeddings below, once the
           answer has already been reported. */
        embedding: null,
        embeddingModel: null,
        sourceFeature: input.sourceFeature,
      };

      try {
        const outcome = await upsertMemory(input.scope, draft, replaceId);

        written.push({
          id: outcome.id,
          kind: candidate.kind,
          content: candidate.content,
          replaced: outcome.replaced,
        });
      } catch (error) {
        /*
         * One memory failing is not the others failing. A
         * unique-key race between two tabs is the likely cause
         * and it means the fact is already stored, which is the
         * outcome that was wanted.
         */
        console.error(
          `[memory] agent ${input.scope.agentId}: could not store a memory — ${String(
            error
          )}`
        );
      }
    }

    if (written.length === 0) {
      return { ...NOTHING, reason: "unavailable" };
    }

    /*
     * Detached on purpose. Nothing waits for it, nothing fails
     * because of it, and it never throws — see below. The
     * memories are already stored and already usable by the
     * time this starts.
     */
    void backfillEmbeddings(input, written);

    return { written };
  } catch (error) {
    /*
     * Logged and swallowed, exactly as recall.ts does. The
     * answer has already been given, or is being given; a
     * failure to remember is not a reason to take it away.
     */
    const failure = normalizeError(error);

    console.error(
      `[memory] agent ${input.scope.agentId}: write failed — ${failure.code}: ${
        failure.internalDetail ?? failure.message
      }`
    );

    return { ...NOTHING, reason: "unavailable" };
  }
}

/*
 * Gives the memories just written their vectors.
 *
 * Runs after the turn has been reported and is awaited by
 * nobody, so every failure below is a memory that is slightly
 * harder to find later rather than a memory that does not
 * exist. That is why this never throws: there is no caller left
 * to tell.
 *
 * Doing nothing is a first-class outcome. A power source with
 * no embedding model — the mock provider, or a BYOK learner
 * whose only key is Anthropic — leaves every memory with a null
 * vector, and recall still carries them by rank. An agent on
 * such a source remembers everything; it simply chooses what to
 * carry by recency rather than by relevance when it has more
 * than fits.
 */
async function backfillEmbeddings(
  input: MemoryWriteInput,
  written: WrittenMemory[]
): Promise<void> {
  const vectors = await embedAll(
    input,
    written.map((entry) => entry.content)
  );

  if (!vectors) {
    return;
  }

  await Promise.all(
    written.map(async (entry, index) => {
      try {
        await attachEmbedding(
          input.scope,
          entry.id,
          toVectorLiteral(vectors.vectors[index]),
          vectors.modelKey
        );
      } catch (error) {
        console.error(
          `[memory] agent ${input.scope.agentId}: could not attach an embedding — ${String(
            error
          )}`
        );
      }
    })
  );
}

/*
 * Vectors for the memories just written, or null.
 *
 * Null is a first-class outcome rather than a failure, for the
 * reason given above.
 */
async function embedAll(
  input: MemoryWriteInput,
  texts: string[]
): Promise<{ vectors: number[][]; modelKey: string } | null> {
  try {
    const userId = ownerOf(input.scope);
    const resolved = await resolveEmbedding(userId);

    if (!resolved.model) {
      return null;
    }

    const outcome = await embed({
      userId,
      texts,
      purpose: "document",
      feature: "agent_memory",
      agentId: input.scope.agentId,
      signal: input.signal,
    });

    if (outcome.vectors.length !== texts.length) {
      return null;
    }

    return { vectors: outcome.vectors, modelKey: outcome.modelKey };
  } catch (error) {
    console.error(
      `[memory] agent ${input.scope.agentId}: could not embed a memory — ${String(
        error
      )}`
    );

    return null;
  }
}
