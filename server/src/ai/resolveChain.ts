import { geminiApiKey, limitsFor } from "./config";
import { allModels, PUBLIC_MODEL_ID } from "./models";
import { configuredChain, keyFor, type ChainEntry } from "./providerChain";
import { registerProviders } from "./providers";
import type {
  ChainCandidate,
  ProviderCredentials,
  ProviderId,
  ResolvedPowerSource,
} from "./types";

/*
 * Who can answer this request, in the order they should be
 * tried.
 *
 * Replaces PowerSourceResolver, which answered a different
 * question — "platform or BYOK, and with whose key?" — because
 * there is only one answer to that now. BuildGentic pays for
 * everything, nobody brings a key, and the interesting question
 * became "which of my four providers is free right now?".
 *
 * This is the ONLY file that turns an environment variable into
 * a credential. Nothing above it reads a key, and the map it
 * produces is never serialised, never logged and never leaves
 * the process.
 *
 * NOT STICKY. This is called fresh on every request and always
 * walks the chain from the top, so a learner who fell through to
 * Mistral a moment ago is back on Groq the instant Groq is free.
 * There is deliberately no per-user or per-session state here to
 * remember otherwise.
 */

/*
 * With no keys configured at all, the chain falls back to the
 * mock rather than failing.
 *
 * Deliberate, and it is what makes the repo runnable: a fresh
 * clone with an empty .env still streams, still records usage,
 * still enforces quotas and still spends XP. The alternative — a
 * hard error — would mean the AI half of the app could only be
 * developed by someone holding four billable keys.
 *
 * Carried over from the old resolver, which made the same
 * promise for the same reason.
 */
const MOCK_CANDIDATE: ChainCandidate = {
  providerId: "mock",
  model: PUBLIC_MODEL_ID,
  credentials: {},
  entry: null,
};

function candidateFor(entry: ChainEntry): ChainCandidate | null {
  const apiKey = keyFor(entry);

  if (!apiKey) {
    return null;
  }

  return {
    providerId: entry.providerId,
    model: entry.model,
    /* The one place a key is attached to a request. */
    credentials: { apiKey },
    entry,
    ...(entry.thinking ? { thinking: entry.thinking } : {}),
  };
}

/*
 * Every provider that could answer, in chain order.
 *
 * Availability — "is this one busy right now?" — is NOT decided
 * here. ProviderHealth answers that at the moment of the
 * attempt, because a window that was full when the request
 * arrived may have drained by the time the third candidate is
 * reached.
 */
export function chainCandidates(): ChainCandidate[] {
  const candidates = configuredChain()
    .map(candidateFor)
    .filter((candidate): candidate is ChainCandidate => candidate !== null);

  return candidates.length > 0 ? candidates : [MOCK_CANDIDATE];
}

/*
 * The credential map.
 *
 * Holds every key this server has, keyed by provider, because
 * EmbeddingRuntime resolves its model out of exactly this map —
 * an embedding is a model call and goes through the same quota
 * gate as a completion, it just does not go through the cascade.
 *
 * Gemini appears here and in no candidate list, which is the
 * shape of the current transition: it can still produce the
 * 768-dimension vectors every indexed chunk was built with, and
 * it can no longer answer a single learner's prompt.
 */
function credentialMap(
  candidates: ChainCandidate[]
): Map<ProviderId, ProviderCredentials> {
  const credentials = new Map<ProviderId, ProviderCredentials>();

  for (const candidate of candidates) {
    credentials.set(candidate.providerId, candidate.credentials);
  }

  if (geminiApiKey) {
    credentials.set("gemini", { apiKey: geminiApiKey });
  }

  /* No real key anywhere: the mock has to be able to embed too,
     or a keyless clone can index nothing. */
  if (credentials.size === 0 || candidates[0] === MOCK_CANDIDATE) {
    credentials.set("mock", {});
  }

  return credentials;
}

export function resolveChain(userId: string): ResolvedPowerSource {
  registerProviders();

  const candidates = chainCandidates();

  return {
    kind: "platform",
    /*
     * Counted per learner. This traffic is ALSO counted
     * platform-wide by the admission function, which is what
     * bounds BuildGentic's own bill — per-user limits alone never
     * could, because the number of users is not bounded.
     */
    quotaKey: `platform:${userId}`,
    limits: limitsFor(),
    allowedModels: allModels(),
    defaultModel: PUBLIC_MODEL_ID,
    credentials: credentialMap(candidates),
    candidates,
  };
}

/*
 * Kept async, and kept under the old name, because
 * EmbeddingRuntime and the deployment path both await it and
 * neither has any reason to care that resolution stopped needing
 * a database round trip when BYOK went away.
 */
export async function resolvePowerSource(
  userId: string
): Promise<ResolvedPowerSource> {
  return resolveChain(userId);
}
