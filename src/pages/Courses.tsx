import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Lock } from "lucide-react";

import { learningEngine } from "../core/learning";
import { COURSE_CATALOG } from "../features/courses/catalog";
import type { CatalogCourse } from "../features/courses/catalog";
import { getLessonProgressMap } from "../lib/progress";
import { Badge, ProgressBar, Skeleton } from "../components/ui";

/*
 * The course library.
 *
 * Choosing between courses, not working through one — so a
 * grid of cards rather than the lesson list that used to sit on
 * this route. Opening a card is what gets you the lessons.
 *
 * Only shipped courses are links. The three placeholders render
 * as plain elements with no href, because a card that looks
 * clickable and does nothing is worse than one that plainly
 * says it is not ready.
 */
export default function Courses() {
  /* Progress is only fetched for courses that actually exist. */
  const liveCourses = useMemo(
    () => COURSE_CATALOG.filter((course) => course.status === "available"),
    []
  );

  const [completedByCourse, setCompletedByCourse] = useState<
    Record<string, number>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const lessonIds = liveCourses.flatMap((course) =>
      learningEngine
        .getLessonsForCourse(course.courseId ?? "")
        .map((lesson) => lesson.id)
    );

    getLessonProgressMap(lessonIds)
      .then((rows) => {
        if (!active) {
          return;
        }

        const counts: Record<string, number> = {};

        liveCourses.forEach((course) => {
          const id = course.courseId ?? "";

          counts[id] = learningEngine
            .getLessonsForCourse(id)
            .filter((lesson) => rows[lesson.id]?.completed).length;
        });

        setCompletedByCourse(counts);
      })
      .catch(() => {
        /*
         * The library still lists every course when progress
         * cannot be read. Only the completion figures are lost,
         * and a card with no progress bar is a reasonable
         * degraded state.
         */
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [liveCourses]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Courses</h1>
        <p className="page__lede">
          Structured paths through AI, from the foundations to building things
          people can use.
        </p>
      </header>

      <div className="course-grid">
        {COURSE_CATALOG.map((course) => (
          <CourseCard
            key={course.courseId ?? course.title}
            course={course}
            completed={completedByCourse[course.courseId ?? ""] ?? 0}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}

interface CourseCardProps {
  course: CatalogCourse;
  completed: number;
  isLoading: boolean;
}

function CourseCard({ course, completed, isLoading }: CourseCardProps) {
  const isAvailable = course.status === "available";
  const percent = course.lessonCount
    ? (completed / course.lessonCount) * 100
    : 0;
  const isFinished = isAvailable && completed === course.lessonCount;

  const body = (
    <>
      <div className="course-card__head">
        <span
          className={
            isAvailable ? "course-card__mark" : "course-card__mark course-card__mark--soon"
          }
        >
          {isAvailable ? (
            isFinished ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <ArrowRight size={15} aria-hidden="true" />
            )
          ) : (
            <Lock size={14} aria-hidden="true" />
          )}
        </span>

        {isAvailable ? (
          <Badge tone={isFinished ? "correct" : "accent"}>
            {isFinished ? "Complete" : "Available"}
          </Badge>
        ) : (
          <Badge tone="neutral">Coming Soon</Badge>
        )}
      </div>

      <h2 className="course-card__title">{course.title}</h2>
      <p className="course-card__text">{course.description}</p>

      <div className="course-card__foot">
        {isAvailable ? (
          <>
            <div className="course-card__meta">
              <span className="meta">
                {course.lessonCount} Lessons
              </span>
              <span className="meta">
                {isLoading ? "—" : `${completed} / ${course.lessonCount}`}
              </span>
            </div>

            {isLoading ? (
              <Skeleton width="100%" height="6px" />
            ) : (
              <ProgressBar
                percent={percent}
                label={`${course.title} progress`}
              />
            )}
          </>
        ) : (
          <span className="meta">Not available yet</span>
        )}
      </div>
    </>
  );

  if (!isAvailable) {
    /*
     * Not a link and not a button — there is nowhere to go. It
     * is marked aria-disabled so assistive tech announces the
     * state rather than reading a card that appears actionable.
     */
    return (
      <div
        className="course-card course-card--soon"
        aria-disabled="true"
        title="This course is not available yet."
      >
        {body}
      </div>
    );
  }

  return (
    <Link to={`/courses/${course.courseId}`} className="course-card">
      {body}
    </Link>
  );
}
