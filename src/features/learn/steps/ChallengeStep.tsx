import { useState } from "react";
import { Lightbulb } from "lucide-react";

import type { ChallengeStep as ChallengeStepType } from "../../../core/curriculum/Lesson";
import { Button, Callout, Textarea } from "../../../components/ui";
import type { StepProps } from "../types";

export default function ChallengeStep({
  step,
  state,
  onProgress,
}: StepProps<ChallengeStepType>) {
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [error, setError] = useState("");

  const hints = step.hints ?? [];

  function submit() {
    if (response.trim().length < 12) {
      setError("Write a bit more before submitting — a sentence at least.");
      return;
    }

    setError("");
    setSubmitted(true);
    onProgress({ completed: true });
  }

  return (
    <>
      <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
        challenge
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
            marginBottom: "var(--space-3)",
          }}
        >
          {step.prompt}
        </p>

        {step.instructions ? (
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--ink-secondary)",
              marginBottom: "var(--space-4)",
            }}
          >
            {step.instructions}
          </p>
        ) : null}

        {step.evaluationCriteria?.length ? (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
              what a good answer covers
            </div>
            <ul
              className="prose"
              style={{ fontSize: "var(--text-sm)", maxWidth: "none" }}
            >
              {step.evaluationCriteria.map((criterion) => (
                <li key={criterion.id}>
                  <strong>{criterion.label}</strong> — {criterion.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Textarea
          value={response}
          invalid={Boolean(error)}
          disabled={submitted}
          placeholder="Write your answer here."
          aria-label="Your answer"
          onChange={(event) => {
            setResponse(event.target.value);
            setError("");
          }}
        />

        {error ? (
          <p
            role="alert"
            style={{
              marginTop: "var(--space-2)",
              fontSize: "var(--text-xs)",
              color: "var(--error)",
            }}
          >
            {error}
          </p>
        ) : null}

        <div
          className="row gap-2"
          style={{ marginTop: "var(--space-4)", flexWrap: "wrap" }}
        >
          {!submitted ? (
            <Button variant="primary" onClick={submit}>
              Submit answer
            </Button>
          ) : null}

          {hintsShown < hints.length ? (
            <Button
              icon={<Lightbulb size={15} />}
              onClick={() => setHintsShown((count) => count + 1)}
            >
              {hintsShown === 0 ? "Show a hint" : "Another hint"}
            </Button>
          ) : null}
        </div>
      </div>

      {hintsShown > 0 ? (
        <div className="focus__feedback stack gap-2">
          {hints.slice(0, hintsShown).map((hint, index) => (
            <Callout key={hint} tone="info" title={`Hint ${index + 1}`}>
              {hint}
            </Callout>
          ))}
        </div>
      ) : null}

      {submitted || state?.completed ? (
        <div className="focus__feedback stack gap-3">
          <Callout tone="correct" title="Answer recorded">
            There is no single right wording here. Compare yours against the
            sample below and notice what each one makes explicit.
          </Callout>

          {step.sampleSolution ? (
            <div
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--rule)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-4)",
              }}
            >
              <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
                one strong answer
              </div>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  lineHeight: "var(--leading-body)",
                  color: "var(--ink-secondary)",
                }}
              >
                {step.sampleSolution}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
