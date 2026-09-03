import { tavilyApiKey, webSearch } from "../../ai/config";
import { AiRuntimeError, normalizeError } from "../../ai/errors";
import { cleanText, safeUrl } from "../sanitize";
import type {
  SearchProvider,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "../types";

/*
 * Tavily.
 *
 * A search API built for exactly this job: it returns extracted
 * page content rather than a marketing snippet, which means the
 * model reads something closer to what a person would have read
 * had they opened the link.
 *
 * Set NEUROLINK_TAVILY_API_KEY and
 * NEUROLINK_WEB_SEARCH_PROVIDER=tavily.
 *
 * The key travels in an Authorization header rather than in the
 * JSON body. Both are accepted by the API; a header is the one
 * that does not end up in a request log that someone thought
 * was safe to keep because it only contains bodies.
 */

const ENDPOINT = "https://api.tavily.com/search";

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  published_date?: unknown;
}

interface TavilyBody {
  results?: unknown;
}

function toResult(entry: TavilyResult): SearchResult | null {
  const url = typeof entry.url === "string" ? safeUrl(entry.url) : null;

  if (!url) {
    return null;
  }

  const title =
    typeof entry.title === "string" ? cleanText(entry.title, 200) : "";

  if (!title) {
    return null;
  }

  return {
    title,
    url,
    snippet:
      typeof entry.content === "string"
        ? cleanText(entry.content, webSearch.snippetChars)
        : "",
    ...(typeof entry.published_date === "string" && entry.published_date
      ? { publishedAt: cleanText(entry.published_date, 40) }
      : {}),
  };
}

export const tavilyProvider: SearchProvider = {
  id: "tavily",
  displayName: "Tavily",

  isConfigured() {
    return Boolean(tavilyApiKey);
  },

  async search(
    request: SearchRequest,
    signal: AbortSignal
  ): Promise<SearchResponse> {
    if (!tavilyApiKey) {
      throw new AiRuntimeError(
        "provider_not_configured",
        "Web search is not configured on this BuildGentic server.",
        { internalDetail: "tavily selected with no NEUROLINK_TAVILY_API_KEY" }
      );
    }

    let response: Response;

    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${tavilyApiKey}`,
        },
        body: JSON.stringify({
          query: request.query,
          max_results: request.maxResults,
          /* The cheap depth. `advanced` costs more credits and
             crawls further, which is not what a one-turn agent
             lookup needs. */
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
        signal,
      });
    } catch (error) {
      const failure = normalizeError(error);

      if (failure.code === "cancelled") {
        throw failure;
      }

      throw new AiRuntimeError(
        "provider_unavailable",
        "The web search could not be reached.",
        {
          internalDetail: `tavily fetch failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      );
    }

    if (!response.ok) {
      throw new AiRuntimeError(
        response.status === 429 || response.status >= 500
          ? "provider_unavailable"
          : "provider_rejected",
        "The web search could not be completed.",
        { internalDetail: `tavily returned HTTP ${response.status}` }
      );
    }

    let body: TavilyBody;

    try {
      body = (await response.json()) as TavilyBody;
    } catch {
      throw new AiRuntimeError(
        "provider_malformed_response",
        "The web search returned something unreadable.",
        { internalDetail: "tavily response was not JSON" }
      );
    }

    const raw = Array.isArray(body.results) ? body.results : [];

    return {
      results: raw
        .map((entry) => toResult((entry ?? {}) as TavilyResult))
        .filter((entry): entry is SearchResult => entry !== null)
        .slice(0, request.maxResults),
    };
  },
};
