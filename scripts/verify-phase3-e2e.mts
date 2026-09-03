/*
 * Proof that a generated file and a stored record belong to
 * exactly one learner, and that the ceilings behave.
 *
 * Asserts on the DATABASE rather than on any function's own
 * report, for the reason verify-schedules-e2e.mts gives: a
 * function that returns success having written nothing is the
 * bug a suite like this exists to catch. Every row is read back
 * with the service role.
 *
 * The negatives are the point. Anyone can write a test that
 * stores a document and gets it back; what has to be proved is
 * that ANOTHER learner cannot, that another AGENT of the same
 * learner cannot, and that a full store refuses rather than
 * quietly making room.
 *
 * Needs supabase/migrations/0018 applied. Section 0 checks that
 * first, by WRITING a row rather than reading a catalogue —
 * 0016's lesson — because every section after it fails
 * incomprehensibly without it.
 *
 *   npx tsx ./scripts/verify-phase3-e2e.mts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

/* ---------------------------------------------------------
   ENV

   Read and installed into `process.env` BEFORE any server
   module is imported, for the reason verify-schedules-e2e.mts
   spells out: lib/supabase.ts throws at module scope without
   SUPABASE_URL, and this script runs from the repo root where
   `dotenv/config` finds nothing. Hence the dynamic imports.
   --------------------------------------------------------- */

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const serverEnv = readEnv("server/.env");

for (const [key, value] of Object.entries(serverEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

process.env.NEUROLINK_SCHEDULER = "off";

const SUPABASE_URL = serverEnv.SUPABASE_URL;
const SERVICE_KEY = serverEnv.SUPABASE_SECRET_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DocumentStore = await import(
  "../server/src/agents/documents/DocumentStore"
);
const DataStore = await import("../server/src/agents/data/DataStore");
const { scopeKeyOf } = await import("../server/src/agents/data/scope");
const { parsePlan } = await import("../server/src/agents/documents/plan");
const { render } = await import("../server/src/agents/documents/render");
const { dataStore: dataConfig, documents: docConfig } = await import(
  "../server/src/ai/config"
);

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

const created: string[] = [];

interface Learner {
  id: string;
  agentA: string;
  agentB: string;
}

async function makeLearner(tag: string): Promise<Learner> {
  /*
   * Unique per run, and the USERNAME half is the load-bearing
   * one: a trigger on auth.users copies user_metadata.username
   * into public.profiles, where it is unique. A fixed name means
   * one leftover account from an interrupted run makes every
   * later run die at createUser with a bare "Database error
   * creating new user". Neither the trigger nor the constraint
   * is in supabase/migrations, so nothing in the tree warns you.
   */
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email = `neurolink-p3-verify+${tag}-${stamp}@example.com`;

  const made = await admin.auth.admin.createUser({
    email,
    password: `verify-${crypto.randomUUID()}`,
    email_confirm: true,
    user_metadata: { username: `p3-verify-${tag}-${stamp}` },
  });

  if (made.error || !made.data.user) {
    throw new Error(`Could not create the test learner: ${made.error?.message}`);
  }

  created.push(made.data.user.id);

  const agent = async (name: string): Promise<string> => {
    const row = await admin
      .from("agents")
      .insert({
        user_id: made.data.user!.id,
        name,
        description: "Created by verify-phase3-e2e.mts",
        avatar_emoji: "📄",
        avatar_tone: "accent",
        system_instructions: "Answer briefly.",
        model: "neurolink/mock-1",
        temperature: 0,
        max_output_tokens: 500,
        capabilities: ["chat", "document_generation", "data_store"],
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (row.error || !row.data) {
      throw new Error(`Could not create an agent: ${row.error?.message}`);
    }

    return row.data.id as string;
  };

  return {
    id: made.data.user.id,
    agentA: await agent("Agent A"),
    agentB: await agent("Agent B"),
  };
}

function renderSample(title: string) {
  const parsed = parsePlan({
    format: "pdf",
    title,
    blocks: [
      { type: "heading", level: 1, text: "Section" },
      { type: "text", text: "A paragraph of body text for the report." },
    ],
  });

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  return render(parsed.plan);
}

/* ---------------------------------------------------------
   0. THE MIGRATION

   Checked by WRITING, not by reading a catalogue. A missing
   table and a table with a missing column both produce a
   select that returns nothing, and only one of them is fine.
   --------------------------------------------------------- */

async function checkMigration(): Promise<boolean> {
  section("0. Migration 0018");

  const documents = await admin.from("agent_documents").select("id").limit(1);
  const data = await admin.from("agent_data").select("id").limit(1);

  const ready = !documents.error && !data.error;

  check(
    "agent_documents and agent_data exist",
    ready,
    ready ? "" : (documents.error?.message ?? data.error?.message ?? "")
  );

  if (!ready) {
    console.log(
      "\nApply supabase/migrations/0018_agent_documents_and_data.sql in the" +
        "\nSupabase SQL Editor, then re-run this script.\n"
    );

    return false;
  }

  /* The functions, which a table-only apply would miss — a
     half-applied migration is the failure mode this project
     actually sees, because these files go in by hand. */
  const put = await admin.rpc("agent_data_put", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_agent_id: "00000000-0000-0000-0000-000000000000",
    p_key: "probe",
    p_value: "probe",
  });

  check(
    "agent_data_put is installed",
    /* A foreign-key violation proves the function ran. Only a
       missing function reports PGRST202. */
    put.error?.code !== "PGRST202",
    put.error?.code ?? "returned a row"
  );

  const prune = await admin.rpc("agent_documents_prune", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_agent_id: "00000000-0000-0000-0000-000000000000",
  });

  check(
    "agent_documents_prune is installed",
    prune.error?.code !== "PGRST202",
    prune.error?.code ?? "ran"
  );

  const sweep = await admin.rpc("agent_documents_sweep", {
    p_retired_days: 7,
  });

  check(
    "agent_documents_sweep is installed",
    sweep.error?.code !== "PGRST202",
    sweep.error?.code ?? "ran"
  );

  return true;
}

/* ---------------------------------------------------------
   1. DOCUMENTS
   --------------------------------------------------------- */

async function checkDocuments(mine: Learner, other: Learner) {
  section("1. Documents round-trip and stay owned");

  const rendered = renderSample("Weekly report");

  const stored = await DocumentStore.put({
    userId: mine.id,
    agentId: mine.agentA,
    title: "Weekly report",
    rendered,
  });

  check("a document is stored", Boolean(stored.id), stored.filename);

  const back = await DocumentStore.fetchForOwner(mine.id, stored.id);

  check(
    "the bytes come back byte-for-byte",
    back !== null && back.bytes.equals(rendered.bytes),
    `${back?.bytes.length ?? 0} bytes`
  );

  check(
    "and they are still a readable PDF",
    back !== null && back.bytes.subarray(0, 5).toString("latin1") === "%PDF-",
    "base64 in a text column round-trips unchanged"
  );

  /* THE NEGATIVES. */

  check(
    "another learner cannot fetch it",
    (await DocumentStore.fetchForOwner(other.id, stored.id)) === null,
    "indistinguishable from a missing id"
  );

  check(
    "an unknown id is null rather than an error",
    (await DocumentStore.fetchForOwner(
      mine.id,
      "99999999-9999-4999-8999-999999999999"
    )) === null
  );

  check(
    "a malformed id is null rather than a 500",
    (await DocumentStore.fetchForOwner(mine.id, "not-a-uuid")) === null,
    "the uuid cast failure is treated as a miss"
  );

  section("2. Document expiry and retention");

  const expired = await DocumentStore.put({
    userId: mine.id,
    agentId: mine.agentA,
    title: "Already expired",
    rendered: renderSample("Already expired"),
  });

  await admin
    .from("agent_documents")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", expired.id);

  check(
    "an expired document is unreachable before any sweep runs",
    (await DocumentStore.fetchForOwner(mine.id, expired.id)) === null,
    "checked on read, swept on write — the FileStore rule"
  );

  /* The per-agent count bound, which is what actually limits
     storage: a 6-hourly schedule makes 28 files inside the
     7-day window and the count is what stops that. */
  for (let index = 0; index < docConfig.keepPerAgent + 2; index += 1) {
    await DocumentStore.put({
      userId: mine.id,
      agentId: mine.agentB,
      title: `Report ${index}`,
      rendered: renderSample(`Report ${index}`),
    });
  }

  const kept = await DocumentStore.listForAgent(mine.id, mine.agentB, 100);

  check(
    "the per-agent ceiling evicts oldest-first on write",
    kept.length <= docConfig.keepPerAgent,
    `${kept.length} kept, ceiling ${docConfig.keepPerAgent}`
  );

  check(
    "and it keeps the NEWEST, not the oldest",
    kept.some((doc) => doc.title === `Report ${docConfig.keepPerAgent + 1}`),
    "a learner's latest report must survive their ceiling"
  );

  section("3. Documents are found by run");

  const runless = await DocumentStore.listForRun(mine.id, crypto.randomUUID());

  check(
    "an unknown run has no documents",
    runless.length === 0,
    "which is what an email with nothing attached is built from"
  );
}

/* ---------------------------------------------------------
   4. THE STORE
   --------------------------------------------------------- */

async function checkStore(mine: Learner, other: Learner) {
  section("4. The store round-trips and stays scoped");

  const scopeA = {
    kind: "owner" as const,
    userId: mine.id,
    agentId: mine.agentA,
  };
  const scopeB = {
    kind: "owner" as const,
    userId: mine.id,
    agentId: mine.agentB,
  };
  const scopeOther = {
    kind: "owner" as const,
    userId: other.id,
    agentId: other.agentA,
  };

  const written = await DataStore.putRecord(
    scopeA,
    "habits/2026-09-01",
    '{"pushups":30}',
    "daily habit log"
  );

  check("a record is created", written.status === "created", written.status);

  const read = await DataStore.getRecord(scopeA, "habits/2026-09-01");

  check(
    "and reads back exactly",
    read?.value === '{"pushups":30}',
    read?.value ?? "(nothing)"
  );

  /*
   * THE SCOPE KEY ROUND TRIP.
   *
   * 0010's lesson, applied to 0018: the column is generated by
   * the database and the TypeScript is what every query filters
   * on, so a disagreement does not error — it produces an agent
   * that writes records it can never read back. Reading the
   * stored value and comparing is the only way to catch that.
   */
  const row = await admin
    .from("agent_data")
    .select("scope_key")
    .eq("id", read?.id ?? "")
    .single();

  check(
    "the generated scope_key matches the TypeScript exactly",
    row.data?.scope_key === scopeKeyOf(scopeA),
    `${row.data?.scope_key} vs ${scopeKeyOf(scopeA)}`
  );

  /* THE NEGATIVES, and these are the reason the suite exists. */

  check(
    "another AGENT of the same learner cannot read it",
    (await DataStore.getRecord(scopeB, "habits/2026-09-01")) === null,
    "the predicate the whole ownership model rests on"
  );

  check(
    "another LEARNER cannot read it",
    (await DataStore.getRecord(scopeOther, "habits/2026-09-01")) === null
  );

  check(
    "and it is invisible in another agent's listing",
    (await DataStore.listRecords(scopeB)).length === 0
  );

  section("5. Updating, retiring and restoring");

  const updated = await DataStore.putRecord(
    scopeA,
    "habits/2026-09-01",
    '{"pushups":40}'
  );

  check("saving over a name updates it", updated.status === "updated");

  check(
    "the revision advances",
    updated.revision > written.revision,
    `${written.revision} → ${updated.revision}`
  );

  check(
    "and the count does not grow",
    updated.records === written.records,
    `${updated.records} records`
  );

  const retired = await DataStore.retireRecord(scopeA, "habits/2026-09-01");

  check("the agent can retire a record", retired);

  check(
    "a retired record is invisible to the agent",
    (await DataStore.getRecord(scopeA, "habits/2026-09-01")) === null
  );

  /*
   * THE DOCTRINE. MemoryStore states it: a person can delete,
   * and nothing a model writes can. `data_delete` is a soft
   * delete precisely so that rule survives a habit tracker
   * needing a remove button — the row is still there, and the
   * owner's screen offers it back.
   */
  const stillThere = await admin
    .from("agent_data")
    .select("id, deleted_at")
    .eq("user_id", mine.id)
    .eq("agent_id", mine.agentA)
    .eq("key", "habits/2026-09-01")
    .maybeSingle();

  check(
    "but the row survives, because only a person destroys one",
    stillThere.data !== null && stillThere.data.deleted_at !== null,
    "model output retires; a person destroys"
  );

  const restored = await DataStore.restoreRecord(
    mine.id,
    mine.agentA,
    stillThere.data?.id as string
  );

  check("the owner can restore it", restored);

  check(
    "and the agent can read it again",
    (await DataStore.getRecord(scopeA, "habits/2026-09-01")) !== null
  );

  section("6. The ceiling refuses rather than evicting");

  /*
   * The single most important behavioural difference between
   * this store and Memory, and the one worth a live test rather
   * than a unit one — the decision is made inside a database
   * function, so only the database can prove it.
   */
  const filler = Math.min(dataConfig.maxRecords, 40);

  const cappedScope = scopeB;

  for (let index = 0; index < filler; index += 1) {
    await DataStore.putRecord(
      cappedScope,
      `filler/${String(index).padStart(4, "0")}`,
      "x".repeat(20)
    );
  }

  const before = await DataStore.usage(cappedScope);

  /* Squeeze the ceiling down to what is already there, so the
     next write is the one that must be refused. The config is
     what the store reads, so lowering it is the honest way to
     reach the boundary without writing 200 rows. */
  const originalMax = dataConfig.maxRecords;
  (dataConfig as { maxRecords: number }).maxRecords = before.records;

  const refused = await DataStore.putRecord(
    cappedScope,
    "filler/overflow",
    "should not be stored"
  );

  const after = await DataStore.usage(cappedScope);

  (dataConfig as { maxRecords: number }).maxRecords = originalMax;

  check(
    "a write past the ceiling is refused",
    refused.status === "full_records",
    refused.status
  );

  check(
    "NOTHING was deleted to make room",
    after.records === before.records,
    `${before.records} before, ${after.records} after`
  );

  check(
    "and the refused record was not stored",
    (await DataStore.getRecord(cappedScope, "filler/overflow")) === null,
    "the opposite of what Memory does, on purpose"
  );

  check(
    "an update at the ceiling still works",
    (await DataStore.putRecord(cappedScope, "filler/0000", "changed")).status ===
      "updated",
    "a full store is not a frozen one"
  );

  section("7. Prefix listing");

  const habits = await DataStore.listRecords(scopeA, { prefix: "habits/" });

  check(
    "a prefix returns its own group",
    habits.length === 1 && habits[0].key === "habits/2026-09-01",
    `${habits.length} matched`
  );

  check(
    "a listing carries sizes but never values",
    habits.every(
      (record) =>
        typeof record.chars === "number" &&
        !Object.prototype.hasOwnProperty.call(record, "value")
    ),
    "one step cannot pull the whole store into the prompt"
  );

  const none = await DataStore.listRecords(scopeA, { prefix: "nothing/" });

  check("an unmatched prefix returns nothing", none.length === 0);

  /* `_` is a legal key character AND a LIKE wildcard. Unescaped
     it would match any character in that position, so a prefix
     search would silently return records it does not name. */
  await DataStore.putRecord(scopeA, "ax_b", "underscore");
  await DataStore.putRecord(scopeA, "axzb", "not a match");

  const underscore = await DataStore.listRecords(scopeA, { prefix: "ax_" });

  check(
    "an underscore in a prefix is escaped, not treated as a wildcard",
    underscore.length === 1 && underscore[0].key === "ax_b",
    `${underscore.map((r) => r.key).join(", ")}`
  );
}

/* ---------------------------------------------------------
   CLEANUP
   --------------------------------------------------------- */

async function cleanup() {
  section("8. Cleanup");

  let removed = 0;

  for (const id of created) {
    const gone = await admin.auth.admin.deleteUser(id);

    if (!gone.error) {
      removed += 1;
    }
  }

  check(
    "the test learners are removed",
    removed === created.length,
    `${removed}/${created.length}`
  );

  /* The cascade is the assertion. Deleting a learner has to take
     their documents and records with it — a row that outlived
     its owner is a row nobody can reach and nobody can delete. */
  for (const id of created) {
    const documents = await admin
      .from("agent_documents")
      .select("id")
      .eq("user_id", id);

    const data = await admin.from("agent_data").select("id").eq("user_id", id);

    check(
      "their documents and records cascaded away",
      (documents.data ?? []).length === 0 && (data.data ?? []).length === 0,
      `${(documents.data ?? []).length} documents, ${(data.data ?? []).length} records`
    );
  }
}

/* ---------------------------------------------------------
   MAIN
   --------------------------------------------------------- */

async function main() {
  console.log("\nPHASE 3 — end to end against the real database\n");

  if (!(await checkMigration())) {
    process.exit(1);
  }

  const mine = await makeLearner("owner");
  const other = await makeLearner("stranger");

  try {
    await checkDocuments(mine, other);
    await checkStore(mine, other);
  } finally {
    await cleanup();
  }

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
