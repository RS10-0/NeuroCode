import { webSearch } from "../../ai/config";
import { AiRuntimeError, normalizeError } from "../../ai/errors";
import { cleanText, safeUrl } from "../sanitize";
import type {
  SearchProvider,
  SearchRecency,
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
/*
 * The date DuckDuckGo already puts on a result.
 *
 * It sits in an unclassed span inside `result__extras__url`,
 * directly after the display URL, and it is an ISO timestamp:
 *
 *   <span>&nbsp; &nbsp; 2026-09-10T00:00:00.0000000</span>
 *
 * That span was being thrown away, and it is worth being blunt
 * about what that cost, because it does not look like much. An
 * agent asked for stories "from the past seven days, with the
 * publication date" got results with no dates on them at all —
 * so the only honest answer available to it was to refuse, and
 * the only other answer available to it was to invent nine
 * dates. The prompt in websearch/context.ts is what made it
 * choose the first. This line is what stops the question being
 * asked.
 *
 * Matched on the span rather than scanned for loosely, because
 * a bare date pattern would also match one that happens to be
 * in a snippet, and a publication date taken from the body of
 * somebody else's article is a fabrication with extra steps.
 *
 * Only the calendar day is kept. The time is always midnight
 * and the seven trailing zeroes are noise a model does not need
 * in its context.
 */
const PUBLISHED =
  /<span[^>]*>(?:&nbsp;|\s)*(\d{4}-\d{2}-\d{2})(?:T[\d:.]*)?\s*<\/span>/i;

/*
 * The row the date is allowed to come from.
 *
 * Anchoring on this before looking for a date is what makes the
 * result honest rather than merely plausible. Without it the
 * scan would accept the first date-shaped span anywhere after
 * the title — and the thing immediately after the title, on a
 * news query, is a snippet full of dates belonging to somebody
 * else's article. A publication date lifted out of an extract
 * is a fabrication that looks exactly like a fact.
 */
const EXTRAS = /class="[^"]*\bresult__extras__url\b[^"]*"/i;

/*
 * How far to look: the markup between a result's title and
 * whatever ends that result.
 *
 * In practice the caller's `to` does the bounding, because it
 * is the next result's anchor. This is the backstop for the
 * LAST result on the page, which has nothing after it — without
 * a cap that one would scan the whole footer.
 */
const EXTRAS_WINDOW = 4000;

function publishedIn(
  html: string,
  from: number,
  to: number
): string | undefined {
  const region = html.slice(from, Math.min(to, from + EXTRAS_WINDOW));

  const extras = EXTRAS.exec(region);

  if (!extras) {
    return undefined;
  }

  const found = PUBLISHED.exec(region.slice(extras.index));

  return found ? found[1] : undefined;
}

function parse(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  /*
   * `at` is where this result's markup starts, so the date can
   * be read from the region between the title and whatever ends
   * the result. The anchor loop cannot see the span itself —
   * it is not an anchor — so the position is what makes it
   * reachable without a second pass over the page.
   */
  let current: { title: string; url: string; at: number } | null = null;

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
        const publishedAt = publishedIn(html, current.at, match.index);
        const { at, ...pending } = current;
        void at;

        results.push({
          ...pending,
          snippet: "",
          ...(publishedAt ? { publishedAt } : {}),
        });

        if (results.length >= limit) {
          break;
        }
      }

      const href = attribute(tag, "href");
      const url = href ? unwrap(href) : null;
      const title = cleanText(inner, 200);

      current =
        url && title
          ? { title, url, at: match.index + match[0].length }
          : null;

      continue;
    }

    if (current && hasClass(tag, "result__snippet")) {
      const publishedAt = publishedIn(html, current.at, match.index);
      const { at, ...pending } = current;
      void at;

      results.push({
        ...pending,
        snippet: cleanText(inner, webSearch.snippetChars),
        ...(publishedAt ? { publishedAt } : {}),
      });

      current = null;
    }
  }

  if (current && results.length < limit) {
    const publishedAt = publishedIn(html, current.at, html.length);
    const { at, ...pending } = current;
    void at;

    results.push({
      ...pending,
      snippet: "",
      ...(publishedAt ? { publishedAt } : {}),
    });
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

/*
 * DuckDuckGo's own time filter, which is the `df` the "Past
 * Week" control on its results page sets.
 *
 * Worth having rather than filtering on the dates above,
 * because the two are not the same operation. Filtering here
 * asks the index for ten recent pages; filtering afterwards
 * takes ten pages and throws most of them away, and a question
 * about this week then gets answered from the two that
 * survived.
 */
const DF: Record<SearchRecency, string> = {
  day: "d",
  week: "w",
  month: "m",
  year: "y",
};

function form(request: SearchRequest): URLSearchParams {
  const params = new URLSearchParams({ q: request.query });

  if (request.recency) {
    params.set("df", DF[request.recency]);
  }

  return params;
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
        body: form(request).toString(),
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
