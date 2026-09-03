/*
 * Server-Sent Events reader, shared by every streaming adapter.
 *
 * Written against the event grammar rather than assuming one
 * JSON object per line, because neither provider guarantees
 * that: OpenRouter emits `: OPENROUTER PROCESSING` keepalive
 * comments between chunks, and a payload may legally be split
 * across several `data:` lines. A naive line-by-line JSON.parse
 * trips on both.
 *
 * Yields the `data:` payload of each event, with comments and
 * other fields discarded.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let dataLines: string[] = [];

  try {
    while (true) {
      if (signal.aborted) {
        return;
      }

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");

      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);

        if (line === "") {
          /* End of one event. */
          if (dataLines.length > 0) {
            yield dataLines.join("\n");
            dataLines = [];
          }
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
        /* Comments (": ...") and other fields are ignored. */

        newline = buffer.indexOf("\n");
      }
    }

    /* A final event with no trailing blank line. */
    if (dataLines.length > 0) {
      yield dataLines.join("\n");
    }
  } finally {
    /*
     * Releasing the lock and cancelling matters on the abort
     * path: without it the socket stays open after the learner
     * has pressed stop, and the provider keeps billing for
     * tokens nobody will ever see.
     */
    try {
      await reader.cancel();
    } catch {
      /* Already closed. */
    }

    reader.releaseLock();
  }
}
