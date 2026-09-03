import { inflateRawSync } from "node:zlib";

import { refuseFile } from "./errors";

/*
 * Just enough ZIP to open an Office document.
 *
 * DOCX and XLSX are both ZIP archives of XML, so reading either
 * one starts here. This is a reader rather than a library:
 * stored and deflated entries, read from the central directory,
 * and nothing else. No encryption, no ZIP64, no spanning, no
 * writing.
 *
 * Hand-rolled rather than depended on, for the reason the rest
 * of this project hand-rolls its sanitisers and its mock
 * embeddings: the whole surface needed is two record layouts and
 * one call to zlib, and a dependency that can read an archive is
 * a dependency that can also write one, extract to disk, follow
 * a path out of the directory it was pointed at, and allocate
 * whatever a length field in a hostile file tells it to.
 *
 * Which names the threat this file is actually written against.
 * Every number below comes out of the archive, and the archive
 * is somebody else's. A length field can claim four gigabytes; a
 * compressed entry can claim to expand to a thousand times its
 * size; an offset can point outside the buffer. So every read is
 * bounds-checked against the real length, every entry is checked
 * against a declared-size ceiling before it is inflated, and
 * nothing is trusted because it appeared in a header.
 *
 * Nothing here writes to the filesystem, which removes the
 * classic ZIP vulnerability entirely: an entry named
 * "../../etc/passwd" is a string in a map, and the extractors
 * only ever ask for names they already know.
 */

/* Central directory record signatures. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/*
 * The most one entry may expand to.
 *
 * This is the zip-bomb ceiling, and it is per entry rather than
 * per archive because an OOXML package is a handful of parts and
 * only one of them is ever large. 64 MB is far more than any
 * real document.xml or sheet1.xml, and far less than what a
 * 40 kB archive can claim to become.
 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/* How many entries will be walked. An OOXML package has tens. */
const MAX_ENTRIES = 2_000;

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipArchive {
  private readonly buffer: Buffer;
  private readonly entries: Map<string, ZipEntry>;

  private constructor(buffer: Buffer, entries: Map<string, ZipEntry>) {
    this.buffer = buffer;
    this.entries = entries;
  }

  /*
   * Reads the central directory.
   *
   * Starting from the end rather than the front is how ZIP is
   * meant to be read: the directory at the tail is authoritative,
   * and walking local headers forward would believe whatever the
   * first one claimed about its own length.
   */
  static open(buffer: Buffer, label: string): ZipArchive {
    const end = findEndOfCentralDirectory(buffer);

    if (end === -1) {
      throw refuseFile(
        `${label} is not a readable Office document — its archive directory is missing or damaged.`,
        "no end-of-central-directory record"
      );
    }

    const count = buffer.readUInt16LE(end + 10);
    const directoryOffset = buffer.readUInt32LE(end + 16);

    if (directoryOffset >= buffer.length) {
      throw refuseFile(
        `${label} is not a readable Office document — its archive directory points outside the file.`,
        `central directory offset ${directoryOffset} beyond ${buffer.length}`
      );
    }

    const entries = new Map<string, ZipEntry>();

    let cursor = directoryOffset;

    for (let index = 0; index < Math.min(count, MAX_ENTRIES); index += 1) {
      /* 46 is the fixed part of a central file header. */
      if (cursor + 46 > buffer.length) {
        break;
      }

      if (buffer.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
        break;
      }

      const compressionMethod = buffer.readUInt16LE(cursor + 10);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

      const nameStart = cursor + 46;
      const nameEnd = nameStart + nameLength;

      if (nameEnd > buffer.length) {
        break;
      }

      const name = buffer.subarray(nameStart, nameEnd).toString("utf8");

      entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      cursor = nameEnd + extraLength + commentLength;
    }

    if (entries.size === 0) {
      throw refuseFile(
        `${label} is not a readable Office document — its archive is empty.`,
        "central directory listed no entries"
      );
    }

    return new ZipArchive(buffer, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /* Every entry name, so a caller can find the sheets in a
     workbook without knowing how many there are. */
  names(): string[] {
    return [...this.entries.keys()];
  }

  /*
   * One entry, inflated.
   *
   * Null for an entry that is not there, which is a legitimate
   * answer: a workbook with no shared-strings part is a workbook
   * whose cells are all numbers, not a broken file.
   */
  read(name: string, label: string): Buffer | null {
    const entry = this.entries.get(name);

    if (!entry) {
      return null;
    }

    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw refuseFile(
        `${label} contains a part that expands to ${Math.round(
          entry.uncompressedSize / (1024 * 1024)
        )} MB, which BuildGentic will not unpack.`,
        `entry ${name} declares ${entry.uncompressedSize} bytes`
      );
    }

    /*
     * The local header's name and extra fields are read for
     * their lengths only. They can legitimately differ from the
     * central directory's, so the data offset has to be computed
     * from the local header rather than assumed.
     */
    const offset = entry.localHeaderOffset;

    if (offset + 30 > this.buffer.length) {
      throw refuseFile(
        `${label} is damaged — one of its parts points outside the file.`,
        `local header for ${name} at ${offset} beyond ${this.buffer.length}`
      );
    }

    if (this.buffer.readUInt32LE(offset) !== LOCAL_FILE_HEADER) {
      throw refuseFile(
        `${label} is damaged — one of its parts has a corrupt header.`,
        `bad local header signature for ${name}`
      );
    }

    const nameLength = this.buffer.readUInt16LE(offset + 26);
    const extraLength = this.buffer.readUInt16LE(offset + 28);

    const start = offset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;

    if (end > this.buffer.length) {
      throw refuseFile(
        `${label} is damaged — one of its parts runs past the end of the file.`,
        `entry ${name} spans ${start}..${end} of ${this.buffer.length}`
      );
    }

    const raw = this.buffer.subarray(start, end);

    if (entry.compressionMethod === 0) {
      return Buffer.from(raw);
    }

    if (entry.compressionMethod !== 8) {
      throw refuseFile(
        `${label} uses a compression method BuildGentic cannot read. Re-save it from Word or Excel and try again.`,
        `entry ${name} uses compression method ${entry.compressionMethod}`
      );
    }

    try {
      /*
       * `maxOutputLength` is the guard that makes the declared
       * size above more than a suggestion. A crafted entry can
       * claim to be small and expand without limit; zlib stops
       * at this ceiling and throws rather than filling memory.
       */
      return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch (cause) {
      throw refuseFile(
        `${label} could not be unpacked. It may be corrupt or password-protected.`,
        `inflate failed for ${name}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      );
    }
  }
}

/*
 * Finds the end-of-central-directory record.
 *
 * It is at the very end unless the archive carries a comment, so
 * the search runs backwards over the last 64 kB — the most a
 * comment length field can express. Scanning the whole buffer
 * would work and would also mean a 8 MB file is scanned byte by
 * byte for a signature that is, by specification, near the end.
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - 0xffff - 22);

  for (let index = buffer.length - 22; index >= floor; index -= 1) {
    if (buffer.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) {
      return index;
    }
  }

  return -1;
}
