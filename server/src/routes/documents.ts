import { Router } from "express";
import type { Response } from "express";

import { getAgent } from "../agents/AgentStore";
import {
  fetchForOwner,
  listForAgent,
  listForRun,
} from "../agents/documents/DocumentStore";
import { MEDIA_TYPE } from "../agents/documents/render";
import {
  clearRecords,
  destroyRecord,
  listForOwner,
  restoreRecord,
  usage,
} from "../agents/data/DataStore";
import { statusFor, toErrorBody } from "../ai/errors";
import { requireUser } from "../lib/auth";

export const documentsRouter = Router();

/*
 * The owner's side of generated files and of the agent's store.
 *
 * ONE ROUTE HERE SERVES BYTES, AND IT IS THE ONLY PLACE IN THIS
 * PROJECT THAT DOES.
 *
 * routes/files.ts states the opposing rule and means it:
 * nothing there serves an uploaded file back, at any address,
 * to anyone, because "a file must not become permanently
 * accessible just because somebody knows a URL" has exactly one
 * airtight implementation, which is for there to be no URL.
 *
 * A GENERATED document is the other case, and the difference is
 * not a loosening of that rule. An upload is somebody's private
 * document, held for half an hour to answer one question, with
 * no reason ever to be reachable. A generated document is the
 * PRODUCT of the turn — a report nobody can open is not a
 * report — and the whole point of the capability is that it
 * outlives the conversation.
 *
 * What the rule actually protects is kept, by four things
 * rather than by having no route:
 *
 *   the id is a v4 uuid, so nothing enumerates;
 *   the route demands a Supabase session and the store matches
 *     `user_id`, so another learner's id is indistinguishable
 *     from one that never existed;
 *   the row expires, and expiry is checked on read as well as
 *     swept;
 *   and there is no signed public URL and no anonymous path —
 *     a deployment key and a page visitor cannot reach this at
 *     all, which is also why both of those doors refuse the
 *     capability outright.
 *
 * Everything else in this file is metadata and owner-facing
 * mutation. Nothing here can create a document or write a
 * record: those happen inside a turn, through a tool, or not at
 * all.
 */

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

/* ---------------------------------------------------------
   GET /api/agents/documents/:id

   The download. The one route that serves bytes.
   --------------------------------------------------------- */

documentsRouter.get("/documents/:id", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const found = await fetchForOwner(user.id, req.params.id);

    /*
     * One 404 for four different situations — no such id, an
     * expired id, another learner's id, and a malformed id —
     * because the caller can only be told one thing, and
     * telling them which would be telling them that an id they
     * guessed belongs to somebody.
     *
     * The same choice `FileStore.get` makes and the same one
     * `DELETE /api/ai/keys/:id` makes.
     */
    if (!found) {
      res.status(404).json({
        error: "That file is no longer available.",
        code: "not_found",
      });

      return;
    }

    res.setHeader("Content-Type", MEDIA_TYPE[found.meta.format]);
    res.setHeader("Content-Length", String(found.bytes.length));

    /*
     * `attachment`, always, and never `inline`.
     *
     * The filename has already been through `filenameFor`,
     * which strips CR, LF and quotes — the characters that turn
     * this header into header injection. Serving inline would
     * additionally mean a browser rendering content this
     * server generated from model output in the app's own
     * origin, which is a rendering context nothing here needs.
     */
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${found.meta.filename}"`
    );

    /* No sniffing, no caching by anything in between. The
       response is one learner's private file. */
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");

    res.status(200).send(found.bytes);
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/agents/:agentId/documents

   What this agent has made lately, for the Builder.
   --------------------------------------------------------- */

documentsRouter.get("/:agentId/documents", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    /* Resolved under the caller's own id, so an agent that is
       not theirs is a 404 rather than an empty list. */
    await getAgent(user.id, req.params.agentId);

    const runId = typeof req.query.run === "string" ? req.query.run : null;

    const documents = runId
      ? await listForRun(user.id, runId)
      : await listForAgent(user.id, req.params.agentId);

    res.json({ documents });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   THE STORE

   Read, restore, destroy, clear. There is deliberately no
   route that CREATES a record.

   That asymmetry is the security model stated as an API, and
   it is the one MemoryStore already states: a person can
   remove what their agent kept, and nothing — no conversation,
   no document, no web page, no model output — can remove it on
   their behalf. Writing is the agent's job, through a tool,
   inside a turn that was admitted and counted.
   --------------------------------------------------------- */

documentsRouter.get("/:agentId/data", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    await getAgent(user.id, req.params.agentId);

    const [records, meters] = await Promise.all([
      listForOwner(user.id, req.params.agentId),
      usage({
        kind: "owner",
        userId: user.id,
        agentId: req.params.agentId,
      }),
    ]);

    res.json({ records, usage: meters });
  } catch (error) {
    sendError(res, error);
  }
});

/*
 * Restores a record the agent retired.
 *
 * The other half of the soft delete. `data_delete` lets model
 * output take a record out of circulation; this is how a person
 * puts it back, and between them they keep the rule that only a
 * person destroys anything.
 */
documentsRouter.post("/:agentId/data/:recordId/restore", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    await getAgent(user.id, req.params.agentId);

    const restored = await restoreRecord(
      user.id,
      req.params.agentId,
      req.params.recordId
    );

    if (!restored) {
      res.status(404).json({
        error: "That record is not there to restore.",
        code: "not_found",
      });

      return;
    }

    res.json({ restored: true });
  } catch (error) {
    sendError(res, error);
  }
});

documentsRouter.delete("/:agentId/data/:recordId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    await getAgent(user.id, req.params.agentId);

    const removed = await destroyRecord(
      user.id,
      req.params.agentId,
      req.params.recordId
    );

    if (!removed) {
      res.status(404).json({ error: "No such record.", code: "not_found" });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    sendError(res, error);
  }
});

documentsRouter.delete("/:agentId/data", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    await getAgent(user.id, req.params.agentId);

    const cleared = await clearRecords(user.id, req.params.agentId);

    res.json({ cleared });
  } catch (error) {
    sendError(res, error);
  }
});
