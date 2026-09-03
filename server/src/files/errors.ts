import { AiRuntimeError } from "../ai/errors";

/*
 * Refusing a file, in a sentence the person holding it can act
 * on.
 *
 * Every failure in this layer is `invalid_request` — the caller
 * sent a file, and something about that file is the problem —
 * so this is a helper rather than a second error type. What it
 * adds is the discipline of writing the message for a learner
 * rather than for a log: "that PDF has no text in it, it looks
 * like a scan" beats "extraction returned zero sections", and
 * the second one belongs in `internalDetail` where only the
 * server reads it.
 *
 * The rule the whole file layer follows: never echo the file's
 * contents back in an error. A parser failure message can carry
 * a fragment of the document, and a document may be private.
 * Sizes, counts, page numbers and format names are safe; bytes
 * are not.
 */
export function refuseFile(
  message: string,
  internalDetail?: string
): AiRuntimeError {
  return new AiRuntimeError("invalid_request", message, { internalDetail });
}

/*
 * A malformed file, described without quoting it.
 *
 * Every extractor funnels its parser's own exception through
 * here, so a corrupt upload produces a 400 a learner can read
 * rather than a 500 that looks like BuildGentic broke.
 */
export function malformed(
  name: string,
  format: string,
  cause: unknown
): AiRuntimeError {
  return refuseFile(
    `${name} could not be read as ${format}. It may be corrupt, password-protected, or not really ${format} despite its name.`,
    `${format} parse failed: ${
      cause instanceof Error ? cause.message : String(cause)
    }`
  );
}
