import { authHeaders } from "./api";
import type { CapabilityId } from "../features/agents/vocab";

/*
 * The Agent Library, as the browser sees it.
 *
 * NOTE WHAT IS ABSENT: there is no `instructions` field on
 * anything here, and there is no endpoint that would return
 * one. BuildGentic's own system prompts live server-side in
 * server/src/agents/flagshipPrompts.ts and never reach a
 * client, because a prompt a learner can read is a prompt they
 * can paste into a free agent — and the prompt is the thing
 * they are paying up to 200 XP for.
 *
 * So this file carries what a card renders and what a purchase
 * returns, and nothing that would make buying pointless.
 *
 * The catalogue is also available synchronously as a static
 * module (src/features/agents/flagships.ts), which is where the
 * names and prices come from when there is no network answer
 * yet. This endpoint exists for the two facts that module
 * cannot know: what this learner owns, and what they can
 * afford.
 */

export interface LibraryAgent {
  id: string;
  name: string;
  tagline: string;
  description: string;
  xpCost: number;
  avatarEmoji: string;
  avatarTone: string;
  capabilities: CapabilityId[];
  starterPrompts: string[];
  hasSeededKnowledge: boolean;
  /* Holds the entitlement. Survives deleting the agent. */
  owned: boolean;
  /*
   * The agent row behind the entitlement, when there is one.
   *
   * Null for somebody who owns a flagship and deleted their
   * copy of it — which the Library renders as "Add again"
   * rather than "Open", and which costs nothing to act on.
   */
  agentId: string | null;
}

export interface LibraryState {
  balance: number;
  available: boolean;
  agents: LibraryAgent[];
}

/*
 * Reports what actually went wrong, which the flat sentence this
 * used to throw did not.
 *
 * Every failure read the same — "Unable to load the Agent
 * Library." — so a 401 from an expired session, a 500 from a
 * missing migration and a 404 from an API server that had not
 * been restarted since the route was added were indistinguishable
 * on the page. The last of those cost an afternoon: the route
 * was mounted in index.ts, the server had been started before
 * that line existed, and the page said nothing that pointed at
 * the process.
 *
 * So the server's own sentence wins where there is one — those
 * are written to be read by a learner — and the status is
 * carried when there is not, because "status 404" at least names
 * a direction to look in.
 */
export async function fetchLibrary(
  signal?: AbortSignal
): Promise<LibraryState> {
  const response = await fetch("/api/agents/library", {
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(
      body?.error ??
        `Unable to load the Agent Library (status ${response.status}).`
    );
  }

  return (await response.json()) as LibraryState;
}

export interface UnlockResult {
  agentId: string;
  /* True when the learner already held this one. A success, not
     an error — and `charged` is 0. */
  alreadyOwned: boolean;
  charged: number;
  balance: number;
  site: { slug: string; url: string; published: boolean } | null;
}

/*
 * Buys one of BuildGentic's agents.
 *
 * Sends no price and no configuration, because it has none to
 * send: everything about what this costs and what it becomes is
 * read from the catalogue on the server. The only thing this
 * request carries is which agent.
 *
 * Throws with the server's own sentence on a refusal, which for
 * the common case — not enough XP — is written to be shown
 * directly to the learner and says what to do about it.
 */
export async function unlockFlagship(
  flagshipId: string,
  signal?: AbortSignal
): Promise<UnlockResult> {
  const response = await fetch(
    `/api/agents/library/${encodeURIComponent(flagshipId)}/unlock`,
    {
      method: "POST",
      headers: await authHeaders(),
      signal,
    }
  );

  const body = (await response.json().catch(() => null)) as
    | (UnlockResult & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "That agent could not be unlocked.");
  }

  if (!body) {
    throw new Error("That agent could not be unlocked.");
  }

  return body;
}
