import { braveSearchKey, webSearch } from "../../ai/config";
import { AiRuntimeError, normalizeError } from "../../ai/errors";
import { cleanText, safeUrl } from "../sanitize";
import type {
  SearchProvider,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "../types";

/*
 * Brave Search.
 *
 * A real search API: structured JSON, its own index, publication
 * dates on most results, and a free tier that does not need a
 * card. What a deployment should use — set
 * NEUROLINK_BRAVE_SEARCH_KEY and
 * NEUROLINK_WEB_SEARCH_PROVIDER=brave.
 *
 * The key is read from config, which reads it from the
 * environment, and it never appears in a response body, a log
 * line or an error message. Same rule as every model provider
 * key in this project.
 */

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  page_age?: unknown;
}

interface BraveBody {
  web?: { results?: unknown };
}

function toResult(entry: BraveResult): SearchResult | null {
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
      typeof entry.description === "string"
        ? cleanText(entry.description, webSearch.snippetChars)
        : "",
    ...(typeof entry.page_age === "string" && entry.page_age
      ? { publishedAt: cleanText(entry.page_age, 40) }
      : {}),
  };
}

export const braveProvider: SearchProvider = {
  id: "brave",
  displayName: "Brave Search",

  isConfigured() {
    return Boolean(braveSearchKey);
  },

  async search(
    request: SearchRequest,
    signal: AbortSignal
  ): Promise<SearchResponse> {
    if (!braveSearchKey) {
      throw new AiRuntimeError(
        "provider_not_configured",
        "Web search is not configured on this BuildGentic server.",
        { internalDetail: "brave selected with no NEUROLINK_BRAVE_SEARCH_KEY" }
      );
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set("q", request.query);
    url.searchParams.set("count", String(request.maxResults));
    /* Plain web results. Brave will otherwise mix in discussion
       and FAQ blocks whose shapes this adapter does not read. */
    url.searchParams.set("result_filter", "web");

    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": braveSearchKey,
        },
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
          internalDetail: `brave fetch failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      );
    }

    if (!response.ok) {
      /* The body can echo account detail, so none of it travels
         further than this log line. */
      throw new AiRuntimeError(
        response.status === 429 || response.status >= 500
          ? "provider_unavailable"
          : "provider_rejected",
        "The web search could not be completed.",
        { internalDetail: `brave returned HTTP ${response.status}` }
      );
    }

    let body: BraveBody;

    try {
      body = (await response.json()) as BraveBody;
    } catch {
      throw new AiRuntimeError(
        "provider_malformed_response",
        "The web search returned something unreadable.",
        { internalDetail: "brave response was not JSON" }
      );
    }

    const raw = Array.isArray(body.web?.results) ? body.web.results : [];

    return {
      results: raw
        .map((entry) => toResult((entry ?? {}) as BraveResult))
        .filter((entry): entry is SearchResult => entry !== null)
        .slice(0, request.maxResults),
    };
  },
};
