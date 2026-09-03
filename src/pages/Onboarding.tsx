import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Callout, ProgressTrack, useToast } from "../components/ui";
import { saveOnboarding } from "../lib/onboarding";
import { learningEngine } from "../core/learning";
import {
  EXPERIENCE,
  GOALS,
  LITERACY_QUESTIONS,
  placeLearner,
} from "../features/onboarding/questions";
import type { LiteracyOption } from "../features/onboarding/questions";

type Phase = "welcome" | "goal" | "experience" | "check" | "result";

export default function Onboarding() {
  useSurface("learn");

  const navigate = useNavigate();
  const { notify } = useToast();

  const [phase, setPhase] = useState<Phase>("welcome");
  const [goal, setGoal] = useState("");
  const [experience, setExperience] = useState("");

  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [isSaving, setIsSaving] = useState(false);

  const question = LITERACY_QUESTIONS[questionIndex];
  const placement = useMemo(() => placeLearner(answers), [answers]);

  /* Total steps in the flow, for the progress rail. */
  const totalSteps = 3 + LITERACY_QUESTIONS.length;
  const currentStep =
    phase === "welcome"
      ? 0
      : phase === "goal"
        ? 1
        : phase === "experience"
          ? 2
          : phase === "check"
            ? 3 + questionIndex
            : totalSteps;

  /*
   * The literacy check is a baseline assessment, not a lesson.
   *
   * It used to grade each answer on the spot — green on the
   * right option, red on the chosen wrong one, explanation
   * underneath. That is the correct behaviour for a course quiz
   * and the wrong behaviour here: a learner who is told the
   * answer to question three approaches question four
   * differently, and the score stops measuring what they knew
   * on arrival.
   *
   * So: record the choice, move on, reveal nothing. The result
   * is computed from `answers` at the end exactly as before.
   *
   * Course quizzes are untouched — QuizStep still explains,
   * still marks right and wrong, still lets you retry.
   */
  function answer(option: LiteracyOption) {
    setAnswers((current) => ({ ...current, [question.id]: option.id }));

    if (questionIndex < LITERACY_QUESTIONS.length - 1) {
      setQuestionIndex(questionIndex + 1);
    } else {
      setPhase("result");
    }
  }

  async function finish() {
    setIsSaving(true);

    try {
      await saveOnboarding({
        goal,
        experience,
        literacyScore: placement.score,
        literacyLevel: placement.level,
        recommendedLessonId: placement.recommendedLessonId,
      });

      navigate(`/learn/${placement.recommendedLessonId}`, { replace: true });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't save your answers. Try again.",
        "error"
      );
      setIsSaving(false);
    }
  }

  const recommended = learningEngine.getLesson(placement.recommendedLessonId);

  return (
    <div className="focus">
      <header className="focus__bar">
        <div className="focus__bar-inner">
          <span className="row gap-2" style={{ flex: 1 }}>
            <span className="auth__brand-mark">
              <BrandMark size={13} />
            </span>
            <span className="meta">getting set up</span>
          </span>

          {phase === "check" ? (
            <span className="meta">
              {String(questionIndex + 1).padStart(2, "0")} /{" "}
              {String(LITERACY_QUESTIONS.length).padStart(2, "0")}
            </span>
          ) : null}
        </div>

        <div className="focus__bar-track">
          <ProgressTrack
            total={totalSteps}
            completed={currentStep}
            current={currentStep}
            label="Onboarding progress"
          />
        </div>
      </header>

      <div className="focus__body">
        {/* ---------------------------------------------------
            WELCOME
        --------------------------------------------------- */}

        {phase === "welcome" ? (
          <>
            <h1 className="focus__step-title">
              Let&rsquo;s work out where you should start.
            </h1>

            <div className="prose">
              <p>
                Two quick questions, then eight about how AI actually works.
                There is no pass mark and nothing here is graded — the answers
                only decide which lesson you open first.
              </p>
              <p>
                Most people get some of these wrong, including people who use AI
                every day. That is the point of asking.
              </p>
            </div>

            <div style={{ marginTop: "var(--space-7)" }}>
              <Button
                variant="primary"
                size="lg"
                iconEnd={<ArrowRight size={16} />}
                onClick={() => setPhase("goal")}
              >
                Start
              </Button>
            </div>
          </>
        ) : null}

        {/* ---------------------------------------------------
            GOAL
        --------------------------------------------------- */}

        {phase === "goal" ? (
          <>
            <h1 className="focus__step-title">What brought you here?</h1>

            <div className="stack gap-3" style={{ maxWidth: "var(--measure)" }}>
              {GOALS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={
                    goal === option.id
                      ? "choice choice--selected"
                      : "choice"
                  }
                  aria-pressed={goal === option.id}
                  onClick={() => setGoal(option.id)}
                >
                  <span className="choice__label">{option.label}</span>
                  <span className="choice__detail">{option.detail}</span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: "var(--space-6)" }}>
              <Button
                variant="primary"
                size="lg"
                iconEnd={<ArrowRight size={16} />}
                disabled={!goal}
                onClick={() => setPhase("experience")}
              >
                Continue
              </Button>
            </div>
          </>
        ) : null}

        {/* ---------------------------------------------------
            EXPERIENCE
        --------------------------------------------------- */}

        {phase === "experience" ? (
          <>
            <h1 className="focus__step-title">
              How much have you used AI so far?
            </h1>

            <div className="stack gap-3" style={{ maxWidth: "var(--measure)" }}>
              {EXPERIENCE.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={
                    experience === option.id
                      ? "choice choice--selected"
                      : "choice"
                  }
                  aria-pressed={experience === option.id}
                  onClick={() => setExperience(option.id)}
                >
                  <span className="choice__label">{option.label}</span>
                  <span className="choice__detail">{option.detail}</span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: "var(--space-6)" }}>
              <Button
                variant="primary"
                size="lg"
                iconEnd={<ArrowRight size={16} />}
                disabled={!experience}
                onClick={() => setPhase("check")}
              >
                Start the check
              </Button>
            </div>
          </>
        ) : null}

        {/* ---------------------------------------------------
            LITERACY CHECK
        --------------------------------------------------- */}

        {phase === "check" ? (
          <>
            <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
              {question.concept}
            </div>

            <h1 className="focus__step-title">{question.prompt}</h1>

            <div className="stack gap-3" style={{ maxWidth: "var(--measure)" }}>
              {question.options.map((option) => (
                /*
                  No state class beyond the default. Selecting an
                  option advances immediately, so there is no
                  moment in which the UI could betray whether the
                  choice was right.
                */
                <button
                  key={option.id}
                  type="button"
                  className="choice"
                  onClick={() => answer(option)}
                >
                  <span className="choice__label">{option.label}</span>
                </button>
              ))}
            </div>

            <p
              className="meta"
              style={{ marginTop: "var(--space-5)", maxWidth: "var(--measure)" }}
            >
              Pick the closest answer. Nothing here is graded and no answer is
              shown — this only decides where you start.
            </p>
          </>
        ) : null}

        {/* ---------------------------------------------------
            RESULT
        --------------------------------------------------- */}

        {phase === "result" ? (
          <>
            <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
              {placement.score} of {LITERACY_QUESTIONS.length} · {placement.level}
            </div>

            <h1 className="focus__step-title">{placement.headline}</h1>

            <p className="prose" style={{ marginBottom: "var(--space-6)" }}>
              {placement.reason}
            </p>

            {placement.strengths.length > 0 ? (
              <div style={{ marginBottom: "var(--space-5)" }}>
                <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
                  already solid on
                </div>
                <div className="sorter__choices">
                  {placement.strengths.map((concept) => (
                    <span key={concept} className="badge badge--correct">
                      <Check size={12} aria-hidden="true" />
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {placement.gaps.length > 0 ? (
              <div style={{ marginBottom: "var(--space-6)" }}>
                <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
                  worth covering
                </div>
                <div className="sorter__choices">
                  {placement.gaps.map((concept) => (
                    <span key={concept} className="badge badge--caution">
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {recommended ? (
              <div
                className="resume"
                style={{ maxWidth: "var(--measure)", marginBottom: "var(--space-5)" }}
              >
                <span className="meta">
                  starting at lesson{" "}
                  {String(recommended.number).padStart(2, "0")}
                  {placement.newMaterialFrom && placement.newMaterialFrom > 1
                    ? ` · new ground from lesson ${placement.newMaterialFrom}`
                    : ""}
                </span>
                <h2 className="resume__title">{recommended.title}</h2>
                <p className="resume__text">{recommended.description}</p>
              </div>
            ) : null}

            <Callout tone="info">
              Nothing is locked off. You can go back to any earlier lesson from
              the course map whenever you want.
            </Callout>

            <div className="row gap-3" style={{ marginTop: "var(--space-6)", flexWrap: "wrap" }}>
              <Button
                variant="primary"
                size="lg"
                iconEnd={<ArrowRight size={16} />}
                disabled={isSaving}
                onClick={() => void finish()}
              >
                {isSaving ? "Saving…" : "Start lesson one"}
              </Button>

              <Button
                size="lg"
                disabled={isSaving}
                onClick={() => {
                  void saveOnboarding({
                    goal,
                    experience,
                    literacyScore: placement.score,
                    literacyLevel: placement.level,
                    recommendedLessonId: placement.recommendedLessonId,
                  })
                    .then(() => navigate("/courses", { replace: true }))
                    .catch(() =>
                      notify("Couldn't save your answers. Try again.", "error")
                    );
                }}
              >
                See the whole course first
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
