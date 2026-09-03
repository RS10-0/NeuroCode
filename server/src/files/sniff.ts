import { fileAnalysis } from "../ai/config";
import { collapse } from "../search/sanitize";
import { refuseFile } from "./errors";
import type { AcceptedFile, FileKind } from "./types";

/*
 * Deciding what an uploaded file actually is.
 *
 * This file is a security boundary and it has one rule: nothing
 * the uploader says is believed. Not the filename, not the
 * extension, not the Content-Type header. All three are strings
 * an attacker writes; the bytes are the only part of an upload
 * that has to be true.
 *
 * So `kind` comes from magic bytes, and the declared type is
 * used for exactly one thing — telling a ZIP that is a Word
 * document from a ZIP that is a spreadsheet, which are the same
 * four opening bytes and are distinguished by what is inside the
 * archive rather than by anything the caller claimed.
 *
 * The other half of the job is the filename, which is untrusted
 * in a different way. It never touches the filesystem — nothing
 * here writes a file — so path traversal is not the threat.
 * Two others are. A filename is echoed back to the browser and
 * put into the model's prompt, so it can carry markup, control
 * characters, bidirectional overrides that make "report.pdf.exe"
 * read as "report.exe.fdp", and — the one that matters most
 * here — a sentence addressed to the model. `safeFileName`
 * flattens all of it.
 */

/* =========================================================
   FILENAMES
========================================================= */

const MAX_NAME_CHARS = 120;

/*
 * A filename, made safe to print, to prompt with, and to render
 * in a browser.
 *
 * Path separators go even though nothing here writes to disk: a
 * name containing "../" in a UI is a name that will eventually
 * be pasted into something that does, and the cost of removing
 * it now is nothing.
 *
 * Never empty. A file with no usable name gets a generic one
 * rather than an empty string, because every layer above this
 * displays it and an empty label reads as a bug.
 */
export function safeFileName(raw: unknown): string {
  if (typeof raw !== "string") {
    return "attachment";
  }

  /*
   * `collapse` is the search layer's, reused rather than
   * reimplemented. It drops control characters and
   * bidirectional overrides and squeezes whitespace, which is
   * exactly the treatment a filename needs and exactly the
   * treatment a search snippet needs: untrusted text on its way
   * to a prompt and to a browser. A second copy of that
   * character class would be a second thing to keep correct.
   */
  const flattened = collapse(raw)
    /* Both separators, on every platform. */
    .replace(/[/\\]+/g, " ")
    /* Angle brackets and quotes, so a name cannot be markup. */
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!flattened) {
    return "attachment";
  }

  if (flattened.length <= MAX_NAME_CHARS) {
    return flattened;
  }

  /*
   * Cut from the middle, keeping the extension. A name cut from
   * the end loses the one part a learner uses to recognise it,
   * and a hundred-character prefix is not more useful than
   * "verylongname….pdf".
   */
  const dot = flattened.lastIndexOf(".");
  const extension =
    dot > 0 && flattened.length - dot <= 12 ? flattened.slice(dot) : "";

  return `${flattened
    .slice(0, MAX_NAME_CHARS - extension.length - 1)
    .trim()}…${extension}`;
}

/*
 * A filename that arrived in an HTTP header.
 *
 * Headers are latin-1, so a client sending "rapport-été.pdf"
 * raw either throws in the browser or arrives as mojibake. Both
 * sides therefore percent-encode it, and this undoes that before
 * the sanitiser runs — decode first, then strip, which is the
 * only order that works: sanitising first would leave "%2e%2e%2f"
 * intact and decode it into a path afterwards.
 *
 * A malformed sequence is kept as written rather than throwing.
 * `decodeURIComponent` rejects a lone "%" — which a filename may
 * legitimately contain — and refusing an upload over a
 * punctuation mark in its name would be absurd.
 */
export function fileNameFromHeader(raw: unknown): string {
  if (typeof raw !== "string") {
    return safeFileName(raw);
  }

  try {
    return safeFileName(decodeURIComponent(raw));
  } catch {
    return safeFileName(raw);
  }
}

/* =========================================================
   MAGIC BYTES
========================================================= */

function startsWith(bytes: Buffer, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }

  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      return false;
    }
  }

  return true;
}

const PDF = [0x25, 0x50, 0x44, 0x46]; /* %PDF */
const ZIP = [0x50, 0x4b, 0x03, 0x04]; /* PK\x03\x04 */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/*
 * Which OOXML package this is.
 *
 * DOCX and XLSX are both ZIP archives with identical first
 * bytes, so the format is decided by what the archive contains.
 * A Word package holds its parts under `word/` and a workbook
 * holds its under `xl/`, and those names appear as plain text in
 * the archive's local file headers — which is a fact about the
 * file rather than a claim about it, and is therefore the right
 * thing to read.
 *
 * A scan of the first few kilobytes rather than a full ZIP
 * parse, because this runs before the file has been accepted and
 * the cheapest possible answer is the right one at that point.
 * The real parse happens in the extractor, by which time the
 * size limit has already bounded what it can be handed.
 *
 * A package whose parts are ordered unusually enough to push
 * both names past 8 kB is refused rather than guessed at. That
 * is the correct failure: it names the problem, and the file
 * can be re-saved.
 */
function ooxmlKind(bytes: Buffer): FileKind | null {
  const head = bytes.subarray(0, Math.min(bytes.length, 8192)).toString(
    "latin1"
  );

  if (head.includes("word/")) {
    return "docx";
  }

  if (head.includes("xl/")) {
    return "xlsx";
  }

  return null;
}

/*
 * Whether these bytes are plausibly a delimited text file.
 *
 * CSV has no magic bytes — it is text, and text is whatever is
 * left. So this is the one kind decided by exclusion, and the
 * check has to be genuinely conservative: accepting "anything
 * that is not one of the others" would let a renamed executable
 * through to a parser expecting rows.
 *
 * Valid UTF-8 with no NUL bytes and no dense run of control
 * characters. A binary file fails all three within its first
 * kilobyte, essentially always.
 */
function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));

  if (sample.includes(0x00)) {
    return false;
  }

  /*
   * `fatal: true` is what makes this a real check. The lenient
   * decoder replaces every invalid sequence with U+FFFD and
   * cheerfully returns a string, so a JPEG would "decode"
   * perfectly and look like text to anything that only counted
   * characters.
   */
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
  } catch {
    return false;
  }

  let control = 0;

  for (const byte of sample) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      control += 1;
    }
  }

  return control === 0;
}

/* =========================================================
   ACCEPTANCE
========================================================= */

export interface SniffInput {
  /* Whatever the caller called it. Untrusted. */
  name: unknown;
  /* Whatever the caller said it was. Untrusted, and used only
     to disambiguate text formats that have no signature. */
  declaredType: unknown;
  bytes: Buffer;
}

/* The formats a learner can be told about, in one sentence. */
export const SUPPORTED_DESCRIPTION =
  "PDF, Word (.docx), Excel (.xlsx), CSV, and PNG or JPEG images";

/*
 * The extensions the browser's file picker offers.
 *
 * Published to the client so the picker and the server agree.
 * They are a convenience for the person choosing a file and
 * nothing more — the server decides what a file is from its
 * bytes, so a renamed file is caught here regardless of what
 * the picker allowed.
 */
export const FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
];

const MEDIA_TYPES: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  image: "image/png",
};

/*
 * Turns raw bytes into something the extractors will accept, or
 * refuses with a sentence naming what went wrong.
 *
 * The order matters. Emptiness and size are checked first,
 * because they are the two failures that cost nothing to detect
 * and are by far the commonest. Format comes last, because it is
 * the only one that involves looking at the file at all.
 */
export function sniff(input: SniffInput): AcceptedFile {
  const name = safeFileName(input.name);
  const { bytes } = input;

  if (bytes.length === 0) {
    throw refuseFile(`${name} is empty — there is nothing in it to read.`);
  }

  if (bytes.length > fileAnalysis.maxFileBytes) {
    throw refuseFile(
      `${name} is ${describeBytes(bytes.length)}. The limit is ${describeBytes(
        fileAnalysis.maxFileBytes
      )}. Try a smaller file, or the part of it you actually want to ask about.`
    );
  }

  if (startsWith(bytes, PDF)) {
    return { name, kind: "pdf", mediaType: MEDIA_TYPES.pdf, bytes };
  }

  if (startsWith(bytes, PNG)) {
    return checkImage(name, "image/png", bytes);
  }

  if (startsWith(bytes, JPEG)) {
    return checkImage(name, "image/jpeg", bytes);
  }

  if (startsWith(bytes, ZIP)) {
    const kind = ooxmlKind(bytes);

    if (!kind) {
      throw refuseFile(
        `${name} is a zip archive rather than a document BuildGentic can read. Unzip it and attach the file you want to ask about — BuildGentic reads ${SUPPORTED_DESCRIPTION}.`
      );
    }

    return { name, kind, mediaType: MEDIA_TYPES[kind], bytes };
  }

  if (looksLikeText(bytes)) {
    /*
     * The one place the declared type is consulted, and even
     * here it only ever narrows. Plain text that is not
     * delimited is still handed to the CSV extractor, which
     * reads a single-column file perfectly sensibly — the
     * alternative is refusing a .txt on a technicality.
     */
    return { name, kind: "csv", mediaType: textTypeOf(input.declaredType), bytes };
  }

  throw refuseFile(
    `BuildGentic cannot read ${name}. It reads ${SUPPORTED_DESCRIPTION}, and this file is not one of them — whatever its name says.`
  );
}

function textTypeOf(declared: unknown): string {
  return typeof declared === "string" && declared.startsWith("text/")
    ? "text/plain"
    : MEDIA_TYPES.csv;
}

/*
 * Images get a second, lower ceiling.
 *
 * Not duplication of the size check above. An image is the one
 * kind that is not reduced to text before it goes anywhere: the
 * bytes themselves travel to the provider, base64'd, so its size
 * is a direct cost on every request it rides along with rather
 * than an input to a parser that shrinks it.
 */
function checkImage(
  name: string,
  mediaType: string,
  bytes: Buffer
): AcceptedFile {
  if (bytes.length > fileAnalysis.maxImageBytes) {
    throw refuseFile(
      `${name} is ${describeBytes(
        bytes.length
      )}. Images have a lower limit than documents — ${describeBytes(
        fileAnalysis.maxImageBytes
      )} — because the picture itself is sent to the model rather than a description of it.`
    );
  }

  return { name, kind: "image", mediaType, bytes };
}

export function describeBytes(count: number): string {
  if (count >= 1024 * 1024) {
    return `${(count / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(count / 1024))} KB`;
}
