import { malformed, refuseFile } from "../errors";
import { capSections, tidy } from "../text";
import { ZipArchive } from "../zip";
import { attribute, scanXml } from "./xml";
import type { AcceptedFile, ExtractedFile, FileExtractor } from "../types";

/*
 * Reading a Word document.
 *
 * A .docx is a ZIP whose `word/document.xml` holds the body, and
 * the body is a flat list of paragraphs. That is genuinely all
 * the structure there is — Word has no nesting for headings, no
 * sections, no chapters. A heading is a paragraph carrying a
 * style name, and the style name is the only thing that
 * distinguishes "Chapter 3" from a sentence that happens to be
 * short.
 *
 * Which is why styles are read rather than ignored. The question
 * a learner asks about a document is "what does the section on
 * pricing say", and the model can only answer that if the
 * extract still shows where the headings were. So a paragraph
 * styled as a heading comes through prefixed with markdown
 * hashes — not decoration, but the one piece of structure worth
 * carrying, in the notation a model already reads.
 *
 * Tables are flattened to tab-separated rows for the same
 * reason: a table read as prose loses the alignment that made it
 * a table, and a learner asking "what is in the second column"
 * gets nothing back.
 */

const DOCUMENT_PART = "word/document.xml";

/*
 * Word's own style ids for headings, plus the ones its
 * translations and templates use.
 *
 * Matched by prefix rather than by exact value because the id
 * carries the level — Heading1, Heading2 — and the level is
 * what decides how many hashes go in front.
 */
function headingLevel(style: string | null): number {
  if (!style) {
    return 0;
  }

  const match = /^(?:heading|berschrift|titre|ttulo|kop)\s*(\d)/i.exec(
    style.replace(/[^\w\s]/g, "")
  );

  if (match) {
    return Math.min(6, Math.max(1, Number(match[1])));
  }

  /* An untitled document's title paragraph. */
  return /^title$/i.test(style) ? 1 : 0;
}

export const docxExtractor: FileExtractor = {
  kind: "docx",
  displayName: "Word document",

  async extract(file: AcceptedFile, signal: AbortSignal): Promise<ExtractedFile> {
    const archive = ZipArchive.open(file.bytes, file.name);

    const part = archive.read(DOCUMENT_PART, file.name);

    if (!part) {
      throw refuseFile(
        `${file.name} does not contain a Word document body. If it came from another program, try opening it in Word and saving it again.`,
        `${DOCUMENT_PART} missing; entries: ${archive.names().slice(0, 20).join(", ")}`
      );
    }

    let paragraphs: string[];

    try {
      paragraphs = readParagraphs(part.toString("utf8"), signal);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "aborted") {
        throw refuseFile(
          `${file.name} took too long to read. Try a shorter document.`,
          "extraction aborted"
        );
      }

      throw malformed(file.name, "a Word document", cause);
    }

    const text = tidy(paragraphs.join("\n\n"));

    if (!text) {
      throw refuseFile(
        `${file.name} has no text in it. If the content is a picture pasted into the document, attach the picture itself instead.`,
        "document.xml produced no text"
      );
    }

    /*
     * One section, and that is the honest shape. A Word document
     * has no page boundaries until something paginates it —
     * Word's own page numbers come from the layout engine, not
     * from the file — so inventing "Page 3" here would be
     * inventing a fact. The headings inside carry the structure
     * instead.
     */
    const capped = capSections([{ label: "Document", text }], "document");

    return {
      kind: "docx",
      sections: capped.sections,
      truncated: capped.truncated,
      ...(capped.truncationNote
        ? { truncationNote: capped.truncationNote }
        : {}),
    };
  },
};

/*
 * Walks the body, emitting one string per paragraph.
 *
 * The state this tracks is small and all of it earns its place:
 * which paragraph is open, what style it declared, whether we
 * are inside a table cell, and whether the current run is a tab
 * or a line break. Everything else in the schema — revisions,
 * bookmarks, comments anchors, field codes — is markup around
 * the text and is skipped by simply not looking at it.
 */
function readParagraphs(xml: string, signal: AbortSignal): string[] {
  const paragraphs: string[] = [];

  let current: string[] | null = null;
  let style: string | null = null;
  let inText = false;
  let inRow = false;
  let cells: string[] = [];
  let rows: string[] = [];
  let checked = 0;

  const flushParagraph = () => {
    if (!current) {
      return;
    }

    const text = current.join("").trim();
    current = null;

    if (!text) {
      style = null;
      return;
    }

    const level = headingLevel(style);
    style = null;

    const rendered = level > 0 ? `${"#".repeat(level)} ${text}` : text;

    if (inRow) {
      cells.push(text);
      return;
    }

    paragraphs.push(rendered);
  };

  for (const token of scanXml(xml)) {
    /*
     * The abort check is on a counter rather than on every
     * token: `signal.aborted` is a getter across a boundary and
     * a large document produces millions of tokens.
     */
    checked += 1;

    if ((checked & 0x3fff) === 0 && signal.aborted) {
      throw new Error("aborted");
    }

    if (token.type === "text") {
      if (inText && current) {
        current.push(token.text);
      }

      continue;
    }

    const { tag } = token;

    switch (tag.name) {
      case "p":
        if (tag.closing) {
          flushParagraph();
        } else if (!tag.selfClosing) {
          current = [];
        }
        break;

      case "pstyle":
        if (!tag.closing) {
          style = attribute(tag.attributes, "w:val") ?? attribute(tag.attributes, "val");
        }
        break;

      case "t":
        /* `w:t` is the only element whose character data is
           document text. Everything else's is markup. */
        inText = !tag.closing && !tag.selfClosing;
        break;

      case "tab":
        if (!tag.closing && current) {
          current.push("\t");
        }
        break;

      case "br":
      case "cr":
        if (!tag.closing && current) {
          current.push("\n");
        }
        break;

      case "tr":
        if (tag.closing) {
          inRow = false;

          if (cells.length > 0) {
            /*
             * Pipes rather than tabs, matching how the
             * spreadsheet extractor renders a grid. A tab does
             * not survive `tidy`, which collapses runs of
             * whitespace — so a table joined on tabs reaches the
             * model as "Grade Days / Junior 25", which is prose
             * with the columns filed off.
             */
            rows.push(cells.join(" | "));
            cells = [];
          }
        } else if (!tag.selfClosing) {
          inRow = true;
          cells = [];
        }
        break;

      case "tbl":
        if (tag.closing && rows.length > 0) {
          paragraphs.push(rows.join("\n"));
          rows = [];
        }
        break;

      default:
        break;
    }
  }

  /* A document whose final paragraph was never closed. Malformed
     rather than impossible, and its text is still text. */
  flushParagraph();

  if (rows.length > 0) {
    paragraphs.push(rows.join("\n"));
  }

  return paragraphs;
}
