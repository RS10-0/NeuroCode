import { useState } from "react";

import type { AiSorterActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import CardSorter from "./kit/CardSorter";
import { useActivityRun } from "./kit/useActivityRun";

export default function AiSorterActivity({
  step,
  state,
  onProgress,
}: StepProps<AiSorterActivityStep>) {
  const activity = step as AiSorterActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const assignedCount = Object.keys(assignments).length;
  const correctCount = activity.cards.filter(
    (card) => assignments[card.id] === card.correctBucketId
  ).length;

  function check() {
    run.check({
      completed: correctCount === activity.cards.length,
      correctActions: correctCount,
      totalActions: activity.cards.length,
    });
  }

  return (
    <>
      <CardSorter
        items={activity.cards.map((card) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          correctBucketId: card.correctBucketId,
          explanation: card.explanation,
        }))}
        buckets={activity.buckets}
        assignments={assignments}
        revealed={run.checked}
        disabled={run.checked}
        onAssign={(itemId, bucketId) =>
          setAssignments((current) => ({ ...current, [itemId]: bucketId }))
        }
      />

      <ActivityActions
        checked={run.checked}
        canCheck={assignedCount === activity.cards.length}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts || activity.allowRetry === false}
        onCheck={check}
        onReset={() => {
          run.reset();
          setAssignments({});
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={correctCount === activity.cards.length ? "correct" : "caution"}
            title={`${correctCount} of ${activity.cards.length} sorted correctly`}
          >
            {correctCount === activity.cards.length
              ? (activity.feedback?.correct ??
                "Every one placed correctly. The tell is whether the system learned the rule from examples or had it written by hand.")
              : (activity.feedback?.partial ??
                activity.feedback?.incorrect ??
                "Check the explanations under each card — the question is always whether behaviour was learned or programmed.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
