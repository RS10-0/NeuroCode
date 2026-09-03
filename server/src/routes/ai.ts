import { Router } from "express";
import type { Response } from "express";

import { requireUser } from "../lib/auth";
import { describeRuntimeFor, runChat } from "../ai/AiRuntime";
import { AiRuntimeError, statusFor, toErrorBody } from "../ai/errors";
import { resolvePowerSource } from "../ai/resolveChain";
import { snapshot } from "../ai/QuotaGuard";
import { platformBudget } from "../ai/config";
import { parseChatBody } from "../ai/validation";
import { getAgent, listKnowledge } from "../agents/AgentStore";
import { composeAgentSystem } from "../agents/composeAgentSystem";
import type { RuntimeStreamEvent } from "../ai/types";

export const aiRouter = Router();

/*
 * The AI runtime's HTTP surface.
 *
 * These routes are transport and nothing else: authenticate,
 * parse, hand to the runtime, translate events onto the wire.
 * No provider is named here, no key is read here, and no policy
 * decision is made here — that is the whole reason the runtime
 * exists as a layer rather than as a route handler.
 */

/* ---------------------------------------------------------
   ERROR REPLIES
   --------------------------------------------------------- */

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

/* ---------------------------------------------------------
   GET /api/ai/models

   What this learner can actually run: BuildGentic's own models,
   their own BYOK models if any, the limits on each, and how much
   of BuildGentic's platform budget remains.

   Contains no credential and no provider detail beyond a name.
   --------------------------------------------------------- */

aiRouter.get("/models", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    res.json(await describeRuntimeFor(user.id));
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/ai/usage

   Today's spend against today's limits, read from the same rows
   the quota gate counts — so what the meter shows and what the
   gate enforces can never drift apart.

   Takes no parameters. There used to be a `?powerSource=`
   selecting between BuildGentic's allowance and the learner's
   own-key one; there is one allowance now.
   --------------------------------------------------------- */

aiRouter.get("/usage", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const source = await resolvePowerSource(user.id);
    const used = await snapshot(source.quotaKey);

    res.json({
      limits: source.limits,
      used: {
        requestsThisMinute: used.usedMinute,
        requestsToday: used.usedDay,
        inFlight: used.inFlight,
        inputTokensToday: used.inputTokens,
        outputTokensToday: used.outputTokens,
        tokensToday: used.tokensToday,
      },
      /*
       * Published even to a BYOK caller. A learner deciding
       * whether to connect their own key deserves to see how
       * close BuildGentic's shared budget is to its ceiling.
       */
      platform: {
        budget: platformBudget,
        used: {
          requestsToday: used.platformDayRequests,
          tokensToday: used.platformDayTokens,
          requestsThisMonth: used.platformMonthRequests,
          tokensThisMonth: used.platformMonthTokens,
        },
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/ai/chat

   The runtime's one generation endpoint. Streams by default;
   `stream: false` returns a single JSON body for callers that
   cannot consume a stream.

   Streaming is Server-Sent Events rather than a websocket or a
   chunked JSON protocol: it is one-directional, which is all a
   completion needs, it survives proxies, and `fetch` can read it
   in the browser without a library.
   --------------------------------------------------------- */

aiRouter.post("/chat", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  let parsed;

  try {
    parsed = parseChatBody(req.body);
  } catch (error) {
    sendError(res, error);
    return;
  }

  /*
   * AN OFFICIAL AGENT IS COMPOSED HERE, NOT IN THE BROWSER.
   *
   * Every other agent's system prompt arrives in the body,
   * composed by src/features/agents/compose.ts from what is on
   * screen. That is safe and deliberate: it is the learner's
   * own configuration, and sending it means the Builder tests
   * exactly what it displays.
   *
   * BuildGentic's own agents are the one case where the browser
   * cannot do it, because the browser does not have the prompt
   * — see server/src/agents/flagshipPrompts.ts for why it must
   * not. So the server recomposes from the stored row, and the
   * body's `system` is discarded for these agents.
   *
   * Which also closes the obvious attack on the Library: a
   * request naming somebody's purchased Coding Coach cannot
   * smuggle its own instructions in, because whatever it sent
   * is thrown away and replaced from a row it does not control.
   *
   * `getAgent` filters on the verified user id, so a forged
   * agent id resolves to nothing and this does not fire.
   */
  if (parsed.agentId) {
    try {
      const agent = await getAgent(user.id, parsed.agentId);

      if (agent?.isOfficial) {
        const knowledge = await listKnowledge(user.id, parsed.agentId);

        parsed = {
          ...parsed,
          system: composeAgentSystem(agent, knowledge).text,
        };
      }
    } catch (error) {
      sendError(res, error);
      return;
    }
  }

  /*
   * Aborted when the socket closes. This is what turns a closed
   * browser tab into a cancelled provider request rather than
   * into tokens somebody pays for and nobody reads.
   */
  const clientGone = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone.abort();
    }
  });

  const stream = runChat({
    userId: user.id,
    body: parsed,
    signal: clientGone.signal,
    /*
     * Which attachments this caller may reach: their own, and
     * only their own. Resolved from the verified session rather
     * than from the body, so an id belonging to somebody else
     * does not resolve however it is asked for.
     */
    fileScope: { kind: "user", userId: user.id },
    /*
     * Whose memory this turn may read and add to: this
     * learner's, with this one agent.
     *
     * Both halves come from somewhere the caller cannot forge
     * the meaning of. The user id is the verified session. The
     * agent id IS off the body — and it is safe there for the
     * reason `knowledgeRetrieval` is safe there: every query
     * behind this scope filters on the user id as well, so the
     * most a forged agent id achieves is reading the memories
     * of an agent the forger already owns.
     *
     * Absent when the body names no agent, which is exactly
     * what an unsaved draft looks like. The runtime reports
     * that as `no_agent` rather than silently doing nothing,
     * because memories hang off an agent — `User -> Agent ->
     * Memories` — and "save this first" is a state a learner
     * can fix.
     */
    ...(parsed.agentId
      ? {
          memoryScope: {
            kind: "owner" as const,
            userId: user.id,
            agentId: parsed.agentId,
          },
        }
      : {}),
  });

  if (!parsed.stream) {
    await respondWhole(res, stream);
    return;
  }

  await respondStreaming(res, stream, clientGone);
});

/* ---------------------------------------------------------
   SSE
   --------------------------------------------------------- */

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function respondStreaming(
  res: Response,
  stream: AsyncGenerator<RuntimeStreamEvent>,
  clientGone: AbortController
): Promise<void> {
  /*
   * The failure mode this guards against is a request that has
   * already begun streaming and then fails. Status and headers
   * are gone by then, so the error cannot be an HTTP status —
   * it has to be an event in the stream, and the client has to
   * know that a stream which ends without `done` failed.
   */
  let headersSent = false;

  try {
    for await (const event of stream) {
      if (!headersSent) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        /* `no-transform` matters as much as `no-cache`: a proxy
           that helpfully gzips this would buffer it, and a
           buffered stream is not a stream. */
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        /* nginx buffers proxied responses by default. */
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        headersSent = true;
      }

      writeEvent(res, event.type, event);

      if (clientGone.signal.aborted) {
        break;
      }
    }

    res.end();
  } catch (error) {
    const body = toErrorBody(error);

    if (!headersSent) {
      /* Nothing has been written yet, so this can still be an
         honest HTTP status. */
      sendError(res, error);
      return;
    }

    if (error instanceof AiRuntimeError && error.code === "cancelled") {
      /* The client hung up. There is nobody left to tell. */
      res.end();
      return;
    }

    writeEvent(res, "error", body);
    res.end();
  }
}

/* ---------------------------------------------------------
   NON-STREAMING

   Same runtime, same quota, same usage row — the deltas are
   simply joined before anything is sent. Kept because scripts
   and server-to-server callers should not have to parse SSE to
   ask one question.
   --------------------------------------------------------- */

async function respondWhole(
  res: Response,
  stream: AsyncGenerator<RuntimeStreamEvent>
): Promise<void> {
  try {
    let text = "";
    let done: Extract<RuntimeStreamEvent, { type: "done" }> | null = null;

    for await (const event of stream) {
      if (event.type === "delta") {
        text += event.text;
      } else if (event.type === "done") {
        done = event;
      }
      /* `retrieval` has nowhere to go in a single JSON body and
         is dropped. The streaming path carries it; a caller that
         wants to know what the agent looked up asks for a
         stream, which is what the Builder does. */
    }

    /*
     * No `model`, no `provider`, no `powerSource`.
     *
     * All three used to ride out on this body, and all three
     * named the vendor that answered — which under the cascade
     * is whichever one happened to be free, and is the single
     * fact the routing exists to keep private. A learner is
     * talking to BuildGentic; there is nothing else to report.
     */
    res.json({
      text,
      finishReason: done?.finishReason ?? "stop",
      usage: done?.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        reported: false,
      },
      latencyMs: done?.latencyMs ?? 0,
    });
  } catch (error) {
    sendError(res, error);
  }
}
