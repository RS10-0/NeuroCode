import type { ActivityState, LessonStep } from "../../core/curriculum/Lesson";

/*
 * Contract every step component implements.
 *
 * The player owns navigation and persistence; a step owns its
 * own interaction and reports completion upward. Adding a new
 * LessonStepType means writing one component and registering
 * it — no change to the player.
 */
export interface StepProps<TStep extends LessonStep = LessonStep> {
  step: TStep;

  /* Persisted state for this step, if it has been attempted. */
  state: ActivityState | undefined;

  /*
   * Report an attempt. `completed` gates the Continue button;
   * `score` is 0-100 where the activity produces one.
   */
  onProgress: (result: {
    completed: boolean;
    score?: number;
    correctActions?: number;
    totalActions?: number;
  }) => void;
}
