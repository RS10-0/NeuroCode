import { useCallback, useEffect, useRef, useState } from "react";

import {
  AiError,
  fetchAiRuntimeInfo,
  fetchAiUsage,
  type AiRuntimeInfo,
  type AiUsageReport,
} from "../../lib/aiClient";

/*
 * What this learner can run, and what they have spent.
 *
 * Two endpoints that always load together and are always
 * refreshed together after a run, so they are fetched together
 * here rather than twice over in the page.
 *
 * There used to be a third — the learner's connected API keys —
 * and it went with BYOK.
 *
 * The important asymmetry: the runtime description is required,
 * because a composer cannot size itself without it, while usage
 * is decorative by comparison. A failure to read the meter costs
 * the learner a meter; it must not cost them the Lab.
 */

export interface AiRuntimeState {
  info: AiRuntimeInfo | null;
  usage: AiUsageReport | null;
  /* Only set when the runtime description could not be read. */
  error: AiError | null;
  loading: boolean;
}

export function useAiRuntime() {
  const [state, setState] = useState<AiRuntimeState>({
    info: null,
    usage: null,
    error: null,
    loading: true,
  });

  /* Every in-flight metadata fetch, so an unmount cancels them
     rather than setting state on a dead component. */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    return () => controller.abort();
  }, []);

  const refreshUsage = useCallback(async () => {
    try {
      const usage = await fetchAiUsage(abortRef.current?.signal);
      setState((current) => ({ ...current, usage }));
    } catch {
      /* The meter goes stale; the Lab keeps working. */
    }
  }, []);

  const refreshInfo = useCallback(async () => {
    try {
      const info = await fetchAiRuntimeInfo(abortRef.current?.signal);
      setState((current) => ({ ...current, info, error: null }));
      return info;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }

      setState((current) => ({
        ...current,
        error:
          error instanceof AiError
            ? error
            : new AiError("internal_error", String(error)),
      }));

      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const info = await refreshInfo();

      if (!mounted) {
        return;
      }

      /* An optional extra — awaited only so the first paint
         after loading has it if it is quick. */
      await refreshUsage();

      if (mounted) {
        setState((current) => ({ ...current, loading: false }));
      }

      return info;
    })();

    return () => {
      mounted = false;
    };
  }, [refreshInfo, refreshUsage]);

  return { ...state, refreshInfo, refreshUsage };
}
