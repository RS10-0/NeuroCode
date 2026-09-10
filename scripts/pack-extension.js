/*
 * Builds the zip that goes to the Chrome Web Store.
 *
 * An explicit allowlist rather than "everything except a few things",
 * because what ships in an extension package is what every install runs
 * and what a reviewer reads. A stray file cannot end up in there by
 * being forgotten about — it has to be named here.
 *
 * The archive is written here rather than shelled out to PowerShell's
 * Compress-Archive, which stores paths with backslashes. The zip spec
 * requires forward slashes, and an `icons\16.png` entry is not the
 * `icons/16.png` the manifest asks for.
 */

import { deflateRawSync } from "node:zlib";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const outDir = join(root, "dist-extension");
const outFile = join(outDir, "buildgentic-extension.zip");

/* Everything the extension needs at runtime, and nothing else. */
const SHIP = [
  "manifest.json",
  "sw.js",
  "panel.html",
  "panel.js",
  "panel.css",
  "capture.js",
  "markdown.js",
  "config.js",
  "icons/16.png",
  "icons/48.png",
  "icons/128.png",
];

/* Present in extension/ but deliberately not shipped. */
const EXCLUDED = ["README.md", "verify-key.js"];

const missing = SHIP.filter((file) => !existsSync(join(source, file)));
if (missing.length > 0) {
  console.error("missing from extension/:\n  " + missing.join("\n  "));
  process.exit(1);
}

/* Refuse to ship a manifest that does not parse — the upload would only
   fail later, further from the cause. */
try {
  JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
} catch (error) {
  console.error(`extension/manifest.json does not parse: ${error.message}`);
  process.exit(1);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const local = [];
const central = [];
let offset = 0;

for (const name of SHIP) {
  const contents = readFileSync(join(source, name));
  const deflated = deflateRawSync(contents, { level: 9 });
  /* Only take the compression if it actually helped. */
  const stored = deflated.length >= contents.length;
  const body = stored ? contents : deflated;
  const method = stored ? 0 : 8;
  const crc = crc32(contents);
  const nameBuf = Buffer.from(name, "utf8"); // already forward-slashed

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(0, 10); // time
  localHeader.writeUInt16LE(0x21, 12); // date — 1980-01-01, reproducible
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(body.length, 18);
  localHeader.writeUInt32LE(contents.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra
  local.push(localHeader, nameBuf, body);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0x21, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(body.length, 20);
  centralHeader.writeUInt32LE(contents.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(offset, 42);
  central.push(centralHeader, nameBuf);

  offset += localHeader.length + nameBuf.length + body.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(SHIP.length, 8);
eocd.writeUInt16LE(SHIP.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, Buffer.concat([...local, centralBuf, eocd]));

const size = Buffer.concat([...local, centralBuf, eocd]).length;
console.log(`packed ${SHIP.length} files -> ${outFile}`);
console.log(`${(size / 1024).toFixed(1)} KB`);
console.log(`excluded: ${EXCLUDED.join(", ")}`);
