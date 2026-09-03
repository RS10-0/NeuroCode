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
 * columns or two tables. Both models here can be asked for an
 * arbitrary width — Gemini through `outputDimensionality`,
 * OpenAI through `dimensions` — so 768 is a choice, taken
 * because it is a quarter of the storage of 3072 and loses
 * almost nothing on the scale of text a learner attaches.
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
     GEMINI — the platform embedding model.

     Same reasoning as the completion catalogue: BuildGentic pays
     this bill for every learner, and Google's free tier bills
     nothing at all while the project has no billing account
     attached.
     ------------------------------------------------------- */
  {
    id: "gemini-embedding-001",
    provider: "gemini",
    displayName: "Gemini Embedding 001",
    dimensions: DIMENSIONS,
    /*
     * Comfortably past the chunker's target, so a chunk is
     * never the thing that hits this. It exists to stop a
     * pathological entry — one 40 KB line with no whitespace —
     * from becoming a provider error.
     */
    maxInputChars: 8_000,
    /*
     * Google allows up to 100 texts per batch but caps the batch
     * at 20k tokens, which 100 chunks of this size would exceed.
     * 32 keeps every batch inside both limits with room to spare.
     */
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
