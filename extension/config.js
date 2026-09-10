/*
 * Where the extension talks to.
 *
 * Two addresses, kept in one file so that pointing a build at
 * staging is one edit rather than a search. Neither is a secret
 * — the extension's only credential is the token it is given at
 * pairing, and that lives in chrome.storage.
 *
 * WEB_ORIGIN has to agree with `externally_connectable` in the
 * manifest. That list is what allows the pairing page to send
 * the token to this extension at all, so a mismatch does not
 * produce an error — it produces a pairing that silently never
 * completes, which is the failure worth naming here.
 */

export const API_ORIGIN = "https://api.buildgentic.com";

/*
 * NOTE THE `www.` — it is load-bearing, not a typo.
 *
 * The apex buildgentic.com does not serve the app: it answers
 * every path, /extension/connect included, with a 308 to
 * https://www.buildgentic.com. So the pairing page runs on the
 * www origin, and that is the string `sender.url`'s origin is
 * compared against in sw.js. Dropping the `www.` here fails the
 * strict check and pairing never completes, silently — the exact
 * failure named at the top of this file.
 *
 * `externally_connectable` in manifest.json must name this same
 * host. A Chrome match pattern host is exact: buildgentic.com
 * does not match www.buildgentic.com.
 */
export const WEB_ORIGIN = "https://www.buildgentic.com";

export const PAIR_PATH = "/extension/connect";

/*
 * The capture ceiling, and it must not exceed the server's.
 *
 * The server refuses anything over its own limit rather than
 * truncating it — see the note in
 * server/src/agents/extension/pageContext.ts — because a body
 * arriving over the cap did not come from this file, and
 * quietly trimming it would invent a provenance. So this number
 * has to stay at or below NEUROLINK_PAGE_CONTEXT_MAX_CHARS
 * (default 20,000) or long pages will fail instead of arriving
 * marked as truncated.
 */
export const MAX_CAPTURE_CHARS = 20_000;
