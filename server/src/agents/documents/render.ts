import { documents } from "../../ai/config";
import type { DocumentFormat } from "../../ai/types";

import { renderDocx } from "./docx";
import { renderPdf } from "./pdf";
import { renderXlsx } from "./xlsx";
import type { DocumentPlan } from "./plan";
import { RenderRefused, type Rendered } from "./types";

/*
 * One place a document is turned into bytes, and one place a
 * filename is decided.
 *
 * The dispatch is trivial. The filename is not, and it is here
 * rather than in the three writers because it is the one string
 * in this feature that leaves the process in three different
 * kinds of header — a Content-Disposition, an email attachment
 * name, and whatever a browser then writes to a disk.
 */

export const MEDIA_TYPE: Record<DocumentFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/*
 * A filename built from a title, and the model never picks one.
 *
 * That is deliberate and it is the reason this function exists.
 * A model-chosen filename would be untrusted text reaching a
 * Content-Disposition header, an email header, and a
 * filesystem — three parsers with three different sets of
 * characters that mean something. So the title is the only
 * input, and what survives it is a conservative set.
 *
 * What is removed, and why each one matters:
 *
 *   CR and LF, because a newline in a header is header
 *   injection — the classic one, and the only item on this list
 *   that is an attack rather than an annoyance.
 *   Quotes, because the value sits inside a quoted string in
 *   both headers it reaches.
 *   Slashes, backslashes and colons, because they are path
 *   separators on one platform or another.
 *   A leading dot, because a file called ".report" is hidden on
 *   every Unix desktop it lands on.
 *
 * Anything else outside a plain ASCII set is dropped rather
 * than transliterated. A Japanese title produces `document.docx`
 * — which is a worse name and a working download, and the
 * alternative is a header whose encoding a browser has to guess.
 */
export function filenameFor(title: string, format: DocumentFormat): string {
  const cleaned = title
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 80)
    .replace(/[.\s]+$/, "");

  return `${cleaned === "" ? "document" : cleaned}.${format}`;
}

export interface RenderedDocument extends Rendered {
  filename: string;
  format: DocumentFormat;
}

export function render(plan: DocumentPlan): RenderedDocument {
  /*
   * The clock, started here and passed down.
   *
   * A synchronous renderer cannot be aborted mid-call, so this
   * is checked between blocks and between table rows rather
   * than continuously — the per-block caps in plan.ts are what
   * bound the inside of one step. That is an honest limitation
   * rather than a complete guard, and it is the same shape as
   * the one `actions.code.timeoutMs` has: sizes bound the
   * input, and the clock catches work that turned out to be
   * quadratic in something nobody measured.
   */
  const deadline = Date.now() + Math.max(1_000, documents.renderTimeoutMs);

  const rendered =
    plan.format === "pdf"
      ? renderPdf(plan, deadline)
      : plan.format === "xlsx"
        ? renderXlsx(plan, deadline)
        : renderDocx(plan, deadline);

  if (rendered.bytes.length === 0) {
    /* Unreachable — every writer produces a header at minimum —
       and handled because an empty file that downloads as a
       corrupt document is the worst way to find out. */
    throw new RenderRefused("The document came out empty. Try different content.");
  }

  return {
    ...rendered,
    format: plan.format,
    filename: filenameFor(plan.title, plan.format),
  };
}
