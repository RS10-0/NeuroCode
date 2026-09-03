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

export const API_ORIGIN = "http://localhost:3001";

export const WEB_ORIGIN = "http://localhost:5199";

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
