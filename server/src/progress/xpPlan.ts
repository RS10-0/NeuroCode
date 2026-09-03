import { CURRICULA } from "../../../src/core/curriculum/registry";
import { planLessonXp } from "../../../src/features/learn/xp";

/*
 * How much XP each step is worth, according to the curriculum.
 *
 * The route used to write whatever `xp` the request body
 * carried. Idempotency stopped a step paying out twice, but
 * nothing stopped it paying out 999999 the first time: any
 * signed-in learner could POST a real step id with an invented
 * amount and the server would store it verbatim.
 *
 * The curriculum is plain data with type-only imports, so the
 * server can read the same source the player does rather than
 * keeping a second copy that drifts.
 */

const stepXp = new Map<
  string,
  {
    courseId: string;
    lessonId: string;
    xp: number;
    finishesLesson: boolean;
  }
>();

/*
 * The completion step of every lesson in a course.
 *
 * What "this learner has finished the course" is measured
 * against. Holding the step ids rather than a count matters:
 * lessons can be taken in any order, so finishing the last
 * lesson in the list is not the same event as finishing the
 * course, and counting completed lessons would be fooled by
 * anybody who replayed one.
 */
const courseCompletionSteps = new Map<string, string[]>();

for (const curriculum of CURRICULA) {
  for (const lesson of curriculum.lessons) {
    const plan = planLessonXp(lesson);

    /*
     * The course comes off the lesson, not off the curriculum
     * it was found in. Those agree today, and reading it from
     * the lesson is what keeps them agreeing: a lesson moved or
     * shared between curricula would otherwise be filed under
     * the wrong course, and the course-completion bonus would
     * fire on finishing somebody else's last lesson.
     */
    const courseId = lesson.courseId;

    for (const step of lesson.steps) {
      if (step.type === "completion") {
        const steps = courseCompletionSteps.get(courseId) ?? [];
        steps.push(step.id);
        courseCompletionSteps.set(courseId, steps);
      }

      stepXp.set(step.id, {
        courseId,
        lessonId: lesson.id,
        xp: plan[step.id] ?? 0,
        /*
         * The completion step, read from the curriculum rather
         * than inferred from position or from an id convention.
         *
         * It is what the XP credit grant hangs off: finishing a
         * lesson is the one thing that earns spendable XP, and
         * "which step means finished" is a fact about the
         * curriculum, not about the request.
         */
        finishesLesson: step.type === "completion",
      });
    }
  }
}

export interface ResolvedStep {
  courseId: string;
  lessonId: string;
  xp: number;
  finishesLesson: boolean;
}

/*
 * The XP for a step, or null when the step is not part of the
 * curriculum — which is the only honest answer for an id the
 * server has never heard of.
 *
 * The lesson id comes from the curriculum too, so a request
 * cannot file a real step under a different lesson.
 */
export function resolveStepXp(stepId: string): ResolvedStep | null {
  return stepXp.get(stepId) ?? null;
}

export function curriculumStepCount(): number {
  return stepXp.size;
}

/*
 * Every lesson-completion step in a course.
 *
 * The route compares this against what a learner has actually
 * completed to decide whether the course is finished. Read from
 * the curriculum rather than from a stored count, for the same
 * reason resolveStepXp is: a number in the database would be a
 * second definition of the course, and it would be the one that
 * went stale when a lesson was added.
 *
 * Empty for a course id this build does not ship, which the
 * caller must treat as "not finished" rather than as "finished,
 * vacuously" — every() over an empty list is true, and that
 * would pay a course bonus for a course that does not exist.
 */
export function courseCompletionStepIds(courseId: string): string[] {
  return courseCompletionSteps.get(courseId) ?? [];
}
