/*
 * Proof that every course pays out.
 *
 * The wallet grants are generic — EARNINGS.lessonComplete and
 * EARNINGS.courseComplete are plain constants, granted in one
 * place by routes/progress.ts. What is not generic is whether
 * the server has ever heard of a step: resolveStepXp returns
 * null for anything outside the curricula xpPlan imports, and
 * the route answers 400 "Unknown step". A course that is
 * authored but not registered therefore looks completely fine
 * in the browser and silently awards nothing.
 *
 * So this checks the join rather than the arithmetic: every
 * authored step resolves, every step is filed under the course
 * its lesson claims, each course knows how many completion
 * steps stand between a learner and the course bonus, and the
 * per-lesson split still adds up to the lesson total.
 *
 * Reads curriculum and server code only. No database, no
 * server process, no env — unlike verify-progress.mts, which
 * drives the real API and is the end-to-end counterpart.
 *
 *   npx tsx ./scripts/verify-curriculum-xp.mts
 */

import { CURRICULA } from "../src/core/curriculum/registry";
import { planLessonXp } from "../src/features/learn/xp";
import {
  resolveStepXp,
  courseCompletionStepIds,
  curriculumStepCount,
} from "../server/src/progress/xpPlan";
import { EARNINGS } from "../server/src/credits/costs";

const problems: string[] = [];

console.log("\nCURRICULUM XP WIRING\n");
let steps = 0;

for (const curriculum of CURRICULA) {
  const lessons = curriculum.lessons;

  for (const lesson of lessons) {
    const plan = planLessonXp(lesson);
    const planned = Object.values(plan).reduce((a, b) => a + b, 0);

    if (planned !== lesson.totalXp) {
      problems.push(`${lesson.id}: plan sums to ${planned}, totalXp is ${lesson.totalXp}`);
    }

    for (const step of lesson.steps) {
      steps += 1;
      const r = resolveStepXp(step.id);
      if (!r) { problems.push(`${step.id}: server would 400 "Unknown step"`); continue; }
      if (r.courseId !== lesson.courseId) problems.push(`${step.id}: filed under ${r.courseId}, lesson says ${lesson.courseId}`);
      if (r.lessonId !== lesson.id) problems.push(`${step.id}: filed under lesson ${r.lessonId}`);
      if ((step.type === "completion") !== r.finishesLesson) problems.push(`${step.id}: finishesLesson wrong`);
    }
  }

  const ids = courseCompletionStepIds(curriculum.id);
  if (ids.length !== lessons.length) {
    problems.push(`${curriculum.id}: ${ids.length} completion steps for ${lessons.length} lessons`);
  }
  console.log(`  ${curriculum.id.padEnd(20)} ${String(lessons.length).padStart(2)} lessons  ->  course bonus fires after ${ids.length} completion steps`);
}

console.log(`\n  EARNINGS.lessonComplete = ${EARNINGS.lessonComplete}   EARNINGS.courseComplete = ${EARNINGS.courseComplete}`);
console.log(`  ${steps} steps authored, ${curriculumStepCount()} known to the server`);
console.log(`  unknown course guard: courseCompletionStepIds("nope").length = ${courseCompletionStepIds("nope").length}\n`);

if (problems.length) { console.error("FAILED:\n" + problems.slice(0,20).map(p=>"  - "+p).join("\n")); process.exit(1); }
console.log("PASSED — every step resolves, every course attributes correctly.\n");
