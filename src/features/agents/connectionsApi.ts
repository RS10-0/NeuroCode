import { ApiError, authHeaders } from "../../lib/api";

/*
 * The Builder's half of the connections API.
 *
 * Shaped exactly like deploymentApi.ts, and separate from it for
 * the same reasons: src/lib/api.ts keeps its `request` helper
 * private and shaped around progress, and none of this streams.
 * What it borrows is the two things that must not be
 * reimplemented — `authHeaders`, so the session token is
 * attached once in one place, and `ApiError`, so a failure here
 * is a shape callers already handle.
 *
 * The one thing worth stating about these types, and it is the
 * same sentence deploymentApi.ts opens with about deployment
 * keys: there is no shape here that can carry a secret back on
 * a read. `secret` appears on the create input and nowhere
 * else. The server seals it on arrival and never selects the
 * column again outside the runtime, so a compromised browser
 * cannot ask for one — there is no endpoint that would answer.
 */

export type ConnectionAuth = "none" | "bearer" | "header" | "query";

export interface Connection {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  baseUrl: string;
  authKind: ConnectionAuth;
  authName: string | null;
  allowedMethods: string[];
  createdAt: string;
}

export interface ConnectionsState {
  connections: Connection[];
  /*
   * Whether this server can store a secret at all.
   *
   * Reported rather than assumed, because the failure it
   * describes is otherwise invisible from the browser: with
   * NEUROLINK_SECRET_KEY unset, every field on the form works
   * right up to the save. Knowing up front lets the UI explain
   * a configuration problem to the one person who can fix it.
   */
  secretsAvailable: boolean;
  methods: string[];
}

export interface NewConnection {
  slug: string;
  label: string;
  description?: string;
  baseUrl: string;
  authKind: ConnectionAuth;
  authName?: string;
  allowedMethods: string[];
  /* Travels to the server once and is never sent back. */
  secret?: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function fetchConnections(agentId: string): Promise<ConnectionsState> {
  return call<ConnectionsState>(`/${agentId}/connections`);
}

export function createConnection(
  agentId: string,
  input: NewConnection
): Promise<{ connection: Connection }> {
  return call<{ connection: Connection }>(`/${agentId}/connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteConnection(
  agentId: string,
  connectionId: string
): Promise<void> {
  return call<void>(`/${agentId}/connections/${connectionId}`, {
    method: "DELETE",
  });
}
