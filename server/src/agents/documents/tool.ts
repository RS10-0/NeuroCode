import { documents } from "../../ai/config";
import type {
  ToolContext,
  ToolOutcome,
  ToolSpec,
} from "../actions/catalog";

import { parsePlan } from "./plan";
import { render } from "./render";
import { DocumentTooLarge, RenderRefused } from "./types";

/*
 * make_document, and what the model is told about it.
 *
 * The description below is prompt text, not documentation — the
 * rule catalog.ts states in its own header. It goes into the
 * system prompt verbatim and it is the entire basis on which a
 * model decides whether to reach for this and what to put in
 * it.
 *
 * Three things in it are load-bearing and were not obvious:
 *
 *   THE BLOCK SHAPES ARE SHOWN, NOT DESCRIBED. A schema full of
 *   angle brackets is something models paraphrase; literal JSON
 *   with real values is something they copy. The same lesson
 *   context.ts records about the action line itself, where a
 *   concrete example was one of the three changes that stopped
 *   a 70B model inventing tool calls.
 *
 *   IT SAYS THE FILE CANNOT BE READ BACK. Without that a model
 *   spends one of its four steps trying to open what it just
 *   wrote, which is a quarter of the turn spent learning
 *   something one sentence could have said.
 *
 *   IT SAYS WHAT xlsx DOES WITH PROSE. A grid format handed
 *   paragraphs has to degrade somehow, and a model that knows
 *   tables become sheets will send tables when it asks for a
 *   spreadsheet. One told nothing sends three paragraphs and
 *   gets a workbook with one column.
 */

export const makeDocumentTool: ToolSpec = {
  id: "make_document",
  capability: "documentGeneration",

  description: () =>
    [
      "make_document — produce a real file the person can open and keep.",
      "  Use it for a report, a summary worth keeping, or a spreadsheet — anything they would download rather than read in a chat.",
      `  args: { "format": "pdf" | "xlsx" | "docx", "title": "<name>", "blocks": [...] }`,
      "  Four block kinds, and no others:",
      `    {"type":"heading","level":1,"text":"Week of 25 August"}`,
      `    {"type":"text","text":"Revenue rose 12% against last week."}`,
      `    {"type":"list","ordered":false,"items":["North beat target","South was flat"]}`,
      `    {"type":"table","columns":["Region","Q1"],"rows":[["North","400"],["South","310"]]}`,
      "  pdf is for reading or printing but draws Latin alphabets only — no Japanese, Chinese, Greek, Cyrillic, Arabic or emoji. docx is the same but editable, and handles every language. xlsx makes each table its own sheet named after the heading above it, so ask for it when the answer is mostly numbers, and send them as tables.",
      `  Limits: ${documents.maxBlocks} blocks, ${documents.maxTableRows} rows and ${documents.maxTableColumns} columns a table, ${documents.maxTotalChars.toLocaleString()} characters, ${documents.maxPerTurn} document${documents.maxPerTurn === 1 ? "" : "s"} an answer.`,
      "  You get back its name and size, never the file — you cannot read a document back, so put everything in the blocks first time. The person gets a download link, and a scheduled run attaches it to the email.",
    ].join("\n"),

  async run(args, context: ToolContext): Promise<ToolOutcome> {
    const startedAt = Date.now();

    /*
     * The per-turn ceiling, checked before anything is parsed.
     *
     * A turn that has already made two files and is asking for
     * a third has misunderstood the request, and the cheapest
     * place to say so is before a render. Absent budget means
     * no tracking rather than no limit — but every path that
     * reaches a tool passes one, so this is the "unreachable
     * and handled anyway" case.
     */
    if (context.turn && context.turn.documents >= documents.maxPerTurn) {
      return {
        ok: false,
        output: "",
        error: `You have already made ${context.turn.documents} document${
          context.turn.documents === 1 ? "" : "s"
        } in this answer, which is the limit. Answer with what you have.`,
        summary: "document limit reached",
        ms: 0,
      };
    }

    /*
     * A document has to hang off a saved agent, because the row
     * carries a foreign key to one.
     *
     * The same state connections are in, and the same honest
     * message: a draft in the Test panel has no id to hang
     * anything on. Everything else about the turn still works.
     */
    if (!context.agentId) {
      return {
        ok: false,
        output: "",
        error:
          "Documents can only be made by a saved agent. Save this agent first, then try again.",
        summary: "no agent to save against",
        ms: 0,
      };
    }

    const parsed = parsePlan(args);

    if (!parsed.ok) {
      return {
        ok: false,
        output: "",
        error: parsed.error,
        summary: "the document could not be read",
        ms: Date.now() - startedAt,
      };
    }

    let rendered;

    try {
      rendered = render(parsed.plan);
    } catch (error) {
      /*
       * Both refusals are the model's to recover from, and both
       * messages name what to do — ask for docx, send fewer
       * rows. A refusal the model cannot act on costs a step
       * and teaches nothing, which is the standard
       * `renderFailure` in protocol.ts holds tool errors to.
       */
      if (error instanceof RenderRefused || error instanceof DocumentTooLarge) {
        return {
          ok: false,
          output: "",
          error: error.message,
          summary:
            error instanceof DocumentTooLarge
              ? "the document was too large"
              : "the document was refused",
          ms: Date.now() - startedAt,
        };
      }

      throw error;
    }

    /*
     * The store is reached here rather than imported at the top
     * of this file, for the reason catalog.ts gives about
     * ConnectionStore: DocumentStore needs the Supabase client,
     * which refuses to load without SUPABASE_URL, and every
     * other part of this capability — the plan validator and all
     * three renderers — needs no database at all. Keeping the
     * import inside the one branch that needs it is what lets
     * the offline verification suite render and inspect a real
     * PDF on a machine with no keys.
     */
    const { put } = await import("./DocumentStore");

    const stored = await put({
      userId: context.userId,
      agentId: context.agentId,
      runId: context.runId ?? null,
      title: parsed.plan.title,
      rendered,
    });

    if (context.turn) {
      context.turn.documents += 1;
    }

    const size =
      stored.bytes < 1024
        ? `${stored.bytes} bytes`
        : `${Math.round(stored.bytes / 1024)} KB`;

    const shape =
      stored.pages !== undefined
        ? `${stored.pages} page${stored.pages === 1 ? "" : "s"}`
        : stored.sheets !== undefined
          ? `${stored.sheets} sheet${stored.sheets === 1 ? "" : "s"}, ${stored.rows ?? 0} rows`
          : stored.rows !== undefined
            ? `${stored.rows} rows`
            : "";

    /*
     * The receipt.
     *
     * Deliberately short — about two hundred characters — so a
     * document step barely touches `resultChars` and
     * `totalResultChars`, and a turn can fetch, compute AND
     * produce a file without running out of prompt.
     *
     * The degradation line is included when there is one,
     * because the agent has to be able to tell the person that
     * some characters could not be drawn. A file described as
     * complete when it is not is the failure this whole
     * capability has to avoid.
     */
    const output = [
      `Created "${stored.filename}"${shape ? ` — ${shape}` : ""}, ${size}.`,
      "It is saved to this run and the person can open it. You cannot read it back.",
      ...(stored.degraded ? ["", stored.degraded] : []),
    ].join("\n");

    return {
      ok: true,
      output,
      summary: `${stored.filename}, ${size}${stored.degraded ? ", some characters replaced" : ""}`,
      ms: Date.now() - startedAt,
      document: {
        id: stored.id,
        title: stored.title,
        filename: stored.filename,
        format: stored.format,
        bytes: stored.bytes,
        ...(stored.pages === undefined ? {} : { pages: stored.pages }),
        ...(stored.rows === undefined ? {} : { rows: stored.rows }),
        ...(stored.sheets === undefined ? {} : { sheets: stored.sheets }),
        ...(stored.degraded ? { degraded: stored.degraded } : {}),
      },
    };
  },
};
