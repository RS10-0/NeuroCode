import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchKnowledgeIndex,
  runKnowledgeIndex,
  type KnowledgeIndexStatus,
} from "./knowledgeIndex";

/*
 * Keeping an agent's knowledge searchable, without asking the
 * learner to think about it.
 *
 * The decision this hook encodes: indexing is not a button a
 * learner should have to find. They wrote a document and saved
 * it; making it searchable is the machine's job, and a Builder
 * that required a second deliberate action would leave people
 * with agents that quietly never search anything.
 *
 * So it runs on its own in three situations, and each is a real
 * one rather than a defensive refresh.
 *
 *   Opening an agent whose knowledge has entries nothing has
 *   indexed yet — which is every agent that existed before this
 *   capability shipped.
 *
 *   Saving, because the text just changed.
 *
 *   Changing power source, because the embedding model changes
 *   with it and vectors made by one model cannot answer a
 *   question embedded by another.
 *
 * All three are cheap when there is nothing to do: the server
 * compares a hash per entry and embeds nothing. The Re-read
 * button is the only forced path, and it exists for the case
 * the hash cannot see — a provider that returned nonsense, or a
 * learner who simply wants to watch it happen.
 */

export interface UseKnowledgeIndexOptions {
  /*
   * Called with every fresh reading, including the ones a run
   * produces as it goes.
   *
   * The Builder uses it to keep the draft's `status` column in
   * step with the server's, which matters more than it sounds:
   * that column is what both composers branch on, so a stale
   * copy means the Test panel pastes a document into the prompt
   * that the runtime is separately retrieving.
   *
   * A callback rather than an effect on `status` because the
   * caller has to setState in response, and doing that
   * synchronously in an effect body is a cascading render.
   */
  onStatus?: (status: KnowledgeIndexStatus) => void;
}

export interface KnowledgeIndexState {
  status: KnowledgeIndexStatus | null;
  indexing: boolean;
  error: string | null;
  /* Re-reads everything, whether or not it has changed. */
  reindex: () => void;
  /* Brings the index up to date after a save. */
  sync: () => void;
}

export function useKnowledgeIndex(
  agentId: string | null,
  options: UseKnowledgeIndexOptions = {}
): KnowledgeIndexState {
  const [status, setStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* In a ref so a caller passing an inline arrow does not
     re-run the effect below on every render. */
  const onStatus = useRef(options.onStatus);

  useEffect(() => {
    onStatus.current = options.onStatus;
  }, [options.onStatus]);

  /* The one place a reading is recorded, so the caller cannot
     be told about one and not another. */
  const record = useCallback((next: KnowledgeIndexStatus) => {
    setStatus(next);
    onStatus.current?.(next);
  }, []);

  /*
   * A run in flight, kept in a ref rather than derived from
   * `indexing`.
   *
   * Two things can start a run at nearly the same moment — a
   * save and the effect below reacting to the id that save
   * produced — and a state flag read inside a callback is a
   * render behind, which is exactly long enough for both to
   * decide they are first. The server would survive it; it
   * claims each entry before embedding. The learner would see
   * every entry sit at "reading it now" twice as long.
   */
  const running = useRef(false);

  const run = useCallback(
    async (force: boolean) => {
      if (!agentId || running.current) {
        return;
      }

      running.current = true;
      setIndexing(true);
      setError(null);

      try {
        const result = await runKnowledgeIndex(agentId, {
          force,
          /* After every pass, so entries turn from "reading it
             now" to "searchable" as the run goes rather than all
             at once at the end. */
          onProgress: record,
        });

        if (result) {
          record(result);
        }
      } catch (failure) {
        /*
         * Reported, never thrown. Nothing here can stop an agent
         * working: every entry the server could not index keeps
         * its old `inline` status and keeps reaching the model
         * in full, so a failed run costs the learner nothing
         * they had before.
         */
        setError(
          failure instanceof Error
            ? failure.message
            : "The knowledge index could not be updated."
        );
      } finally {
        running.current = false;
        setIndexing(false);
      }
    },
    [agentId, record]
  );

  useEffect(() => {
    /*
     * No state is reset on the way out, and nothing needs to be:
     * the Builder remounts its whole workbench on a change of
     * agent, so an id never becomes a different id under this
     * hook and never goes back to null once it has one. Clearing
     * here would be a synchronous setState inside an effect —
     * a cascading render, and the thing the lint rule is right
     * to object to.
     */
    if (!agentId) {
      return;
    }

    let active = true;

    void (async () => {
      let loaded: KnowledgeIndexStatus;

      try {
        loaded = await fetchKnowledgeIndex(agentId);
      } catch (failure) {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "The knowledge index could not be read."
          );
        }

        return;
      }

      if (!active) {
        return;
      }

      record(loaded);

      /* Nothing to do is the common case, and it costs one
         request rather than a round of embeddings. */
      if (loaded.retrievalEnabled && loaded.pending > 0) {
        await run(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [agentId, run, record]);

  const reindex = useCallback(() => void run(true), [run]);
  const sync = useCallback(() => void run(false), [run]);

  return { status, indexing, error, reindex, sync };
}
