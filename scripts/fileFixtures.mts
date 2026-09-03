import { crc32, deflateRawSync, deflateSync } from "node:zlib";

/*
 * Files to test File Analysis with, built here rather than
 * checked in.
 *
 * Binary fixtures in a repository are a bad trade: nobody can
 * read a diff of one, nobody can tell what a change to one was
 * meant to do, and the day a test fails on "the PDF" there is
 * nothing to inspect but bytes. Built from code, every fixture
 * is legible, every one can be parameterised — the size-limit
 * test needs a file of a particular size, the truncation test
 * needs one of a particular length — and the suite carries no
 * artefacts.
 *
 * They are real files, not stubs. The PDF opens in a PDF reader,
 * the DOCX opens in Word, the PNG renders in a browser. That
 * matters because the thing under test is a parser: a fixture
 * that only satisfies our own reader would prove our reader
 * agrees with itself.
 */

/* =========================================================
   PDF

   Uncompressed, one Helvetica text object per page, with a
   classic cross-reference table. The oldest and plainest form
   of the format — which is the right choice for a fixture,
   because it is the form whose correctness can be checked by
   reading it.
========================================================= */

function escapePdfText(text: string): string {
  return text.replace(/([()\\])/g, "\\$1");
}

export function buildPdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const fontObject = 3 + pages.length * 2;

  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${
    pages.length
  } >>`;

  pages.forEach((text, index) => {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;

    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObject} 0 R >> >> ` +
      `/Contents ${contentObject} 0 R >>`;

    /*
     * One Tj per line, each moved down by a leading. A single Tj
     * with newlines in it is legal and draws one overlapping
     * line, which extracts as one run and would hide any bug in
     * how line breaks are recovered.
     */
    const lines = text.split("\n");

    const drawing = lines
      .map(
        (line, lineIndex) =>
          `${lineIndex === 0 ? "" : "0 -16 Td "}(${escapePdfText(line)}) Tj`
      )
      .join("\n");

    const stream = `BT /F1 12 Tf 72 720 Td\n${drawing}\nET`;

    objects[contentObject] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontObject] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = out.length;
    out += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xref = out.length;

  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let index = 1; index < objects.length; index += 1) {
    out += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  /* latin1, because every byte written above is one character
     and the offsets recorded in the xref table are byte
     offsets. Encoding as UTF-8 would shift them. */
  return Buffer.from(out, "latin1");
}

/*
 * A PDF with pages and no text on them.
 *
 * What a scan looks like to an extractor: real pages, real
 * dimensions, nothing to read. The suite uses it to check that
 * BuildGentic says "this is probably a scan" rather than
 * returning an empty document and letting the agent answer from
 * nothing.
 */
export function buildImageOnlyPdf(): Buffer {
  const content = "0 0 0 RG 4 w 100 100 m 500 700 l S";

  const out =
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n" +
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;

  /*
   * No xref table. pdf.js reconstructs one when it is missing or
   * wrong, which real-world PDFs frequently are — so this also
   * quietly checks that recovery path.
   */
  return Buffer.from(
    `${out}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`,
    "latin1"
  );
}

/* =========================================================
   ZIP

   The container under DOCX and XLSX. Stored and deflated
   entries both, because the reader supports both and a fixture
   that only exercised one would leave half of it untested.
========================================================= */

interface ZipInput {
  name: string;
  content: string;
  /* Stored rather than deflated. Used for the small parts, and
     to prove the reader handles method 0. */
  stored?: boolean;
}

export function buildZip(files: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];

  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.content, "utf8");

    const deflated = file.stored ? raw : deflateRawSync(raw);
    const method = file.stored ? 0 : 8;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); /* version needed */
    local.writeUInt16LE(0, 6); /* flags */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); /* time */
    local.writeUInt16LE(0, 12); /* date */
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); /* extra */

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); /* version made by */
    central.writeUInt16LE(20, 6); /* version needed */
    central.writeUInt16LE(0, 8); /* flags */
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); /* extra */
    central.writeUInt16LE(0, 32); /* comment */
    central.writeUInt16LE(0, 34); /* disk */
    central.writeUInt16LE(0, 36); /* internal attrs */
    central.writeUInt32LE(0, 38); /* external attrs */
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, deflated);
    centrals.push(central, name);

    offset += local.length + name.length + deflated.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); /* disk */
  end.writeUInt16LE(0, 6); /* disk with directory */
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBlock.length, 12);
  end.writeUInt32LE(localBlock.length, 16);
  end.writeUInt16LE(0, 20); /* comment length */

  return Buffer.concat([localBlock, centralBlock, end]);
}

/* =========================================================
   DOCX
========================================================= */

const CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export interface DocxBlock {
  /* 0 for body text, 1-6 for a heading of that level. */
  heading?: number;
  text: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/*
 * A Word document.
 *
 * Runs are split mid-sentence on purpose. Word does that
 * whenever formatting changes, and an extractor that read only
 * the first `w:t` of a paragraph would pass every test written
 * against unsplit runs and then lose half of every real
 * document.
 */
export function buildDocx(blocks: DocxBlock[], table?: string[][]): Buffer {
  const paragraphs = blocks
    .map((block) => {
      const style = block.heading
        ? `<w:pPr><w:pStyle w:val="Heading${block.heading}"/></w:pPr>`
        : "";

      const middle = Math.floor(block.text.length / 2);

      const runs =
        block.text.length > 8
          ? `<w:r><w:t xml:space="preserve">${escapeXml(
              block.text.slice(0, middle)
            )}</w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(
              block.text.slice(middle)
            )}</w:t></w:r>`
          : `<w:r><w:t>${escapeXml(block.text)}</w:t></w:r>`;

      return `<w:p>${style}${runs}</w:p>`;
    })
    .join("");

  const rows = (table ?? [])
    .map(
      (row) =>
        `<w:tr>${row
          .map(
            (cell) =>
              `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`
          )
          .join("")}</w:tr>`
    )
    .join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs}${rows ? `<w:tbl>${rows}</w:tbl>` : ""}</w:body>
</w:document>`;

  return buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX, stored: true },
    { name: "_rels/.rels", content: RELS_DOCX, stored: true },
    { name: "word/document.xml", content: document },
  ]);
}

/* =========================================================
   XLSX
========================================================= */

const CONTENT_TYPES_XLSX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`;

const RELS_XLSX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

export interface SheetInput {
  name: string;
  rows: Array<Array<string | number>>;
}

function columnName(index: number): string {
  let name = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

/*
 * A workbook, with text in the shared-string table and numbers
 * inline.
 *
 * That split is how Excel actually writes a file, and it is the
 * part worth testing: a reader that ignored sharedStrings.xml
 * would return a grid of small integers where the words were,
 * which looks like data and is not.
 */
export function buildXlsx(sheets: SheetInput[]): Buffer {
  const strings: string[] = [];

  const indexOfString = (value: string): number => {
    const existing = strings.indexOf(value);

    if (existing !== -1) {
      return existing;
    }

    strings.push(value);
    return strings.length - 1;
  };

  const sheetParts = sheets.map((sheet, sheetIndex) => {
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowIndex + 1}`;

            if (typeof value === "number") {
              return `<c r="${reference}"><v>${value}</v></c>`;
            }

            /* An empty cell is written as no cell at all, which
               is what Excel does and what shifts a naive
               positional reader. */
            if (value === "") {
              return "";
            }

            return `<c r="${reference}" t="s"><v>${indexOfString(
              value
            )}</v></c>`;
          })
          .join("");

        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");

    return {
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rows}</sheetData></worksheet>`,
    };
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${
          index + 1
        }" r:id="rId${index + 1}"/>`
    )
    .join("")}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, index) =>
      `<Relationship Id="rId${
        index + 1
      }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
        index + 1
      }.xml"/>`
  )
  .join("")}</Relationships>`;

  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${
    strings.length
  }" uniqueCount="${strings.length}">
${strings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join("")}</sst>`;

  return buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XLSX, stored: true },
    { name: "_rels/.rels", content: RELS_XLSX, stored: true },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels, stored: true },
    { name: "xl/sharedStrings.xml", content: sharedStrings },
    ...sheetParts,
  ]);
}

/* =========================================================
   IMAGES
========================================================= */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, checksum]);
}

/*
 * A real PNG, not a header with a plausible shape.
 *
 * It has to be real because the image test sends it to a live
 * vision model and asks what colour it is — which is the only
 * way to prove that the pixels reached the provider rather than
 * just that a base64 string did.
 */
export function buildPng(
  width: number,
  height: number,
  colour: [number, number, number]
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); /* bit depth */
  header.writeUInt8(2, 9); /* colour type: truecolour */
  header.writeUInt8(0, 10); /* compression */
  header.writeUInt8(0, 11); /* filter */
  header.writeUInt8(0, 12); /* interlace */

  /* One filter byte per scanline, then RGB triples. */
  const raw = Buffer.alloc(height * (1 + width * 3));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw.writeUInt8(0, rowStart);

    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw.writeUInt8(colour[0], pixel);
      raw.writeUInt8(colour[1], pixel + 1);
      raw.writeUInt8(colour[2], pixel + 2);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    /* zlib-wrapped, which is what PNG specifies — not raw
       deflate. */
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/*
 * A PNG that claims to be enormous.
 *
 * Its IHDR says 20,000 × 20,000 and its pixel data says
 * otherwise, which is exactly the shape of a decompression bomb:
 * cheap to send, ruinous to decode. The dimension check reads
 * the header and refuses it without decoding anything, which is
 * the whole point — so this fixture never needs to contain the
 * 400 megapixels it advertises.
 */
export function buildOversizedPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(20_000, 0);
  header.writeUInt32BE(20_000, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.alloc(16))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/*
 * A JPEG with a real frame header.
 *
 * Enough for the dimension read that decides whether to accept
 * it, which is all BuildGentic does to a JPEG — the pixels are the
 * model's problem, not ours.
 */
export function buildJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "latin1"),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);

  const sof0 = Buffer.alloc(21);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2); /* length */
  sof0.writeUInt8(8, 4); /* precision */
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(3, 9); /* components */

  for (let component = 0; component < 3; component += 1) {
    const at = 10 + component * 3;
    sof0.writeUInt8(component + 1, at);
    sof0.writeUInt8(0x11, at + 1);
    sof0.writeUInt8(component === 0 ? 0 : 1, at + 2);
  }

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof0,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/* =========================================================
   THINGS THAT SHOULD BE REFUSED
========================================================= */

/* A GIF: a real format, and one BuildGentic does not read. Named
   .png in the tests, to prove the name is not what decides. */
export function buildGif(): Buffer {
  return Buffer.concat([
    Buffer.from("GIF89a", "latin1"),
    Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]),
    Buffer.alloc(24, 0x2c),
  ]);
}

/* Bytes that are not text and are not any known format. */
export function buildBinaryBlob(size = 4096): Buffer {
  const bytes = Buffer.alloc(size);

  for (let index = 0; index < size; index += 1) {
    /* Deterministic, and full of the control bytes and invalid
       UTF-8 sequences the text check looks for. */
    bytes[index] = (index * 37 + 11) % 256;
  }

  return bytes;
}

/* A PDF header followed by rubbish. Passes the magic-byte check
   and fails in the parser, which is the path malformed-file
   handling has to cover. */
export function buildCorruptPdf(): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.7\n", "latin1"),
    buildBinaryBlob(2048),
  ]);
}

/* A ZIP that is not an Office document. */
export function buildPlainZip(): Buffer {
  return buildZip([
    { name: "notes.txt", content: "just a zip of a text file", stored: true },
  ]);
}
