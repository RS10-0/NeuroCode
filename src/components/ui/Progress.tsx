interface ProgressTrackProps {
  /* Total number of steps. */
  total: number;
  /* Steps already completed. */
  completed: number;
  /* Zero-based index of the step being viewed. */
  current?: number;
  label: string;
}

/*
 * Segmented progress.
 *
 * One segment per step, so progress reads as "3 of 7 discrete
 * things" rather than an anonymous percentage.
 */
export function ProgressTrack({
  total,
  completed,
  current,
  label,
}: ProgressTrackProps) {
  return (
    <div
      className="track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
    >
      {Array.from({ length: total }, (_, index) => {
        let modifier = "";

        if (index < completed) {
          modifier = " track__segment--done";
        } else if (index === current) {
          modifier = " track__segment--current";
        }

        return <span key={index} className={`track__segment${modifier}`} />;
      })}
    </div>
  );
}

interface ProgressBarProps {
  /* 0-100. */
  percent: number;
  label: string;
  className?: string;
}

export function ProgressBar({ percent, label, className = "" }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      className={`bar ${className}`.trim()}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <span className="bar__fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}
