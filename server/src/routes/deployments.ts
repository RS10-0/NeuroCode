import { Router } from "express";
import type { Response } from "express";

import { listKnowledge } from "../agents/AgentStore";
import {
  authenticateDeployment,
  markKeyUsed,
} from "../agents/DeploymentStore";
import {
  buildDeployedChat,
  DeploymentRequestError,
  toPublicError,
  type PublicErrorBody,
} from "../agents/deploymentRequest";
import { describe } from "../agents/files/context";
import { subjectFor } from "../agents/memory/scope";
import { runChat } from "../ai/AiRuntime";
import { deploymentLimits, fileAnalysis } from "../ai/config";
import { analyseFile } from "../files/FileAnalysisRuntime";
import { fileNameFromHeader } from "../files/sniff";
import type { RuntimeStreamEvent } from "../ai/types";

export const deploymentsRouter = Router();

/*
 * The endpoint an application outside BuildGentic calls.
 *
 * This is the only route in the project that answers a request
 * carrying no Supabase session. Everything that normally comes
 * from `requireUser` — who this is, whose quota to count, whose
 * provider key to spend — is instead resolved from a deployment
 * key, and every one of those facts comes off a database row
 * rather than out of the request.
 *
 * It is also the only route mounted ABOVE the CORS middleware in
 * index.ts, which is deliberate and is a security boundary
 * rather than an oversight. Sending no CORS headers means no
 * browser can call this cross-origin, which means a deployment
 * key has no reason to be in front-end code — and a deployment
 * key in front-end code is a deployment key published to the
 * world. Servers, scripts and CLIs are unaffected: they do not
 * enforce CORS because they were never the thing it protects.
 *
 * What this route does NOT do is as important as what it does.
 * It does not resolve a provider, hold a key, count a quota or
 * write a usage row. It builds a body and calls `runChat`, the
 * same function the Lab and the Builder call, so a deployed
 * request cannot skip a gate that a Lab request cannot skip.
 */

function sendError(res: Response, error: unknown): void {
  const { status, body } = toPublicError(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(status).json(body);
}

/* ---------------------------------------------------------
   POST /api/v1/agents/:publicId/chat
   --------------------------------------------------------- */

deploymentsRouter.post("/agents/:publicId/chat", async (req, res) => {
  let authenticated;

  try {
    /* Verifies the key, resolves the deployment, the agent and
       the owner, and refuses anything that is not currently
       serving. */
    authenticated = await authenticateDeployment(
      req.params.publicId,
      req.headers.authorization
    );
  } catch (error) {
    sendError(res, error);
    return;
  }

  const { agent, deployment, ownerId, keyId } = authenticated;

  let chat;

  try {
    /*
     * Read live rather than snapshotted at deploy time, so an
     * edit in the Builder reaches the endpoint immediately and
     * the thing the owner tested is the thing that answers.
     */
    const knowledge = await listKnowledge(ownerId, agent.id);

    chat = buildDeployedChat({
      authenticated,
      knowledge,
      body: req.body,
    });
  } catch (error) {
    sendError(res, error);
    return;
  }

  /* Same reasoning as /api/ai/chat: a hung-up caller becomes a
     cancelled provider request rather than tokens nobody reads. */
  const clientGone = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone.abort();
    }
  });

  const stream = runChat({
    /*
     * The owner. This single argument is what makes the whole
     * feature work without a second runtime: power source,
     * provider credentials, quota key and platform budget all
     * resolve to the learner who built the agent, exactly as
     * they do when that learner tests it in the Builder.
     */
    userId: ownerId,
    body: chat.parsed,
    signal: clientGone.signal,
    /*
     * The deployment's own ceiling, checked inside the same
     * atomic admission as everything else. Additional to the
     * owner's limits, never instead of them.
     */
    deployment: { id: deployment.id, limits: deploymentLimits },
    /*
     * The deployment's own scope, not the owner's.
     *
     * A caller may reach the files they uploaded through this
     * deployment and nothing else — not the owner's Builder
     * attachments, and not another deployment's. The owner
     * likewise cannot reach a caller's document from their own
     * Builder, which matters because a deployed agent's
     * attachments are somebody else's private documents that
     * happen to be paid for by the owner.
     */
    fileScope: {
      kind: "deployment",
      deploymentId: deployment.id,
      ownerId,
    },
    /*
     * The deployment's own memory, not the owner's.
     *
     * The same boundary `fileScope` draws, drawn for a sharper
     * reason. A caller may reach what this agent has remembered
     * through this deployment — and, if they sent a
     * `memoryKey`, only what it remembered about that end user.
     * They cannot reach what the owner told the agent while
     * building it, and the owner does not find a stranger's
     * statements about themselves in their own Test panel.
     *
     * Every one of these fields comes off a verified row or is
     * hashed under one. `agentId` and `ownerId` are inherited
     * from the deployment; the subject is the caller's own key
     * salted with the deployment id, so it cannot be made to
     * collide with another deployment's drawer.
     *
     * The rows are still written against the OWNER, who pays
     * for them, exactly as an answer and a file read are.
     */
    memoryScope: {
      kind: "deployment",
      deploymentId: deployment.id,
      agentId: agent.id,
      ownerId,
      subject: subjectFor(deployment.id, chat.memoryKey),
    },
  });

  const delivered = chat.stream
    ? await respondStreaming(res, stream, clientGone)
    : await respondWhole(res, stream);

  if (delivered) {
    await markKeyUsed(keyId);
  }
});

/* ---------------------------------------------------------
   POST /api/v1/agents/:publicId/files

   Uploads one file for a deployed agent to read.

   The same shape as the owner's route in files.ts — raw bytes,
   name in a header — and deliberately so: a caller who has
   already written the upload against their own account should
   not have to write it twice.

   What is different is everything about authorisation. There is
   no session, so the deployment key is what identifies the
   caller; the file is scoped to the deployment rather than to a
   person; and the capability comes off the stored agent, which
   is the only place it can honestly come from when the caller
   is not the owner.

   The billing is the point worth stating plainly: the usage row
   is written against the OWNER. An anonymous caller cannot be
   charged for anything, so a deployed agent's file analysis
   spends its owner's allowance, in the owner's windows, exactly
   as answering does.

   Uploads go through this authenticated endpoint rather than a
   browser-facing one for the reason this whole router sits
   above the CORS middleware: a deployment key that works from a
   web page is a deployment key sitting in JavaScript anybody
   can read.
   --------------------------------------------------------- */

deploymentsRouter.post("/agents/:publicId/files", async (req, res) => {
  let authenticated;

  try {
    authenticated = await authenticateDeployment(
      req.params.publicId,
      req.headers.authorization
    );
  } catch (error) {
    sendError(res, error);
    return;
  }

  const { agent, deployment, ownerId, keyId } = authenticated;

  try {
    if (!agent.capabilities.includes("file_analysis")) {
      /*
       * Refused rather than accepted and ignored, and phrased
       * for a caller who cannot see the agent's configuration:
       * they are told what this endpoint does not do, not what
       * its owner should switch on.
       */
      throw new DeploymentRequestError(
        "This agent does not accept file attachments."
      );
    }

    if (!Buffer.isBuffer(req.body)) {
      throw new DeploymentRequestError(
        "No file was sent. POST the file's bytes as the request body."
      );
    }

    const clientGone = new AbortController();

    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone.abort();
      }
    });

    const held = await analyseFile({
      scope: {
        kind: "deployment",
        deploymentId: deployment.id,
        ownerId,
      },
      name: fileNameFromHeader(headerOf(req.headers["x-file-name"])),
      declaredType: req.headers["content-type"],
      bytes: req.body,
      agentId: agent.id,
      signal: clientGone.signal,
    });

    await markKeyUsed(keyId);

    /*
     * A narrower summary than the owner gets. `id` is what the
     * caller needs in order to attach it; the counts say how
     * much of their own file was read, which is theirs to know.
     * What is absent is `latencyMs` and the truncation
     * mechanics of somebody else's prompt budget.
     */
    const file = describe(held);

    res.status(201).json({
      file: {
        id: file.id,
        name: file.name,
        kind: file.kind,
        bytes: file.bytes,
        chars: file.chars,
        truncated: file.truncated,
        ...(file.pages !== undefined ? { pages: file.pages } : {}),
        ...(file.sheets !== undefined ? { sheets: file.sheets } : {}),
        ...(file.rows !== undefined ? { rows: file.rows } : {}),
        ...(file.width !== undefined
          ? { width: file.width, height: file.height }
          : {}),
      },
      expiresInSeconds: Math.round(fileAnalysis.retentionMs / 1000),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   NON-STREAMING — the default here

   One JSON body, which is what a script, a backend, or a curl
   in a learner's terminal actually wants.

   The shape is deliberately small. `provider` and `powerSource`
   appear on the browser endpoint's response and are absent here:
   whether BuildGentic or the owner is paying, and which vendor is
   behind it, are facts about the owner's account.

   `model` WAS on that list of things a caller may know, on the
   grounds that they need to know what answered and that knowing
   it grants nothing. Both halves of that stopped being true
   when the cascade landed, and the reasoning is worth keeping
   rather than quietly deleting.

   It grants something now. models.ts collapsed the catalogue to
   a single public id and moved the concrete vendor model ids
   into providerChain.ts, server-side, precisely so that nothing
   in a response says which of four providers served a request.
   Echoing `model` back here would have reopened that from the
   one door where the caller is not the owner.

   And it answers nothing. The value would have been the same
   constant string on every call, for every agent, forever —
   a field whose only honest reading is "you are talking to
   BuildGentic", which the caller already knew.

   See the note beside `res.json` below, which is where the
   decision is enforced.
   --------------------------------------------------------- */

async function respondWhole(
  res: Response,
  stream: AsyncGenerator<RuntimeStreamEvent>
): Promise<boolean> {
  try {
    let reply = "";
    let done: Extract<RuntimeStreamEvent, { type: "done" }> | null = null;

    for await (const event of stream) {
      if (event.type === "delta") {
        reply += event.text;
      } else if (event.type === "done") {
        done = event;
      }
      /*
       * Everything else is dropped, and `retrieval`,
       * `web_search`, `memory` and `memory_write` are the
       * reason this is an explicit `done` branch rather than an
       * else. Which passages of the owner's knowledge answered
       * a question, what their agent typed into a search engine
       * to answer it, and what it has remembered about the
       * person asking all describe somebody else's
       * configuration and storage — in the same way the
       * provider and the power source do. The owner sees all of
       * it in the Builder; an external caller sees the answer.
       *
       * The two memory events are the ones it would be most
       * tempting to forward, and the most important not to. On
       * a deployment whose callers share a scope, "here is what
       * I remember about you" is a list assembled from what
       * OTHER callers said — so forwarding it would turn a
       * convenience into a way to read other people's
       * statements back out of somebody's agent.
       *
       * The citations inside the answer are a different matter
       * and are not stripped: a link the agent quoted is part
       * of what it said, and an answer that cites its sources
       * is more useful to a caller, not less.
       */
    }

    /*
     * No `model`. An external caller learning which vendor
     * served their request is the same leak the browser was
     * closed against, one API away.
     */
    res.json({
      reply,
      finishReason: done?.finishReason ?? "stop",
      usage: {
        inputTokens: done?.usage.inputTokens ?? 0,
        outputTokens: done?.usage.outputTokens ?? 0,
      },
    });

    return true;
  } catch (error) {
    sendError(res, error);
    return false;
  }
}

/* ---------------------------------------------------------
   STREAMING — opt in with `"stream": true`

   The same SSE frames /api/ai/chat emits, minus the fields
   above, so a caller who already reads BuildGentic's stream in the
   browser reads this one with the same code.
   --------------------------------------------------------- */

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function respondStreaming(
  res: Response,
  stream: AsyncGenerator<RuntimeStreamEvent>,
  clientGone: AbortController
): Promise<boolean> {
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

      if (event.type === "start") {
        /*
         * Carries nothing now. An external caller learning which
         * vendor served their request would be the same leak the
         * browser was closed against, one API away.
         */
        writeEvent(res, "start", {});
      } else if (event.type === "delta") {
        writeEvent(res, "delta", { text: event.text });
      } else if (event.type === "done") {
        writeEvent(res, "done", {
          finishReason: event.finishReason,
          usage: {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
          },
        });
      }
      /* `retrieval`, `web_search`, `memory` and `memory_write`
         are not forwarded. See respondWhole. */

      if (clientGone.signal.aborted) {
        break;
      }
    }

    res.end();
    return true;
  } catch (error) {
    const { body } = toPublicError(error);

    if (!headersSent) {
      /* Nothing written yet, so this can still be an honest HTTP
         status rather than an error buried in a stream. */
      sendError(res, error);
      return false;
    }

    if (body.code === "cancelled") {
      res.end();
      return false;
    }

    /* A stream that ends without `done` failed. Saying so as an
       event is the only channel left once headers have gone. */
    writeEvent(res, "error", body satisfies PublicErrorBody);
    res.end();
    return false;
  }
}

/*
 * One header value, or undefined.
 *
 * Node gives an array when a header arrives twice, which is a
 * thing a caller can arrange. Taking the first is arbitrary but
 * defensible; treating the array itself as a name would put
 * "a,b" into a filename.
 */
function headerOf(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
