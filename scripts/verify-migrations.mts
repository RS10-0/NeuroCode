/*
 * Which migrations are actually in this database.
 *
 * Two halves, and the second is the reason this script exists
 * rather than just reading the startup banner.
 *
 * THE SHAPE HALF re-runs the same probes the server runs at
 * boot — `server/src/lib/schemaManifest.ts`, one manifest, two
 * consumers, so the banner and this script can never disagree.
 *
 * THE BEHAVIOURAL HALF covers the three the banner cannot see.
 * 0008 and 0009 only widen a CHECK constraint and 0012 only
 * replaces a function body; nothing read-only can observe any
 * of them. There is no `information_schema` to query here —
 * PostgREST exposes `public` and nothing else, and this project
 * holds no direct Postgres connection string — so the honest
 * way to confirm a constraint is to present it with the value
 * it is supposed to accept and see what happens.
 *
 * That is arguably better evidence than the constraint's text
 * would be: it proves the constraint accepts what the code
 * actually writes, rather than proving a string matches.
 *
 * IT WRITES, which is why it cannot be the boot check. Every
 * row it creates hangs off one throwaway user and goes when
 * that user is deleted — `ai_usage.user_id` and
 * `xp_transactions.user_id` are both `on delete cascade`.
 *
 *   npx tsx ./scripts/verify-migrations.mts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

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

const admin = createClient(
  serverEnv.SUPABASE_URL,
  serverEnv.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { inspectSchema } = await import("../server/src/lib/schemaCheck");
const { LATEST_MIGRATION, UNPROBEABLE } = await import(
  "../server/src/lib/schemaManifest"
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

let userId: string | null = null;

async function makeUser(): Promise<string> {
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

  const made = await admin.auth.admin.createUser({
    email: `neurolink-migrations+${stamp}@example.com`,
    password: `verify-${crypto.randomUUID()}`,
    email_confirm: true,
    user_metadata: { username: `migration-probe-${stamp}` },
  });

  if (made.error || !made.data.user) {
    throw new Error(`Could not create the probe user: ${made.error?.message}`);
  }

  return made.data.user.id;
}

async function cleanup() {
  if (userId) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}

/* =========================================================
   1. SHAPE — the same probes the server runs at boot
========================================================= */

async function checkShape() {
  section(`1. Shape probes (through ${LATEST_MIGRATION})`);

  const state = await inspectSchema();

  check(
    `all ${state.checked} shape probes satisfied`,
    state.missing.length === 0 && state.unknown.length === 0,
    state.missing.length > 0
      ? `missing: ${[...new Set(state.missing.map((p) => p.id))].join(", ")}`
      : state.unknown.length > 0
        ? `could not probe ${state.unknown.length}`
        : "no gaps"
  );

  for (const probe of state.missing) {
    console.log(
      `        ${probe.id} ${probe.name} — ${probe.table}.${probe.column}` +
        (probe.absent ? " should be GONE" : " not found")
    );
  }

  for (const { probe, reason } of state.unknown) {
    console.log(`        ${probe.id} ${probe.table}.${probe.column} — ${reason}`);
  }
}

/* =========================================================
   2. THE CHECK CONSTRAINT — 0008 and 0009

   `ai_usage_feature_check` is a CHECK on `feature`. It is
   confirmed by inserting each value the constraint is supposed
   to permit: acceptance IS the constraint being present, and a
   rejection comes back as 23514 naming the constraint.

   Inserted directly rather than through `ai_usage_admit`,
   because admit takes seventeen parameters and consumes real
   quota windows. The CHECK fires on a plain insert, which is
   the narrowest thing that proves the point.
========================================================= */

async function insertFeature(feature: string) {
  return admin.from("ai_usage").insert({
    user_id: userId,
    quota_key: `migration-probe:${feature}`,
    /*
     * 'platform', not 'free'. 0003 shipped ('free','byok',
     * 'managed') and 0004 replaced it with ('platform','byok',
     * 'managed'). Using the 0003 value made every row fail
     * ai_usage_power_source_kind_check, which looked exactly
     * like a feature rejection until the constraint NAME was
     * read — which is why the assertions below name it.
     */
    power_source_kind: "platform",
    provider_id: "probe",
    model: "probe",
    feature,
    status: "done",
  });
}

async function checkFeatureConstraint() {
  section("2. ai_usage_feature_check — 0008, 0009 (and the rest)");

  /*
   * Each value beside the migration that introduced it, so a
   * failure names the file to apply rather than just a string.
   */
  const FEATURES: Array<[string, string]> = [
    ["lab", "0003"],
    ["agent_test", "0003"],
    ["agent_public", "0003"],
    ["agent_index", "0007"],
    ["agent_retrieval", "0007"],
    ["agent_web_search", "0008"],
    ["agent_file_analysis", "0009"],
    ["agent_memory", "0010"],
    ["agent_site", "0013"],
    ["site_edit", "0013"],
    ["agent_action", "0016"],
    ["agent_scheduled", "0017"],
    ["agent_extension", "0020"],
  ];

  for (const [feature, migration] of FEATURES) {
    const { error } = await insertFeature(feature);

    check(
      `${migration}: feature '${feature}' is permitted`,
      !error,
      error ? `${error.code}: ${error.message}` : ""
    );
  }

  /*
   * And the constraint still REFUSES something, which is the
   * half that proves it exists at all rather than having been
   * dropped. A check that only ever sees acceptances would pass
   * against a table with no constraint on it.
   */
  const { error } = await insertFeature("definitely_not_a_feature");

  /*
   * THE CONSTRAINT IS NAMED, not just the SQLSTATE.
   *
   * 23514 is "some check constraint failed" and `ai_usage` has
   * more than one. The first version of this asserted the code
   * alone and passed while every row was in fact being refused
   * by ai_usage_power_source_kind_check — a green test that
   * proved nothing about the constraint it claimed to cover.
   */
  check(
    "the constraint still refuses an unknown feature",
    error?.code === "23514" &&
      /ai_usage_feature_check/.test(error.message),
    error
      ? `refused by ${
          /violates check constraint "([a-z_]+)"/.exec(error.message)?.[1] ??
          error.code
        }`
      : "ACCEPTED — CONSTRAINT IS MISSING"
  );
}

/* =========================================================
   3. grant_credits — 0012

   0011 shipped `grant_credits` with an ON CONFLICT that named
   the columns of a PARTIAL unique index without repeating its
   predicate. Postgres cannot prove the row falls inside such an
   index, so every sourced grant raised:
   `there is no unique or exclusion constraint matching the ON
   CONFLICT specification`.

   0012 adds the predicate and nothing else. So a sourced grant
   that SUCCEEDS is 0012 applied, and one that raises 42P10 is
   0012 missing — a sharper signal than the function's text.
========================================================= */

async function checkGrantCredits() {
  section("3. grant_credits ON CONFLICT — 0012");

  const source = `migration-probe-${crypto.randomUUID()}`;

  const first = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: 1,
    p_reason: "migration probe",
    p_source_type: "probe",
    p_source_id: source,
  });

  check(
    "0012: a SOURCED grant succeeds rather than raising 42P10",
    !first.error,
    first.error
      ? `${first.error.code}: ${first.error.message}`
      : "granted"
  );

  /*
   * And it is idempotent, which is what the partial index was
   * there for in the first place. Replaying a lesson must pay
   * once.
   */
  const second = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: 1,
    p_reason: "migration probe",
    p_source_type: "probe",
    p_source_id: source,
  });

  const { count } = await admin
    .from("xp_transactions")
    .select("id", { count: "exact", head: false })
    .eq("user_id", userId)
    .eq("source_id", source);

  check(
    "0012: replaying the same source pays exactly once",
    !second.error && count === 1,
    second.error ? `${second.error.code}` : `${count} ledger row(s)`
  );
}

/* =========================================================
   RUN
========================================================= */

async function main() {
  console.log("\nBuildGentic — migration state (live database)\n");

  try {
    await checkShape();

    userId = await makeUser();

    await checkFeatureConstraint();
    await checkGrantCredits();
  } finally {
    await cleanup();
  }

  console.log(
    `\n  The three the boot check cannot see: ${UNPROBEABLE.map(
      (m) => `${m.id} (${m.why})`
    ).join(", ")}`
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }

    process.exitCode = 1;
  }
}

void main().catch(async (error: unknown) => {
  await cleanup();
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
