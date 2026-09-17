import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { challengeById, type Challenge } from "./challenges";
import {
  describeChange,
  differences,
  lengthDelta,
  newExperiment,
  verdictId,
  type Difference,
  type Experiment,
  type Side,
  type Verdict,
} from "./experiment";
import type { LabSettings } from "../types";
import { useLabRun } from "../useLabRun";

/*
 * The bench's state: one experiment, two runs, and what you
 * concluded.
 *
 * ONE EXPERIMENT AT A TIME, and no way to have several. Three
 * earlier versions of this workspace grew a draft switcher, a
 * rename field, duplicate and delete — file management, on a
 * screen whose actual job is a comparison. A bench has one thing
 * on it. What survives between experiments is the findings log,
 * because the findings are the thing a learner is here to
 * accumulate; the prompts that produced them are scaffolding.
 */

const STORAGE_KEY = "neurolink.lab.compare.v1";

/* Enough to look back over a session's worth of conclusions.
   Past that the oldest goes: a findings list longer than a
   screen stops being something you read. */
const MAX_FINDINGS = 24;

/*
 * A conclusion, kept after the experiment that produced it is
 * gone.
 *
 * Carries its own text rather than a pointer at the experiment,
 * for the reason the verdict does: the settings move on the
 * moment a winner is promoted, and a finding that resolved
 * against live state would rewrite its own history.
 */
export interface Finding {
  id: string;
  at: number;
  question: string;
  changed: string;
  outcome: string;
  note: string;
}

interface Stored {
  /* Whose these are. A mismatch empties the store. */
  userId: string;
  experiment: Experiment | null;
  findings: Finding[];
}

function readStore(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Stored;

    if (typeof parsed?.userId !== "string") {
      return null;
    }

    return {
      userId: parsed.userId,
      experiment: parsed.experiment ?? null,
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.slice(0, MAX_FINDINGS)
        : [],
    };
  } catch {
    /* Storage can be unavailable outright — private mode, an
       embedded webview, site data blocked. The bench works
       perfectly well for one sitting without it. */
    return null;
  }
}

function writeStore(value: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Quota exceeded, or storage disabled. The in-memory copy
       React holds is still correct for this session. */
  }
}

export interface ExperimentApi {
  experiment: Experiment;
  challenge: Challenge | undefined;
  findings: Finding[];

  /* What differs between the two sides, right now. */
  differences: Difference[];
  changeSummary: string;

  /* The two runs. */
  a: ReturnType<typeof useLabRun>["state"];
  b: ReturnType<typeof useLabRun>["state"];
  running: boolean;
  /* True once both sides have an answer worth judging. */
  comparable: boolean;

  edit: (side: Side, patch: Partial<LabSettings>) => void;
  setQuestion: (question: string) => void;
  runBoth: () => Promise<void>;
  stop: () => void;

  /* Records the verdict, promotes the winner into A, and
     re-clones B from it. */
  judge: (winner: Side, note: string) => void;

  startFresh: (settings: LabSettings) => void;
  startChallenge: (challengeId: string, base: LabSettings) => void;
  clearFindings: () => void;
}

export function useExperiment(
  userId: string,
  /* The catalogue's own defaults, so an experiment opens with
     the parameters the runtime would have used anyway. */
  base: LabSettings
): ExperimentApi {
  const [opening] = useState(() => {
    const stored = readStore();

    if (!stored || stored.userId !== userId) {
      return { experiment: newExperiment(base), findings: [] as Finding[] };
    }

    return {
      experiment: stored.experiment ?? newExperiment(base),
      findings: stored.findings,
    };
  });

  const [experiment, setExperiment] = useState<Experiment>(opening.experiment);
  const [findings, setFindings] = useState<Finding[]>(opening.findings);

  /* Nothing is written until something happens. A learner who
     opens the tab and leaves should not find a store they never
     asked for. */
  const touched = useRef(false);

  /* ---------------------------------------------------------
     THE TWO RUNS

     Two instances of the Playground's own runner, both claiming
     `compare`. The server's lab concurrency cap is 3, so two at
     once sits inside it — which is one of the reasons this is a
     pair rather than a grid.
     --------------------------------------------------------- */

  /* The bench keeps no run history of its own: the Playground's
     log is per-run and this produces two at a time, so a pair
     would arrive there as two unrelated entries that no longer
     say they were a comparison. What the bench records instead
     is the finding. */
  const discard = useCallback(() => {}, []);

  const runA = useLabRun({ onFinished: discard, feature: "compare" });
  const runB = useLabRun({ onFinished: discard, feature: "compare" });

  const running =
    runA.state.phase === "streaming" || runB.state.phase === "streaming";

  const comparable =
    runA.state.output.trim().length > 0 && runB.state.output.trim().length > 0;

  /* ---------------------------------------------------------
     PERSISTENCE
     --------------------------------------------------------- */

  const latest = useRef({ experiment, findings });

  useEffect(() => {
    latest.current = { experiment, findings };
  }, [experiment, findings]);

  useEffect(() => {
    if (!userId || !touched.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      writeStore({ userId, experiment, findings });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [userId, experiment, findings]);

  /* Leaving the Lab must not drop whatever is still sitting in
     the debounce. */
  useEffect(() => {
    if (!userId) {
      return;
    }

    const flush = () => {
      if (touched.current) {
        writeStore({
          userId,
          experiment: latest.current.experiment,
          findings: latest.current.findings,
        });
      }
    };

    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [userId]);

  /* ---------------------------------------------------------
     EDITING
     --------------------------------------------------------- */

  const edit = useCallback((side: Side, patch: Partial<LabSettings>) => {
    touched.current = true;

    setExperiment((current) => ({
      ...current,
      [side]: { ...current[side], ...patch },
      updatedAt: Date.now(),
    }));
  }, []);

  const setQuestion = useCallback((question: string) => {
    touched.current = true;
    setExperiment((current) => ({ ...current, question }));
  }, []);

  /* ---------------------------------------------------------
     RUNNING
     --------------------------------------------------------- */

  const runBoth = useCallback(async () => {
    touched.current = true;

    /*
     * Both at once, not one after the other.
     *
     * Sequential runs would be gentler on the concurrency cap
     * and would also mean the second answer arrives against a
     * model that has had a few more seconds of whatever the
     * provider is doing. Simultaneous is the fairer test, and it
     * is the one that reads as a comparison rather than as two
     * errands.
     */
    await Promise.all([
      runA.run(experiment.a),
      runB.run(experiment.b),
    ]);
  }, [experiment.a, experiment.b, runA, runB]);

  const stop = useCallback(() => {
    runA.stop();
    runB.stop();
  }, [runA, runB]);

  /* ---------------------------------------------------------
     JUDGING
     --------------------------------------------------------- */

  const diffs = useMemo(() => differences(experiment), [experiment]);
  const changeSummary = useMemo(() => describeChange(diffs), [diffs]);

  /*
   * The verdict, and the promotion that follows it.
   *
   * Promoting the winner into A and re-cloning B is what makes
   * this a loop rather than a one-off comparison: the thing you
   * just proved better becomes the thing you are now trying to
   * beat. It is also the only way the "change one thing" rule
   * can hold across more than one round, because B always starts
   * identical to whatever currently wins.
   */
  const judge = useCallback(
    (winner: Side, note: string) => {
      touched.current = true;

      const delta = lengthDelta(runA.state.output, runB.state.output);

      const outcome =
        delta === null
          ? "No measurable difference in length."
          : delta === 0
            ? "Same length."
            : delta < 0
              ? `B was ${Math.abs(delta)}% shorter.`
              : `B was ${delta}% longer.`;

      const record: Verdict = {
        id: verdictId(),
        at: Date.now(),
        winner,
        changed: changeSummary,
        lengthDelta: delta,
        note,
      };

      setFindings((current) =>
        [
          {
            id: record.id,
            at: record.at,
            question: experiment.question,
            changed: changeSummary,
            outcome: `${winner.toUpperCase()} won. ${outcome}`,
            note,
          },
          ...current,
        ].slice(0, MAX_FINDINGS)
      );

      setExperiment((current) => {
        const kept = winner === "a" ? current.a : current.b;

        return {
          ...current,
          a: { ...kept, stop: [...kept.stop] },
          b: { ...kept, stop: [...kept.stop] },
          verdicts: [record, ...current.verdicts],
          updatedAt: Date.now(),
        };
      });

      /* The old answers described the old pair. Leaving them on
         screen next to a freshly cloned B would show two
         identical prompts with two different answers and imply
         the prompts caused it. */
      runA.reset();
      runB.reset();
    },
    [changeSummary, experiment.question, runA, runB]
  );

  /* ---------------------------------------------------------
     STARTING OVER
     --------------------------------------------------------- */

  const startFresh = useCallback((settings: LabSettings) => {
    touched.current = true;
    setExperiment(newExperiment(settings));
    runA.reset();
    runB.reset();
  }, [runA, runB]);

  const startChallenge = useCallback(
    (challengeId: string, settings: LabSettings) => {
      const challenge = challengeById(challengeId);

      if (!challenge) {
        return;
      }

      touched.current = true;

      const start: LabSettings = {
        ...settings,
        system: challenge.start.system,
        prompt: challenge.start.prompt,
      };

      setExperiment({
        ...newExperiment(start, challenge.goal),
        challengeId: challenge.id,
      });

      runA.reset();
      runB.reset();
    },
    [runA, runB]
  );

  const clearFindings = useCallback(() => {
    touched.current = true;
    setFindings([]);
  }, []);

  return {
    experiment,
    challenge: experiment.challengeId
      ? challengeById(experiment.challengeId)
      : undefined,
    findings,
    differences: diffs,
    changeSummary,
    a: runA.state,
    b: runB.state,
    running,
    comparable,
    edit,
    setQuestion,
    runBoth,
    stop,
    judge,
    startFresh,
    startChallenge,
    clearFindings,
  };
}
