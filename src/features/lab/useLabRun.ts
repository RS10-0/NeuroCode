import { useCallback, useEffect, useRef, useState } from "react";

import {
  AiError,
  streamChat,
  type AiDoneInfo,
  type AiStartInfo,
} from "../../lib/aiClient";
import { buildRequest, estimateInputTokens } from "./request";
import type { LabRun, LabSettings } from "./types";

/*
 * One run of the Lab, from pressed to finished.
 *
 * Kept apart from the page because the lifecycle here has more
 * states than "loading" and the page has enough to do laying
 * them out: a run can be streaming, stopped by the learner,
 * finished, or failed, and a stop is not a failure — the text
 * already on screen is real, it is simply the part that arrived
 * before the learner said enough.
 */

export type RunPhase = "idle" | "streaming" | "done" | "stopped" | "error";

export interface LabRunState {
  phase: RunPhase;
  /*
   * This run's identifier, minted when Run is pressed rather
   * than when the run lands.
   *
   * The telemetry strip shows it while the answer is still
   * streaming, and the history entry written at the end reuses
   * the same value — so the id under the output and the id in
   * the experiment log are the one id, not two.
   */
  runId: string | null;
  /* The answer so far. Never cleared mid-run. */
  output: string;
  /* Which model actually answered — the server may have applied
     a default the learner never chose. */
  start: AiStartInfo | null;
  done: AiDoneInfo | null;
  error: AiError | null;
  firstTokenMs: number | null;
  /* The settings this run was launched with, frozen. */
  settings: LabSettings | null;
  estimatedInputTokens: number;
}

const IDLE: LabRunState = {
  phase: "idle",
  runId: null,
  output: "",
  start: null,
  done: null,
  error: null,
  firstTokenMs: null,
  settings: null,
  estimatedInputTokens: 0,
};

interface UseLabRunOptions {
  /*
   * Called once a run has reached a terminal state, successful
   * or not. The page decides what to do with it — currently,
   * push it onto the tab-local history.
   */
  onFinished: (run: LabRun) => void;
}

export function useLabRun({ onFinished }: UseLabRunOptions) {
  const [state, setState] = useState<LabRunState>(IDLE);

  const abortRef = useRef<AbortController | null>(null);

  /*
   * The accumulated answer, held outside React as well as in it.
   *
   * The history record is built in the same tick the run ends,
   * and reading `state.output` there would read the value from
   * the render that started the run rather than the one the last
   * delta produced.
   */
  const outputRef = useRef("");

  /*
   * Kept in a ref so `run` does not have to be rebuilt — and
   * every control that depends on it re-rendered — each time the
   * page defines a new callback.
   *
   * Updated in an effect rather than during render: a render can
   * be thrown away, and writing to a ref from one that is would
   * leave the ref describing a render that never committed.
   */
  const finishedRef = useRef(onFinished);

  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);

  /* A run in flight when the page goes away is a run nobody will
     read. Aborting closes the socket, which the server turns
     into an aborted provider request. */
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    outputRef.current = "";
    setState(IDLE);
  }, []);

  /* crypto.randomUUID is unavailable on a page served over
     plain HTTP from anything but localhost, so the Lab keeps a
     readable fallback rather than throwing. */
  const mintRunId = useCallback(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  const run = useCallback(async (settings: LabSettings) => {
    /* A second Run while one is in flight replaces it rather
       than racing it. */
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    outputRef.current = "";

    const estimatedInputTokens = estimateInputTokens(settings);
    const runId = mintRunId();

    setState({
      ...IDLE,
      phase: "streaming",
      runId,
      settings,
      estimatedInputTokens,
    });

    const began = performance.now();

    let start: AiStartInfo | null = null;
    let done: AiDoneInfo | null = null;
    let firstTokenMs: number | null = null;
    let failure: AiError | null = null;

    try {
      await streamChat(
        buildRequest(settings),
        {
          onStart: (info) => {
            start = info;
            setState((current) => ({ ...current, start: info }));
          },

          onDelta: (text) => {
            if (firstTokenMs === null) {
              firstTokenMs = Math.round(performance.now() - began);
            }

            outputRef.current += text;

            const snapshot = outputRef.current;
            const measured = firstTokenMs;

            setState((current) => ({
              ...current,
              output: snapshot,
              firstTokenMs: current.firstTokenMs ?? measured,
            }));
          },

          onDone: (info) => {
            done = info;
          },
        },
        controller.signal
      );
    } catch (error) {
      failure =
        error instanceof AiError
          ? error
          : new AiError("internal_error", String(error));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }

    /*
     * A stop is an outcome, not a fault. The learner asked for
     * it, the partial answer on screen is genuine, and colouring
     * it red would suggest something broke.
     */
    const stopped = failure?.code === "cancelled";

    const phase: RunPhase = stopped ? "stopped" : failure ? "error" : "done";

    setState({
      phase,
      runId,
      output: outputRef.current,
      start,
      done,
      error: stopped ? null : failure,
      firstTokenMs,
      settings,
      estimatedInputTokens,
    });

    finishedRef.current({
      /* The same id the telemetry strip has been showing since
         the run started. */
      id: runId,
      at: Date.now(),
      settings,
      start,
      done,
      error: failure
        ? { code: failure.code, message: failure.message }
        : null,
      output: outputRef.current,
      truncated: false,
      firstTokenMs,
      estimatedInputTokens,
    });
  }, [mintRunId]);

  return { state, run, stop, reset };
}
