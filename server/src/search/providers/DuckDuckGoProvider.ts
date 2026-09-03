import { webSearch } from "../../ai/config";
import { AiRuntimeError, normalizeError } from "../../ai/errors";
import { cleanText, safeUrl } from "../sanitize";
import type {
  SearchProvider,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "../types";

/*
 * The keyless provider, and the default.
 *
 * DuckDuckGo publishes a plain-HTML endpoint intended for
 * browsers that cannot run JavaScript. It needs no account, no
 * key and no billing relationship, which is the entire reason
 * this adapter exists: a learner who clones BuildGentic and
 * switches Web Search on gets a real search of the real web,
 * on the first try, without signing up for anything.
 *
 * The trade is honest and worth writing down. Parsing somebody
 * else's HTML is the least stable way to obtain search results
 * — a class name changes and this adapter returns nothing. That
 * is a degradation rather than a breakage: the runtime turns an
 * empty result into `no_results`, the agent answers without it,
 * and the Test panel says so. And a keyed provider is one
 * environment variable away; see BraveProvider and
 * TavilyProvider, which return structured JSON and are what a
 * production deployment should use.
 *
 * The volume is small by construction — at most a couple of
 * queries per agent turn, behind a per-user quota — which is
 * what makes this a reasonable thing to do at all. DuckDuckGo
 * disagrees under load, and says so with a bot challenge rather
 * than a refusal; see `isChallenge` below, which is the one
 * piece of this adapter that matters most.
 */

const ENDPOINT = "https://html.duckduckgo.com/html/";

/*
 * A browser user agent, because the HTML endpoint answers
 * browsers.
 *
 * Not a disguise: the request is what it looks like, one page of
 * results for one query. Sending a blank or obviously scripted
 * agent gets a challenge page instead of results, and a
 * challenge page parses to zero results — which would present
 * as "the web knows nothing about your question".
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/*
 * Every anchor in the document, with its attributes and its
 * text.
 *
 * One pass over the whole page rather than one pattern per
 * field, because the two things being paired — a result's link
 * and its snippet — are separate anchors that must stay in
 * order. Matching them independently and zipping the lists
 * afterwards would let a result missing its snippet silently
 * borrow the next one's, which is how a citation ends up
 * pointing at the wrong page.
 *
 * Attributes are read out of the captured tag rather than
 * pinned to a position in it: `class` sits before `href` on a
 * result link and could sit after it tomorrow, and a pattern
 * that assumed an order would fail silently and return
 * nothing.
 */
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);

  return match?.[1];
}

function hasClass(tag: string, name: string): boolean {
  return (attribute(tag, "class") ?? "").split(/\s+/).includes(name);
}

/*
 * DuckDuckGo wraps outbound links in its own redirector:
 *
 *   //duckduckgo.com/l/?uddg=<url-encoded destination>&rut=...
 *
 * The destination is what gets cited, so it is unwrapped here.
 * A citation pointing at a redirector is useless to a reader
 * and impossible to judge the trustworthiness of.
 */
function unwrap(href: string): string | null {
  const raw = href.startsWith("//") ? `https:${href}` : href;

  let parsed: URL;

  try {
    parsed = new URL(raw, "https://duckduckgo.com");
  } catch {
    return null;
  }

  const destination = parsed.searchParams.get("uddg");

  return safeUrl(destination ?? parsed.toString());
}

/*
 * Pulls (title, url, snippet) triples out of the page.
 *
 * Deliberately forgiving. Anything that does not parse into a
 * complete result is dropped rather than throwing: a page that
 * has half changed should return fewer results, not fail.
 */
function parse(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  let current: { title: string; url: string } | null = null;

  ANCHOR.lastIndex = 0;

  for (
    let match = ANCHOR.exec(html);
    match !== null && results.length < limit;
    match = ANCHOR.exec(html)
  ) {
    const [, tag, inner] = match;

    if (hasClass(tag, "result__a")) {
      /*
       * A new result. Whatever was pending had no snippet, which
       * is unusual but not a reason to discard a real link.
       */
      if (current) {
        results.push({ ...current, snippet: "" });

        if (results.length >= limit) {
          break;
        }
      }

      const href = attribute(tag, "href");
      const url = href ? unwrap(href) : null;
      const title = cleanText(inner, 200);

      current = url && title ? { title, url } : null;

      continue;
    }

    if (current && hasClass(tag, "result__snippet")) {
      results.push({
        ...current,
        snippet: cleanText(inner, webSearch.snippetChars),
      });

      current = null;
    }
  }

  if (current && results.length < limit) {
    results.push({ ...current, snippet: "" });
  }

  return results;
}

/*
 * Whether this response is a challenge rather than a result
 * page.
 *
 * Three signals, because DuckDuckGo uses more than one. A 202
 * is the clearest — it is not an error status, so `response.ok`
 * is true and nothing else would notice. The markers are what
 * catch a challenge served with a 200.
 */
function isChallenge(status: number, html: string): boolean {
  if (status === 202) {
    return true;
  }

  return (
    html.includes("anomaly.js") ||
    html.includes("challenge-form") ||
    html.includes("cc=botnet")
  );
}

export const duckDuckGoProvider: SearchProvider = {
  id: "duckduckgo",
  displayName: "DuckDuckGo",

  /* Nothing to configure, which is the point of it. */
  isConfigured() {
    return true;
  },

  async search(
    request: SearchRequest,
    signal: AbortSignal
  ): Promise<SearchResponse> {
    let response: Response;

    try {
      /*
       * POSTed as a form, which is what the HTML endpoint's own
       * page does. A GET works too and puts the query in a URL
       * that ends up in somebody's proxy logs; there is no
       * reason to prefer that.
       */
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: new URLSearchParams({ q: request.query }).toString(),
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
          internalDetail: `duckduckgo fetch failed: ${
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
        { internalDetail: `duckduckgo returned HTTP ${response.status}` }
      );
    }

    const html = await response.text();

    /*
     * A challenge is a refusal, and must be reported as one.
     *
     * This is the single most important line in the adapter. A
     * challenge page parses to zero results, and zero results
     * means "the web does not know" — so without this check, a
     * rate-limited server tells every learner that nothing on
     * the internet answers their question, which is both false
     * and unfalsifiable from where they are sitting. Throwing
     * makes the runtime report `unavailable` instead, and the
     * Test panel say "could not search the web this time".
     *
     * The challenge is not solved, worked around, or retried
     * with a different disguise. It is DuckDuckGo saying no to
     * an automated caller, which is theirs to say; the honest
     * answers are to search less, or to use one of the keyed
     * providers, whose whole purpose is to be called by a
     * program.
     */
    if (isChallenge(response.status, html)) {
      throw new AiRuntimeError(
        "provider_unavailable",
        "The web search could not be completed.",
        {
          internalDetail:
            `duckduckgo answered HTTP ${response.status} with a bot challenge rather than results. ` +
            "It is rate-limiting this server. Set NEUROLINK_BRAVE_SEARCH_KEY or " +
            "NEUROLINK_TAVILY_API_KEY and name that provider in " +
            "NEUROLINK_WEB_SEARCH_PROVIDER for a search API meant to be called by a program.",
        }
      );
    }

    return { results: parse(html, request.maxResults) };
  },
};
