import { useMemo, useState } from "react";

import type { DatasetImbalanceActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import DataTable from "./kit/DataTable";
import ParameterSlider from "./kit/ParameterSlider";
import { useActivityRun } from "./kit/useActivityRun";

export default function DatasetImbalanceActivity({
  step,
  state,
  onProgress,
}: StepProps<DatasetImbalanceActivityStep>) {
  const activity = step as DatasetImbalanceActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [distribution, setDistribution] = useState<Record<string, number>>(
    () => ({ ...activity.initialDistribution })
  );

  /* Nearest authored simulation for the current mix. */
  const simulation = useMemo(() => {
    if (activity.simulationResults.length === 0) {
      return undefined;
    }

    const distance = (candidate: Record<string, number>) =>
      Object.keys(candidate).reduce(
        (total, key) =>
          total + Math.abs((distribution[key] ?? 0) - (candidate[key] ?? 0)),
        0
      );

    return activity.simulationResults.reduce((closest, candidate) =>
      distance(candidate.distribution) < distance(closest.distribution)
        ? candidate
        : closest
    );
  }, [activity.simulationResults, distribution]);

  /* Disparity is the spread between the best- and worst-served groups. */
  const rates = simulation
    ? Object.values(simulation.recommendationRates)
    : activity.groups.map((group) => group.recommendationRate);

  /*
   * Rates are authored as percentages — 72 means 72%, not 7200%.
   * Three places here multiplied by 100 as though they were
   * fractions, which printed "7200%" in the results table and
   * left the "underserved group" highlight permanently off,
   * since no percentage is ever below 0.4.
   */
  const disparity =
    simulation?.disparityScore ??
    Math.round(Math.max(...rates) - Math.min(...rates));

  const balanced = disparity <= 15;

  function check() {
    run.check({
      completed: balanced,
      score: Math.max(0, 100 - disparity),
    });
  }

  return (
    <>
      <p className="activity-note">
        Change who is represented in the training data and watch who the system
        ends up recommending. Nobody wrote a rule to favour anyone — the
        distribution did it.
      </p>

      {activity.allowRebalancing !== false
        ? activity.groups.map((group) => (
            <ParameterSlider
              key={group.id}
              label={group.label}
              description={group.explanation}
              min={0}
              max={100}
              step={5}
              unit="% of data"
              value={distribution[group.id] ?? group.initialPercentage}
              disabled={run.checked}
              onChange={(value) =>
                setDistribution((current) => ({ ...current, [group.id]: value }))
              }
            />
          ))
        : null}

      {simulation ? (
        <div className="activity-group">
          <div className="activity-group__title">Who gets recommended</div>

          <DataTable
            caption="Recommendation rate by group"
            rowKey={(group) => group.id}
            rows={activity.groups}
            columns={[
              {
                key: "group",
                header: "Group",
                render: (group) => group.label,
              },
              {
                key: "share",
                header: "Share of data",
                numeric: true,
                render: (group) =>
                  `${Math.round(distribution[group.id] ?? group.initialPercentage)}%`,
              },
              {
                key: "rate",
                header: "Recommendation rate",
                numeric: true,
                render: (group) =>
                  `${Math.round(
                    simulation.recommendationRates[group.id] ??
                      group.recommendationRate
                  )}%`,
                tone: (group) => {
                  const rate =
                    simulation.recommendationRates[group.id] ??
                    group.recommendationRate;
                  return rate < 40 ? "wrong" : undefined;
                },
              },
            ]}
          />

          <div className="readout">
            <div className="readout__head">
              <span className="meta">disparity between groups</span>
              <span
                className={
                  balanced ? "readout__value readout__value--met" : "readout__value"
                }
              >
                {disparity} points
              </span>
            </div>
          </div>

          <p className="readout__detail">{simulation.explanation}</p>
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Submit this dataset"
        onCheck={check}
        onReset={() => {
          run.reset();
          setDistribution({ ...activity.initialDistribution });
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={balanced ? "correct" : "caution"}
            title={
              balanced
                ? "Roughly even outcomes"
                : `${disparity}-point gap between groups`
            }
          >
            {balanced
              ? (activity.feedback?.correct ??
                "A more representative dataset narrowed the gap. The model did not change — what it learned from did.")
              : (activity.feedback?.incorrect ??
                "A group that is a small slice of the training data gets served worse, every time. This is the most common way bias enters a system.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
