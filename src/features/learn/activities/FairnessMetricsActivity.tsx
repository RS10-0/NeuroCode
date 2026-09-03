import { useState } from "react";

import type { FairnessMetricsActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import DataTable from "./kit/DataTable";
import { useActivityRun } from "./kit/useActivityRun";

export default function FairnessMetricsActivity({
  step,
  state,
  onProgress,
}: StepProps<FairnessMetricsActivityStep>) {
  const activity = step as FairnessMetricsActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [metricId, setMetricId] = useState(activity.initialMetric);
  /* Every metric the learner has actually looked at. */
  const [explored, setExplored] = useState<string[]>([activity.initialMetric]);

  const metric = activity.metrics.find((candidate) => candidate.id === metricId);

  const configuration = activity.configurations.find(
    (candidate) => candidate.metricId === metricId
  );

  function selectMetric(id: string) {
    setMetricId(id);
    setExplored((current) =>
      current.includes(id) ? current : [...current, id]
    );
  }

  /*
   * The lesson is that these definitions conflict, so completion
   * requires comparing at least two rather than accepting the
   * first one.
   */
  const enough = explored.length >= Math.min(2, activity.metrics.length);
  const reachedTarget =
    !activity.targetMetric || explored.includes(activity.targetMetric);

  function check() {
    run.check({
      completed: enough && reachedTarget,
      correctActions: explored.length,
      totalActions: activity.metrics.length,
      actions: explored,
    });
  }

  return (
    <>
      <p className="activity-note">
        There is no single definition of fair. Switch between these and watch
        the same system pass under one and fail under another.
      </p>

      <div className="sorter__choices">
        {activity.metrics.map((candidate) => (
          <label
            key={candidate.id}
            className={`chip${candidate.id === metricId ? " chip--selected" : ""}`}
            title={candidate.description}
          >
            <input
              type="radio"
              className="chip__input"
              name="fairness-metric"
              checked={candidate.id === metricId}
              disabled={run.checked}
              onChange={() => selectMetric(candidate.id)}
            />
            {candidate.label}
          </label>
        ))}
      </div>

      {metric ? (
        <div className="activity-group">
          <div className="activity-group__title">{metric.label}</div>
          <p className="activity-note">{metric.description}</p>

          {metric.formula ? (
            <div className="preview-box preview-box--mono">{metric.formula}</div>
          ) : null}
        </div>
      ) : null}

      <div className="activity-group">
        <div className="activity-group__title">Results by group</div>

        <DataTable
          caption="Fairness results by group under the selected metric"
          rowKey={(group) => group.id}
          rows={activity.groups}
          columns={[
            { key: "group", header: "Group", render: (group) => group.label },
            {
              key: "sample",
              header: "Sample",
              numeric: true,
              render: (group) => group.sampleCount.toLocaleString(),
            },
            {
              key: "approval",
              header: "Approval rate",
              numeric: true,
              /* Rates are authored as percentages: 68 means 68%. */
              render: (group) => `${Math.round(group.approvalRate)}%`,
            },
            {
              key: "metric",
              header: "Under this metric",
              numeric: true,
              render: (group) => {
                const value = configuration?.groupResults[group.id];
                return value === undefined ? "—" : `${Math.round(value)}%`;
              },
              tone: (group) => {
                const value = configuration?.groupResults[group.id];
                if (value === undefined) {
                  return undefined;
                }
                return value < 60 ? "wrong" : "correct";
              },
            },
          ]}
        />
      </div>

      {configuration ? (
        <div className="activity-group">
          <div className="activity-group__title">What this costs</div>
          <p className="activity-note">{configuration.explanation}</p>

          {activity.showTradeoffs !== false && configuration.tradeoffs.length ? (
            <ul className="prose" style={{ fontSize: "var(--text-sm)" }}>
              {configuration.tradeoffs.map((tradeoff) => (
                <li key={tradeoff}>{tradeoff}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={enough && reachedTarget}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="I have compared these"
        onCheck={check}
        onReset={() => {
          run.reset();
          setExplored([metricId]);
        }}
      />

      {!run.checked && !enough ? (
        <p className="slider__hint">
          Look at at least two definitions before deciding.
        </p>
      ) : null}

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout tone="correct" title="They genuinely conflict">
            {activity.feedback?.completion ??
              activity.feedback?.correct ??
              "You cannot satisfy every fairness definition at once — that is a mathematical result, not an engineering shortfall. Which one you pick is a decision someone has to own."}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
