import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

import { learningEngine } from "../../core/learning";
import type {
  ActivityState,
  ActivityStep,
  ChallengeStep as ChallengeStepType,
  CompletionStep as CompletionStepType,
  ConceptStep as ConceptStepType,
  IntroStep as IntroStepType,
  QuizStep as QuizStepType,
} from "../../core/curriculum/Lesson";
import {
  completeLesson,
  getLessonProgress,
  getLessonProgressMap,
  recordLessonAttempt,
  startCourse,
  startLesson,
  syncCourseProgress,
} from "../../lib/progress";
import { awardStepXp, fetchStepProgress } from "../../lib/api";
import {
  Button,
  IconButton,
  ProgressTrack,
  useToast,
} from "../../components/ui";
import { useSurface } from "../../components/Surface";

/* Side-effect import: populates the interactive activity registry. */
import "./activities/register";
import { getActivity } from "./activityRegistry";
import { attemptsRemaining, evaluateAttempt } from "./completion";
import type { AttemptResult } from "./completion";
import { planLessonXp } from "./xp";
import ActivityHost from "./steps/ActivityHost";
import ChallengeStep from "./steps/ChallengeStep";
import CompletionStep from "./steps/CompletionStep";
import ConceptStep from "./steps/ConceptStep";
import IntroStep from "./steps/IntroStep";
import QuizStep from "./steps/QuizStep";

export default function LessonPlayer() {
  useSurface("learn");

  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();

  const lesson = lessonId ? learningEngine.getLesson(lessonId) : undefined;

  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<Record<string, ActivityState>>({});
  const [isFinishing, setIsFinishing] = useState(false);

  /* Steps already paid out on a previous visit. */
  const [settledSteps, setSettledSteps] = useState<Set<string>>(new Set());
  const [earnedThisVisit, setEarnedThisVisit] = useState(0);

  /*
   * Set when the step-XP API is unreachable — most likely the
   * migration has not been applied yet. The lesson still plays;
   * we just say plainly that XP is not being recorded rather
   * than silently dropping it.
   */
  const [xpUnavailable, setXpUnavailable] = useState(false);

  /*
   * Why the write failed, in the server's own words.
   *
   * The completion screen used to say the service "did not
   * respond" whatever went wrong, which sent us looking for a
   * dead server when the API was answering perfectly well with
   * a 500 from a missing table. Say what actually happened.
   */
  const [xpError, setXpError] = useState("");

  /*
   * Steps the learner finished whose write to the server did
   * not land. `finish` retries these and refuses to complete
   * the lesson while any of them are still unrecorded — a
   * lesson must never read as done when the database says
   * otherwise.
   */
  const [unrecorded, setUnrecorded] = useState<Set<string>>(new Set());

  /*
   * Awards currently in flight, keyed by step.
   *
   * Holding the promise rather than a bare flag means `finish`
   * can await a write that is already running instead of
   * assuming it succeeded — otherwise finishing the instant an
   * activity is checked could complete the lesson while that
   * step's write was still on the wire, and failing.
   */
  const awarding = useRef<Map<string, Promise<boolean>>>(new Map());

  const xpPlan = useMemo(
    () => (lesson ? planLessonXp(lesson) : {}),
    [lesson]
  );

  /* ---------------------------------------------------------
     LOAD

     Restore which steps are already done, so a returning
     learner sees their progress and cannot be paid twice.
     --------------------------------------------------------- */

  useEffect(() => {
    if (!lesson) {
      return;
    }

    let active = true;

    getLessonProgress(lesson.id)
      .then((row) => (row ? undefined : startLesson(lesson.id)))
      .catch(() => {
        /* Reading the lesson does not depend on progress. */
      });

    /*
     * Opening a lesson opens its course. Without this the
     * course_progress row was never written for anyone — the
     * helpers existed but nothing called them.
     */
    startCourse(lesson.courseId, lesson.id).catch(() => {
      /* The course row is derived state; the map reads lessons. */
    });

    fetchStepProgress(lesson.id)
      .then(({ steps }) => {
        if (!active) {
          return;
        }

        const settled = new Set<string>();
        const restored: Record<string, ActivityState> = {};

        steps.forEach((row) => {
          if (!row.completed) {
            return;
          }

          settled.add(row.step_id);

          restored[row.step_id] = {
            completed: true,
            score: row.score ?? undefined,
            attempts: row.attempts,
          };
        });

        setSettledSteps(settled);
        setStates((current) => ({ ...restored, ...current }));
      })
      .catch((error: unknown) => {
        if (active) {
          setXpUnavailable(true);
          setXpError(
            error instanceof Error ? error.message : "Unknown error."
          );
        }
      });

    return () => {
      active = false;
    };
  }, [lesson]);

  const step = lesson?.steps[index];
  const stepState = step ? states[step.id] : undefined;

  /* ---------------------------------------------------------
     AWARD

     Fired the moment a step first satisfies its completion
     contract. The server is the authority on whether XP is
     actually granted — this is only the trigger.
     --------------------------------------------------------- */

  const award = useCallback(
    (stepId: string, score?: number): Promise<boolean> => {
      if (!lesson || settledSteps.has(stepId)) {
        /* Nothing to write, which is not a failure. */
        return Promise.resolve(true);
      }

      /* Join the write already running for this step. */
      const inFlight = awarding.current.get(stepId);

      if (inFlight) {
        return inFlight;
      }

      const run = (async (): Promise<boolean> => {
        try {
          const result = await awardStepXp({ stepId, score });

          setSettledSteps((current) => new Set(current).add(stepId));

          setUnrecorded((current) => {
            if (!current.has(stepId)) {
              return current;
            }

            const next = new Set(current);
            next.delete(stepId);
            return next;
          });

          if (result.awarded > 0) {
            setEarnedThisVisit((current) => current + result.awarded);
          }

          setXpUnavailable(false);
          setXpError("");

          return true;
        } catch (error) {
          setXpUnavailable(true);
          setXpError(
            error instanceof Error ? error.message : "Unknown error."
          );
          setUnrecorded((current) => new Set(current).add(stepId));

          return false;
        } finally {
          awarding.current.delete(stepId);
        }
      })();

      awarding.current.set(stepId, run);

      return run;
    },
    /* xpPlan is not read here any more — the server prices steps. */
    [lesson, settledSteps]
  );

  const handleProgress = useCallback(
    (result: AttemptResult) => {
      if (!step) {
        return;
      }

      const previous = states[step.id];

      const next = evaluateAttempt(
        "completion" in step ? step.completion : undefined,
        previous,
        result
      );

      setStates((current) => ({ ...current, [step.id]: next }));

      /*
       * Fired outside the state updater — React may invoke an
       * updater more than once, and an award is a side effect.
       */
      if (next.completed && !previous?.completed) {
        void award(step.id, next.score);
      }
    },
    [step, states, award]
  );

  /* ---------------------------------------------------------
     GATING
     --------------------------------------------------------- */

  const isGated = useMemo(() => {
    if (!step || !step.requiresCompletion) {
      return false;
    }

    /*
     * An activity whose component has not shipped cannot trap
     * the learner. Every interactive type is registered today,
     * so this only matters while a new one is being added.
     */
    if (step.type === "activity" && !getActivity(step.interactiveType)) {
      return false;
    }

    return !stepState?.completed;
  }, [step, stepState]);

  const completedCount = useMemo(() => {
    if (!lesson) {
      return 0;
    }

    return lesson.steps.filter(
      (candidate, candidateIndex) =>
        states[candidate.id]?.completed || candidateIndex < index
    ).length;
  }, [lesson, states, index]);

  /* ---------------------------------------------------------
     FINISH
     --------------------------------------------------------- */

  const finish = useCallback(async () => {
    if (!lesson) {
      return;
    }

    setIsFinishing(true);

    const completionStep = lesson.steps.find(
      (candidate) => candidate.type === "completion"
    );

    try {
      /*
       * Everything this visit still owes the server: steps the
       * learner finished whose write failed, plus the completion
       * step, which pays out like any other.
       *
       * Retrying here is what makes a dropped connection
       * mid-lesson recoverable rather than silently lossy.
       */
      const pending = lesson.steps
        .filter(
          (candidate) =>
            states[candidate.id]?.completed &&
            !settledSteps.has(candidate.id)
        )
        .map((candidate) => candidate.id);

      if (completionStep && !settledSteps.has(completionStep.id)) {
        pending.push(completionStep.id);
      }

      const written = await Promise.all(
        pending.map((stepId) => award(stepId, states[stepId]?.score))
      );

      /*
       * The lesson is only complete once the database says its
       * steps are. Marking it done here while the writes failed
       * is exactly the state that made the course map lie.
       */
      if (written.some((ok) => !ok)) {
        throw new Error(
          "Your progress couldn't be saved, so this lesson has not been " +
            "marked complete. Check your connection and press Finish again."
        );
      }

      await recordLessonAttempt(lesson.id, true, "proficient");
      await completeLesson(lesson.id);

      /*
       * Bring the course row in line with the lessons actually
       * finished. Derived state — a failure here does not
       * un-complete the lesson, and the next completion heals it.
       */
      try {
        const courseLessons = learningEngine.getLessonsForCourse(
          lesson.courseId
        );

        const rows = await getLessonProgressMap(
          courseLessons.map((candidate) => candidate.id)
        );

        const completedIds = courseLessons
          .filter((candidate) => rows[candidate.id]?.completed)
          .map((candidate) => candidate.id);

        const next = learningEngine.getNextLesson(
          lesson.courseId,
          completedIds
        );

        await syncCourseProgress(
          lesson.courseId,
          completedIds.length,
          courseLessons.length,
          next?.id ?? null
        );
      } catch (courseError) {
        console.error(
          "Lesson saved, but the course row could not be updated:",
          courseError
        );
      }

      navigate(`/courses/${lesson.courseId}`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't save your progress. Check your connection and try again.",
        "error"
      );
    } finally {
      setIsFinishing(false);
    }
  }, [lesson, award, states, settledSteps, navigate, notify]);

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */

  if (!lesson) {
    return (
      <div className="focus">
        <div className="focus__body">
          <h1 className="focus__step-title">Lesson not found</h1>
          <p className="prose" style={{ marginBottom: "var(--space-5)" }}>
            That lesson id doesn&rsquo;t match anything in the curriculum.
          </p>
          <Button variant="primary" onClick={() => navigate("/courses")}>
            Back to courses
          </Button>
        </div>
      </div>
    );
  }

  if (!step) {
    return null;
  }

  const isLast = index === lesson.steps.length - 1;

  const remaining =
    step.type === "activity"
      ? attemptsRemaining(step.completion, stepState)
      : undefined;

  const stepProps = {
    state: stepState,
    onProgress: handleProgress,
  };

  /* XP still on the table for this step, zero once settled. */
  const stepXp = settledSteps.has(step.id) ? 0 : (xpPlan[step.id] ?? 0);

  return (
    <div className="focus">
      <header className="focus__bar">
        <div className="focus__bar-inner">
          <IconButton
            label="Exit lesson"
            icon={<X size={17} />}
            onClick={() => navigate(`/courses/${lesson.courseId}`)}
          />

          <span className="focus__lesson-name meta">{lesson.title}</span>

          <span className="meta">
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(lesson.steps.length).padStart(2, "0")}
          </span>

          <span
            className={
              earnedThisVisit > 0
                ? "badge badge--correct badge--mono"
                : "badge badge--neutral badge--mono"
            }
          >
            {earnedThisVisit} / {lesson.totalXp} xp
          </span>
        </div>

        <div className="focus__bar-track">
          <ProgressTrack
            total={lesson.steps.length}
            completed={completedCount}
            current={index}
            label={`${lesson.title} progress`}
          />
        </div>
      </header>

      <div className="focus__body">
        {step.type === "intro" ? (
          <IntroStep step={step as IntroStepType} {...stepProps} />
        ) : step.type === "concept" ? (
          <ConceptStep step={step as ConceptStepType} {...stepProps} />
        ) : step.type === "quiz" ? (
          <QuizStep step={step as QuizStepType} {...stepProps} />
        ) : step.type === "challenge" ? (
          <ChallengeStep step={step as ChallengeStepType} {...stepProps} />
        ) : step.type === "activity" ? (
          <ActivityHost step={step as ActivityStep} {...stepProps} />
        ) : (
          <CompletionStep
            step={step as CompletionStepType}
            xpAwarded={earnedThisVisit}
            alreadyCompleted={settledSteps.has(step.id)}
            xpUnavailable={xpUnavailable || unrecorded.size > 0}
            xpError={xpError}
            {...stepProps}
          />
        )}
      </div>

      <footer className="focus__footer">
        <div className="focus__footer-inner">
          <div className="row gap-3">
            {index > 0 ? (
              <Button
                icon={<ArrowLeft size={15} />}
                onClick={() => setIndex((current) => current - 1)}
              >
                Back
              </Button>
            ) : null}

            {isGated ? (
              <span className="focus__hint">
                Finish this activity to continue
                {remaining !== undefined
                  ? ` — ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left`
                  : ""}
                .
              </span>
            ) : stepXp > 0 && !stepState?.completed ? (
              <span className="focus__hint">
                Worth {stepXp} xp.
              </span>
            ) : settledSteps.has(step.id) && stepState?.completed ? (
              <span className="focus__hint">Already earned.</span>
            ) : null}
          </div>

          {isLast ? (
            <Button
              variant="primary"
              size="lg"
              disabled={isFinishing}
              onClick={() => void finish()}
            >
              {isFinishing ? "Saving…" : "Finish lesson"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              iconEnd={<ArrowRight size={16} />}
              disabled={isGated}
              onClick={() => setIndex((current) => current + 1)}
            >
              Continue
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
