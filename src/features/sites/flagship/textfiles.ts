/*
 * Dropping a file onto a flagship page.
 *
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT.
 *
 * The published door takes text and only text. `SendPayload` in
 * useSiteChat is `{ messages: [{ role, content }] }` — there is
 * no attachment channel on a public page, and the agent's
 * `file_analysis` capability, which is real and is on for this
 * agent, is not reachable through it. So this does not upload
 * anything anywhere.
 *
 * What it does instead is the thing that is actually correct
 * for the files these agents are handed: source code and prose
 * are already text. The browser reads it, and its contents go
 * into the message the visitor sends, fenced and labelled with
 * the filename. From the student's side that is a file upload —
 * they drag `main.py` or `essay.md` in and the agent can see
 * it. From the wire's side nothing new happens at all, which is
 * why it needs no server change, no new endpoint, and no
 * capability that might be switched off underneath it.
 *
 * SHARED BY THE WORKBENCH AND THE READING ROOM, which is why
 * the refusals below talk about "text" rather than about code.
 * A per-page voice would have meant two copies of the binary
 * sniff, and the sniff is the part that must not be got wrong
 * twice.
 *
 * The limit of that trade is honest and is enforced below: a
 * PDF, a screenshot of an error, a .docx or a .zip cannot be
 * read this way, and the reader refuses them by name rather
 * than pasting a page of replacement characters into the
 * conversation and letting the model guess.
 *
 * A LEAF MODULE. No imports, no JSX.
 */

export interface CodeFile {
  /* Stable for the life of the attachment, so React can key on
     it and two files with the same name can coexist. */
  id: string;
  name: string;
  /* The fence tag, from the extension. Empty when unknown,
     which fences as a plain block rather than lying about the
     language. */
  lang: string;
  text: string;
  lines: number;
  bytes: number;
}

export type ReadResult =
  | { ok: true; file: CodeFile }
  | { ok: false; name: string; reason: string };

/*
 * 96 KB, and the number is about the conversation rather than
 * about the browser.
 *
 * Everything attached is pasted into a message, so the cap is
 * really a cap on how much of somebody's rate limit one drag
 * can spend. A big hand-written source file is 20–40 KB; the
 * things that blow past 96 KB are minified bundles and vendored
 * dependencies, which are exactly the files nobody wants a
 * coach to read line by line anyway.
 */
export const MAX_FILE_BYTES = 96 * 1024;
export const MAX_FILES = 4;

/*
 * Extension → fence tag.
 *
 * The list leads with what the FAQ on this page already says
 * students turn up with — Python, JavaScript and TypeScript,
 * Java, HTML and CSS, SQL — and then covers the rest of a first
 * two years without trying to be exhaustive. An extension that
 * is not here is still READ, as long as it looks like text; it
 * just gets an untagged fence. Refusing an unfamiliar extension
 * would be the page deciding what counts as programming.
 */
const LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  r: "r",
  m: "matlab",
  lua: "lua",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  txt: "",
  log: "",
  csv: "",
  env: "",
};

/*
 * The ones worth naming in the refusal.
 *
 * A student who drags in a screenshot of a stack trace has done
 * something reasonable and should be told what to do instead,
 * not shown a generic "unsupported file". Everything not listed
 * here still has to pass the text sniff below.
 */
const KNOWN_BINARY: Record<string, string> = {
  pdf: "a PDF",
  png: "an image",
  jpg: "an image",
  jpeg: "an image",
  gif: "an image",
  webp: "an image",
  bmp: "an image",
  heic: "an image",
  zip: "an archive",
  gz: "an archive",
  tar: "an archive",
  rar: "an archive",
  "7z": "an archive",
  exe: "a program",
  dll: "a program",
  docx: "a Word document",
  doc: "a Word document",
  xlsx: "a spreadsheet",
  pptx: "a slide deck",
  class: "compiled Java",
  pyc: "compiled Python",
  jar: "a Java archive",
  mp4: "a video",
  mp3: "audio",
  woff: "a font",
  woff2: "a font",
  ttf: "a font",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function humanSize(bytes: number): string {
  return bytes >= 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${bytes} bytes`;
}

let counter = 0;

/*
 * Reads one file, or explains why it did not.
 *
 * Never throws and never rejects: every failure is an `ok:
 * false` carrying a sentence a fifteen-year-old can act on.
 * The caller renders that sentence next to the drop zone, so a
 * refusal is a visible answer rather than a file that silently
 * did not appear.
 */
export async function readCodeFile(file: File): Promise<ReadResult> {
  const ext = extensionOf(file.name);

  if (KNOWN_BINARY[ext]) {
    return {
      ok: false,
      name: file.name,
      reason: `That is ${KNOWN_BINARY[ext]}, and this page can only read plain text. Open it, select the text, and paste it in instead.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, name: file.name, reason: "That file is empty." };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      name: file.name,
      reason: `That is ${humanSize(file.size)} and the limit is ${humanSize(
        MAX_FILE_BYTES
      )}. Paste just the part you need looked at — a close read of a page beats a skim of a book.`,
    };
  }

  let text: string;

  try {
    text = await file.text();
  } catch {
    return {
      ok: false,
      name: file.name,
      reason: "That file could not be read. Try copying the text in instead.",
    };
  }

  /*
   * The text sniff.
   *
   * `File.text()` decodes as UTF-8 whatever it is handed, so a
   * binary arrives as a wall of U+FFFD rather than as an error.
   * A NUL byte settles it outright; otherwise a file that is
   * more than a tenth replacement characters is not source
   * code, and pasting it would spend somebody's rate limit on
   * gibberish.
   */
  /* Written as an escape rather than as the character it
     matches: a literal NUL in a source file is invisible in
     every editor and the first tool to normalise the file
     would silently delete the check. */
  if (text.includes("\u0000")) {
    return {
      ok: false,
      name: file.name,
      reason: "That looks like a binary file rather than text.",
    };
  }

  /* U+FFFD, the replacement character, for the same reason. */
  const damaged = (text.match(/\uFFFD/g) ?? []).length;

  if (damaged > 0 && damaged / text.length > 0.1) {
    return {
      ok: false,
      name: file.name,
      reason: "That did not decode as text. It may be binary, or in an encoding this page cannot read.",
    };
  }

  if (!text.trim()) {
    return { ok: false, name: file.name, reason: "That file has nothing in it." };
  }

  counter += 1;

  return {
    ok: true,
    file: {
      id: `f${counter}`,
      name: file.name,
      lang: LANGUAGES[ext] ?? "",
      text,
      lines: text.split("\n").length,
      bytes: file.size,
    },
  };
}

/*
 * What gets appended to the message.
 *
 * Fenced and named, because the filename is half of what makes
 * a stack trace readable, and because the transcript has to
 * show exactly what was sent — the same rule `prefix` follows
 * in FlagshipChat. A visitor scrolling back can see the file
 * they attached rather than a note saying one was.
 *
 * THE FENCE IS AS SHORT AS IT IS ALLOWED TO BE, and that is a
 * readability decision rather than a formatting one. A
 * visitor's own turn is deliberately never parsed as markdown
 * — running a stranger's input through that pipeline is
 * surprising at best — so whatever fence goes in here is read
 * by a human as literal characters sitting above their code.
 * Three backticks is the one everybody recognises; a fixed
 * four looked like a typo in the transcript.
 *
 * So it grows only when it has to: CommonMark closes a fence
 * on the first run of at least as many backticks, so a file
 * that itself contains ``` would end its own block early and
 * spill the rest into prose. The fence is therefore one longer
 * than the longest run the file contains, and three whenever
 * the file contains none — which is almost always.
 */
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((most, run) => Math.max(most, run.length), 0);

  return "`".repeat(Math.max(3, longest + 1));
}

export function attachmentBlock(files: CodeFile[]): string {
  if (files.length === 0) {
    return "";
  }

  return files
    .map((file) => {
      const fence = fenceFor(file.text);
      const count = `${file.lines} line${file.lines === 1 ? "" : "s"}`;

      return `${file.name} (${count}):\n\n${fence}${file.lang}\n${file.text}\n${fence}`;
    })
    .join("\n\n");
}

/* For the chip under the drop zone. */
export function describeFile(file: CodeFile): string {
  return `${file.lines} line${file.lines === 1 ? "" : "s"} · ${humanSize(
    file.bytes
  )}`;
}
