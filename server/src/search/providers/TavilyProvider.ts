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
          /* Tavily takes the window verbatim — day, week, month
             or year — which is why SearchRecency is spelled the
             way it is. Omitted entirely when the plan named no
             window, because `time_range: null` is not a thing
             the API documents. */
          ...(request.recency ? { time_range: request.recency } : {}),
          /*
           * ASK FOR THE DATE. Without this line Tavily does not
           * send one, and this adapter's `published_date`
           * mapping below has nothing to map.
           *
           * That is not a small omission and it is worth
           * recording what it cost. A scheduled "Morning News
           * digest" asked for three AI stories from the past
           * seven days, with dates. Every result came back
           * dateless, so the agent's only honest move was to
           * refuse — and it did, every morning, in an email its
           * owner had to read to discover the schedule was not
           * working. The prompt was right, the mapping was
           * right, the refusal was right. The request was
           * missing one field.
           *
           * Sent unconditionally rather than only with a
           * recency window. It is free, the API returns null
           * when a page has no detectable date, and a date is
           * worth having on any result a learner might be shown
           * — "is this still true?" is not a question only news
           * questions have.
           */
          include_published_date: true,
          /*
           * The topic, and the reason it is tied to `recency`.
           *
           * `general` is the default and it searches the web the
           * way a person would; `news` retrieves real-time
           * updates. For "three AI news stories from this week"
           * the difference is the whole answer: general search
           * returns the aggregator LANDING PAGES — a site's
           * "latest AI news" feed, undated by nature because it
           * changes hourly — while news returns the individual
           * articles with their own publication dates.
           *
           * `recency` is the right signal for that because of
           * what the plan prompt already asks. It sets a window
           * only when the question is about something "newly
           * published", explicitly distinguished from something
           * "merely correct now". That is the same distinction
           * Tavily's two topics draw, so this is one rule
           * following another rather than a second guess laid
           * on top of the first.
           */
          ...(request.recency ? { topic: "news" } : {}),
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
