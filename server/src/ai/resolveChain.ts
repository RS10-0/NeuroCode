import { limitsFor } from "./config";
import { accountMayUseTrainingProviders } from "../account/AgeGate";
import { AiRuntimeError } from "./errors";
import { allModels, PUBLIC_MODEL_ID } from "./models";
import {
  configuredChain,
  keyFor,
  withoutTrainingProviders,
  type ChainEntry,
} from "./providerChain";
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
 * Holds the key of every provider that may serve this request,
 * keyed by provider, because EmbeddingRuntime resolves its model
 * out of exactly this map — an embedding is a model call and
 * goes through the same quota gate as a completion, it just does
 * not go through the cascade.
 *
 * Built from the candidates, so it narrows with them: an account
 * kept to the non-training providers cannot embed with anything
 * else either. Gemini used to be added here unconditionally as
 * the embedding model; it was removed for the reasons given in
 * embeddingModels.ts, and NEUROLINK_GEMINI_API_KEY now reaches
 * nothing.
 */
function credentialMap(
  candidates: ChainCandidate[]
): Map<ProviderId, ProviderCredentials> {
  const credentials = new Map<ProviderId, ProviderCredentials>();

  for (const candidate of candidates) {
    credentials.set(candidate.providerId, candidate.credentials);
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
 * The chain this learner may actually use.
 *
 * Every real model call in the server resolves through here —
 * chat, the Lab, agent tests, published pages and deployments
 * (resolved for the OWNER), schedules, web search, file analysis
 * and embeddings — so this is the one place the age rule has to
 * live to cover all of them.
 *
 * An account that may not reach a training provider (under 13,
 * or not yet asked; see account/rules.ts) gets the chain with
 * every `trainsOnPrompts` entry removed, and the credential map
 * rebuilt from what is left. The offline mock stays: it trains
 * nothing and is what a keyless clone runs on.
 *
 * Async because the age lookup is; it is cached for a minute in
 * AgeGate, so this is not a database round trip per request.
 */
export async function resolvePowerSource(
  userId: string
): Promise<ResolvedPowerSource> {
  const source = resolveChain(userId);

  if (await accountMayUseTrainingProviders(userId)) {
    return source;
  }

  const candidates = withoutTrainingProviders(source.candidates ?? []);

  /*
   * Every non-training provider unconfigured. Refused rather than
   * quietly handed the training ones: that would be the exact
   * leak this function exists to stop. Worded like any other
   * provider outage, because to the learner that is what it is.
   */
  if (candidates.length === 0) {
    throw new AiRuntimeError(
      "provider_unavailable",
      "BuildGentic's AI isn't available right now. Please try again later.",
      {
        internalDetail:
          "no non-training provider is configured (need Groq or Cloudflare) for an account kept off training providers",
      }
    );
  }

  return {
    ...source,
    credentials: credentialMap(candidates),
    candidates,
  };
}
