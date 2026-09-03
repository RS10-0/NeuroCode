import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/*
 * The two ways BuildGentic holds a secret, and why there are two.
 *
 * This file shrank once and has now grown back, which is worth
 * recording rather than quietly undoing. It held AES-256-GCM
 * seal/open for learners' provider API keys; all of that went
 * when BYOK did, because BuildGentic then held nobody's vendor
 * credentials and there was nothing left to encrypt at rest.
 *
 * Agent connections brought the requirement back. An agent that
 * calls an API on its owner's behalf has to PRESENT that
 * owner's token to somebody else's server, which means the
 * server must be able to read it back. That is the same problem
 * a provider key was, so it gets the same answer.
 *
 * Deployment keys remain the other kind. A deployment key is
 * never sent anywhere: it is presented by a caller, compared,
 * and thrown away. So it is hashed rather than encrypted, and
 * the plaintext exists exactly once — in the response that mints
 * it, which is why the UI says it will not be shown again.
 *
 * The distinction is the whole design. Recoverable secrets are
 * sealed; verifiable ones are hashed. Anything that reaches for
 * `open()` on a value that only ever needs comparing has taken
 * a wrong turn.
 */

/*
 * A single SHA-256 pass, and deliberately not a slow KDF.
 *
 * Argon2 or bcrypt earn their cost against passwords, which are
 * short, human-chosen and guessable. A deployment key is 32
 * bytes from randomBytes — there is no dictionary to run and no
 * amount of stretching that improves on 256 bits of entropy. A
 * slow hash here would only add latency to every call a deployed
 * agent serves.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/*
 * Constant-time comparison.
 *
 * `===` on a hash leaks how many leading characters matched
 * through how long it took to fail. That is a real attack
 * against a value an attacker can submit repeatedly, which is
 * exactly what a deployment key is.
 *
 * The length check first is not a leak: both sides are
 * fixed-width hex digests here, so an unequal length means
 * malformed input rather than a near miss, and timingSafeEqual
 * throws rather than returning false when the buffers differ in
 * size.
 */
export function sameSecret(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/* =========================================================
   SEALING — for secrets that have to be read back

   AES-256-GCM. Authenticated encryption rather than plain
   AES-CBC, and that is not a preference: without the tag, a
   sealed value stored in a database column an attacker can
   write is a value they can flip bits in, and the plaintext
   that comes out the other side is whatever the flipped bits
   decrypt to. GCM makes tampering an error instead of a
   surprise.
========================================================= */

const KEY_ENV = "NEUROLINK_SECRET_KEY";

/* 96 bits, which is the size GCM is specified for. Longer is
   not stronger here — it gets hashed down internally. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null | undefined;

/*
 * The key, derived once and remembered.
 *
 * Read as either 64 hex characters or a base64 string of 32
 * bytes, because both are things `openssl rand` prints and
 * neither is obviously the one somebody will reach for.
 * Anything else is refused rather than hashed into shape: a
 * passphrase stretched with a single SHA-256 pass looks like a
 * key and has the entropy of a passphrase, and silently
 * accepting one would mean the weakest possible deployment is
 * also the easiest.
 *
 * `undefined` means not yet looked at; `null` means looked at
 * and absent. The difference keeps the warning to once per
 * process instead of once per connection saved.
 */
function secretKey(): Buffer | null {
  if (cachedKey !== undefined) {
    return cachedKey;
  }

  const raw = process.env[KEY_ENV]?.trim();

  if (!raw) {
    console.warn(
      `[crypto] ${KEY_ENV} is not set. Agent connections cannot be saved or used until it is — generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );

    cachedKey = null;
    return cachedKey;
  }

  const decoded = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  const key = decoded.length === 32 ? decoded : null;

  if (!key) {
    console.error(
      `[crypto] ${KEY_ENV} is set but is not a 32-byte key. Expected 64 hex characters or base64 of 32 bytes; agent connections are disabled.`
    );
  }

  cachedKey = key;
  return cachedKey;
}

/* Whether sealing is available at all. Callers use this to
   refuse a save with an explanation, rather than storing
   something they cannot read back. */
export function canSeal(): boolean {
  return secretKey() !== null;
}

export class SecretUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretUnavailableError";
  }
}

/*
 * Plaintext in, one storable string out.
 *
 * Layout is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The
 * version prefix is there so a future key rotation or cipher
 * change can be told apart from a corrupt value — without it,
 * the only way to distinguish "written by an older build" from
 * "damaged" is to try it and see.
 */
export function seal(plaintext: string): string {
  const key = secretKey();

  if (!key) {
    throw new SecretUnavailableError(
      `${KEY_ENV} is not configured, so this secret cannot be stored.`
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/*
 * The reverse, and it throws on anything it does not like.
 *
 * Every failure is the same failure from the caller's point of
 * view — a secret that cannot be read is unusable whether the
 * key changed, the column was edited, or the value was written
 * by a build that sealed differently. The distinctions are
 * logged, not returned: telling a caller which of those went
 * wrong is telling them something about the key.
 */
export function open(sealed: string): string {
  const key = secretKey();

  if (!key) {
    throw new SecretUnavailableError(
      `${KEY_ENV} is not configured, so this secret cannot be read.`
    );
  }

  const parts = typeof sealed === "string" ? sealed.split(".") : [];

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new SecretUnavailableError("This stored secret is not readable.");
  }

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretUnavailableError("This stored secret is not readable.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    /*
     * Almost always one of two things: the key changed, or the
     * row was tampered with. Both are operator-facing, and
     * neither is anything the caller can act on.
     */
    console.error(
      `[crypto] a sealed secret failed to open. Either ${KEY_ENV} has changed since it was written, or the stored value was modified.`
    );

    throw new SecretUnavailableError("This stored secret is not readable.");
  }
}
