import { useId, useState } from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";

import type { AiModel } from "../../lib/aiClient";
import { PARAMETER_NOTES, describeTemperature } from "./explain";
import type { LabErrors } from "./request";
import type { LabSettings } from "./types";

/*
 * Everything that shapes the request but is not written prose.
 *
 * Four controls, and exactly four, because four are what the
 * runtime validates and forwards. A top-p slider would be easy
 * to add and would be a lie — nothing downstream reads it — and
 * the first thing this page is trying to teach is that a
 * request is a real, finite, inspectable object.
 *
 * Model moved in here from the composer during the redesign.
 * It belongs with temperature and the token cap: all four are
 * dials on the same machine, and none of them is something the
 * learner writes. What the learner writes now has the middle of
 * the page to itself.
 *
 * Every control carries its explanation inline rather than
 * behind a tooltip. Tooltips are unreachable on a touch screen
 * and easy to miss on a desktop, and the explanation is the
 * reason the control is on screen at all.
 */

interface ParameterControlsProps {
  settings: LabSettings;
  model: AiModel | undefined;
  errors: LabErrors;
  disabled: boolean;
  onChange: (patch: Partial<LabSettings>) => void;
}

export default function ParameterControls({
  settings,
  model,
  errors,
  disabled,
  onChange,
}: ParameterControlsProps) {
  return (
    <section className="params" aria-labelledby="params-heading">
      <h2 className="rail-heading" id="params-heading">
        <SlidersHorizontal size={14} aria-hidden="true" />
        Parameters
      </h2>

      <Temperature
        value={settings.temperature}
        error={errors.temperature}
        disabled={disabled}
        onChange={(temperature) => onChange({ temperature })}
      />

      <MaxTokens
        value={settings.maxOutputTokens}
        model={model}
        error={errors.maxOutputTokens}
        disabled={disabled}
        onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
      />

      <StopSequences
        value={settings.stop}
        error={errors.stop}
        disabled={disabled}
        onChange={(stop) => onChange({ stop })}
      />
    </section>
  );
}

/* =========================================================
   TEMPERATURE
========================================================= */

function Temperature({
  value,
  error,
  disabled,
  onChange,
}: {
  value: number;
  error?: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const describedBy = `${id}-desc`;
  const band = describeTemperature(value);

  return (
    <div className="param">
      <div className="param__head">
        <label className="param__label" htmlFor={id}>
          {PARAMETER_NOTES.temperature.title}
        </label>

        {/*
          Hidden from assistive tech, shown to everyone else.
          <output> is a live region by default, so each nudge of
          the slider was announced twice — once by the range
          input reporting its own value, and again by this
          echoing it. The slider is the authoritative one.
        */}
        <output className="param__value" htmlFor={id} aria-hidden="true">
          {value.toFixed(2)}
        </output>
      </div>

      <p className="param__note">{PARAMETER_NOTES.temperature.body}</p>

      <input
        id={id}
        className="param__slider"
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <div className="param__scale" aria-hidden="true">
        <span>0 · repeatable</span>
        <span>1 · natural</span>
        <span>2 · erratic</span>
      </div>

      <p className="param__band" id={describedBy}>
        <span
          className={
            value > 1.3 ? "param__badge param__badge--warn" : "param__badge"
          }
        >
          {band.name}
        </span>
        <span className="param__band-text">{band.detail}</span>
      </p>

      {error ? (
        <span className="param__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* =========================================================
   MAX TOKENS

   Tokens are an abstraction a learner has no feel for yet, so
   the cap is always shown twice: once in the unit the API
   speaks, and once in words, which is the unit they can
   picture. Roughly three-quarters of a word per token for
   ordinary English prose — the same rough figure the estimator
   uses in the other direction.
========================================================= */

function approximateWords(tokens: number): string {
  return Math.round(tokens * 0.75).toLocaleString();
}

function MaxTokens({
  value,
  model,
  error,
  disabled,
  onChange,
}: {
  value: number;
  model: AiModel | undefined;
  error?: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const describedBy = `${id}-desc`;

  const ceiling = model?.maxOutputTokens ?? 1024;

  /* Presets that differ in kind — a sentence, a paragraph, an
     essay — rather than evenly spaced numbers. */
  const presets = [128, 512, 1024, 2048].filter((preset) => preset <= ceiling);

  if (!presets.includes(ceiling)) {
    presets.push(ceiling);
  }

  return (
    <div className="param">
      <div className="param__head">
        <label className="param__label" htmlFor={id}>
          Max Tokens
        </label>

        <output className="param__value" htmlFor={id} aria-hidden="true">
          {value.toLocaleString()}
        </output>
      </div>

      <p className="param__note">{PARAMETER_NOTES.maxOutputTokens.body}</p>

      <input
        id={id}
        className="param__slider"
        type="range"
        min={16}
        max={ceiling}
        step={16}
        value={Math.min(value, ceiling)}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <div className="param__presets">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={
              value === preset ? "param__chip param__chip--on" : "param__chip"
            }
            aria-pressed={value === preset}
            disabled={disabled}
            onClick={() => onChange(preset)}
          >
            {preset.toLocaleString()}
          </button>
        ))}
      </div>

      <p className="param__band" id={describedBy}>
        <span className="param__band-text">
          About {approximateWords(value)} words of English at most.
          {model
            ? ` ${model.displayName} allows up to ${ceiling.toLocaleString()} here.`
            : null}
        </span>
      </p>

      {error ? (
        <span className="param__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* =========================================================
   STOP SEQUENCES
========================================================= */

function StopSequences({
  value,
  error,
  disabled,
  onChange,
}: {
  value: string[];
  error?: string;
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const full = value.length >= 4;

  function add() {
    const entry = draft.trim();

    if (!entry || full || value.includes(entry)) {
      setDraft("");
      return;
    }

    onChange([...value, entry]);
    setDraft("");
  }

  return (
    <div className="param">
      <div className="param__head">
        <label className="param__label" htmlFor={id}>
          Stop Sequences
        </label>
        <span className="param__value" aria-hidden="true">
          {value.length} / 4
        </span>
      </div>

      <p className="param__note">{PARAMETER_NOTES.stop.body}</p>

      {value.length > 0 ? (
        <ul className="stoplist">
          {value.map((entry) => (
            <li key={entry} className="stoplist__item">
              <code>{entry}</code>

              <button
                type="button"
                className="stoplist__remove"
                disabled={disabled}
                aria-label={`Remove stop sequence ${entry}`}
                onClick={() => onChange(value.filter((item) => item !== entry))}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="param__add">
        <input
          id={id}
          className="param__text"
          value={draft}
          placeholder={full ? "Four is the maximum" : "e.g. \\n\\n or END"}
          disabled={disabled || full}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              /* Inside a form this would submit it. */
              event.preventDefault();
              add();
            }
          }}
        />

        <button
          type="button"
          className="param__addbtn"
          disabled={disabled || full || draft.trim() === ""}
          onClick={add}
        >
          <Plus size={14} aria-hidden="true" />
          <span className="sr-only">Add stop sequence</span>
        </button>
      </div>

      {error ? (
        <span className="param__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
