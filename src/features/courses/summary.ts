/*
 * The five courses as the landing page shows them: id, title,
 * blurb and lesson count, and nothing else.
 *
 * Written out rather than derived, which catalog.ts deliberately
 * is not, and the reason is weight. Deriving a title and a count
 * means importing the curriculum registry, and the registry is
 * every lesson on the platform — over 400 kB of script. The
 * landing page is the one page every visitor loads, and it was
 * downloading all five courses to print five headings.
 *
 * The cost is that this can drift from the curriculum, so it is
 * checked: scripts/verify-course-summary.mts fails if any id,
 * title, order or lesson count here differs from the registry.
 * Run it after adding a lesson or renaming a course.
 *
 * The blurbs live here and only here. catalog.ts reads them, so
 * the library card and the landing card cannot say different
 * things about the same course.
 */

export interface CourseSummary {
  courseId: string;
  title: string;
  description: string;
  lessonCount: number;
}

export const COURSE_SUMMARY: CourseSummary[] = [
  {
    courseId: "ai-foundations",
    title: "What is AI?",
    description:
      "Learn the foundations of artificial intelligence, machine learning, generative AI, and responsible AI use.",
    lessonCount: 8,
  },
  {
    courseId: "prompt-engineering",
    title: "Prompt Engineering & AI Communication",
    description:
      "Why instructions change what an AI does. Context, constraints, formats and examples — ending with a real rewrite in the Lab.",
    lessonCount: 6,
  },
  {
    courseId: "ai-agents",
    title: "AI Agents & Automation",
    description:
      "What separates an agent from a chatbot, and how to give one goals, memory and tools. Ends by building one for real.",
    lessonCount: 7,
  },
  {
    courseId: "ai-websites",
    title: "Building AI-Powered Websites",
    description:
      "Turn something you built into something you can show someone. Design, writing, testing — and publishing a real page.",
    lessonCount: 7,
  },
  {
    courseId: "ai-ethics",
    title: "AI Ethics & Responsibility",
    description:
      "Trust, hallucinations, bias, privacy and schoolwork — worked through as scenarios rather than handed down as rules.",
    lessonCount: 6,
  },
];
