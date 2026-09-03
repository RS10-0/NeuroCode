import type {
  ActivityCompletionConfig,
  ActivityState,
} from "../../core/curriculum/Lesson";

export interface AttemptResult {
  completed: boolean;
  score?: number;
  correctActions?: number;
  totalActions?: number;
  /* Named actions performed, for `required_actions` completion. */
  actions?: string[];
}

/*
 * Applies an activity's own completion contract to an attempt.
 *
 * The curriculum authors this per activity — `all_correct`,
 * `minimum_correct`, `target_score`, `required_actions` or
 * `manual_signoff`, with optional partial credit and an attempt
 * cap. Honouring it here means the rules live with the content
 * rather than being reimplemented inside every activity.
 */
export function evaluateAttempt(
  config: ActivityCompletionConfig | undefined,
  previous: ActivityState | undefined,
  result: AttemptResult
): ActivityState {
  const attempts = (previous?.attempts ?? 0) + 1;
  const correct = result.correctActions ?? 0;
  const total = result.totalActions ?? 0;
  const score = result.score ?? (total > 0 ? (correct / total) * 100 : undefined);

  let completed = result.completed;

  if (config) {
    switch (config.type) {
      case "all_correct":
        completed = total > 0 ? correct === total : result.completed;
        break;

      case "minimum_correct":
        completed = correct >= (config.minimumCorrect ?? total);
        break;

      case "target_score":
        completed = (score ?? 0) >= (config.targetScore ?? 100);
        break;

      case "required_actions": {
        const performed = new Set(result.actions ?? []);
        const required = config.requiredActions ?? [];

        completed =
          required.length > 0
            ? required.every((action) => performed.has(action))
            : result.completed;
        break;
      }

      case "manual_signoff":
        completed = result.completed;
        break;
    }

    /*
     * Out of attempts. The learner moves on with whatever they
     * scored rather than being stuck — partial credit is the
     * point of the maxAttempts cap.
     */
    if (
      !completed &&
      config.maxAttempts !== undefined &&
      attempts >= config.maxAttempts
    ) {
      completed = true;
    }
  }

  return {
    completed: completed || Boolean(previous?.completed),
    score: score ?? previous?.score,
    attempts,
    correctActions: result.correctActions ?? previous?.correctActions,
    totalActions: result.totalActions ?? previous?.totalActions,
    startedAt: previous?.startedAt ?? Date.now(),
    completedAt: completed ? Date.now() : previous?.completedAt,
  };
}

/* Attempts remaining, or undefined when the activity is uncapped. */
export function attemptsRemaining(
  config: ActivityCompletionConfig | undefined,
  state: ActivityState | undefined
): number | undefined {
  if (!config?.maxAttempts) {
    return undefined;
  }

  return Math.max(0, config.maxAttempts - (state?.attempts ?? 0));
}
