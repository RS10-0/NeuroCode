import { randomBytes } from "node:crypto";

import { hashToken } from "../../ai/crypto";

/*
 * The credential the browser extension presents.
 *
 * Deliberately the same shape as a deployment key
 * (agents/tokens.ts), and deliberately NOT the same token. Both
 * facts matter, so both are worth stating.
 *
 * THE SAME SHAPE, because the problem is the same one 0006
 * solved: a bearer credential that has to be verifiable in one
 * indexed select, unguessable, and unrecoverable from the
 * database. Three parts, separated by underscores:
 *
 *   nlx_<prefix>_<secret>
 *
 * `nlx` marks it as a BuildGentic extension token. Four
 * characters that buy the same two things `nld` buys: a person
 * who finds this string knows what it is, and a secret scanner
 * has something to match on. It differs from `nld` in one
 * character on purpose — the two are used in different places
 * and confusing them in a bug report should be hard.
 *
 * `prefix` is the lookup handle, stored in the clear and
 * uniquely indexed. It identifies a token; it does not
 * authenticate one.
 *
 * `secret` does that, and only the SHA-256 of the whole token
 * is stored. 32 bytes is 256 bits, which is not guessable and
 * therefore not worth a slow KDF — see the note on hashToken.
 *
 * NOT THE SAME TOKEN, and this is the security-load-bearing
 * half. A deployment key belongs to ONE AGENT and is held by a
 * stranger's application. This belongs to a PERSON and is held
 * by that person's own browser. Sharing a format would invite
 * sharing a verification path, and a verification path that
 * accepts both is one where a deployment key eventually reaches
 * an extension route or the reverse.
 *
 * So the schemes differ, the tables differ, the parsers differ,
 * and neither will parse the other's token. `parseDeployment-
 * Token` refuses an `nlx_` string because the scheme is
 * anchored; the function below refuses an `nld_` one for the
 * same reason. That is not redundancy with the resolver split
 * in the route layer — it is the same rule enforced twice, at
 * two layers, which is what "structural rather than
 * conventional" means.
 *
 * WHAT THIS TOKEN IS NOT, restated because it is the whole
 * point of Phase 4 §1: it is not a Supabase session. It cannot
 * be exchanged for one, it carries no refresh capability, and
 * it is refused by getAuthenticatedUser — which accepts only
 * Supabase JWTs. An extension holding this can reach the
 * extension's own routes and nothing else on this server.
 */

const SCHEME = "nlx";
const PREFIX_BYTES = 6; /* 12 hex characters. */
const SECRET_BYTES = 32;

/*
 * Long enough for the format above with room to grow, short
 * enough that nobody can post a novel into an Authorization
 * header and have it hashed. Checked before any work is done.
 *
 * Same figure as the deployment key's, and it should stay the
 * same: the two are read from the same header position by
 * different resolvers, and a length limit that differed would
 * mean one of them accepted input the other rejected for
 * reasons unrelated to identity.
 */
export const MAX_TOKEN_CHARS = 200;

export interface MintedExtensionToken {
  /* Shown to the learner exactly once — in the response to the
     pairing call — and then never again, because nothing here
     stores it. */
  token: string;
  prefix: string;
  hash: string;
  last4: string;
}

export function mintExtensionToken(): MintedExtensionToken {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${SCHEME}_${prefix}_${secret}`;

  return {
    token,
    prefix,
    /*
     * The whole token is hashed, not just the secret. It costs
     * nothing and it means a row whose prefix has been altered
     * in the database no longer matches the token it was issued
     * for — so tampering breaks authentication rather than
     * silently redirecting it.
     */
    hash: hashToken(token),
    last4: token.slice(-4),
  };
}

export interface ParsedExtensionToken {
  prefix: string;
  token: string;
}

/*
 * The grammar, as one anchored expression.
 *
 * Written this way rather than as a split on "_", which is the
 * trap this format sets and which cost a debugging session the
 * first time it was met in agents/tokens.ts: base64url's
 * alphabet INCLUDES the underscore, so a secret carries one
 * about three times in four. Splitting on every underscore and
 * demanding exactly three parts therefore rejected most valid
 * tokens while the occasional underscore-free one worked — a
 * bug that looked intermittent and was not.
 *
 * The separator is only meaningful for the first two fields.
 * Everything after the second underscore is the secret, however
 * many underscores it contains.
 */
const TOKEN = new RegExp(`^${SCHEME}_([0-9a-f]{12})_([A-Za-z0-9_-]{16,})$`);

/*
 * Shape check only. A token that parses is not a token that
 * works — it still has to match a stored hash, belong to a row
 * that is neither revoked nor expired — and nothing here should
 * ever tell a caller which part of theirs was wrong.
 */
export function parseExtensionToken(
  raw: unknown
): ParsedExtensionToken | null {
  if (typeof raw !== "string") {
    return null;
  }

  const token = raw.trim();

  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return null;
  }

  const match = TOKEN.exec(token);

  return match ? { prefix: match[1], token } : null;
}

/*
 * Pulls the token out of an Authorization header.
 *
 * `Bearer` is accepted case-insensitively because HTTP clients
 * disagree about its capitalisation, and rejecting `bearer`
 * would be a debugging session nobody deserves.
 *
 * A bare token with no scheme is also accepted, matching
 * tokenFromHeader next door. The extension always sends
 * `Bearer`; the leniency is for curl during step 2 of the build
 * order, where the whole point is to exercise this path before
 * any extension exists.
 */
export function extensionTokenFromHeader(
  header: unknown
): ParsedExtensionToken | null {
  if (typeof header !== "string") {
    return null;
  }

  const match = /^bearer\s+(.+)$/i.exec(header.trim());

  return parseExtensionToken(match ? match[1] : header);
}
