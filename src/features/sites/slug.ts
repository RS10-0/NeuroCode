/*
 * The address a student's agent lives at.
 *
 * One file, imported by both halves of the application, and that
 * is the whole point of it. The browser uses these rules to tell
 * a student their slug is taken before they press anything; the
 * server uses the SAME functions to decide what it will write.
 * Two implementations of "is this a valid slug" would disagree
 * on the first unusual name somebody typed, and the disagreement
 * would surface as a form that says yes and a server that says
 * no.
 *
 * Nothing here touches React, the database, or Node. It is plain
 * TypeScript so `server/src` can import it the way `xpPlan.ts`
 * already imports the curriculum.
 */

/* =========================================================
   SHAPE

   Lowercase ASCII, digits and single hyphens. Deliberately
   narrower than a URL path allows.

   No unicode, because a slug that renders identically to
   another slug in a different script is an impersonation tool
   rather than a feature. No underscores, because they vanish
   under a link underline. No dots, because "/study.tool" reads
   as a file and some hosts will try to serve it as one.
========================================================= */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 32;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/;

/*
 * Paths the application itself owns, and paths it may want to
 * own later.
 *
 * The list is deliberately far longer than the routes that exist
 * today, and the extra entries are the important ones. A slug is
 * a promise: a student prints buildgentic.com/pricing on a poster,
 * and the day BuildGentic ships a pricing page that poster becomes
 * a broken link. Reserving a word costs one line; un-reserving
 * one costs somebody their address.
 *
 * The impersonation block at the end is a different kind of
 * entry and is not about future routes at all. A page at
 * /support or /billing sitting on BuildGentic's own domain, with a
 * chat box on it, is a credential-phishing surface no matter who
 * built it or why.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  /* Live routes. */
  "agents", "build", "courses", "dashboard", "dev", "lab", "learn",
  "lessons", "login", "onboarding", "profile", "projects", "register",

  /* Infrastructure and conventional paths. */
  "api", "app", "assets", "auth", "cdn", "static", "public", "media",
  "files", "images", "img", "js", "css", "fonts", "favicon", "robots",
  "sitemap", "manifest", "sw", "service-worker", "well-known",
  "callback", "oauth", "logout", "signin", "signup", "signout",
  "reset", "verify", "confirm", "invite", "session", "sessions",

  /* Plausible future routes. Cheap now, expensive later. */
  "about", "account", "blog", "careers", "changelog", "community",
  "compare", "contact", "cookies", "deploy", "deployments", "docs",
  "download", "editor", "explore", "feed", "gallery", "guide", "guides",
  "home", "index", "integrations", "jobs", "legal", "library",
  "marketplace", "new", "news", "notifications", "playground",
  "plans", "press", "pricing", "privacy", "reference", "roadmap",
  "search", "settings", "share", "shop", "showcase", "sites", "status",
  "store", "templates", "terms", "tour", "trending", "upgrade",
  "usage", "welcome", "workspace",

  /* Impersonation. Not future routes — pages nobody but
     BuildGentic should ever be able to publish here. */
  "admin", "administrator", "billing", "buildgentic", "help", "internal",
  "invoice", "moderator", "neurocode", "neurolink", "official", "owner",
  "payment", "payments", "refund", "root", "security", "staff",
  "superuser", "support", "system", "team", "trust",
]);

/*
 * Reserved as a whole word above; reserved as a beginning here.
 *
 * "dev" is a route today and "dev-tools-helper" is a reasonable
 * agent name, so a prefix rule would be too blunt for most of
 * the list. These five are different: each is a namespace the
 * application may want to expand into with a hyphen, and each
 * would read as BuildGentic's own if a student held it.
 *
 * The two retired brands stay on the list. Un-reserving a name
 * costs nothing today and costs somebody their address the day
 * an old link is still pointed at it.
 */
const RESERVED_PREFIXES = [
  "buildgentic-",
  "neurolink-",
  "neurocode-",
  "api-",
  "admin-",
];

export type SlugProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "charset"
  | "numeric"
  | "reserved";

export interface SlugCheck {
  ok: boolean;
  problem?: SlugProblem;
  /* Written for the student, not for a log. */
  message?: string;
}

const MESSAGES: Record<SlugProblem, string> = {
  empty: "Pick an address for your page.",
  too_short: `An address needs at least ${SLUG_MIN_LENGTH} characters.`,
  too_long: `An address can be at most ${SLUG_MAX_LENGTH} characters.`,
  charset:
    "Use lowercase letters, numbers and single hyphens — nothing else, and not at the start or end.",
  numeric:
    "An address needs at least one letter, so it does not read as an ID.",
  reserved: "That address is reserved by BuildGentic. Try another.",
};

/*
 * Everything wrong with a slug except whether somebody already
 * has it — that question needs the database and is answered by
 * the store.
 */
export function checkSlug(value: string): SlugCheck {
  const problem = findProblem(value);

  return problem
    ? { ok: false, problem, message: MESSAGES[problem] }
    : { ok: true };
}

function findProblem(value: string): SlugProblem | undefined {
  if (!value) {
    return "empty";
  }

  if (value.length < SLUG_MIN_LENGTH) {
    return "too_short";
  }

  if (value.length > SLUG_MAX_LENGTH) {
    return "too_long";
  }

  if (!SLUG_PATTERN.test(value)) {
    return "charset";
  }

  /*
   * All digits. Refused so an address can never be mistaken for
   * one of the opaque ids elsewhere in this system — and so
   * "/2024" cannot be claimed as a landgrab on a year.
   */
  if (!/[a-z]/.test(value)) {
    return "numeric";
  }

  if (RESERVED_SLUGS.has(value)) {
    return "reserved";
  }

  if (RESERVED_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return "reserved";
  }

  return undefined;
}

export function isValidSlug(value: string): boolean {
  return findProblem(value) === undefined;
}

/* =========================================================
   DERIVATION

   "StudyBuddy" becomes "studybuddy". "Ms. Nakamura's Lab
   Helper" becomes "ms-nakamuras-lab-helper".
========================================================= */

/* Combining marks left behind by NFKD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/* Straight and typographic apostrophes. */
const APOSTROPHES = /['‘’]/g;

/*
 * A name becomes an address.
 *
 * Decomposing to NFKD and dropping the combining marks is what
 * turns "Café Résumé" into "cafe-resume" rather than into
 * "caf-r-sum". It is the one step people leave out, and leaving
 * it out is why so many slug generators mangle any name with an
 * accent in it.
 *
 * Apostrophes are deleted rather than hyphenated, because
 * "students" is the word and "student-s" is not.
 */
export function deriveSlug(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    /* The slice can leave a trailing hyphen behind. */
    .replace(/-+$/g, "");

  /*
   * A name made entirely of characters this drops — an emoji, a
   * title in a non-Latin script — leaves nothing to build an
   * address from. Rather than refuse, fall back to a word that
   * always works and let the ladder below number it. The student
   * is shown the result and can type over it.
   */
  if (!cleaned || !/[a-z]/.test(cleaned)) {
    return "agent";
  }

  if (cleaned.length < SLUG_MIN_LENGTH) {
    return `${cleaned}-agent`.slice(0, SLUG_MAX_LENGTH);
  }

  return cleaned;
}

/* =========================================================
   COLLISIONS

   Two students both build a StudyBuddy. Neither should be told
   to go away.
========================================================= */

/* How many numbered candidates to offer before giving up on
   numbers. Past this the numbers stop being memorable, which
   was the only reason to prefer them. */
const NUMBERED_ATTEMPTS = 8;

const SUFFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/*
 * Deliberately not `crypto.randomUUID`, and deliberately not a
 * secret. This suffix disambiguates; it does not protect
 * anything, because the slug is in the URL of a public page.
 * The alphabet drops l/o/0/1 so a student reading their own
 * address off a screen can type it back correctly.
 */
function randomSuffix(length = 4): string {
  let out = "";

  for (let index = 0; index < length; index += 1) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }

  return out;
}

/* Appending must not push the slug past the ceiling, so the
   base gives up characters rather than the suffix being
   dropped. */
function withSuffix(base: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length - 1;
  const trimmed = base.slice(0, Math.max(1, room)).replace(/-+$/g, "");

  return `${trimmed}-${suffix}`;
}

/*
 * The ladder the server walks.
 *
 * Numbers first, because "studybuddy-2" is something a student
 * can say out loud; then random suffixes, because the numbers
 * run out and a busy name should still be claimable. Every rung
 * is re-checked through `isValidSlug`, so a base that only
 * became invalid after truncation — or a numbered candidate
 * that happens to collide with a reserved word — is skipped
 * rather than offered.
 */
export function slugCandidates(base: string, count = 12): string[] {
  const seed = isValidSlug(base) ? base : deriveSlug(base);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: string) => {
    if (seen.has(candidate) || !isValidSlug(candidate)) {
      return;
    }

    seen.add(candidate);
    out.push(candidate);
  };

  push(seed);

  for (let n = 2; n <= NUMBERED_ATTEMPTS + 1 && out.length < count; n += 1) {
    push(withSuffix(seed, String(n)));
  }

  /* Bounded rather than `while (out.length < count)`: every
     iteration can legitimately produce a duplicate, and a loop
     whose exit depends on randomness is a loop that can hang. */
  for (let tries = 0; tries < count * 4 && out.length < count; tries += 1) {
    push(withSuffix(seed, randomSuffix()));
  }

  return out;
}

/*
 * The last resort, for the race the ladder cannot win.
 *
 * The server picks a free candidate and inserts it, and between
 * those two moments another student can take it. That is a
 * unique violation, and the recovery must not be "walk the same
 * ladder again" — it would propose the same numbers and lose
 * the same race. A fresh six-character suffix ends it.
 */
export function fallbackSlug(base: string): string {
  const seed = isValidSlug(base) ? base : deriveSlug(base);

  return withSuffix(seed, randomSuffix(6));
}

/*
 * What arrives from a URL bar.
 *
 * Trimmed, lowercased, and stripped of surrounding slashes, so
 * "/StudyBuddy/" and "/studybuddy" are the same page rather
 * than one page and one 404. The route redirects to the
 * canonical form rather than serving both, so a page has one
 * address.
 */
export function canonicalizeSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}
