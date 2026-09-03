import { useMemo, useState } from "react";

import type { EthicsDialActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import ParameterSlider from "./kit/ParameterSlider";
import { useActivityRun } from "./kit/useActivityRun";

export default function EthicsDialActivity({
  step,
  state,
  onProgress,
}: StepProps<EthicsDialActivityStep>) {
  const activity = step as EthicsDialActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    activity.priorities.forEach((priority) => {
      initial[priority.id] = priority.weight;
    });
    return initial;
  });

  const [accepted, setAccepted] = useState<string[]>(() =>
    activity.constraints.filter((c) => c.required).map((c) => c.id)
  );

  /*
   * Match the current dial positions to the nearest authored
   * outcome, so every configuration produces a real consequence
   * rather than an abstract number.
   */
  const outcome = useMemo(() => {
    if (activity.outcomes.length === 0) {
      return undefined;
    }

    const distance = (settings: Record<string, number>) =>
      Object.entries(settings).reduce(
        (total, [key, value]) => total + Math.abs((weights[key] ?? 0) - value),
        0
      );

    return activity.outcomes.reduce((closest, candidate) =>
      distance(candidate.settings) < distance(closest.settings)
        ? candidate
        : closest
    );
  }, [activity.outcomes, weights]);

  const requiredConstraints = activity.constraints.filter((c) => c.required);
  const missingRequired = requiredConstraints.filter(
    (c) => !accepted.includes(c.id)
  );

  const passes =
    missingRequired.length === 0 &&
    (outcome?.safetyScore ?? 0) >= 60 &&
    (outcome?.legalComplianceScore ?? 0) >= 60;

  function check() {
    const scores = outcome
      ? [outcome.safetyScore, outcome.fairnessScore, outcome.legalComplianceScore]
      : [0];

    run.check({
      completed: passes,
      score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      actions: accepted,
    });
  }

  return (
    <>
      <div className="activity-group">
        <div className="activity-group__title">{activity.scenario.title}</div>
        <p className="activity-note">{activity.scenario.description}</p>
        <div className="preview-box">{activity.scenario.context}</div>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Set your priorities</div>
        <p className="slider__desc">
          These trade against each other. Turning one up genuinely costs you
          somewhere else — that is what makes it a decision rather than a
          preference.
        </p>

        {activity.priorities.map((priority) => (
          <ParameterSlider
            key={priority.id}
            label={priority.label}
            description={priority.description}
            min={0}
            max={100}
            step={5}
            value={weights[priority.id]}
            disabled={run.checked}
            onChange={(value) =>
              setWeights((current) => ({ ...current, [priority.id]: value }))
            }
          />
        ))}
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Commitments</div>

        <div className="sorter__choices">
          {activity.constraints.map((constraint) => {
            const isAccepted = accepted.includes(constraint.id);

            let modifier = "";
            if (run.checked && constraint.required) {
              modifier = isAccepted ? " chip--answer" : " chip--wrong";
            } else if (isAccepted) {
              modifier = " chip--selected";
            }

            return (
              <label
                key={constraint.id}
                className={`chip${modifier}`}
                title={constraint.description}
              >
                <input
                  type="checkbox"
                  className="chip__input"
                  checked={isAccepted}
                  disabled={run.checked}
                  onChange={() =>
                    setAccepted((current) =>
                      current.includes(constraint.id)
                        ? current.filter((id) => id !== constraint.id)
                        : [...current, constraint.id]
                    )
                  }
                />
                {constraint.label}
                {constraint.required ? " *" : ""}
              </label>
            );
          })}
        </div>
      </div>

      {outcome ? (
        <div className="activity-group">
          <div className="activity-group__title">What this configuration does</div>

          <div className="preview-box">{outcome.description}</div>

          <div className="split" style={{ marginTop: "var(--space-4)" }}>
            {[
              { label: "safety", value: outcome.safetyScore },
              { label: "fairness", value: outcome.fairnessScore },
              { label: "legal", value: outcome.legalComplianceScore },
            ].map((score) => (
              <div key={score.label}>
                <div className="meta">
                  {score.label} · {score.value}
                </div>
                <div className="readout__bar" style={{ marginTop: 6 }}>
                  <span
                    className={
                      score.value >= 60
                        ? "readout__fill readout__fill--met"
                        : "readout__fill"
                    }
                    style={{ width: `${score.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Ship this configuration"
        onCheck={check}
        onReset={run.reset}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={passes ? "correct" : "error"}
            title={passes ? "Approved for deployment" : "Not fit to ship"}
          >
            {missingRequired.length > 0
              ? `You skipped commitments that are not optional: ${missingRequired
                  .map((c) => c.label)
                  .join(", ")}.`
              : passes
                ? (activity.feedback?.correct ??
                  "A workable balance. Note that you could not max everything — real systems always give something up.")
                : (activity.feedback?.incorrect ??
                  "Safety and legal compliance are floors, not dials. A configuration that trades them away is not a trade-off, it is a liability.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
