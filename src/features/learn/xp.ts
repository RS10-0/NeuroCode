import type { Lesson, LessonStep } from "../../core/curriculum/Lesson";

/* Steps a learner can actually earn XP on by doing something. */
const EARNING_TYPES = new Set(["activity", "quiz", "challenge"]);

export function isEarningStep(step: LessonStep): boolean {
  return EARNING_TYPES.has(step.type);
}

/*
 * Splits a lesson's XP across its steps.
 *
 * The curriculum only authors `xpReward` on completion steps, so
 * finishing a lesson used to pay the whole amount regardless of
 * how much of it the learner actually did. Spreading it across
 * the interactive steps means XP tracks work rather than
 * arrival, and the totals still add up to `lesson.totalXp`
 * exactly — no lesson is worth more or less than advertised.
 *
 * Reading steps earn nothing; the completion step takes the
 * remainder so rounding never loses or invents XP.
 */
export function planLessonXp(lesson: Lesson): Record<string, number> {
  const plan: Record<string, number> = {};

  const earning = lesson.steps.filter(isEarningStep);
  const completion = lesson.steps.find((step) => step.type === "completion");

  const total = Math.max(0, lesson.totalXp ?? 0);

  if (earning.length === 0) {
    if (completion) {
      plan[completion.id] = total;
    }

    return plan;
  }

  /* Three quarters for the work, the remainder for finishing. */
  const pool = Math.floor(total * 0.75);
  const share = Math.floor(pool / earning.length);

  let allocated = 0;

  earning.forEach((step) => {
    const amount = step.xpReward ?? share;
    plan[step.id] = amount;
    allocated += amount;
  });

  if (completion) {
    plan[completion.id] = Math.max(0, total - allocated);
  }

  return plan;
}
