import { randomUUID } from "node:crypto";

import { fileAnalysis } from "../ai/config";
import type { FileKind } from "../ai/types";
import type { ExtractedFile } from "./types";

/*
 * Where an uploaded file lives between being attached and being
 * answered.
 *
 * The answer is: in this process, briefly, and nowhere else.
 * That is a deliberate choice rather than a shortcut, and the
 * requirements it comes from are worth writing down because they
 * are what make the alternative wrong.
 *
 * A file must not become permanently reachable because somebody
 * knows a URL. The surest way to guarantee that is for there to
 * be no URL: nothing in this project serves an uploaded file
 * back, at any address, to anyone. What is kept is the EXTRACTED
 * result — the text the model will be given — plus, for an
 * image, the bytes that have to travel with the request. The
 * original PDF is dropped the moment it has been read.
 *
 * Ownership must be enforced server-side. Every entry carries
 * the scope it was created under, every read demands a matching
 * scope, and a mismatch is indistinguishable from an id that
 * never existed. There is no query that returns another
 * learner's attachment because there is no query that takes an
 * id without also taking a scope.
 *
 * Unnecessary copies must not persist. Entries expire, and the
 * expiry is minutes rather than days: an attachment exists to
 * answer the question being asked with it. A learner who wants a
 * document to persist has Knowledge, which is the feature for
 * exactly that and which they chose not to use.
 *
 * WHAT THIS COSTS. A restart drops every held attachment, and a
 * second instance behind a load balancer cannot see the first
 * one's. Both are real, and both are acceptable for what this
 * holds: the failure is "attach the file again", thirty seconds
 * of a learner's time, with a message that says so. Buying our
 * way out would mean a storage bucket, its policies, its
 * lifecycle rules, its own ownership model and its own way of
 * leaking — permanent infrastructure for temporary data. If
 * BuildGentic ever runs more than one instance, the honest fix is
 * Supabase Storage with signed short-lived reads, and this
 * module is the seam it lands behind.
 */

/* =========================================================
   SCOPE

   Who an attachment belongs to, and therefore who may use it.
========================================================= */

/*
 * Two kinds of caller can upload, and they authenticate
 * completely differently.
 *
 *   user       — a learner with a Supabase session, testing in
 *                the Builder.
 *   deployment — an application holding a deployment key,
 *                calling somebody else's agent.
 *
 * A deployment scope carries the owner as well, because the
 * owner is who pays — but the owner is NOT who may read it. A
 * file uploaded through a deployment is usable only by that
 * deployment, so an owner cannot pull a caller's document out of
 * their own Builder, and a caller cannot reach anything the
 * owner attached.
 */
export type FileScope =
  | { kind: "user"; userId: string }
  | { kind: "deployment"; deploymentId: string; ownerId: string };

function scopeKey(scope: FileScope): string {
  return scope.kind === "user"
    ? `user:${scope.userId}`
    : `deployment:${scope.deploymentId}`;
}

/* Who is billed for anything this attachment causes. */
export function billedTo(scope: FileScope): string {
  return scope.kind === "user" ? scope.userId : scope.ownerId;
}

/* =========================================================
   ENTRIES
========================================================= */

export interface HeldFile {
  id: string;
  scopeKey: string;
  name: string;
  kind: FileKind;
  /* The size of the file that was uploaded, kept for the
     telemetry the owner sees. The bytes themselves are gone. */
  bytes: number;
  extracted: ExtractedFile;
  /* How long the extraction took, for the same telemetry. */
  latencyMs: number;
  expiresAt: number;
  /*
   * What this entry actually costs this process, in bytes.
   *
   * Not `bytes` above, which is the size of the file that was
   * uploaded and is no longer held. What is held is the
   * extracted text — usually far smaller than the document —
   * except for an image, whose base64 payload is larger than
   * the file it came from. Measuring the thing in memory rather
   * than the thing that was sent is the only way the process
   * budget below means anything.
   */
  heldBytes: number;
}

/*
 * What one entry occupies.
 *
 * Characters rather than bytes for the text, which understates
 * a UTF-16 string by half — but the base64 payload dominates
 * any entry big enough to matter, and an estimate that is
 * consistently low by a known factor is a usable budget. The
 * alternative is Buffer.byteLength over every section on every
 * upload, for a number that only feeds an eviction policy.
 */
function weigh(extracted: ExtractedFile): number {
  let total = extracted.image?.dataBase64.length ?? 0;

  for (const section of extracted.sections) {
    total += section.label.length + section.text.length;
  }

  return total;
}

/*
 * The store.
 *
 * A Map keyed by id, with the scope held on the entry rather
 * than as an outer key. That is the right way round: the lookup
 * a caller makes is "give me this id, I claim this scope", and
 * checking the claim against the entry is one comparison. Keying
 * by scope first would mean a caller who guessed an id could at
 * least learn whether it existed.
 */
const held = new Map<string, HeldFile>();

/*
 * Expiry is checked on read and swept on write.
 *
 * No timer, deliberately. A `setInterval` on a module keeps the
 * event loop alive, which turns a clean shutdown into a hang and
 * makes every test that imports this file need a teardown it
 * would otherwise not need. Sweeping when something is added is
 * enough: the only way entries accumulate is by being added.
 */
function sweep(now: number): void {
  for (const [id, entry] of held) {
    if (entry.expiresAt <= now) {
      held.delete(id);
    }
  }
}

/*
 * Brings the process back inside its memory budget by dropping
 * the oldest attachments, whoever they belong to.
 *
 * Oldest first, and across every scope rather than only the
 * caller's — the oldest are the ones whose conversation has
 * moved on, and refusing somebody's fresh upload because
 * another learner's half-hour-old spreadsheet is still resident
 * would make one person's idleness another person's error.
 *
 * A learner whose attachment is evicted early sees the same
 * message as one whose attachment expired: attach it again.
 */
function enforceBudget(): void {
  const budget = fileAnalysis.maxHeldBytes;

  if (budget <= 0) {
    return;
  }

  let total = 0;

  for (const entry of held.values()) {
    total += entry.heldBytes;
  }

  if (total <= budget) {
    return;
  }

  const oldest = [...held.values()].sort((a, b) => a.expiresAt - b.expiresAt);

  for (const entry of oldest) {
    if (total <= budget) {
      break;
    }

    held.delete(entry.id);
    total -= entry.heldBytes;
  }

  console.warn(
    `[files] the attachment store was over its ${Math.round(
      budget / (1024 * 1024)
    )} MB budget; the oldest entries were dropped.`
  );
}

export interface PutInput {
  scope: FileScope;
  name: string;
  kind: FileKind;
  bytes: number;
  extracted: ExtractedFile;
  latencyMs: number;
}

export function put(input: PutInput): HeldFile {
  const now = Date.now();
  sweep(now);

  const key = scopeKey(input.scope);

  /*
   * The per-scope cap evicts oldest-first rather than refusing.
   *
   * A learner who attaches a thirteenth file should see it work.
   * Refusing the newest upload because of twelve they have
   * forgotten about would be a limit that punishes the one thing
   * they are actually trying to do, and the twelve older ones
   * are by definition the ones they stopped asking about.
   */
  const mine = [...held.values()]
    .filter((entry) => entry.scopeKey === key)
    .sort((a, b) => a.expiresAt - b.expiresAt);

  const overBy = mine.length + 1 - Math.max(1, fileAnalysis.maxHeld);

  for (let index = 0; index < overBy; index += 1) {
    held.delete(mine[index].id);
  }

  const entry: HeldFile = {
    id: randomUUID(),
    scopeKey: key,
    name: input.name,
    kind: input.kind,
    bytes: input.bytes,
    extracted: input.extracted,
    latencyMs: input.latencyMs,
    expiresAt: now + Math.max(60_000, fileAnalysis.retentionMs),
    heldBytes: weigh(input.extracted),
  };

  held.set(entry.id, entry);

  /* After the insert, so the new entry is inside the budget it
     is measured against — and so a single upload larger than
     the whole budget evicts everything else rather than
     everything else evicting it. */
  enforceBudget();

  return entry;
}

/*
 * One attachment, or null.
 *
 * Null covers three cases on purpose — no such id, an expired
 * id, and somebody else's id — because the caller can only be
 * told one thing and telling them which would be telling them
 * that an id they guessed belongs to someone. The message every
 * caller sees is the same: this attachment is no longer
 * available.
 */
export function get(id: unknown, scope: FileScope): HeldFile | null {
  if (typeof id !== "string" || id === "") {
    return null;
  }

  const entry = held.get(id);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    held.delete(id);
    return null;
  }

  return entry.scopeKey === scopeKey(scope) ? entry : null;
}

/*
 * Drops an attachment the caller owns.
 *
 * What the Test panel's remove button calls. A learner who
 * changes their mind should not have to wait out the retention
 * window for their file to stop existing, and "remove" that only
 * removed a chip from the screen would be a lie about where the
 * document went.
 */
export function drop(id: unknown, scope: FileScope): boolean {
  const entry = get(id, scope);

  if (!entry) {
    return false;
  }

  held.delete(entry.id);
  return true;
}

/* How many attachments a scope is holding. For diagnostics and
   for the verification suite's cleanup assertions. */
export function countFor(scope: FileScope): number {
  const key = scopeKey(scope);
  const now = Date.now();

  let count = 0;

  for (const entry of held.values()) {
    if (entry.scopeKey === key && entry.expiresAt > now) {
      count += 1;
    }
  }

  return count;
}
