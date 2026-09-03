import { Check } from "lucide-react";

import type { CompletionStep as CompletionStepType } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import MissionCard from "../MissionCard";
import type { StepProps } from "../types";

interface CompletionStepProps extends StepProps<CompletionStepType> {
  /* XP actually granted during this visit — zero on a replay. */
  xpAwarded: number;
  alreadyCompleted: boolean;
  /* The step-XP write did not land. */
  xpUnavailable?: boolean;
  /* Why it did not land, in the server's own words. */
  xpError?: string;
}

export default function CompletionStep({
  step,
  xpAwarded,
  alreadyCompleted,
  xpUnavailable = false,
  xpError = "",
}: CompletionStepProps) {
  return (
    <div style={{ textAlign: "center" }}>
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: "44px",
          height: "44px",
          margin: "0 auto var(--space-5)",
          background: "var(--correct-bg)",
          border: "1px solid var(--correct-rule)",
          color: "var(--correct)",
          borderRadius: "var(--radius-full)",
        }}
      >
        <Check size={20} aria-hidden="true" />
      </span>

      <h1
        className="focus__step-title"
        style={{ maxWidth: "none", marginBottom: "var(--space-3)" }}
      >
        {step.title}
      </h1>

      {step.completionMessage || step.content ? (
        <p
          className="prose"
          style={{
            margin: "0 auto var(--space-6)",
            fontSize: "var(--text-md)",
          }}
        >
          {step.completionMessage || step.content}
        </p>
      ) : null}

      {/*
        XP is granted once per step. A repeat run says so plainly
        rather than implying the learner earned it again.
      */}
      <div
        className="row gap-3"
        style={{ justifyContent: "center", marginBottom: "var(--space-7)" }}
      >
        {xpUnavailable ? (
          <span className="badge badge--caution badge--mono">
            xp not recorded
          </span>
        ) : xpAwarded > 0 ? (
          <span className="badge badge--correct badge--mono">
            +{xpAwarded} xp earned
          </span>
        ) : (
          <span className="badge badge--neutral badge--mono">
            {alreadyCompleted ? "already earned" : "no new xp"}
          </span>
        )}
      </div>

      {xpUnavailable ? (
        <div
          style={{
            maxWidth: "var(--measure)",
            margin: "0 auto var(--space-6)",
            textAlign: "left",
          }}
        >
          <Callout tone="caution" title="Progress was not saved">
            This lesson has not been recorded, so pressing Finish will not
            mark it complete. Your answers still stand — they will count as
            soon as the write succeeds.
            {xpError ? (
              <>
                {" "}
                The server said:{" "}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                  }}
                >
                  {xpError}
                </span>
              </>
            ) : null}
          </Callout>
        </div>
      ) : null}

      {step.keyTakeaways?.length ? (
        <div
          style={{
            maxWidth: "var(--measure)",
            margin: "0 auto",
            textAlign: "left",
            background: "var(--surface-2)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-5)",
          }}
        >
          <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
            what to remember
          </div>

          <ul className="prose" style={{ color: "var(--ink-secondary)" }}>
            {step.keyTakeaways.map((takeaway) => (
              <li key={takeaway}>{takeaway}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        Below the takeaways rather than above them: the mission
        is the way out of the lesson, and putting it before the
        summary would ask somebody to leave before they had
        finished reading why they should.
      */}
      {step.mission ? (
        <MissionCard mission={step.mission} align="center" />
      ) : null}
    </div>
  );
}
