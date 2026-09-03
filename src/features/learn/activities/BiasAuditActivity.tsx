import { useState } from "react";

import type { BiasAuditActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import JudgeList from "./kit/JudgeList";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

const ISSUE_OPTIONS = [
  { id: "representation", label: "Representation" },
  { id: "algorithmic", label: "Algorithmic" },
  { id: "measurement", label: "Measurement" },
  { id: "historical", label: "Historical" },
];

const SEVERITY_TONE = {
  low: "badge--neutral",
  medium: "badge--caution",
  high: "badge--error",
} as const;

export default function BiasAuditActivity({
  step,
  state,
  onProgress,
}: StepProps<BiasAuditActivityStep>) {
  const activity = step as BiasAuditActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [diagnoses, setDiagnoses] = useState<Record<string, string>>({});
  const [mitigations, setMitigations] = useState<Record<string, string[]>>({});

  const diagnosed = Object.keys(diagnoses).length;

  const correctDiagnoses = activity.cases.filter(
    (item) => diagnoses[item.id] === item.issueType
  ).length;

  /* A fix only counts if it is one this case actually calls for. */
  const correctMitigations = activity.cases.filter((item) => {
    const chosen = mitigations[item.id] ?? [];

    return (
      chosen.length > 0 &&
      chosen.every((id) => item.correctMitigationIds.includes(id))
    );
  }).length;

  const total = activity.cases.length * 2;
  const scored = correctDiagnoses + correctMitigations;

  function toggleMitigation(caseId: string, optionId: string) {
    setMitigations((current) => {
      const existing = current[caseId] ?? [];
      const allowMultiple = activity.allowMultipleMitigations !== false;

      if (existing.includes(optionId)) {
        return {
          ...current,
          [caseId]: existing.filter((id) => id !== optionId),
        };
      }

      return {
        ...current,
        [caseId]: allowMultiple ? [...existing, optionId] : [optionId],
      };
    });
  }

  function check() {
    run.check({
      completed: scored === total,
      score: scoreOf(scored, total),
      correctActions: scored,
      totalActions: total,
    });
  }

  const everyCaseHasFix = activity.cases.every(
    (item) => (mitigations[item.id] ?? []).length > 0
  );

  return (
    <>
      <p className="activity-note">
        For each incident, name the kind of bias, then choose a fix that
        addresses it. Naming it wrong usually means fixing the wrong thing.
      </p>

      <JudgeList
        legend="Bias type"
        cases={activity.cases.map((item) => ({
          id: item.id,
          title: item.title,
          body: (
            <>
              <span
                className={`badge ${SEVERITY_TONE[item.severity]}`}
                style={{ marginBottom: "var(--space-2)" }}
              >
                {item.severity} severity
              </span>
              <div className="preview-box preview-box--mono">{item.log}</div>
            </>
          ),
          options: ISSUE_OPTIONS,
          correctOptionId: item.issueType,
          explanation: item.explanation,
        }))}
        verdicts={diagnoses}
        revealed={run.checked}
        disabled={run.checked}
        onJudge={(caseId, optionId) =>
          setDiagnoses((current) => ({ ...current, [caseId]: optionId }))
        }
      />

      <div className="activity-group">
        <div className="activity-group__title">Choose a mitigation for each</div>

        {activity.cases.map((item) => {
          const chosen = mitigations[item.id] ?? [];

          return (
            <div key={item.id} style={{ marginBottom: "var(--space-4)" }}>
              <p className="slider__desc">{item.title}</p>

              <div className="sorter__choices">
                {activity.mitigationOptions.map((option) => {
                  const selected = chosen.includes(option.id);
                  const isAnswer =
                    run.checked && item.correctMitigationIds.includes(option.id);

                  let modifier = "";
                  if (isAnswer) {
                    modifier = " chip--answer";
                  } else if (selected) {
                    modifier = run.checked ? " chip--wrong" : " chip--selected";
                  }

                  return (
                    <label
                      key={option.id}
                      className={`chip${modifier}`}
                      title={option.description}
                    >
                      <input
                        type="checkbox"
                        className="chip__input"
                        checked={selected}
                        disabled={run.checked}
                        onChange={() => toggleMitigation(item.id, option.id)}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <ActivityActions
        checked={run.checked}
        canCheck={diagnosed === activity.cases.length && everyCaseHasFix}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Submit audit"
        onCheck={check}
        onReset={() => {
          run.reset();
          setDiagnoses({});
          setMitigations({});
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={scored === total ? "correct" : "caution"}
            title={`${correctDiagnoses}/${activity.cases.length} diagnosed, ${correctMitigations}/${activity.cases.length} mitigated`}
          >
            {scored === total
              ? (activity.feedback?.correct ??
                "Right diagnosis, right fix. Most failed bias work goes wrong at the first step, not the second.")
              : (activity.feedback?.partial ??
                activity.feedback?.incorrect ??
                "Bias in the data needs a data fix; bias in the objective needs a different objective. Matching the fix to the cause is the skill.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
