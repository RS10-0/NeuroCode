import { authHeaders } from "../../lib/api";

/*
 * The browser's view of whether an agent's knowledge is
 * searchable yet.
 *
 * Two calls, and deliberately no third. The browser can ask what
 * state the index is in and ask for it to be brought up to date;
 * it cannot write a chunk, a vector or a status, because all
 * three are conclusions the server reached by calling an
 * embedding provider. The tables behind this are owner-read with
 * no write policy at all, so this is not a convention — there is
 * no request that would work.
 *
 * Note what is NOT here: any way to run a search. Retrieval
 * happens inside the runtime, on the request that is about to
 * answer, so that the Builder's Test panel and a deployed agent
 * cannot end up with two implementations of it. The browser
 * never sees a vector and never chooses which passages go to the
 * model.
 */

export type KnowledgeIndexState =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed"
  | "unsupported";

export interface KnowledgeEntryState {
  knowledgeId: string;
  title: string;
  charCount: number;
  position: number;
  state: KnowledgeIndexState;
  /* How many searchable pieces this entry became. */
  chunkCount: number;
  indexedAt: string | null;
  error: string | null;
  /* True while this entry is still being sent in full with
     every message rather than searched. */
  inline: boolean;
}

export interface KnowledgeIndexStatus {
  embeddingModel: {
    id: string;
    displayName: string;
    provider: string;
  } | null;
  /* Set when this agent's power source cannot make embeddings at
     all — written for the owner, in a sentence they can act on. */
  unavailableReason: string | null;
  retrievalEnabled: boolean;
  entries: KnowledgeEntryState[];
  pending: number;
  totalChunks: number;
}

export interface KnowledgeIndexResult extends KnowledgeIndexStatus {
  indexed: number;
  /* Above zero when the run hit its budget and should be called
     again. Not an error. */
  remaining: number;
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

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function fetchKnowledgeIndex(
  agentId: string
): Promise<KnowledgeIndexStatus> {
  return call<KnowledgeIndexStatus>(
    `/${encodeURIComponent(agentId)}/knowledge`
  );
}

/*
 * Brings the index up to date, and says what is left.
 *
 * Safe to call after every save: an entry whose text has not
 * moved is skipped without embedding anything, so the common
 * case costs one comparison per entry. `force` re-embeds
 * regardless, which is what the Re-index button is for.
 *
 * A run that returns `remaining` above zero has not failed — it
 * has done as much as one request should and wants calling
 * again. `runKnowledgeIndex` below does the calling.
 */
export function indexKnowledge(
  agentId: string,
  options: { force?: boolean } = {}
): Promise<KnowledgeIndexResult> {
  return call<KnowledgeIndexResult>(
    `/${encodeURIComponent(agentId)}/knowledge/index`,
    {
      method: "POST",
      body: JSON.stringify({ force: options.force === true }),
    }
  );
}

/*
 * Indexes until there is nothing left to index.
 *
 * The loop is bounded, and the bound is not paranoia: the server
 * decides what `remaining` means, and a bug there — or a
 * provider failing every entry in a way the run does not treat
 * as fatal — would otherwise be an infinite sequence of requests
 * from a page nobody is watching. Ten passes at 200 chunks each
 * is far more than any knowledge base this feature supports.
 *
 * `onProgress` fires after every pass so the Builder can show
 * entries turning from "indexing" to "indexed" as it goes,
 * rather than sitting still and then finishing all at once.
 */
export async function runKnowledgeIndex(
  agentId: string,
  options: {
    force?: boolean;
    onProgress?: (result: KnowledgeIndexResult) => void;
    signal?: AbortSignal;
  } = {}
): Promise<KnowledgeIndexResult | null> {
  let result: KnowledgeIndexResult | null = null;

  for (let pass = 0; pass < 10; pass += 1) {
    if (options.signal?.aborted) {
      return result;
    }

    result = await indexKnowledge(agentId, {
      /* Only the first pass forces. Forcing every pass would
         re-embed what the previous one just finished, forever. */
      force: options.force === true && pass === 0,
    });

    options.onProgress?.(result);

    if (result.remaining <= 0) {
      return result;
    }
  }

  return result;
}
