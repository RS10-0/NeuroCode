import { authHeaders } from "../../lib/api";
import type { AiMemoryKind } from "../../lib/aiClient";

/*
 * The Memory section's half of the API.
 *
 * Three calls, and the shape of the set is the point: read,
 * delete one, delete all. There is no `create` and no `update`,
 * and that absence is the security model made visible in the
 * client. A memory is something the server concluded from a
 * conversation; a browser that could assert one would make
 * every promise about prompt injection worthless, so there is
 * no function here to call.
 *
 * Written against `fetch` directly rather than through
 * `request` in lib/api.ts because DELETE answers are read for
 * their body and the shared helper is fine for that — but the
 * clear route takes a query parameter and the shared helper has
 * no way to express one. Two of the three go through it.
 */

export interface AgentMemory {
  id: string;
  kind: AiMemoryKind;
  content: string;
  origin: "learned" | "manual";
  /* Whose store this is in: the learner's own, or somebody
     who called the deployed endpoint. */
  scope: "owner" | "deployment";
  /* A short digest label for a deployed caller, or "shared".
     Absent on the learner's own memories. */
  subject?: string;
  useCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface MemoryStatus {
  limits: {
    maxMemories: number;
    maxContentChars: number;
  };
  /* Off the SAVED agent, not the draft on screen. The panel
     says something different when the capability is off, and
     reading that from the draft would make a saved agent and an
     edited one disagree about what is actually being stored. */
  enabled: boolean;
  memories: AgentMemory[];
}

export type ClearScope = "owner" | "deployment" | "all";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
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

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function fetchMemory(agentId: string): Promise<MemoryStatus> {
  return call(`/agents/${encodeURIComponent(agentId)}/memory`);
}

export function forgetMemory(
  agentId: string,
  memoryId: string
): Promise<{ removed: boolean }> {
  return call(
    `/agents/${encodeURIComponent(agentId)}/memory/${encodeURIComponent(
      memoryId
    )}`,
    { method: "DELETE" }
  );
}

export function clearMemory(
  agentId: string,
  scope: ClearScope = "all"
): Promise<{ cleared: number }> {
  return call(
    `/agents/${encodeURIComponent(agentId)}/memory?scope=${scope}`,
    { method: "DELETE" }
  );
}
