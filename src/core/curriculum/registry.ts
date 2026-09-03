import type { Curriculum } from "./Curriculum";
import type { Lesson } from "./Lesson";

import { aiFoundationsCurriculum } from "./aiFoundations";
import { promptEngineeringCurriculum } from "./promptEngineering";
import { aiAgentsCurriculum } from "./aiAgents";
import { aiWebsitesCurriculum } from "./aiWebsites";
import { aiEthicsCurriculum } from "./aiEthics";

/*
 * ============================================================
 * COURSE REGISTRY
 * ============================================================
 *
 * Every course the platform ships, in the order a learner is
 * suggested to take them.
 *
 * Ethics sits last deliberately. Scenario reasoning about
 * whether to trust a citation lands differently once somebody
 * has built and published something themselves — they reason
 * from experience rather than from a rule they were handed.
 * Nothing gates on this order; it is the order things are
 * listed in, not a lock.
 *
 * Adding a course means adding it here. The catalog, the
 * learning engine, the server's XP plan and the interaction
 * distribution report all read from this array, so a course
 * that is registered here is registered everywhere.
 */

export const CURRICULA: Curriculum[] = [
  aiFoundationsCurriculum,
  promptEngineeringCurriculum,
  aiAgentsCurriculum,
  aiWebsitesCurriculum,
  aiEthicsCurriculum,
];

export const allLessons: Lesson[] = CURRICULA.flatMap(
  (curriculum) => curriculum.lessons
);

/*
 * Every lesson on the platform, as one curriculum.
 *
 * LearningEngine takes a single curriculum and already filters
 * by lesson.courseId everywhere it matters — getLessonsForCourse,
 * getLessonCount, getCourseProgress, getNextLesson. Handing it
 * the union means five courses work through the engine that was
 * written for one, with no change to the engine and no second
 * lookup path to keep in step.
 */
export const neurolinkCurriculum: Curriculum = {
  id: "neurolink",
  name: "BuildGentic",
  description:
    "Every course on the platform, from what AI is through to publishing something you built.",
  concepts: [],
  lessons: allLessons,
  challenges: [],
  totalXp: allLessons.reduce((total, lesson) => total + lesson.totalXp, 0),
};

/* The curriculum a course id belongs to, if it is one we ship. */
export function findCurriculum(
  courseId: string
): Curriculum | undefined {
  return CURRICULA.find((curriculum) => curriculum.id === courseId);
}
