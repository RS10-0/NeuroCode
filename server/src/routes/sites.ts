import { Router } from "express";
import type { Response } from "express";

import { runChat } from "../ai/AiRuntime";
import { siteLimits } from "../ai/config";
import { subjectFor } from "../agents/memory/scope";
import { resolveSite } from "../sites/SiteStore";
import { isFlagshipId } from "../../../src/features/agents/flagships";
import {
  buildSiteChat,
  toSiteError,
} from "../sites/siteRequest";
import { admitVisitor, callerAddress } from "../sites/visitorRate";
import type { RuntimeStreamEvent } from "../ai/types";

export const sitesRouter = Router();

/*
 * The endpoint a stranger's browser calls.
 *
 * This is the second route in BuildGentic that answers a request
 * with no Supabase session, and the first that answers one with
 * no credential of any kind. Everything `requireUser` normally
 * supplies — who this is, whose quota to count, whose provider
 * key to spend — is resolved from a slug, and every one of
 * those facts comes off a database row rather than out of the
 * request.
 *
 * Unlike /api/v1, this router is mounted BELOW the CORS
 * middleware, and the difference is deliberate rather than
 * inconsistent. That one is above it because a deployment key
 * that works from a web page is a deployment key published to
 * the world, so no browser should ever call it. This one is
 * only ever called by a browser — the published page itself,
 * same-origin — and carries no credential for CORS to protect.
 * The allowlist therefore does what it should: BuildGentic's own
 * pages can call this, and a third party embedding somebody's
 * agent in their own site cannot.
 *
 * What this route does NOT do is the same list as the
 * deployment router's. It does not resolve a provider, hold a
 * key, count a quota or write a usage row. It builds a body and
 * calls `runChat`, the same function the Lab and the Builder
 * call, so a visitor's request cannot skip a gate a learner's
 * cannot skip.
 */

function sendError(res: Response, error: unknown): void {
  const { status, body } = toSiteError(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(status).json(body);
}

/* ---------------------------------------------------------
   GET /api/sites/:slug

   Everything needed to draw the page, and nothing else.
   --------------------------------------------------------- */

sitesRouter.get("/:slug", async (req, res) => {
  try {
    const resolved = await resolveSite(req.params.slug);

    if (!resolved) {
      res.status(404).json({
        error: "No page is published at that address.",
        code: "not_found",
      });
      return;
    }

    /*
     * The response shape is the privacy boundary, so it is
     * built field by field rather than spread from the row.
     *
     * Absent, and absent on purpose: the agent's id, the
     * deployment's id, the site's id, the owner's id, the
     * model, the provider, the instructions, the knowledge,
     * and every usage figure. A visitor holds a slug and a
     * rendering, and no identifier that means anything
     * anywhere else in this system.
     */
    res.json({
      slug: resolved.site.slug,
      config: resolved.site.config,
      agent: {
        name: resolved.agent.name,
        avatarEmoji: resolved.agent.avatarEmoji,
        avatarTone: resolved.agent.avatarTone,
        /*
         * Which of BuildGentic's own agents this is, when it is
         * one of them, and nothing when it is not.
         *
         * The renderer uses it to draw the purpose-built page
         * for that flagship instead of one of the four generic
         * layouts. It is safe to send for the same reason the
         * Library card is: the public half of the catalogue
         * already ships in every browser's bundle, and this
         * page is already displaying that agent's name and
         * glyph. What stays server-side stays server-side —
         * no prompt, no knowledge, no identifier.
         *
         * Guarded twice on purpose. `isOfficial` is the row
         * saying BuildGentic built this; `isFlagshipId` is this
         * build saying it still ships that agent. A row naming
         * a retired flagship falls through to the generic
         * page rather than to a design that no longer exists.
         */
        flagshipId:
          resolved.agent.isOfficial && isFlagshipId(resolved.agent.flagshipId)
            ? resolved.agent.flagshipId
            : undefined,
      },
      chatLive: resolved.chatLive,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/sites/:slug/chat

   Always streaming. The only client is a browser drawing a
   conversation, and a chat that arrives all at once after
   eight seconds reads as broken.
   --------------------------------------------------------- */

sitesRouter.post("/:slug/chat", async (req, res) => {
  /*
   * The per-visitor bucket, checked before anything else.
   *
   * Before the database is touched, before the site is
   * resolved, and before a usage row could be written — a
   * limiter that costs a query per request is a limiter that
   * amplifies the flood it exists to absorb.
   */
  const verdict = admitVisitor(
    callerAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress),
    req.params.slug
  );

  if (!verdict.ok) {
    res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
    res.status(429).json({
      error: "You are sending messages faster than this page allows.",
      code: "busy",
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
    return;
  }

  let resolved;

  try {
    resolved = await resolveSite(req.params.slug);
  } catch (error) {
    sendError(res, error);
    return;
  }

  if (!resolved) {
    res.status(404).json({
      error: "No agent answers at that address.",
      code: "not_found",
    });
    return;
  }

  let chat;

  try {
    chat = await buildSiteChat({ resolved, body: req.body });
  } catch (error) {
    sendError(res, error);
    return;
  }

  /* Same reasoning as every other streaming route: a visitor
     who closes the tab becomes a cancelled provider request
     rather than tokens nobody will read — and on this endpoint
     those are the owner's tokens. */
  const clientGone = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone.abort();
    }
  });

  const { agent, site, ownerId } = resolved;

  const stream = runChat({
    /*
     * The owner. The single argument that makes this work with
     * no second runtime: power source, provider credentials,
     * quota key and platform budget all resolve to the student
     * who built the agent, exactly as they do when that student
     * tests it in the Builder.
     */
    userId: ownerId,
    body: chat.parsed,
    signal: clientGone.signal,
    /*
     * The site's own ceiling, checked inside the same atomic
     * admission as everything else, and passed through the
     * deployment slots because a page IS a door onto a
     * deployment — its traffic belongs in that deployment's
     * windows, and the owner's Deploy screen should show it.
     *
     * `siteLimits` rather than `deploymentLimits`, so the
     * tighter public-page numbers apply on this path. Both are
     * additional to the owner's own quota, never instead of it.
     */
    deployment: { id: site.deploymentId, limits: siteLimits },
    /*
     * The deployment's scope, not the owner's — the same
     * boundary the deployment endpoint draws, and here it
     * matters more.
     *
     * A visitor may reach what this agent has remembered about
     * THEM, and nothing else: not what the owner told it while
     * building it, and not what another visitor said. The
     * subject is the browser's own random key salted with the
     * deployment id, so it cannot be made to collide with
     * another page's drawer — and sending no key at all lands
     * in the page's shared drawer rather than in somebody's.
     *
     * Without this, a public page with memory switched on would
     * recall the first visitor's statements to the second, which
     * is the single sharpest failure available in this feature.
     */
    memoryScope: {
      kind: "deployment",
      deploymentId: site.deploymentId,
      agentId: agent.id,
      ownerId,
      subject: subjectFor(site.deploymentId, chat.visitorKey),
    },
    fileScope: {
      kind: "deployment",
      deploymentId: site.deploymentId,
      ownerId,
    },
  });

  await respondStreaming(res, stream, clientGone);
});

/* ---------------------------------------------------------
   STREAMING

   Three events reach a visitor: start, delta, done. The
   capability events — retrieval, web_search, memory,
   memory_write — are NOT forwarded, for the reason the
   deployment router does not forward them either: they
   describe how somebody else's agent was built, and the
   sources it consulted are the owner's material rather than
   the reader's.
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
        /* Tells nginx not to buffer, which would otherwise hold
           the whole answer and deliver it at once — the exact
           thing streaming exists to avoid. */
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        headersSent = true;
      }

      if (event.type === "start") {
        /* Carries nothing. A visitor learning which vendor
           served their request would be the same leak the
           deployment endpoint was closed against. */
        writeEvent(res, "start", {});
      } else if (event.type === "delta") {
        writeEvent(res, "delta", { text: event.text });
      } else if (event.type === "done") {
        /*
         * Not even the token counts, which the deployment
         * endpoint does send.
         *
         * An API caller is somebody the owner gave a key to and
         * may reasonably want to know what a call cost. A
         * visitor is a reader; token counts tell them nothing
         * they can act on and tell anybody watching the
         * endpoint how large the owner's hidden prompt is.
         */
        writeEvent(res, "done", { finishReason: event.finishReason });
      }

      if (clientGone.signal.aborted) {
        break;
      }
    }

    res.end();
  } catch (error) {
    const { body } = toSiteError(error);

    if (!headersSent) {
      /* Nothing written yet, so this can still be an honest
         HTTP status rather than an error buried in a stream. */
      sendError(res, error);
      return;
    }

    if (body.code === "cancelled") {
      res.end();
      return;
    }

    /* A stream that ends without `done` failed. Saying so as an
       event is the only channel left once headers have gone —
       and the client treats a missing `done` as a failure
       anyway, so this is what turns "it stopped" into a
       sentence. */
    writeEvent(res, "error", body);
    res.end();
  }
}
