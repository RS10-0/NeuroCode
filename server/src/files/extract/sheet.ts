import { fileAnalysis } from "../../ai/config";
import { malformed, refuseFile } from "../errors";
import { capSections, clip } from "../text";
import { ZipArchive } from "../zip";
import { attribute, scanXml } from "./xml";
import type {
  AcceptedFile,
  ExtractedFile,
  ExtractedSection,
  FileExtractor,
} from "../types";

/*
 * Reading a spreadsheet — .xlsx and .csv, in one file because
 * the hard part is not the format.
 *
 * The hard part is that a spreadsheet is the one attachment
 * people ask arithmetic about. "Which region sold most?" is not
 * a question about a document; it is a question about numbers
 * that the model has to add up, and getting it right depends
 * entirely on whether the grid survived the trip.
 *
 * So the rendering is deliberate. Rows come through as
 * pipe-delimited lines with the header row kept and marked,
 * because a model given "Region | Q1 | Q2" and then "North |
 * 400 | 620" can align a value to a column, and a model given
 * prose cannot. Every sheet is labelled with its own name and
 * its real dimensions, so "there are 900 rows and you were shown
 * 400" is a statement the model can make instead of quietly
 * summing the part it happened to see.
 *
 * The one thing this file will not do is compute anything.
 * Formulas are read as their cached values — what Excel last
 * calculated — and never evaluated. Evaluating somebody else's
 * formula is running somebody else's program, which is a
 * capability BuildGentic has deliberately not built (see
 * `code_execution`, still marked Soon), and a spreadsheet is not
 * the place to smuggle it in.
 */

/* =========================================================
   RENDERING A GRID

   Shared by both formats, so a CSV and the same data pasted
   into Excel reach the model looking identical. An agent whose
   answer depended on which program the learner happened to use
   would be an agent nobody could reason about.
========================================================= */

interface Grid {
  name: string;
  rows: string[][];
  /* What the file actually held, before the row and column caps.
     The difference is what the model is told about. */
  totalRows: number;
  totalColumns: number;
}

function renderGrid(grid: Grid): ExtractedSection {
  const lines: string[] = [];

  const shown = grid.rows.length;
  const columns = Math.min(grid.totalColumns, fileAnalysis.maxColumns);

  lines.push(
    `${grid.totalRows} row${grid.totalRows === 1 ? "" : "s"} and ${
      grid.totalColumns
    } column${grid.totalColumns === 1 ? "" : "s"} in total.` +
      (shown < grid.totalRows
        ? ` The first ${shown} rows are shown below; the rest were not sent, so do not total this data as if it were complete.`
        : "") +
      (columns < grid.totalColumns
        ? ` Only the first ${columns} columns are shown.`
        : "")
  );

  grid.rows.forEach((row, index) => {
    const cells = row
      .slice(0, columns)
      .map((cell) => clip(cell.replace(/[|\r\n\t]+/g, " ").trim(), fileAnalysis.maxCellChars));

    /*
     * Row 1 is the header and is labelled as such. Everything
     * below carries its spreadsheet row number, which is what
     * makes "row 14 is wrong" a sentence with a referent — and
     * it is 1-based, matching what the learner sees in Excel
     * rather than what an array index would say.
     */
    lines.push(
      index === 0
        ? `Header | ${cells.join(" | ")}`
        : `Row ${index + 1} | ${cells.join(" | ")}`
    );
  });

  return { label: `Sheet: ${grid.name}`, text: lines.join("\n") };
}

function toExtract(
  grids: Grid[],
  kind: "xlsx" | "csv",
  extraNote?: string
): ExtractedFile {
  const capped = capSections(grids.map(renderGrid), "sheet");

  const note = [capped.truncationNote, extraNote].filter(Boolean).join(" ");

  const rowsShown = grids
    .slice(0, capped.sections.length)
    .reduce((total, grid) => total + grid.rows.length, 0);

  const rowsTruncated = grids.some((grid) => grid.rows.length < grid.totalRows);

  return {
    kind,
    sections: capped.sections,
    truncated: capped.truncated || rowsTruncated || Boolean(extraNote),
    ...(note ? { truncationNote: note } : {}),
    sheets: grids.slice(0, capped.sections.length).map((grid) => grid.name),
    rows: rowsShown,
  };
}

/* =========================================================
   CSV
========================================================= */

/*
 * RFC 4180, with the two deviations every real file has.
 *
 * Quoted fields may contain the delimiter, newlines and doubled
 * quotes; unquoted fields may not. Both line endings are
 * accepted, and a trailing newline does not produce an empty
 * final row.
 *
 * The delimiter is sniffed rather than assumed, because "CSV"
 * from a European spreadsheet is semicolon-separated and a
 * parser that insisted on commas would read every such file as
 * a single column of nonsense — silently, and looking like a
 * working answer.
 */
function sniffDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];

  let best = ",";
  let bestCount = 0;

  /* Counted on the first line only. A comma inside a quoted
     value further down would otherwise outvote the real
     delimiter. */
  const firstLine = sample.split(/\r\n|\r|\n/, 1)[0] ?? "";

  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;

    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

export function parseDelimited(
  source: string,
  delimiter: string,
  maxRows: number
): { rows: string[][]; totalRows: number } {
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  let totalRows = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();

    /* A blank final line is not a row. */
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }

    totalRows += 1;

    if (rows.length < maxRows) {
      rows.push(row);
    }

    row = [];
  };

  while (index < source.length) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }

        quoted = false;
        index += 1;
        continue;
      }

      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }

    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }

    if (char === "\n" || char === "\r") {
      endRow();
      index += source[index] === "\r" && source[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) {
    endRow();
  }

  return { rows, totalRows };
}

export const csvExtractor: FileExtractor = {
  kind: "csv",
  displayName: "CSV",

  async extract(file: AcceptedFile): Promise<ExtractedFile> {
    let source: string;

    try {
      /*
       * The byte-order mark goes, and it is dropped as BYTES
       * rather than as a character.
       *
       * Excel writes one on every CSV it exports. Left in
       * place it decodes to U+FEFF and becomes part of the
       * first header's name, so a file whose first column is
       * "Region" gets a column nothing ever matches. Slicing
       * the three bytes off before decoding is both simpler
       * than stripping an invisible character afterwards and
       * the only version of this that is legible in a diff.
       */
      const bom =
        file.bytes.length >= 3 &&
        file.bytes[0] === 0xef &&
        file.bytes[1] === 0xbb &&
        file.bytes[2] === 0xbf;

      source = (bom ? file.bytes.subarray(3) : file.bytes).toString("utf8");
    } catch (cause) {
      throw malformed(file.name, "a text file", cause);
    }

    if (!source.trim()) {
      throw refuseFile(`${file.name} is empty — there is nothing in it to read.`);
    }

    const delimiter = sniffDelimiter(source);

    const { rows, totalRows } = parseDelimited(
      source,
      delimiter,
      Math.max(1, fileAnalysis.maxRows)
    );

    if (rows.length === 0) {
      throw refuseFile(
        `${file.name} has no rows BuildGentic could read.`,
        "delimited parse produced no rows"
      );
    }

    const totalColumns = rows.reduce((most, row) => Math.max(most, row.length), 0);

    return toExtract(
      [
        {
          /* A CSV has one unnamed sheet. Its filename is the
             only name it has, and is more useful than "Sheet1". */
          name: file.name,
          rows,
          totalRows,
          totalColumns,
        },
      ],
      "csv"
    );
  },
};

/* =========================================================
   XLSX
========================================================= */

const WORKBOOK_PART = "xl/workbook.xml";
const SHARED_STRINGS_PART = "xl/sharedStrings.xml";

/*
 * The shared string table.
 *
 * Excel stores every distinct piece of text once, here, and puts
 * an index in the cell — which is why a sheet read without this
 * part comes back as a grid of integers that look like data and
 * are not.
 *
 * A string is assembled from its runs: `<si>` holds one or more
 * `<r>` fragments, each with its own `<t>`, because Excel splits
 * a cell wherever formatting changes. Reading only the first
 * `<t>` gives you "Total re" where the cell said "Total revenue".
 */
function readSharedStrings(archive: ZipArchive, label: string): string[] {
  const part = archive.read(SHARED_STRINGS_PART, label);

  if (!part) {
    return [];
  }

  const strings: string[] = [];

  let current: string[] | null = null;
  let inText = false;

  for (const token of scanXml(part.toString("utf8"))) {
    if (token.type === "text") {
      if (inText && current) {
        current.push(token.text);
      }

      continue;
    }

    const { tag } = token;

    if (tag.name === "si") {
      if (tag.closing) {
        strings.push((current ?? []).join(""));
        current = null;
      } else if (tag.selfClosing) {
        strings.push("");
      } else {
        current = [];
      }

      continue;
    }

    if (tag.name === "t") {
      inText = !tag.closing && !tag.selfClosing;
    }
  }

  return strings;
}

interface SheetRef {
  name: string;
  /* The part path, resolved from the relationship id. */
  path: string;
}

/*
 * Which sheets the workbook has, in the order the tabs appear.
 *
 * The names come from workbook.xml and the paths from the
 * relationships part, and the two are joined on `r:id`. Reading
 * the worksheet files in directory order instead would work
 * until somebody reorders their tabs, at which point every
 * answer would name the wrong sheet.
 */
function readSheetRefs(archive: ZipArchive, label: string): SheetRef[] {
  const workbook = archive.read(WORKBOOK_PART, label);

  if (!workbook) {
    return [];
  }

  const relationships = readRelationships(archive, label);
  const refs: SheetRef[] = [];

  for (const token of scanXml(workbook.toString("utf8"))) {
    if (token.type !== "tag" || token.tag.name !== "sheet" || token.tag.closing) {
      continue;
    }

    const name = attribute(token.tag.attributes, "name") ?? `Sheet ${refs.length + 1}`;
    const id = attribute(token.tag.attributes, "r:id");
    const target = id ? relationships.get(id) : undefined;

    refs.push({
      name,
      path: target ?? `xl/worksheets/sheet${refs.length + 1}.xml`,
    });
  }

  return refs;
}

function readRelationships(
  archive: ZipArchive,
  label: string
): Map<string, string> {
  const part = archive.read("xl/_rels/workbook.xml.rels", label);
  const map = new Map<string, string>();

  if (!part) {
    return map;
  }

  for (const token of scanXml(part.toString("utf8"))) {
    if (
      token.type !== "tag" ||
      token.tag.name !== "relationship" ||
      token.tag.closing
    ) {
      continue;
    }

    const id = attribute(token.tag.attributes, "Id");
    const target = attribute(token.tag.attributes, "Target");

    if (!id || !target) {
      continue;
    }

    /* Targets are relative to xl/ and occasionally absolute. */
    map.set(
      id,
      target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, "")}`
    );
  }

  return map;
}

/*
 * "BC12" → column 54. The letters are base-26 with no zero.
 *
 * Clamped to Excel's own maximum, and the clamp is a memory
 * guard rather than a nicety. The reference comes out of the
 * file, so a crafted cell can claim to be at column
 * "ZZZZZZZZ" — around 2×10^11 — and the caller fills the gap
 * before it with empty strings. That is an allocation the size
 * of the number in the attacker's file, from a document of a
 * few hundred bytes.
 *
 * 16384 is XFD, the last column a real workbook can have, so
 * clamping here loses nothing legitimate.
 */
const MAX_COLUMN = 16_384;

function columnIndex(reference: string): number {
  let index = 0;

  for (const char of reference) {
    const code = char.charCodeAt(0);

    if (code < 65 || code > 90) {
      break;
    }

    index = index * 26 + (code - 64);

    if (index > MAX_COLUMN) {
      return MAX_COLUMN;
    }
  }

  return Math.min(MAX_COLUMN, Math.max(1, index));
}

/*
 * One worksheet, as a grid.
 *
 * The awkwardness this handles is that Excel omits empty cells
 * entirely rather than writing blanks, so a row's cells are not
 * positional — `<c r="C4">` says which column it is in, and a
 * parser that pushed cells in arrival order would shift every
 * value left of a gap into the wrong column. Which is the kind
 * of wrong that still looks like a working answer.
 */
function readSheet(
  archive: ZipArchive,
  ref: SheetRef,
  strings: string[],
  label: string,
  signal: AbortSignal
): Grid | null {
  const part = archive.read(ref.path, label);

  if (!part) {
    return null;
  }

  const maxRows = Math.max(1, fileAnalysis.maxRows);
  const maxColumns = Math.max(1, fileAnalysis.maxColumns);

  const rows: string[][] = [];

  let totalRows = 0;
  let totalColumns = 0;

  let row: string[] | null = null;
  let column = 0;
  /* The widest column seen, including ones past the cap, so the
     model can be told how many there really are. */
  let widest = 0;
  let cellType: string | null = null;
  let inValue = false;
  let inInline = false;
  let value: string[] = [];
  let checked = 0;

  const endCell = () => {
    if (!row) {
      return;
    }

    const raw = value.join("");
    value = [];

    let text = raw;

    if (cellType === "s") {
      /* A shared-string index. Out-of-range means a corrupt
         table, and an empty cell is a better answer than a
         crash. */
      const index = Number(raw);
      text = Number.isInteger(index) ? strings[index] ?? "" : "";
    } else if (cellType === "b") {
      text = raw === "1" ? "TRUE" : "FALSE";
    }

    /*
     * A cell past the column cap is counted and dropped rather
     * than stored. Only the first `maxColumns` are ever
     * rendered, so filling the gap up to column 16,000 would
     * allocate an array nothing will read.
     */
    if (column <= maxColumns) {
      while (row.length < column - 1) {
        row.push("");
      }

      row[column - 1] = text;
    }

    widest = Math.max(widest, column);
    cellType = null;
  };

  for (const token of scanXml(part.toString("utf8"))) {
    checked += 1;

    if ((checked & 0x3fff) === 0 && signal.aborted) {
      throw new Error("aborted");
    }

    if (token.type === "text") {
      if ((inValue || inInline) && row) {
        value.push(token.text);
      }

      continue;
    }

    const { tag } = token;

    switch (tag.name) {
      case "row":
        if (tag.closing) {
          if (row) {
            totalRows += 1;
            totalColumns = Math.max(totalColumns, widest, row.length);

            if (rows.length < maxRows) {
              rows.push(row.slice(0, maxColumns));
            }
          }

          row = null;
        } else if (!tag.selfClosing) {
          row = [];
          column = 0;
        }
        break;

      case "c":
        if (tag.closing) {
          endCell();
        } else {
          const reference = attribute(tag.attributes, "r");
          column = reference ? columnIndex(reference) : column + 1;
          cellType = attribute(tag.attributes, "t");

          if (tag.selfClosing) {
            /* An empty cell carrying only a style. */
            endCell();
          }
        }
        break;

      case "v":
        /* The cached value. For a formula cell this is what
           Excel last calculated — read, never recomputed. */
        inValue = !tag.closing && !tag.selfClosing;
        break;

      case "is":
        /* An inline string, used instead of the shared table by
           some exporters. */
        inInline = !tag.closing && !tag.selfClosing;
        break;

      case "f":
        /* The formula source itself is deliberately skipped.
           Sending "=SUM(B2:B99)" alongside its value invites the
           model to reason about a range it was never shown. */
        break;

      default:
        break;
    }
  }

  if (rows.length === 0) {
    return null;
  }

  return {
    name: ref.name,
    rows,
    totalRows,
    totalColumns: Math.max(totalColumns, rows[0]?.length ?? 0),
  };
}

export const xlsxExtractor: FileExtractor = {
  kind: "xlsx",
  displayName: "Excel workbook",

  async extract(file: AcceptedFile, signal: AbortSignal): Promise<ExtractedFile> {
    const archive = ZipArchive.open(file.bytes, file.name);

    let refs: SheetRef[];
    let strings: string[];

    try {
      refs = readSheetRefs(archive, file.name);
      strings = readSharedStrings(archive, file.name);
    } catch (cause) {
      throw malformed(file.name, "an Excel workbook", cause);
    }

    if (refs.length === 0) {
      throw refuseFile(
        `${file.name} does not contain any worksheets BuildGentic can read.`,
        `no sheets in ${WORKBOOK_PART}; entries: ${archive
          .names()
          .slice(0, 20)
          .join(", ")}`
      );
    }

    const limit = Math.max(1, fileAnalysis.maxSheets);
    const grids: Grid[] = [];

    try {
      for (const ref of refs.slice(0, limit)) {
        const grid = readSheet(archive, ref, strings, file.name, signal);

        if (grid) {
          grids.push(grid);
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === "aborted") {
        throw refuseFile(
          `${file.name} took too long to read. Try a smaller workbook.`,
          "extraction aborted"
        );
      }

      throw malformed(file.name, "an Excel workbook", cause);
    }

    if (grids.length === 0) {
      throw refuseFile(
        `${file.name} has no data in it — every sheet BuildGentic read was empty.`,
        `${refs.length} sheets, all empty`
      );
    }

    return toExtract(
      grids,
      "xlsx",
      refs.length > limit
        ? `Only the first ${limit} of ${refs.length} sheets were read.`
        : undefined
    );
  },
};
