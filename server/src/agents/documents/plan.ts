import { documents } from "../../ai/config";
import { clip } from "../../files/text";
import type { DocumentFormat } from "../../ai/types";

/*
 * What a model is allowed to ask for, and how that is checked.
 *
 * This file is the reason document generation is safe to hand a
 * model at all, and the shape of it is borrowed rather than
 * invented: `protocol.ts` refuses a tool name that is not in a
 * closed union, and this refuses a block type that is not in
 * one. There is no path from what a model writes to a renderer
 * branch that is not named here.
 *
 * THE MODEL DOES NOT WRITE A FILE, AND IT DOES NOT WRITE
 * MARKDOWN OR HTML EITHER.
 *
 * Markdown would need a parser, and three renderers would each
 * interpret it slightly differently — so one answer would
 * produce a real table in the Word document and a paragraph of
 * pipe characters in the PDF. A closed block list has one
 * meaning per block per format, which is the only way three
 * writers can agree.
 *
 * HTML is refused for a sharper reason. It invites the model to
 * emit a rendering context, and a table whose cells came out of
 * a fetched API would carry whatever markup that API returned.
 * The same argument mail.ts already makes about why an email
 * body has no HTML part applies with more force to something a
 * person opens in Word.
 *
 * And a closed vocabulary is what makes every ceiling
 * STRUCTURAL. Blocks, rows, columns, cell length and the total
 * are all checked here, before a byte is rendered — not
 * measured afterwards, by which time a pathological input has
 * already allocated.
 *
 * On the tone of the errors below: they are read by the model,
 * not by a person, and they are written to be actionable in one
 * retry. "That is not a block type" teaches nothing; naming the
 * four that exist does. Same reasoning as the parser errors in
 * protocol.ts.
 */

/* =========================================================
   THE VOCABULARY
========================================================= */

export type DocumentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "text"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][] };

export interface DocumentPlan {
  format: DocumentFormat;
  title: string;
  blocks: DocumentBlock[];
}

export type PlanParse =
  | { ok: true; plan: DocumentPlan }
  | { ok: false; error: string };

const FORMATS: DocumentFormat[] = ["pdf", "xlsx", "docx"];

const BLOCK_TYPES = ["heading", "text", "list", "table"] as const;

/* =========================================================
   COERCION

   Forgiving where forgiveness is free, strict where it is not.

   A model that sends the number 400 in a table cell has not
   made a mistake worth a wasted step — a spreadsheet cell is a
   string either way, and refusing would burn one of four steps
   to teach a lesson with no content. A model that sends an
   OBJECT in a cell has misunderstood the shape and needs to be
   told, because whatever it meant cannot be rendered.

   The same distinction protocol.ts draws when it strips a
   markdown fence off an action: accept the deviation that has
   one obvious reading, refuse the one that does not.
========================================================= */

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value === null || value === undefined) {
    return "";
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* =========================================================
   PARSING ONE BLOCK
========================================================= */

function parseBlock(raw: unknown, index: number): DocumentBlock | string {
  const where = `Block ${index + 1}`;

  if (!isRecord(raw)) {
    return `${where} is not an object. Every block looks like {"type":"text","text":"..."}.`;
  }

  const type = raw.type;

  if (typeof type !== "string" || !BLOCK_TYPES.includes(type as never)) {
    return `${where} has type ${
      typeof type === "string" ? `"${clip(type, 30)}"` : "(missing)"
    }. The only block types are ${BLOCK_TYPES.join(", ")}.`;
  }

  switch (type) {
    case "heading": {
      const text = asText(raw.text);

      if (text === null || text.trim() === "") {
        return `${where} is a heading with no text.`;
      }

      if (text.length > documents.maxTextChars) {
        return `${where} is a heading of ${text.length} characters and the limit is ${documents.maxTextChars}.`;
      }

      /*
       * Clamped rather than refused. A model asking for a level
       * 4 heading has expressed something this vocabulary does
       * not carry, and the honest rendering of "deeper than the
       * deepest level" is the deepest level — not an error that
       * costs a step over one integer.
       */
      const asked = typeof raw.level === "number" ? Math.trunc(raw.level) : 1;
      const level = (asked < 1 ? 1 : asked > 3 ? 3 : asked) as 1 | 2 | 3;

      return { type: "heading", level, text: text.trim() };
    }

    case "text": {
      const text = asText(raw.text);

      if (text === null || text.trim() === "") {
        return `${where} is a text block with no text.`;
      }

      if (text.length > documents.maxTextChars) {
        return `${where} is ${text.length} characters and the limit for one text block is ${documents.maxTextChars}. Split it into several blocks.`;
      }

      return { type: "text", text };
    }

    case "list": {
      if (!Array.isArray(raw.items)) {
        return `${where} is a list with no "items" array.`;
      }

      if (raw.items.length === 0) {
        return `${where} is a list with no items in it.`;
      }

      if (raw.items.length > documents.maxBlocks) {
        return `${where} has ${raw.items.length} items and the limit is ${documents.maxBlocks}.`;
      }

      const items: string[] = [];

      for (const entry of raw.items) {
        const text = asText(entry);

        if (text === null) {
          return `${where} has a list item that is not text.`;
        }

        if (text.trim() === "") {
          continue;
        }

        if (text.length > documents.maxTextChars) {
          return `${where} has a list item of ${text.length} characters and the limit is ${documents.maxTextChars}.`;
        }

        items.push(text.trim());
      }

      if (items.length === 0) {
        return `${where} is a list whose items are all empty.`;
      }

      return { type: "list", ordered: raw.ordered === true, items };
    }

    case "table": {
      if (!Array.isArray(raw.columns) || raw.columns.length === 0) {
        return `${where} is a table with no "columns" array. Give the header row as a list of strings.`;
      }

      if (raw.columns.length > documents.maxTableColumns) {
        return `${where} has ${raw.columns.length} columns and the limit is ${documents.maxTableColumns}.`;
      }

      const columns: string[] = [];

      for (const entry of raw.columns) {
        const text = asText(entry);

        if (text === null) {
          return `${where} has a column heading that is not text.`;
        }

        columns.push(clip(text.trim(), documents.maxCellChars));
      }

      if (!Array.isArray(raw.rows)) {
        return `${where} is a table with no "rows" array.`;
      }

      if (raw.rows.length > documents.maxTableRows) {
        return `${where} has ${raw.rows.length} rows and the limit is ${documents.maxTableRows}. Summarise, or send the most important rows.`;
      }

      const rows: string[][] = [];

      for (let index = 0; index < raw.rows.length; index += 1) {
        const source = raw.rows[index];

        if (!Array.isArray(source)) {
          return `${where}, row ${index + 1} is not an array. Every row is a list of cells, in column order.`;
        }

        if (source.length > columns.length) {
          return `${where}, row ${index + 1} has ${source.length} cells but the table has ${columns.length} columns.`;
        }

        const cells: string[] = [];

        for (const cell of source) {
          const text = asText(cell);

          if (text === null) {
            return `${where}, row ${index + 1} has a cell that is not a value. Cells are text, numbers or true/false — not lists or objects.`;
          }

          cells.push(clip(text, documents.maxCellChars));
        }

        /*
         * Short rows are padded rather than refused.
         *
         * A model that omits a trailing empty cell has produced
         * a ragged array, which is the commonest shape mistake
         * in tabular JSON and has exactly one sensible reading.
         * A row with MORE cells than columns is refused above,
         * because that one does not.
         */
        while (cells.length < columns.length) {
          cells.push("");
        }

        rows.push(cells);
      }

      return { type: "table", columns, rows };
    }

    default:
      /* Unreachable: BLOCK_TYPES gates the switch. Here because
         "unreachable" and "impossible" are different words. */
      return `${where} has an unknown type.`;
  }
}

/* =========================================================
   PARSING THE WHOLE REQUEST
========================================================= */

export function parsePlan(args: Record<string, unknown>): PlanParse {
  const format = args.format;

  if (typeof format !== "string" || !FORMATS.includes(format as DocumentFormat)) {
    return {
      ok: false,
      error: `"${
        typeof format === "string" ? clip(format, 20) : "(missing)"
      }" is not a format. Use "pdf", "xlsx" or "docx".`,
    };
  }

  const title = asText(args.title);

  if (title === null || title.trim() === "") {
    return {
      ok: false,
      error: 'Missing `title`. Give the document a name, like {"title":"Weekly sales report"}.',
    };
  }

  if (title.length > documents.maxTitleChars) {
    return {
      ok: false,
      error: `That title is ${title.length} characters and the limit is ${documents.maxTitleChars}.`,
    };
  }

  if (!Array.isArray(args.blocks)) {
    return {
      ok: false,
      error:
        'Missing `blocks`. A document is a list of blocks, like [{"type":"heading","level":1,"text":"..."},{"type":"text","text":"..."}].',
    };
  }

  if (args.blocks.length === 0) {
    return { ok: false, error: "That document has no blocks in it." };
  }

  if (args.blocks.length > documents.maxBlocks) {
    return {
      ok: false,
      error: `That document has ${args.blocks.length} blocks and the limit is ${documents.maxBlocks}.`,
    };
  }

  const blocks: DocumentBlock[] = [];

  for (let index = 0; index < args.blocks.length; index += 1) {
    const parsed = parseBlock(args.blocks[index], index);

    if (typeof parsed === "string") {
      return { ok: false, error: parsed };
    }

    blocks.push(parsed);
  }

  /*
   * The whole-document ceiling, last.
   *
   * Per-block limits bound one mistake; only this bounds two
   * hundred blocks that are each individually reasonable. It is
   * checked after parsing rather than during, because the
   * message is more useful when it can name the real total —
   * a model told "you are 4,000 characters over" cuts the right
   * amount, and one told "too long" guesses.
   */
  const total = weigh(blocks) + title.length;

  if (total > documents.maxTotalChars) {
    return {
      ok: false,
      error: `That document is ${total.toLocaleString()} characters of content and the limit is ${documents.maxTotalChars.toLocaleString()}. Send less, or split it across two documents.`,
    };
  }

  return {
    ok: true,
    plan: { format: format as DocumentFormat, title: title.trim(), blocks },
  };
}

/* How much text a block list carries. Also what the renderers
   report, so the receipt and the ceiling agree on one number. */
export function weigh(blocks: DocumentBlock[]): number {
  let total = 0;

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
      case "text":
        total += block.text.length;
        break;

      case "list":
        for (const item of block.items) {
          total += item.length;
        }
        break;

      case "table":
        for (const column of block.columns) {
          total += column.length;
        }

        for (const row of block.rows) {
          for (const cell of row) {
            total += cell.length;
          }
        }

        break;
    }
  }

  return total;
}

/* How many data rows the plan carries, across every table.
   Reported on the row and in the receipt — for a spreadsheet it
   is the number that says whether the export is the right size. */
export function countRows(blocks: DocumentBlock[]): number {
  let rows = 0;

  for (const block of blocks) {
    if (block.type === "table") {
      rows += block.rows.length;
    }
  }

  return rows;
}
