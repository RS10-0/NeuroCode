interface ScoreReadoutProps {
  label?: string;
  /* 0-100 */
  score: number;
  /* Optional pass mark, drawn as a notch on the bar. */
  target?: number;
  detail?: string;
}

/*
 * Live score display for activities that grade on a percentage.
 */
export default function ScoreReadout({
  label = "score",
  score,
  target,
  detail,
}: ScoreReadoutProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const met = target === undefined || clamped >= target;

  return (
    <div className="readout">
      <div className="readout__head">
        <span className="meta">{label}</span>
        <span
          className={met ? "readout__value readout__value--met" : "readout__value"}
        >
          {clamped}%
          {target !== undefined ? (
            <span className="readout__target"> / {target} to pass</span>
          ) : null}
        </span>
      </div>

      <div className="readout__bar">
        <span
          className={met ? "readout__fill readout__fill--met" : "readout__fill"}
          style={{ width: `${clamped}%` }}
        />
        {target !== undefined ? (
          <span className="readout__notch" style={{ left: `${target}%` }} />
        ) : null}
      </div>

      {detail ? <p className="readout__detail">{detail}</p> : null}
    </div>
  );
}
