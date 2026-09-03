import { learningEngine } from "../../core/learning";
import { CURRICULA } from "../../core/curriculum/registry";

/*
 * The course library.
 *
 * Built from the curriculum registry rather than written out,
 * so the library cannot advertise a course that does not exist
 * or miss one that does. Titles and lesson counts come from the
 * curriculum itself; the only thing stated here is the blurb,
 * which is the one part of a course the curriculum has no
 * opinion about.
 *
 * Order is the registry's order, which is the suggested path
 * through the platform. Nothing gates on it — any learner can
 * start any course — but a learner who follows it top to bottom
 * gets ethics after they have built and published something,
 * which is when scenario reasoning has anything to stand on.
 */

export type CourseStatus = "available" | "coming_soon";

export interface CatalogCourse {
  /* Only set for a course that actually exists. */
  courseId?: string;
  title: string;
  description: string;
  status: CourseStatus;
  lessonCount: number;
}

/*
 * The library card for each course. Written for somebody
 * deciding whether to start it, which is a different job from
 * the curriculum description the course page shows.
 */
const BLURBS: Record<string, string> = {
  "ai-foundations":
    "Learn the foundations of artificial intelligence, machine learning, generative AI, and responsible AI use.",
  "prompt-engineering":
    "Why instructions change what an AI does. Context, constraints, formats and examples — ending with a real rewrite in the Lab.",
  "ai-agents":
    "What separates an agent from a chatbot, and how to give one goals, memory and tools. Ends by building one for real.",
  "ai-websites":
    "Turn something you built into something you can show someone. Design, writing, testing — and publishing a real page.",
  "ai-ethics":
    "Trust, hallucinations, bias, privacy and schoolwork — worked through as scenarios rather than handed down as rules.",
};

export const COURSE_CATALOG: CatalogCourse[] = CURRICULA.map(
  (curriculum) => ({
    courseId: curriculum.id,
    title: curriculum.name,
    description: BLURBS[curriculum.id] ?? curriculum.description,
    status: "available" as CourseStatus,
    lessonCount: learningEngine.getLessonCount(curriculum.id),
  })
);

/* The catalog entry for a course id, if it is one we ship. */
export function findCatalogCourse(
  courseId: string | undefined
): CatalogCourse | undefined {
  if (!courseId) {
    return undefined;
  }

  return COURSE_CATALOG.find(
    (course) => course.courseId === courseId && course.status === "available"
  );
}
