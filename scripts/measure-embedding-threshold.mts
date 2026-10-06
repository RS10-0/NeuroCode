/*
 * Measures where the retrieval similarity floor belongs for the
 * platform's CURRENT embedding model.
 *
 * config.ts's NEUROLINK_RETRIEVAL_MIN_SIMILARITY was measured on
 * gemini-embedding-001 and its own comment says to re-measure
 * when the model changes: different models put "related" and
 * "unrelated" at entirely different points on the 0-1 scale.
 * This repeats that measurement on whatever embeddingModels.ts
 * now lists first.
 *
 * The method is the original one. Four unrelated documents,
 * chunked exactly as the indexer chunks them. Questions each
 * document answers, scored against that document's best chunk;
 * questions none of them answer — a rhyme, a recipe, a CSS bug,
 * a greeting — scored against the best chunk anywhere. Two
 * populations, and the floor belongs in the middle of the gap
 * between them, not at its edge (config.ts says why).
 *
 * Doubles as a live test of the embedding adapter: it calls the
 * real provider through the same `embed` the indexer uses, and
 * fails if a vector is missing or the wrong width.
 *
 * NEEDS server/.env with the Cloudflare account id and token.
 * Sends only the fixed text below — no learner data — and costs
 * a few dozen neurons from the daily free allowance.
 *
 *   npx tsx ./scripts/measure-embedding-threshold.mts
 */

import { readFileSync } from "node:fs";

/* Load server/.env before any server module reads process.env,
   which config.ts and chain.ts both do at import time. */
for (const line of readFileSync("server/.env", "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);

  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const { allEmbeddingModels } = await import("../server/src/ai/embeddingModels");
const { getProvider } = await import("../server/src/ai/ProviderRegistry");
const { registerProviders } = await import("../server/src/ai/providers");
const { keyFor, PROVIDER_CHAIN } = await import("../server/src/ai/providerChain");
const { chunkText, defaultChunkOptions } = await import("../server/src/agents/knowledge/chunk");
const { retrieval } = await import("../server/src/ai/config");

registerProviders();

const model = allEmbeddingModels().find((entry) => entry.provider !== "mock");

if (!model) {
  console.error("No real embedding model in the catalogue.");
  process.exit(1);
}

const entry = PROVIDER_CHAIN.find((candidate) => candidate.providerId === model.provider);
const apiKey = entry ? keyFor(entry) : undefined;
const provider = getProvider(model.provider);

if (!apiKey || !provider.embed) {
  console.error(`No key for ${model.provider}, or its adapter cannot embed.`);
  process.exit(1);
}

const DOCS: Record<string, string> = {
  physics: `Newton's second law states that the acceleration of a body is proportional to the net force acting on it and inversely proportional to its mass. Written as an equation this is F = ma. Momentum is the product of mass and velocity, and in a closed system the total momentum before a collision equals the total momentum after it.

In this laboratory's notation the Marrow constant, written as M, has the value 4.187 joules per kelvin per mole. It appears in every calculation of thermal capacity carried out in this building. Heat flows from a hotter body to a colder one until they reach thermal equilibrium.`,
  chemistry: `An ionic bond forms when one atom transfers electrons to another, leaving two oppositely charged ions that attract each other. A covalent bond forms when two atoms share a pair of electrons instead. The rate of a reaction increases with temperature, with concentration, and with surface area, and a catalyst increases it further.

This department stores a synthetic isotope it labels tanzanite-9. It has a half-life of eleven hours and is used only for calibrating the older detectors on the third floor.`,
  history: `The Treaty of Ashgrove was signed in 1847 and ended nine years of intermittent conflict between the coastal provinces and the inland league. The coastal provinces kept their harbours, the league kept the mountain passes, and both agreed to submit any future dispute over the river crossings to an elected arbiter.

The forty years after the treaty are usually described as the Ashgrove period. Trade grew, and the arbiter was called upon eleven times. The period ended with the harbour reforms of 1889.`,
  biology: `Photosynthesis converts light energy into chemical energy. Chlorophyll in the chloroplasts absorbs light, water is split, and carbon dioxide is fixed into glucose. Respiration runs the reaction in the other direction: glucose and oxygen are consumed, and carbon dioxide, water and usable energy are produced.

The teaching model used in this course calls the simplified four-stage version of the light-independent reactions the Calloway cycle. The four stages are fixation, reduction, release and regeneration.`,
};

const ON_TOPIC: Array<[string, string]> = [
  ["physics", "What is the value of the Marrow constant, and what is it used for?"],
  ["physics", "Explain how heat, thermal capacity and thermal equilibrium relate to each other."],
  ["physics", "What does F = ma mean?"],
  ["chemistry", "What is tanzanite-9 used for and how long is its half-life?"],
  ["chemistry", "What is the difference between an ionic and a covalent bond?"],
  ["history", "When was the Treaty of Ashgrove signed, and what did it settle?"],
  ["history", "How did the Ashgrove period end?"],
  ["biology", "What are the four stages of the Calloway cycle?"],
  ["biology", "How is respiration related to photosynthesis?"],
];

const OFF_TOPIC = [
  "Write me a two-line rhyme about a bicycle courier in the rain.",
  "How long should I bake banana bread, and at what temperature?",
  "Why does my CSS flexbox not centre the div vertically?",
  "Hi! How are you today?",
  "What should I wear if it's going to rain tomorrow?",
  "Can you recommend a good fantasy book series?",
];

const signal = new AbortController().signal;
const options = defaultChunkOptions(model.maxInputChars);

async function embed(texts: string[], purpose: "document" | "query") {
  const result = await provider.embed!(
    { model: model!.id, texts, purpose, dimensions: model!.dimensions },
    { apiKey },
    signal
  );

  if (result.vectors.length !== texts.length) {
    throw new Error(`asked for ${texts.length} vectors, got ${result.vectors.length}`);
  }

  return result.vectors;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

console.log(`\nEMBEDDING THRESHOLD — ${model.provider}:${model.id} (${model.dimensions} dims)\n`);

const chunks: Array<{ doc: string; text: string; vector: number[] }> = [];

for (const [doc, text] of Object.entries(DOCS)) {
  const pieces = chunkText(text, options).map((chunk) => chunk.content);
  const vectors = await embed(pieces, "document");
  pieces.forEach((piece, index) => chunks.push({ doc, text: piece, vector: vectors[index] }));
}

console.log(`  ${chunks.length} chunks embedded from ${Object.keys(DOCS).length} documents`);

const onVectors = await embed(ON_TOPIC.map(([, q]) => q), "query");
const offVectors = await embed(OFF_TOPIC, "query");

const onScores = ON_TOPIC.map(([doc, question], index) => {
  const best = Math.max(
    ...chunks.filter((chunk) => chunk.doc === doc).map((chunk) => cosine(onVectors[index], chunk.vector))
  );
  return { question, best };
});

const offScores = OFF_TOPIC.map((question, index) => ({
  question,
  best: Math.max(...chunks.map((chunk) => cosine(offVectors[index], chunk.vector))),
}));

console.log("\n  questions the documents answer (best match in their own document):");
for (const { question, best } of onScores) console.log(`    ${best.toFixed(3)}  ${question}`);

console.log("\n  questions nothing answers (best match anywhere):");
for (const { question, best } of offScores) console.log(`    ${best.toFixed(3)}  ${question}`);

const lowestOn = Math.min(...onScores.map((score) => score.best));
const highestOff = Math.max(...offScores.map((score) => score.best));
const gap = lowestOn - highestOff;
const midpoint = Math.round(((lowestOn + highestOff) / 2) * 100);

console.log("\n=== RESULT ===");
console.log(`  lowest relevant score   ${lowestOn.toFixed(3)}`);
console.log(`  highest irrelevant      ${highestOff.toFixed(3)}`);
console.log(`  gap                     ${gap.toFixed(3)}`);
console.log(`  current floor           ${retrieval.minSimilarityPercent}%`);

if (gap <= 0) {
  console.log("  NO GAP — the populations overlap; a single floor cannot separate them.");
  process.exit(2);
}

console.log(`  suggested floor         ${midpoint}%  (middle of the gap)`);
