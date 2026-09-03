import { useState } from "react";

import type { NextTokenActivityStep } from "../../../core/curriculum/Lesson";
import { Button, Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

/*
 * Probabilities are authored as percentages, and the long tail
 * is the entire point of this activity — the drop from 85% to
 * 0.01% is what "the model is overwhelmingly confident" looks
 * like as a number.
 *
 * Rounding to whole percents printed "0%" for everything below
 * half a point, collapsing four distinct predictions into three
 * that looked identical. The precision grows as the value
 * shrinks so the tail stays readable.
 */
function formatProbability(value: number): string {
  if (value >= 10) {
    return `${Math.round(value)}%`;
  }

  if (value >= 1) {
    return `${value.toFixed(1)}%`;
  }

  return `${value.toFixed(2)}%`;
}

export default function NextTokenActivity({
  step,
  state,
  onProgress,
}: StepProps<NextTokenActivityStep>) {
  const activity = step as NextTokenActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [index, setIndex] = useState(0);
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);

  const prompt = activity.prompts[index];
  const guess = guesses[prompt.id];
  const isRevealed = revealed.includes(prompt.id);

  const correctCount = activity.prompts.filter(
    (candidate) => guesses[candidate.id] === candidate.correctTokenId
  ).length;

  const answeredAll = revealed.length === activity.prompts.length;

  function submit(tokenId: string) {
    if (isRevealed) {
      return;
    }

    setGuesses((current) => ({ ...current, [prompt.id]: tokenId }));
    setRevealed((current) => [...current, prompt.id]);
  }

  function check() {
    run.check({
      completed: correctCount >= Math.ceil(activity.prompts.length / 2),
      score: scoreOf(correctCount, activity.prompts.length),
      correctActions: correctCount,
      totalActions: activity.prompts.length,
    });
  }

  const chosen = prompt.predictions.find(
    (prediction) => prediction.id === guess
  );

  return (
    <>
      <p className="activity-note">
        Predict what comes next, the same way the model does. You are not
        guessing what is true — you are guessing what is likely.
      </p>

      <div className="activity-group">
        <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
          prompt {index + 1} of {activity.prompts.length}
        </div>

        <div className="preview-box preview-box--mono">
          {prompt.prompt}
          <span style={{ color: "var(--accent)" }}> ▁▁▁</span>
        </div>
      </div>

      <div className="probs">
        {prompt.predictions.map((prediction) => {
          const isChoice = guess === prediction.id;
          const isAnswer = prediction.id === prompt.correctTokenId;

          let modifier = "";
          if (isRevealed && isAnswer) {
            modifier = " prob--correct";
          } else if (isRevealed && isChoice) {
            modifier = " prob--wrong";
          } else if (isChoice) {
            modifier = " prob--selected";
          }

          return (
            <button
              key={prediction.id}
              type="button"
              className={`prob${modifier}`}
              disabled={isRevealed || run.checked}
              onClick={() => submit(prediction.id)}
            >
              <span className="prob__token">{prediction.token}</span>

              <span className="prob__track">
                <span
                  className="prob__fill"
                  style={{
                    width: isRevealed
                      ? `${Math.max(0, Math.min(100, prediction.probability))}%`
                      : "0%",
                  }}
                />
              </span>

              <span className="prob__pct">
                {isRevealed || activity.showProbabilities === true
                  ? formatProbability(prediction.probability)
                  : "?"}
              </span>
            </button>
          );
        })}
      </div>

      {isRevealed ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={guess === prompt.correctTokenId ? "correct" : "caution"}
            title={
              guess === prompt.correctTokenId
                ? "That is what the model picked"
                : "The model went elsewhere"
            }
          >
            {chosen?.feedback ?? prompt.explanation}
          </Callout>

          {index < activity.prompts.length - 1 ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button variant="primary" onClick={() => setIndex(index + 1)}>
                Next prompt
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={answeredAll}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Finish"
        onCheck={check}
        onReset={() => {
          run.reset();
          setGuesses({});
          setRevealed([]);
          setIndex(0);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone="correct"
            title={`${correctCount} of ${activity.prompts.length} matched the model`}
          >
            {activity.feedback?.completion ??
              activity.feedback?.correct ??
              "This is all generation is: pick the next token, append it, repeat. There is no plan for the sentence and no check that it is true."}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
