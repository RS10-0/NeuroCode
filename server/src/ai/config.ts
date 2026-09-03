import "dotenv/config";

import type { SearchProviderId } from "../search/types";

import { describeChain } from "./providerChain";

import type {
  PlatformBudget,
  QuotaLimits,
} from "./types";

/*
 * Every knob the AI runtime has, read from the environment once.
 *
 * Two rules hold everywhere below.
 *
 * Nothing here is prefixed VITE_, so nothing here can reach the
 * browser: Vite only inlines VITE_* into the bundle, and this
 * file is server-only anyway. Keys are read here and nowhere
 * else, and they are never logged, never returned, and never put
 * in an error message.
 *
 * Every limit has a default that works. A fresh clone with an
 * empty .env runs — on the mock provider, with sane quotas —
 * rather than crashing at import time the way lib/supabase.ts
 * deliberately does. Supabase is load-bearing for the whole app;
 * an AI key is load-bearing for one feature.
 */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    console.warn(
      `[ai] ${name} is not a non-negative number; using ${fallback}.`
    );
    return fallback;
  }

  return Math.floor(value);
}

function readString(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/* =========================================================
   CREDENTIALS

   The chat providers' keys are NOT here. They are read in
   providerChain.ts, which is the only place a completion's key
   comes from, so that adding or reordering a provider touches
   one file.

   What remains is the embedding key, which is deliberately
   outside the cascade: chat can fall through four providers and
   an embedding has nowhere to fall.

   WHAT USED TO BE HERE, and is gone: `platformProviderId`,
   `platformKeyFor` and `platformDefaultModel`, driven by
   NEUROLINK_PLATFORM_PROVIDER and NEUROLINK_PLATFORM_MODEL.
   They chose the one provider the runtime would use, which is a
   question the cascade answers per request now. Nothing read
   them after that change, so they were config that looked live
   and was not — the worst kind.

   NEUROLINK_PLATFORM_PROVIDER is still honoured for exactly one
   value: `mock`, which forces the offline provider. See
   offlineForced() in providerChain.ts.
========================================================= */

export const geminiApiKey = readString("NEUROLINK_GEMINI_API_KEY");

/*
 * OpenRouter attribution. Optional, and neither is a secret —
 * they are what OpenRouter shows on its own dashboards.
 */
export const openRouterReferer =
  readString("NEUROLINK_OPENROUTER_REFERER") ?? "https://buildgentic.com";

export const openRouterTitle =
  readString("NEUROLINK_OPENROUTER_TITLE") ?? "BuildGentic";

/* =========================================================
   REQUEST SHAPE LIMITS

   Checked before anything is sent anywhere, so an oversized
   request costs one JSON parse rather than a provider bill.
========================================================= */

export const requestLimits = {
  maxMessages: readInt("NEUROLINK_AI_MAX_MESSAGES", 40),
  maxMessageChars: readInt("NEUROLINK_AI_MAX_MESSAGE_CHARS", 12_000),
  maxSystemChars: readInt("NEUROLINK_AI_MAX_SYSTEM_CHARS", 8_000),
  /* A pasted provider key. Long enough for any format seen so
     far, short enough that nobody can post a novel. */
};

/* =========================================================
   PER-USER QUOTAS

   Per power source, because a learner spending BuildGentic's key
   and a learner spending their own are not the same risk.
========================================================= */

const platformLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_AI_REQUESTS_PER_MINUTE", 12),
  requestsPerDay: readInt("NEUROLINK_AI_REQUESTS_PER_DAY", 200),
  maxConcurrent: readInt("NEUROLINK_AI_MAX_CONCURRENT", 3),
  maxInputChars: readInt("NEUROLINK_AI_MAX_INPUT_CHARS", 24_000),
  maxOutputTokens: readInt("NEUROLINK_AI_MAX_OUTPUT_TOKENS", 1_024),
  /*
   * 60k tokens is roughly 100 full-sized turns, or several
   * hundred ordinary ones — generous for a learner, and a hard
   * stop long before the request counter alone would notice
   * somebody sending maximum-length prompts all day.
   */
  tokensPerDay: readInt("NEUROLINK_AI_TOKENS_PER_DAY", 60_000),
};

/*
 * The ceiling no power source may exceed, whoever is paying.
 * This is the abuse limit rather than the budget limit: it caps
 * what a single account can do to BuildGentic's server and to
 * BuildGentic's standing with a provider.
 */
const globalCeiling: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_AI_CEILING_REQUESTS_PER_MINUTE", 90),
  requestsPerDay: readInt("NEUROLINK_AI_CEILING_REQUESTS_PER_DAY", 5_000),
  maxConcurrent: readInt("NEUROLINK_AI_CEILING_MAX_CONCURRENT", 8),
  maxInputChars: readInt("NEUROLINK_AI_CEILING_MAX_INPUT_CHARS", 120_000),
  maxOutputTokens: readInt("NEUROLINK_AI_CEILING_MAX_OUTPUT_TOKENS", 8_192),
  tokensPerDay: readInt("NEUROLINK_AI_CEILING_TOKENS_PER_DAY", 4_000_000),
};

/*
 * A zero means "no limit" in the SQL, so it must not be clamped
 * to the ceiling — otherwise turning a limit off in development
 * would silently turn it back on at the ceiling's value.
 */
function clamp(value: number, ceiling: number): number {
  if (value <= 0) {
    return 0;
  }

  return Math.min(value, ceiling);
}

/* =========================================================
   DEPLOYMENT LIMITS

   A deployed agent answers strangers, so it gets a ceiling of
   its own on top of its owner's.

   This is not a second budget and it does not replace anything:
   a deployed call is still counted against the owner's quota key
   and, on the platform source, still counted against BuildGentic's
   platform budget, because the owner is still who pays. What
   these bound is one endpoint. Without them, an integration
   stuck in a retry loop spends a learner's entire day before
   they open the Deploy screen, and takes their Lab and Builder
   with it.

   Deliberately below the per-user platform allowance, so the
   deployment runs out before the learner does.
========================================================= */

export interface DeploymentLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
}

export const deploymentLimits: DeploymentLimits = {
  requestsPerMinute: readInt("NEUROLINK_DEPLOYMENT_REQUESTS_PER_MINUTE", 20),
  requestsPerDay: readInt("NEUROLINK_DEPLOYMENT_REQUESTS_PER_DAY", 500),
  maxConcurrent: readInt("NEUROLINK_DEPLOYMENT_MAX_CONCURRENT", 4),
};

/*
 * The origin a deployed agent's endpoint is reached at.
 *
 * Shown on the Deploy screen and pasted into a curl example, so
 * it has to be the address a caller outside this machine would
 * actually use — which the server cannot infer from a request it
 * has not received yet. Falls back to localhost, which is right
 * in development and obviously wrong in production, where it is
 * meant to be set.
 */
export const publicApiBaseUrl =
  readString("NEUROLINK_PUBLIC_API_URL")?.replace(/\/+$/, "") ??
  `http://localhost:${process.env.PORT ?? 3001}`;

/* =========================================================
   PUBLISHED PAGE LIMITS

   A published page answers strangers who present nothing at
   all, which is one step further out than a deployment and
   gets a correspondingly tighter ceiling.

   The difference between this and `deploymentLimits` is not
   really about volume, it is about who is on the other end. A
   deployment key is held by somebody the owner chose to give it
   to; a page URL is held by anybody it was ever forwarded to.
   So the failure mode is different too — not a retry loop, but
   a link that gets shared further than its author expected on
   an afternoon they are not watching.

   These are ADDITIONAL, exactly as the deployment limits are.
   A page request is still counted against its owner's quota
   key, still counted against BuildGentic's platform budget when
   it is platform-powered, and still counted in the deployment's
   own windows — the owner still pays, and this only bounds one
   door.
========================================================= */

export interface SiteLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
  /*
   * How much conversation a visitor may send back.
   *
   * Below the runtime's own message ceiling on purpose. A long
   * transcript is a large prompt, and a large prompt on a page
   * anybody can open is the cheapest way to spend somebody
   * else's tokens. The browser trims to match, so a long
   * conversation loses its oldest turns rather than being
   * refused.
   */
  maxMessages: number;
  /*
   * Requests per minute from one visitor, held in memory rather
   * than in the database.
   *
   * The other limits here are per SITE, which is what protects
   * the owner's allowance. This one is per CALLER, and it is
   * what stops a single script from consuming the whole site
   * ceiling in ten seconds and locking out the actual readers.
   *
   * In memory because it needs to be checked before any work
   * happens, including before the row that would otherwise
   * record it; a database round trip per request to protect
   * against a flood is a flood amplifier. It resets when the
   * process restarts, which is a real weakness and an accepted
   * one: the per-site database ceiling is the limit that
   * actually bounds spend, and this only smooths who gets it.
   */
  visitorRequestsPerMinute: number;
}

export const siteLimits: SiteLimits = {
  requestsPerMinute: readInt("NEUROLINK_SITE_REQUESTS_PER_MINUTE", 10),
  requestsPerDay: readInt("NEUROLINK_SITE_REQUESTS_PER_DAY", 200),
  maxConcurrent: readInt("NEUROLINK_SITE_MAX_CONCURRENT", 3),
  maxMessages: readInt("NEUROLINK_SITE_MAX_MESSAGES", 20),
  visitorRequestsPerMinute: readInt("NEUROLINK_SITE_VISITOR_PER_MINUTE", 6),
};

/*
 * The origin a published page is reached at.
 *
 * Distinct from `publicApiBaseUrl`, and the distinction is not
 * pedantry: that one is where the API answers, this one is
 * where a browser loads a page. In development they are two
 * different ports — Vite on 5173, Express on 3001 — and in
 * production they may be two different hosts entirely.
 *
 * Used to build the link a student copies and shares, so it has
 * to be the address somebody else's browser would actually
 * open. Falls back to the Vite dev server, which is right in
 * development and obviously wrong in production, where it is
 * meant to be set.
 */
export const publicSiteBaseUrl =
  readString("NEUROLINK_PUBLIC_SITE_URL")?.replace(/\/+$/, "") ??
  "http://localhost:5173";

/* =========================================================
   KNOWLEDGE RETRIEVAL

   The knobs that decide how an agent's knowledge is cut up,
   how much of it comes back for a question, and how much of
   that is allowed into the prompt.

   Every one of them is a trade a learner can be shown. Bigger
   chunks carry more context and match less precisely; a higher
   top-K finds more and dilutes more; a higher similarity floor
   answers "I do not know" more often and guesses less. None of
   them has a correct value, which is exactly why they are
   configuration rather than constants buried three files down.
========================================================= */

export const retrieval = {
  /*
   * Target size of one chunk, in characters.
   *
   * ~900 is a couple of paragraphs: big enough that a chunk
   * still means something on its own, small enough that a
   * question about one sentence does not drag a page of
   * unrelated text along with it.
   */
  chunkChars: readInt("NEUROLINK_KNOWLEDGE_CHUNK_CHARS", 900),

  /*
   * How much of the previous chunk is repeated at the start of
   * the next.
   *
   * Without an overlap, a fact that straddles a boundary is in
   * neither chunk in a usable form — the sentence that names the
   * subject lands in one and the sentence that answers the
   * question lands in the other. The cost is duplicated text and
   * therefore duplicated vectors, which is the cheaper problem.
   */
  chunkOverlap: readInt("NEUROLINK_KNOWLEDGE_CHUNK_OVERLAP", 150),

  /* How many chunks a question may pull back. */
  topK: readInt("NEUROLINK_RETRIEVAL_TOP_K", 6),

  /*
   * The similarity a chunk must reach to be sent at all, on a
   * 0-1 cosine scale.
   *
   * The floor is what makes "no relevant knowledge" a real
   * answer rather than a theoretical one: without it every
   * question retrieves the six least-irrelevant chunks in the
   * library, and an agent asked about the weather starts
   * quoting a chemistry note at it.
   *
   * 60 is measured rather than chosen. Across a corpus of four
   * unrelated subjects, gemini-embedding-001 at 768 dimensions
   * scores a question against its own subject at 0.695-0.791,
   * and scores a question about something else entirely — a
   * rhyme, a recipe, a CSS problem, a greeting — at 0.480-0.549
   * against its BEST match. Two clearly separated populations
   * with a gap of about 0.15 between them, and this sits in the
   * middle of that gap.
   *
   * The middle rather than the edge, and that was learned the
   * hard way: 0.55 looked safe against the measurements and
   * still let an off-topic question through on the first run,
   * because the highest irrelevant score sat 0.001 below it.
   * A threshold with no margin is a threshold that holds until
   * the corpus changes slightly.
   *
   * The number is this high because embedding similarity is not
   * an intuitive scale. Nothing is ever near zero: any two
   * pieces of English prose have a great deal in common
   * compared to random noise. A floor picked by intuition lands
   * around 0.2, lets everything through, and produces an agent
   * that quotes a chemistry note at somebody asking for a poem.
   *
   * Re-measure it if the embedding model changes. Different
   * models have entirely different scales, and a floor tuned
   * for one means nothing on another.
   *
   * A whole number of percent, because an env var holding 0.60
   * is one slipped decimal point away from disabling the floor.
   */
  minSimilarityPercent: readInt("NEUROLINK_RETRIEVAL_MIN_SIMILARITY", 60),

  /*
   * A second floor, relative to the best match this question
   * found, as a percentage of it.
   *
   * The absolute floor above decides whether the agent knows
   * anything about the question at all. This one decides how
   * much of the tail is worth sending once it does — and the
   * two answer genuinely different questions, which is why one
   * number cannot do both jobs.
   *
   * A question with a 0.79 match and a 0.58 match has found one
   * passage that answers it and one that merely shares its
   * vocabulary. Sending both dilutes the context and invites
   * the model to blend them. Keeping anything within 80% of the
   * best match keeps genuine runners-up — a document split
   * across two chunks scores both at nearly the same level —
   * and drops the rest.
   *
   * Set to 0 to disable and let top-K and the absolute floor
   * decide alone.
   */
  relativeFloorPercent: readInt("NEUROLINK_RETRIEVAL_RELATIVE_FLOOR", 80),

  /*
   * The ceiling on retrieved text in one prompt, in characters.
   *
   * Additional to maxSystemChars rather than carved out of it,
   * so turning retrieval on never shrinks the space a learner's
   * own instructions get. Both together stay well inside
   * maxInputChars, which is the limit that actually protects the
   * bill.
   */
  contextChars: readInt("NEUROLINK_RETRIEVAL_CONTEXT_CHARS", 4_000),

  /*
   * How many chunks one indexing request will embed before
   * handing back and asking to be called again.
   *
   * Indexing is synchronous — there is no job queue in this
   * project and adding one to chunk a text file would be a
   * strange place to spend the phase. The cap is what keeps a
   * large paste from becoming a request that runs until a proxy
   * gives up on it.
   */
  maxChunksPerRequest: readInt("NEUROLINK_INDEX_MAX_CHUNKS_PER_REQUEST", 200),

  /* Whole-request budget for one embedding call. */
  timeoutMs: readInt("NEUROLINK_EMBED_TIMEOUT_MS", 30_000),
};

/* 0-1, which is what the SQL and the ranker actually use. */
export const retrievalMinSimilarity =
  Math.max(0, Math.min(100, retrieval.minSimilarityPercent)) / 100;

/* 0-1. Zero disables the relative floor entirely. */
export const retrievalRelativeFloor =
  Math.max(0, Math.min(100, retrieval.relativeFloorPercent)) / 100;

/* =========================================================
   EMBEDDING QUOTAS

   Embeddings are counted, and counted separately.

   Counted, because an embedding is a model call somebody pays
   for and nothing in this runtime is allowed to skip the gate.
   Separately, because a retrieval-backed turn is two calls —
   one to embed the question, one to answer it — and charging
   both to the same per-minute window would halve what a learner
   can do the moment they turn the capability on. A learner
   should not be rate-limited out of their own Lab by an agent
   looking something up.

   So embedding traffic gets its own quota key
   (`embed:platform:<userId>`) and its own windows. It is still
   atomic, still server-side, still in ai_usage, and — on the
   platform power source — still inside BuildGentic's platform
   budget, which is counted per power source and not per key.
========================================================= */

const platformEmbeddingLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_EMBED_REQUESTS_PER_MINUTE", 60),
  requestsPerDay: readInt("NEUROLINK_EMBED_REQUESTS_PER_DAY", 600),
  maxConcurrent: readInt("NEUROLINK_EMBED_MAX_CONCURRENT", 4),
  /* Per batch, and generous: 32 chunks of 900 characters is
     under 30k, and the chunker never exceeds that. */
  maxInputChars: readInt("NEUROLINK_EMBED_MAX_INPUT_CHARS", 60_000),
  /* An embedding produces no output tokens. Present because the
     shape is shared; zero means the clamp never bites. */
  maxOutputTokens: 0,
  tokensPerDay: readInt("NEUROLINK_EMBED_TOKENS_PER_DAY", 400_000),
};

export function limitsFor(): QuotaLimits {
  const base = platformLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
    maxOutputTokens: clamp(base.maxOutputTokens, globalCeiling.maxOutputTokens),
    tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
  };
}

/*
 * The same clamping as limitsFor, against the same global
 * ceiling. Embedding traffic gets its own windows, not its own
 * exemption: a runaway indexer is still one account hammering
 * BuildGentic's server from BuildGentic's IP.
 */
export function embeddingLimitsFor(): QuotaLimits {
  const base = platformEmbeddingLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
    maxOutputTokens: 0,
    tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
  };
}

/* =========================================================
   WEB SEARCH

   The knobs that decide who searches, how many questions one
   turn may ask the web, and how much of what comes back is
   allowed into the prompt.

   Like the retrieval block above, every one of these is a trade
   rather than a correct value. More queries find more and cost
   more; more results per query dilute the good ones; a bigger
   context budget crowds out the agent's own instructions. They
   are configuration for exactly that reason.
========================================================= */

/*
 * Which search provider answers.
 *
 * DuckDuckGo is the default because it needs no key. That is
 * the same reasoning that put a mock behind the AI runtime: a
 * fresh clone has to be able to run the whole capability, and a
 * feature that only works once somebody has signed up for a
 * search API is a feature most learners never see.
 *
 * `brave` and `tavily` are fully implemented and one variable
 * away, and both are better at this job — they return cleaner
 * results, they publish dates, and they are meant to be called
 * by a program. Set the key and name the provider.
 *
 * `mock` forces the offline provider even when a key is set,
 * which is what the verification suite uses to assert on
 * ranking without depending on what the live web says today.
 */
const SEARCH_PROVIDERS: SearchProviderId[] = [
  "duckduckgo",
  "brave",
  "tavily",
  "mock",
];

const configuredSearchProvider = readString("NEUROLINK_WEB_SEARCH_PROVIDER");

export const searchProviderId: SearchProviderId = SEARCH_PROVIDERS.includes(
  configuredSearchProvider as SearchProviderId
)
  ? (configuredSearchProvider as SearchProviderId)
  : "duckduckgo";

export const braveSearchKey = readString("NEUROLINK_BRAVE_SEARCH_KEY");
export const tavilyApiKey = readString("NEUROLINK_TAVILY_API_KEY");

/* The key for whichever search provider is configured. Read
   here and nowhere else, exactly like a model provider's. */
export function searchKeyFor(provider: SearchProviderId): string | undefined {
  switch (provider) {
    case "brave":
      return braveSearchKey;

    case "tavily":
      return tavilyApiKey;

    default:
      /* DuckDuckGo needs none, and neither does the mock. */
      return undefined;
  }
}

export const webSearch = {
  /*
   * How many separate questions one turn may ask the web.
   *
   * Two rather than one because a question often has two halves
   * — "compare X and Y" is two searches and one answer — and
   * two rather than five because each is a provider round trip
   * a learner waits through, and the returns fall off a cliff.
   */
  maxQueries: readInt("NEUROLINK_WEB_SEARCH_MAX_QUERIES", 2),

  /* One query. Long enough for a real sentence, short enough
     that nobody can post a paragraph to a search engine. */
  maxQueryChars: readInt("NEUROLINK_WEB_SEARCH_QUERY_CHARS", 200),

  /* Results per query, before the context budget decides how
     many actually fit. */
  maxResultsPerQuery: readInt("NEUROLINK_WEB_SEARCH_RESULTS_PER_QUERY", 5),

  /* Results across all queries in one turn, after duplicates
     have been merged. */
  maxResults: readInt("NEUROLINK_WEB_SEARCH_MAX_RESULTS", 6),

  /*
   * How much of one result's description reaches the model.
   *
   * A search snippet is the only text BuildGentic has about a
   * page — see the note in search/types.ts on why the page
   * itself is never fetched — so this is the whole of what the
   * agent gets to read per source.
   */
  snippetChars: readInt("NEUROLINK_WEB_SEARCH_SNIPPET_CHARS", 500),

  /*
   * The ceiling on web results in one prompt, in characters.
   *
   * Additional to maxSystemChars, the same way the retrieval
   * budget is, so switching this capability on never shrinks
   * the space a learner's own instructions get. All three
   * together stay well inside maxInputChars.
   */
  contextChars: readInt("NEUROLINK_WEB_SEARCH_CONTEXT_CHARS", 4_000),

  /* Whole-request budget for one search provider call. */
  timeoutMs: readInt("NEUROLINK_WEB_SEARCH_TIMEOUT_MS", 12_000),

  /*
   * The output cap on the decision call — the small model call
   * that reads the question and answers "should this be looked
   * up, and what would you type into a search box?".
   *
   * Small on purpose: it writes a few dozen characters of
   * JSON, and a large cap here would only pay for a model that
   * decided to explain itself at length.
   *
   * Not as small as it looks, though, and 200 was measured to be
   * too small. Models that think before answering spend part of
   * this budget on tokens nobody sees, and when the thinking
   * uses it all the reply comes back empty and the agent
   * silently does not search. The headroom is for that, not for
   * the answer.
   */
  planTokens: readInt("NEUROLINK_WEB_SEARCH_PLAN_TOKENS", 400),

  /*
   * How many recent turns the decision call gets to see.
   *
   * More than one, because "and what about Yale?" is only a
   * searchable question if you can see what was asked before
   * it. Not the whole conversation, because the decision is
   * about the question just asked and a long history buries it.
   */
  planTurns: readInt("NEUROLINK_WEB_SEARCH_PLAN_TURNS", 4),

  /* How much of the agent's own instructions the decision call
     sees. Enough to know what the agent is for. */
  planInstructionChars: readInt(
    "NEUROLINK_WEB_SEARCH_PLAN_INSTRUCTION_CHARS",
    1_500
  ),
};

/* =========================================================
   WEB SEARCH QUOTAS

   Searching is counted, and counted in its own windows, for
   exactly the reason embeddings are: a search-backed turn is
   three calls — decide, search, answer — and charging all of
   them to the per-minute window a learner uses for the Lab
   would cut what they can do to a third the moment they switch
   the capability on.

   Its own quota key (`search:platform:<userId>`), its own
   windows, and no exemption from anything else: still atomic,
   still enforced in SQL, still written to ai_usage, and — on
   the platform power source — still inside BuildGentic's platform
   budget, which is counted per power source rather than per
   key.
========================================================= */

const platformSearchLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_WEB_SEARCH_REQUESTS_PER_MINUTE", 60),
  requestsPerDay: readInt("NEUROLINK_WEB_SEARCH_REQUESTS_PER_DAY", 600),
  maxConcurrent: readInt("NEUROLINK_WEB_SEARCH_MAX_CONCURRENT", 4),
  /* The decision call's input: a slice of instructions plus a
     few turns. Nothing here approaches it. */
  maxInputChars: readInt("NEUROLINK_WEB_SEARCH_MAX_INPUT_CHARS", 24_000),
  maxOutputTokens: readInt("NEUROLINK_WEB_SEARCH_MAX_OUTPUT_TOKENS", 512),
  tokensPerDay: readInt("NEUROLINK_WEB_SEARCH_TOKENS_PER_DAY", 200_000),
};

/*
 * The same clamping as limitsFor, against the same global
 * ceiling. Search traffic gets its own windows, not its own
 * exemption: a runaway agent is still one account hammering
 * BuildGentic's server from BuildGentic's IP.
 */
export function searchLimitsFor(): QuotaLimits {
  const base = platformSearchLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
    maxOutputTokens: clamp(base.maxOutputTokens, globalCeiling.maxOutputTokens),
    tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
  };
}

/* =========================================================
   NATURAL-LANGUAGE PAGE EDITS

   The Phase 2 seam on published pages: a student types "make
   the background darker" and one small model call turns it
   into a field change.

   Its own quota window, the same shape Web Search has and for
   the same reason recorded there — designing a page is a
   second call on top of whatever else the student is doing,
   and charging it to their chat window would mean laying out
   a page eats the allowance for testing the agent it is a page
   for.

   The output cap is the one number here worth a sentence. The
   call returns a list of operations, not a page, so it is
   small — but a request that rewrites an FAQ returns every
   item, and 1500 tokens is roughly the largest honest answer
   the operation vocabulary can produce. Below that the model
   truncates mid-JSON and the student is told their answer was
   cut off, which is a confusing way to learn they asked for
   too much at once.
========================================================= */

const platformSiteEditLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_SITE_EDIT_REQUESTS_PER_MINUTE", 10),
  requestsPerDay: readInt("NEUROLINK_SITE_EDIT_REQUESTS_PER_DAY", 120),
  maxConcurrent: readInt("NEUROLINK_SITE_EDIT_MAX_CONCURRENT", 2),
  /* The prompt carries the whole page outline plus the
     request. A full eight-section page is well under this. */
  maxInputChars: readInt("NEUROLINK_SITE_EDIT_MAX_INPUT_CHARS", 24_000),
  maxOutputTokens: readInt("NEUROLINK_SITE_EDIT_MAX_OUTPUT_TOKENS", 1500),
  tokensPerDay: readInt("NEUROLINK_SITE_EDIT_TOKENS_PER_DAY", 150_000),
};

export const siteEditLimits = {
  /* What a student may type. Long enough for a paragraph
     describing several changes, short enough that the prompt
     stays dominated by the page rather than by the request. */
  maxRequestChars: readInt("NEUROLINK_SITE_EDIT_MAX_REQUEST_CHARS", 600),
  maxOutputTokens: platformSiteEditLimits.maxOutputTokens,

  /* Clamped against the same global ceiling everything else
     is. Its own windows, not its own exemption. */
  get quota(): QuotaLimits {
    const base = platformSiteEditLimits;

    return {
      requestsPerMinute: clamp(
        base.requestsPerMinute,
        globalCeiling.requestsPerMinute
      ),
      requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
      maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
      maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
      maxOutputTokens: clamp(
        base.maxOutputTokens,
        globalCeiling.maxOutputTokens
      ),
      tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
    };
  },
};

/* =========================================================
   FILE ANALYSIS

   Every ceiling on an attached file, in one place.

   These are safety limits before they are product limits, and
   the difference matters to how they are written. An uploaded
   file is the most hostile input BuildGentic accepts: somebody
   else's bytes, in a container format, parsed by code that has
   to assume the worst about every length field it reads. So
   each number below bounds a specific way that can go wrong —
   how much memory one request may claim, how long a parser may
   run, how much of somebody's document may reach a prompt, and
   how many of them may be in flight at once.

   Every one of them is an environment variable rather than a
   literal three files down, for the reason the retrieval and
   search blocks are: none of these has a correct value, they
   are all trades, and an operator running BuildGentic for a
   class of forty has different answers than one running it for
   themselves.
========================================================= */

export const fileAnalysis = {
  /*
   * The biggest file that may be uploaded at all, in bytes.
   *
   * 8 MB covers a long PDF report, a spreadsheet with tens of
   * thousands of rows, and a photograph off a phone. It is
   * deliberately below what a naive learner would try with a
   * scanned book, because the honest failure for that is a
   * refusal naming the size rather than ninety seconds of
   * parsing followed by a timeout.
   */
  maxFileBytes: readInt("NEUROLINK_FILE_MAX_BYTES", 8 * 1024 * 1024),

  /*
   * Images separately, and lower.
   *
   * An image is not extracted to text — it is base64'd and sent
   * to the model, so its size is a direct cost on the request
   * rather than an input to a parser that shrinks it. 4 MB is
   * more than any provider will accept inline anyway.
   */
  maxImageBytes: readInt("NEUROLINK_FILE_MAX_IMAGE_BYTES", 4 * 1024 * 1024),

  /*
   * Pixels. A 60-megapixel panorama is a decompression bomb
   * shaped like a holiday photo: small on disk, enormous once
   * a provider decodes it.
   */
  maxImagePixels: readInt("NEUROLINK_FILE_MAX_IMAGE_PIXELS", 40_000_000),

  /* How many files may be attached to one message. */
  maxFilesPerMessage: readInt("NEUROLINK_FILE_MAX_PER_MESSAGE", 4),

  /*
   * How many images may be attached to one message.
   *
   * Lower than the file limit, because each one is a large
   * payload and a large per-image token charge on a provider
   * that bills for them.
   */
  maxImagesPerMessage: readInt("NEUROLINK_FILE_MAX_IMAGES_PER_MESSAGE", 2),

  /*
   * How many uploads one learner may be holding at once.
   *
   * The store is in memory (see files/FileStore.ts), so this is
   * the ceiling on what a single account can make this process
   * hold. Old entries are evicted rather than the upload being
   * refused: a learner who attaches five files in a row should
   * see the fifth work, not an error about the first.
   */
  maxHeld: readInt("NEUROLINK_FILE_MAX_HELD_PER_USER", 12),

  /*
   * How much this process may be holding across everybody, in
   * bytes.
   *
   * The per-scope cap above bounds one learner. Only this bounds
   * a hundred of them, and the arithmetic is worth doing rather
   * than assuming: twelve attachments each, with images kept as
   * base64 at up to 4 MB, is around 65 MB per learner. A hundred
   * concurrent learners would be 6 GB, which is not a limit — it
   * is an outage.
   *
   * Reaching it evicts the oldest attachments anywhere in the
   * process, not just the newest caller's. That is the right way
   * round: the oldest are the ones whose conversation has moved
   * on, and refusing a fresh upload because somebody else's
   * half-hour-old spreadsheet is still resident would make one
   * learner's idleness another learner's error.
   */
  maxHeldBytes: readInt(
    "NEUROLINK_FILE_MAX_HELD_BYTES",
    256 * 1024 * 1024
  ),

  /*
   * How much text one file may contribute, in characters.
   *
   * A cut here is visible rather than silent — see
   * files/text.ts. A document longer than this reaches the
   * model with a line saying where it stopped, and the learner
   * is told the same thing in the Test panel, because "the
   * agent did not mention chapter nine" and "chapter nine was
   * never sent" are different problems with different fixes.
   *
   * MUST STAY BELOW `contextChars`, and the margin is not
   * decoration. The renderer drops a file that does not fit the
   * whole-prompt budget rather than cutting it a second time —
   * cutting twice would produce a document saying it was cut in
   * one place and actually cut in another. So if one file could
   * exceed the budget on its own, a learner attaching a single
   * long report would have it refused outright instead of
   * shortened, which is the worse of the two failures and was
   * exactly what the verification suite caught.
   *
   * The slack above this figure is what the fences, the
   * per-file headers and the section labels spend.
   */
  maxExtractedChars: readInt("NEUROLINK_FILE_MAX_EXTRACTED_CHARS", 10_000),

  /*
   * The ceiling on attached-file text in one prompt, across
   * every file on the message.
   *
   * Additional to maxSystemChars, exactly as the retrieval and
   * search budgets are, so attaching a file never shrinks the
   * space a learner's own instructions get.
   *
   * Sized against maxInputChars deliberately. With the platform
   * source's 24,000-character input budget, 12,000 here leaves
   * room for a full 8,000-character system prompt and a short
   * conversation — and the runtime fits the file block FIRST,
   * before knowledge and before the web, because a turn whose
   * whole subject is the attachment is not improved by dropping
   * the attachment to make room for a search.
   *
   * Raising this for heavier document work means raising
   * NEUROLINK_AI_MAX_INPUT_CHARS with it. On its own it would
   * only move which block gets dropped, because the input
   * ceiling is what actually bounds the bill.
   */
  contextChars: readInt("NEUROLINK_FILE_CONTEXT_CHARS", 12_000),

  /* Pages of a PDF read. Beyond this the extract says so. */
  maxPdfPages: readInt("NEUROLINK_FILE_MAX_PDF_PAGES", 60),

  /* Sheets of a workbook read. */
  maxSheets: readInt("NEUROLINK_FILE_MAX_SHEETS", 8),

  /* Rows per sheet, including the header row. */
  maxRows: readInt("NEUROLINK_FILE_MAX_ROWS", 400),

  /* Columns per sheet. */
  maxColumns: readInt("NEUROLINK_FILE_MAX_COLUMNS", 40),

  /* Characters in one spreadsheet cell before it is cut. */
  maxCellChars: readInt("NEUROLINK_FILE_MAX_CELL_CHARS", 300),

  /*
   * Whole-request budget for parsing one file.
   *
   * The limit that matters most, and the least obvious. Sizes
   * bound the input; only a clock bounds a parser that has been
   * handed a structure designed to make it loop.
   */
  extractTimeoutMs: readInt("NEUROLINK_FILE_EXTRACT_TIMEOUT_MS", 20_000),

  /*
   * How long an uploaded file stays available to attach, in
   * milliseconds.
   *
   * Short on purpose. The file exists to answer the question
   * being asked now; keeping it for a day would turn a
   * conversational attachment into storage nobody agreed to.
   * Thirty minutes is long enough to attach, read the answer,
   * and ask two follow-ups.
   */
  retentionMs: readInt("NEUROLINK_FILE_RETENTION_MS", 30 * 60 * 1000),

  /*
   * What one image is charged as, in tokens, for the quota
   * estimate and the input-size check.
   *
   * An image has no character count, so without a number here
   * it would be the one part of a request that nothing
   * measures — the same failure the runtime avoids by doing
   * retrieval before `admit` rather than after. Providers bill
   * images by tile and none of them publishes a formula worth
   * reimplementing, so this is a flat, deliberately generous
   * estimate rather than a calculation pretending to be exact.
   */
  imageTokenEstimate: readInt("NEUROLINK_FILE_IMAGE_TOKEN_ESTIMATE", 1_200),
};

/* =========================================================
   FILE ANALYSIS QUOTAS

   Extracting a file is counted, and counted in its own
   windows, for the reason searching and embedding are: a turn
   that analyses a file is an upload plus an answer, and
   charging both to the per-minute window a learner uses for
   the Lab would halve what they can do the moment they attach
   something.

   Its own quota key (`file:<power source>:<user id>`), its own
   windows, and no exemption from anything else: still atomic,
   still enforced in SQL, still written to ai_usage, and — on
   the platform power source — still inside BuildGentic's
   platform budget.

   Extraction spends no model tokens: the parsing happens in
   this process. What these windows bound is CPU and memory on
   BuildGentic's own server, which is a resource with no ai_usage
   token column and therefore needs the request counters to do
   the work.
========================================================= */

const platformFileLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_FILE_REQUESTS_PER_MINUTE", 20),
  requestsPerDay: readInt("NEUROLINK_FILE_REQUESTS_PER_DAY", 200),
  /* Parsing is CPU-bound and this process is single-threaded.
     Two at once is already a learner waiting. */
  maxConcurrent: readInt("NEUROLINK_FILE_MAX_CONCURRENT", 2),
  /* Not meaningful for an upload — the byte ceilings above are
     what bound it — and zero disables the check. */
  maxInputChars: 0,
  maxOutputTokens: 0,
  tokensPerDay: 0,
};

/*
 * The same clamping as limitsFor, against the same global
 * ceiling. File traffic gets its own windows, not its own
 * exemption: a learner looping an upload is still one account
 * saturating BuildGentic's CPU.
 */
export function fileLimitsFor(): QuotaLimits {
  const base = platformFileLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: 0,
    maxOutputTokens: 0,
    tokensPerDay: 0,
  };
}

/* =========================================================
   MEMORY

   The knobs that decide how much an agent may remember about
   one person, how much of it travels on a turn, and how hard
   it tries to work out which parts matter.

   Like every block above, each of these is a trade rather than
   a correct value — but the first two are load-bearing in a
   way the others are not, because together they are what keeps
   this a memory rather than a transcript. A big `maxMemories`
   and a big `maxContentChars` turn an agent's memory into a
   log of everything anybody ever said to it, which is both
   useless to a model and exactly the thing this capability was
   asked not to become.
========================================================= */

export const memory = {
  /*
   * How many memories one agent may hold about one person.
   *
   * A ceiling on the store, not on the prompt — `contextChars`
   * below is what bounds a turn. This is what stops a scope
   * growing without limit over months of conversations.
   *
   * At the cap the least recently used memory is evicted
   * rather than the write being refused. Refusing would mean
   * an agent that silently stops learning at some point its
   * owner never sees, and "it forgot the oldest thing it had
   * not used in a while" is the behaviour a person expects
   * from something called memory.
   */
  maxMemories: readInt("NEUROLINK_MEMORY_MAX_PER_SCOPE", 120),

  /*
   * The longest one memory may be.
   *
   * Enforced here, in the extractor's prompt, in the
   * validation of what comes back, and by a CHECK constraint
   * in the database. Four layers for one number, because this
   * is the single limit that decides whether a row is a fact
   * or a paragraph of conversation — and the database is the
   * only one of the four that cannot be talked out of it.
   */
  maxContentChars: readInt("NEUROLINK_MEMORY_MAX_CONTENT_CHARS", 400),

  /*
   * The ceiling on recalled memory in one prompt.
   *
   * Additional to maxSystemChars, exactly as the retrieval,
   * search and file budgets are, so switching Memory on never
   * shrinks the space a learner's own instructions get.
   *
   * Deliberately the smallest of the four context budgets.
   * Memory is a handful of short sentences about a person; if
   * it is competing with a knowledge base for room, something
   * has gone wrong with what is being remembered rather than
   * with this number.
   */
  contextChars: readInt("NEUROLINK_MEMORY_CONTEXT_CHARS", 3_000),

  /*
   * How many memories are carried on rank alone, before
   * relevance is consulted at all.
   *
   * This is the number that makes Memory work at the start of
   * a conversation, and it is the whole reason recall is not
   * simply a vector search like knowledge retrieval is.
   *
   * A new conversation opens with "hi" or "can you help me
   * with something". Embed that and nothing matches, so a
   * purely semantic recall would hand back nothing and the
   * agent would greet a learner it has been working with for
   * a month as a stranger — which is precisely the failure
   * this capability exists to fix. So the most recently useful
   * memories always travel, whatever was asked.
   */
  alwaysInclude: readInt("NEUROLINK_MEMORY_ALWAYS_INCLUDE", 6),

  /* Candidates the semantic tier may pull, once the always-on
     tier has been taken and there is still room. */
  topK: readInt("NEUROLINK_MEMORY_TOP_K", 10),

  /*
   * The similarity floor for that tier, as a percentage.
   *
   * Lower than retrieval's, on purpose. A knowledge chunk is a
   * paragraph and its floor decides whether an agent starts
   * quoting chemistry at a history question. A memory is one
   * short sentence about the person asking, so it embeds
   * thinly and the cost of carrying a marginal one is a few
   * dozen characters rather than a wrong answer.
   */
  minSimilarityPercent: readInt("NEUROLINK_MEMORY_MIN_SIMILARITY", 45),

  /*
   * How many recent turns the extraction call reads.
   *
   * Enough to resolve "yes, that one" against the question it
   * answers, and not enough to re-read a whole conversation on
   * every turn.
   */
  extractTurns: readInt("NEUROLINK_MEMORY_EXTRACT_TURNS", 6),

  /* Output cap on the extraction call. Three short sentences
     of JSON, with room for the model to be untidy about it. */
  extractTokens: readInt("NEUROLINK_MEMORY_EXTRACT_TOKENS", 500),

  /*
   * The most memories one turn may write or update.
   *
   * A cap on enthusiasm. Without it a single long message
   * about somebody's week produces eleven rows, most of which
   * are the same fact sliced differently, and the store fills
   * with noise that then crowds out the things that mattered.
   */
  maxPerTurn: readInt("NEUROLINK_MEMORY_MAX_PER_TURN", 3),

  /*
   * Below this many characters in the latest user turn, no
   * extraction call is made at all.
   *
   * "ok", "thanks", "yes please" and "what about the other
   * one" contain nothing durable, and they are a large share
   * of all turns. Skipping them is the cheapest saving in this
   * capability: it costs one length comparison and removes
   * most of the calls.
   */
  minUserChars: readInt("NEUROLINK_MEMORY_MIN_USER_CHARS", 24),

  /*
   * How long the answer's stream waits, after the last token,
   * for the write to finish so it can report what was
   * remembered.
   *
   * Telemetry only. The write is started when the turn is
   * admitted and runs alongside the answer, and the memory is
   * stored whether or not this window catches it — when it does
   * not, the stream simply ends without saying so and the
   * Builder's Memory panel shows it on its next read. Nothing
   * about WHAT is remembered depends on this number.
   *
   * Six seconds rather than two, and the number came from
   * measurement rather than taste: an extraction call against
   * Flash-Lite lands in four to six seconds, so a two-second
   * window reported almost nothing and the Test panel's chip
   * effectively never appeared. A control that fires one time
   * in ten is worse than one that never fires, because the
   * learner concludes the feature is unreliable rather than
   * absent.
   *
   * What it costs is the honest part. The turn's ai_usage row
   * stays pending for up to this long after the last token,
   * which holds one of the learner's concurrency slots in their
   * CHAT window — the extraction itself is counted separately.
   * That is affordable because a learner sends one message at a
   * time, and because the Test panel replaces an in-flight turn
   * rather than racing it. Lower it if a deployment ever runs
   * concurrent traffic through one owner.
   */
  writeWaitMs: readInt("NEUROLINK_MEMORY_WRITE_WAIT_MS", 6_000),

  /*
   * The longest `memoryKey` a deployed caller may send.
   *
   * It is hashed before it is stored, so this bounds what
   * arrives rather than what is kept.
   */
  subjectMaxChars: readInt("NEUROLINK_MEMORY_SUBJECT_MAX_CHARS", 200),
};

export const memoryMinSimilarity =
  Math.max(0, Math.min(100, memory.minSimilarityPercent)) / 100;

/* =========================================================
   MEMORY QUOTAS

   Remembering is counted, and counted in its own windows, for
   the reason searching, embedding and file reading are: a turn
   that remembers is an answer plus an extraction, and charging
   both to the per-minute window a learner uses for the Lab
   would halve what they can do the moment they switch the
   capability on.

   Its own quota key (`memory:<power source>:<user id>`), its
   own windows, and no exemption from anything else: still
   atomic, still enforced in SQL, still written to ai_usage,
   and — on the platform power source — still inside
   BuildGentic's platform budget.

   The output ceiling is the interesting one. An extraction
   returns a few short sentences of JSON and nothing else ever,
   so it is capped far below an ordinary answer's. That is a
   cost control rather than a formality: it is the difference
   between a memory turn costing a little more than an answer
   and costing twice one.
========================================================= */

const platformMemoryLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_MEMORY_REQUESTS_PER_MINUTE", 30),
  requestsPerDay: readInt("NEUROLINK_MEMORY_REQUESTS_PER_DAY", 400),
  maxConcurrent: readInt("NEUROLINK_MEMORY_MAX_CONCURRENT", 3),
  maxInputChars: readInt("NEUROLINK_MEMORY_MAX_INPUT_CHARS", 24_000),
  maxOutputTokens: readInt("NEUROLINK_MEMORY_MAX_OUTPUT_TOKENS", 512),
  tokensPerDay: readInt("NEUROLINK_MEMORY_TOKENS_PER_DAY", 200_000),
};

/*
 * The same clamping as limitsFor, against the same global
 * ceiling. Memory traffic gets its own windows, not its own
 * exemption: an agent extracting on every turn of a long
 * conversation is still one account making calls.
 */
export function memoryLimitsFor(): QuotaLimits {
  const base = platformMemoryLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
    maxOutputTokens: clamp(base.maxOutputTokens, globalCeiling.maxOutputTokens),
    tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
  };
}

/* =========================================================
   ACTIONS

   The capability that lets an agent DO something between the
   question and the answer — run code it wrote, call an API —
   look at the result, and decide what to do next.

   Every other capability on this platform is a pre-flight
   prompt-stuffer: it runs once, before the model stream
   begins, and appends text. This one is a LOOP, and that is
   the whole of why it needs its own numbers.

   Two settings below matter more than the rest.

   `maxSteps` is the bound on the loop, and it is the single
   most important number in this block. Retrieval, search and
   memory are bounded structurally — they cannot re-enter
   themselves, because the recursive call sets every capability
   flag false. That argument does not apply here: the entire
   point is that a tool result feeds a call which may want
   another tool. So this is a real counter, checked every
   iteration, and there is no configuration that removes it.

   Four is not arbitrary. Three steps covers the shapes that
   actually come up — fetch then compute, compute then check,
   fetch then fetch then combine — and the fourth is headroom
   for a model that wastes one. Beyond that the failures stop
   being "needed more room" and start being "stuck in a loop",
   and the fix for a loop is not a larger budget.

   `resultChars` is the other one. A tool result is arbitrary
   bytes from somewhere else arriving in a prompt, and an
   unbounded one is how a single API call eats the whole input
   budget and pushes the owner's own instructions out of the
   request. Whole results are never sliced to fit; oversized
   ones are truncated with a visible marker, so the model can
   tell "the answer is 47" from "the answer is 4" followed by
   a cliff.
========================================================= */

export const actions = {
  /*
   * The hard ceiling on tool calls in one turn. See above.
   * Clamped rather than merely defaulted: a zero or a negative
   * would turn the loop off in a way that reads as a bug, and
   * a very large one is the runaway this whole number exists
   * to prevent.
   */
  maxSteps: Math.min(
    Math.max(readInt("NEUROLINK_ACTION_MAX_STEPS", 4), 1),
    8
  ),

  /* How much of one tool's output reaches the model. */
  resultChars: readInt("NEUROLINK_ACTION_RESULT_CHARS", 4_000),

  /*
   * The ceiling on ALL tool results in one turn, together.
   *
   * Separate from the per-result cap because the failure modes
   * are different: one huge result is a badly chosen endpoint,
   * four medium ones are a turn that is simply carrying too
   * much. The oldest results are dropped first — the model has
   * already reasoned about those, and the newest is the one it
   * is about to answer from.
   */
  totalResultChars: readInt("NEUROLINK_ACTION_TOTAL_RESULT_CHARS", 12_000),

  /* ----- run_code ----- */

  code: {
    /* Wall clock for one execution, enforced by killing the
       child. Generous enough for real parsing work, short
       enough that a `while (true)` is noticed immediately. */
    timeoutMs: readInt("NEUROLINK_ACTION_CODE_TIMEOUT_MS", 5_000),

    /* Passed to the child as --max-old-space-size, in MB. The
       second half of the same guard: a timeout catches a busy
       loop, this catches an allocation one. */
    memoryMb: readInt("NEUROLINK_ACTION_CODE_MEMORY_MB", 128),

    /* Longest program the model may submit. */
    maxSourceChars: readInt("NEUROLINK_ACTION_CODE_SOURCE_CHARS", 8_000),

    /*
     * Captured stdout ceiling, in bytes, enforced as the child
     * writes rather than after it exits. A program that prints
     * in a loop would otherwise fill this server's memory
     * before the timeout ever fired — the timeout bounds how
     * long it runs, not how fast it can produce.
     */
    maxOutputBytes: readInt("NEUROLINK_ACTION_CODE_OUTPUT_BYTES", 64_000),
  },

  /* ----- http_request ----- */

  http: {
    /* Whole-request budget for one outbound call. */
    timeoutMs: readInt("NEUROLINK_ACTION_HTTP_TIMEOUT_MS", 10_000),

    /*
     * How many redirects are followed, and every hop is
     * re-checked against the address rules rather than only
     * the first. A permitted host that 302s to 127.0.0.1 is
     * the standard way past a naive allowlist.
     */
    maxRedirects: readInt("NEUROLINK_ACTION_HTTP_MAX_REDIRECTS", 3),

    /*
     * Response ceiling in bytes, enforced while reading. Not
     * from Content-Length: a server is free to lie about that,
     * or omit it entirely on a chunked response.
     */
    maxResponseBytes: readInt("NEUROLINK_ACTION_HTTP_RESPONSE_BYTES", 256_000),

    /* Longest request body the model may send. */
    maxRequestBodyChars: readInt("NEUROLINK_ACTION_HTTP_BODY_CHARS", 8_000),

    /*
     * Saved connections per agent. A small number on purpose:
     * this is a learning platform, and an agent that needs
     * fifteen credentials is not a lesson anybody is going to
     * finish.
     */
    maxConnections: readInt("NEUROLINK_ACTION_MAX_CONNECTIONS", 8),

    /*
     * Whether an agent may call a public address it was not
     * given a saved connection for.
     *
     * On by default, and worth defending. Off, the capability
     * cannot do the thing it is most obviously for — read a
     * public JSON feed — without a student first filling in a
     * credential form for a service that has no credentials.
     * The address rules below are what make it safe, and they
     * apply identically to a saved connection: a connection
     * buys you a secret and a fixed host, not an exemption.
     */
    allowPublicGet:
      readInt("NEUROLINK_ACTION_HTTP_ALLOW_PUBLIC_GET", 1) !== 0,
  },
} as const;

/* =========================================================
   ACTION QUOTAS

   Counted, and counted in their OWN windows, under the quota
   key `action:<power source>:<user id>`.

   Separate for the reason Web Search's are separate, and more
   so. A search-backed turn is three calls. An action-backed
   turn is up to nine — the answering call, then for each step
   a tool execution and another model call to read its result.
   Charging all of that to the window a learner uses for the
   Lab would mean switching this capability on costs them the
   ability to do anything else for a minute.

   Separate windows, not an exemption. Still atomic, still
   enforced in SQL, still written to ai_usage, and — on the
   platform power source — still inside BuildGentic's platform
   budget above, which counts by power source rather than by
   quota key.

   Tool executions report zero tokens, honestly: no model ran,
   so it is the request windows that bound them. The extra
   model steps report real ones.
========================================================= */

const platformActionLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_ACTION_REQUESTS_PER_MINUTE", 60),
  requestsPerDay: readInt("NEUROLINK_ACTION_REQUESTS_PER_DAY", 600),
  maxConcurrent: readInt("NEUROLINK_ACTION_MAX_CONCURRENT", 4),
  /* A continuation step carries the conversation plus every
     tool result so far, so this is the one place the extras
     budget above is actually spent. */
  maxInputChars: readInt("NEUROLINK_ACTION_MAX_INPUT_CHARS", 32_000),
  maxOutputTokens: readInt("NEUROLINK_ACTION_MAX_OUTPUT_TOKENS", 1_024),
  tokensPerDay: readInt("NEUROLINK_ACTION_TOKENS_PER_DAY", 200_000),
};

/*
 * The same clamping as limitsFor, against the same global
 * ceiling. Action traffic gets its own windows, not its own
 * exemption: an agent looping on a tool is still one account
 * making this server do work.
 */
export function actionLimitsFor(): QuotaLimits {
  const base = platformActionLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
    maxOutputTokens: clamp(base.maxOutputTokens, globalCeiling.maxOutputTokens),
    tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
  };
}

/* =========================================================
   DOCUMENT GENERATION

   Every ceiling on a file an agent makes, in one place.

   These are shaped like the File Analysis block above and they
   are the mirror image of it: that one bounds what this server
   will READ out of somebody else's bytes, this one bounds what
   it will WRITE. The threat model is different in a way worth
   naming. An uploaded file is hostile input parsed by code that
   has to assume the worst about every length field; a generated
   file is OUR bytes, built from a block list this server
   validated first. There is no parser to confuse here.

   So what these numbers bound is not corruption, it is COST:
   CPU spent rendering, memory held while doing it, and rows
   accumulating in a table that holds files. Every one of them
   is checked against the block list BEFORE a byte is rendered,
   which is the property that makes them real — measuring the
   output afterwards and hoping is the design where a
   pathological input has already allocated before anything
   notices.
========================================================= */

export const documents = {
  /*
   * Documents one turn may produce.
   *
   * Two, because "a report and the spreadsheet behind it" is a
   * real ask and three is a loop. It is not the step ceiling —
   * `actions.maxSteps` still bounds the turn — it is the bound
   * on how much of that ceiling may be spent making files.
   */
  maxPerTurn: readInt("NEUROLINK_DOC_MAX_PER_TURN", 2),

  /* Blocks in one document. */
  maxBlocks: readInt("NEUROLINK_DOC_MAX_BLOCKS", 200),

  /* One paragraph, or one list item. */
  maxTextChars: readInt("NEUROLINK_DOC_MAX_TEXT_CHARS", 4_000),

  /*
   * Rows in one table block.
   *
   * Deliberately ABOVE fileAnalysis.maxRows (400), so a sheet
   * this platform generates is never smaller than one it can
   * read back. A learner who exports 500 rows and re-attaches
   * the file should not be told the second half is missing
   * because the writer and the reader disagreed.
   */
  maxTableRows: readInt("NEUROLINK_DOC_MAX_ROWS", 500),

  maxTableColumns: readInt("NEUROLINK_DOC_MAX_COLUMNS", 20),

  /* Identical to fileAnalysis.maxCellChars, for the same
     round-trip reason as the row count. */
  maxCellChars: readInt("NEUROLINK_DOC_MAX_CELL_CHARS", 300),

  /* Across every block, before anything renders. The bound that
     actually decides how long a render can take. */
  maxTotalChars: readInt("NEUROLINK_DOC_MAX_TOTAL_CHARS", 40_000),

  maxTitleChars: readInt("NEUROLINK_DOC_MAX_TITLE_CHARS", 200),

  /*
   * The rendered file, in bytes.
   *
   * An abuse ceiling rather than a product one: a 40-block
   * report is 20-60 kB and nothing this vocabulary can express
   * approaches a megabyte. Checked AFTER the render, because it
   * is the only one of these that cannot be known before — and
   * exceeding it refuses rather than truncates, since half a
   * PDF is not a smaller PDF, it is a corrupt one.
   *
   * MUST STAY AT OR BELOW the CHECK constraint in migration
   * 0018, which is the layer that holds if this is ever raised
   * carelessly.
   */
  maxBytes: readInt("NEUROLINK_DOC_MAX_BYTES", 1024 * 1024),

  /*
   * Wall clock for one render.
   *
   * The same number `actions.code.timeoutMs` uses, in the same
   * spirit: sizes bound the input, and only a clock bounds work
   * that turns out to be quadratic in something nobody
   * measured. The renderers check it between blocks — a
   * synchronous writer cannot be aborted mid-call, and the
   * per-block caps are what bound the inside of one.
   */
  renderTimeoutMs: readInt("NEUROLINK_DOC_RENDER_TIMEOUT_MS", 5_000),

  /*
   * How much of a PDF's BODY may be characters Helvetica cannot
   * draw, as a percentage, before the whole thing is refused.
   *
   * The writer emits the standard-14 faces in WinAnsiEncoding,
   * which is Latin-1: CJK, Greek, Cyrillic, Devanagari and
   * emoji have no glyph. Below this fraction they are replaced
   * with a visible marker and the receipt says how many; above
   * it the PDF is refused with `docx` named as the format that
   * will work, because a refused step the model can recover
   * from is worth more than a file nobody can read.
   *
   * THE TITLE IS JUDGED SEPARATELY AND AT ZERO, which is why
   * there is no second knob for it. A heading is the one line a
   * person reads first and the string the report is identified
   * by; a document called "□□□□ 2026" is not degraded, it is
   * unusable, and no proportion of the body being fine rescues
   * it.
   */
  pdfMaxUnrenderablePercent: readInt(
    "NEUROLINK_DOC_PDF_MAX_UNRENDERABLE_PERCENT",
    10
  ),

  /* ----- retention ----- */

  /*
   * How long a generated file stays downloadable.
   *
   * Long enough that a Friday report survives a weekend. Far
   * longer than an ATTACHMENT's thirty minutes, and the
   * difference is the whole reason this is not FileStore: an
   * upload exists to answer the question being asked with it,
   * while a generated file is the thing a scheduled run
   * produced at four in the morning for somebody who reads it
   * at nine.
   */
  retentionDays: readInt("NEUROLINK_DOC_RETENTION_DAYS", 7),

  /*
   * The count bounds, and they matter more than the age one.
   *
   * A six-hourly schedule makes 28 files inside the retention
   * window, so ten is deliberately below what one schedule
   * produces: a learner keeps the last two and a half days of
   * reports rather than all seven, and the older ones are gone
   * before the expiry ever reaches them. That is the right way
   * round — the count is what actually bounds storage, and the
   * expiry is the backstop for an agent that generates rarely.
   *
   * Worst case per learner at these numbers is 20 MB of files
   * and about 27 MB of base64 rows. Raise them deliberately:
   * this is a hosted database, and it is the one limit here
   * whose correct value depends on infrastructure this project
   * has not chosen yet.
   */
  keepPerAgent: readInt("NEUROLINK_DOC_KEEP_PER_AGENT", 10),
  keepPerUser: readInt("NEUROLINK_DOC_KEEP_PER_USER", 20),
} as const;

/* =========================================================
   PAGE CONTEXT

   What the browser extension may hand an agent about the page
   the learner is looking at.

   Every number here is a bound on HOSTILE INPUT, which makes
   this block different in kind from the ones around it. A
   knowledge budget bounds text the owner wrote; a data-store
   budget bounds what their own agent kept. These bound text
   written by whoever runs the website the learner happens to
   be on — the only material in this product that arrives
   without anybody on the learner's side having chosen it.

   So the defaults lean small. A capture that is too short is a
   worse answer the learner can fix by selecting more; a capture
   that is too long is a larger blast radius for an injection
   and a bigger bill, neither of which they can see.
========================================================= */

export const pageContext = {
  /*
   * The most captured text one turn may carry.
   *
   * Enforced in three places for the reason data-store limits
   * are: in the extension's own extraction, in the validator
   * here, and against the prompt budget by fitExtras. Only the
   * middle one is on the trust boundary — the extension's copy
   * is a courtesy that saves a round trip, and a modified
   * extension is exactly the case the validator exists for.
   *
   * 20,000 characters is roughly a long article. It is well
   * under the input ceiling on its own, which is deliberate:
   * page context has to fit ALONGSIDE the agent's instructions,
   * its knowledge and the conversation, and a cap that only
   * worked on an empty prompt would fail on the agents people
   * actually build.
   */
  maxTextChars: readInt("NEUROLINK_PAGE_CONTEXT_MAX_CHARS", 20_000),

  /*
   * The page title, bounded separately.
   *
   * Its own limit rather than a share of the one above because
   * it is its own attack surface: a title is attacker-chosen
   * and lands in a field a naive implementation prints
   * unescaped, exactly as a filename does. See the note in
   * agents/files/context.ts.
   */
  maxTitleChars: readInt("NEUROLINK_PAGE_CONTEXT_MAX_TITLE_CHARS", 300),

  /*
   * Origin plus path. No query string ever reaches here — it is
   * stripped in the capture and stripped again in the validator
   * — so this only has to bound a path.
   */
  maxUrlChars: readInt("NEUROLINK_PAGE_CONTEXT_MAX_URL_CHARS", 500),
} as const;

/* =========================================================
   THE AGENT DATA STORE

   The knobs that decide how much an agent may keep for itself,
   and what happens when it has kept enough.

   One of these behaves in the exact opposite way to its
   equivalent in the MEMORY block above, and the difference is
   the whole distinction between the two features. Memory
   EVICTS at its ceiling, because a memory is the machine's own
   inference and forgetting the thing it has not needed in
   longest is what a person expects from something called
   memory. This store REFUSES, because it holds records the
   owner asked the agent to keep — and quietly dropping the
   oldest row of a running log is data loss its owner never
   sees, in which the row most likely to go is the one with the
   most history behind it.

   A refusal is something a person can act on. An eviction is
   not.
========================================================= */

export const dataStore = {
  /*
   * Records one agent may hold in one scope.
   *
   * Larger than memory's 120 on purpose — that is a cap on
   * sentences about one person, this is a cap on a habit
   * tracker's year — and still small enough that the owner's
   * Data screen renders the whole thing without paging.
   */
  maxRecords: readInt("NEUROLINK_DATA_MAX_RECORDS", 200),

  /*
   * The longest one value may be.
   *
   * Five times memory's 400, and the ratio is the point: a
   * memory is a sentence, a record may be a small JSON object
   * or a day's log line. Enforced here, in the tool
   * description, in the validator, and by a CHECK constraint in
   * 0018 — four layers for one number, of which only the last
   * cannot be talked out of it.
   */
  maxValueChars: readInt("NEUROLINK_DATA_MAX_VALUE_CHARS", 2_000),

  /* Matches the CHECK constraint's regex bound in 0018. */
  maxKeyChars: readInt("NEUROLINK_DATA_MAX_KEY_CHARS", 80),

  maxLabelChars: readInt("NEUROLINK_DATA_MAX_LABEL_CHARS", 200),

  /* Keys plus values across the scope. The bound that actually
     decides how large the store can get, since 200 records of
     2,000 characters would be 400 kB. */
  maxTotalChars: readInt("NEUROLINK_DATA_MAX_TOTAL_CHARS", 200_000),

  /*
   * Writes one turn may make.
   *
   * A cap on enthusiasm, the same one `memory.maxPerTurn`
   * imposes for the same reason — but higher, because a tracker
   * legitimately records several things at once where an
   * extraction call producing eleven memories has simply sliced
   * one fact eleven ways.
   */
  maxWritesPerTurn: readInt("NEUROLINK_DATA_MAX_WRITES_PER_TURN", 10),

  /*
   * How many keys are listed in the action block, and the one
   * setting here that is a security trade rather than a size.
   *
   * The block lists the store's keys so an agent does not have
   * to spend one of its four steps on data_list before every
   * data_get — the same thing `renderConnections` already does
   * for connection names, in the same place. But a connection
   * name was typed by the owner into a form, and a KEY IS
   * WRITTEN BY THE MODEL. That puts model-authored text on the
   * trusted side of the prompt, which is an inversion of the
   * asymmetry the whole action protocol rests on.
   *
   * What holds it: the key charset bans spaces, so a key is
   * always one unbroken token and reads as an identifier rather
   * than as a sentence; the keys arrive quoted, in a labelled
   * list; and the anti-confabulation rule still comes last in
   * the block, after them.
   *
   * That is mitigation, not proof. SET THIS TO 0 to stop
   * injecting the index entirely, at a cost of one step per
   * turn that reads the store. The switch exists because this
   * is a judgement call and the fallback is cheap — the same
   * shape, and the same justification, as
   * `actions.http.allowPublicGet`.
   */
  /*
   * 25 rather than more, and the number is a measurement rather
   * than a preference.
   *
   * Each key costs about 26 characters of prompt, so 40 was a
   * kilobyte spent on every turn before the agent read a word
   * of the conversation. A store may hold 200 records and no
   * list in a prompt can usefully summarise that many — what
   * the index is actually for is showing the CONVENTION and the
   * recent names, so an agent recognises that it has been
   * writing `habits/YYYY-MM-DD` and keeps doing so. Twenty-five
   * shows three weeks of a daily key and does that job as well
   * as forty, for 40% less. `data_list` reaches the rest.
   */
  indexKeys: readInt("NEUROLINK_DATA_INDEX_KEYS", 25),

  /*
   * How long a retired record can still be restored.
   *
   * `data_delete` is soft: model output may RETIRE a record,
   * and only a person DESTROYS one. That keeps intact the rule
   * MemoryStore states — that nothing a model writes can delete
   * anything — while still giving a habit tracker a way to
   * remove a row. This is how long the owner's Data screen goes
   * on offering Restore before the sweep takes it.
   */
  retiredDays: readInt("NEUROLINK_DATA_RETIRED_DAYS", 7),
} as const;

/* =========================================================
   EMAIL

   Every ceiling on what an agent may pull out of somebody's
   mailbox, and the credentials that let it.

   THE NUMBERS HERE BOUND SOMETHING NO OTHER BLOCK IN THIS FILE
   DOES, and it is worth naming before the first constant.

   File Analysis bounds hostile bytes somebody chose to upload.
   Document generation bounds bytes this server writes itself.
   Both are about cost and about parsers. These are about how
   much of a person's private correspondence is allowed to exist
   inside a prompt at once — which is a privacy ceiling wearing
   a cost ceiling's clothes, and the two happen to point the
   same way.

   That is why `listMaxResults` is small and why
   `bodyChars` is much smaller than `actions.resultChars`. A
   triage over the whole inbox is a legitimate request; a triage
   that puts forty full message bodies in front of a model is
   not the way to answer it, and the tool descriptions say so.
========================================================= */

export const email = {
  /* Whether the capability can be used at all. Reported to the
     browser rather than assumed, exactly as `secretsAvailable`
     is on the connections route: with these unset, everything
     on the Email screen works up to the redirect. */
  gmail: {
    clientId: readString("NEUROLINK_GMAIL_CLIENT_ID"),
    clientSecret: readString("NEUROLINK_GMAIL_CLIENT_SECRET"),
    /*
     * Must match a redirect URI registered in the Google
     * console character for character, including the port.
     * Google compares it as a literal string, and a mismatch
     * produces `redirect_uri_mismatch` at the consent screen
     * rather than anywhere this server can catch it.
     */
    /*
     * `/api/agents/email/callback`, and the `agents` in the
     * middle is not decoration — it is where emailRouter is
     * mounted in index.ts.
     *
     * The first version of this default said
     * `/api/email/callback`, which is not a route: Google would
     * have redirected every learner to a 404 after a successful
     * consent, and the only symptom would have been a blank
     * page at the end of a flow that had actually worked. Found
     * by curling it rather than by reading it.
     */
    redirectUri:
      readString("NEUROLINK_GMAIL_REDIRECT_URI") ??
      "http://localhost:3001/api/agents/email/callback",
  },

  /*
   * How many messages one listing or search may return.
   *
   * Twelve rather than fifty. A model asked to triage gets
   * headers and a snippet for each, and twelve of those is
   * about 3,000 characters — a third of what a search result
   * block costs, and enough that "what needs my attention this
   * morning" has a real answer. More than that is a mailbox
   * export, and the tool tells the model to narrow its query
   * instead.
   */
  listMaxResults: readInt("NEUROLINK_EMAIL_LIST_MAX", 12),

  /* The hard ceiling a caller cannot raise past, whatever it
     asks for. `listMaxResults` is the default; this is the
     limit. */
  listHardMax: readInt("NEUROLINK_EMAIL_LIST_HARD_MAX", 25),

  /*
   * How much of one message body reaches the model.
   *
   * Deliberately below `actions.resultChars`. A long thread is
   * mostly quoted history, and the useful part is at the top —
   * so a cut here costs very little and a generous limit costs
   * a great deal, both in prompt budget and in how much of
   * somebody's correspondence is sitting in a request.
   */
  bodyChars: readInt("NEUROLINK_EMAIL_BODY_CHARS", 4_000),

  /* Per message in a LISTING, where the point is to recognise
     the message rather than to read it. */
  snippetChars: readInt("NEUROLINK_EMAIL_SNIPPET_CHARS", 220),

  /*
   * Drafts one turn may write.
   *
   * Two, and for the reason `documents.maxPerTurn` is two: a
   * turn that produced eight drafts has misunderstood the
   * request, and every one of them is something a person now
   * has to read before they can clear their tray.
   */
  maxDraftsPerTurn: readInt("NEUROLINK_EMAIL_MAX_DRAFTS_PER_TURN", 2),

  /* Recipients on one draft, counting To and Cc together. A
     small number on purpose: this is a reply assistant, not a
     mailing list. */
  maxRecipients: readInt("NEUROLINK_EMAIL_MAX_RECIPIENTS", 10),

  maxSubjectChars: readInt("NEUROLINK_EMAIL_SUBJECT_CHARS", 200),
  maxBodyChars: readInt("NEUROLINK_EMAIL_DRAFT_BODY_CHARS", 8_000),

  /* Messages one organise call may touch. Bounded because the
     model chooses the ids, and a mistake that archives four
     hundred messages is a mistake somebody has to undo by
     hand. */
  maxOrganizeIds: readInt("NEUROLINK_EMAIL_MAX_ORGANIZE_IDS", 20),

  /* Whole-request budget for one call to a provider's API. */
  timeoutMs: readInt("NEUROLINK_EMAIL_TIMEOUT_MS", 12_000),

  /*
   * How early a stored access token is treated as expired.
   *
   * Sixty seconds. A token that expires between the check and
   * the call costs the agent a step and the learner an action
   * from their allowance, and the refresh is one cheap request.
   */
  refreshSkewSeconds: readInt("NEUROLINK_EMAIL_REFRESH_SKEW_S", 60),
} as const;

/* Whether this server can run the OAuth flow at all. The route
   refuses with an explanation rather than redirecting somebody
   to a consent screen that will reject them. */
export function emailEnabled(): boolean {
  return Boolean(email.gmail.clientId && email.gmail.clientSecret);
}

/* =========================================================
   SCHEDULED RUNS

   The numbers that bound a turn nobody is watching.

   Everything above this block is provoked by a person. That
   person is a bound in their own right: they get bored, they
   close the tab, and closing the tab aborts the request. A
   schedule has none of that, so the limits it needs are not the
   same limits — and three of the five below exist only because
   the human is gone.

   WHAT IS DELIBERATELY NOT HERE IS A STEP CEILING.

   Scheduled runs use `actions.maxSteps`, unchanged, and that is
   a decision rather than an oversight. The loop cannot compound:
   a run is one turn, and on hitting the limit the runtime
   rebuilds the request without the tools block and without a
   scanner, so the model physically cannot talk its way into
   another turn. Whatever the number is, a run costs at most that
   many tool calls.

   What unattended execution actually introduces is MANY RUNS,
   and that is bounded by minIntervalMinutes, maxPerUser and the
   circuit breaker rather than by shaving a step.

   And cutting it would break the property this codebase works
   hardest to keep. deploymentRequest.ts reads capability flags
   off the stored row precisely so "the deployed agent does what
   the tested one does" is true by construction. A three-step
   scheduled loop against a four-step Test panel breaks that in
   the worst direction: the owner's preview run would be evidence
   about a different loop, and a schedule that fails on its
   fourth step would pass every manual test they ran.
========================================================= */

export const schedule = {
  /*
   * The floor, in minutes, between two runs of one schedule.
   *
   * Six hours, and it is arithmetic rather than taste. A run
   * costs 2 XP plus the 1 XP action surcharge; the daily login
   * grant is 40. Hourly would be 24 runs at ~3 XP — 72 a day,
   * nearly double what a learner earns, forever. Six-hourly is
   * four runs, ~12 XP, under a third of the grant, which leaves
   * the Lab usable. That is the whole product.
   *
   * The cadence vocabulary in the database enforces this
   * structurally — there is no value meaning "every minute" —
   * so this constant is the belt to that migration's braces,
   * and the number the UI quotes.
   */
  minIntervalMinutes: readInt("NEUROLINK_SCHEDULE_MIN_INTERVAL_MINUTES", 360),

  /*
   * How many schedules one learner may have RUNNING at once.
   *
   * At the floor that is 24 XP a day worst case — 60% of the
   * grant, which is the most background automation should ever
   * take from somebody's foreground learning. They may create
   * as many as they like; this bounds how many are armed.
   */
  maxPerUser: readInt("NEUROLINK_SCHEDULE_MAX_PER_USER", 2),

  /*
   * The balance below which a scheduled run is skipped rather
   * than attempted.
   *
   * Automation must never spend the last XP a student needs for
   * a lesson. This is a teaching tool: the background thing
   * yields to the foreground thing, and a skipped run is
   * recorded as `skipped` rather than a failure, so it cannot
   * trip the breaker. Somebody who spent their XP on lessons
   * has not broken their schedule.
   */
  xpReserve: readInt("NEUROLINK_SCHEDULE_XP_RESERVE", 10),

  /*
   * The wall clock for one run, and the genuinely new bound.
   *
   * It exists because of something unattended execution
   * REMOVES. An interactive turn is bounded by a person:
   * `res.on("close")` aborts the controller when the tab shuts,
   * which is what turns a walked-away-from request into a
   * cancelled provider call rather than tokens nobody reads.
   * Nothing closes a scheduled run's tab. This aborts the same
   * AbortController the sandbox and the HTTP client already
   * accept.
   */
  runTimeoutMs: readInt("NEUROLINK_SCHEDULE_RUN_TIMEOUT_MS", 120_000),

  /* How much of a run's answer is kept on the row. A run row is
     a record, not a blob store. */
  maxOutputChars: readInt("NEUROLINK_SCHEDULE_OUTPUT_CHARS", 20_000),

  /* Per trace entry, on the arguments the model wrote. Enough to
     see what it asked for, not enough for one pathological
     request to dominate the table. */
  maxTraceArgChars: readInt("NEUROLINK_SCHEDULE_TRACE_ARG_CHARS", 1_000),

  /* ----- the ticker ----- */

  /*
   * How often the process looks for due schedules.
   *
   * At a six-hour floor, being up to a minute late is noise.
   * The value that matters more is `batch` below.
   */
  tickMs: readInt("NEUROLINK_SCHEDULE_TICK_MS", 60_000),

  /*
   * How many schedules one tick may claim.
   *
   * This is what stops the first tick after an outage starting
   * fifty runs at once. The rest are claimed on the next tick,
   * a minute later, which is the difference between a queue
   * draining and a thundering herd.
   */
  batch: readInt("NEUROLINK_SCHEDULE_BATCH", 5),

  /*
   * How long a claim holds a schedule before another tick may
   * take it.
   *
   * Comfortably longer than `runTimeoutMs`, because the lease
   * has to outlive the slowest legitimate run — and a lease
   * that expires under a run still in progress would produce
   * exactly the double-run it exists to prevent. It is also the
   * age at which an unfinished run row is declared abandoned.
   */
  leaseSeconds: readInt("NEUROLINK_SCHEDULE_LEASE_SECONDS", 900),

  /* ----- retention ----- */

  keepDays: readInt("NEUROLINK_SCHEDULE_KEEP_DAYS", 30),
  keepRuns: readInt("NEUROLINK_SCHEDULE_KEEP_RUNS", 50),
} as const;

/*
 * Where the ticker's time comes from.
 *
 * `internal` — this process, on a timer. The default, and the
 *   right answer on any host that runs a long-lived Node
 *   process, which is every host that can run this API at all:
 *   the sandbox spawns a child process and the SSRF guard
 *   resolves DNS, neither of which exists in a serverless
 *   runtime.
 *
 * `external` — no timer here; something else POSTs
 *   /internal/scheduler/tick. For a host that sleeps when idle,
 *   where a platform cron both fires the due runs and wakes the
 *   container.
 *
 * `off` — no scheduled runs. What the verify scripts set, so a
 *   suite importing this module does not quietly start running
 *   somebody's schedules.
 */
export type SchedulerMode = "internal" | "external" | "off";

export function schedulerMode(): SchedulerMode {
  const raw = (readString("NEUROLINK_SCHEDULER") ?? "internal").toLowerCase();

  if (raw === "external" || raw === "off") {
    return raw;
  }

  if (raw !== "internal") {
    console.warn(
      `[schedule] NEUROLINK_SCHEDULER="${raw}" is not one of internal, external, off; using internal.`
    );
  }

  return "internal";
}

/*
 * The bearer for POST /internal/scheduler/tick.
 *
 * Read from the environment and nowhere else. It is not in the
 * database on purpose: the alternative design for this feature
 * put the timer in pg_cron, which would have meant this token
 * living in a cron job's SQL body — readable by anyone with SQL
 * Editor access, which in this project is how every migration is
 * applied. Migration 0016 stores a secret in the database
 * because it must be sent to somebody else's server and has no
 * other home. This one has one.
 *
 * Absent means the endpoint refuses everything, which is the
 * correct default: an unauthenticated way to make this server
 * spend a learner's credits is worse than a scheduler that only
 * runs in-process.
 */
export function schedulerToken(): string | undefined {
  return readString("NEUROLINK_SCHEDULER_TOKEN");
}

/*
 * The same clamping as actionLimitsFor, against the same global
 * ceiling, and its own windows for a reason that points in two
 * directions at once.
 *
 * A learner mid-Lab-session must not have their next experiment
 * refused because a background schedule took the minute's slot.
 * And a schedule must not get to fire faster than its own window
 * allows merely because the learner happened to be idle. One
 * shared window cannot give both; two can.
 *
 * The per-day number is deliberately close to what the frequency
 * floor and the per-user cap already permit, so this is a
 * backstop rather than a second policy that could disagree with
 * the first.
 */
const platformScheduleLimits: QuotaLimits = {
  requestsPerMinute: readInt("NEUROLINK_SCHEDULE_REQUESTS_PER_MINUTE", 4),
  requestsPerDay: readInt("NEUROLINK_SCHEDULE_REQUESTS_PER_DAY", 24),
  /* One run per learner at a time. The lease already enforces
     one run per SCHEDULE; this is the same promise across a
     learner's two schedules, so a tick cannot start both at
     once and double their concurrent provider load. */
  maxConcurrent: readInt("NEUROLINK_SCHEDULE_MAX_CONCURRENT", 1),
  maxInputChars: readInt("NEUROLINK_SCHEDULE_MAX_INPUT_CHARS", 32_000),
  maxOutputTokens: readInt("NEUROLINK_SCHEDULE_MAX_OUTPUT_TOKENS", 1_024),
  tokensPerDay: readInt("NEUROLINK_SCHEDULE_TOKENS_PER_DAY", 100_000),
};

/* =========================================================
   EMAIL

   Optional, and the optionality is load-bearing rather than
   polite. With no key set every notification stays in the
   in-app feed, nothing is sent, and a fresh clone still runs
   the whole feature — the same property the provider cascade's
   mock fallback protects.

   There is no `to` here, and there is no column for one either.
   A scheduled run's output goes to the account's own address,
   read from auth.users at send time. A schedule that could name
   its recipient would be a model-driven mail sender on a timer,
   which is a different product and a worse one.
========================================================= */

export const mail = {
  apiKey: readString("NEUROLINK_RESEND_API_KEY"),
  /* Must be a domain verified with the provider. A plausible
     default would only produce sends that fail at the provider
     rather than here, so there is none. */
  from: readString("NEUROLINK_MAIL_FROM"),
  /* Attempts before a notification is parked as `failed`. An
     address that has bounced three times will not start
     working, and a row that retries every tick fills the log. */
  maxAttempts: readInt("NEUROLINK_MAIL_MAX_ATTEMPTS", 3),
  /* How much of a run's output travels in the body. The rest is
     behind the link. */
  bodyChars: readInt("NEUROLINK_MAIL_BODY_CHARS", 2_000),
  /* How many the tick drains per pass. */
  batch: readInt("NEUROLINK_MAIL_BATCH", 10),
} as const;

export function mailEnabled(): boolean {
  return Boolean(mail.apiKey && mail.from);
}

export function scheduleLimitsFor(): QuotaLimits {
  const base = platformScheduleLimits;

  return {
    requestsPerMinute: clamp(
      base.requestsPerMinute,
      globalCeiling.requestsPerMinute
    ),
    requestsPerDay: clamp(base.requestsPerDay, globalCeiling.requestsPerDay),
    maxConcurrent: clamp(base.maxConcurrent, globalCeiling.maxConcurrent),
    maxInputChars: clamp(base.maxInputChars, globalCeiling.maxInputChars),
    maxOutputTokens: clamp(base.maxOutputTokens, globalCeiling.maxOutputTokens),
    tokensPerDay: clamp(base.tokensPerDay, globalCeiling.tokensPerDay),
  };
}

/* =========================================================
   PLATFORM BUDGET

   The ceilings that bound BuildGentic's own bill, counted across
   every learner rather than per learner.

   Per-user quotas stop one person looping. Nothing in 0003
   stopped a thousand people — or a thousand throwaway signups —
   from each politely staying under their own allowance, and the
   arithmetic on that was alarming. These are the numbers that
   decide the invoice.

   Defaults are sized for a small cohort on Gemini Flash-Lite:
   200k tokens/day is on the order of a few hundred ordinary Lab
   turns, and 4M tokens/month lands well under a dollar at
   Flash-Lite rates. Raise them deliberately, not by accident.
========================================================= */

export const platformBudget: PlatformBudget = {
  dailyRequests: readInt("NEUROLINK_AI_PLATFORM_DAILY_REQUESTS", 2_000),
  dailyTokens: readInt("NEUROLINK_AI_PLATFORM_DAILY_TOKENS", 200_000),
  monthlyRequests: readInt("NEUROLINK_AI_PLATFORM_MONTHLY_REQUESTS", 40_000),
  monthlyTokens: readInt("NEUROLINK_AI_PLATFORM_MONTHLY_TOKENS", 4_000_000),
};

/* =========================================================
   TIMEOUTS
========================================================= */

/*
 * Whole-request budget. A stream that has produced no `done`
 * event by now is abandoned, the provider connection is aborted,
 * and the usage row is closed as a timeout — which is what stops
 * a stalled upstream from holding a concurrency slot forever.
 */
export const requestTimeoutMs = readInt("NEUROLINK_AI_TIMEOUT_MS", 60_000);

/*
 * How long to wait for the first byte. A provider that accepts
 * the connection and then says nothing is the most common way a
 * request hangs, and it deserves a faster, clearer failure than
 * the full budget.
 */
export const firstTokenTimeoutMs = readInt(
  "NEUROLINK_AI_FIRST_TOKEN_TIMEOUT_MS",
  25_000
);

/* =========================================================
   STARTUP DIAGNOSTIC
========================================================= */

/*
 * Which search provider is live, and — the line that matters —
 * whether a keyed one was named without its key, in which case
 * agents are quietly searching an offline corpus. That is a
 * degradation a learner cannot diagnose from the Test panel, so
 * it belongs in the logs at startup rather than in a support
 * question a week later.
 */
function webSearchDiagnostic(): string {
  if (searchProviderId === "mock") {
    return "[ai] web search: mock (offline results, configured explicitly)";
  }

  if (searchProviderId !== "duckduckgo" && !searchKeyFor(searchProviderId)) {
    return (
      `[ai] web search: mock — no key for ${searchProviderId}, so agents ` +
      `search an offline corpus. Set ` +
      `${
        searchProviderId === "brave"
          ? "NEUROLINK_BRAVE_SEARCH_KEY"
          : "NEUROLINK_TAVILY_API_KEY"
      } in server/.env, or set NEUROLINK_WEB_SEARCH_PROVIDER=duckduckgo ` +
      `for keyless live results.`
    );
  }

  return (
    `[ai] web search: ${searchProviderId}, up to ${webSearch.maxQueries} ` +
    `quer${webSearch.maxQueries === 1 ? "y" : "ies"} a turn, ` +
    `${webSearch.maxResults} results, ` +
    `${webSearch.contextChars.toLocaleString()} chars of context`
  );
}

export function describeAiConfig(): string[] {
  const lines: string[] = [];

  /* The cascade, in priority order, with the models it will
     actually ask for. Operator-facing: this is the console, not
     a learner's screen. Keys are never printed. */
  lines.push(...describeChain());

  lines.push(
    `[ai] platform budget: ${platformBudget.dailyRequests}/day, ` +
      `${platformBudget.dailyTokens.toLocaleString()} tokens/day, ` +
      `${platformBudget.monthlyTokens.toLocaleString()} tokens/month`
  );


  lines.push(
    `[ai] retrieval: ~${retrieval.chunkChars}-char chunks ` +
      `(+${retrieval.chunkOverlap} overlap), top ${retrieval.topK} ` +
      `above ${retrieval.minSimilarityPercent}% similarity` +
      (retrieval.relativeFloorPercent > 0
        ? ` and within ${retrieval.relativeFloorPercent}% of the best match`
        : "") +
      `, ${retrieval.contextChars.toLocaleString()} chars of context`
  );

  lines.push(webSearchDiagnostic());

  lines.push(
    `[ai] file analysis: up to ${(
      fileAnalysis.maxFileBytes /
      (1024 * 1024)
    ).toFixed(0)} MB and ${fileAnalysis.maxFilesPerMessage} file${
      fileAnalysis.maxFilesPerMessage === 1 ? "" : "s"
    } a message, ` +
      `${fileAnalysis.contextChars.toLocaleString()} chars of context, ` +
      `held for ${Math.round(fileAnalysis.retentionMs / 60_000)} minutes`
  );

  lines.push(
    `[ai] memory: up to ${memory.maxMemories} memories per agent per person, ` +
      `${memory.maxContentChars} chars each, ` +
      `${memory.alwaysInclude} always carried and the rest matched ` +
      `above ${memory.minSimilarityPercent}% similarity, ` +
      `${memory.contextChars.toLocaleString()} chars of context`
  );

  lines.push(
    `[ai] documents: pdf/xlsx/docx, up to ${documents.maxPerTurn} a turn, ` +
      `${(documents.maxBytes / (1024 * 1024)).toFixed(0)} MB each, ` +
      `kept ${documents.retentionDays} days ` +
      `(newest ${documents.keepPerAgent} per agent, ${documents.keepPerUser} per learner)`
  );

  /*
   * Whether model-written keys are reaching the system prompt.
   *
   * Operator-facing, and it earns a line for the reason the
   * mail from-address does: it is a security posture that is
   * invisible from any screen. The index makes the store usable
   * inside a four-step budget and it is the one place this
   * feature puts model-authored text on the trusted side of the
   * fence, so which state it is in should be readable at
   * startup rather than inferred from an env file.
   */
  lines.push(
    dataStore.indexKeys > 0
      ? `[ai] data store: up to ${dataStore.maxRecords} records per agent, ` +
        `${dataStore.maxValueChars} chars each, ` +
        `${dataStore.indexKeys} keys listed in the prompt`
      : `[ai] data store: up to ${dataStore.maxRecords} records per agent, ` +
        `${dataStore.maxValueChars} chars each, ` +
        `key index OFF — agents must spend a step on data_list`
  );

  /*
   * Printed at startup because "why can nobody connect their
   * Gmail" has exactly one common answer, and it is this line
   * saying the client id is missing. The secret is never
   * printed, only whether there is one.
   *
   * LABELLED `mailboxes` RATHER THAN `email`, and the rename is
   * not cosmetic. There is already an `[ai] email:` line — the
   * Resend transport that sends a learner scheduled-run
   * notifications — and two lines under one word would make the
   * banner say "email: on" and "email: DISABLED" three rows
   * apart, about entirely different things.
   *
   * That distinction is worth keeping loud everywhere it
   * appears: BuildGentic sending a person a digest and
   * BuildGentic reading that person's mailbox are unrelated
   * capabilities with unrelated credentials.
   */
  lines.push(
    emailEnabled()
      ? `[ai] mailboxes: gmail available, up to ${email.listMaxResults} messages a listing, ` +
        `${email.bodyChars} chars of a body, ${email.maxDraftsPerTurn} drafts a turn, ` +
        `redirect ${email.gmail.redirectUri}`
      : `[ai] mailboxes: DISABLED — set NEUROLINK_GMAIL_CLIENT_ID and NEUROLINK_GMAIL_CLIENT_SECRET to let learners connect one`
  );

  lines.push(
    `[ai] deployments: ${deploymentLimits.requestsPerMinute}/min, ` +
      `${deploymentLimits.requestsPerDay}/day per deployment, ` +
      `endpoints published at ${publicApiBaseUrl}`
  );

  lines.push(
    `[ai] public pages: ${siteLimits.requestsPerMinute}/min, ` +
      `${siteLimits.requestsPerDay}/day per page, ` +
      `${siteLimits.visitorRequestsPerMinute}/min per visitor, ` +
      `served at ${publicSiteBaseUrl}/<slug>`
  );

  lines.push(
    `[ai] page edits: ${siteEditLimits.quota.requestsPerDay}/day, ` +
      `up to ${siteEditLimits.maxRequestChars} chars a request`
  );

  /*
   * Whether a scheduled run's output can actually leave the
   * building.
   *
   * Operator-facing, and the FROM address is printed while the
   * key never is — the same rule describeChain follows. The
   * address is worth printing because it is the half that fails
   * quietly: a missing key disables email loudly and everything
   * still works, but a from-address the provider has not
   * verified produces a 422 per send, on a timer, visible only
   * in `agent_notifications.email_error`.
   */
  lines.push(
    mailEnabled()
      ? `[ai] email: on, from ${mail.from} (notifications also stay in the in-app feed)`
      : "[ai] email: off — scheduled runs report to the in-app feed only. " +
        "Set NEUROLINK_RESEND_API_KEY and NEUROLINK_MAIL_FROM to send."
  );

  return lines;
}
