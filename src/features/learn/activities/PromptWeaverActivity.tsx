import { useMemo, useState } from "react";
import { X } from "lucide-react";

import type {
  PromptBlockCategory,
  PromptWeaverActivityStep,
} from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

export default function PromptWeaverActivity({
  step,
  state,
  onProgress,
}: StepProps<PromptWeaverActivityStep>) {
  const activity = step as PromptWeaverActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  /* Ordered — the assembled prompt reads in the order chosen. */
  const [chosen, setChosen] = useState<string[]>([]);

  const blocks = useMemo(
    () => new Map(activity.promptBlocks.map((block) => [block.id, block])),
    [activity.promptBlocks]
  );

  const assembled = chosen
    .map((id) => blocks.get(id)?.text)
    .filter(Boolean)
    .join(" ");

  const coveredCategories = new Set(
    chosen.map((id) => blocks.get(id)?.category).filter(Boolean)
  );

  const missingCategories = activity.requiredCategories.filter(
    (category) => !coveredCategories.has(category)
  );

  const covered =
    activity.requiredCategories.length - missingCategories.length;

  /* Preview the output whose block pattern best matches. */
  const preview = useMemo(() => {
    if (!activity.exampleOutputs?.length) {
      return undefined;
    }

    const index = Math.min(
      activity.exampleOutputs.length - 1,
      Math.floor(
        (covered / Math.max(1, activity.requiredCategories.length)) *
          activity.exampleOutputs.length
      )
    );

    return activity.exampleOutputs[index];
  }, [activity.exampleOutputs, activity.requiredCategories.length, covered]);

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  function check() {
    run.check({
      completed: missingCategories.length === 0,
      score: scoreOf(covered, activity.requiredCategories.length),
      correctActions: covered,
      totalActions: activity.requiredCategories.length,
    });
  }

  const categories = [
    ...new Set(activity.promptBlocks.map((block) => block.category)),
  ] as PromptBlockCategory[];

  return (
    <>
      <p className="activity-note">
        Build a prompt out of parts. A good prompt is not longer — it is one
        where the model has nothing left to guess about.
      </p>

      {categories.map((category) => {
        const isRequired = activity.requiredCategories.includes(category);

        return (
          <div key={category} className="activity-group">
            <div className="activity-group__title">
              {category}
              {isRequired ? (
                <span className="meta" style={{ marginLeft: "var(--space-2)" }}>
                  required
                </span>
              ) : null}
            </div>

            <div className="sorter__choices">
              {activity.promptBlocks
                .filter((block) => block.category === category)
                .map((block) => {
                  const selected = chosen.includes(block.id);

                  return (
                    <label
                      key={block.id}
                      className={`chip${selected ? " chip--selected" : ""}`}
                      title={block.text}
                    >
                      <input
                        type="checkbox"
                        className="chip__input"
                        checked={selected}
                        disabled={run.checked}
                        onChange={() => toggle(block.id)}
                      />
                      {block.label}
                      {selected ? <X size={12} aria-hidden="true" /> : null}
                    </label>
                  );
                })}
            </div>
          </div>
        );
      })}

      <div className="activity-group">
        <div className="activity-group__title">Your prompt</div>

        <div className="preview-box preview-box--mono">
          {assembled || "Nothing selected yet."}
        </div>

        {activity.showOutputPreview !== false && preview ? (
          <>
            <div
              className="meta"
              style={{
                marginTop: "var(--space-4)",
                marginBottom: "var(--space-2)",
              }}
            >
              what you would get back — {preview.label}
            </div>
            <div className="preview-box">{preview.output}</div>
          </>
        ) : null}
      </div>

      <ActivityActions
        checked={run.checked}
        canCheck={chosen.length > 0}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Send this prompt"
        onCheck={check}
        onReset={() => {
          run.reset();
          setChosen([]);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={missingCategories.length === 0 ? "correct" : "caution"}
            title={
              missingCategories.length === 0
                ? "Nothing left to guess"
                : `Still vague about: ${missingCategories.join(", ")}`
            }
          >
            {missingCategories.length === 0
              ? (activity.feedback?.correct ??
                "Every required dimension is specified, so the model has one sensible reading of what you asked for.")
              : (activity.feedback?.incorrect ??
                "Anything you leave out, the model fills in on your behalf — and it will not tell you that it guessed.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
