import { useMemo, useState } from "react";

import type { DatasetPlaygroundActivityStep } from "../../../core/curriculum/Lesson";
import { Button, Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import ScoreReadout from "./kit/ScoreReadout";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

export default function DatasetPlaygroundActivity({
  step,
  state,
  onProgress,
}: StepProps<DatasetPlaygroundActivityStep>) {
  const activity = step as DatasetPlaygroundActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [labels, setLabels] = useState<Record<string, string>>({});
  const [trained, setTrained] = useState(false);

  const labelled = Object.keys(labels).length;
  const correct = activity.dataset.filter(
    (item) => labels[item.id] === item.correctLabel
  ).length;

  const accuracy = scoreOf(correct, activity.dataset.length);

  /*
   * Training stages gate on how many examples went in, so the
   * learner sees that more data is a lever independent of
   * whether the labels were right.
   */
  const stage = useMemo(() => {
    const stages = [...(activity.trainingStages ?? [])].sort(
      (a, b) => a.minimumItems - b.minimumItems
    );

    return stages.reduce<(typeof stages)[number] | undefined>(
      (reached, candidate) =>
        correct >= candidate.minimumItems ? candidate : reached,
      undefined
    );
  }, [activity.trainingStages, correct]);

  const canTrain = labelled >= activity.requiredLabels;

  function train() {
    setTrained(true);
  }

  function check() {
    run.check({
      completed: accuracy >= 80,
      score: accuracy,
      correctActions: correct,
      totalActions: activity.dataset.length,
    });
  }

  return (
    <>
      <p className="activity-note">
        Label at least {activity.requiredLabels} examples, then train. Every
        correct label is one more piece of evidence the model gets to learn
        from — and every wrong one teaches it something false.
      </p>

      <div className="dataset-grid">
        {activity.dataset.map((item) => {
          const chosen = labels[item.id];
          const isCorrect = chosen === item.correctLabel;

          let modifier = "";
          if (run.checked && chosen) {
            modifier = isCorrect ? " sample--correct" : " sample--wrong";
          }

          return (
            <div key={item.id} className={`sample${modifier}`}>
              {item.image ? (
                <img className="sample__img" src={item.image} alt="" />
              ) : (
                <div className="sample__img sample__img--text">
                  {item.label ?? item.id}
                </div>
              )}

              <div
                className="sample__choices"
                role="radiogroup"
                aria-label={`Label for example ${item.id}`}
              >
                {activity.categories.map((category) => {
                  const selected = chosen === category.id;
                  const isAnswer =
                    run.checked && category.id === item.correctLabel;

                  let chipModifier = "";
                  if (isAnswer) {
                    chipModifier = " chip--answer";
                  } else if (selected) {
                    chipModifier = run.checked ? " chip--wrong" : " chip--selected";
                  }

                  return (
                    <label key={category.id} className={`chip${chipModifier}`}>
                      <input
                        type="radio"
                        className="chip__input"
                        name={`label-${item.id}`}
                        checked={selected}
                        disabled={run.checked}
                        onChange={() => {
                          setLabels((current) => ({
                            ...current,
                            [item.id]: category.id,
                          }));
                          setTrained(false);
                        }}
                      />
                      {category.label}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Training</div>

        <p className="slider__desc">
          {labelled} of {activity.dataset.length} examples labelled.
        </p>

        {!trained ? (
          <Button variant="primary" disabled={!canTrain} onClick={train}>
            Train the model
          </Button>
        ) : (
          <>
            <ScoreReadout
              label="training accuracy"
              score={stage?.accuracy ?? accuracy}
              target={80}
              detail={
                stage
                  ? `${stage.label} — the model is ${Math.round(
                      stage.confidence ?? 0
                    )}% confident on examples like these.`
                  : "Not enough correct examples yet for the model to generalise."
              }
            />

            {activity.showConfidence && stage ? (
              <p className="slider__hint">
                Confidence is not correctness. A model can be sure and wrong —
                that is what the next lesson is about.
              </p>
            ) : null}
          </>
        )}
      </div>

      <ActivityActions
        checked={run.checked}
        canCheck={trained}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Submit this dataset"
        onCheck={check}
        onReset={() => {
          run.reset();
          setLabels({});
          setTrained(false);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={accuracy >= 80 ? "correct" : "caution"}
            title={`${correct} of ${activity.dataset.length} labelled correctly`}
          >
            {accuracy >= 80
              ? (activity.feedback?.correct ??
                "Clean labels in, useful patterns out.")
              : (activity.feedback?.incorrect ??
                "Mislabelled examples do not just get ignored — the model learns them as fact. This is why data quality matters more than data volume.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
