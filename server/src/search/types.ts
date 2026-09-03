/*
 * The contracts the web-search layer is built from.
 *
 * Consciously the same shape as server/src/ai/types.ts, because
 * the problem is the same one: a capability that must not know
 * which vendor is behind it. A search adapter implements
 * `SearchProvider`, the runtime and every caller above it speak
 * only these shapes, and swapping DuckDuckGo for Brave is one
 * environment variable — no change to the runtime, to the
 * Builder, or to a deployed agent.
 *
 * Nothing in here is agent-shaped, and that is deliberate. This
 * layer answers "what does the web say about X". Deciding
 * whether to ask, what to ask, and what to do with the answer
 * all happen a level up, in server/src/agents/websearch.
 */

/*
 * Registered adapters.
 *
 *   duckduckgo — keyless, live web. The default, and the reason
 *                this capability works on a fresh clone.
 *   brave      — a real search API, key required.
 *   tavily     — a search API built for LLM use, key required.
 *   mock       — deterministic, offline, never leaves the
 *                machine. What `mock` is to the AI runtime.
 */
export type SearchProviderId = "duckduckgo" | "brave" | "tavily" | "mock";

/*
 * One query, already validated and constrained.
 *
 * By the time this exists the text has been trimmed, length
 * checked and stripped of anything that would let a caller
 * smuggle operators into somebody else's search — see
 * sanitizeQuery in WebSearchRuntime. An adapter may use it
 * without re-checking.
 */
export interface SearchRequest {
  query: string;
  /* How many results to ask for. An adapter may return fewer
     and must never return more. */
  maxResults: number;
}

/*
 * One result, as it comes back from a provider.
 *
 * `snippet` is whatever the provider will say about the page
 * without us fetching it. BuildGentic deliberately does not fetch
 * the page: following a link the model chose, from BuildGentic's
 * server, is a server-side request forgery waiting to happen,
 * and the snippet is enough to answer most questions and to
 * cite honestly.
 */
export interface SearchResult {
  title: string;
  /* Absolute http(s) URL. Validated by the runtime before it
     ever reaches a prompt or a browser. */
  url: string;
  snippet: string;
  /* Only when the provider reports one. Never inferred. */
  publishedAt?: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface SearchProvider {
  readonly id: SearchProviderId;
  readonly displayName: string;

  /*
   * Whether this adapter can run at all. Checked before a quota
   * slot is taken, so a missing key costs nothing and produces
   * a clear error rather than a provider round trip.
   */
  isConfigured(): boolean;

  /*
   * Runs one query.
   *
   * Must throw AiRuntimeError — never a raw fetch error — and
   * must respect `signal`, both for a caller hanging up and for
   * the runtime's own timeout. Returning zero results is a
   * normal outcome, not a failure.
   */
  search(
    request: SearchRequest,
    signal: AbortSignal
  ): Promise<SearchResponse>;
}

/* =========================================================
   WHAT THE AGENT DID

   The shapes that leave this layer. Everything below is
   owner-facing telemetry: it is emitted to the Builder's Test
   panel so a learner can see that a search happened, what was
   asked, what came back and how long it took.

   A deployed agent's caller sees none of it — the same rule
   retrieval follows, and for the same reason. Which queries
   somebody's agent ran describes their configuration.
========================================================= */

/*
 * Why an answer carried no web results.
 *
 *   off         — the capability is not switched on. The
 *                 runtime does not search and emits nothing at
 *                 all; this value exists for the browser.
 *   not_needed  — the agent read the question and decided the
 *                 live web could not improve the answer. The
 *                 common case, and not a fault.
 *   no_results  — searched, and the web returned nothing usable.
 *   unavailable — the decision or the search itself failed. The
 *                 agent still answered, without this.
 *
 * Four values rather than one flag because they call for four
 * different reactions from the person reading them, and only
 * one of them is a problem.
 */
export type WebSearchReason =
  | "off"
  | "not_needed"
  | "no_results"
  | "unavailable";

/* One source the agent actually read, numbered as the model
   saw it so a citation in the answer lines up with this list. */
export interface WebSource {
  /* 1-based, and the number the prompt told the model to cite. */
  ordinal: number;
  title: string;
  url: string;
  /* The site, for a UI that has no room for a full URL. */
  site: string;
  chars: number;
  publishedAt?: string;
}

/*
 * Everything the Test panel shows about one turn's search.
 *
 * `searched` is not the same as `sources.length > 0`: a search
 * that ran and found nothing is a different thing from a search
 * that never ran, and the strip says which.
 */
export interface WebSearchTelemetry {
  searched: boolean;
  /* Exactly what went to the search provider. Shown, because
     "why did it find that?" has to have an answer. */
  queries: string[];
  provider: SearchProviderId;
  /* Results returned by the provider, before the context budget
     decided how many fit. Always >= sources.length. */
  resultCount: number;
  sources: WebSource[];
  /* The search alone — provider round trips, not the model
     calls around them. */
  latencyMs: number;
  reason?: WebSearchReason;
}
