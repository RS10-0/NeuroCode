import { useEffect, useState } from "react";

/*
 * "This is taking a while" — not a cold-start detector.
 *
 * A free Render instance spun down from inactivity takes 50+
 * seconds to answer its next request, and every surface that
 * calls the backend used to show the same waiting state for that
 * as for an ordinary two-second answer: a bare caret, or a static
 * line that never changes. Nothing told a learner — or a stranger
 * on a published page — that anything unusual was happening, so a
 * cold start read as the app being broken.
 *
 * This hook does not know whether a slow request actually is a
 * cold start; the client has no way to know that for certain. It
 * only knows how long something has been pending, and that is
 * enough to be honest: past the point where it is plausibly
 * normal AI latency, say so.
 */

export const SLOW_REQUEST_DELAY_MS = 6000;

export function useSlowRequest(
  pending: boolean,
  delayMs: number = SLOW_REQUEST_DELAY_MS
): boolean {
  const [renderedPending, setRenderedPending] = useState(pending);
  const [slow, setSlow] = useState(false);

  /*
   * Reset during render, following the same "adjusting state
   * when a prop changes" pattern the React docs give — an
   * effect would still be correct, but it would commit one
   * frame with the previous request's `slow` value before
   * correcting itself.
   */
  if (pending !== renderedPending) {
    setRenderedPending(pending);
    setSlow(false);
  }

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timer = setTimeout(() => setSlow(true), delayMs);

    return () => clearTimeout(timer);
  }, [pending, delayMs]);

  return slow;
}
