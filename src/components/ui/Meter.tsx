import { ProgressBar } from "./Progress";

interface MeterProps {
  label: string;
  used: number;
  limit: number;
  /* Appended to the readout, e.g. "requests". */
  unit?: string;
  className?: string;
}

/*
 * Usage readout for AI quotas and XP.
 *
 * Turns amber past 75% and red past 90% so a learner sees a
 * limit approaching before it stops them mid-task.
 */
export default function Meter({
  label,
  used,
  limit,
  unit,
  className = "",
}: MeterProps) {
  const percent = limit > 0 ? (used / limit) * 100 : 0;

  let tone = "";
  if (percent >= 90) {
    tone = " meter--error";
  } else if (percent >= 75) {
    tone = " meter--caution";
  }

  return (
    <div className={`meter${tone} ${className}`.trim()}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">
          {used.toLocaleString()} / {limit.toLocaleString()}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>

      <ProgressBar percent={percent} label={`${label} usage`} />
    </div>
  );
}
