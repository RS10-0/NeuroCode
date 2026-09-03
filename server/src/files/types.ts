import type { FileKind } from "../ai/types";

/*
 * The contracts the file layer is built from.
 *
 * Consciously the same shape as server/src/search/types.ts,
 * because the problem is the same one: a capability that must
 * not know, above this directory, which format it is dealing
 * with. An extractor implements `FileExtractor`, the runtime and
 * every caller above it speak only these shapes, and adding
 * PowerPoint later is one new file plus one `register()` call —
 * no change to the runtime, to the Builder, or to a deployed
 * agent.
 *
 * Nothing in here is agent-shaped. This layer answers "what does
 * this file say". Deciding whether to look, how to frame it, and
 * what to do with the answer all happen a level up, in
 * server/src/agents/files.
 */

export type { FileKind };

/*
 * A file that has been accepted but not yet read.
 *
 * `kind` is the server's conclusion from the bytes, not the
 * uploader's claim — see sniff.ts. `name` has already been
 * through `safeFileName`. By the time this shape exists nothing
 * about it comes from a header on trust.
 */
export interface AcceptedFile {
  name: string;
  kind: FileKind;
  /* The media type the bytes actually are. */
  mediaType: string;
  bytes: Buffer;
}

/*
 * One section of a document, in reading order.
 *
 * A section is whatever that format's natural boundary is: a
 * page of a PDF, a sheet of a workbook, the single body of a
 * Word document. It exists so "what does page 4 say?" has an
 * answer — the renderer labels every section, so a page number
 * survives the journey from the file into the prompt.
 */
export interface ExtractedSection {
  /* "Page 4", "Sheet: Q3 Revenue". Shown to the model. */
  label: string;
  text: string;
}

/*
 * What an extractor produces.
 *
 * `truncated` is the field that has to be honest. Every limit in
 * this layer can be reached by an ordinary document nobody was
 * trying to abuse, and the only unacceptable outcome is the one
 * where the model answers from three quarters of a report while
 * everybody involved believes it read all of it.
 */
export interface ExtractedFile {
  kind: FileKind;
  sections: ExtractedSection[];
  /* True when a limit stopped the read early. The renderer says
     so in the prompt and the Test panel says so on screen. */
  truncated: boolean;
  /* Why it stopped, in a sentence written for the learner.
     Present only when `truncated`. */
  truncationNote?: string;
  /* Format-specific counts, for the telemetry the owner sees. */
  pages?: number;
  sheets?: string[];
  rows?: number;
  /* Set only by the image extractor, which produces no text. */
  image?: ExtractedImage;
}

/*
 * An image, ready to travel with the request.
 *
 * Deliberately not a file path or a URL. See the note on
 * ChatImage in ai/types.ts: an address for an uploaded file is
 * exactly what this feature is not allowed to create.
 */
export interface ExtractedImage {
  mediaType: string;
  dataBase64: string;
  width: number;
  height: number;
}

/*
 * Reads one format.
 *
 * Must throw FileAnalysisError — never a raw parser error — and
 * must respect `signal`, which carries the extraction timeout.
 * A parser handed a structure designed to make it loop is the
 * failure mode no size limit catches, so honouring the signal is
 * not optional politeness.
 */
export interface FileExtractor {
  readonly kind: FileKind;
  readonly displayName: string;
  extract(file: AcceptedFile, signal: AbortSignal): Promise<ExtractedFile>;
}
