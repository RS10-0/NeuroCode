import { ApiError, authHeaders } from "../../lib/api";

/*
 * The Deploy screen's half of the deployment API.
 *
 * Separate from src/lib/api.ts because that file's `request`
 * helper is private and shaped around the progress endpoints;
 * separate from aiClient.ts because none of this streams. What
 * it borrows is the two things that must not be reimplemented:
 * `authHeaders`, so the session token is attached exactly once
 * in one place, and `ApiError`, so a failure here is the same
 * shape a caller already handles.
 *
 * The one thing worth stating about these types: `token` appears
 * on exactly two of them, and only ever as the direct result of
 * minting one. There is no shape here that can carry a key back
 * on a read, because the server has no way to produce one — it
 * stores a hash.
 */

export interface Deployment {
  id: string;
  publicId: string;
  createdAt: string;
  /* The full URL to hand an external application. */
  endpoint: string;
}

export interface DeploymentKey {
  id: string;
  /* All the browser is ever told about the token itself. */
  last4: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface DeploymentUsage {
  requestsMinute: number;
  requestsDay: number;
  requestsTotal: number;
  tokensDay: number;
  inFlight: number;
  lastCalledAt: string | null;
  /*
   * The real runtime error code of the most recent failure. An
   * external caller only ever hears "unavailable", because the
   * true code describes this learner's account; this is where
   * they are told what actually went wrong.
   */
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

export interface DeploymentLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
}

export interface DeploymentState {
  endpointBase: string;
  limits: DeploymentLimits;
  deployment: Deployment | null;
  key: DeploymentKey | null;
  usage: DeploymentUsage | null;
}

/* Returned only by the two calls that mint a key. `token` is
   present exactly once per key, ever. */
export interface IssuedDeployment {
  deployment: Deployment;
  key: DeploymentKey | null;
  token: string | null;
}

export interface IssuedKey {
  key: DeploymentKey;
  token: string;
}

async function call<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`/api/agents${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...init.headers },
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

export function fetchDeployment(agentId: string): Promise<DeploymentState> {
  return call<DeploymentState>(`/${agentId}/deployment`);
}

export function deployAgent(agentId: string): Promise<IssuedDeployment> {
  return call<IssuedDeployment>(`/${agentId}/deployment`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function rotateDeploymentKey(agentId: string): Promise<IssuedKey> {
  return call<IssuedKey>(`/${agentId}/deployment/key`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function revokeDeploymentKey(
  agentId: string
): Promise<{ revoked: boolean }> {
  return call<{ revoked: boolean }>(`/${agentId}/deployment/key`, {
    method: "DELETE",
  });
}

export function removeDeployment(
  agentId: string
): Promise<{ removed: boolean }> {
  return call<{ removed: boolean }>(`/${agentId}/deployment`, {
    method: "DELETE",
  });
}

/*
 * The command a learner runs to prove the thing works.
 *
 * Built here rather than in the component so the endpoint, the
 * header and the body shape have one definition. `stream` is
 * omitted because this endpoint does not stream unless asked,
 * which is what makes a plain curl print an answer.
 */
export function curlExample(endpoint: string, token: string): string {
  return [
    `curl -X POST ${endpoint} \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"messages":[{"role":"user","content":"Hello!"}]}'`,
  ].join("\n");
}
