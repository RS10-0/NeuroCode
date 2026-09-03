import { fileAnalysis } from "./config";
import type { ChatMessage, TokenUsage } from "./types";

/*
 * Token arithmetic, approximate on purpose.
 *
 * Running a real tokenizer server-side would mean shipping one
 * per model family and keeping them in step with the providers.
 * Nothing here needs that precision: these numbers drive a usage
 * meter and a rough input ceiling, and where the exact count
 * matters — what actually gets recorded — the provider's own
 * figures are used instead, with `reported: true` marking which
 * is which.
 *
 * Four characters per token is the usual English approximation
 * and errs low on code and on non-Latin scripts. That is the
 * right direction to err: the hard input limit is counted in
 * characters, not in tokens, so an underestimate here can never
 * let an oversized request through.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  return estimateTokensFromChars(text.length);
}

/*
 * For streamed output, where the running character count is
 * known but the text itself is deliberately not kept.
 */
export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) {
    return 0;
  }

  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/*
 * The exact character cost of a request, which is what the input
 * limit is enforced against.
 *
 * Roles are counted too, at a flat few characters each: a
 * thousand empty messages is still a payload the provider has to
 * parse, and a limit that only counted content would wave it
 * through.
 */
const PER_MESSAGE_OVERHEAD_CHARS = 8;

/*
 * What an attached image counts as, in characters.
 *
 * An image has no character count, and its base64 length is not
 * the right number either — it would be hundreds of times the
 * cost the provider actually charges, and a single photograph
 * would blow through an input budget sized for prose.
 *
 * So it is charged at the configured token estimate, converted
 * back into this file's own currency. Approximate, like
 * everything else here, and deliberately generous: an image
 * that costs slightly less than we counted is a learner with a
 * little allowance left over, while one that costs more than we
 * counted is a bill nothing measured.
 *
 * The alternative — not counting images at all — would leave
 * them as the one part of a request no limit can see, which is
 * precisely the hole the runtime avoids by doing retrieval
 * before `admit` rather than after.
 */
function imageChars(messages: ChatMessage[]): number {
  let images = 0;

  for (const message of messages) {
    images += message.images?.length ?? 0;
  }

  return images * fileAnalysis.imageTokenEstimate * CHARS_PER_TOKEN;
}

export function countInputChars(
  messages: ChatMessage[],
  system?: string
): number {
  let total = system ? system.length : 0;

  for (const message of messages) {
    total += message.content.length + PER_MESSAGE_OVERHEAD_CHARS;
  }

  return total + imageChars(messages);
}

export function estimateInputTokens(
  messages: ChatMessage[],
  system?: string
): number {
  return Math.ceil(countInputChars(messages, system) / CHARS_PER_TOKEN);
}

/*
 * Falls back to estimates only for the halves the provider did
 * not report. A provider that gives prompt tokens but not
 * completion tokens should not cost us both numbers.
 */
export function resolveUsage(
  reported: Partial<TokenUsage> | undefined,
  fallback: { inputTokens: number; outputTokens: number }
): TokenUsage {
  const hasInput = typeof reported?.inputTokens === "number";
  const hasOutput = typeof reported?.outputTokens === "number";

  return {
    inputTokens: hasInput ? reported!.inputTokens! : fallback.inputTokens,
    outputTokens: hasOutput ? reported!.outputTokens! : fallback.outputTokens,
    reported: hasInput && hasOutput,
  };
}
