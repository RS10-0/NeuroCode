import { searchLimitsFor, webSearch } from "../ai/config";
import { AiRuntimeError, normalizeError } from "../ai/errors";
import { resolvePowerSource } from "../ai/resolveChain";
import { admit } from "../ai/QuotaGuard";
import { finish } from "../ai/UsageRecorder";
import type { ResolvedPowerSource } from "../ai/types";
import { cleanText, safeUrl } from "./sanitize";
import { activeSearchProvider } from "./SearchRegistry";
import { registerSearchProviders } from "./providers";
import type { SearchProviderId, SearchResult } from "./types";

/*
 * The entry point for every web search BuildGentic makes.
 *
 * AiRuntime.runChat for searching, and consciously the same
 * shape, in the same order, for the same reasons:
 *
 *   resolve who is paying
 *   → validate and constrain the request
 *   → take a quota slot
 *   → call the provider
 *   → always close the usage row
 *
 * Nothing above this file names a search vendor, reads a search
 * key, counts a quota or writes a usage row. A search is not a
 * model call, but it is still a request this server makes to
 * somebody else's service on a learner's behalf, and there is no
 * version of this feature where that gets to skip the gate a Lab
 * prompt cannot.
 *
 * Who pays is the agent's own power source, exactly as it is for
 * embeddings. The search provider itself is BuildGentic's either
 * way — a learner's OpenAI key does not buy them Brave results —
 * but the quota key, the windows and the platform budget all
 * follow the agent, so a BYOK agent's searching is counted
 * against a BYOK learner's own allowance and never against
 * BuildGentic's platform budget.
 */

/* =========================================================
   THE QUOTA KEY

   Search traffic is counted, and counted in its own windows.
   See the note on searchLimitsFor in config.ts: a search-backed
   turn is three calls, and charging all of them to the window a
   learner uses for the Lab would cut what they can do to a
   third the moment they switch the capability on.

   Derived from the source's own key rather than rebuilt from
   the user id, so the platform/BYOK split is inherited instead
   of restated — the same trick embeddingSource plays.
========================================================= */

export function searchSource(source: ResolvedPowerSource): ResolvedPowerSource {
  return {
    ...source,
    quotaKey: `search:${source.quotaKey}`,
    limits: searchLimitsFor(),
  };
}

export interface WebSearchInput {
  userId: string;
  /* What to ask. Sanitised and capped here rather than by the
     caller, because this is the boundary. */
  queries: string[];
  agentId?: string;
  signal?: AbortSignal;
}

export interface WebSearchOutcome {
  provider: SearchProviderId;
  /* Exactly what went to the provider, after sanitising. */
  queries: string[];
  results: SearchResult[];
  /* Provider round trips only — not the model calls around
     them. What the Test panel reports as search latency. */
  latencyMs: number;
  /* True when every query failed. One query failing out of two
     is not a failed search. */
  failed: boolean;
}

/*
 * A query, made safe to send.
 *
 * The model wrote this string, which makes it exactly as
 * trustworthy as anything else a model writes. Three things
 * matter and none of them is about search quality.
 *
 * Length, so nobody can post a novel to a search engine on
 * BuildGentic's IP address. Newlines and control characters,
 * because a query is a single line and anything claiming
 * otherwise is trying to be two requests. And a hard reject of
 * the empty string, because an empty query returns either
 * everything or an error depending on the provider, and neither
 * is an answer.
 */
function sanitizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const query = cleanText(raw, webSearch.maxQueryChars);

  return query.length > 1 ? query : null;
}

export function sanitizeQueries(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const entry of raw) {
    const query = sanitizeQuery(entry);

    if (!query) {
      continue;
    }

    const key = query.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    queries.push(query);

    if (queries.length >= Math.max(1, webSearch.maxQueries)) {
      break;
    }
  }

  return queries;
}

/*
 * A provider's result, made safe to put in a prompt.
 *
 * Applied here rather than trusted from the adapters, and the
 * adapters do it too. Belt and braces on purpose: this is the
 * single place every result passes through, so it is the only
 * place a guarantee can actually be made, and a new adapter
 * written in a hurry cannot lower the floor.
 */
function normalize(result: SearchResult): SearchResult | null {
  const url = safeUrl(result.url ?? "");

  if (!url) {
    return null;
  }

  const title = cleanText(result.title ?? "", 200);

  if (!title) {
    return null;
  }

  return {
    title,
    url,
    snippet: cleanText(result.snippet ?? "", webSearch.snippetChars),
    ...(result.publishedAt
      ? { publishedAt: cleanText(result.publishedAt, 40) }
      : {}),
  };
}

/* Two URLs that differ only by a trailing slash or a scheme are
   the same page, and citing it twice wastes a slot. */
function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(
      /\/+$/,
      ""
    )}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/*
 * Merges the queries' results round-robin.
 *
 * Taking the first N of a concatenated list would give the first
 * query every slot and the second query the leftovers, which
 * makes a two-part question answerable from half of it. One from
 * each in turn keeps both halves represented, and within each
 * query the provider's own ranking is preserved.
 */
function merge(perQuery: SearchResult[][], limit: number): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  const depth = Math.max(0, ...perQuery.map((list) => list.length));

  for (let index = 0; index < depth && merged.length < limit; index += 1) {
    for (const list of perQuery) {
      if (merged.length >= limit) {
        break;
      }

      const result = list[index];

      if (!result) {
        continue;
      }

      const key = dedupeKey(result.url);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(result);
    }
  }

  return merged;
}

/*
 * One query: admitted, timed, called, recorded.
 *
 * Throws on failure. `runWebSearch` below is what turns that
 * into a degraded answer rather than a refusal.
 */
async function runQuery(
  input: WebSearchInput,
  source: ResolvedPowerSource,
  query: string
): Promise<SearchResult[]> {
  const provider = activeSearchProvider();

  const admission = await admit({
    userId: input.userId,
    source,
    /*
     * `model` and `provider_id` on a search row.
     *
     * ai_usage is the ledger of calls somebody paid for, and a
     * search is one of those even though no model ran. So the
     * row says what it actually was — the search provider's
     * name, and `web-search` where a model id would go — rather
     * than borrowing the answering model's id and making the
     * ledger read as if the agent answered twice.
     */
    model: "web-search",
    providerId: provider.id,
    feature: "agent_web_search",
    /* A search spends no model tokens. The request windows are
       what bound it, and they are counted the same as any
       other call's. */
    estimatedTokens: 0,
    /*
     * No `keyId`. A BYOK learner's provider key buys them model
     * calls, not search results — the search provider is
     * BuildGentic's on either power source. What follows the
     * agent is the quota key and the windows, which is what
     * `source` above already carries.
     */
    agentId: input.agentId,
    /*
     * Deliberately no `deployment`.
     *
     * A deployed request already took one slot from the
     * deployment's own windows when it was admitted to answer.
     * Charging its searches to those windows as well would
     * quietly redefine "20 requests a minute" as "seven, if the
     * agent searches", which is not what the Deploy screen
     * says.
     */
  });

  const startedAt = Date.now();

  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, webSearch.timeoutMs);

  let failure: AiRuntimeError | null = null;

  try {
    const response = await provider.search(
      { query, maxResults: Math.max(1, webSearch.maxResultsPerQuery) },
      controller.signal
    );

    if (timedOut) {
      throw new AiRuntimeError(
        "timeout",
        "The web search did not respond in time."
      );
    }

    return response.results
      .map(normalize)
      .filter((result): result is SearchResult => result !== null);
  } catch (error) {
    failure = timedOut
      ? new AiRuntimeError("timeout", "The web search did not respond in time.")
      : normalizeError(error);

    if (failure.internalDetail) {
      /* Read here and nowhere else, exactly like a model
         provider's detail. It never reaches a response body. */
      console.error(`[search] ${failure.code}: ${failure.internalDetail}`);
    }

    throw failure;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();

    /* Always. A pending row holds one of this learner's search
       concurrency slots until the reaper sweeps it. */
    await finish(admission.usageId, {
      usage: { inputTokens: 0, outputTokens: 0, reported: true },
      latencyMs: Date.now() - startedAt,
      ok: failure === null,
      errorCode: failure?.code,
    });
  }
}

/*
 * Runs the planned queries and returns what the web said.
 *
 * Throws only for a refusal that happened before any provider
 * was reached — a quota, a power source that will not resolve.
 * A provider that fails, times out or returns nothing produces
 * an outcome, not an exception, because an agent that cannot
 * search must still answer.
 */
export async function runWebSearch(
  input: WebSearchInput
): Promise<WebSearchOutcome> {
  registerSearchProviders();

  const provider = activeSearchProvider();
  const queries = sanitizeQueries(input.queries);

  if (queries.length === 0) {
    return {
      provider: provider.id,
      queries: [],
      results: [],
      latencyMs: 0,
      failed: false,
    };
  }

  const source = searchSource(
    await resolvePowerSource(input.userId)
  );

  const startedAt = Date.now();

  /*
   * In parallel. Two queries in sequence is two round trips a
   * learner waits through for no reason — they do not depend on
   * each other, and the concurrency limit above is what bounds
   * how many may be in flight.
   */
  const settled = await Promise.allSettled(
    queries.map((query) => runQuery(input, source, query))
  );

  const perQuery: SearchResult[][] = [];
  let failures = 0;

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      perQuery.push(outcome.value);
      continue;
    }

    failures += 1;
    perQuery.push([]);
  }

  return {
    provider: provider.id,
    queries,
    results: merge(perQuery, Math.max(1, webSearch.maxResults)),
    latencyMs: Date.now() - startedAt,
    failed: failures === queries.length,
  };
}
