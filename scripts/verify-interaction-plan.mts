/*
 * Holds the authored curriculum to the interaction plan, and
 * prints the distribution.
 *
 * Activity payloads are discriminated by interactiveType, so a
 * lesson cannot pick its type at runtime — the literal in the
 * content file is what gives TypeScript the payload to check
 * against. That leaves two definitions of the same fact: the
 * planner's and the author's. This script is what stops them
 * drifting. Change the seed, add a course, reorder lessons or
 * hand-edit a type, and it fails here rather than silently
 * producing a course where every third lesson is a quiz.
 *
 * Reads the curriculum only. No database, no server, no env.
 *
 * tsx rather than node --experimental-strip-types: this reaches
 * the curriculum through the registry barrel, whose imports are
 * extensionless the way the app writes them.
 *
 *   npx tsx ./scripts/verify-interaction-plan.mts
 */

import { CURRICULA } from "../src/core/curriculum/registry";
import {
  INTERACTIVE_TYPES,
  NEW_COURSE_SPINES,
  collectInteractionTypes,
  planInteractions,
} from "../src/core/curriculum/interactionPlan";
import type { InteractiveType, Lesson } from "../src/core/curriculum/Lesson";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message);
  }
}

/* ---------------------------------------------------------
   THE PLAN
   --------------------------------------------------------- */

const plannedCourseIds = new Set(
  NEW_COURSE_SPINES.map((course) => course.courseId)
);

/*
 * Baseline is every course the plan does NOT cover.
 *
 * Derived rather than named, so adding a course to the spines
 * moves it out of the baseline automatically instead of getting
 * counted on both sides.
 */
const baseline = collectInteractionTypes(
  CURRICULA.filter((curriculum) => !plannedCourseIds.has(curriculum.id)).flatMap(
    (curriculum) => curriculum.lessons
  )
);

const plan = planInteractions({
  courses: NEW_COURSE_SPINES,
  baseline,
  seed: 1,
});

/* ---------------------------------------------------------
   WHAT WAS ACTUALLY AUTHORED
   --------------------------------------------------------- */

const lessonsById = new Map<string, Lesson>();

for (const curriculum of CURRICULA) {
  for (const lesson of curriculum.lessons) {
    lessonsById.set(lesson.id, lesson);
  }
}

function authoredTypes(lesson: Lesson): InteractiveType[] {
  return lesson.steps.flatMap((step) =>
    step.type === "activity" ? [step.interactiveType] : []
  );
}

/* ---------------------------------------------------------
   GUARD — CONTENT MATCHES THE PLAN
   --------------------------------------------------------- */

for (const course of NEW_COURSE_SPINES) {
  for (const slots of course.lessons) {
    const lesson = lessonsById.get(slots.lessonId);

    if (!lesson) {
      failures.push(`${slots.lessonId}: planned but no such lesson exists.`);
      continue;
    }

    const planned = plan.get(slots.lessonId) ?? [];
    const authored = authoredTypes(lesson);

    check(
      authored.join(",") === planned.join(","),
      `${slots.lessonId}: authored [${authored.join(", ")}] but plan says [${planned.join(", ")}].`
    );
  }
}

/* ---------------------------------------------------------
   GUARD — THE RULES THEMSELVES
   --------------------------------------------------------- */

for (const curriculum of CURRICULA) {
  let previous: InteractiveType[] = [];

  for (const lesson of curriculum.lessons) {
    const types = authoredTypes(lesson);

    /* No lesson repeats a type inside itself. */
    check(
      new Set(types).size === types.length,
      `${lesson.id}: uses the same interactive type twice — [${types.join(", ")}].`
    );

    /* No lesson shares a type with the lesson before it. */
    for (const type of types) {
      check(
        !previous.includes(type),
        `${lesson.id}: ${type} also appears in the lesson immediately before it.`
      );
    }

    check(
      lesson.steps.some((step) => step.type === "completion"),
      `${lesson.id}: has no completion step, so it can never pay out XP.`
    );

    previous = types;
  }
}

/* Step ids are URL-visible and are the XP ledger's key. */
const seenStepIds = new Set<string>();

for (const lesson of lessonsById.values()) {
  for (const step of lesson.steps) {
    check(!seenStepIds.has(step.id), `Duplicate step id: ${step.id}.`);
    seenStepIds.add(step.id);
  }
}

/* ---------------------------------------------------------
   THE DISTRIBUTION
   --------------------------------------------------------- */

const tally = new Map<InteractiveType, number>();
const byCourse = new Map<string, Map<InteractiveType, number>>();

for (const type of INTERACTIVE_TYPES) {
  tally.set(type, 0);
}

for (const curriculum of CURRICULA) {
  const courseTally = new Map<InteractiveType, number>();

  for (const lesson of curriculum.lessons) {
    for (const type of authoredTypes(lesson)) {
      tally.set(type, (tally.get(type) ?? 0) + 1);
      courseTally.set(type, (courseTally.get(type) ?? 0) + 1);
    }
  }

  byCourse.set(curriculum.id, courseTally);
}

const counts = INTERACTIVE_TYPES.map((type) => tally.get(type) ?? 0);
const min = Math.min(...counts);
const max = Math.max(...counts);
const total = counts.reduce((sum, n) => sum + n, 0);

check(
  max - min <= 1,
  `Distribution spread is ${max - min} (min ${min}, max ${max}); it should be at most 1.`
);

check(
  min > 0,
  `At least one interactive type is never used, which means a component nobody can reach.`
);

console.log("\nINTERACTION TYPE DISTRIBUTION — every course\n");

const width = Math.max(...INTERACTIVE_TYPES.map((type) => type.length));

const ranked = [...INTERACTIVE_TYPES].sort(
  (a, b) => (tally.get(b) ?? 0) - (tally.get(a) ?? 0) || a.localeCompare(b)
);

for (const type of ranked) {
  const n = tally.get(type) ?? 0;
  console.log(
    `  ${type.padEnd(width)}  ${String(n).padStart(2)}  ${"#".repeat(n)}`
  );
}

console.log(
  `\n  ${INTERACTIVE_TYPES.length} types · ${total} activities · min ${min} · max ${max} · spread ${max - min}\n`
);

console.log("PER COURSE\n");

for (const curriculum of CURRICULA) {
  const courseTally = byCourse.get(curriculum.id) ?? new Map();
  const used = [...courseTally.keys()].length;
  const slots = [...courseTally.values()].reduce((sum, n) => sum + n, 0);
  const repeated = [...courseTally.entries()].filter(([, n]) => n > 1);

  console.log(
    `  ${curriculum.id} — ${curriculum.lessons.length} lessons, ${slots} activities, ${used} distinct types`
  );

  for (const lesson of curriculum.lessons) {
    const types = authoredTypes(lesson);
    console.log(
      `    ${String(lesson.number).padStart(2, "0")}  ${types.join("  ·  ")}`
    );
  }

  if (repeated.length > 0) {
    console.log(
      `      repeats within this course: ${repeated
        .map(([type, n]) => `${type} x${n}`)
        .join(", ")}`
    );
  }

  console.log("");
}

/* ---------------------------------------------------------
   RESULT
   --------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`FAILED — ${failures.length} problem(s):\n`);

  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }

  process.exit(1);
}

console.log("PASSED — authored content matches the plan, and the rules hold.\n");
