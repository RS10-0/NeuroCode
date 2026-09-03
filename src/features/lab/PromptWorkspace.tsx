import { useId } from "react";
import { CircleStop, Play, Sparkles } from "lucide-react";

import type { AiRequestLimits } from "../../lib/aiClient";
import { LAB_PRESETS, type LabPreset } from "./presets";
import type { LabErrors } from "./request";
import type { LabSettings } from "./types";

/*
 * The two things a learner writes.
 *
 * Given equal weight, side by side, because they are not a
 * prompt and its settings — they are two halves of one input,
 * and which half a change belongs in is most of what there is
 * to learn here. A chat window puts the prompt front and centre
 * and hides the system field behind a gear, which quietly
 * teaches that the prompt is the whole of the request. It is
 * not.
 *
 * Each card carries one sentence about what its field actually
 * does to the model. One sentence, in the card, in the same
 * type as everything else — not a help icon, not a tooltip, and
 * not three paragraphs that turn a workspace into documentation.
 */

/*
 * ⌘ on a Mac, Ctrl everywhere else.
 *
 * Read once at module load rather than per render, and guarded
 * for a server-rendered or test environment with no navigator.
 * Showing a learner the wrong modifier is a small thing that
 * makes a page feel like it was built for somebody else.
 */
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const MOD_SYMBOL = IS_MAC ? "⌘" : "Ctrl";
const MOD_WORD = IS_MAC ? "Cmd" : "Ctrl";

interface PromptWorkspaceProps {
  settings: LabSettings;
  requestLimits: AiRequestLimits | undefined;
  errors: LabErrors;
  streaming: boolean;
  canRun: boolean;
  activePreset: LabPreset | null;
  onChange: (patch: Partial<LabSettings>) => void;
  onPreset: (preset: LabPreset) => void;
  onRun: () => void;
  onStop: () => void;
}

export default function PromptWorkspace({
  settings,
  requestLimits,
  errors,
  streaming,
  canRun,
  activePreset,
  onChange,
  onPreset,
  onRun,
  onStop,
}: PromptWorkspaceProps) {
  /*
   * Ctrl/Cmd+Enter runs from either card.
   *
   * Plain Enter must keep inserting a newline: prompts are
   * multi-line far more often than they are one-liners, and a
   * playground that fires a billable request on a stray Enter
   * is a playground people stop trusting.
   */
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();

      if (canRun) {
        onRun();
      }
    }
  }

  return (
    <section className="workspace" aria-labelledby="workspace-heading">
      <h2 className="sr-only" id="workspace-heading">
        Prompt workspace
      </h2>

      <Starters active={activePreset} disabled={streaming} onPick={onPreset} />

      <div className="workspace__cards">
        <PromptCard
          index="01"
          label="System Instructions"
          blurb="Standing rules the model is given before it ever sees your prompt — who it is, how to answer, what to refuse. Sent in its own field, not as part of the conversation."
          value={settings.system}
          error={errors.system}
          limit={requestLimits?.maxSystemChars}
          rows={7}
          optional
          placeholder="You are a patient tutor. Answer in two short sentences, and never use an analogy."
          disabled={streaming}
          onKeyDown={handleKeyDown}
          onChange={(system) => onChange({ system })}
        />

        <PromptCard
          index="02"
          label="User Prompt"
          blurb="The one user message in this request. Every run sends a single turn, so nothing from your last experiment is carried over — which is what makes two runs comparable."
          value={settings.prompt}
          error={errors.prompt}
          limit={requestLimits?.maxMessageChars}
          rows={7}
          placeholder="Explain why a language model can sound confident when it is wrong."
          disabled={streaming}
          onKeyDown={handleKeyDown}
          onChange={(prompt) => onChange({ prompt })}
        />
      </div>

      <div className="workspace__launch">
        {streaming ? (
          <button
            type="button"
            className="runbtn runbtn--stop"
            onClick={onStop}
          >
            <CircleStop size={18} aria-hidden="true" />
            Stop Generating
          </button>
        ) : (
          <button
            type="button"
            className="runbtn"
            disabled={!canRun}
            onClick={onRun}
          >
            <Play size={17} aria-hidden="true" />
            Run Experiment
            <kbd className="runbtn__kbd" aria-hidden="true">
              {MOD_SYMBOL} ⏎
            </kbd>
          </button>
        )}

        <p className="workspace__shortcut">
          {streaming ? (
            "Stopping aborts the request at the provider, so the rest is never generated and never billed."
          ) : (
            <>
              Press{" "}
              <kbd className="kbd">{MOD_WORD}</kbd>
              <span aria-hidden="true"> + </span>
              <kbd className="kbd">Enter</kbd> from either card. Plain{" "}
              <kbd className="kbd">Enter</kbd> makes a new line.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/* =========================================================
   ONE CARD
========================================================= */

interface PromptCardProps {
  index: string;
  label: string;
  blurb: string;
  value: string;
  error?: string;
  limit: number | undefined;
  rows: number;
  optional?: boolean;
  placeholder: string;
  disabled: boolean;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onChange: (value: string) => void;
}

function PromptCard({
  index,
  label,
  blurb,
  value,
  error,
  limit,
  rows,
  optional = false,
  placeholder,
  disabled,
  onKeyDown,
  onChange,
}: PromptCardProps) {
  const id = useId();
  const blurbId = `${id}-blurb`;
  const errorId = `${id}-error`;

  const ratio = limit ? value.length / limit : 0;
  const countTone = ratio >= 1 ? " promptcard__count--over" : ratio >= 0.85 ? " promptcard__count--near" : "";

  return (
    <div className={error ? "promptcard promptcard--invalid" : "promptcard"}>
      <div className="promptcard__head">
        <span className="promptcard__index" aria-hidden="true">
          {index}
        </span>

        <label className="promptcard__label" htmlFor={id}>
          {label}
        </label>

        {optional ? (
          <span className="promptcard__optional">Optional</span>
        ) : null}
      </div>

      <p className="promptcard__blurb" id={blurbId}>
        {blurb}
      </p>

      <textarea
        id={id}
        className="promptcard__input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${blurbId} ${errorId}` : blurbId}
        onKeyDown={onKeyDown}
        onChange={(event) => onChange(event.target.value)}
      />

      <div className="promptcard__foot">
        {error ? (
          /*
           * Not role="alert".
           *
           * "Write a prompt to run." is true from the moment the
           * page loads, and announcing it on arrival tells a
           * screen-reader user off for not having typed
           * anything yet. It is in aria-describedby instead, so
           * they hear it when they focus the field — which is
           * when it is useful.
           */
          <span className="promptcard__error" id={errorId}>
            {error}
          </span>
        ) : (
          <span />
        )}

        {limit ? (
          <span className={`promptcard__count${countTone}`}>
            <span className="sr-only">{label}: </span>
            {value.length.toLocaleString()}
            <span className="promptcard__count-limit">
              {" / "}
              {limit.toLocaleString()}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* =========================================================
   STARTERS

   An empty playground is a hard place to learn anything: a
   learner who does not yet know what temperature does also
   cannot invent the prompt that would show them. Each of these
   is built around one observation the run makes visible.
========================================================= */

function Starters({
  active,
  disabled,
  onPick,
}: {
  active: LabPreset | null;
  disabled: boolean;
  onPick: (preset: LabPreset) => void;
}) {
  return (
    <div className="starters">
      <div className="starters__row">
        <span className="starters__label" id="starters-label">
          <Sparkles size={13} aria-hidden="true" />
          Start from an experiment
        </span>

        <div
          className="starters__chips"
          role="group"
          aria-labelledby="starters-label"
        >
          {LAB_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={
                active?.id === preset.id
                  ? "starter starter--on"
                  : "starter"
              }
              aria-pressed={active?.id === preset.id}
              disabled={disabled}
              onClick={() => onPick(preset)}
            >
              {preset.title}
            </button>
          ))}
        </div>
      </div>

      {active ? (
        <p className="starters__question">{active.question}</p>
      ) : null}
    </div>
  );
}
