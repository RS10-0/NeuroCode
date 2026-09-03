import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { fileAnalysis } from "../../ai/config";
import { malformed, refuseFile } from "../errors";
import { capSections, tidy } from "../text";
import type {
  AcceptedFile,
  ExtractedFile,
  ExtractedSection,
  FileExtractor,
} from "../types";

/*
 * Reading a PDF.
 *
 * The one format here that is not hand-parsed, and the reason is
 * worth stating rather than apologising for. A ZIP of XML has
 * two record layouts; a PDF has an object graph, five stream
 * filters, cross-reference streams, embedded fonts with their
 * own character maps, and text positioned by a matrix rather
 * than written in order. A hand-rolled reader gets the easy
 * three quarters of that and then silently returns mojibake for
 * every document produced by LaTeX or by a scanner's OCR layer —
 * which is precisely the failure src/features/agents/knowledge.ts
 * refuses to ship, one layer down.
 *
 * So this uses pdf.js, Mozilla's implementation, which is what
 * every browser on the learner's machine already uses to display
 * the same file. It is pinned above the version range of
 * GHSA-hq66-cqwq-w95j — arbitrary JavaScript execution on
 * opening a malicious PDF — which is not an abstract concern for
 * a server that parses documents strangers upload. That is a
 * floor rather than a preference: `npm audit` in server/ is what
 * catches the next one, and this dependency is the reason to run
 * it.
 *
 * The version matters for the options too. pdf.js 6 removed
 * `isEvalSupported` by deleting the eval-based font path that
 * advisory was about, so there is no longer a flag to switch
 * off — which is why one is not set below and why the pin is the
 * mitigation rather than the configuration.
 *
 * Two options that do remain are load-bearing rather than tidy.
 * `disableFontFace` and `useSystemFonts: false` keep font
 * handling inside the library instead of reaching into the host,
 * and neither affects text extraction, which is all this asks
 * for.
 *
 * Page boundaries are the other reason to use it. "What does
 * page 4 say?" is the question people actually ask about a PDF,
 * and it is only answerable if the extract still knows where
 * page 4 was — so pages come back as labelled sections rather
 * than as one flat string.
 */

/*
 * The library is loaded on first use rather than at import.
 *
 * It is several megabytes of parser that most requests to this
 * server never touch, and a dynamic import keeps it out of
 * startup entirely — the same reasoning that lazy-loads the
 * markdown renderer in the browser. The promise is cached, so
 * concurrent uploads share one load.
 */
type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjs: Promise<PdfModule> | null = null;

function loadPdfjs(): Promise<PdfModule> {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

/*
 * A directory of data pdf.js ships alongside itself.
 *
 * Resolved from the package rather than written as a relative
 * path, because "../../node_modules/pdfjs-dist" is only true
 * until somebody hoists a dependency or runs this from a
 * different working directory. `createRequire` gives the same
 * resolution Node itself would use, and works whether this file
 * is loaded as ESM or CJS — which matters, since tsx decides
 * that and the server's tsconfig emits nothing either way.
 *
 * A file:// URL rather than a filesystem path, and with a
 * trailing slash. pdf.js validates both and rejects the whole
 * document if either is wrong — on Windows a bare path fails
 * because its separators are backslashes, and the failure
 * surfaces as "could not read this PDF", which points at the
 * file rather than at the configuration. That cost an hour, so
 * it is written down.
 */
const packagedUrls = new Map<string, string>();

function packaged(directory: string): string {
  const cached = packagedUrls.get(directory);

  if (cached) {
    return cached;
  }

  const url = `${pathToFileURL(
    join(
      dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
      directory
    )
  ).href}/`;

  packagedUrls.set(directory, url);

  return url;
}

export const pdfExtractor: FileExtractor = {
  kind: "pdf",
  displayName: "PDF",

  async extract(file: AcceptedFile, signal: AbortSignal): Promise<ExtractedFile> {
    const pdf = await loadPdfjs();

    let document;
    let loading;

    try {
      loading = pdf.getDocument({
        /*
         * A copy, because pdf.js transfers ownership of the
         * buffer it is handed and detaches it. The original is
         * still held by the upload route and by the store, and a
         * detached buffer there would fail on the next read with
         * something incomprehensible.
         */
        data: new Uint8Array(file.bytes),
        disableFontFace: true,
        useSystemFonts: false,
        /* Nothing on this server should fetch anything on a
           document's behalf. */
        useWorkerFetch: false,
        /*
         * The library's own bundled font metrics, read off disk.
         *
         * A document using the fourteen standard PDF fonts
         * without embedding them needs these to map glyphs back
         * to characters. Without the path pdf.js warns per
         * document and falls back to guessing, which is how a
         * perfectly ordinary PDF comes back with plausible text
         * and the wrong letters.
         */
        standardFontDataUrl: packaged("standard_fonts"),
        /*
         * The predefined Adobe character maps, for the same
         * reason. A PDF using a CID font — which is every PDF
         * containing Japanese, Chinese, Korean or Cyrillic —
         * encodes its text against one of these, and without
         * them the extract is a page of plausible-looking
         * nonsense rather than a refusal. Silent wrongness is
         * the worst outcome available, so the maps are pointed
         * at rather than hoped for.
         */
        cMapUrl: packaged("cmaps"),
        cMapPacked: true,
        /*
         * Errors only.
         *
         * pdf.js warns per document about font data it would
         * need to RENDER the page, which nothing here does — the
         * only thing asked for is text. Left on, every ordinary
         * PDF upload writes a line to the server log that reads
         * like a fault and is not one, which is how real faults
         * stop being noticed.
         *
         * It does not hide anything that matters: a document
         * that genuinely cannot be read throws, and this file
         * turns that into a message the learner sees.
         */
        verbosity: 0,
      });

      document = await loading.promise;
    } catch (cause) {
      /*
       * The commonest real cause by a distance, and worth its
       * own sentence: a PDF the sender protected. Everything
       * else is a corrupt file.
       */
      const message = cause instanceof Error ? cause.message : String(cause);

      if (/password/i.test(message)) {
        throw refuseFile(
          `${file.name} is password-protected, so BuildGentic cannot read it. Save an unprotected copy and attach that.`,
          message
        );
      }

      throw malformed(file.name, "a PDF", cause);
    }

    const sections: ExtractedSection[] = [];

    const pageLimit = Math.min(
      document.numPages,
      Math.max(1, fileAnalysis.maxPdfPages)
    );

    try {
      for (let number = 1; number <= pageLimit; number += 1) {
        if (signal.aborted) {
          throw refuseFile(
            `${file.name} took too long to read. Try a shorter document.`,
            "extraction aborted"
          );
        }

        const page = await document.getPage(number);

        try {
          const content = await page.getTextContent();

          /*
           * pdf.js emits one item per positioned run, with
           * `hasEOL` marking where the layout broke a line.
           * Joining on that rather than on nothing is what keeps
           * a table looking like rows instead of one long
           * sentence.
           */
          let text = "";

          for (const item of content.items) {
            if (!("str" in item)) {
              continue;
            }

            text += item.str;
            text += item.hasEOL ? "\n" : "";
          }

          const tidied = tidy(text);

          if (tidied) {
            sections.push({ label: `Page ${number}`, text: tidied });
          }
        } finally {
          page.cleanup();
        }
      }
    } finally {
      /* Frees the parser's own buffers. Skipping it leaks a few
         megabytes per upload, which on a long-running server is
         the difference between working and being restarted. */
      await loading.destroy();
    }

    if (sections.length === 0) {
      /*
       * A PDF with pages and no text is almost always a scan —
       * an image of a document rather than a document. Saying
       * that is worth far more than "no text found", because it
       * tells the learner what to do about it.
       */
      throw refuseFile(
        `${file.name} has no text BuildGentic can read. It is probably a scan — a picture of a document rather than the words themselves. If it is one page, attaching it as an image works instead.`,
        `${document.numPages} pages, no extractable text`
      );
    }

    const capped = capSections(sections, "page");

    /*
     * Two different truncations, and they are worth reporting
     * separately. The page cap means the document was longer
     * than BuildGentic reads; the character cap means what was
     * read was longer than one prompt holds. A learner facing
     * the first should split the file; a learner facing the
     * second should ask a narrower question.
     */
    const pagesDropped = document.numPages - pageLimit;

    const note = [
      capped.truncationNote,
      pagesDropped > 0
        ? `Only the first ${pageLimit} of ${document.numPages} pages were read.`
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      kind: "pdf",
      sections: capped.sections,
      truncated: capped.truncated || pagesDropped > 0,
      ...(note ? { truncationNote: note } : {}),
      pages: capped.sections.length,
    };
  },
};
