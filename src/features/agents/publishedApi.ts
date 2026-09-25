import { ApiError, authHeaders } from "../../lib/api";
import type { TemplateId } from "../sites/schema";
import type { DeploymentKey } from "./deploymentApi";

/*
 * The inventory: what this learner has put in front of other
 * people.
 *
 * Every other client module here is addressed to one agent —
 * fetchDeployment(agentId), fetchSite(agentId) — because every
 * other screen already knows which agent it means. This one
 * asks the question the other way round, and it is the only
 * call in the app that can answer "what of mine is live".
 *
 * It borrows `authHeaders` and `ApiError` from lib/api for the
 * same two reasons deploymentApi.ts does: the session token is
 * attached in exactly one place, and a failure here is a shape
 * callers already handle.
 *
 * What is NOT here is as deliberate as what is. There is no
 * write of any kind — no unpublish, no key rotation, no delete.
 * Those already exist on siteApi and deploymentApi, addressed
 * to one agent, with the confirmation dialogs and the
 * consequence copy that belong to them. An inventory that could
 * also destroy things would be a second path to the same
 * writes, and the second path is always the one that skips the
 * warning.
 */

export interface PublishedSite {
  id: string;
  slug: string;
  /* The full address, ready to copy. Built on the server,
     because the browser cannot know what a production URL looks
     like — the app and the API are different hosts there. */
  url: string;
  published: boolean;
  template: TemplateId;
  siteName: string;
  updatedAt: string;
}

export interface PublishedDeployment {
  id: string;
  publicId: string;
  createdAt: string;
  /* The full URL an external application would call. */
  endpoint: string;
}

export interface PublishedItem {
  /* The join key. The screen resolves the agent's name, avatar
     and official badge from the shelf it already loads, rather
     than having this endpoint restate them. */
  agentId: string;
  deployment: PublishedDeployment;
  /*
   * Null means the endpoint currently refuses everything: the
   * URL survives, the key is revoked, and issuing a new one
   * turns it back on. That is what "paused" is — see
   * DeploymentStore.getActiveKey on why there is no third state.
   */
  key: DeploymentKey | null;
  /* Null means deployed as an API but never given a page. */
  site: PublishedSite | null;
}

export interface PublishedState {
  siteBase: string;
  endpointBase: string;
  items: PublishedItem[];
}

export async function fetchPublished(): Promise<PublishedState> {
  const response = await fetch("/api/agents/published", {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const body = (await response.json()) as { error?: string };

      if (body.error) {
        message = body.error;
      }
    } catch {
      /* Non-JSON error body; keep the status message. */
    }

    throw new ApiError(message, response.status);
  }

  return (await response.json()) as PublishedState;
}
