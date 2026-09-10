/*
 * Checks that manifest.json's `key` produces the extension id you expect.
 *
 *   node extension/verify-key.js
 *
 * The id Chrome gives an extension is derived from its public key, so the
 * two cannot disagree — but the value that has to be typed into
 * NEUROLINK_EXTENSION_ORIGIN on the server is the id, while the value
 * pasted into the manifest is the key. This prints the id that the key in
 * the manifest actually yields, so the server setting is copied from a
 * computed value rather than from a dashboard screenshot.
 *
 * The derivation is Chrome's: SHA-256 the DER-encoded public key, take the
 * first 16 bytes, and map each hex nibble 0-f onto a-p.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

if (!manifest.key) {
  console.error(
    "manifest.json has no `key` field, so this extension's id is not pinned\n" +
      "and Chrome will assign a different one on every machine. See the\n" +
      "\"Pinning the extension id\" section of README.md."
  );
  process.exit(1);
}

/* The manifest stores the DER SubjectPublicKeyInfo, base64-encoded. */
const der = Buffer.from(manifest.key, "base64");

const id = [...createHash("sha256").update(der).digest().subarray(0, 16)]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("")
  .replace(/[0-9a-f]/g, (nibble) =>
    String.fromCharCode(parseInt(nibble, 16) + 0x61)
  );

const origin = `chrome-extension://${id}`;

/* The same shape server/src/index.ts requires of the origin. */
const wellFormed = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);

console.log(`extension id : ${id}`);
console.log(`origin       : ${origin}`);
console.log(`well-formed  : ${wellFormed ? "yes" : "NO — this will be refused"}`);
console.log();
console.log("Set on Render:  NEUROLINK_EXTENSION_ORIGIN=" + origin);
console.log("Set on Vercel:  VITE_EXTENSION_ID=" + id);
console.log();
console.log("Confirm it agrees with chrome://extensions (Developer mode).");

process.exit(wellFormed ? 0 : 1);
