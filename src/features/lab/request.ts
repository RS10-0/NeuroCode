import type {
  AiChatRequest,
  AiModel,
  AiRequestLimits,
  AiLimits,
} from "../../lib/aiClient";
import type { LabSettings } from "./types";

/*
 * Turning what is on screen into what goes on the wire — and
 * showing the learner both.
 *
 * The Lab's most useful trick is that the request is not hidden.
 * A prompt is not a message typed at a machine; it is a
 * structured payload with a system field, a message array, a
 * model id and a set of generation parameters, and every one of
 * those has a visible effect. So the same function that builds
 * the request builds the preview, and there is no chance of the
 * preview describing something other than what was sent.
 */

/* =========================================================
   TOKEN ARITHMETIC

   Mirrors server/src/ai/tokens.ts on purpose, including its
   inaccuracy. The point of showing an estimate before a run is
   to make the relationship between text length and cost
   visible, and then to show the provider's real count next to
   it afterwards — a browser-side estimate that disagreed with
   the server's would teach the wrong lesson twice.
========================================================= */

const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD_CHARS = 8;

export function countInputChars(settings: LabSettings): number {
  const system = settings.system.trim() ? settings.system.length : 0;
  return system + settings.prompt.length + PER_MESSAGE_OVERHEAD_CHARS;
}

export function estimateTokens(chars: number): number {
  return chars <= 0 ? 0 : Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateInputTokens(settings: LabSettings): number {
  return estimateTokens(countInputChars(settings));
}

/* =========================================================
   BUILDING THE REQUEST
========================================================= */

/*
 * The exact body the browser will POST.
 *
 * Empty system instructions are dropped rather than sent as an
 * empty string — the server would ignore them either way, but a
 * preview showing `"system": ""` implies the model was handed
 * something, and it was not.
 */
export function buildRequest(settings: LabSettings): AiChatRequest {
  const system = settings.system.trim();
  const stop = settings.stop.filter((entry) => entry.length > 0);

  return {
    messages: [{ role: "user", content: settings.prompt }],
    ...(system ? { system: settings.system } : {}),
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    ...(stop.length ? { stop } : {}),
    feature: "lab",
  };
}

/*
 * The preview.
 *
 * `stream: true` is added because the transport adds it, and a
 * preview that omitted it would be a slightly different request
 * from the real one.
 */
export function previewJson(settings: LabSettings): string {
  return JSON.stringify({ ...buildRequest(settings), stream: true }, null, 2);
}

/* =========================================================
   VALIDATION

   The server is the authority and re-checks all of this. What
   the browser adds is timing: a learner who has typed 9,000
   characters of system instructions should be told before they
   press Run, next to the field that is wrong, rather than after
   a round trip in a red box at the bottom of the page.

   Every rule below mirrors one in server/src/ai/validation.ts.
========================================================= */

export type LabField = "system" | "prompt" | "temperature" | "maxOutputTokens" | "stop";

export type LabErrors = Partial<Record<LabField, string>>;

export function validate(
  settings: LabSettings,
  model: AiModel | undefined,
  limits: AiLimits | undefined,
  requestLimits: AiRequestLimits | undefined
): LabErrors {
  const errors: LabErrors = {};

  /* ----- prompt ----- */

  if (settings.prompt.trim() === "") {
    errors.prompt = "Write a prompt to run.";
  } else if (
    requestLimits &&
    settings.prompt.length > requestLimits.maxMessageChars
  ) {
    errors.prompt = `${settings.prompt.length.toLocaleString()} characters. The limit is ${requestLimits.maxMessageChars.toLocaleString()}.`;
  }

  /* ----- system ----- */

  if (
    requestLimits &&
    settings.system.length > requestLimits.maxSystemChars
  ) {
    errors.system = `${settings.system.length.toLocaleString()} characters. The limit is ${requestLimits.maxSystemChars.toLocaleString()}.`;
  }

  /*
   * The combined ceiling, which is a separate limit from either
   * field's own — two individually legal fields can still be too
   * much together, and that is exactly the case a learner cannot
   * work out for themselves.
   */
  if (!errors.prompt && !errors.system && limits && limits.maxInputChars > 0) {
    const chars = countInputChars(settings);

    if (chars > limits.maxInputChars) {
      errors.prompt = `System instructions and prompt come to ${chars.toLocaleString()} characters together. The limit is ${limits.maxInputChars.toLocaleString()}.`;
    }
  }

  /* ----- temperature ----- */

  if (!Number.isFinite(settings.temperature)) {
    errors.temperature = "Temperature must be a number.";
  } else if (settings.temperature < 0 || settings.temperature > 2) {
    errors.temperature = "Temperature must be between 0 and 2.";
  }

  /* ----- max output tokens ----- */

  if (!Number.isInteger(settings.maxOutputTokens)) {
    errors.maxOutputTokens = "Max output tokens must be a whole number.";
  } else if (settings.maxOutputTokens < 1) {
    errors.maxOutputTokens = "Max output tokens must be at least 1.";
  } else if (model && settings.maxOutputTokens > model.maxOutputTokens) {
    errors.maxOutputTokens = `${model.displayName} allows at most ${model.maxOutputTokens.toLocaleString()} output tokens here.`;
  }

  /* ----- stop sequences ----- */

  if (settings.stop.length > 4) {
    errors.stop = "At most 4 stop sequences.";
  }

  return errors;
}

export function hasErrors(errors: LabErrors): boolean {
  return Object.keys(errors).length > 0;
}
