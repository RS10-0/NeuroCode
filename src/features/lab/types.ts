import type {
  AiDoneInfo,
  AiErrorCode,
  AiStartInfo,
} from "../../lib/aiClient";

/*
 * The Lab's own shapes.
 *
 * None of this is a wire format. Everything here lives in the
 * browser tab and nothing here is posted anywhere: the runtime
 * receives a chat request built from `LabSettings` and answers
 * with events, and the record kept below is the Lab's own
 * bookkeeping so a learner can compare two runs.
 *
 * That distinction is the whole privacy position. `ai_usage` on
 * the server records that a request happened, what it cost and
 * whether it worked — never the prompt and never the answer.
 * The prompt and the answer exist here, in one tab, for as long
 * as that tab is open.
 */

/*
 * Everything a learner can change, in one object.
 *
 * Kept as a single value rather than eight pieces of state
 * because the Lab's central idea is comparing one run against
 * another — and "what changed between these two runs" is a
 * function of two of these, which is only easy to write if a run
 * IS one of these.
 */
export interface LabSettings {
  /*
   * No `model` and no `powerSource`.
   *
   * Both used to be here and both were things a learner picked.
   * Neither is any more: BuildGentic routes each request across
   * its own providers, so there is one AI, one bill payer, and
   * nothing to choose between. What is left is the four settings
   * that actually change what comes back.
   */
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  stop: string[];
}

/* What a finished run is worth remembering. */
export interface LabRun {
  id: string;
  /* Epoch ms. Rendered as a relative time. */
  at: number;

  /*
   * The settings as they were when Run was pressed, not as they
   * are now. A history entry that followed the live composer
   * would make every past run look like the current one.
   */
  settings: LabSettings;

  /* The model that actually answered, which is not necessarily
     the one requested — the server may have applied a default. */
  start: AiStartInfo | null;
  done: AiDoneInfo | null;
  error: { code: AiErrorCode; message: string } | null;

  output: string;
  /* True when `output` was shortened to fit the history budget. */
  truncated: boolean;

  /*
   * Time to the first character, measured in the browser. Not
   * the same as `done.latencyMs`, which the server measures
   * across the whole request — and the gap between them is one
   * of the more interesting things the Lab can show.
   */
  firstTokenMs: number | null;

  /* The Lab's own pre-flight estimate, kept so it can be shown
     next to whatever the provider went on to report. */
  estimatedInputTokens: number;
}

/* One field that differs between two runs. */
export interface SettingChange {
  field: keyof LabSettings;
  label: string;
  from: string;
  to: string;
}

const FIELD_LABELS: Record<keyof LabSettings, string> = {
  system: "System instructions",
  prompt: "Prompt",
  temperature: "Temperature",
  maxOutputTokens: "Max output tokens",
  stop: "Stop sequences",
};

function render(field: keyof LabSettings, settings: LabSettings): string {
  const value = settings[field];

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "none";
  }

  if (typeof value === "string") {
    return value.trim() === "" ? "empty" : value;
  }

  return String(value);
}

/*
 * What moved between two runs.
 *
 * The lede on this page promises "change an instruction, run it
 * again, and see exactly what moved" — this is the function that
 * has to be able to answer it. Long text is compared whole and
 * summarised rather than diffed word by word: the useful signal
 * is "the system instructions changed", not which article was
 * swapped.
 */
export function diffSettings(
  previous: LabSettings,
  next: LabSettings
): SettingChange[] {
  const fields = Object.keys(FIELD_LABELS) as Array<keyof LabSettings>;

  return fields.flatMap((field) => {
    const from = render(field, previous);
    const to = render(field, next);

    if (from === to) {
      return [];
    }

    return [{ field, label: FIELD_LABELS[field], from, to }];
  });
}

/*
 * A long value, shortened for a one-line summary.
 *
 * Applied at render time rather than when the change is
 * computed, so the full text stays available to anything that
 * wants it.
 */
export function abbreviate(value: string, max = 42): string {
  const collapsed = value.replace(/\s+/g, " ").trim();

  if (collapsed.length <= max) {
    return collapsed;
  }

  return `${collapsed.slice(0, max - 1)}…`;
}
