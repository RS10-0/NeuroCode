import { useState } from "react";

import type {
  InteractiveOption,
  QuizStep as QuizStepType,
} from "../../../core/curriculum/Lesson";
import { Button, Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import OptionList from "../activities/kit/OptionList";

export default function QuizStep({ step, state, onProgress }: StepProps<QuizStepType>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answered, setAnswered] = useState<InteractiveOption | null>(null);

  const allowRetry = step.allowRetry !== false;
  const isCorrect = answered?.isCorrect ?? false;
  const settled = Boolean(answered) && (isCorrect || !allowRetry);

  function submit() {
    const option = step.options.find((candidate) => candidate.id === selectedId);

    if (!option) {
      return;
    }

    setAnswered(option);

    onProgress({
      completed: option.isCorrect || !allowRetry,
      score: option.isCorrect ? 100 : 0,
      correctActions: option.isCorrect ? 1 : 0,
      totalActions: 1,
    });
  }

  function retry() {
    setAnswered(null);
    setSelectedId(null);
  }

  return (
    <>
      <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
        knowledge check
      </div>

      <h1 className="focus__step-title">{step.title}</h1>

      {step.content ? (
        <div className="prose" style={{ marginBottom: "var(--space-5)" }}>
          {step.content}
        </div>
      ) : null}

      <div className="focus__activity">
        <p
          style={{
            fontSize: "var(--text-md)",
            color: "var(--ink)",
            marginBottom: "var(--space-4)",
          }}
        >
          {step.questionText}
        </p>

        <OptionList
          name={step.id}
          options={step.options}
          selectedId={answered ? answered.id : selectedId}
          revealed={Boolean(answered)}
          disabled={settled}
          onSelect={setSelectedId}
        />

        {!answered ? (
          <div style={{ marginTop: "var(--space-4)" }}>
            <Button
              variant="primary"
              onClick={submit}
              disabled={selectedId === null}
            >
              Check answer
            </Button>
          </div>
        ) : null}
      </div>

      {answered ? (
        <div className="focus__feedback stack gap-3">
          {/*
            Feedback always carries the reasoning. A bare
            "Correct." teaches nothing, so the option's own
            explanation is preferred over the generic text.
          */}
          <Callout
            tone={isCorrect ? "correct" : "error"}
            title={isCorrect ? "That's right" : "Not quite"}
          >
            {answered.explanation ||
              answered.feedback ||
              (isCorrect
                ? "Good reasoning — that matches how the model actually behaves."
                : "Have another look at the options and think about what the model is doing underneath.")}
          </Callout>

          {settled && step.explanation ? (
            <Callout tone="info" title="Why this matters">
              {step.explanation}
            </Callout>
          ) : null}

          {!isCorrect && allowRetry ? (
            <div>
              <Button onClick={retry}>Try again</Button>
            </div>
          ) : null}
        </div>
      ) : state?.completed ? (
        <div className="focus__feedback">
          <Callout tone="correct" title="Already answered">
            You cleared this question on an earlier visit.
          </Callout>
        </div>
      ) : null}
    </>
  );
}
