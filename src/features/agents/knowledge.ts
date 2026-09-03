import { authHeaders } from "../../lib/api";
import { newId, type KnowledgeEntry } from "./types";

/*
 * Getting text out of a file the learner picked.
 *
 * Two routes, chosen by extension, and the split is the whole
 * design of this file.
 *
 * Formats whose bytes already ARE the words — .txt, .md, .csv,
 * .json — are read in the browser with `File.text()`. Nothing
 * leaves the tab, nothing is uploaded, and the read costs the
 * learner nothing.
 *
 * Formats that need a real parser — .pdf, .docx, .xlsx — are
 * posted to the server, which has extracted exactly these since
 * File Analysis shipped. They used to be refused here with a
 * sentence explaining that a PDF read as text yields kilobytes
 * of binary that looks like a string to every check in this
 * file, sails into the system prompt, and produces an agent
 * answering from mojibake. That reasoning was right and the
 * conclusion was wrong: the answer was never to refuse the
 * file, it was to read it somewhere a parser exists. The
 * refusal simply outlived the limitation.
 *
 * What has NOT changed is that no file is stored. The document
 * is extracted, the text is returned, the server drops its copy
 * inside the same request, and the entry the learner keeps is
 * an ordinary note — which is why this project still has no
 * storage bucket.
 */

/*
 * 128 KB. Comfortably more than the 8,000-character system
 * budget can hold, so the limit that actually stops a learner is
 * the one that teaches something rather than an arbitrary file
 * size — but small enough that a stray video does not lock the
 * tab up being read into a string.
 */
export const MAX_FILE_BYTES = 128 * 1024;

/*
 * Formats the BROWSER can read on its own.
 *
 * `File.text()` decodes bytes as UTF-8, which is exactly right
 * for these and useless for anything else.
 */
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json"];

/*
 * Formats only the SERVER can read.
 *
 * These used to be absent from the picker entirely, and the
 * refusal was honest at the time: a browser handed a PDF can
 * see its bytes and nothing else, so offering one would have
 * meant putting a page of binary into a system prompt.
 *
 * What made it a bug rather than a limitation is that BuildGentic
 * has extracted these server-side since File Analysis shipped —
 * pdfjs for PDFs, and the same extractors behind Word, Excel and
 * spreadsheets. Nothing was routing knowledge through them, so
 * the capability existed and the knowledge box could not reach
 * it. `readKnowledgeFile` below now does.
 *
 * `.csv` deliberately appears in BOTH lists and is read locally:
 * it is already text, and a round trip to the server to be told
 * so would be slower and would spend the learner's allowance for
 * nothing.
 */
const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".xlsx"];

/* What the file picker offers. Extensions rather than MIME
   types: browsers disagree about the type of a .md file, and
   several report an empty string for it — and a PDF picked from
   a cloud-synced folder can arrive with no type at all. */
export const FILE_ACCEPT = [...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS].join(
  ","
);

export class KnowledgeFileError extends Error {}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function titleOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return base.trim() || name;
}

/*
 * U+FFFD, the replacement character.
 *
 * `File.text()` decodes as UTF-8, and every byte sequence that
 * is not valid UTF-8 comes back as this. Its presence is the
 * cheapest reliable tell that what was read is not text, and it
 * catches the one case the extension check cannot: a binary file
 * somebody renamed to .txt.
 *
 * Built from its code point rather than written as an escape so
 * that nothing in the toolchain has to round-trip an invisible
 * character correctly.
 */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

function looksBinary(text: string): boolean {
  return text.includes(REPLACEMENT_CHAR);
}

export async function readTextFile(file: File): Promise<KnowledgeEntry> {
  const extension = extensionOf(file.name);

  if (!TEXT_EXTENSIONS.includes(extension)) {
    throw new KnowledgeFileError(
      `BuildGentic reads ${[...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS].join(", ")}. Paste the text in as a note instead.`
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new KnowledgeFileError(
      `${file.name} is ${Math.round(file.size / 1024)} KB. The limit is ${
        MAX_FILE_BYTES / 1024
      } KB — and an agent's whole knowledge has to fit in a far smaller budget than that anyway.`
    );
  }

  let text: string;

  try {
    text = await file.text();
  } catch {
    throw new KnowledgeFileError(`${file.name} could not be read.`);
  }

  if (looksBinary(text)) {
    throw new KnowledgeFileError(
      `${file.name} does not appear to be text, despite its name. Paste the text in as a note instead.`
    );
  }

  if (!text.trim()) {
    throw new KnowledgeFileError(`${file.name} is empty.`);
  }

  return {
    id: newId(),
    kind: "file",
    title: titleOf(file.name),
    content: text,
    sourceName: file.name,
    charCount: text.length,
    position: 0,
    status: "inline",
  };
}

export function newNote(position: number): KnowledgeEntry {
  return {
    id: newId(),
    kind: "text",
    title: "",
    content: "",
    sourceName: null,
    charCount: 0,
    position,
    status: "inline",
  };
}

/* Renumbers after an add, a delete or a move, so `position` is
   always 0..n-1 and the stored ordering matches the screen. */
export function reposition(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return entries.map((entry, index) => ({ ...entry, position: index }));
}

/* =========================================================
   DOCUMENTS

   Everything the browser cannot decode itself.
========================================================= */

/*
 * The ceiling on a document, which is far above the plain-text
 * one on purpose.
 *
 * MAX_FILE_BYTES exists because a .txt is read into a string in
 * the tab, and a large one locks it up. A PDF is not read here
 * at all — it is posted, extracted on the server against the
 * server's own byte ceiling, and comes back as text. So the
 * limit that matters is the server's, and this is only a
 * courtesy check so an obviously oversized upload fails
 * instantly rather than after a slow POST.
 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export function isDocument(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(name));
}

interface ExtractResponse {
  name: string;
  kind: string;
  text: string;
  chars: number;
  truncated: boolean;
  truncationNote?: string;
  pages?: number;
}

/*
 * A document becomes a knowledge entry.
 *
 * The bytes go up, the words come back, and the entry that
 * results is indistinguishable from one typed by hand — which
 * is the point. Knowledge is text in a row the learner owns;
 * where the text came from stops mattering the moment it
 * arrives.
 */
export async function readDocumentFile(file: File): Promise<KnowledgeEntry> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new KnowledgeFileError(
      `${file.name} is ${Math.round(file.size / (1024 * 1024))} MB. The limit is ${
        MAX_DOCUMENT_BYTES / (1024 * 1024)
      } MB.`
    );
  }

  let response: Response;

  try {
    response = await fetch("/api/agents/knowledge/extract", {
      method: "POST",
      headers: {
        ...(await authHeaders()),
        /*
         * The name travels in a header because the body is the
         * file itself. `Content-Type` is whatever the browser
         * decided, which for a PDF out of a synced folder is
         * sometimes nothing at all — the server sniffs the
         * bytes rather than believing either.
         */
        "X-File-Name": encodeURIComponent(file.name),
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
  } catch {
    throw new KnowledgeFileError(
      `${file.name} could not be sent. Check your connection and try again.`
    );
  }

  if (!response.ok) {
    let message = `${file.name} could not be read.`;

    try {
      const body = (await response.json()) as { error?: string };

      if (body.error) {
        message = body.error;
      }
    } catch {
      /* Non-JSON body; keep the generic message. */
    }

    throw new KnowledgeFileError(message);
  }

  const extracted = (await response.json()) as ExtractResponse;

  return {
    id: newId(),
    kind: "file",
    title: titleOf(extracted.name || file.name),
    content: extracted.text,
    sourceName: extracted.name || file.name,
    charCount: extracted.text.length,
    position: 0,
    status: "inline",
  };
}

/*
 * The one entry point the Builder calls.
 *
 * Routing on the extension rather than on the MIME type,
 * because the picker already filters on extensions and because
 * `file.type` is the least reliable thing about a File — empty
 * for markdown in several browsers, and empty for anything
 * arriving from a cloud-synced folder.
 */
export function readKnowledgeFile(file: File): Promise<KnowledgeEntry> {
  return isDocument(file.name) ? readDocumentFile(file) : readTextFile(file);
}
