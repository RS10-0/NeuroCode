import { createElement } from "react";

import type { ActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import { getActivity } from "../activityRegistry";
import type { StepProps } from "../types";

/*
 * Renders the interactive activity for an activity step.
 *
 * The host owns the framing — title, instructions, and the
 * activity frame — so each activity component only has to
 * render its own interaction.
 */
export default function ActivityHost(props: StepProps<ActivityStep>) {
  const { step } = props;
  const Activity = getActivity(step.interactiveType);

  return (
    <>
      <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
        {step.interactiveType.replace(/_/g, " ")}
      </div>

      <h1 className="focus__step-title">{step.title}</h1>

      {step.content ? (
        <div className="prose" style={{ marginBottom: "var(--space-4)" }}>
          {step.content}
        </div>
      ) : null}

      {step.instructions ? (
        <p
          className="prose"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--ink-muted)",
            marginBottom: "var(--space-5)",
          }}
        >
          {step.instructions}
        </p>
      ) : null}

      <div className="focus__activity">
        {Activity ? (
          createElement(Activity, props)
        ) : (
          <Callout tone="caution" title="This activity is still being built">
            The lesson content for this step exists, but its interactive
            component has not shipped yet. You can continue to the next step.
          </Callout>
        )}
      </div>
    </>
  );
}
