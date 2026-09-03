import { useCallback, useState } from "react";

import type { ActivityCompletionConfig } from "../../../../core/curriculum/Lesson";
import type { AttemptResult } from "../../completion";
import { attemptsRemaining } from "../../completion";
import type { StepProps } from "../../types";

export interface ActivityRun {
  /* True once the learner has submitted and results are shown. */
  checked: boolean;
  /* The attempt the activity last submitted. */
  lastResult: AttemptResult | null;
  attemptsLeft: number | undefined;
  outOfAttempts: boolean;
  /* Submit an attempt. Reveals results and reports upward. */
  check: (result: AttemptResult) => void;
  /* Clear the reveal so the learner can adjust and resubmit. */
  reset: () => void;
}

/*
 * Shared attempt lifecycle for interactive activities.
 *
 * Every activity follows the same rhythm — arrange something,
 * check it, read the feedback, adjust, check again — so the
 * bookkeeping lives here rather than in twenty-one components.
 */
export function useActivityRun(
  step: { completion?: ActivityCompletionConfig },
  { state, onProgress }: Pick<StepProps, "state" | "onProgress">
): ActivityRun {
  const [checked, setChecked] = useState(false);
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null);

  const check = useCallback(
    (result: AttemptResult) => {
      setChecked(true);
      setLastResult(result);
      onProgress(result);
    },
    [onProgress]
  );

  const reset = useCallback(() => {
    setChecked(false);
    setLastResult(null);
  }, []);

  const attemptsLeft = attemptsRemaining(step.completion, state);

  return {
    checked,
    lastResult,
    attemptsLeft,
    outOfAttempts: attemptsLeft === 0,
    check,
    reset,
  };
}

/* Percentage helper shared by scored activities. */
export function scoreOf(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}
