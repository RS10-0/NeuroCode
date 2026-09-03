import { useState } from "react";
import { Check } from "lucide-react";

import type { PolicyCreatorActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun } from "./kit/useActivityRun";

export default function PolicyCreatorActivity({
  step,
  state,
  onProgress,
}: StepProps<PolicyCreatorActivityStep>) {
  const activity = step as PolicyCreatorActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [selected, setSelected] = useState<string[]>([]);

  const minimum = activity.minimumPolicies ?? activity.requiredPolicies.length;
  const missing = activity.requiredPolicies.filter((id) => !selected.includes(id));
  const chosenRequired = activity.requiredPolicies.length - missing.length;

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  function check() {
    run.check({
      completed: missing.length === 0 && selected.length >= minimum,
      correctActions: chosenRequired,
      totalActions: activity.requiredPolicies.length,
      actions: selected,
    });
  }

  return (
    <>
      <p className="activity-note">
        Pick the policies this system ships with. {minimum} minimum, and some are
        not optional.
      </p>

      {activity.categories.map((category) => {
        const tiles = activity.policyTiles.filter(
          (tile) => tile.category === category.id
        );

        if (tiles.length === 0) {
          return null;
        }

        return (
          <div key={category.id} className="activity-group">
            <div className="activity-group__title">{category.label}</div>
            <p className="slider__desc">{category.description}</p>

            <div className="sorter__choices">
              {tiles.map((tile) => {
                const isSelected = selected.includes(tile.id);
                const isRequired = activity.requiredPolicies.includes(tile.id);

                let modifier = "";
                if (run.checked && isRequired) {
                  modifier = isSelected ? " chip--answer" : " chip--wrong";
                } else if (isSelected) {
                  modifier = " chip--selected";
                }

                return (
                  <label
                    key={tile.id}
                    className={`chip${modifier}`}
                    title={tile.description}
                  >
                    <input
                      type="checkbox"
                      className="chip__input"
                      checked={isSelected}
                      disabled={run.checked}
                      onChange={() => toggle(tile.id)}
                    />
                    {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                    {tile.label}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <ActivityActions
        checked={run.checked}
        canCheck={selected.length >= minimum}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Adopt this charter"
        onCheck={check}
        onReset={() => {
          run.reset();
          setSelected([]);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={missing.length === 0 ? "correct" : "error"}
            title={
              missing.length === 0
                ? "Charter approved"
                : `${missing.length} required ${missing.length === 1 ? "policy" : "policies"} missing`
            }
          >
            {missing.length === 0
              ? (activity.feedback?.correct ??
                "Every non-negotiable is covered. Notice how many of them are about a human staying in the loop rather than about the model itself.")
              : `You left out: ${missing
                  .map(
                    (id) =>
                      activity.policyTiles.find((tile) => tile.id === id)?.label ??
                      id
                  )
                  .join(", ")}. Each one exists because a system without it has already caused harm somewhere.`}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
