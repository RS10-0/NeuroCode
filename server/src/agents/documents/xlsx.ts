import { documents } from "../../ai/config";
import { escapeXml, writeZip, type ZipFile } from "./zipWriter";
import type { DocumentPlan } from "./plan";
import { DocumentTooLarge, RenderRefused, type Rendered } from "./types";

/*
 * Writing a workbook.
 *
 * An .xlsx is a ZIP of XML parts, so this is a list of strings
 * and one call to the zip writer next door. The interesting
 * decisions are not about the format, they are about what a
 * spreadsheet MEANS when the thing being rendered is a document
 * plan that may be mostly prose.
 *
 * TABLES BECOME SHEETS; EVERYTHING ELSE BECOMES NOTES.
 *
 * A grid format given paragraphs has to do something, and the
 * options are refuse or degrade. Refusing burns one of the
 * model's four steps to teach it something the tool description
 * could have said — so the description says it, and this
 * degrades: every `table` block becomes its own worksheet named
 * after the heading above it, and every other block becomes a
 * row on a leading "Notes" sheet. A learner who asks for a
 * spreadsheet of their sales table gets the sales table, and
 * the sentence introducing it is still in the file.
 *
 * THE PART NAMES AND THE SHARED STRING TABLE ARE NOT ARBITRARY.
 * files/extract/sheet.ts reads workbooks by joining
 * `xl/workbook.xml` to `xl/_rels/workbook.xml.rels` on `r:id`,
 * and resolves shared strings from `xl/sharedStrings.xml`. This
 * writer produces exactly what that reader looks for, which is
 * what lets the verification suite round-trip its own output
 * through the project's own parser rather than eyeballing a
 * file.
 *
 * WHAT THIS WRITER CANNOT EMIT: no `<f>` element anywhere, so
 * nothing in a generated workbook is a formula — a cell whose
 * text begins `=` is a string containing that character and
 * Excel will not evaluate it. No `vbaProject.bin`, which is
 * what makes this an .xlsx and not an .xlsm. No external
 * workbook links, no `TargetMode="External"` relationship, no
 * DDE. Those strings do not appear in this file.
 */

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* =========================================================
   SHEETS OUT OF BLOCKS
========================================================= */

interface Sheet {
  name: string;
  rows: string[][];
}

/*
 * Excel's own rules for a tab name, applied here so a heading
 * can be used as one.
 *
 * The forbidden characters are Excel's, not ours, and a name
 * that breaks them produces a workbook Excel offers to repair
 * — which looks to a learner exactly like a corrupt file.
 * "History" is reserved by Excel itself.
 */
function sheetName(raw: string, taken: Set<string>): string {
  let name = raw
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);

  if (name === "" || name.toLowerCase() === "history") {
    name = "Sheet";
  }

  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${name.slice(0, 31 - String(suffix).length - 1)} ${suffix}`;

    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }

  /* Unreachable at any plausible block count — 98 sheets all
     named the same thing — and handled because the alternative
     is a duplicate tab name, which Excel refuses to open. */
  const fallback = `Sheet ${taken.size + 1}`;
  taken.add(fallback);

  return fallback;
}

function toSheets(plan: DocumentPlan): Sheet[] {
  const taken = new Set<string>();
  const sheets: Sheet[] = [];
  const notes: string[][] = [];

  /* The heading most recently seen, which names the next table.
     A table with no heading above it gets a numbered name. */
  let heading = "";

  for (const block of plan.blocks) {
    switch (block.type) {
      case "heading":
        heading = block.text;
        notes.push([block.text]);
        break;

      case "text":
        notes.push([block.text]);
        break;

      case "list":
        for (const item of block.items) {
          notes.push([item]);
        }
        break;

      case "table": {
        sheets.push({
          name: sheetName(heading || `Table ${sheets.length + 1}`, taken),
          rows: [block.columns, ...block.rows],
        });

        break;
      }
    }
  }

  if (notes.length === 0 && sheets.length === 0) {
    throw new RenderRefused("That document has nothing in it to put in a workbook.");
  }

  if (notes.length === 0) {
    return sheets;
  }

  return [
    { name: sheetName("Notes", taken), rows: [[plan.title], ...notes] },
    ...sheets,
  ];
}

/* =========================================================
   CELLS
========================================================= */

/* "A", "B", ... "AA". Excel's base-26 with no zero, which is
   the inverse of the `columnIndex` the reader uses. */
function columnLetter(index: number): string {
  let letters = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }

  return letters;
}

/*
 * Whether a cell should be written as a number.
 *
 * Deliberately narrow: an optional minus, digits, an optional
 * decimal part, and nothing else. No scientific notation, no
 * thousands separators, no leading plus, no currency symbol.
 *
 * The narrowness is doing two jobs. It means "which region sold
 * most" is answerable in the workbook, because the numbers are
 * numbers and SUM works on them — which is most of why somebody
 * asks for a spreadsheet rather than a document. And it means
 * anything ambiguous stays text, including the shapes that
 * matter: `=SUM(A1:A9)`, `+1-800-000`, `-` on its own. None of
 * those is a formula here in any case — this writer emits no
 * `<f>` element at all — but a value that reads as a formula
 * should also not read as a number.
 */
const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

interface Strings {
  index: Map<string, number>;
  list: string[];
}

function intern(strings: Strings, value: string): number {
  const existing = strings.index.get(value);

  if (existing !== undefined) {
    return existing;
  }

  const at = strings.list.length;

  strings.index.set(value, at);
  strings.list.push(value);

  return at;
}

function cell(
  reference: string,
  value: string,
  strings: Strings,
  bold: boolean
): string {
  const style = bold ? ' s="1"' : "";

  if (value === "") {
    return `<c r="${reference}"${style}/>`;
  }

  if (NUMERIC.test(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }

  return `<c r="${reference}"${style} t="s"><v>${intern(strings, value)}</v></c>`;
}

function sheetXml(sheet: Sheet, strings: Strings): string {
  const rows: string[] = [];

  for (let index = 0; index < sheet.rows.length; index += 1) {
    const cells = sheet.rows[index]
      .map((value, column) =>
        cell(`${columnLetter(column)}${index + 1}`, value, strings, index === 0)
      )
      .join("");

    rows.push(`<row r="${index + 1}">${cells}</row>`);
  }

  return (
    `${DECLARATION}<worksheet xmlns="${NS}"><sheetData>` +
    `${rows.join("")}</sheetData></worksheet>`
  );
}

/* =========================================================
   THE PACKAGE
========================================================= */

/*
 * A minimal style sheet, present for one reason: a bold header
 * row.
 *
 * Style index 1 is the bold one, referenced as `s="1"` on the
 * first row of every sheet. Without it a generated workbook
 * opens with its headings indistinguishable from its data,
 * which is the difference between a table and a pile of cells.
 */
const STYLES =
  `${DECLARATION}<styleSheet xmlns="${NS}">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs></styleSheet>`;

export function renderXlsx(plan: DocumentPlan, deadline: number): Rendered {
  const sheets = toSheets(plan);
  const strings: Strings = { index: new Map(), list: [] };

  const parts: ZipFile[] = [];
  const sheetXmls: string[] = [];

  let rowCount = 0;

  for (let index = 0; index < sheets.length; index += 1) {
    if (Date.now() > deadline) {
      throw new RenderRefused(
        "The workbook took too long to build. Send fewer rows."
      );
    }

    sheetXmls.push(sheetXml(sheets[index], strings));

    /* The header row is not data, and reporting it as such
       would tell a learner their 10-row export has 11 rows. */
    rowCount += Math.max(0, sheets[index].rows.length - 1);
  }

  const overrides = sheets
    .map(
      (_unused, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");

  parts.push({
    name: "[Content_Types].xml",
    data: Buffer.from(
      `${DECLARATION}<Types xmlns="${NS_CT}">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        overrides +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
      "utf8"
    ),
  });

  parts.push({
    name: "_rels/.rels",
    data: Buffer.from(
      `${DECLARATION}<Relationships xmlns="${NS_PKG}">` +
        `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
      "utf8"
    ),
  });

  const sheetTags = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join("");

  parts.push({
    name: "xl/workbook.xml",
    data: Buffer.from(
      `${DECLARATION}<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
        `<sheets>${sheetTags}</sheets></workbook>`,
      "utf8"
    ),
  });

  const sheetRels = sheets
    .map(
      (_unused, index) =>
        `<Relationship Id="rId${index + 1}" Type="${NS_R}/worksheet" ` +
        `Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("");

  parts.push({
    name: "xl/_rels/workbook.xml.rels",
    data: Buffer.from(
      `${DECLARATION}<Relationships xmlns="${NS_PKG}">` +
        sheetRels +
        `<Relationship Id="rId${sheets.length + 1}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/>` +
        `<Relationship Id="rId${sheets.length + 2}" Type="${NS_R}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
      "utf8"
    ),
  });

  for (let index = 0; index < sheetXmls.length; index += 1) {
    parts.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheetXmls[index], "utf8"),
    });
  }

  const items = strings.list
    .map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`)
    .join("");

  parts.push({
    name: "xl/sharedStrings.xml",
    data: Buffer.from(
      `${DECLARATION}<sst xmlns="${NS}" count="${strings.list.length}" ` +
        `uniqueCount="${strings.list.length}">${items}</sst>`,
      "utf8"
    ),
  });

  parts.push({ name: "xl/styles.xml", data: Buffer.from(STYLES, "utf8") });

  const bytes = writeZip(parts);

  if (bytes.length > documents.maxBytes) {
    throw new DocumentTooLarge(bytes.length);
  }

  return { bytes, sheets: sheets.length, rows: rowCount };
}
