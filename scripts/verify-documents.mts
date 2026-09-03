/*
 * Proof that a generated document is a real file.
 *
 * The claim being tested is not "a writer exists". It is that
 * what these writers produce can be OPENED AND READ BACK, that
 * every ceiling refuses before it allocates, that the PDF's
 * encoding limit is reported rather than hidden, and that
 * nothing in any of the three formats carries a capability an
 * email attachment has no business having.
 *
 * THE ORACLE IS THIS PROJECT'S OWN READER, and that is the
 * point of the suite rather than a convenience. BuildGentic
 * already ships extractors for PDF, XLSX and DOCX, written
 * against real documents from real programs. So every render
 * here is round-tripped back through `extractorFor`, and the
 * assertion is that the title, the headings and the grid
 * survive. A writer verified against the parser that has to
 * open it is verified against something; a writer verified by
 * eye is verified against nothing.
 *
 * Needs no server, no database and no keys — which is itself
 * asserted, because it is the property that keeps a fresh clone
 * able to run this. The stores are the only part of the feature
 * that touches Supabase and they are reached through dynamic
 * imports inside the tools, so nothing in this file loads them.
 *
 *   npx tsx ./scripts/verify-documents.mts
 */

import { extractorFor } from "../server/src/files/extract/index";
import { documents } from "../server/src/ai/config";
import { parsePlan, type DocumentBlock } from "../server/src/agents/documents/plan";
import { render, filenameFor } from "../server/src/agents/documents/render";
import {
  DocumentTooLarge,
  RenderRefused,
} from "../server/src/agents/documents/types";
import { encode, wrap, widthOf } from "../server/src/agents/documents/winansi";
import { ZipArchive } from "../server/src/files/zip";
import type { AcceptedFile } from "../server/src/files/types";

/* ---------------------------------------------------------
   HARNESS
   --------------------------------------------------------- */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* Renders text out of a generated file using the project's own
   extractor for that format — the whole point of the suite. */
async function readBack(
  bytes: Buffer,
  kind: "pdf" | "xlsx" | "docx"
): Promise<string> {
  const file: AcceptedFile = {
    name: `generated.${kind}`,
    kind,
    mediaType: "application/octet-stream",
    bytes,
  };

  const extracted = await extractorFor(kind).extract(
    file,
    new AbortController().signal
  );

  /*
   * Labels as well as text.
   *
   * A section's LABEL is where a sheet name lives — the reader
   * returns "Sheet: Regional breakdown" as the label and the
   * grid as the text — so a round trip that dropped labels
   * would silently stop testing half of what the xlsx writer
   * decides. That cost this suite two wrong results before it
   * was noticed: one failure that was the harness's fault, and
   * one PASS that was passing for the wrong reason, because the
   * sheet name it looked for also happened to appear as a row
   * on the Notes sheet.
   */
  return extracted.sections
    .map((part) => `${part.label}\n${part.text}`)
    .join("\n");
}

function planOf(
  format: "pdf" | "xlsx" | "docx",
  title: string,
  blocks: unknown[]
) {
  const parsed = parsePlan({ format, title, blocks });

  if (!parsed.ok) {
    throw new Error(`fixture did not parse: ${parsed.error}`);
  }

  return parsed.plan;
}

/* A document with one of everything. */
const SAMPLE: unknown[] = [
  { type: "heading", level: 1, text: "Week of 25 August" },
  {
    type: "text",
    text: "Revenue rose twelve percent against the previous week, driven mostly by the northern region.",
  },
  {
    type: "list",
    ordered: false,
    items: ["North beat target", "South was flat", "East is still ramping"],
  },
  { type: "heading", level: 2, text: "Regional breakdown" },
  {
    type: "table",
    columns: ["Region", "Q1", "Q2"],
    rows: [
      ["North", "400", "620"],
      ["South", "310", "290"],
      ["East", "115", "180"],
    ],
  },
];

/* ---------------------------------------------------------
   1. THE PLAN VALIDATOR

   Structural refusals, before a byte is rendered.
   --------------------------------------------------------- */

function checkPlan() {
  section("1. The plan validator");

  check(
    "a good plan parses",
    parsePlan({ format: "pdf", title: "Report", blocks: SAMPLE }).ok
  );

  const badFormat = parsePlan({ format: "html", title: "X", blocks: SAMPLE });
  check(
    "an unknown format is refused",
    !badFormat.ok && badFormat.error.includes("pdf"),
    !badFormat.ok ? badFormat.error.slice(0, 60) : ""
  );

  const badBlock = parsePlan({
    format: "pdf",
    title: "X",
    blocks: [{ type: "image", url: "http://example.com/x.png" }],
  });
  check(
    "an unknown block type is refused and the real ones named",
    !badBlock.ok && badBlock.error.includes("heading"),
    !badBlock.ok ? badBlock.error.slice(0, 70) : ""
  );

  check(
    "a missing title is refused",
    !parsePlan({ format: "pdf", blocks: SAMPLE }).ok
  );

  check(
    "an empty block list is refused",
    !parsePlan({ format: "pdf", title: "X", blocks: [] }).ok
  );

  const tooManyBlocks = parsePlan({
    format: "pdf",
    title: "X",
    blocks: Array.from({ length: documents.maxBlocks + 1 }, () => ({
      type: "text",
      text: "x",
    })),
  });
  check("the block ceiling refuses", !tooManyBlocks.ok);

  const tooManyRows = parsePlan({
    format: "xlsx",
    title: "X",
    blocks: [
      {
        type: "table",
        columns: ["A"],
        rows: Array.from({ length: documents.maxTableRows + 1 }, () => ["x"]),
      },
    ],
  });
  check("the row ceiling refuses", !tooManyRows.ok);

  const tooManyColumns = parsePlan({
    format: "xlsx",
    title: "X",
    blocks: [
      {
        type: "table",
        columns: Array.from(
          { length: documents.maxTableColumns + 1 },
          (_u, i) => `c${i}`
        ),
        rows: [],
      },
    ],
  });
  check("the column ceiling refuses", !tooManyColumns.ok);

  /* The whole-document ceiling, which is the one that bounds
     two hundred individually reasonable blocks. */
  const perBlock = Math.min(documents.maxTextChars, 3_000);
  const needed = Math.ceil(documents.maxTotalChars / perBlock) + 2;
  const tooMuchText = parsePlan({
    format: "pdf",
    title: "X",
    blocks: Array.from({ length: needed }, () => ({
      type: "text",
      text: "x".repeat(perBlock),
    })),
  });
  check(
    "the whole-document character ceiling refuses",
    !tooMuchText.ok && tooMuchText.error.includes("characters"),
    !tooMuchText.ok ? tooMuchText.error.slice(0, 70) : ""
  );

  /* Forgiveness where forgiveness is free. */
  const coerced = parsePlan({
    format: "xlsx",
    title: "X",
    blocks: [
      { type: "table", columns: ["A", "B"], rows: [[1, true], ["only one"]] },
    ],
  });
  check(
    "numbers and booleans in cells are coerced, short rows padded",
    coerced.ok &&
      (coerced.plan.blocks[0] as Extract<DocumentBlock, { type: "table" }>)
        .rows[0][0] === "1" &&
      (coerced.plan.blocks[0] as Extract<DocumentBlock, { type: "table" }>)
        .rows[1].length === 2
  );

  const objectCell = parsePlan({
    format: "xlsx",
    title: "X",
    blocks: [{ type: "table", columns: ["A"], rows: [[{ nested: true }]] }],
  });
  check("an object in a cell is refused", !objectCell.ok);

  const wideRow = parsePlan({
    format: "xlsx",
    title: "X",
    blocks: [{ type: "table", columns: ["A"], rows: [["one", "two"]] }],
  });
  check("a row with more cells than columns is refused", !wideRow.ok);

  const deepHeading = parsePlan({
    format: "pdf",
    title: "X",
    blocks: [{ type: "heading", level: 9, text: "Deep" }],
  });
  check(
    "a heading level past 3 is clamped rather than refused",
    deepHeading.ok &&
      (deepHeading.plan.blocks[0] as Extract<DocumentBlock, { type: "heading" }>)
        .level === 3
  );
}

/* ---------------------------------------------------------
   2. WINANSI

   The encoder that decides what a PDF can say.
   --------------------------------------------------------- */

function checkWinAnsi() {
  section("2. WinAnsi encoding and metrics");

  check("plain ASCII loses nothing", encode("Hello, world!").lost === 0);

  check(
    "accented Latin loses nothing",
    encode("café naïve Köln Ærø").lost === 0
  );

  /* The characters model output is actually full of. Without
     these an ordinary English paragraph would trip the
     refusal threshold. */
  check(
    "curly quotes, dashes and the ellipsis survive",
    encode("‘a’ “b” – — … •").lost === 0,
    "the shapes an LLM writes constantly"
  );

  check("CJK is counted as lost", encode("日本語").lost === 3);

  check("emoji is counted as lost", encode("😀").lost === 1);

  check(
    "a zero-width space is dropped without counting as a loss",
    encode("a​b").lost === 0 && encode("a​b").total === 2
  );

  check(
    "spaces are excluded from the denominator",
    encode("a b c").total === 3,
    "so a line of CJK with spaces reads as mostly lost"
  );

  const widths =
    widthOf("W", 10, false) > widthOf("i", 10, false) &&
    widthOf("iiii", 10, false) < widthOf("WWWW", 10, false);
  check("metrics distinguish wide and narrow glyphs", widths);

  check(
    "an accented letter measures as its base letter",
    Math.abs(widthOf("e", 10, false) - widthOf("é", 10, false)) < 0.001
  );

  const lines = wrap("word ".repeat(60).trim(), 10.5, false, 200);
  check(
    "wrapping breaks a long paragraph into several lines",
    lines.length > 1 &&
      lines.every((line) => widthOf(line, 10.5, false) <= 200),
    `${lines.length} lines, none over the measure`
  );

  const long = wrap("x".repeat(400), 10.5, false, 100);
  check(
    "a single word wider than the measure is broken rather than overflowing",
    long.length > 1 && long.every((l) => widthOf(l, 10.5, false) <= 100)
  );

  const substituted = wrap("日本語", 10.5, false, 200);
  check(
    "a wrapped line is measured on the substituted text",
    substituted.length === 1 &&
      widthOf(substituted[0], 10.5, false) === widthOf("[?][?][?]", 10.5, false),
    "so a line does not overflow by three characters per lost glyph"
  );
}

/* ---------------------------------------------------------
   3. THE PDF
   --------------------------------------------------------- */

async function checkPdf() {
  section("3. PDF");

  const result = render(planOf("pdf", "Weekly sales report", SAMPLE));

  check(
    "it starts with a PDF header and ends with EOF",
    result.bytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
      result.bytes.subarray(-6).toString("latin1").trim() === "%%EOF",
    `${Math.round(result.bytes.length / 1024)} KB`
  );

  check("it reports a page count", (result.pages ?? 0) >= 1);

  check(
    "the filename is built from the title",
    result.filename === "Weekly sales report.pdf",
    result.filename
  );

  /* The round trip, through this project's own PDF reader. */
  const text = await readBack(result.bytes, "pdf");

  check(
    "the title survives a round trip through the project's own reader",
    text.includes("Weekly sales report"),
    text.slice(0, 60).replace(/\s+/g, " ")
  );

  check(
    "a heading survives the round trip",
    text.includes("Regional breakdown")
  );

  check(
    "body text survives the round trip",
    text.includes("twelve percent")
  );

  check(
    "table cells survive the round trip",
    text.includes("North") && text.includes("620")
  );

  /* What the writer must never emit, because these files go
     into somebody's inbox. */
  const raw = result.bytes.toString("latin1");
  const forbidden = [
    "/JavaScript",
    "/JS",
    "/OpenAction",
    "/AA",
    "/Launch",
    "/EmbeddedFile",
    "/RichMedia",
    "/URI",
    "/Annots",
  ];

  for (const key of forbidden) {
    check(`the PDF carries no ${key}`, !raw.includes(key));
  }

  /* The title rule: zero tolerance. */
  let titleRefused = false;
  let titleMessage = "";

  try {
    render(planOf("pdf", "売上報告 2026", SAMPLE));
  } catch (error) {
    titleRefused = error instanceof RenderRefused;
    titleMessage = error instanceof Error ? error.message : "";
  }

  check(
    "a title with unrenderable characters refuses the whole PDF",
    titleRefused && titleMessage.includes("docx"),
    "and names docx as the recovery"
  );

  /* The body rule: a proportion, substituted below it. */
  const mostlyFine = render(
    planOf("pdf", "Mostly English", [
      {
        type: "text",
        text: `${"The quick brown fox jumps over the lazy dog. ".repeat(12)}日`,
      },
    ])
  );

  check(
    "a body under the threshold renders and reports the loss",
    mostlyFine.degraded !== undefined &&
      mostlyFine.degraded.includes("could not be drawn"),
    mostlyFine.degraded?.slice(0, 70)
  );

  const readable = await readBack(mostlyFine.bytes, "pdf");
  check(
    "the substitution is visible in the file",
    readable.includes("[?]"),
    "a reader can tell a placeholder from text the agent wrote"
  );

  let bodyRefused = false;
  let bodyMessage = "";

  try {
    render(
      planOf("pdf", "English title", [
        { type: "text", text: "日本語".repeat(40) },
      ])
    );
  } catch (error) {
    bodyRefused = error instanceof RenderRefused;
    bodyMessage = error instanceof Error ? error.message : "";
  }

  check(
    "a body over the threshold is refused",
    bodyRefused && bodyMessage.includes("docx"),
    bodyMessage.slice(0, 70)
  );

  /* Multi-page, which exercises the page-break path and the
     xref table's offsets for more than one page object. */
  /*
   * Sized to paginate while staying under the READER'S own
   * extraction ceiling — `fileAnalysis.maxExtractedChars`,
   * 10,000.
   *
   * A longer fixture proves nothing about the writer. The
   * reader truncates it and the assertion below then fails on
   * somebody else's limit rather than on an xref offset, which
   * is exactly what happened on this suite's first run.
   */
  const long = render(
    planOf(
      "pdf",
      "Long report",
      Array.from({ length: 80 }, (_u, index) => ({
        type: "text",
        text: `Paragraph ${index + 1}. Filler sentence for the page.`,
      }))
    )
  );

  check(
    "a long document paginates",
    (long.pages ?? 0) > 1,
    `${long.pages} pages`
  );

  const longText = await readBack(long.bytes, "pdf");
  check(
    "the last page of a long document is readable",
    longText.includes("Paragraph 80"),
    "so the xref offsets are right for every page"
  );

  /* A wide table, which exercises the column-width clamp. */
  const wide = render(
    planOf("pdf", "Wide table", [
      {
        type: "table",
        columns: ["A", "B", "C", "D", "E", "F", "G", "H"],
        rows: [
          [
            "a value that is quite long indeed",
            "b",
            "c",
            "d",
            "e",
            "f",
            "g",
            "h",
          ],
        ],
      },
    ])
  );

  const wideText = await readBack(wide.bytes, "pdf");
  check(
    "a wide table still renders every column",
    ["b", "c", "d", "e", "f", "g", "h"].every((cell) =>
      wideText.includes(cell)
    ),
    "the minimum column width holds"
  );
}

/* ---------------------------------------------------------
   4. XLSX
   --------------------------------------------------------- */

async function checkXlsx() {
  section("4. XLSX");

  const result = render(planOf("xlsx", "Sales", SAMPLE));

  check(
    "it is a ZIP",
    result.bytes.subarray(0, 2).toString("latin1") === "PK",
    `${Math.round(result.bytes.length / 1024)} KB`
  );

  const archive = ZipArchive.open(result.bytes, "generated.xlsx");
  const names = archive.names();

  check(
    "[Content_Types].xml is the first entry",
    names[0] === "[Content_Types].xml"
  );

  for (const part of [
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/sharedStrings.xml",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
  ]) {
    check(`it contains ${part}`, names.includes(part));
  }

  check(
    "it carries no macro part",
    !names.some((name) => name.toLowerCase().includes("vbaproject"))
  );

  const text = await readBack(result.bytes, "xlsx");

  check(
    "the table becomes a sheet named after its heading",
    text.includes("Regional breakdown"),
    "the reader reports sheet names"
  );

  check(
    "the grid survives the round trip",
    text.includes("North") && text.includes("620") && text.includes("Region")
  );

  check(
    "prose lands on a Notes sheet",
    text.includes("Notes") && text.includes("twelve percent")
  );

  /* Numbers are numbers, so SUM works — which is most of why
     somebody asks for a spreadsheet. */
  const sheet = archive.read("xl/worksheets/sheet2.xml", "x")?.toString("utf8") ?? "";

  check(
    "numeric cells are written as numbers, not strings",
    /<c r="B2"[^>]*><v>400<\/v><\/c>/.test(sheet),
    "so the workbook can be computed in"
  );

  /* The injection shape, which is the reason nothing here is
     ever written as a formula. */
  const formula = render(
    planOf("xlsx", "Injection", [
      {
        type: "table",
        columns: ["Value"],
        rows: [["=SUM(A1:A9)"], ["+1-800-EVIL"], ["-2"], ["@here"]],
      },
    ])
  );

  const formulaArchive = ZipArchive.open(formula.bytes, "x");
  const formulaSheet =
    formulaArchive.read("xl/worksheets/sheet1.xml", "x")?.toString("utf8") ?? "";

  check(
    "no cell is ever written as a formula",
    !formulaSheet.includes("<f>") && !formulaSheet.includes("<f "),
    "there is no formula branch in the writer at all"
  );

  check(
    "a cell beginning = is stored as a shared string",
    /<c r="A2"[^>]*t="s"/.test(formulaSheet),
    "so Excel shows the text rather than evaluating it"
  );

  check(
    "a genuinely negative number is still a number",
    /<c r="A4"[^>]*><v>-2<\/v><\/c>/.test(formulaSheet)
  );

  /* XML escaping, in the direction the reader has to undo. */
  const escaped = render(
    planOf("xlsx", "Escapes", [
      {
        type: "table",
        columns: ["Raw"],
        rows: [['a & b < c > d " e \' f']],
      },
    ])
  );

  const escapedText = await readBack(escaped.bytes, "xlsx");
  check(
    "XML metacharacters round-trip intact",
    escapedText.includes('a & b < c > d " e'),
    escapedText.split("\n").find((l) => l.includes("a &"))?.slice(0, 50)
  );

  check(
    "unicode is unharmed in a workbook",
    (await readBack(
      render(
        planOf("xlsx", "Unicode", [
          { type: "table", columns: ["JP"], rows: [["日本語"]] },
        ])
      ).bytes,
      "xlsx"
    )).includes("日本語"),
    "OOXML is UTF-8, so nothing is lost"
  );
}

/* ---------------------------------------------------------
   5. DOCX
   --------------------------------------------------------- */

async function checkDocx() {
  section("5. DOCX");

  const result = render(planOf("docx", "Weekly sales report", SAMPLE));

  check("it is a ZIP", result.bytes.subarray(0, 2).toString("latin1") === "PK");

  const archive = ZipArchive.open(result.bytes, "generated.docx");
  const names = archive.names();

  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/styles.xml",
  ]) {
    check(`it contains ${part}`, names.includes(part));
  }

  const document = archive.read("word/document.xml", "x")?.toString("utf8") ?? "";

  check("it carries no field instructions", !document.includes("fldSimple"));
  check("it carries no hyperlink", !document.includes("hyperlink"));
  check(
    "no relationship points outside the package",
    !(
      archive.read("word/_rels/document.xml.rels", "x")?.toString("utf8") ?? ""
    ).includes("External")
  );
  check(
    "it carries no macro part",
    !names.some((name) => name.toLowerCase().includes("vbaproject"))
  );

  const text = await readBack(result.bytes, "docx");

  check(
    "the title survives the round trip",
    text.includes("Weekly sales report")
  );

  /* The reader turns a Heading style back into markdown hashes.
     This is the assertion that the style ids the writer emits
     are the ones the reader recognises. */
  check(
    "a level-1 heading round-trips as a heading, not as body text",
    text.includes("# Week of 25 August"),
    text.split("\n").find((l) => l.startsWith("#"))?.slice(0, 40)
  );

  check(
    "a level-2 heading round-trips at its own level",
    text.includes("## Regional breakdown")
  );

  check(
    "a real table round-trips as a grid, not as prose",
    text.includes("North | 400 | 620"),
    text.split("\n").find((l) => l.includes("North"))?.slice(0, 40)
  );

  check("list items survive", text.includes("North beat target"));

  check(
    "unicode is unharmed in a Word document",
    (
      await readBack(
        render(
          planOf("docx", "Unicode report", [
            { type: "text", text: "日本語 Ελλάδα 😀" },
          ])
        ).bytes,
        "docx"
      )
    ).includes("日本語"),
    "which is why the PDF refusal names this format"
  );

  const unicodeTitle = render(
    planOf("docx", "売上報告 2026", SAMPLE)
  );
  check(
    "a title a PDF would refuse is fine here",
    unicodeTitle.bytes.length > 0 && unicodeTitle.degraded === undefined
  );
}

/* ---------------------------------------------------------
   6. FILENAMES AND THE SIZE CEILING
   --------------------------------------------------------- */

function checkFilenamesAndSize() {
  section("6. Filenames and the size ceiling");

  check(
    "a header injection attempt is stripped",
    !filenameFor('a"\r\nBcc: x@y.z', "pdf").includes("\n") &&
      !filenameFor('a"\r\nBcc: x@y.z', "pdf").includes('"'),
    filenameFor('a"\r\nBcc: x@y.z', "pdf")
  );

  check(
    "path separators are stripped",
    filenameFor("../../etc/passwd", "pdf") === "etc passwd.pdf",
    filenameFor("../../etc/passwd", "pdf")
  );

  check(
    "a leading dot cannot make a hidden file",
    !filenameFor(".hidden", "pdf").startsWith("."),
    filenameFor(".hidden", "pdf")
  );

  check(
    "a title with no usable characters still produces a name",
    filenameFor("日本語", "docx") === "document.docx",
    filenameFor("日本語", "docx")
  );

  check(
    "the extension always matches the format",
    filenameFor("x", "xlsx").endsWith(".xlsx")
  );

  /* The rendered-bytes ceiling refuses rather than truncating,
     because half a PDF is not a smaller PDF. */
  let tooLarge = false;

  const originalMax = documents.maxBytes;

  try {
    /* A tiny ceiling proves the branch without needing a
       document that genuinely reaches a megabyte, which the
       character caps make impossible anyway. */
    (documents as { maxBytes: number }).maxBytes = 500;
    render(planOf("pdf", "Over the ceiling", SAMPLE));
  } catch (error) {
    tooLarge = error instanceof DocumentTooLarge;
  } finally {
    (documents as { maxBytes: number }).maxBytes = originalMax;
  }

  check(
    "a document over the byte ceiling is refused, not truncated",
    tooLarge
  );
}

/* ---------------------------------------------------------
   7. NO DATABASE

   The property that keeps a fresh clone able to run this at
   all: the catalogue, the descriptions and the renderers load
   with no Supabase variables set, because the stores are
   reached through dynamic imports inside the tools.
   --------------------------------------------------------- */

async function checkNoDatabase() {
  section("7. Loading without a database");

  const catalog = await import("../server/src/agents/actions/catalog");

  check(
    "the catalogue loads and lists the new tools",
    catalog.isToolId("make_document") &&
      catalog.isToolId("data_get") &&
      catalog.isToolId("data_set") &&
      catalog.isToolId("data_list") &&
      catalog.isToolId("data_delete")
  );

  /*
   * The Phase 1 and Phase 3 capabilities, with the email flags
   * stated as false rather than omitted.
   *
   * Omitting them still compiled here — scripts are outside
   * both tsconfigs — and it made the assertion below quietly
   * wrong the day the Email Agent shipped: it said "every
   * capability on" while switching three of them off, and
   * passed because the count it checked had not moved.
   *
   * Stating the answer is the same discipline every door in
   * server/src follows, and the label now says what is actually
   * being asserted.
   */
  const all = catalog.toolsFor({
    codeExecution: true,
    httpActions: true,
    documentGeneration: true,
    dataStore: true,
    emailRead: false,
    emailDraft: false,
    emailOrganize: false,
  });

  check(
    "the Phase 1 and Phase 3 capabilities together offer seven tools",
    all.length === 7,
    `${all.length}`
  );

  check(
    "and none of them is an email tool",
    !all.some((tool) => (tool.id as string).startsWith("email_")),
    "a capability must not grant tools from a capability nobody switched on"
  );

  check(
    "each capability gates only its own tools",
    catalog.toolsFor({
      codeExecution: false,
      httpActions: false,
      documentGeneration: true,
      dataStore: false,
      emailRead: false,
      emailDraft: false,
      emailOrganize: false,
    }).length === 1 &&
      catalog.toolsFor({
        codeExecution: false,
        httpActions: false,
        documentGeneration: false,
        dataStore: true,
        emailRead: false,
        emailDraft: false,
        emailOrganize: false,
      }).length === 4
  );

  check(
    "every tool description renders without a database",
    all.every((tool) => tool.description().length > 50)
  );
}

/* ---------------------------------------------------------
   MAIN
   --------------------------------------------------------- */

async function main() {
  console.log("\nDOCUMENT GENERATION — offline verification");
  console.log("Round-tripped through this project's own extractors.\n");

  checkPlan();
  checkWinAnsi();
  await checkPdf();
  await checkXlsx();
  await checkDocx();
  checkFilenamesAndSize();
  await checkNoDatabase();

  console.log(`\n=== SUMMARY ===`);
  console.log(`  ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log(`\n  Failed:`);
    for (const label of failures) {
      console.log(`    - ${label}`);
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

void main();
