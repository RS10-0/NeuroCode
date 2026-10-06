/*
 * Proof that the landing page still describes the courses that
 * exist.
 *
 * src/features/courses/summary.ts writes the five courses out by
 * hand so the landing page does not have to import the whole
 * curriculum to print five headings. Hand-written data drifts:
 * add a lesson and the card still says the old count, rename a
 * course and the card still says the old name. This compares it
 * against the registry the rest of the platform reads.
 *
 * Reads curriculum code only. No database, no server, no env.
 *
 *   npx tsx ./scripts/verify-course-summary.mts
 */

import { CURRICULA } from "../src/core/curriculum/registry";
import { COURSE_CATALOG } from "../src/features/courses/catalog";
import { COURSE_SUMMARY } from "../src/features/courses/summary";

const problems: string[] = [];
let checks = 0;

const check = (ok: boolean, message: string) => {
  checks += 1;
  if (!ok) problems.push(message);
};

console.log("\nLANDING COURSE SUMMARY\n");

check(
  COURSE_SUMMARY.length === CURRICULA.length,
  `summary lists ${COURSE_SUMMARY.length} courses, registry has ${CURRICULA.length}`
);

CURRICULA.forEach((curriculum, index) => {
  const summary = COURSE_SUMMARY[index];
  const catalog = COURSE_CATALOG.find((c) => c.courseId === curriculum.id);

  if (!summary) {
    problems.push(`${curriculum.id}: missing from the summary`);
    return;
  }

  check(
    summary.courseId === curriculum.id,
    `position ${index + 1}: summary has ${summary.courseId}, registry has ${curriculum.id}`
  );
  check(
    summary.title === curriculum.name,
    `${curriculum.id}: title "${summary.title}", registry says "${curriculum.name}"`
  );
  check(
    summary.lessonCount === curriculum.lessons.length,
    `${curriculum.id}: ${summary.lessonCount} lessons, registry has ${curriculum.lessons.length}`
  );
  check(
    catalog?.description === summary.description,
    `${curriculum.id}: library card and landing card have different blurbs`
  );

  console.log(
    `  ${curriculum.id.padEnd(20)} ${String(curriculum.lessons.length).padStart(2)} lessons  ${curriculum.name}`
  );
});

console.log("\n=== SUMMARY ===");
console.log(`  ${checks - problems.length} passed, ${problems.length} failed`);

for (const problem of problems) {
  console.log(`  FAIL ${problem}`);
}

process.exit(problems.length ? 1 : 0);
