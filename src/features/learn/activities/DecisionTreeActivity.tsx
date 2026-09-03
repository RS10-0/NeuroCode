import { useMemo, useState } from "react";
import { ArrowDown, GripVertical } from "lucide-react";

import type {
  DecisionTreeActivityStep,
  DecisionTreeCondition,
  DecisionTreeItem,
} from "../../../core/curriculum/Lesson";
import { Callout, IconButton } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import DataTable from "./kit/DataTable";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

/* Applies one condition to one item. */
function test(item: DecisionTreeItem, condition: DecisionTreeCondition): boolean {
  const actual = item.attributes[condition.attribute];
  const expected = condition.value;

  switch (condition.operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "greater_than":
      return Number(actual) > Number(expected);
    case "less_than":
      return Number(actual) < Number(expected);
    case "contains":
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return false;
  }
}

export default function DecisionTreeActivity({
  step,
  state,
  onProgress,
}: StepProps<DecisionTreeActivityStep>) {
  const activity = step as DecisionTreeActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const categories = activity.targetCategories;

  /*
   * Ordered rules. The first one that matches decides.
   *
   * Each rule carries the category it concludes, which the
   * learner chooses — that decision is the actual exercise. The
   * outcome used to be read from `solution.classifications`,
   * which is keyed by *item* id ("apple"), not condition id
   * ("condition-seeds"). The lookup never hit, every rule showed
   * "Unclassified", and the activity could not be completed by
   * any sequence of moves.
   */
  const [rules, setRules] = useState<
    { conditionId: string; outcome: string }[]
  >([]);

  /* Where anything that matches no rule lands — the else branch. */
  const [fallback, setFallback] = useState<string>(
    () => categories[categories.length - 1] ?? "Unclassified"
  );

  const conditions = useMemo(
    () => new Map(activity.availableConditions.map((c) => [c.id, c])),
    [activity.availableConditions]
  );

  /*
   * Classify every item by walking the rules in order — this is
   * the live preview that makes the tree feel like a program
   * rather than a diagram.
   */
  const classifications = useMemo(() => {
    const result = new Map<string, string>();

    activity.dataset.forEach((item) => {
      const matched = rules.find((rule) => {
        const condition = conditions.get(rule.conditionId);
        return condition ? test(item, condition) : false;
      });

      result.set(item.id, matched ? matched.outcome : fallback);
    });

    return result;
  }, [activity.dataset, conditions, rules, fallback]);

  const correct = activity.dataset.filter(
    (item) => classifications.get(item.id) === item.correctCategory
  ).length;

  const accuracy = scoreOf(correct, activity.dataset.length);

  function move(index: number, delta: number) {
    setRules((current) => {
      const next = [...current];
      const target = index + delta;

      if (target < 0 || target >= next.length) {
        return current;
      }

      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setOutcome(conditionId: string, outcome: string) {
    setRules((current) =>
      current.map((rule) =>
        rule.conditionId === conditionId ? { ...rule, outcome } : rule
      )
    );
  }

  function check() {
    run.check({
      completed: correct === activity.dataset.length,
      score: accuracy,
      correctActions: correct,
      totalActions: activity.dataset.length,
    });
  }

  return (
    <>
      <p className="activity-note">
        Build a classifier out of rules you write yourself. Order matters — the
        first rule that matches wins, exactly like an if/else chain.
      </p>

      <div className="activity-group">
        <div className="activity-group__title">Available conditions</div>

        <div className="sorter__choices">
          {activity.availableConditions.map((condition) => {
            const used = rules.some(
              (rule) => rule.conditionId === condition.id
            );

            return (
              <label
                key={condition.id}
                className={`chip${used ? " chip--selected" : ""}`}
              >
                <input
                  type="checkbox"
                  className="chip__input"
                  checked={used}
                  disabled={run.checked}
                  onChange={() =>
                    setRules((current) =>
                      current.some(
                        (rule) => rule.conditionId === condition.id
                      )
                        ? current.filter(
                            (rule) => rule.conditionId !== condition.id
                          )
                        : [
                            ...current,
                            {
                              conditionId: condition.id,
                              outcome: categories[0] ?? "Unclassified",
                            },
                          ]
                    )
                  }
                />
                {condition.label}
              </label>
            );
          })}
        </div>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">Your rules, in order</div>

        {rules.length === 0 ? (
          <p className="slider__desc">
            Pick a condition above to start the chain.
          </p>
        ) : (
          <>
          <ol className="rule-chain">
            {rules.map((rule, index) => {
              const condition = conditions.get(rule.conditionId);

              return (
                <li key={rule.conditionId} className="rule">
                  <span className="rule__index">{index + 1}</span>

                  <span className="rule__body">
                    <span className="rule__label">
                      if {condition?.label ?? rule.conditionId}
                    </span>

                    {/*
                      What this rule concludes. Choosing it is the
                      exercise — a rule the learner cannot point at
                      an answer is not a classifier.
                    */}
                    <span className="rule__result">
                      <ArrowDown size={12} aria-hidden="true" />

                      <span
                        className="seg"
                        role="group"
                        aria-label={`Outcome for ${condition?.label ?? "rule"}`}
                      >
                        {categories.map((category) => (
                          <button
                            key={category}
                            type="button"
                            className={
                              rule.outcome === category
                                ? "seg__option seg__option--on"
                                : "seg__option"
                            }
                            aria-pressed={rule.outcome === category}
                            disabled={run.checked}
                            onClick={() =>
                              setOutcome(rule.conditionId, category)
                            }
                          >
                            {category}
                          </button>
                        ))}
                      </span>
                    </span>
                  </span>

                  {activity.allowReordering !== false && !run.checked ? (
                    <span className="rule__controls">
                      <IconButton
                        size="sm"
                        label={`Move ${condition?.label ?? "rule"} earlier`}
                        icon={<GripVertical size={14} />}
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                      />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {/*
            The else branch. Without it the learner would need one
            rule per category to classify anything at all, and the
            authored solution — a single "has seeds" test — would
            be unreachable.
          */}
          <div className="rule rule--fallback">
            <span className="rule__index">·</span>

            <span className="rule__body">
              <span className="rule__label">otherwise</span>

              <span className="rule__result">
                <ArrowDown size={12} aria-hidden="true" />

                <span className="seg" role="group" aria-label="Default outcome">
                  {categories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={
                        fallback === category
                          ? "seg__option seg__option--on"
                          : "seg__option"
                      }
                      aria-pressed={fallback === category}
                      disabled={run.checked}
                      onClick={() => setFallback(category)}
                    >
                      {category}
                    </button>
                  ))}
                </span>
              </span>
            </span>
          </div>
          </>
        )}
      </div>

      {activity.showLivePreview !== false && rules.length > 0 ? (
        <div className="activity-group">
          <div className="activity-group__title">
            What your rules classify right now
          </div>

          <DataTable
            caption="Classification of each item under the current rules"
            rowKey={(item) => item.id}
            rows={activity.dataset}
            columns={[
              { key: "name", header: "Item", render: (item) => item.name },
              {
                key: "predicted",
                header: "Your tree says",
                render: (item) => classifications.get(item.id) ?? "—",
                tone: (item) =>
                  classifications.get(item.id) === item.correctCategory
                    ? "correct"
                    : "wrong",
              },
              {
                key: "actual",
                header: "Should be",
                render: (item) => item.correctCategory,
              },
            ]}
          />
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={rules.length > 0}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Run the classifier"
        onCheck={check}
        onReset={() => {
          run.reset();
          setRules([]);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={correct === activity.dataset.length ? "correct" : "caution"}
            title={`${correct} of ${activity.dataset.length} classified correctly`}
          >
            {correct === activity.dataset.length
              ? (activity.feedback?.correct ??
                "You just wrote the rules by hand. Machine learning is the same job, except the rules get derived from examples instead of typed by you.")
              : (activity.feedback?.incorrect ??
                "Check which items fell through. Either a rule is missing, or an earlier rule is catching things it should not.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
