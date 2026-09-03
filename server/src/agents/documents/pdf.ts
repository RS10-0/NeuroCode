import { deflateSync } from "node:zlib";

import { documents } from "../../ai/config";
import { encode, widthOf, wrap, fullyRenderable } from "./winansi";
import type { DocumentBlock, DocumentPlan } from "./plan";
import { DocumentTooLarge, RenderRefused, type Rendered } from "./types";

/*
 * Writing a PDF, by hand.
 *
 * Hand-rolled rather than depended on, for the reason
 * files/zip.ts gives about hand-rolling a ZIP reader: the whole
 * surface needed here is a handful of object types and one call
 * to zlib, and a dependency that can write a PDF can also embed
 * fonts, attach files, add annotations, and run JavaScript when
 * the document opens.
 *
 * That last one is not hypothetical, and it is the reason this
 * decision is a security decision rather than a taste one. A
 * document produced here goes into somebody's inbox as an email
 * attachment. WHAT THIS WRITER CANNOT EMIT is therefore part of
 * the design: there is no code path below that writes
 * /JavaScript, /OpenAction, /AA, /Launch, /EmbeddedFile,
 * /RichMedia, /URI or any annotation at all. Those strings do
 * not appear in this file, and the verification suite asserts
 * that they do not appear in its output.
 *
 * A PDF is a text format with a byte-offset index at the end,
 * which is what makes this tractable: a catalog, a page tree,
 * one compressed content stream per page, two font references,
 * and an xref table saying where each object starts.
 *
 * THE HONEST LIMIT is the encoding. The standard-14 Helvetica
 * faces need no embedded font file — which is what keeps this
 * small — and in exchange they draw WinAnsiEncoding and nothing
 * else. See winansi.ts. The rule this file applies to that:
 *
 *   the TITLE must be fully renderable, or the whole document
 *   is refused with `docx` named as the format that will work;
 *
 *   the BODY may be up to `pdfMaxUnrenderablePercent` lost,
 *   substituted visibly and reported, and is refused above it.
 *
 * Two rules rather than one because the failures are different
 * sizes. A heading is the line a report is identified by, and a
 * file called "□□□□ 2026" is not degraded, it is unusable. A
 * paragraph missing a few glyphs still says what it means.
 */

/* =========================================================
   PAGE GEOMETRY

   A4 in points, which is what a PDF measures in. Margins are
   generous rather than tight: this is a report somebody reads,
   not a form.
========================================================= */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const MEASURE = PAGE_WIDTH - MARGIN * 2;

const SIZE = {
  title: 20,
  h1: 16,
  h2: 13,
  h3: 11.5,
  body: 10.5,
  table: 9.5,
  footer: 8,
} as const;

/* Line height as a multiple of font size. 1.35 is the ratio
   that stops 10.5pt text looking cramped at this measure. */
const LEADING = 1.35;

/* =========================================================
   THE DOCUMENT UNDER CONSTRUCTION
========================================================= */

interface Writer {
  pages: string[][];
  ops: string[];
  /* Distance from the bottom of the page, in points, which is
     the direction PDF's coordinate space runs. */
  y: number;
  lost: number;
  total: number;
  deadline: number;
}

function begin(deadline: number): Writer {
  const writer: Writer = {
    pages: [],
    ops: [],
    y: PAGE_HEIGHT - MARGIN,
    lost: 0,
    total: 0,
    deadline,
  };

  return writer;
}

function newPage(writer: Writer): void {
  writer.pages.push(writer.ops);
  writer.ops = [];
  writer.y = PAGE_HEIGHT - MARGIN;
}

/* Makes room for something of this height, starting a page if
   there is not any. */
function reserve(writer: Writer, height: number): void {
  if (writer.y - height < MARGIN) {
    newPage(writer);
  }
}

/*
 * A hex string literal.
 *
 * Hex rather than the parenthesised form, and it is worth a
 * sentence: a literal string has to escape `(`, `)` and `\`,
 * and an escaping bug in a writer fed arbitrary model text is a
 * corrupt file at best. Hex has no escaping rules at all —
 * there is no byte it cannot carry — so the class of bug does
 * not exist here. It costs one byte per character, against a
 * stream that is then deflated.
 */
function hex(text: string): { literal: string; lost: number; total: number } {
  const encoded = encode(text);

  return {
    literal: `<${encoded.bytes.toString("hex")}>`,
    lost: encoded.lost,
    total: encoded.total,
  };
}

function drawText(
  writer: Writer,
  text: string,
  x: number,
  y: number,
  size: number,
  bold: boolean
): void {
  const { literal, lost, total } = hex(text);

  writer.lost += lost;
  writer.total += total;

  writer.ops.push(
    "BT",
    `/${bold ? "F2" : "F1"} ${size} Tf`,
    `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
    `${literal} Tj`,
    "ET"
  );
}

function drawRule(writer: Writer, y: number, from: number, to: number): void {
  writer.ops.push(
    "q",
    "0.75 0.75 0.75 RG",
    "0.5 w",
    `${from.toFixed(2)} ${y.toFixed(2)} m ${to.toFixed(2)} ${y.toFixed(2)} l S`,
    "Q"
  );
}

/* A paragraph, wrapped, page-breaking as it goes. */
function drawParagraph(
  writer: Writer,
  text: string,
  size: number,
  bold: boolean,
  indent = 0
): void {
  const measure = MEASURE - indent;
  const leading = size * LEADING;

  for (const line of wrap(text, size, bold, measure)) {
    reserve(writer, leading);
    writer.y -= leading;

    if (line !== "") {
      drawText(writer, line, MARGIN + indent, writer.y, size, bold);
    }
  }
}

/* =========================================================
   TABLES

   The one block that needs real layout. Columns are sized in
   proportion to the widest thing in them, then clamped so a
   single long cell cannot squeeze every other column to
   nothing — which is the failure that makes an auto-sized
   table unreadable rather than merely ugly.
========================================================= */

function columnWidths(columns: string[], rows: string[][]): number[] {
  const natural = columns.map((heading, index) => {
    let widest = widthOf(heading, SIZE.table, true);

    for (const row of rows) {
      const cell = row[index] ?? "";
      const width = widthOf(cell, SIZE.table, false);

      if (width > widest) {
        widest = width;
      }
    }

    /* Padding either side of the text, plus a floor so an empty
       column is still visibly a column. */
    return Math.max(36, widest + 12);
  });

  const total = natural.reduce((sum, width) => sum + width, 0);

  if (total <= MEASURE) {
    return natural;
  }

  /*
   * Over the measure. Scale everything down proportionally, but
   * hold a minimum — and give whatever the minimums consume
   * back out of the columns that are above it, so the row still
   * spans exactly the measure.
   */
  const floor = Math.min(48, MEASURE / natural.length);
  const scaled = natural.map((width) => (width / total) * MEASURE);

  let debt = 0;

  for (let index = 0; index < scaled.length; index += 1) {
    if (scaled[index] < floor) {
      debt += floor - scaled[index];
      scaled[index] = floor;
    }
  }

  if (debt > 0) {
    const spare = scaled
      .map((width, index) => ({ width, index }))
      .filter((entry) => entry.width > floor);

    const pool = spare.reduce((sum, entry) => sum + (entry.width - floor), 0);

    if (pool > 0) {
      for (const entry of spare) {
        scaled[entry.index] -= (debt * (entry.width - floor)) / pool;
      }
    }
  }

  return scaled;
}

function drawRow(
  writer: Writer,
  cells: string[],
  widths: number[],
  bold: boolean
): void {
  const leading = SIZE.table * LEADING;

  /* Every cell is wrapped first, so the row's height is known
     before anything is drawn and a row is never split across a
     page boundary halfway down. */
  const wrapped = cells.map((cell, index) =>
    wrap(cell, SIZE.table, bold, widths[index] - 12)
  );

  const lines = wrapped.reduce((most, cell) => Math.max(most, cell.length), 1);
  const height = lines * leading + 4;

  reserve(writer, height);

  const top = writer.y;

  for (let index = 0; index < wrapped.length; index += 1) {
    let x = MARGIN;

    for (let before = 0; before < index; before += 1) {
      x += widths[before];
    }

    for (let line = 0; line < wrapped[index].length; line += 1) {
      const text = wrapped[index][line];

      if (text !== "") {
        drawText(
          writer,
          text,
          x + 6,
          top - (line + 1) * leading,
          SIZE.table,
          bold
        );
      }
    }
  }

  writer.y = top - height;
}

function drawTable(
  writer: Writer,
  block: Extract<DocumentBlock, { type: "table" }>
): void {
  const widths = columnWidths(block.columns, block.rows);
  const span = widths.reduce((sum, width) => sum + width, 0);

  /* Keep the header with at least one row of its body. A header
     alone at the foot of a page is the classic table-layout
     failure and it costs one comparison to avoid. */
  reserve(writer, SIZE.table * LEADING * 2 + 12);

  writer.y -= 6;

  drawRow(writer, block.columns, widths, true);
  drawRule(writer, writer.y + 2, MARGIN, MARGIN + span);

  for (const row of block.rows) {
    if (Date.now() > writer.deadline) {
      throw new RenderRefused(
        "The document took too long to draw. Send fewer rows."
      );
    }

    drawRow(writer, row, widths, false);
    drawRule(writer, writer.y + 2, MARGIN, MARGIN + span);
  }

  writer.y -= 6;
}

/* =========================================================
   THE BLOCKS
========================================================= */

function drawBlock(writer: Writer, block: DocumentBlock): void {
  switch (block.type) {
    case "heading": {
      const size =
        block.level === 1 ? SIZE.h1 : block.level === 2 ? SIZE.h2 : SIZE.h3;

      writer.y -= size * 0.6;
      drawParagraph(writer, block.text, size, true);
      writer.y -= size * 0.25;

      if (block.level === 1) {
        drawRule(writer, writer.y + 4, MARGIN, PAGE_WIDTH - MARGIN);
        writer.y -= 4;
      }

      break;
    }

    case "text":
      drawParagraph(writer, block.text, SIZE.body, false);
      writer.y -= SIZE.body * 0.5;
      break;

    case "list": {
      let ordinal = 1;

      for (const item of block.items) {
        const marker = block.ordered ? `${ordinal}.` : "•";
        const markerWidth = widthOf(`${marker} `, SIZE.body, false);
        const leading = SIZE.body * LEADING;

        const lines = wrap(item, SIZE.body, false, MEASURE - markerWidth - 6);

        for (let index = 0; index < lines.length; index += 1) {
          reserve(writer, leading);
          writer.y -= leading;

          if (index === 0) {
            drawText(writer, marker, MARGIN + 6, writer.y, SIZE.body, false);
          }

          drawText(
            writer,
            lines[index],
            MARGIN + 6 + markerWidth,
            writer.y,
            SIZE.body,
            false
          );
        }

        ordinal += 1;
      }

      writer.y -= SIZE.body * 0.5;
      break;
    }

    case "table":
      drawTable(writer, block);
      break;
  }
}

/* =========================================================
   ASSEMBLING THE FILE

   Objects in a fixed order, each one's byte offset recorded as
   it is written, then an xref table pointing at all of them.
   That index is the whole reason a PDF can be read without
   parsing it from the start, and getting an offset wrong is the
   one mistake here that produces a file no reader will open.
========================================================= */

function stream(content: string): { dict: string; body: Buffer } {
  const raw = Buffer.from(content, "latin1");
  const packed = deflateSync(raw);

  return {
    dict: `<< /Length ${packed.length} /Filter /FlateDecode >>`,
    body: packed,
  };
}

function assemble(pages: string[][], title: string): Buffer {
  const objects: Buffer[] = [];

  /* 1 catalog, 2 pages, then per page: the page object and its
     content stream. Fonts and info last. */
  const pageCount = Math.max(1, pages.length);
  const firstPageObject = 3;
  const fontRegular = firstPageObject + pageCount * 2;
  const fontBold = fontRegular + 1;
  const info = fontBold + 1;

  const kids = Array.from(
    { length: pageCount },
    (_unused, index) => `${firstPageObject + index * 2} 0 R`
  ).join(" ");

  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"));

  objects.push(
    Buffer.from(
      `<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`,
      "latin1"
    )
  );

  for (let index = 0; index < pageCount; index += 1) {
    const contentObject = firstPageObject + index * 2 + 1;

    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R ` +
          `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
          `/Contents ${contentObject} 0 R >>`,
        "latin1"
      )
    );

    const packed = stream((pages[index] ?? []).join("\n"));

    objects.push(
      Buffer.concat([
        Buffer.from(`${packed.dict}\nstream\n`, "latin1"),
        packed.body,
        Buffer.from("\nendstream", "latin1"),
      ])
    );
  }

  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "latin1"
    )
  );

  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      "latin1"
    )
  );

  /* The title is known fully renderable by the time this runs —
     the refusal happens before a page is drawn — so WinAnsi
     bytes are a valid PDFDocEncoding string here. */
  objects.push(
    Buffer.from(
      `<< /Title <${encode(title).bytes.toString("hex")}> ` +
        `/Producer (BuildGentic) /Creator (BuildGentic) ` +
        `/CreationDate (D:${stamp()}) >>`,
      "latin1"
    )
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];

  let position = chunks[0].length;

  for (let index = 0; index < objects.length; index += 1) {
    const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");

    offsets.push(position);

    chunks.push(head, objects[index], tail);
    position += head.length + objects[index].length + tail.length;
  }

  const xrefAt = position;

  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>`,
    "startxref",
    String(xrefAt),
    "%%EOF",
    "",
  ].join("\n");

  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");

  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/* =========================================================
   THE ENTRY POINT
========================================================= */

export function renderPdf(plan: DocumentPlan, deadline: number): Rendered {
  /*
   * THE TITLE RULE, and it runs before anything is drawn.
   *
   * Zero tolerance, and no percentage to tune. A document whose
   * name cannot be written is not a degraded document — every
   * place it appears afterwards is a place it is unusable: the
   * heading, the filename, the email subject, the download
   * button. Refusing here costs the model one step and names
   * the format that will work; substituting would cost its
   * owner a file they cannot identify.
   */
  if (!fullyRenderable(plan.title)) {
    throw new RenderRefused(
      "A PDF cannot draw the characters in that title — it uses the built-in Helvetica, which covers Latin scripts only. Ask for \"docx\" instead, which handles any language, or retitle it in Latin characters."
    );
  }

  const writer = begin(deadline);

  /* The title block, drawn once at the top of the first page. */
  drawParagraph(writer, plan.title, SIZE.title, true);
  writer.y -= 6;
  drawRule(writer, writer.y, MARGIN, PAGE_WIDTH - MARGIN);
  writer.y -= 14;

  for (const block of plan.blocks) {
    if (Date.now() > deadline) {
      throw new RenderRefused(
        "The document took too long to draw. Send fewer blocks."
      );
    }

    drawBlock(writer, block);
  }

  writer.pages.push(writer.ops);

  /*
   * THE BODY RULE, applied after drawing rather than before.
   *
   * The percentage has to be taken over what was actually
   * drawn, which is not knowable from the plan: a table cell
   * counted once in the source may be drawn once, and a
   * paragraph is measured per line. Drawing first and refusing
   * afterwards costs one wasted render of a document that was
   * never going to be sent — bounded by the same caps
   * everything else is — and buys a number that is true.
   */
  const percent =
    writer.total > 0 ? Math.round((writer.lost / writer.total) * 100) : 0;

  if (percent > documents.pdfMaxUnrenderablePercent) {
    throw new RenderRefused(
      `${percent}% of that document is in characters a PDF's built-in font cannot draw, and the limit is ${documents.pdfMaxUnrenderablePercent}%. Ask for "docx" instead — it handles any language.`
    );
  }

  const bytes = assemble(writer.pages, plan.title);

  if (bytes.length > documents.maxBytes) {
    throw new DocumentTooLarge(bytes.length);
  }

  return {
    bytes,
    pages: writer.pages.length,
    ...(writer.lost > 0
      ? {
          degraded:
            `${writer.lost} character${writer.lost === 1 ? "" : "s"} ` +
            `(${percent}% of the text) could not be drawn in a PDF and ` +
            `${writer.lost === 1 ? "was" : "were"} replaced with [?]. ` +
            "Ask for docx if the document needs a non-Latin script.",
        }
      : {}),
  };
}
