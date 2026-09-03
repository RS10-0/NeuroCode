/*
 * What a stranger's browser is allowed to ask BuildGentic.
 *
 * Every other API client in this project attaches a session
 * token. This one deliberately cannot: a published page is read
 * by people with no BuildGentic account, and the whole feature is
 * pointless if it needs one. So there is no `authHeaders` import
 * here and there is nothing on these calls to authenticate.
 *
 * Which makes the shape of the responses the only privacy
 * boundary there is, and it is worth saying what is NOT in them:
 * no agent id, no deployment id, no user id, no model name, no
 * provider, no instructions, no knowledge, no usage figures. A
 * page is addressed by its slug and by nothing else, so a
 * visitor never holds an identifier that means anything anywhere
 * else in the system.
 *
 * The deployment key path is a different thing entirely and
 * stays a different thing: /api/v1 sits above the CORS
 * middleware precisely so no browser can reach it, because a
 * deployment key on a web page is a deployment key published to
 * the world. Nothing in this file goes near it.
 */

import type { FlagshipId } from "../agents/flagships";
import type { SiteConfig } from "./schema";

/* The agent, as far as a visitor is concerned: a face and a
   name. Everything that describes how it was built is absent. */
export interface PublicAgentFace {
  name: string;
  avatarEmoji: string;
  avatarTone: "accent" | "correct" | "caution" | "error";
  /*
   * Which of BuildGentic's own agents this is, when it is one.
   *
   * The one field here that changes what gets DRAWN rather
   * than what it says: a flagship renders its own purpose-built
   * page instead of one of the four generic layouts. Absent for
   * every agent a student built, which is what keeps those
   * pages exactly as they were.
   *
   * Not an identifier in the sense the rest of this file warns
   * about. It names a catalogue entry that already ships in
   * every browser's bundle, not a row in anybody's database.
   */
  flagshipId?: FlagshipId;
}

export interface PublicSite {
  slug: string;
  config: SiteConfig;
  agent: PublicAgentFace;
  /*
   * Whether the chat will actually answer right now.
   *
   * Distinct from `config.chat.enabled`, which is the student's
   * choice. This one folds in everything else that can stop it:
   * the agent demoted to a draft, the deployment removed, the
   * site unpublished. The page renders the composer as
   * unavailable rather than letting somebody type into a box
   * that will only ever return an error.
   */
  chatLive: boolean;
}

export type PublicSiteResult =
  | { found: true; site: PublicSite }
  | { found: false };

export class SiteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    code: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "SiteError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface ErrorBody {
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

async function asError(response: Response): Promise<SiteError> {
  let body: ErrorBody = {};

  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    /* Non-JSON error body — a proxy or a gateway rather than
       this API. The status is all there is. */
  }

  return new SiteError(
    body.error ?? "This page is not available right now.",
    response.status,
    body.code ?? "unavailable",
    body.retryAfterSeconds
  );
}

/*
 * Resolve a slug.
 *
 * A missing page is `{ found: false }` rather than a thrown
 * error, because 404 is an ordinary outcome here — somebody
 * mistyped a URL — and the caller renders a different screen
 * for it rather than an error state. Everything else throws.
 */
export async function fetchPublicSite(
  slug: string,
  signal?: AbortSignal
): Promise<PublicSiteResult> {
  const response = await fetch(
    `/api/sites/${encodeURIComponent(slug)}`,
    { signal }
  );

  if (response.status === 404) {
    return { found: false };
  }

  if (!response.ok) {
    throw await asError(response);
  }

  const site = (await response.json()) as PublicSite;

  return { found: true, site };
}

/* =========================================================
   VISITOR IDENTITY

   Not an account, and not a tracker. One random string, in one
   browser, scoped to one page.
========================================================= */

const VISITOR_PREFIX = "neurolink.site.visitor.";

/*
 * Who the agent is talking to, when the agent has memory.
 *
 * This exists because of a specific failure it prevents. A
 * deployed agent with memory switched on remembers "the
 * deployment" unless the caller says who is asking — which is
 * right for an API integration, and catastrophic for a public
 * page, where it would mean the first visitor's statements are
 * recalled to the second. Somebody tells a study agent about
 * their exam results and a stranger is greeted with them.
 *
 * So every browser gets its own key, namespaced per site, and
 * the server hashes it before it is stored (see
 * memory/scope.ts) — so BuildGentic keeps a drawer per visitor
 * and never the identifier that opens it.
 *
 * Deliberately localStorage rather than a cookie: it is not
 * sent with requests it is not needed on, it cannot be read
 * cross-site, and it disappears when somebody clears site data,
 * which is exactly the control a visitor should have over
 * something that makes an agent remember them.
 */
export function visitorKey(slug: string): string | undefined {
  const name = `${VISITOR_PREFIX}${slug}`;

  try {
    const existing = window.localStorage.getItem(name);

    if (existing) {
      return existing;
    }

    const minted = randomKey();

    window.localStorage.setItem(name, minted);

    return minted;
  } catch {
    /*
     * Private mode, or storage disabled entirely. The chat still
     * works; the agent simply does not remember this person
     * between visits, which is the correct behaviour for a
     * browser that has asked not to be remembered.
     */
    return undefined;
  }
}

export function forgetVisitor(slug: string): void {
  try {
    window.localStorage.removeItem(`${VISITOR_PREFIX}${slug}`);
  } catch {
    /* Nothing to forget if there was nowhere to remember. */
  }
}

function randomKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  /* Same guard as `newId` in features/agents/types.ts:
     randomUUID is unavailable outside a secure context, which
     includes a dev server reached over a LAN address. */
  let out = "";

  while (out.length < 32) {
    out += Math.floor(Math.random() * 16).toString(16);
  }

  return out;
}
