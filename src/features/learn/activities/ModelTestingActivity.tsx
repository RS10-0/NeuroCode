import { useState } from "react";

import type { ModelTestingActivityStep } from "../../../core/curriculum/Lesson";
import { Button, Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import DataTable from "./kit/DataTable";
import ScoreReadout from "./kit/ScoreReadout";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

export default function ModelTestingActivity({
  step,
  state,
  onProgress,
}: StepProps<ModelTestingActivityStep>) {
  const activity = step as ModelTestingActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  /* Items the learner has actually run through the model. */
  const [tested, setTested] = useState<string[]>([]);

  const minimum = activity.minimumTestsRequired ?? activity.testItems.length;
  const results = activity.testItems.filter((item) => tested.includes(item.id));

  const modelCorrect = results.filter(
    (item) => item.modelPrediction === item.expectedCategory
  ).length;

  const testAccuracy = scoreOf(modelCorrect, results.length);

  function runTest(id: string) {
    setTested((current) => (current.includes(id) ? current : [...current, id]));
  }

  function runAll() {
    setTested(activity.testItems.map((item) => item.id));
  }

  function check() {
    run.check({
      completed: tested.length >= minimum,
      score: testAccuracy,
      correctActions: tested.length,
      totalActions: activity.testItems.length,
      actions: tested,
    });
  }

  return (
    <>
      <div className="activity-group">
        <div className="activity-group__title">What the model learned</div>

        <div className="preview-box">
          Trained on {activity.trainingSummary.trainingItemCount} examples across{" "}
          {activity.trainingSummary.categories.join(", ")}. It scored{" "}
          {Math.round(activity.trainingSummary.trainingAccuracy)}% on the
          data it was trained on.
          {activity.trainingSummary.knownLimitations?.length ? (
            <ul style={{ marginTop: "var(--space-3)" }}>
              {activity.trainingSummary.knownLimitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Run it on data it has not seen</div>
        <p className="slider__desc">
          Test at least {minimum}. Training accuracy and test accuracy are
          different numbers, and the gap between them is the point.
        </p>

        <div className="dataset-grid">
          {activity.testItems.map((item) => {
            const hasRun = tested.includes(item.id);
            const wasRight = item.modelPrediction === item.expectedCategory;

            let modifier = "";
            if (hasRun) {
              modifier = wasRight ? " sample--correct" : " sample--wrong";
            }

            return (
              <div key={item.id} className={`sample${modifier}`}>
                {item.image ? (
                  <img className="sample__img" src={item.image} alt="" />
                ) : (
                  <div className="sample__img sample__img--text">
                    {item.input}
                  </div>
                )}

                {hasRun ? (
                  <div className="stack gap-1">
                    <span className="meta">
                      predicted {item.modelPrediction} ·{" "}
                      {Math.round(item.confidence * 100)}%
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        color: wasRight ? "var(--correct)" : "var(--error)",
                      }}
                    >
                      {wasRight
                        ? "correct"
                        : `actually ${item.expectedCategory}`}
                    </span>
                  </div>
                ) : (
                  <Button size="sm" block onClick={() => runTest(item.id)}>
                    Run test
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {tested.length < activity.testItems.length ? (
          <div style={{ marginTop: "var(--space-4)" }}>
            <Button onClick={runAll}>Run all remaining</Button>
          </div>
        ) : null}
      </div>

      {results.length > 0 ? (
        <div className="activity-group">
          <div className="activity-group__title">Results</div>

          <ScoreReadout
            label="test accuracy"
            score={testAccuracy}
            detail={`Training accuracy was ${Math.round(
              activity.trainingSummary.trainingAccuracy
            )}%. A model that scores much lower on new data has memorised rather than generalised.`}
          />

          {activity.showPerCategoryAccuracy ? (
            <div style={{ marginTop: "var(--space-4)" }}>
              <DataTable
                caption="Model predictions against expected categories"
                rowKey={(item) => item.id}
                rows={results}
                columns={[
                  {
                    key: "input",
                    header: "Example",
                    render: (item) => item.input,
                  },
                  {
                    key: "expected",
                    header: "Actual",
                    render: (item) => item.expectedCategory,
                  },
                  {
                    key: "predicted",
                    header: "Model said",
                    render: (item) => item.modelPrediction,
                    tone: (item) =>
                      item.modelPrediction === item.expectedCategory
                        ? "correct"
                        : "wrong",
                  },
                  {
                    key: "confidence",
                    header: "Confidence",
                    numeric: true,
                    render: (item) => `${Math.round(item.confidence * 100)}%`,
                  },
                ]}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={tested.length >= minimum}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Finish testing"
        onCheck={check}
        onReset={() => {
          run.reset();
          setTested([]);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout tone="correct" title="Testing complete">
            {activity.feedback?.completion ??
              activity.feedback?.correct ??
              "Notice where the confident predictions were wrong. High confidence on an unfamiliar example is exactly the failure mode to watch for."}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
