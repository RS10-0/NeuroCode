import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearMemory,
  fetchMemory,
  forgetMemory,
  type ClearScope,
  type MemoryStatus,
} from "./memory";

/*
 * Keeping the Memory section in step with what the agent has
 * actually stored.
 *
 * The interesting decision here is when it refreshes, and the
 * answer is: after every turn in the Test panel, not on a
 * timer.
 *
 * That is what closes the loop the whole capability rests on. A
 * learner says "I'm aiming for a 5 in May", watches the chip
 * under the answer say it was remembered, opens Memory, and the
 * sentence is there. A panel that only loaded on mount would
 * leave them looking at a stale list and concluding the chip
 * had lied — and this is a feature where being believed is most
 * of the value.
 *
 * It is deliberately not polled. Nothing writes to this table
 * except a turn the learner just took, so there is no
 * background state to discover, and a poll on a screen somebody
 * leaves open would be a request a minute forever for nothing.
 */

export interface AgentMemoryState {
  status: MemoryStatus | null;
  loading: boolean;
  error: string | null;
  /* Re-reads. Called after each turn, and by the Retry button
     on a failed load. */
  refresh: () => void;
  /* Forgets one, then re-reads. */
  forget: (memoryId: string) => Promise<void>;
  /* Forgets everything in one scope, then re-reads. */
  clear: (scope?: ClearScope) => Promise<void>;
  /* True while a delete is in flight, so the section can
     disable its buttons rather than let somebody double-fire a
     destructive action. */
  busy: boolean;
}

export function useAgentMemory(agentId: string | null): AgentMemoryState {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Guards against a reply from a previous agent landing after
   * the learner has navigated to another one. The Builder keeps
   * this hook mounted across that change, so without it a slow
   * response could paint one agent's memories under another
   * agent's name — which, for a feature whose entire promise is
   * that agents do not share memories, is the single worst
   * cosmetic bug available.
   */
  const wantedRef = useRef<string | null>(agentId);

  useEffect(() => {
    wantedRef.current = agentId;
  }, [agentId]);

  /*
   * Reads, and records the result only if it is still wanted.
   *
   * Both callers are event-shaped — a button, or a turn
   * settling — so setting state on the way in is fine here. The
   * effect below deliberately does NOT call this, for the
   * reason spelled out there.
   */
  const refresh = useCallback(() => {
    if (!agentId) {
      return;
    }

    setLoading(true);

    void fetchMemory(agentId)
      .then((next) => {
        if (wantedRef.current !== agentId) {
          return;
        }

        setStatus(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (wantedRef.current !== agentId) {
          return;
        }

        setError(
          cause instanceof Error
            ? cause.message
            : "Could not read what this agent remembers."
        );
      })
      .finally(() => {
        if (wantedRef.current === agentId) {
          setLoading(false);
        }
      });
  }, [agentId]);

  /*
   * The first read, on mount and on a change of agent —
   * including null becoming an id, which is what saving a draft
   * looks like.
   *
   * Written as its own async body rather than as a call to
   * `refresh` above, and the difference is not cosmetic:
   * `refresh` sets a loading flag before it awaits anything,
   * which inside an effect is a synchronous setState and the
   * cascading render the lint rule is right to object to. The
   * same shape useKnowledgeIndex uses, for the same reason.
   *
   * Nothing is cleared on the way out and nothing needs to be:
   * the Builder remounts its workbench on a change of agent, so
   * an id never becomes a different id under this hook.
   */
  useEffect(() => {
    if (!agentId) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const next = await fetchMemory(agentId);

        if (active) {
          setStatus(next);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read what this agent remembers."
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [agentId]);

  const mutate = useCallback(
    async (run: () => Promise<unknown>) => {
      if (!agentId) {
        return;
      }

      setBusy(true);

      try {
        await run();
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not change what this agent remembers."
        );
      } finally {
        setBusy(false);
      }

      /*
       * Always re-read, even after a failure. A delete that
       * errored may still have happened — a lost response is
       * indistinguishable from a lost request — and showing the
       * database's answer is more honest than showing what the
       * browser assumed.
       */
      refresh();
    },
    [agentId, refresh]
  );

  const forget = useCallback(
    (memoryId: string) => mutate(() => forgetMemory(agentId!, memoryId)),
    [agentId, mutate]
  );

  const clear = useCallback(
    (scope: ClearScope = "all") => mutate(() => clearMemory(agentId!, scope)),
    [agentId, mutate]
  );

  return { status, loading, error, refresh, forget, clear, busy };
}
