import { documents } from "../../ai/config";
import { escapeXml, writeZip, type ZipFile } from "./zipWriter";
import type { DocumentBlock, DocumentPlan } from "./plan";
import { DocumentTooLarge, RenderRefused, type Rendered } from "./types";

/*
 * Writing a Word document.
 *
 * files/extract/docx.ts opens with the observation this writer
 * is built on: a .docx body is a FLAT LIST OF PARAGRAPHS. Word
 * has no nesting for headings, no sections and no chapters — a
 * heading is a paragraph carrying a style name, and the style
 * name is the only thing distinguishing "Chapter 3" from a
 * short sentence.
 *
 * That makes the block vocabulary an almost exact fit, and it
 * makes the style ids load-bearing rather than cosmetic. The
 * reader recognises `Heading1`, `Heading2`, `Heading3` and
 * `Title` and turns them back into markdown hashes; this writer
 * emits those exact ids. The two halves were not written to
 * match by coincidence — it is what lets the verification suite
 * round-trip a generated document through the project's own
 * parser and assert the structure survived.
 *
 * THIS IS THE FORMAT WITH NO ENCODING LIMIT. OOXML is UTF-8, so
 * a document in Japanese, Greek or Arabic renders in full. That
 * is why the PDF writer's refusal message names this format by
 * name: "ask for docx instead" is a recovery the model can act
 * on in one step, and it is true.
 *
 * WHAT THIS WRITER CANNOT EMIT: no `vbaProject.bin`, no
 * `w:fldSimple` or field instruction of any kind, no OLE object
 * part, no `TargetMode="External"` relationship, and no
 * hyperlink relationship at all — so there is no path by which
 * text an API returned becomes something clickable in a
 * document that arrives as an email attachment. Those strings
 * do not appear in this file.
 */

const NS_W =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* =========================================================
   RUNS AND PARAGRAPHS
========================================================= */

/*
 * One run of text.
 *
 * Line breaks inside a block become `w:br` rather than
 * separate paragraphs, which is the difference between a
 * multi-line paragraph and several paragraphs — and the reader
 * next door treats them the same way, pushing "\n" into the
 * current paragraph rather than flushing it.
 */
function run(text: string, bold: boolean): string {
  const parts = text.split(/\r\n|\r|\n/);

  const body = parts
    .map(
      (line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`
    )
    .join("<w:br/>");

  return `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${body}</w:r>`;
}

function paragraph(
  text: string,
  options: { style?: string; bold?: boolean; indent?: number } = {}
): string {
  const properties: string[] = [];

  if (options.style) {
    properties.push(`<w:pStyle w:val="${options.style}"/>`);
  }

  if (options.indent) {
    properties.push(`<w:ind w:left="${options.indent}" w:hanging="240"/>`);
  }

  const pPr = properties.length > 0 ? `<w:pPr>${properties.join("")}</w:pPr>` : "";

  return `<w:p>${pPr}${run(text, options.bold === true)}</w:p>`;
}

/* =========================================================
   TABLES

   A real Word table — `w:tbl`, `w:tr`, `w:tc` — rather than
   tab-separated text, because the reader flattens a real table
   back to pipe-delimited rows and flattens tab-separated text
   to prose. A learner asking "what is in the second column"
   gets an answer from the first and nothing from the second.
========================================================= */

/* Twentieths of a point. 9026 is the usable width of A4 with
   the default one-inch margins, which is what a table has to
   fit inside to avoid Word spilling it off the page. */
const CONTENT_TWIPS = 9026;

function table(block: Extract<DocumentBlock, { type: "table" }>): string {
  const width = Math.floor(CONTENT_TWIPS / block.columns.length);

  const grid = block.columns
    .map(() => `<w:gridCol w:w="${width}"/>`)
    .join("");

  const cellOf = (text: string, bold: boolean): string =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
    `${paragraph(text, { bold })}</w:tc>`;

  const rows: string[] = [
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>` +
      block.columns.map((column) => cellOf(column, true)).join("") +
      `</w:tr>`,
  ];

  for (const row of block.rows) {
    rows.push(
      `<w:tr>${row.map((cell) => cellOf(cell, false)).join("")}</w:tr>`
    );
  }

  return (
    `<w:tbl><w:tblPr>` +
    `<w:tblW w:w="${CONTENT_TWIPS}" w:type="dxa"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="BFBFBF"/>` +
    `<w:left w:val="single" w:sz="4" w:color="BFBFBF"/>` +
    `<w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/>` +
    `<w:right w:val="single" w:sz="4" w:color="BFBFBF"/>` +
    `<w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/>` +
    `<w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>` +
    `</w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>` +
    rows.join("") +
    `</w:tbl>` +
    /* Word requires a paragraph after a table; two adjacent
       tables with nothing between them are merged into one on
       open, which silently joins two unrelated grids. */
    `<w:p/>`
  );
}

/* =========================================================
   BLOCKS
========================================================= */

function blockXml(block: DocumentBlock): string {
  switch (block.type) {
    case "heading":
      return paragraph(block.text, { style: `Heading${block.level}` });

    case "text":
      return paragraph(block.text);

    case "list": {
      /*
       * The marker is literal text rather than a `w:numPr`
       * reference.
       *
       * Real Word numbering needs a `numbering.xml` part, an
       * abstract definition and a concrete instance per list —
       * three more parts and a counter to keep them consistent,
       * for something that renders and prints identically. The
       * cost of the shortcut is honest and small: a reader
       * cannot renumber the list by dragging it.
       *
       * The indent and hanging indent are real, so wrapped
       * lines align under the text rather than under the
       * bullet, which is the part that actually looks wrong
       * when it is missing.
       */
      let ordinal = 1;
      const lines: string[] = [];

      for (const item of block.items) {
        const marker = block.ordered ? `${ordinal}.` : "•";

        lines.push(
          paragraph(`${marker}\t${item}`, {
            style: "ListParagraph",
            indent: 480,
          })
        );

        ordinal += 1;
      }

      return lines.join("");
    }

    case "table":
      return table(block);
  }
}

/* =========================================================
   STYLES

   The ids the reader looks for, defined so Word renders them
   as headings rather than as body text that happens to claim a
   style name it does not have.
========================================================= */

function heading(level: 1 | 2 | 3, size: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
    `<w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:outlineLvl w:val="${level - 1}"/>` +
    `<w:spacing w:before="${level === 1 ? 320 : 240}" w:after="120"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>` +
    `</w:style>`
  );
}

const STYLES =
  `${DECLARATION}<w:styles xmlns:w="${NS_W}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>` +
  `</w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title">` +
  `<w:name w:val="Title"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:after="240"/></w:pPr>` +
  `<w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>` +
  heading(1, 32) +
  heading(2, 26) +
  heading(3, 24) +
  `<w:style w:type="paragraph" w:styleId="ListParagraph">` +
  `<w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:after="60"/></w:pPr></w:style>` +
  `</w:styles>`;

/* =========================================================
   THE PACKAGE
========================================================= */

export function renderDocx(plan: DocumentPlan, deadline: number): Rendered {
  const body: string[] = [paragraph(plan.title, { style: "Title" })];

  let rows = 0;

  for (const block of plan.blocks) {
    if (Date.now() > deadline) {
      throw new RenderRefused(
        "The document took too long to build. Send fewer blocks."
      );
    }

    if (block.type === "table") {
      rows += block.rows.length;
    }

    body.push(blockXml(block));
  }

  const parts: ZipFile[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `${DECLARATION}<Types xmlns="${NS_CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
          `</Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `${DECLARATION}<Relationships xmlns="${NS_PKG}">` +
          `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/>` +
          `</Relationships>`,
        "utf8"
      ),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(
        `${DECLARATION}<Relationships xmlns="${NS_PKG}">` +
          `<Relationship Id="rId1" Type="${NS_R}/styles" Target="styles.xml"/>` +
          `</Relationships>`,
        "utf8"
      ),
    },
    {
      name: "word/document.xml",
      data: Buffer.from(
        `${DECLARATION}<w:document xmlns:w="${NS_W}"><w:body>` +
          body.join("") +
          /* The section properties close the body and set the
             page size. Without them Word opens the document at
             whatever its default is, which is Letter in most of
             the world's installs and A4 in the rest. */
          `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
          `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>` +
          `</w:sectPr></w:body></w:document>`,
        "utf8"
      ),
    },
    { name: "word/styles.xml", data: Buffer.from(STYLES, "utf8") },
  ];

  const bytes = writeZip(parts);

  if (bytes.length > documents.maxBytes) {
    throw new DocumentTooLarge(bytes.length);
  }

  return { bytes, ...(rows > 0 ? { rows } : {}) };
}
