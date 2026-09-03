import { embeddingLimitsFor, retrieval } from "./config";
import { embeddingModelFor, embeddingModelKey } from "./embeddingModels";
import { AiRuntimeError, normalizeError } from "./errors";
import { resolvePowerSource } from "./resolveChain";
import { getProvider } from "./ProviderRegistry";
import { registerProviders } from "./providers";
import { admit } from "./QuotaGuard";
import { estimateTokens } from "./tokens";
import { finish } from "./UsageRecorder";
import type {
  AiFeature,
  EmbeddingModelDescriptor,
  EmbeddingPurpose,
  ResolvedPowerSource,
} from "./types";

/*
 * The entry point for every vector BuildGentic makes.
 *
 * AiRuntime.runChat for embeddings, and consciously the same
 * shape, in the same order, for the same reasons:
 *
 *   resolve who is paying
 *   → resolve and authorise the model
 *   → take a quota slot
 *   → call the provider
 *   → always close the usage row
 *
 * Nothing above this file holds a key, names a vendor, counts a
 * quota or writes a usage row — which is the whole point of it
 * existing rather than the indexer calling fetch itself. An
 * embedding is a model call somebody pays for, and there is no
 * version of this feature where indexing gets to skip the gate
 * that a Lab prompt cannot.
 *
 * Who pays is the agent's own power source, not BuildGentic's by
 * default. A platform agent embeds on BuildGentic's key and
 * against BuildGentic's budget; a BYOK agent embeds on its
 * owner's key and never touches that budget. Retrieval does not
 * get to be the one place where a learner spending their own
 * provider credit quietly spends BuildGentic's instead.
 */

/* =========================================================
   THE QUOTA KEY

   Embedding traffic is counted, and counted in its own windows.
   See the note on embeddingLimitsFor in config.ts: a
   retrieval-backed turn is two calls, and charging both to the
   per-minute window a learner uses for the Lab would halve
   what they can do the moment they turn the capability on.

   Derived from the source's own key rather than rebuilt from
   the user id, so the platform/BYOK split is inherited instead
   of restated — and so a change to how quota keys are shaped
   lands in one file.
========================================================= */

function embeddingSource(source: ResolvedPowerSource): ResolvedPowerSource {
  return {
    ...source,
    quotaKey: `embed:${source.quotaKey}`,
    limits: embeddingLimitsFor(),
  };
}

export interface EmbedOptions {
  userId: string;
  /* One vector comes back per entry, in this order. */
  texts: string[];
  purpose: EmbeddingPurpose;
  /* `agent_index` or `agent_retrieval`. Recorded on every row. */
  feature: AiFeature;
  agentId?: string;
  signal?: AbortSignal;
}

export interface EmbedOutcome {
  model: EmbeddingModelDescriptor;
  /* What gets written to, and filtered on, agent_knowledge_chunks. */
  modelKey: string;
  vectors: number[][];
  /* Provider calls made. One per batch, one usage row each. */
  batches: number;
  inputTokens: number;
}

/*
 * The model this learner's power source can embed with.
 *
 * Exported because both the indexer and the retriever need to
 * know it before they have any text — the indexer to decide
 * whether an entry's chunks are current, the retriever to
 * decide which chunks are even searchable.
 */
export async function resolveEmbedding(userId: string): Promise<{
  source: ResolvedPowerSource;
  model: EmbeddingModelDescriptor | null;
}> {
  registerProviders();

  const source = await resolvePowerSource(userId);
  const model = embeddingModelFor(source);

  /*
   * A model in the catalogue whose adapter cannot embed would be
   * a wiring mistake rather than a configuration one, and it
   * must not look like "you have no key". Checked here so the
   * two are never confused.
   */
  if (model && !getProvider(model.provider).embed) {
    return { source, model: null };
  }

  return { source, model };
}

/*
 * The refusal a learner sees when their power source has no
 * embedding model.
 *
 * Worth its own function because it is the one failure in this
 * file the learner can actually fix, and the fix differs by
 * power source: on BYOK it is "connect a different provider",
 * on the platform it is "this server is misconfigured" and
 * nothing they do will help.
 */
export function noEmbeddingModelError(
  source: ResolvedPowerSource
): AiRuntimeError {
  return new AiRuntimeError(
    "model_not_allowed",
    source.kind === "byok"
      ? "None of your connected API keys can make embeddings, so this agent's knowledge cannot be searched. Anthropic and OpenRouter do not offer them — connect an OpenAI or Google key, or switch this agent to BuildGentic's own AI."
      : "BuildGentic's server has no embedding model configured, so knowledge cannot be indexed. This is a server problem, not something you did.",
    {
      internalDetail: `no embedding model for power source ${source.kind}`,
    }
  );
}

/*
 * Embeds a batch of texts, one provider call per `maxBatch`.
 *
 * Each call is admitted and recorded separately, because each
 * call is separately refusable and separately billable. A
 * single usage row covering eight provider requests would make
 * the concurrency limit meaningless and the ledger a lie.
 */
export async function embed(options: EmbedOptions): Promise<EmbedOutcome> {
  registerProviders();

  const { source, model } = await resolveEmbedding(options.userId);

  if (!model) {
    throw noEmbeddingModelError(source);
  }

  const provider = getProvider(model.provider);
  const credentials = source.credentials.get(model.provider);

  if (!credentials || !provider.isConfigured(credentials) || !provider.embed) {
    throw new AiRuntimeError(
      "provider_not_configured",
      "AI is not configured on this BuildGentic server yet."
    );
  }

  const texts = options.texts.map((text) => text.slice(0, model.maxInputChars));

  if (texts.length === 0) {
    return {
      model,
      modelKey: embeddingModelKey(model),
      vectors: [],
      batches: 0,
      inputTokens: 0,
    };
  }

  const quota = embeddingSource(source);

  const vectors: number[][] = [];
  let batches = 0;
  let inputTokens = 0;

  for (let start = 0; start < texts.length; start += model.maxBatch) {
    const batch = texts.slice(start, start + model.maxBatch);

    vectors.push(
      ...(await embedBatch({
        options,
        source: quota,
        model,
        provider,
        credentials,
        batch,
        onTokens: (tokens) => {
          inputTokens += tokens;
        },
      }))
    );

    batches += 1;
  }

  return {
    model,
    modelKey: embeddingModelKey(model),
    vectors,
    batches,
    inputTokens,
  };
}

interface BatchInput {
  options: EmbedOptions;
  source: ResolvedPowerSource;
  model: EmbeddingModelDescriptor;
  provider: ReturnType<typeof getProvider>;
  credentials: NonNullable<
    ReturnType<ResolvedPowerSource["credentials"]["get"]>
  >;
  batch: string[];
  onTokens: (tokens: number) => void;
}

async function embedBatch(input: BatchInput): Promise<number[][]> {
  const { options, source, model, provider, credentials, batch } = input;

  const chars = batch.reduce((total, text) => total + text.length, 0);

  /*
   * Refused before the quota slot, so an oversized batch costs
   * nothing. The chunker cannot produce one — this catches a
   * caller that bypassed it.
   */
  if (source.limits.maxInputChars > 0 && chars > source.limits.maxInputChars) {
    throw new AiRuntimeError(
      "invalid_request",
      `That is ${chars.toLocaleString()} characters to embed at once, and the limit is ${source.limits.maxInputChars.toLocaleString()}.`
    );
  }

  const estimatedTokens = estimateTokens(batch.join(""));

  const admission = await admit({
    userId: options.userId,
    source,
    model: model.id,
    providerId: model.provider,
    feature: options.feature,
    /* Input only. An embedding produces no output tokens, which
       is why the ceiling is not added the way runChat adds it. */
    estimatedTokens,
    keyId: credentials.keyId,
    agentId: options.agentId,
  });

  const startedAt = Date.now();

  /*
   * One controller for two ways this can stop early: the caller
   * gives up, or the provider does not answer. Unlike a
   * completion there is no first-token deadline to distinguish,
   * because there is no stream — an embedding either arrives or
   * it does not.
   */
  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, retrieval.timeoutMs);

  let failure: AiRuntimeError | null = null;
  let reportedTokens: number | undefined;

  try {
    const result = await provider.embed!(
      {
        model: model.id,
        texts: batch,
        purpose: options.purpose,
        dimensions: model.dimensions,
      },
      credentials,
      controller.signal
    );

    if (timedOut) {
      throw new AiRuntimeError(
        "timeout",
        "The embedding provider did not respond in time. Please try again."
      );
    }

    /*
     * One vector per text, in order, at the width the column
     * expects. Checked rather than assumed: everything
     * downstream indexes these positionally against the chunks
     * they came from, so a provider returning seven vectors for
     * eight texts would silently attach each chunk's meaning to
     * its neighbour.
     */
    if (result.vectors.length !== batch.length) {
      throw new AiRuntimeError(
        "provider_malformed_response",
        "The embedding provider returned an unexpected result.",
        {
          internalDetail: `asked for ${batch.length} vectors, got ${result.vectors.length}`,
        }
      );
    }

    const vectors = result.vectors.map((vector, index) => {
      if (vector.length !== model.dimensions) {
        throw new AiRuntimeError(
          "provider_malformed_response",
          "The embedding provider returned an unexpected result.",
          {
            internalDetail: `vector ${index} has ${vector.length} dimensions, expected ${model.dimensions}`,
          }
        );
      }

      return normalize(vector);
    });

    reportedTokens = result.inputTokens;
    input.onTokens(reportedTokens ?? estimatedTokens);

    return vectors;
  } catch (error) {
    failure = timedOut
      ? new AiRuntimeError(
          "timeout",
          "The embedding provider did not respond in time. Please try again."
        )
      : normalizeError(error);

    if (failure.internalDetail) {
      /* Read here and nowhere else. It never reaches a response
         body, for the same reason a completion's does not. */
      console.error(`[embed] ${failure.code}: ${failure.internalDetail}`);
    }

    throw failure;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();

    /*
     * Always. A pending row holds one of this learner's
     * embedding concurrency slots until the reaper sweeps it ten
     * minutes later.
     */
    await finish(admission.usageId, {
      usage: {
        inputTokens: reportedTokens ?? estimatedTokens,
        outputTokens: 0,
        reported: reportedTokens !== undefined,
      },
      latencyMs: Date.now() - startedAt,
      ok: failure === null,
      errorCode: failure?.code,
    });
  }
}

/* =========================================================
   NORMALISATION

   Every vector is stored at unit length.

   Cosine similarity does not require it — the operator divides
   by the magnitudes itself — but two things do. It makes the
   numbers comparable across providers, so a similarity floor
   tuned on one model is not nonsense on another. And Google
   returns UNNORMALISED vectors at any width other than 3072,
   which is exactly the case BuildGentic uses; leaving them as
   they arrive would make the stored magnitudes vary with the
   text, for no reason anybody reading the table could guess.

   A zero vector is left alone rather than divided by zero. It
   is not a real embedding, and it will simply never match
   anything.
========================================================= */

function normalize(vector: number[]): number[] {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  const magnitude = Math.sqrt(sum);

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

/*
 * The wire format pgvector parses.
 *
 * A bracketed list, sent as text because PostgREST posts JSON
 * and there is no vector type on that wire. Rounded to six
 * decimals: the difference is far below what any similarity
 * threshold can distinguish, and it takes roughly a third off
 * the size of every request and every row.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => value.toFixed(6)).join(",")}]`;
}
