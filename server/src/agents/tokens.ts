import { randomBytes } from "node:crypto";

import { hashToken } from "../ai/crypto";

/*
 * The credential an external application presents to a deployed
 * agent.
 *
 * Three parts, separated by underscores:
 *
 *   nld_<prefix>_<secret>
 *
 * `nld` marks it as a BuildGentic deployment key. It costs four
 * characters and buys two things: a learner who finds this
 * string in a config file knows what it is, and a secret scanner
 * — GitHub's, or a grep before a commit — has something to match
 * on. A bare base64 blob is indistinguishable from a session id.
 *
 * `prefix` is the lookup handle. It is stored in the clear and
 * uniquely indexed, so verifying a presented token is one
 * indexed select rather than a scan that hashes every row in the
 * table. It identifies a key; it does not authenticate one.
 *
 * `secret` does that, and only its SHA-256 is ever stored. 32
 * bytes from randomBytes is 256 bits, which is not guessable and
 * is therefore not worth a slow KDF — see the note on hashToken.
 *
 * The parts are separated rather than concatenated at fixed
 * offsets so that lengthening the secret later is not a parsing
 * change.
 */

const SCHEME = "nld";
const PREFIX_BYTES = 6; /* 12 hex characters. */
const SECRET_BYTES = 32;

/*
 * Long enough for the format above with room to grow, short
 * enough that nobody can post a novel into an Authorization
 * header and have it hashed. Checked before any work is done.
 */
export const MAX_TOKEN_CHARS = 200;

export interface MintedToken {
  /* Shown to the learner exactly once, then never again. */
  token: string;
  prefix: string;
  hash: string;
  last4: string;
}

export function mintDeploymentToken(): MintedToken {
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
     * for, so tampering breaks authentication rather than
     * silently redirecting it.
     */
    hash: hashToken(token),
    last4: token.slice(-4),
  };
}

export interface ParsedToken {
  prefix: string;
  token: string;
}

/*
 * The grammar, as one anchored expression.
 *
 * Written this way rather than as a split on "_", which is the
 * trap this format sets and which cost a debugging session:
 * base64url's alphabet INCLUDES the underscore, so a secret
 * carries one about three times in four. Splitting on every
 * underscore and demanding exactly three parts therefore
 * rejected most valid keys, while the occasional
 * underscore-free one worked perfectly — a bug that looked
 * intermittent and was not.
 *
 * The separator is only meaningful for the first two fields.
 * Everything after the second underscore is the secret, however
 * many underscores it contains.
 */
const TOKEN = new RegExp(`^${SCHEME}_([0-9a-f]{12})_([A-Za-z0-9_-]{16,})$`);

/*
 * Shape check only. A token that parses is not a token that
 * works — it still has to match a stored hash — and nothing here
 * should ever tell a caller which half of theirs was wrong.
 */
export function parseDeploymentToken(raw: unknown): ParsedToken | null {
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
 * disagree about its capitalisation and rejecting `bearer` would
 * be a debugging session nobody deserves.
 */
export function tokenFromHeader(header: unknown): ParsedToken | null {
  if (typeof header !== "string") {
    return null;
  }

  const match = /^bearer\s+(.+)$/i.exec(header.trim());

  return parseDeploymentToken(match ? match[1] : header);
}
