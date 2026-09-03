import { Router } from "express";
import type { Request, Response } from "express";

import { requireUser } from "../lib/auth";
import { runChat } from "../ai/AiRuntime";
import { AiRuntimeError, statusFor, toErrorBody } from "../ai/errors";
import { getAgent, listKnowledge } from "../agents/AgentStore";
import {
  authenticateExtension,
  listSessions,
  mintSession,
  revokeSession,
} from "../agents/extension/SessionStore";
import {
  getSettings,
  listEnabledAgentIds,
} from "../agents/extension/SettingsStore";
import { pageContextScopeOf } from "../agents/extension/AccountScope";
import {
  buildExtensionChat,
  ExtensionRequestError,
} from "../agents/extensionRequest";
import { supabase } from "../lib/supabase";
import type { RuntimeStreamEvent } from "../ai/types";

/*
 * The browser extension's HTTP surface.
 *
 * TWO AUTHENTICATION SCHEMES ON ONE ROUTER, and the split is
 * the security boundary rather than an inconsistency.
 *
 * `/session` is authenticated by a SUPABASE SESSION, because it
 * is called by the pairing page on buildgentic.com where the
 * learner is already signed in. It is the only route here that
 * a browser session can reach, and it is the only one that
 * mints anything.
 *
 * Everything else is authenticated by an `nlx_` EXTENSION
 * TOKEN. A Supabase JWT does not work on those routes, and an
 * `nlx_` token does not work anywhere else on this server —
 * `getAuthenticatedUser` verifies JWTs against Supabase and an
 * `nlx_` string is not one, so it resolves to nobody and gets a
 * 401. Two resolvers that do not know about each other is the
 * version of that rule a later refactor cannot quietly undo.
 *
 * WHY THIS MOUNTS BELOW THE CORS MIDDLEWARE, unlike the
 * deployment router. That router sits above CORS precisely so
 * no browser can call it cross-origin, because a deployment key
 * that works from a web page is a key sitting in JavaScript
 * anybody can read. This is the opposite case: the caller IS a
 * browser context, so it needs CORS headers — and the
 * protection is that the allowlist admits exactly one extension
 * origin rather than a wildcard.
 */

export const extensionRouter = Router();

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

/*
 * The `nlx_` resolver.
 *
 * Returns null when the response has already been sent, so
 * handlers just bail out — the shape `requireUser` uses, kept
 * identical so that the two are obviously siblings and neither
 * looks like the special case.
 */
async function requireExtension(
  req: Request,
  res: Response
): Promise<{ userId: string; sessionId: string } | null> {
  try {
    return await authenticateExtension(req.headers.authorization);
  } catch (error) {
    sendError(res, error);
    return null;
  }
}

/* ---------------------------------------------------------
   POST /api/extension/session

   Pairs a browser. Called by the pairing page at
   /extension/connect, with the learner's ordinary session,
   which is what makes this a confirmation rather than a second
   login.

   The response carries the plaintext token exactly once. The
   page hands it straight to the extension over
   `externally_connectable` and does not store it.
   --------------------------------------------------------- */

extensionRouter.post("/session", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const minted = await mintSession(user.id, req.body?.label);

    res.json({ session: minted.session, token: minted.token });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/extension/sessions
   DELETE /api/extension/sessions/:id

   The paired-devices list, and revocation. Session-authenticated
   rather than token-authenticated on purpose: this is a
   settings screen in the web app, and a browser should be able
   to revoke a DIFFERENT browser — including one whose token has
   been stolen, which is the case that matters.
   --------------------------------------------------------- */

extensionRouter.get("/sessions", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    res.json({ sessions: await listSessions(user.id) });
  } catch (error) {
    sendError(res, error);
  }
});

extensionRouter.delete("/sessions/:id", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const revoked = await revokeSession(user.id, req.params.id);

    if (!revoked) {
      res.status(404).json({ error: "No such connected browser." });
      return;
    }

    res.json({ revoked: true });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/extension/agents

   What the side panel lists.

   Only agents the owner has made extension-eligible, and only
   ones that are `ready` — the extension is a place to USE an
   agent, and a half-built draft answering badly in a side panel
   teaches the wrong lesson about what agents are.

   Carries the two switches so the panel knows whether to offer
   the "use this page" control, and the account scope so it can
   explain itself when it does not. Both are courtesies: the
   real gate is the server refusal in extensionRequest.ts,
   because a UI control is something a client can be modified
   not to respect.
   --------------------------------------------------------- */

extensionRouter.get("/agents", async (req, res) => {
  const caller = await requireExtension(req, res);

  if (!caller) {
    return;
  }

  try {
    const ids = await listEnabledAgentIds(caller.userId);

    if (ids.length === 0) {
      res.json({ agents: [], pageContextScope: "unknown" });
      return;
    }

    /*
     * Read through the service role with an explicit user-id
     * predicate, the rule every store in this project follows.
     * The id list already came from a table filtered on the
     * same user, so this is the second of two predicates rather
     * than the only one.
     */
    const { data, error } = await supabase
      .from("agents")
      .select("id, name, avatar_emoji, avatar_tone, description, status")
      .eq("user_id", caller.userId)
      .eq("status", "ready")
      .in("id", ids)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new AiRuntimeError("internal_error", "Unable to load your agents.", {
        internalDetail: `agents select failed: ${error.message}`,
      });
    }

    const settings = await Promise.all(
      ((data ?? []) as { id: string }[]).map((row) =>
        getSettings(caller.userId, row.id)
      )
    );

    const rows = (data ?? []) as {
      id: string;
      name: string;
      avatar_emoji: string;
      avatar_tone: string;
      description: string | null;
    }[];

    res.json({
      agents: rows.map((row, index) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        avatarEmoji: row.avatar_emoji,
        avatarTone: row.avatar_tone,
        pageContext: settings[index]?.extensionPageContext === true,
      })),
      /*
       * The account's scope, sent so the panel can say WHY the
       * page control is missing — "not available on this
       * account" and "not switched on for this agent" are
       * different sentences and only one of them is something
       * the learner can fix.
       */
      pageContextScope: await pageContextScopeOf(caller.userId),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/extension/chat

   The fourth door.

   Everything about what the agent may do is resolved here and
   in extensionRequest.ts, from stored rows, before the runtime
   is reached. The body describes the conversation and — at
   most — the page in front of the learner.
   --------------------------------------------------------- */

extensionRouter.post("/chat", async (req, res) => {
  const caller = await requireExtension(req, res);

  if (!caller) {
    return;
  }

  const agentId = req.body?.agentId;

  if (typeof agentId !== "string") {
    res.status(400).json({ error: "agentId is required." });
    return;
  }

  let built;

  try {
    /*
     * Filters on the verified user id, so a forged agent id
     * resolves to nothing — which is the only thing another
     * learner's id should ever look like.
     */
    const agent = await getAgent(caller.userId, agentId);

    const settings = agent
      ? await getSettings(caller.userId, agentId)
      : null;

    /*
     * A 404 rather than a 403, and the same 404 an agent that
     * does not exist gets.
     *
     * "This agent exists but is not enabled for the extension"
     * is a sentence worth saying in the Builder, where the
     * owner can act on it. Saying it here would mean the
     * extension's error messages differ depending on whether an
     * id names something real, which is a probe.
     */
    if (!agent || !settings?.extensionEnabled) {
      res.status(404).json({ error: "No such agent." });
      return;
    }

    const knowledge = await listKnowledge(caller.userId, agentId);

    /*
     * The account gate, resolved BEFORE the request is built
     * and passed in as a plain boolean — so extensionRequest.ts
     * stays synchronous and the whole capability-boundary suite
     * can run against it with no database at all.
     */
    const pageContextAllowed =
      (await pageContextScopeOf(caller.userId)) === "allowed";

    built = buildExtensionChat({
      userId: caller.userId,
      agent,
      knowledge,
      settings,
      pageContextAllowed,
      body: req.body,
    });
  } catch (error) {
    if (error instanceof ExtensionRequestError) {
      res.status(400).json({ error: error.message });
      return;
    }

    sendError(res, error);
    return;
  }

  const clientGone = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone.abort();
    }
  });

  const stream = runChat({
    userId: caller.userId,
    body: built.parsed,
    signal: clientGone.signal,
    /* Their own attachments and only their own, resolved from
       the verified token rather than from the body. */
    fileScope: { kind: "user", userId: caller.userId },
    ...(built.pageContext ? { pageContext: built.pageContext } : {}),
    /*
     * The owner's own memory drawer for this agent — the same
     * scope routes/ai.ts builds, because it is the same person
     * talking to the same agent. An extension turn and a Test
     * panel turn share a memory, which is correct: they are one
     * relationship, not two.
     */
    memoryScope: {
      kind: "owner" as const,
      userId: caller.userId,
      agentId: built.parsed.agentId as string,
    },
  });

  if (!built.stream) {
    await respondWhole(res, stream);
    return;
  }

  await respondStreaming(res, stream, clientGone);
});

/* ---------------------------------------------------------
   SSE

   The same shape routes/ai.ts writes, because the panel reads
   it with the same client code.
   --------------------------------------------------------- */

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function respondStreaming(
  res: Response,
  stream: AsyncGenerator<RuntimeStreamEvent>,
  clientGone: AbortController
): Promise<void> {
  let headersSent = false;

  try {
    for await (const event of stream) {
      if (!headersSent) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
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
      sendError(res, error);
      return;
    }

    if (error instanceof AiRuntimeError && error.code === "cancelled") {
      res.end();
      return;
    }

    writeEvent(res, "error", body);
    res.end();
  }
}

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
    }

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
