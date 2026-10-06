import type {
  EmbeddingModelDescriptor,
  PowerSourceKind,
  ProviderId,
  ResolvedPowerSource,
} from "./types";

/*
 * The embedding catalogue.
 *
 * models.ts for vectors, and deliberately the same shape: one
 * array, one place an embedding model id is written down, and
 * `availableTo` deciding which power source may reach it. It is
 * an allowlist for the same reason the other one is — nothing
 * outside this array can be asked of a provider.
 *
 * Every entry is 768 dimensions, and that is a constraint rather
 * than a coincidence. The column that stores these is a fixed
 * width, so a catalogue with two widths in it would need two
 * columns or two tables. 768 was chosen when the platform model
 * was Gemini, which can be asked for any width — a quarter of
 * the storage of 3072, losing almost nothing on the scale of
 * text a learner attaches. Its replacement was picked partly
 * BECAUSE it is natively 768, so the column never moved.
 *
 * What does NOT follow from a shared width is comparability.
 * Two models produce 768 numbers that mean entirely different
 * things, and a query embedded by one must never be searched
 * against chunks embedded by the other. `embeddingModelKey`
 * below is what is stored on every chunk so that cannot happen
 * by accident.
 */

const DIMENSIONS = 768;

const EMBEDDING_MODELS: EmbeddingModelDescriptor[] = [
  /* -------------------------------------------------------
     CLOUDFLARE — the platform embedding model.

     It replaced gemini-embedding-001, and not for quality. The
     Gemini API's terms forbid using it in a service "directed
     towards or likely to be accessed by individuals under the
     age of 18", which BuildGentic is; and on the unpaid tier
     Google uses what it is sent to improve its products, with
     human review. A learner's uploaded notes are exactly what
     neither of those should touch.

     Cloudflare does not train on, or improve services with,
     what Workers AI is sent, and bge-base is natively 768
     dimensions — the width the chunk column already is — so the
     swap needed no migration. It does need every existing chunk
     re-embedded: vectors from two models cannot be compared,
     and the model key below makes the old chunks unsearchable
     rather than wrong. scripts/reindex-knowledge.mts does that
     once, after deploy.

     Billed in neurons against the same 10,000-a-day free
     allowance as Cloudflare's chat slot, at roughly 6,000
     neurons per million tokens — a 30-page document is a couple
     of hundred.
     ------------------------------------------------------- */
  {
    id: "@cf/baai/bge-base-en-v1.5",
    provider: "cloudflare",
    displayName: "BGE Base EN v1.5",
    dimensions: DIMENSIONS,
    /*
     * The model reads at most 512 tokens and drops the rest, so
     * this is set where the chunker's hard limit keeps every
     * chunk whole: about 1,800 characters is ~450 tokens of
     * English. The chunker's own target (~900 characters, see
     * NEUROLINK_KNOWLEDGE_CHUNK_CHARS) sits well inside it; this
     * is the ceiling for the pathological entry — one long line
     * with no whitespace — not the size of a normal chunk.
     */
    maxInputChars: 1_800,
    /* Well inside what the endpoint accepts in one call, and the
       same batch size the Gemini entry used, so indexing makes the
       same number of requests as before. */
    maxBatch: 32,
    availableTo: ["platform", "byok"],
  },

  /*
   * The offline model. Not a product model.
   *
   * It exists so that indexing, retrieval, ranking and every
   * test that exercises them work on a clone with no API key —
   * the same promise MockProvider makes for completions. Its
   * vectors are a hashed bag of words, so similarity between
   * them is real lexical similarity: a physics question does
   * genuinely retrieve the physics chunk offline.
   *
   * Only reachable when the platform provider has resolved to
   * `mock`, which happens when no platform key is configured.
   */
  {
    id: "neurolink/mock-embed-1",
    provider: "mock",
    displayName: "BuildGentic Mock Embedding",
    dimensions: DIMENSIONS,
    maxInputChars: 8_000,
    maxBatch: 32,
    availableTo: ["platform", "byok"],
  },
];

/*
 * The identity stored on every chunk, and the thing a search
 * filters on.
 *
 * Provider and width are in it as well as the id, so that a
 * vendor reusing a model name at a different size, or two
 * vendors reusing a name, cannot make two incompatible vector
 * spaces look like one.
 */
export function embeddingModelKey(
  model: EmbeddingModelDescriptor
): string {
  return `${model.provider}:${model.id}:${model.dimensions}`;
}

export function allEmbeddingModels(): EmbeddingModelDescriptor[] {
  return [...EMBEDDING_MODELS];
}

export function findEmbeddingModel(
  id: unknown
): EmbeddingModelDescriptor | null {
  if (typeof id !== "string") {
    return null;
  }

  return EMBEDDING_MODELS.find((model) => model.id === id) ?? null;
}

/*
 * The embedding models a set of providers can reach on a given
 * power source.
 *
 * Two filters, not one, for the same reason modelsAvailable has
 * two: a model has to belong to a provider the caller holds
 * credentials for AND be permitted on the power source paying
 * for it. Dropping the second would let a BYOK agent's indexing
 * be billed to BuildGentic.
 */
export function embeddingModelsAvailable(
  providers: ProviderId[],
  kind: PowerSourceKind
): EmbeddingModelDescriptor[] {
  return EMBEDDING_MODELS.filter(
    (model) =>
      providers.includes(model.provider) && model.availableTo.includes(kind)
  );
}

/*
 * The model this power source would actually use, or null.
 *
 * Null is a real answer and not an error: a learner whose only
 * connected key is Anthropic's has a perfectly valid BYOK power
 * source that simply cannot produce a vector, because Anthropic
 * publishes no embeddings endpoint. The caller turns that into
 * "this knowledge cannot be indexed yet, connect an OpenAI or
 * Google key", and the agent keeps working by inlining its
 * knowledge exactly as it did before.
 *
 * Catalogue order decides the winner, so reordering the array
 * above changes the preference and there is no second list
 * holding a duplicate id that could drift out of step.
 */
export function embeddingModelFor(
  source: ResolvedPowerSource
): EmbeddingModelDescriptor | null {
  const providers = [...source.credentials.keys()];

  return embeddingModelsAvailable(providers, source.kind)[0] ?? null;
}
