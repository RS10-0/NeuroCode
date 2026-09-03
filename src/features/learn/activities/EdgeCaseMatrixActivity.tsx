import { useState } from "react";

import type { EdgeCaseMatrixActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

const RISK_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export default function EdgeCaseMatrixActivity({
  step,
  state,
  onProgress,
}: StepProps<EdgeCaseMatrixActivityStep>) {
  const activity = step as EdgeCaseMatrixActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  /* "caseId|modelId" → predicted risk */
  const [predictions, setPredictions] = useState<Record<string, string>>({});

  const observations = activity.expectedObservations;

  const correct = observations.filter(
    (observation) =>
      predictions[`${observation.caseId}|${observation.modelId}`] ===
      observation.expectedRisk
  ).length;

  const answered = observations.filter(
    (observation) =>
      predictions[`${observation.caseId}|${observation.modelId}`] !== undefined
  ).length;

  function check() {
    run.check({
      completed: correct === observations.length,
      score: scoreOf(correct, observations.length),
      correctActions: correct,
      totalActions: observations.length,
    });
  }

  return (
    <>
      <p className="activity-note">
        Before you run anything: predict how risky each case is for each model.
        Guessing where a system will break is most of what safety work actually
        is.
      </p>

      <div className="activity-group">
        <div className="activity-group__title">The models</div>

        <div className="stack gap-2">
          {activity.models.map((model) => (
            <p
              key={model.id}
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--ink-secondary)",
              }}
            >
              <strong style={{ color: "var(--ink)" }}>{model.label}</strong>
              {" — "}
              {model.description} Trained on{" "}
              {Math.round(model.trainingCoverage)}% coverage
              {model.specialization ? `, specialised in ${model.specialization}` : ""}.
            </p>
          ))}
        </div>
      </div>

      {activity.cases.map((edgeCase) => (
        <div key={edgeCase.id} className="activity-group">
          <div className="activity-group__title">{edgeCase.title}</div>

          <p className="slider__desc">
            {edgeCase.category} · expected difficulty {edgeCase.expectedDifficulty}
          </p>

          <p className="activity-note">{edgeCase.description}</p>

          {activity.models.map((model) => {
            const key = `${edgeCase.id}|${model.id}`;
            const observation = observations.find(
              (candidate) =>
                candidate.caseId === edgeCase.id && candidate.modelId === model.id
            );

            if (!observation) {
              return null;
            }

            const chosen = predictions[key];

            return (
              <div key={key} style={{ marginBottom: "var(--space-3)" }}>
                <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
                  {model.label}
                </div>

                <div
                  className="sorter__choices"
                  role="radiogroup"
                  aria-label={`Risk for ${edgeCase.title} on ${model.label}`}
                >
                  {RISK_LEVELS.map((level) => {
                    const selected = chosen === level.id;
                    const isAnswer =
                      run.checked && level.id === observation.expectedRisk;

                    let modifier = "";
                    if (isAnswer) {
                      modifier = " chip--answer";
                    } else if (selected) {
                      modifier = run.checked ? " chip--wrong" : " chip--selected";
                    }

                    return (
                      <label key={level.id} className={`chip${modifier}`}>
                        <input
                          type="radio"
                          className="chip__input"
                          name={`risk-${key}`}
                          checked={selected}
                          disabled={run.checked}
                          onChange={() =>
                            setPredictions((current) => ({
                              ...current,
                              [key]: level.id,
                            }))
                          }
                        />
                        {level.label}
                      </label>
                    );
                  })}
                </div>

                {run.checked ? (
                  <p className="sort-card__why">
                    {observation.expectedBehavior}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

      <ActivityActions
        checked={run.checked}
        canCheck={answered === observations.length}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Run the cases"
        onCheck={check}
        onReset={() => {
          run.reset();
          setPredictions({});
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={correct === observations.length ? "correct" : "caution"}
            title={`${correct} of ${observations.length} predicted correctly`}
          >
            {correct === observations.length
              ? (activity.feedback?.correct ??
                "You can now anticipate where coverage runs out. That instinct is worth more than any single benchmark score.")
              : (activity.feedback?.incorrect ??
                "The pattern to look for: risk climbs wherever the case sits outside what the model was trained on, regardless of how capable the model is elsewhere.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
