import { Router } from "express";
import type { Response } from "express";

import { getAgent } from "../agents/AgentStore";
import { describe } from "../agents/files/context";
import { fileAnalysis } from "../ai/config";
import { AiRuntimeError, statusFor, toErrorBody } from "../ai/errors";
import { analyseFile } from "../files/FileAnalysisRuntime";
import { drop } from "../files/FileStore";
import {
  FILE_ACCEPT,
  fileNameFromHeader,
  SUPPORTED_DESCRIPTION,
} from "../files/sniff";
import { requireUser } from "../lib/auth";

export const filesRouter = Router();

/*
 * The owner's side of File Analysis.
 *
 * Two routes, both session-authenticated: put a file up, take a
 * file down. There is deliberately no third — nothing here
 * serves an uploaded file back, at any address, to anyone.
 *
 * That absence is the feature. "Files should not become
 * permanently accessible just because somebody knows a URL" has
 * exactly one airtight implementation, which is for there to be
 * no URL. What the upload returns is a summary and an opaque id;
 * what the store keeps is the extracted text; what a chat
 * request carries is the id. The original bytes are dropped once
 * they have been read, except for an image, whose bytes are the
 * content and travel inline on the request that asks about them.
 *
 * Like the knowledge routes in agents.ts, nothing here edits an
 * agent's configuration. The agent id on an upload is used for
 * two things and no others: attributing the usage row, and
 * checking that the capability its owner switched on is actually
 * on.
 */

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

/* ---------------------------------------------------------
   POST /api/agents/files

   Uploads one file, reads it, and returns what it turned into.

   Raw bytes with the metadata in headers rather than multipart
   or base64 JSON. Multipart would mean a parser dependency for
   a route that accepts exactly one part; base64 would inflate
   every upload by a third and make the byte ceiling a lie about
   what actually crosses the network. Raw is what `fetch(url,
   { body: file })` sends with no ceremony at all, and it is
   what curl sends with --data-binary.

   The headers are untrusted and are treated as such: the name
   goes through safeFileName, and the declared type is used only
   to narrow among text formats. What the file IS comes from its
   bytes.
   --------------------------------------------------------- */

filesRouter.post("/files", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const bytes = req.body;

    if (!Buffer.isBuffer(bytes)) {
      /*
       * Express hands back `{}` when nothing matched a body
       * parser, which is what an empty POST looks like here.
       */
      throw new AiRuntimeError(
        "invalid_request",
        "No file was sent. Attach a file and try again."
      );
    }

    const agentId = headerOf(req.headers["x-agent-id"]);

    /*
     * The capability check, and the reason this route takes an
     * agent id at all.
     *
     * An upload against a saved agent whose owner has not
     * switched File Analysis on is refused here rather than
     * silently accepted and then ignored at chat time. The
     * learner would otherwise watch a file upload successfully,
     * attach it, and get an answer that never mentioned it.
     *
     * A draft with no id skips this: an unsaved agent in the
     * Builder is testable before it exists in the database, and
     * the flag on the request is what governs it there — the
     * same reasoning that lets an unsaved draft search the web.
     */
    if (agentId) {
      const agent = await getAgent(user.id, agentId);

      if (!agent) {
        res
          .status(404)
          .json({ error: "No such agent.", code: "invalid_request" });
        return;
      }

      if (!agent.capabilities.includes("file_analysis")) {
        throw new AiRuntimeError(
          "invalid_request",
          "This agent does not have File Analysis switched on. Turn it on in Capabilities, then attach the file again."
        );
      }
    }

    /* A client that hangs up mid-parse should not leave a parser
       running, exactly as on the chat routes. */
    const clientGone = new AbortController();

    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone.abort();
      }
    });

    const held = await analyseFile({
      scope: { kind: "user", userId: user.id },
      name: fileNameFromHeader(headerOf(req.headers["x-file-name"])),
      declaredType: req.headers["content-type"],
      bytes,
      ...(agentId ? { agentId } : {}),
      signal: clientGone.signal,
    });

    res.status(201).json({ file: describe(held) });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/files/:id

   Removes an attachment before it has been used.

   Worth a route rather than being left to the retention window,
   because a Remove button that only removed a chip from the
   screen would be a lie about where the document went. A learner
   who changes their mind should be able to make it true.
   --------------------------------------------------------- */

filesRouter.delete("/files/:id", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  const removed = drop(req.params.id, { kind: "user", userId: user.id });

  if (!removed) {
    /*
     * Scoped in the store, so somebody else's file id is
     * indistinguishable from one that has expired — which is the
     * correct thing for it to look like. The same choice DELETE
     * /api/ai/keys/:id makes.
     */
    res
      .status(404)
      .json({ error: "No such attachment.", code: "invalid_request" });
    return;
  }

  res.json({ removed: true });
});

/* ---------------------------------------------------------
   GET /api/agents/files/limits

   What the attachment control needs before anybody picks a
   file. Also published inside /api/ai/models, which is what the
   Builder actually reads; this exists so a script does not have
   to fetch the whole model catalogue to find out how big a file
   may be.
   --------------------------------------------------------- */

filesRouter.get("/files/limits", (_req, res) => {
  res.json({
    maxFileBytes: fileAnalysis.maxFileBytes,
    maxImageBytes: fileAnalysis.maxImageBytes,
    maxImagePixels: fileAnalysis.maxImagePixels,
    maxFilesPerMessage: fileAnalysis.maxFilesPerMessage,
    maxImagesPerMessage: fileAnalysis.maxImagesPerMessage,
    retentionMinutes: Math.round(fileAnalysis.retentionMs / 60_000),
    accept: FILE_ACCEPT,
    supported: SUPPORTED_DESCRIPTION,
  });
});

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

/* ---------------------------------------------------------
   POST /api/agents/knowledge/extract

   Turns a document into text a learner can keep as knowledge.

   The knowledge box reads plain text in the browser, which is
   right for a .txt or a .md and impossible for a PDF: a browser
   handed a PDF can read its bytes and nothing else, so the file
   picker used to exclude the formats it could not honestly
   handle. That was a correct refusal to a question asked in the
   wrong place — this server has extracted PDF, Word, Excel and
   CSV text since File Analysis shipped, and nothing was routing
   knowledge through it.

   Deliberately NOT a second extraction path. It calls the same
   `analyseFile` the attachment route calls, so a document
   uploaded here passes the same sniffing, the same byte
   ceilings, the same quota gate and writes the same usage row.
   What differs is only what happens afterwards: an attachment
   is held for the retention window so a chat turn can reference
   it, while knowledge is copied into the learner's own row and
   the held copy is dropped immediately. Nothing about this file
   needs to outlive the request.

   Images are refused. Every other extractor produces text;
   the image one produces base64 for a vision model, and a
   knowledge entry is text by definition — storing a picture
   here would put a megabyte of base64 into a system prompt.

   No agent id in the path, and that is deliberate rather than
   an omission. Knowledge is added in the Builder, where the
   commonest moment to attach a document is while building an
   agent that has never been saved and therefore has no id at
   all. Extraction does not need one: the file is read for the
   LEARNER, billed to the learner, and dropped — which agent
   the text ends up in is a decision made later, on the client,
   and may be none.
   --------------------------------------------------------- */

filesRouter.post("/knowledge/extract", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const bytes = req.body;

    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new AiRuntimeError(
        "invalid_request",
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
      scope: { kind: "user", userId: user.id },
      name: fileNameFromHeader(headerOf(req.headers["x-file-name"])),
      declaredType: req.headers["content-type"],
      bytes,
      signal: clientGone.signal,
    });

    /*
     * Dropped before the response is written, not after, and not
     * left to the retention sweep. The learner is about to hold
     * this text in a row of their own; a second copy sitting in
     * the process for thirty minutes is memory spent on nothing
     * and a document lingering somewhere its owner would not
     * expect.
     */
    drop(held.id, { kind: "user", userId: user.id });

    if (held.extracted.image) {
      throw new AiRuntimeError(
        "invalid_request",
        "An image cannot become knowledge — there is no text in it to give the agent. Attach it to a message instead, if this agent reads files."
      );
    }

    /*
     * Sections joined with their labels, so a page break or a
     * sheet name survives into the note. Retrieval chunks on
     * this text later, and "Page 12" in the body is the
     * difference between a citation a learner can check and a
     * paragraph from nowhere.
     */
    const text = held.extracted.sections
      .map((section) =>
        section.label ? `${section.label}\n${section.text}` : section.text
      )
      .join("\n\n")
      .trim();

    if (!text) {
      throw new AiRuntimeError(
        "invalid_request",
        `${held.name} has no text in it that BuildGentic could read. If it is a scan, the pages are pictures rather than words.`
      );
    }

    res.status(200).json({
      name: held.name,
      kind: held.extracted.kind,
      text,
      chars: text.length,
      truncated: held.extracted.truncated,
      ...(held.extracted.truncationNote
        ? { truncationNote: held.extracted.truncationNote }
        : {}),
      ...(held.extracted.pages !== undefined
        ? { pages: held.extracted.pages }
        : {}),
      ...(held.extracted.sheets !== undefined
        ? { sheets: held.extracted.sheets }
        : {}),
    });
  } catch (error) {
    sendError(res, error);
  }
});
