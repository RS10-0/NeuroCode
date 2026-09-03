import { useCallback, useRef, useState } from "react";

import { SiteError, visitorKey } from "../publicApi";

/*
 * A stranger's conversation with a student's agent.
 *
 * The transcript lives in a ref as well as in state, and the
 * ref is the authority — the same arrangement, for the same
 * reason, as `useAgentChat` in features/agents: a send has to
 * read the history synchronously in order to build its request,
 * and a state updater has not run yet when it does.
 *
 * What is NOT here is the interesting part. There is no model,
 * no temperature, no system prompt, no capability flag and no
 * agent id. A visitor sends turns and nothing else; everything
 * about how the agent behaves is resolved on the server from
 * the stored row, exactly as `deploymentRequest.ts` does it for
 * the API. A page cannot configure the agent it is a page for,
 * which is what stops "edit the site" from ever becoming "edit
 * the agent".
 */

export interface SiteTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /* Set on an assistant turn that failed. The turn is kept so
     the question stays on screen with what happened to it. */
  failed: boolean;
}

export type SitePhase = "idle" | "sending" | "error";

interface SendPayload {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  visitorKey?: string;
}

let turnCounter = 0;

function newTurnId(): string {
  turnCounter += 1;

  return `t${turnCounter}`;
}

/*
 * How much history goes back with each turn.
 *
 * The server caps this too, and its cap is the one that
 * matters. Trimming here as well keeps a long conversation from
 * being rejected wholesale once it crosses the line — the
 * visitor loses the oldest turns instead of being told their
 * message is too big, which is not a thing they did.
 */
const MAX_HISTORY_TURNS = 20;

export function useSiteChat(slug: string, greeting: string) {
  /*
   * The greeting is a turn that was never generated. It costs
   * nothing, it is not sent back as history, and it is what
   * stops a page opening on an empty box.
   */
  const [turns, setTurns] = useState<SiteTurn[]>(() =>
    greeting ? [{ id: "greeting", role: "assistant", content: greeting, failed: false }] : []
  );

  const [phase, setPhase] = useState<SitePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const historyRef = useRef<SiteTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();

      if (!question || phase === "sending") {
        return;
      }

      const userTurn: SiteTurn = {
        id: newTurnId(),
        role: "user",
        content: question,
        failed: false,
      };

      const answerTurn: SiteTurn = {
        id: newTurnId(),
        role: "assistant",
        content: "",
        failed: false,
      };

      /* The greeting is excluded deliberately: sending it back
         would have the agent reading its own scripted opener as
         something it said, and answering accordingly. */
      const history = [...historyRef.current, userTurn].slice(-MAX_HISTORY_TURNS);

      historyRef.current = history;

      setTurns((current) => [...current, userTurn, answerTurn]);
      setPhase("sending");
      setError(null);

      const controller = new AbortController();

      abortRef.current = controller;

      const payload: SendPayload = {
        messages: history.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
      };

      /*
       * Only sent when the agent actually has memory — the
       * server ignores it otherwise, but there is no reason to
       * hand over an identifier that will not be used. See
       * `visitorKey` for why this exists at all.
       */
      const visitor = visitorKey(slug);

      if (visitor) {
        payload.visitorKey = visitor;
      }

      let text_ = "";

      const write = (chunk: string) => {
        text_ += chunk;

        setTurns((current) =>
          current.map((turn) =>
            turn.id === answerTurn.id ? { ...turn, content: text_ } : turn
          )
        );
      };

      try {
        await streamSiteChat(slug, payload, write, controller.signal);

        historyRef.current = [
          ...history,
          { ...answerTurn, content: text_ },
        ].slice(-MAX_HISTORY_TURNS);

        setPhase("idle");
      } catch (failure) {
        const message =
          failure instanceof SiteError
            ? failure.message
            : "The connection dropped. Try again.";

        const cancelled = controller.signal.aborted;

        /*
         * A cancelled turn keeps whatever text arrived and is
         * not an error; anything else replaces an empty answer
         * with the reason. A partial answer that then failed
         * keeps its text and is marked, because deleting words
         * somebody has already read is worse than showing them
         * the answer stopped.
         */
        setTurns((current) =>
          current.map((turn) =>
            turn.id === answerTurn.id
              ? {
                  ...turn,
                  content: cancelled
                    ? turn.content
                    : turn.content || message,
                  failed: !cancelled,
                }
              : turn
          )
        );

        /* The failed answer is not kept as history — the agent
           should not see its own error message as something it
           said — but the question is, so a retry has context. */
        historyRef.current = history;

        if (!cancelled) {
          setError(message);
          setPhase("error");
        } else {
          setPhase("idle");
        }
      } finally {
        abortRef.current = null;
      }
    },
    [phase, slug]
  );

  return { turns, phase, error, send, stop };
}

/* =========================================================
   THE STREAM

   A trimmed copy of the SSE reader in lib/aiClient.ts rather
   than a call into it, because that one attaches a session
   token and this endpoint must be reachable without one. The
   wire format is identical — the server writes both — so the
   parsing is the same; what differs is that this reader knows
   about exactly three events, because three is all a visitor
   is sent.
========================================================= */

async function streamSiteChat(
  slug: string,
  payload: SendPayload,
  onDelta: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`/api/sites/${encodeURIComponent(slug)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, stream: true }),
      signal,
    });
  } catch {
    if (signal.aborted) {
      throw new SiteError("Stopped.", 0, "cancelled");
    }

    throw new SiteError(
      "Could not reach this agent. Check your connection and try again.",
      0,
      "network"
    );
  }

  if (!response.ok) {
    let body: { error?: string; code?: string } = {};

    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* Non-JSON body from a proxy rather than this API. */
    }

    throw new SiteError(
      body.error ?? "This agent is not available right now.",
      response.status,
      body.code ?? "unavailable"
    );
  }

  if (!response.body) {
    throw new SiteError("The answer could not be read.", 0, "connection_lost");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let finished = false;
  let streamError: SiteError | null = null;

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }

    const raw = dataLines.join("\n");
    dataLines = [];

    const name = eventName;
    eventName = "";

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      streamError = new SiteError(
        "The answer could not be read.",
        0,
        "malformed"
      );
      return;
    }

    if (name === "delta") {
      onDelta((parsed as { text: string }).text);
    } else if (name === "done") {
      finished = true;
    } else if (name === "error") {
      const body = parsed as { error?: string; code?: string };

      streamError = new SiteError(
        body.error ?? "This agent could not answer.",
        0,
        body.code ?? "unavailable"
      );
    }
    /* Any other event name is ignored on purpose: the server
       may add one, and a tab left open should keep working. */
  };

  try {
    for (;;) {
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
          dispatch();
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }

        newline = buffer.indexOf("\n");
      }

      if (streamError) {
        break;
      }
    }

    /* A final event with no trailing blank line. */
    if (!streamError && dataLines.length > 0) {
      dispatch();
    }
  } catch {
    if (signal.aborted) {
      throw new SiteError("Stopped.", 0, "cancelled");
    }

    throw new SiteError(
      "The connection dropped while the agent was answering.",
      0,
      "connection_lost"
    );
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* Already closed. */
    }
  }

  if (streamError) {
    throw streamError;
  }

  if (!finished) {
    /* The stream ended without saying it was done. Whatever is
       on screen is real but incomplete, and calling it finished
       would be a claim the UI cannot take back. */
    throw new SiteError(
      "The answer stopped partway through. Try again.",
      0,
      "connection_lost"
    );
  }
}
