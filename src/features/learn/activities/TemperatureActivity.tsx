import { useMemo, useState } from "react";

import type { TemperatureSliderActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import ParameterSlider from "./kit/ParameterSlider";
import { useActivityRun } from "./kit/useActivityRun";

export default function TemperatureActivity({
  step,
  state,
  onProgress,
}: StepProps<TemperatureSliderActivityStep>) {
  const activity = step as TemperatureSliderActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [promptId, setPromptId] = useState(activity.prompts[0]?.id ?? "");
  const [temperature, setTemperature] = useState(activity.initialTemperature);

  /* Every (prompt, temperature) pair the learner has actually looked at. */
  const [seen, setSeen] = useState<string[]>([]);

  const prompt = activity.prompts.find((candidate) => candidate.id === promptId);

  const output = useMemo(() => {
    const set = activity.outputSets.find(
      (candidate) => candidate.promptId === promptId
    );

    if (!set || set.outputs.length === 0) {
      return undefined;
    }

    /* Snap to the authored sample nearest the current setting. */
    return set.outputs.reduce((closest, candidate) =>
      Math.abs(candidate.temperature - temperature) <
      Math.abs(closest.temperature - temperature)
        ? candidate
        : closest
    );
  }, [activity.outputSets, promptId, temperature]);

  function record(nextTemperature: number, nextPromptId = promptId) {
    setTemperature(nextTemperature);

    const key = `${nextPromptId}@${nextTemperature.toFixed(1)}`;

    setSeen((current) =>
      current.includes(key) ? current : [...current, key]
    );
  }

  /* Both ends of the range have to be tried, not just nudged. */
  const midpoint = (activity.minTemperature + activity.maxTemperature) / 2;
  const triedLow = seen.some((key) => Number(key.split("@")[1]) < midpoint);
  const triedHigh = seen.some((key) => Number(key.split("@")[1]) > midpoint);

  function check() {
    run.check({
      completed: triedLow && triedHigh,
      correctActions: seen.length,
      totalActions: seen.length,
      actions: seen,
    });
  }

  return (
    <>
      <p className="activity-note">
        Same prompt, same model, one setting changed. Try both ends of the range
        before you decide what temperature actually does.
      </p>

      {activity.prompts.length > 1 ? (
        <div className="activity-group">
          <div className="activity-group__title">Prompt</div>

          <div className="sorter__choices">
            {activity.prompts.map((candidate) => (
              <label
                key={candidate.id}
                className={`chip${candidate.id === promptId ? " chip--selected" : ""}`}
              >
                <input
                  type="radio"
                  className="chip__input"
                  name="temperature-prompt"
                  checked={candidate.id === promptId}
                  disabled={run.checked}
                  onChange={() => {
                    setPromptId(candidate.id);
                    record(temperature, candidate.id);
                  }}
                />
                {candidate.description ?? candidate.prompt}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {prompt ? (
        <div className="preview-box preview-box--mono">{prompt.prompt}</div>
      ) : null}

      <div style={{ marginTop: "var(--space-5)" }}>
        <ParameterSlider
          label="Temperature"
          description="Low values pick the most likely next token almost every time. High values sample further down the list."
          min={activity.minTemperature}
          max={activity.maxTemperature}
          step={activity.stepSize ?? 0.1}
          value={temperature}
          disabled={run.checked}
          onChange={(value) => record(value)}
        />
      </div>

      {output ? (
        <div className="activity-group">
          <div className="activity-group__title">
            Output at {output.temperature.toFixed(1)}
          </div>

          <div className="preview-box">{output.output}</div>

          {activity.showRandomnessMeter ? (
            <div className="split" style={{ marginTop: "var(--space-4)" }}>
              <div>
                <div className="meta">predictability</div>
                <div className="readout__bar" style={{ marginTop: 6 }}>
                  <span
                    className="readout__fill"
                    style={{ width: `${output.predictabilityScore}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="meta">creativity</div>
                <div className="readout__bar" style={{ marginTop: 6 }}>
                  <span
                    className="readout__fill"
                    style={{ width: `${output.creativityScore}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={triedLow && triedHigh}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="I see the difference"
        onCheck={check}
        onReset={() => {
          run.reset();
          setSeen([]);
          setTemperature(activity.initialTemperature);
        }}
      />

      {!run.checked && !(triedLow && triedHigh) ? (
        <p className="slider__hint">
          Try a low setting and a high one — the contrast is the exercise.
        </p>
      ) : null}

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout tone="correct" title="That is the whole knob">
            {activity.feedback?.completion ??
              activity.feedback?.correct ??
              "Temperature does not make a model smarter or more creative in any real sense. It only changes how often the model picks something other than its top guess."}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
