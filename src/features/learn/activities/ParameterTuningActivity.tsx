import { useMemo, useState } from "react";

import type { ParameterTuningActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import ParameterSlider from "./kit/ParameterSlider";
import ScoreReadout from "./kit/ScoreReadout";
import { useActivityRun } from "./kit/useActivityRun";

export default function ParameterTuningActivity({
  step,
  state,
  onProgress,
}: StepProps<ParameterTuningActivityStep>) {
  const activity = step as ParameterTuningActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [values, setValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};

    activity.parameters.forEach((parameter) => {
      initial[parameter.id] =
        activity.initialValues?.[parameter.id] ??
        (parameter.min + parameter.max) / 2;
    });

    return initial;
  });

  /*
   * Simulated accuracy.
   *
   * `effectStrength` is authored as a fraction of the achievable
   * gain, not as raw percentage points — 0.42 means this
   * parameter is worth 42% of the distance from baseline to the
   * ceiling. Outside its optimal band the contribution decays to
   * nothing over one band-width, so cranking every slider to the
   * maximum is deliberately not the winning move.
   */
  const accuracy = useMemo(() => {
    const model = activity.accuracyModel;
    const ceiling = model.maxAccuracy ?? 100;
    const headroom = Math.max(0, ceiling - model.baselineAccuracy);

    let score = model.baselineAccuracy;

    model.effects.forEach((effect) => {
      const value = values[effect.parameterId];

      if (value === undefined) {
        return;
      }

      const [low, high] = effect.optimalRange;
      const contribution = effect.effectStrength * headroom;

      if (value >= low && value <= high) {
        score += contribution;
        return;
      }

      const distance = value < low ? low - value : value - high;
      const span = Math.max(1, high - low);
      const falloff = Math.max(0, 1 - distance / span);

      score += contribution * falloff;
    });

    return Math.max(
      model.minAccuracy ?? 0,
      Math.min(ceiling, Math.round(score))
    );
  }, [activity.accuracyModel, values]);

  const target = activity.targetAccuracy ?? 80;

  const threshold = activity.feedbackThresholds?.find(
    (candidate) =>
      accuracy >= candidate.minAccuracy && accuracy <= candidate.maxAccuracy
  );

  function check() {
    run.check({
      completed: accuracy >= target,
      score: accuracy,
    });
  }

  return (
    <>
      <p className="activity-note">
        Move each setting and watch the accuracy respond. Nothing here is
        guesswork — every parameter has a range where the model does best, and
        the point is to feel how far off you can be before it hurts.
      </p>

      {activity.parameters.map((parameter) => {
        const effect = activity.accuracyModel.effects.find(
          (candidate) => candidate.parameterId === parameter.id
        );

        return (
          <ParameterSlider
            key={parameter.id}
            label={parameter.label}
            description={parameter.description}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            unit={parameter.unit}
            value={values[parameter.id]}
            disabled={run.checked}
            hint={run.checked && effect ? effect.description : undefined}
            onChange={(value) =>
              setValues((current) => ({ ...current, [parameter.id]: value }))
            }
          />
        );
      })}

      <ScoreReadout
        label="simulated accuracy"
        score={accuracy}
        target={target}
        detail={threshold?.message}
      />

      <ActivityActions
        checked={run.checked}
        canCheck
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Lock in these settings"
        onCheck={check}
        onReset={run.reset}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={accuracy >= target ? "correct" : "caution"}
            title={`${accuracy}% accuracy`}
          >
            {accuracy >= target
              ? (activity.feedback?.correct ??
                "Tuned. Note that you improved the model without changing a single line of its code — only the settings around it.")
              : (activity.feedback?.incorrect ??
                "Still short. Each slider now shows what it actually controls; use that to work out which one is dragging the score down.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
