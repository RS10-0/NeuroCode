import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";

import { learningEngine } from "../core/learning";
import { findCatalogCourse } from "../features/courses/catalog";
import MissionCard from "../features/learn/MissionCard";
import type { Lesson } from "../core/curriculum/Lesson";
import { getLessonProgressMap, getUserStats } from "../lib/progress";
import type { UserStats } from "../lib/progress";
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  Skeleton,
} from "../components/ui";

interface LessonState {
  completed: boolean;
  started: boolean;
}

/*
 * A single course, as a lesson list.
 *
 * This is what opening a course card gets you: the eight
 * lessons, their completion and lock state, and one action to
 * start or continue. Deliberately a list rather than another
 * grid — the library above it is for choosing between courses,
 * this is for working through one.
 *
 * Everything reads the curriculum through learningEngine, so
 * there is exactly one definition of what a lesson is. Lesson
 * URLs stay on /learn/:lessonId — the nav label changed, the
 * links learners have already opened did not.
 */
export default function CourseDetail() {
  const navigate = useNavigate();
  const { courseId } = useParams<{ courseId: string }>();

  /*
   * Only courses the catalog actually ships resolve here. A made
   * up id lands back on the library rather than rendering an
   * empty course that looks broken.
   */
  const course = findCatalogCourse(courseId);
  const COURSE_ID = course?.courseId ?? "";

  /* Filtered fresh on every call, so memoise it — otherwise the
     load callback changes identity each render and the fetch
     effect loops. */
  const lessons: Lesson[] = useMemo(
    () => learningEngine.getLessonsForCourse(COURSE_ID),
    [COURSE_ID]
  );

  const [states, setStates] = useState<Record<string, LessonState>>({});
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    /*
     * One request for every lesson row, not one per lesson.
     * This was eight sequential round trips, each preceded by
     * its own call to the auth server.
     */
    Promise.all([
      getLessonProgressMap(lessons.map((lesson) => lesson.id)),
      getUserStats(),
    ])
      .then(([rows, userStats]) => {
        if (!active) {
          return;
        }

        const next: Record<string, LessonState> = {};

        lessons.forEach((lesson) => {
          const row = rows[lesson.id];

          next[lesson.id] = {
            completed: Boolean(row?.completed),
            started: Boolean(row),
          };
        });

        setStates(next);
        setStats(userStats);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Couldn't load your progress. Try again."
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [lessons, reloadToken]);

  /* Retry runs from an event handler, so it may reset state directly. */
  const retry = useCallback(() => {
    setIsLoading(true);
    setLoadError("");
    setReloadToken((token) => token + 1);
  }, []);

  const completedIds = lessons
    .filter((lesson) => states[lesson.id]?.completed)
    .map((lesson) => lesson.id);

  const nextLesson = learningEngine.getNextLesson(COURSE_ID, completedIds);

  /*
   * The handoff a finished course offers, read from the last
   * lesson's completion step rather than written out here.
   *
   * This block used to be hardcoded prose about AI Foundations,
   * which was correct while one course shipped and would have
   * been a lie on any of the other four. A course with no
   * mission — one whose output is judgement rather than a build
   * — simply has no field, and gets the plain finish instead.
   */
  const courseMission = useMemo(() => {
    const finalLesson = lessons[lessons.length - 1];

    const completion = finalLesson?.steps.find(
      (step) => step.type === "completion"
    );

    return completion?.type === "completion" ? completion.mission : undefined;
  }, [lessons]);
  const percent = lessons.length
    ? (completedIds.length / lessons.length) * 100
    : 0;

  if (!course) {
    return <Navigate to="/courses" replace />;
  }

  return (
    <div className="page">
      <header className="page__header">
        <Link
          to="/courses"
          className="meta"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)",
          }}
        >
          <ArrowLeft size={13} aria-hidden="true" />
          All courses
        </Link>

        <h1 className="page__title">{course.title}</h1>
        <p className="page__lede">{course.description}</p>

        <p className="meta" style={{ marginTop: "var(--space-3)" }}>
          {course.lessonCount} lessons · {completedIds.length} complete · each
          lesson unlocks the next
        </p>
      </header>

      <div className="dash">
        <div className="stack gap-5">
          {loadError ? (
            <Card>
              <p className="prose" style={{ marginBottom: "var(--space-4)" }}>
                {loadError}
              </p>
              <Button onClick={retry}>Try again</Button>
            </Card>
          ) : null}

          {isLoading ? (
            <div className="resume">
              <Skeleton width="180px" height="12px" />
              <Skeleton width="60%" height="28px" />
              <Skeleton width="100%" height="40px" />
            </div>
          ) : nextLesson ? (
            <div className="resume">
              <span className="meta">
                {completedIds.length === 0 ? "start here" : "up next"} · lesson{" "}
                {String(nextLesson.number).padStart(2, "0")}
              </span>

              <h2 className="resume__title">{nextLesson.title}</h2>
              <p className="resume__text">{nextLesson.description}</p>

              <div className="row gap-3" style={{ flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  size="lg"
                  iconEnd={<ArrowRight size={16} />}
                  onClick={() => navigate(`/learn/${nextLesson.id}`)}
                >
                  {states[nextLesson.id]?.started ? "Continue" : "Begin lesson"}
                </Button>

                <span className="meta">
                  {nextLesson.estimatedMinutes} min · {nextLesson.totalXp} xp
                </span>
              </div>
            </div>
          ) : (
            <div className="resume">
              <span className="meta">course complete</span>
              <h2 className="resume__title">
                You finished {course.title}
              </h2>

              {courseMission ? (
                <MissionCard mission={courseMission} />
              ) : (
                <p className="resume__text">
                  Every lesson is done. Nothing left to unlock here — what this
                  one leaves you with is judgement, and you take that with you.
                </p>
              )}
            </div>
          )}

          <div>
            <div
              className="row gap-3"
              style={{
                justifyContent: "space-between",
                marginBottom: "var(--space-3)",
              }}
            >
              <h2 style={{ fontSize: "var(--text-lg)" }}>Lessons</h2>
              <span className="meta">
                {completedIds.length} / {lessons.length} complete
              </span>
            </div>

            <div className="lesson-list">
              {lessons.map((lesson) => {
                const state = states[lesson.id];
                const isDone = Boolean(state?.completed);
                const isUnlocked = learningEngine.isLessonUnlocked(
                  lesson.id,
                  completedIds
                );
                const isCurrent = nextLesson?.id === lesson.id;

                let indexModifier = "";
                if (isDone) {
                  indexModifier = " lesson-row__index--done";
                } else if (isCurrent) {
                  indexModifier = " lesson-row__index--current";
                }

                const inner = (
                  <>
                    <span className={`lesson-row__index${indexModifier}`}>
                      {isDone ? (
                        <Check size={14} aria-hidden="true" />
                      ) : isUnlocked ? (
                        String(lesson.number).padStart(2, "0")
                      ) : (
                        <Lock size={13} aria-hidden="true" />
                      )}
                    </span>

                    <span className="lesson-row__body">
                      <span className="lesson-row__title">{lesson.title}</span>
                      <span className="lesson-row__sub">
                        {lesson.description}
                      </span>
                    </span>

                    <span className="lesson-row__meta">
                      {isDone ? (
                        <Badge tone="correct">Complete</Badge>
                      ) : isCurrent ? (
                        <Badge tone="accent">Up next</Badge>
                      ) : null}
                      <span className="meta">{lesson.estimatedMinutes}m</span>
                    </span>
                  </>
                );

                if (!isUnlocked) {
                  return (
                    <div
                      key={lesson.id}
                      className="lesson-row lesson-row--locked"
                      aria-disabled="true"
                      title="Finish the previous lesson to unlock this one."
                    >
                      {inner}
                    </div>
                  );
                }

                return (
                  <Link
                    key={lesson.id}
                    to={`/learn/${lesson.id}`}
                    className="lesson-row"
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="dash__side">
          <Card>
            <div
              className="row gap-3"
              style={{
                justifyContent: "space-between",
                marginBottom: "var(--space-3)",
              }}
            >
              <span className="meta">course progress</span>
              <span className="meta">{Math.round(percent)}%</span>
            </div>
            <ProgressBar percent={percent} label="AI Foundations progress" />
          </Card>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">
                {isLoading ? "—" : (stats?.level ?? 1)}
              </div>
              <div className="stat__label">Level</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {isLoading ? "—" : (stats?.xp ?? 0).toLocaleString()}
              </div>
              <div className="stat__label">XP earned</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {isLoading ? "—" : (stats?.current_streak ?? 0)}
              </div>
              <div className="stat__label">Day streak</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {isLoading ? "—" : completedIds.length}
              </div>
              <div className="stat__label">Lessons done</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
