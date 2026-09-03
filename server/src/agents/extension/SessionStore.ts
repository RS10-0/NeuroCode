import { supabase } from "../../lib/supabase";
import { hashToken, sameSecret } from "../../ai/crypto";
import { AiRuntimeError } from "../../ai/errors";
import {
  extensionTokenFromHeader,
  mintExtensionToken,
  type ParsedExtensionToken,
} from "./tokens";

/*
 * The extension's paired browsers, and the tokens that reach
 * them.
 *
 * Two rules hold everywhere below, both inherited from
 * DeploymentStore because they were right there and the problem
 * has not changed:
 *
 * A TOKEN GOES IN AND ONLY DERIVED FACTS COME BACK OUT. The
 * plaintext exists for exactly as long as the response that
 * carries it; nothing here can produce it a second time,
 * because nothing here stores it. Enforced by SAFE_COLUMNS,
 * which has no way to name the secret — and, one layer lower,
 * by migration 0020's column-scoped grant, which does not let
 * the browser select token_hash or token_prefix even from its
 * own row.
 *
 * OWNERSHIP IS AN EXPLICIT PREDICATE, NOT A POLICY. The
 * service-role client bypasses RLS, so `.eq("user_id", userId)`
 * on the owner-facing queries is the only thing standing
 * between one learner and another learner's paired browsers.
 *
 * WHAT IS DIFFERENT FROM DeploymentStore, and it is the reason
 * this is a separate file rather than a fifth function there:
 *
 * A deployment key names an agent. This names nobody but a
 * person. Which agents an extension token can reach is not on
 * this row at all — it is read fresh from
 * agent_extension_settings on every turn, so revoking an
 * agent's eligibility takes effect immediately without touching
 * a single token. That is the same argument 0017 made for
 * keeping capability columns off the schedules table: a second
 * copy of the owner's intent is a copy free to disagree with
 * the first.
 */

/* Everything the owner may see about a paired browser. The hash
   and the prefix are absent, and there is no column list in this
   file that includes them outside verification. */
const SAFE_COLUMNS =
  "id, user_id, last4, label, created_at, last_used_at, revoked_at, expires_at";

/*
 * How long a token survives without being used.
 *
 * Sliding rather than fixed: every successful call bumps
 * `last_used_at` and pushes `expires_at` out again, so a token
 * in daily use never expires and one on a laptop nobody opened
 * again stops verifying about a term later.
 *
 * 30 days is the trade Phase 4 §1.4 argues for. Long enough
 * that pairing is genuinely a once-per-browser event; short
 * enough that an abandoned school laptop stops being a live
 * credential inside a term. Restated here rather than only in
 * the column default because this is where it is enforced —
 * expiry is checked on READ, not by a sweep, so a token whose
 * row has not been swept still fails.
 */
const TTL_DAYS = 30;

const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ExtensionSessionSummary {
  id: string;
  /* All the browser ever sees of the token. */
  last4: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  last4: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

function toSummary(row: SessionRow): ExtensionSessionSummary {
  return {
    id: row.id,
    last4: row.last4,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
  };
}

function fail(message: string, detail: string): never {
  throw new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

/*
 * One error for every way a token can be wrong.
 *
 * Missing, malformed, unknown, revoked, or expired all produce
 * this. Telling them apart would tell somebody probing which
 * half of their guess was right, and there is no legitimate
 * caller who needs to know more than that the token they hold
 * does not work here.
 *
 * The message is written for a learner rather than for a
 * developer, because unlike a deployment key the person who
 * meets this IS the account holder — and "reconnect this
 * browser" is a thing they can act on.
 */
function refuse(detail: string): never {
  throw new AiRuntimeError(
    "extension_unauthenticated",
    "This browser is not connected to BuildGentic any more. Open BuildGentic and connect it again.",
    { internalDetail: detail }
  );
}

/*
 * A label the pairing page derives from the user agent.
 *
 * Bounded and flattened rather than trusted: it is displayed on
 * a settings screen, it is chosen by a caller, and it is part
 * of a unique index — so a 4KB label or one containing control
 * characters is a problem in three different places.
 *
 * Not empty, because the column is NOT NULL and the index needs
 * something to constrain. A caller that sends nothing gets the
 * column default's intent rather than a rejection: naming your
 * own browser is a convenience, and failing a pairing over it
 * would be absurd.
 */
function safeLabel(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";

  const flattened = value
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  return flattened || "This browser";
}

/* =========================================================
   MINTING
========================================================= */

export interface MintedSession {
  session: ExtensionSessionSummary;
  /* Shown to the learner's PAGE exactly once, handed straight
     to the extension, and never obtainable again. */
  token: string;
}

/*
 * Pairs a browser, revoking whatever was paired under the same
 * label before it.
 *
 * One active token per user per label, enforced by the partial
 * unique index in 0020. Re-pairing is therefore one action with
 * one outcome — the old token stops working — rather than a
 * growing list of credentials the learner has to reason about
 * and eventually forgets to revoke.
 *
 * The revoke happens first and separately rather than in a
 * transaction with the insert, which is a real if small
 * trade: a crash between the two leaves a browser with no
 * working token and a settings screen with no row, which the
 * learner fixes by pairing again. The alternative is an RPC for
 * a two-statement operation whose failure mode is "press the
 * button again".
 */
export async function mintSession(
  userId: string,
  label: unknown
): Promise<MintedSession> {
  const cleanLabel = safeLabel(label);

  const { error: revokeError } = await supabase
    .from("extension_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("label", cleanLabel)
    .is("revoked_at", null);

  if (revokeError) {
    fail(
      "Unable to connect this browser.",
      `extension_sessions revoke failed: ${revokeError.message}`
    );
  }

  const minted = mintExtensionToken();

  const { data, error } = await supabase
    .from("extension_sessions")
    .insert({
      user_id: userId,
      token_prefix: minted.prefix,
      token_hash: minted.hash,
      last4: minted.last4,
      label: cleanLabel,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    })
    .select(SAFE_COLUMNS)
    .single();

  if (error) {
    /* 23505: another pairing for the same label landed between
       the revoke above and this insert. Two tabs, or a double
       click on Connect. */
    if (error.code === "23505") {
      throw new AiRuntimeError(
        "invalid_request",
        "This browser was connected a moment ago. Reload the page to see it."
      );
    }

    fail(
      "Unable to connect this browser.",
      `extension_sessions insert failed: ${error.message}`
    );
  }

  return { session: toSummary(data as SessionRow), token: minted.token };
}

/* =========================================================
   READING AND REVOKING — the owner's side
========================================================= */

export async function listSessions(
  userId: string
): Promise<ExtensionSessionSummary[]> {
  const { data, error } = await supabase
    .from("extension_sessions")
    .select(SAFE_COLUMNS)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    fail(
      "Unable to load your connected browsers.",
      `extension_sessions select failed: ${error.message}`
    );
  }

  return ((data ?? []) as SessionRow[]).map(toSummary);
}

/* True when a session was actually revoked, so the caller can
   tell "done" from "there was nothing there" — the same signal
   DeploymentStore's revoke returns, and for the same reason: a
   404 and a no-op look identical to a UI otherwise. */
export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("extension_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    fail(
      "Unable to disconnect that browser.",
      `extension_sessions revoke failed: ${error.message}`
    );
  }

  return (data ?? []).length > 0;
}

/* =========================================================
   AUTHENTICATION

   The one place in BuildGentic where an `nlx_` token resolves
   to a user id. There is deliberately no second one.
========================================================= */

export interface AuthenticatedExtension {
  /* Whose quota, whose agents, whose bill. Taken off the stored
     row, never off the request. */
  userId: string;
  sessionId: string;
}

export async function authenticateExtension(
  authorization: unknown
): Promise<AuthenticatedExtension> {
  const parsed: ParsedExtensionToken | null =
    extensionTokenFromHeader(authorization);

  if (!parsed) {
    /*
     * Also the branch a Supabase JWT lands in, and a deployment
     * key, and anything else presented here. The parser is
     * anchored on `nlx_`, so nothing else gets as far as a
     * database read — which is the structural half of the rule
     * that this token works nowhere else and no other token
     * works here.
     */
    refuse("missing or malformed Authorization header");
  }

  const { data, error } = await supabase
    .from("extension_sessions")
    .select("id, user_id, token_hash, revoked_at, expires_at")
    .eq("token_prefix", parsed.prefix)
    .maybeSingle();

  if (error) {
    fail(
      "Unable to check that connection.",
      `extension_sessions select failed: ${error.message}`
    );
  }

  if (!data) {
    refuse(`no session with prefix ${parsed.prefix}`);
  }

  const row = data as {
    id: string;
    user_id: string;
    token_hash: string;
    revoked_at: string | null;
    expires_at: string;
  };

  /*
   * Constant time, even though the stored value is a hash and
   * not the secret. A length-then-bytes comparison on a hash
   * leaks nothing useful in practice, but the cheap habit is
   * the one worth keeping — and `sameSecret` is already here.
   */
  if (!sameSecret(hashToken(parsed.token), row.token_hash)) {
    refuse(`hash mismatch for prefix ${parsed.prefix}`);
  }

  if (row.revoked_at) {
    refuse(`session ${row.id} was revoked at ${row.revoked_at}`);
  }

  /*
   * Expiry is checked HERE rather than by a sweep, and the
   * distinction is the one agent_documents makes: a row that
   * has expired but has not yet been deleted must still fail.
   * A retention job is housekeeping; it is not a security
   * boundary, because it can be late.
   */
  if (Date.parse(row.expires_at) <= Date.now()) {
    refuse(`session ${row.id} expired at ${row.expires_at}`);
  }

  /*
   * The slide. Deliberately not awaited: it is bookkeeping, and
   * a learner's turn should not wait on it or fail because of
   * it. A lost bump costs the token a few minutes of its 30
   * days.
   */
  void touchSession(row.id);

  return { userId: row.user_id, sessionId: row.id };
}

async function touchSession(sessionId: string): Promise<void> {
  const now = new Date();

  const { error } = await supabase
    .from("extension_sessions")
    .update({
      last_used_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    console.error(
      `[extension] could not touch session ${sessionId}: ${error.message}`
    );
  }
}
