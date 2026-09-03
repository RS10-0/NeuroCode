import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bot, FolderOpen, Zap } from "lucide-react";

import { learningEngine } from "../core/learning";
import { COURSE_CATALOG } from "../features/courses/catalog";
import type { Lesson } from "../core/curriculum/Lesson";
import { getLessonProgressMap, getUserStats } from "../lib/progress";
import type { UserStats } from "../lib/progress";
import { useAuth } from "../auth/useAuth";
import { Button, Card, ProgressBar, Skeleton } from "../components/ui";
import { useCredits } from "../features/credits/useCredits";
import { capStateOf } from "../lib/credits";
import ScheduleDigest from "../components/ScheduleDigest";

/*
 * Which course the dashboard is about.
 *
 * It used to be a constant, which was right while one course
 * shipped and would mean four of the five were invisible from
 * the learner's home. The choice is made from progress instead:
 * the course they have started and not finished, most recently
 * touched first, falling back to the first course in the
 * catalog for somebody who has not begun anything.
 *
 * Deliberately not "the course with the most progress" — a
 * learner who is four lessons into Agents and one into Ethics
 * is currently doing Ethics, and the home page should open
 * where they left off rather than where they have invested
 * most.
 */
function pickCourseId(startedIds: string[], completedIds: string[]): string {
  const started = new Set(startedIds);
  const completed = new Set(completedIds);

  const inProgress = COURSE_CATALOG.filter((course) => {
    if (!course.courseId) {
      return false;
    }

    const lessons = learningEngine.getLessonsForCourse(course.courseId);

    return (
      lessons.some((lesson) => started.has(lesson.id)) &&
      !lessons.every((lesson) => completed.has(lesson.id))
    );
  });

  return (
    inProgress[inProgress.length - 1]?.courseId ??
    COURSE_CATALOG[0]?.courseId ??
    ""
  );
}

/*
 * The learner's home.
 *
 * Everything here is read from progress the learner has already
 * made — where they are in the course, what they have earned,
 * and what to open next. Nothing on this page introduces new
 * product surface; it assembles what Courses, Profile and the
 * lesson player already know into one landing place.
 *
 * A recent-activity feed is deliberately absent: nothing records
 * per-event history yet, and inventing one from lesson rows
 * would be a guess dressed as data.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  /*
   * Progress is read across every course at once, because which
   * course to show cannot be known until it has been read. One
   * request either way — the map is keyed by lesson id and does
   * not care how many courses the ids came from.
   */
  const allLessons: Lesson[] = useMemo(
    () => learningEngine.getLessons(),
    []
  );

  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [startedIds, setStartedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    Promise.all([
      getLessonProgressMap(allLessons.map((lesson) => lesson.id)),
      getUserStats(),
    ])
      .then(([rows, userStats]) => {
        if (!active) {
          return;
        }

        setCompletedIds(
          allLessons.filter((l) => rows[l.id]?.completed).map((l) => l.id)
        );
        setStartedIds(allLessons.filter((l) => rows[l.id]).map((l) => l.id));
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
  }, [allLessons, reloadToken]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setLoadError("");
    setReloadToken((token) => token + 1);
  }, []);

  const courseId = pickCourseId(startedIds, completedIds);

  const courseTitle =
    COURSE_CATALOG.find((course) => course.courseId === courseId)?.title ??
    "your course";

  const lessons = useMemo(
    () => learningEngine.getLessonsForCourse(courseId),
    [courseId]
  );

  /* Scoped to the course on screen, not to every course. */
  const courseCompletedIds = completedIds.filter((id) =>
    lessons.some((lesson) => lesson.id === id)
  );

  const nextLesson = learningEngine.getNextLesson(
    courseId,
    courseCompletedIds
  );

  const percent = lessons.length
    ? (courseCompletedIds.length / lessons.length) * 100
    : 0;

  const displayName = user?.username || "there";

  const { credits } = useCredits();

  /*
   * Hitting the ceiling is silent otherwise.
   *
   * Grants clamp at the maximum, so a learner sitting at 300
   * who finishes a lesson banks nothing — the level progress
   * still lands, but the XP does not. Without a word on screen
   * that is indistinguishable from the lesson simply not
   * paying, which reads as a bug and feels like being cheated.
   *
   * Phrased as a prompt rather than a warning, because it IS
   * one: the cap exists so XP gets spent, and a learner who is
   * full is exactly the learner who should go and unlock
   * something.
   */
  const cap = capStateOf(credits);

  /*
   * LEVEL COMES FROM THE WALLET, NOT FROM user_stats.
   *
   * There were two levels in this app and they disagreed.
   * user_stats.level has been derived from curriculum step XP
   * on a 500-per-level scale since migration 0002 — a score for
   * how much of the course somebody has done. Level should
   * measure engagement with the whole product, which is what
   * the XP grant stream already is: showing up, keeping a
   * streak, finishing lessons and courses.
   *
   * So the server computes it from everything the learner has
   * ever earned and sends a level and a progress figure. The
   * running total behind it is deliberately not sent and has no
   * name on this page — there is nothing here for a reader to
   * confuse with the XP in their wallet.
   *
   * It never goes down. Spending 200 XP on a Library agent
   * cannot cost somebody a level they earned.
   */
  const level = credits?.available ? credits.level : null;
  const intoLevel = credits?.available ? credits.xpIntoLevel : 0;
  const perLevel = credits?.available ? credits.xpPerLevel : 200;

  /* Still the curriculum score, and still worth showing — it is
     just not what "Level" means any more. */
  const xp = stats?.xp ?? 0;

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Welcome back, {displayName}</h1>
        <p className="page__lede">
          {completedIds.length === 0
            ? "Your course is waiting. Everything you build later starts here."
            : `${courseCompletedIds.length} of ${lessons.length} lessons done in ${courseTitle}.`}
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

          {/* --- CONTINUE LEARNING --- */}

          {isLoading ? (
            <div className="resume">
              <Skeleton width="180px" height="12px" />
              <Skeleton width="60%" height="28px" />
              <Skeleton width="100%" height="40px" />
            </div>
          ) : nextLesson ? (
            <div className="resume">
              <span className="meta">
                {completedIds.length === 0 ? "start here" : "continue learning"}{" "}
                · lesson {String(nextLesson.number).padStart(2, "0")}
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
                  {startedIds.includes(nextLesson.id) ? "Continue" : "Begin lesson"}
                </Button>

                <span className="meta">
                  {nextLesson.estimatedMinutes} min · {nextLesson.totalXp} xp
                </span>
              </div>
            </div>
          ) : (
            <div className="resume">
              <span className="meta">course complete</span>
              <h2 className="resume__title">You finished AI Foundations</h2>
              <p className="resume__text">
                Every lesson is done. Put it to work — build an agent and publish
                it somewhere real.
              </p>
              <div className="row gap-3">
                <Link to="/agents">
                  <Button variant="primary" iconEnd={<ArrowRight size={16} />}>
                    Build an agent
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* --- WHERE TO GO NEXT --- */}

          <div>
            <div
              className="row gap-3"
              style={{
                justifyContent: "space-between",
                marginBottom: "var(--space-3)",
              }}
            >
              <h2 style={{ fontSize: "var(--text-lg)" }}>Jump back in</h2>
            </div>

            <div className="lesson-list">
              <Link to="/courses" className="lesson-row">
                <span className="lesson-row__index">
                  {isLoading ? "—" : COURSE_CATALOG.length}
                </span>
                <span className="lesson-row__body">
                  <span className="lesson-row__title">Courses</span>
                  <span className="lesson-row__sub">
                    {COURSE_CATALOG.length} courses, from what a model is to
                    publishing something you built.
                  </span>
                </span>
                <span className="lesson-row__meta">
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </Link>

              <Link to="/agents" className="lesson-row">
                <span className="lesson-row__index">
                  <Bot size={14} aria-hidden="true" />
                </span>
                <span className="lesson-row__body">
                  <span className="lesson-row__title">My Agents</span>
                  <span className="lesson-row__sub">
                    Standalone agents you build, test, and publish.
                  </span>
                </span>
                <span className="lesson-row__meta">
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </Link>

              <Link to="/projects" className="lesson-row">
                <span className="lesson-row__index">
                  <FolderOpen size={14} aria-hidden="true" />
                </span>
                <span className="lesson-row__body">
                  <span className="lesson-row__title">Projects</span>
                  <span className="lesson-row__sub">
                    Apps you have made, and where they are deployed.
                  </span>
                </span>
                <span className="lesson-row__meta">
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </Link>
            </div>
          </div>
        </div>

        {/* --- PROGRESS AND XP --- */}

        <aside className="dash__side">
          {/* Renders nothing until a schedule has actually run,
              so it never becomes a permanent advertisement for a
              feature this learner has not used. */}
          <ScheduleDigest />

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

          <Card>
            <div
              className="row gap-3"
              style={{
                justifyContent: "space-between",
                marginBottom: "var(--space-3)",
              }}
            >
              <span className="meta">
                {level === null ? "—" : `level ${level}`}
              </span>
              <span className="meta">
                {level === null
                  ? "—"
                  : `${intoLevel} / ${perLevel} xp to next level`}
              </span>
            </div>
            <ProgressBar
              percent={perLevel > 0 ? (intoLevel / perLevel) * 100 : 0}
              label="Progress to next level"
            />

            {cap !== "fine" ? (
              <p className="wallet-cap">
                <Zap size={13} aria-hidden="true" />
                {cap === "full" ? (
                  <span>
                    <strong>You are maxed out.</strong> XP you earn now is
                    discarded until you spend some — unlock an agent in the{" "}
                    <Link to="/agents/library">Agent Library</Link> or run an
                    experiment in the <Link to="/lab">Lab</Link>. Your level
                    keeps rising either way.
                  </span>
                ) : (
                  <span>
                    <strong>Almost maxed out.</strong> Not all of tomorrow's XP
                    will fit — spend a little in the{" "}
                    <Link to="/agents/library">Agent Library</Link> to keep
                    earning it all.
                  </span>
                )}
              </p>
            ) : null}
          </Card>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">{level ?? "—"}</div>
              <div className="stat__label">Level</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {isLoading ? "—" : xp.toLocaleString()}
              </div>
              <div className="stat__label">Course XP</div>
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
