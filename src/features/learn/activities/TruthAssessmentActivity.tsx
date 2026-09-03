import { useState } from "react";

import type { TruthAssessmentActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import JudgeList from "./kit/JudgeList";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

export default function TruthAssessmentActivity({
  step,
  state,
  onProgress,
}: StepProps<TruthAssessmentActivityStep>) {
  const activity = step as TruthAssessmentActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [verdicts, setVerdicts] = useState<Record<string, string>>({});

  const judged = Object.keys(verdicts).length;
  const correct = activity.outputs.filter(
    (output) => verdicts[output.id] === output.correctActionId
  ).length;

  function check() {
    run.check({
      completed: correct === activity.outputs.length,
      score: scoreOf(correct, activity.outputs.length),
      correctActions: correct,
      totalActions: activity.outputs.length,
      actions: Object.values(verdicts),
    });
  }

  return (
    <>
      <div className="activity-group">
        <div className="activity-group__title">Your options</div>

        <div className="stack gap-2">
          {activity.actions.map((action) => (
            <p
              key={action.id}
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--ink-secondary)",
              }}
            >
              <strong style={{ color: "var(--ink)" }}>{action.label}</strong>
              {" — "}
              {action.description}
            </p>
          ))}
        </div>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">
          Decide what to do with each output
        </div>

        <JudgeList
          legend="Action"
          cases={activity.outputs.map((output) => ({
            id: output.id,
            body: output.output,
            options: activity.actions.map((action) => ({
              id: action.id,
              label: action.label,
            })),
            correctOptionId: output.correctActionId,
            explanation: output.explanation,
          }))}
          verdicts={verdicts}
          revealed={run.checked}
          disabled={run.checked}
          onJudge={(caseId, optionId) =>
            setVerdicts((current) => ({ ...current, [caseId]: optionId }))
          }
        />
      </div>

      <ActivityActions
        checked={run.checked}
        canCheck={judged === activity.outputs.length}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Submit decisions"
        onCheck={check}
        onReset={() => {
          run.reset();
          setVerdicts({});
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={correct === activity.outputs.length ? "correct" : "caution"}
            title={`${correct} of ${activity.outputs.length} handled correctly`}
          >
            {correct === activity.outputs.length
              ? (activity.feedback?.correct ??
                "You treated confident-sounding output as something to verify rather than something to trust. That habit is the whole lesson.")
              : (activity.feedback?.incorrect ??
                "Publishing something you have not checked is the expensive mistake here. When in doubt, verify first.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
