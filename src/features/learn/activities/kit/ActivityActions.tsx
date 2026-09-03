import { RotateCcw } from "lucide-react";

import { Button } from "../../../../components/ui";

interface ActivityActionsProps {
  checked: boolean;
  /* Disables Check until the learner has done enough to submit. */
  canCheck: boolean;
  attemptsLeft: number | undefined;
  outOfAttempts: boolean;
  checkLabel?: string;
  onCheck: () => void;
  onReset: () => void;
}

/*
 * The check / try-again row every activity ends with.
 */
export default function ActivityActions({
  checked,
  canCheck,
  attemptsLeft,
  outOfAttempts,
  checkLabel = "Check answers",
  onCheck,
  onReset,
}: ActivityActionsProps) {
  return (
    <div className="activity-actions">
      {!checked ? (
        <Button variant="primary" onClick={onCheck} disabled={!canCheck}>
          {checkLabel}
        </Button>
      ) : !outOfAttempts ? (
        <Button icon={<RotateCcw size={15} />} onClick={onReset}>
          Try again
        </Button>
      ) : null}

      {attemptsLeft !== undefined ? (
        <span className="meta">
          {outOfAttempts
            ? "no attempts left"
            : `${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left`}
        </span>
      ) : null}
    </div>
  );
}
