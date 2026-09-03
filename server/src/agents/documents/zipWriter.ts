import { deflateRawSync } from "node:zlib";

/*
 * Just enough ZIP to write an Office document.
 *
 * The mirror of files/zip.ts, which is just enough ZIP to READ
 * one, and hand-rolled for the same reason that file gives: the
 * whole surface needed is two record layouts and one call to
 * zlib, and a dependency that can write an archive is a
 * dependency that can also read one, extract to disk, and
 * follow a path out of the directory it was pointed at.
 *
 * The threat model is inverted from the reader's, and that
 * makes this the easier half. Every number the reader handles
 * comes out of somebody else's archive and has to be
 * bounds-checked; every number here is one this process
 * computed from data it already validated. There is no hostile
 * length field to defend against, because there is no length
 * field this file did not write.
 *
 * What it does: stored and deflated entries, local headers, a
 * central directory, and an end-of-central-directory record.
 * No ZIP64, no encryption, no spanning, no directory entries,
 * and nothing touches the filesystem — an archive is built in
 * memory and handed back as a Buffer.
 *
 * Entry names are ASCII literals from the callers in xlsx.ts
 * and docx.ts. No name here comes from a model, which is why
 * there is no name sanitiser: the OOXML part names are a fixed
 * set, and adding one is a code change.
 */

/* =========================================================
   CRC-32

   Written out rather than taken from `zlib.crc32`, which is
   recent enough that depending on it would pin a Node version
   for twenty lines of arithmetic. The table is built once, on
   first use.
========================================================= */

let TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (TABLE) {
    return TABLE;
  }

  const built = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    built[index] = value >>> 0;
  }

  TABLE = built;

  return built;
}

function crc32(data: Buffer): number {
  const lookup = table();

  let crc = 0xffffffff;

  for (const byte of data) {
    crc = lookup[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/* =========================================================
   THE ARCHIVE
========================================================= */

export interface ZipFile {
  name: string;
  data: Buffer;
}

interface Placed extends ZipFile {
  offset: number;
  crc: number;
  compressed: Buffer;
  method: number;
}

/*
 * MS-DOS date and time, which is what a ZIP records.
 *
 * Two-second resolution and a 1980 epoch, both of which are
 * exactly as odd as they look and both of which are the format.
 * A fixed timestamp would be reproducible and would also make
 * every generated file claim to have been made at the same
 * moment, which is worse for somebody looking at a folder of
 * them.
 */
function dosStamp(): { time: number; date: number } {
  const now = new Date();

  const year = Math.max(1980, now.getUTCFullYear());

  return {
    time:
      (now.getUTCHours() << 11) |
      (now.getUTCMinutes() << 5) |
      (Math.floor(now.getUTCSeconds() / 2) & 0x1f),
    date:
      ((year - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate(),
  };
}

/*
 * Builds the archive.
 *
 * Entries are written in the order given, which matters for one
 * of them: `[Content_Types].xml` should come first, because it
 * is what a reader consults to find out what everything else
 * is, and some consumers give up if it turns out to be at the
 * back.
 */
export function writeZip(files: ZipFile[]): Buffer {
  const stamp = dosStamp();
  const placed: Placed[] = [];
  const chunks: Buffer[] = [];

  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "ascii");
    const compressed = deflateRawSync(file.data);

    /*
     * Deflate only if it actually helped.
     *
     * A tiny XML part often compresses to more than it started
     * as, once the deflate header is counted, and an archive
     * that stores those uncompressed is both smaller and
     * quicker for a reader to open.
     */
    const useDeflate = compressed.length < file.data.length;
    const body = useDeflate ? compressed : file.data;
    const method = useDeflate ? 8 : 0;

    const crc = crc32(file.data);

    const header = Buffer.alloc(30);

    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4) /* version needed */;
    header.writeUInt16LE(0, 6) /* flags */;
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28) /* extra field length */;

    chunks.push(header, name, body);

    placed.push({ ...file, offset, crc, compressed: body, method });

    offset += header.length + name.length + body.length;
  }

  const directoryAt = offset;

  for (const entry of placed) {
    const name = Buffer.from(entry.name, "ascii");
    const record = Buffer.alloc(46);

    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4) /* version made by */;
    record.writeUInt16LE(20, 6) /* version needed */;
    record.writeUInt16LE(0, 8) /* flags */;
    record.writeUInt16LE(entry.method, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.date, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.compressed.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30) /* extra */;
    record.writeUInt16LE(0, 32) /* comment */;
    record.writeUInt16LE(0, 34) /* disk number */;
    record.writeUInt16LE(0, 36) /* internal attributes */;
    record.writeUInt32LE(0, 38) /* external attributes */;
    record.writeUInt32LE(entry.offset, 42);

    chunks.push(record, name);

    offset += record.length + name.length;
  }

  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4) /* this disk */;
  end.writeUInt16LE(0, 6) /* disk with directory */;
  end.writeUInt16LE(placed.length, 8);
  end.writeUInt16LE(placed.length, 10);
  end.writeUInt32LE(offset - directoryAt, 12);
  end.writeUInt32LE(directoryAt, 16);
  end.writeUInt16LE(0, 20) /* comment length */;

  chunks.push(end);

  return Buffer.concat(chunks);
}

/* =========================================================
   XML ESCAPING

   One function, applied to every text node and every attribute
   value in both OOXML writers.

   files/extract/xml.ts solves this problem in the other
   direction and its `decodeXmlText` is the thing this has to be
   the inverse of. The five named entities are all XML defines;
   everything else that needs escaping in a document this writer
   produces is a control character, and those are dropped rather
   than encoded because XML 1.0 cannot carry most of them at all
   — a literal 0x0B in a Word document is a file Word refuses to
   open, which is a worse outcome than a missing character
   nobody typed on purpose.
========================================================= */

export function escapeXml(value: string): string {
  let out = "";

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }

    switch (character) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&apos;";
        break;
      default:
        out += character;
        break;
    }
  }

  return out;
}
