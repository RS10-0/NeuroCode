import { ApiError, authHeaders } from "../../lib/api";
import type { SiteConfig } from "./schema";

/*
 * The owner's half of the page API.
 *
 * Separate from publicApi.ts, and the separation is the point:
 * every call here attaches a session token and none of them can
 * be reached without one, while nothing in publicApi.ts has a
 * token to attach. Two files rather than one function with a
 * flag, so it is impossible to call an owner endpoint from the
 * published page by passing the wrong argument.
 *
 * Shaped like deploymentApi.ts, which is the neighbouring
 * feature and borrows the same two things from lib/api: the
 * session header helper, so a token is attached in exactly one
 * place, and ApiError, so a failure here is the shape callers
 * already handle.
 */

export interface SiteRecord {
  id: string;
  slug: string;
  /* The full address, ready to copy. Built on the server from
     the configured site origin, because the browser cannot know
     what a production URL looks like. */
  url: string;
  config: SiteConfig;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteUsage {
  visitsDay: number;
  requestsDay: number;
  requestsTotal: number;
  tokensDay: number;
  lastVisitAt: string | null;
}

export interface SiteLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
  maxMessages: number;
  visitorRequestsPerMinute: number;
}

export interface SiteState {
  siteBase: string;
  limits: SiteLimits;
  /* A page needs a deployment behind it. The screen reads this
     to offer the Deploy step rather than a Publish button that
     would fail. */
  deployed: boolean;
  site: SiteRecord | null;
  /* The address this agent would get if it published now. */
  suggestedSlug: string;
  usage: SiteUsage | null;
}

export interface SlugCheckResult {
  slug: string;
  available: boolean;
  reason?: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/agents${path}`, {
    ...init,
    headers: {
      ...(await authHeaders()),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
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

  return (await response.json()) as T;
}

export function fetchSite(agentId: string): Promise<SiteState> {
  return call<SiteState>(`/${agentId}/site`);
}

/*
 * Whether an address is free.
 *
 * Behind the session gate on the server even though it reads
 * nothing sensitive — an open version of this is a way to
 * enumerate every student's page one guess at a time.
 */
export function checkSlugAvailable(
  agentId: string,
  slug: string,
  signal?: AbortSignal
): Promise<SlugCheckResult> {
  return call<SlugCheckResult>(
    `/${agentId}/site/slug?value=${encodeURIComponent(slug)}`,
    { signal }
  );
}

export function publishSite(
  agentId: string,
  input: { slug?: string; config?: SiteConfig }
): Promise<{ site: SiteRecord }> {
  return call<{ site: SiteRecord }>(`/${agentId}/site`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/*
 * Saves a change to the live page.
 *
 * There is no draft: what this writes is what visitors see, at
 * once. That is what the feature asks for, and it removes the
 * second question ("is this the version people see?") from
 * every screen — at the cost that a half-finished edit is
 * public for as long as it takes to finish it, which is why
 * `published` exists as a switch.
 */
export function saveSite(
  agentId: string,
  input: { slug?: string; config?: SiteConfig; published?: boolean }
): Promise<{ site: SiteRecord }> {
  return call<{ site: SiteRecord }>(`/${agentId}/site`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function removeSite(agentId: string): Promise<{ removed: boolean }> {
  return call<{ removed: boolean }>(`/${agentId}/site`, { method: "DELETE" });
}

/* =========================================================
   PHASE 2 — NATURAL-LANGUAGE EDITS
========================================================= */

export interface SiteEditResult {
  /* The proposed document. Already validated by the server
     against the same schema a save goes through. */
  config: SiteConfig;
  /*
   * What actually changed, described from the operations the
   * server applied rather than from the model's own account of
   * them — so a model that claims one thing and does another is
   * visible in this list.
   */
  changes: string[];
  /* Parts of the request no field can express. Shown as plainly
     as the changes, because a near miss is worse than a no. */
  unsupported: string[];
  summary: string;
}

/*
 * Ask for a change in plain English.
 *
 * Sends the DRAFT rather than letting the server read the
 * stored row: a student may be several unsaved changes ahead of
 * what is published, and planning against the stored version
 * would return operations addressed to sections that have since
 * moved.
 *
 * Returns a proposal. It does not save — that is still the
 * student pressing Save on a change they have looked at.
 */
export function requestSiteEdit(
  agentId: string,
  input: { config: SiteConfig; request: string },
  signal?: AbortSignal
): Promise<SiteEditResult> {
  return call<SiteEditResult>(`/${agentId}/site/edit`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}
