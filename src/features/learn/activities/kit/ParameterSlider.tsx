import { useId } from "react";

interface ParameterSliderProps {
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  disabled?: boolean;
  /* Rendered under the track, e.g. the effect of the current value. */
  hint?: string;
  onChange: (value: number) => void;
}

export default function ParameterSlider({
  label,
  description,
  min,
  max,
  step,
  value,
  unit,
  disabled = false,
  hint,
  onChange,
}: ParameterSliderProps) {
  const id = useId();

  /* Step can be fractional, so match the readout to its precision. */
  const decimals = String(step).includes(".")
    ? String(step).split(".")[1].length
    : 0;

  return (
    <div className="slider">
      <div className="slider__head">
        <label className="slider__label" htmlFor={id}>
          {label}
        </label>
        <span className="slider__value">
          {value.toFixed(decimals)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>

      {description ? <p className="slider__desc">{description}</p> : null}

      <input
        id={id}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      {hint ? <p className="slider__hint">{hint}</p> : null}
    </div>
  );
}
