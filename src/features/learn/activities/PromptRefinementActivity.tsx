import { useState } from "react";

import type { PromptRefinementActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import ScoreReadout from "./kit/ScoreReadout";
import { useActivityRun } from "./kit/useActivityRun";

export default function PromptRefinementActivity({
  step,
  state,
  onProgress,
}: StepProps<PromptRefinementActivityStep>) {
  const activity = step as PromptRefinementActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [applied, setApplied] = useState<string[]>([]);

  const maxScore = activity.availableConstraints.reduce(
    (total, constraint) => total + constraint.scoreValue,
    0
  );

  const earned = applied.reduce((total, id) => {
    const constraint = activity.availableConstraints.find(
      (candidate) => candidate.id === id
    );
    return total + (constraint?.scoreValue ?? 0);
  }, 0);

  const quality = maxScore > 0 ? Math.round((earned / maxScore) * 100) : 0;
  const minimum = activity.minimumConstraints ?? 1;

  const revised = [
    activity.originalPrompt,
    ...applied.map(
      (id) =>
        activity.availableConstraints.find((c) => c.id === id)?.text ?? ""
    ),
  ]
    .filter(Boolean)
    .join(" ");

  function check() {
    run.check({
      completed:
        quality >= activity.targetQualityScore && applied.length >= minimum,
      score: quality,
    });
  }

  const categories = [
    ...new Set(activity.availableConstraints.map((c) => c.category)),
  ];

  return (
    <>
      <div className="activity-group">
        <div className="activity-group__title">The prompt as written</div>
        <div className="preview-box preview-box--mono">
          {activity.originalPrompt}
        </div>

        <div
          className="meta"
          style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-2)" }}
        >
          what came back
        </div>
        <div className="preview-box">{activity.flawedOutput}</div>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">What went wrong</div>

        <ul className="prose" style={{ fontSize: "var(--text-sm)" }}>
          {activity.refinementTargets.map((target) => (
            <li key={target.id}>
              <strong>{target.label}</strong> — {target.description}
            </li>
          ))}
        </ul>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Fix it</div>
        <p className="slider__desc">
          Add at least {minimum}. Diagnose first — each addition should answer
          one of the problems above, not just make the prompt longer.
        </p>

        {categories.map((category) => (
          <div key={category} style={{ marginBottom: "var(--space-3)" }}>
            <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
              {category}
            </div>

            <div className="sorter__choices">
              {activity.availableConstraints
                .filter((constraint) => constraint.category === category)
                .map((constraint) => {
                  const selected = applied.includes(constraint.id);

                  return (
                    <label
                      key={constraint.id}
                      className={`chip${selected ? " chip--selected" : ""}`}
                      title={constraint.text}
                    >
                      <input
                        type="checkbox"
                        className="chip__input"
                        checked={selected}
                        disabled={run.checked}
                        onChange={() =>
                          setApplied((current) =>
                            current.includes(constraint.id)
                              ? current.filter((id) => id !== constraint.id)
                              : [...current, constraint.id]
                          )
                        }
                      />
                      {constraint.label}
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Your revision</div>
        <div className="preview-box preview-box--mono">{revised}</div>

        <ScoreReadout
          label="prompt quality"
          score={quality}
          target={activity.targetQualityScore}
        />
      </div>

      <ActivityActions
        checked={run.checked}
        canCheck={applied.length >= minimum}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Run the revision"
        onCheck={check}
        onReset={() => {
          run.reset();
          setApplied([]);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={quality >= activity.targetQualityScore ? "correct" : "caution"}
            title={`Quality ${quality} / ${activity.targetQualityScore} needed`}
          >
            {quality >= activity.targetQualityScore
              ? (activity.feedback?.correct ??
                "That is the loop: bad output, diagnose the cause, add the missing constraint, run again.")
              : (activity.feedback?.incorrect ??
                "Look back at the listed problems. Each one needs a specific answer — a longer prompt that ignores them will not help.")}
          </Callout>

          {quality >= activity.targetQualityScore && activity.sampleImprovedOutput ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
                what the revision returns
              </div>
              <div className="preview-box">{activity.sampleImprovedOutput}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
