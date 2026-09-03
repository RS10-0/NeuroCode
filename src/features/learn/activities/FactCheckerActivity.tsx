import { useState } from "react";

import type { FactCheckerActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import JudgeList from "./kit/JudgeList";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

const STATUS_OPTIONS = [
  { id: "true", label: "Supported" },
  { id: "unsupported", label: "Unsupported" },
  { id: "misleading", label: "Misleading" },
  { id: "fabricated", label: "Fabricated" },
  { id: "false", label: "False" },
];

const RELIABILITY_TONE = {
  high: "badge--correct",
  medium: "badge--caution",
  low: "badge--error",
} as const;

export default function FactCheckerActivity({
  step,
  state,
  onProgress,
}: StepProps<FactCheckerActivityStep>) {
  const activity = step as FactCheckerActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [verdicts, setVerdicts] = useState<Record<string, string>>({});

  const judged = Object.keys(verdicts).length;
  const correct = activity.claims.filter(
    (claim) => verdicts[claim.id] === claim.status
  ).length;

  /* Only offer the statuses this document actually contains. */
  const present = new Set(activity.claims.map((claim) => claim.status));
  const options = STATUS_OPTIONS.filter((option) => present.has(option.id as never));

  const minimum = activity.minimumFlagsRequired ?? activity.claims.length;

  function check() {
    run.check({
      completed: correct >= minimum,
      score: scoreOf(correct, activity.claims.length),
      correctActions: correct,
      totalActions: activity.claims.length,
    });
  }

  return (
    <>
      <div className="activity-group">
        <div className="activity-group__title">{activity.document.title}</div>
        <div className="preview-box">{activity.document.text}</div>
      </div>

      {activity.sources?.length ? (
        <div className="activity-group">
          <div className="activity-group__title">What you can verify against</div>

          <div className="stack gap-2">
            {activity.sources.map((source) => (
              <div key={source.id} className="row gap-3" style={{ alignItems: "flex-start" }}>
                <span
                  className={`badge ${RELIABILITY_TONE[source.reliability]}`}
                  style={{ flexShrink: 0 }}
                >
                  {source.reliability}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-secondary)" }}>
                  <strong style={{ color: "var(--ink)" }}>{source.title}</strong>{" "}
                  — {source.summary}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="activity-group">
        <div className="activity-group__title">Judge each claim</div>
        <p className="slider__desc">
          A claim you cannot check against a source is not automatically false —
          it is unsupported. Those are different problems.
        </p>

        <JudgeList
          legend="Verdict"
          cases={activity.claims.map((claim) => ({
            id: claim.id,
            body: claim.text,
            options,
            correctOptionId: claim.status,
            explanation: claim.explanation,
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
        canCheck={judged === activity.claims.length}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Submit verdicts"
        onCheck={check}
        onReset={() => {
          run.reset();
          setVerdicts({});
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={correct >= minimum ? "correct" : "caution"}
            title={`${correct} of ${activity.claims.length} judged correctly`}
          >
            {correct >= minimum
              ? (activity.feedback?.correct ??
                "The passage reads as confidently for the invented parts as for the true ones. Fluency is not evidence.")
              : (activity.feedback?.incorrect ??
                "Re-read the ones you missed and ask which source would settle it. If no source can, the claim is unsupported no matter how plausible it sounds.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
