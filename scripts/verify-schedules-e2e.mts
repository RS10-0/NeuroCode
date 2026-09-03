/*
 * Proof that a schedule actually runs, and that the things which
 * are supposed to stop it actually stop it.
 *
 * Asserts on the DATABASE rather than on the API's own report,
 * for the reason verify-actions-e2e.mts gives: a route that
 * returns {ok:true} having written nothing is exactly the bug a
 * suite like this exists to catch. The run rows, the counters
 * and the ledger are read back with the service role.
 *
 * Needs the API running with the ticker OFF, so timing is driven
 * here rather than racing a background timer:
 *
 *   preview_start neurolink-api-verify        (or)
 *   NEUROLINK_SCHEDULER=off npm --prefix server run dev
 *
 * Then:
 *
 *   npx tsx ./scripts/verify-schedules-e2e.mts
 *
 * Needs supabase/migrations/0017 applied. Section 0 checks that
 * first, because every section after it fails incomprehensibly
 * without it.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

/* ---------------------------------------------------------
   ENV

   Read and installed into `process.env` BEFORE the server
   modules are imported, which is why those imports are dynamic
   further down.

   The server's own env lives in server/.env and its modules read
   it at import time — lib/supabase.ts throws at module scope if
   SUPABASE_URL is missing. This script runs from the repo root,
   where `dotenv/config` finds nothing, so a static import of any
   server module would die before the first check ran.

   verify-actions-e2e.mts does not have this problem because it
   only ever speaks HTTP. This suite drives the claim and the
   runner in-process — that is the only way to test what two
   simultaneous ticks do — so it has to bring the environment
   with it.
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
const webEnv = readEnv(".env.local");

for (const [key, value] of Object.entries(serverEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

/* This process runs no timer of its own: the suite calls
   claimDue directly, and a background ticker in here would race
   with it. */
process.env.NEUROLINK_SCHEDULER = "off";

const { claimDue, settleRun, startRun } = await import(
  "../server/src/agents/schedule/ScheduleStore"
);
const { runScheduled } = await import("../server/src/agents/schedule/runner");

const SUPABASE_URL = serverEnv.SUPABASE_URL;
const SERVICE_KEY = serverEnv.SUPABASE_SECRET_KEY;
const ANON_KEY = webEnv.VITE_SUPABASE_ANON_KEY;
const API = process.env.API_BASE ?? "http://localhost:3001";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

interface Learner {
  id: string;
  email: string;
  token: string;
}

const created: string[] = [];

/*
 * The model every test agent is given.
 *
 * Resolved from the API rather than hardcoded: which model this
 * BuildGentic can actually run depends on which provider keys are
 * set, and an agent row naming one the server will not allow is
 * refused with `model_not_allowed` before a single token is
 * generated — which would look exactly like the feature being
 * broken.
 */
let platformModel: string | null = null;

async function resolveModel(learner: Learner): Promise<void> {
  const { status, body } = await callApi<{
    defaultModel?: string;
    models?: Array<{ id: string }>;
  }>("/api/ai/models", learner.token);

  if (status === 200) {
    platformModel = body.defaultModel ?? body.models?.[0]?.id ?? null;
  }
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
  const email = `neurolink-sched-verify+${tag}-${stamp}@example.com`;
  const password = `verify-${crypto.randomUUID()}`;

  const made = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `sched-verify-${tag}-${stamp}` },
  });

  if (made.error || !made.data.user) {
    throw new Error(`Could not create the test learner: ${made.error?.message}`);
  }

  created.push(made.data.user.id);

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await anon.auth.signInWithPassword({ email, password });

  if (signIn.error || !signIn.data.session) {
    throw new Error(`Could not sign in: ${signIn.error?.message}`);
  }

  /* Enough XP that the reserve never fires by accident. The
     reserve is tested deliberately in section 6. */
  await admin
    .from("user_credits")
    .upsert({ user_id: made.data.user.id, balance: 200, daily_allowance: 40 });

  return { id: made.data.user.id, email, token: signIn.data.session.access_token };
}

async function makeAgent(
  learner: Learner,
  name: string,
  instructions: string,
  capabilities: string[]
): Promise<string> {
  const made = await admin
    .from("agents")
    .insert({
      user_id: learner.id,
      name,
      description: "Created by verify-schedules-e2e.mts",
      avatar_emoji: "⏱️",
      avatar_tone: "accent",
      system_instructions: instructions,
      model: platformModel ?? "neurolink/mock-1",
      temperature: 0,
      max_output_tokens: 500,
      capabilities,
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (made.error || !made.data) {
    throw new Error(`Could not create the agent: ${made.error?.message}`);
  }

  return made.data.id as string;
}

async function callApi<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  const body = (await response.json().catch(() => ({}))) as T;

  return { status: response.status, body };
}

/* =========================================================
   0. THE MIGRATION

   First, because every section after this one fails
   incomprehensibly without it. Proved by WRITING, not by
   reading the catalogue: what matters is whether the statements
   the runtime makes are accepted.
========================================================= */

async function checkMigration() {
  section("0. MIGRATION 0017");

  for (const table of [
    "agent_schedules",
    "agent_schedule_runs",
    "agent_notifications",
  ]) {
    const probe = await admin.from(table).select("id").limit(1);
    check(`${table} exists`, !probe.error, probe.error?.message ?? "present");
  }

  const claim = await admin.rpc("agent_schedule_claim", {
    p_limit: 1,
    p_lease_seconds: 900,
  });

  check(
    "agent_schedule_claim is callable",
    !claim.error,
    claim.error?.message ?? "returns rows"
  );

  /* The eighth widening, proved by an insert. */
  const learner = await makeLearner("ledger");

  await resolveModel(learner);

  check(
    "a runnable model is configured",
    platformModel !== null,
    platformModel ?? "none — every run below would be refused as model_not_allowed"
  );

  const insert = await admin
    .from("ai_usage")
    .insert({
      user_id: learner.id,
      quota_key: `sched:platform:${learner.id}`,
      power_source_kind: "platform",
      provider_id: "neurolink",
      model: "probe",
      feature: "agent_scheduled",
      status: "done",
      ok: true,
    })
    .select("id")
    .single();

  check(
    "ai_usage accepts feature='agent_scheduled'",
    !insert.error,
    insert.error?.message ?? "the eighth widening is applied"
  );

  if (insert.data?.id) {
    await admin.from("ai_usage").delete().eq("id", insert.data.id);
  }
}

/* =========================================================
   1. THE PREVIEW GATE

   The rule that a schedule cannot be switched on until its
   owner has watched its current task work once.
========================================================= */

async function checkPreviewGate(): Promise<{
  learner: Learner;
  agentId: string;
  scheduleId: string;
}> {
  section("1. THE PREVIEW GATE");

  const learner = await makeLearner("gate");
  const agentId = await makeAgent(
    learner,
    "Digest",
    "You are a concise assistant. Answer in one short sentence.",
    ["chat"]
  );

  const made = await callApi<{ schedule: { id: string; enabled: boolean; verified: boolean } }>(
    "/api/schedules",
    learner.token,
    {
      method: "POST",
      body: JSON.stringify({
        agentId,
        label: "Morning digest",
        task: "Say good morning and name today's date.",
        cadence: "daily",
        hourLocal: 9,
        timezone: "UTC",
      }),
    }
  );

  check(
    "a schedule can be created",
    made.status === 201 && Boolean(made.body.schedule?.id),
    `status ${made.status}`
  );

  const scheduleId = made.body.schedule.id;

  check(
    "it is created switched OFF",
    made.body.schedule.enabled === false,
    "there is no path to `enabled` that skips the gate"
  );

  check(
    "and unverified",
    made.body.schedule.verified === false,
    "no preview run has happened yet"
  );

  /* The refusal that is the whole point of the gate. */
  const early = await callApi<{ code: string }>(
    `/api/schedules/${scheduleId}/enable`,
    learner.token,
    { method: "POST" }
  );

  check(
    "enabling is REFUSED before a successful preview run",
    early.status === 409 && early.body.code === "not_verified",
    `status ${early.status}, code ${early.body.code}`
  );

  /* The preview itself: the same runner, the same row shape. */
  const preview = await callApi<{
    outcome: string;
    schedule: { verified: boolean };
    run: { trigger: string; outcome: string; output: string | null };
  }>(`/api/schedules/${scheduleId}/run`, learner.token, { method: "POST" });

  check(
    "run once now completes",
    preview.status === 200 && preview.body.outcome === "succeeded",
    `outcome ${preview.body.outcome ?? preview.status}`
  );

  check(
    "the preview is recorded as a real run, marked manual",
    preview.body.run?.trigger === "manual" &&
      (preview.body.run?.output ?? "").length > 0,
    `trigger ${preview.body.run?.trigger}, ${(preview.body.run?.output ?? "").length} chars`
  );

  check(
    "a successful preview verifies the task",
    preview.body.schedule?.verified === true,
    "the gate is now open for THIS task text"
  );

  const enabled = await callApi<{ schedule: { enabled: boolean; nextRunAt: string | null } }>(
    `/api/schedules/${scheduleId}/enable`,
    learner.token,
    { method: "POST" }
  );

  check(
    "and then it can be switched on",
    enabled.status === 200 && enabled.body.schedule?.enabled === true,
    `next run ${enabled.body.schedule?.nextRunAt ?? "(none)"}`
  );

  check(
    "an enabled schedule always has a due time",
    Boolean(enabled.body.schedule?.nextRunAt),
    "an enabled row with no due time would silently never run"
  );

  /* Editing the task re-locks it. */
  const edited = await callApi<{ schedule: { verified: boolean; enabled: boolean } }>(
    `/api/schedules/${scheduleId}`,
    learner.token,
    {
      method: "PATCH",
      body: JSON.stringify({
        label: "Morning digest",
        task: "Say good evening and name tomorrow's date instead.",
        cadence: "daily",
        hourLocal: 9,
        timezone: "UTC",
      }),
    }
  );

  check(
    "editing the task un-verifies it",
    edited.body.schedule?.verified === false,
    "a changed instruction is an untested instruction"
  );

  check(
    "and switches a running schedule off",
    edited.body.schedule?.enabled === false,
    "it must not keep running on something nobody proved"
  );

  return { learner, agentId, scheduleId };
}

/* =========================================================
   2. THE PER-USER CAP
========================================================= */

async function checkCap() {
  section("2. THE PER-USER CAP");

  const learner = await makeLearner("cap");
  const agentId = await makeAgent(
    learner,
    "Capped",
    "Answer in one short sentence.",
    ["chat"]
  );

  const ids: string[] = [];

  for (let i = 0; i < 3; i += 1) {
    const made = await callApi<{ schedule: { id: string } }>(
      "/api/schedules",
      learner.token,
      {
        method: "POST",
        body: JSON.stringify({
          agentId,
          label: `Schedule ${i + 1}`,
          task: `Say the number ${i + 1} and nothing else.`,
          cadence: "daily",
          hourLocal: 9,
          timezone: "UTC",
        }),
      }
    );

    ids.push(made.body.schedule.id);

    /* Verify each, so the cap is what refuses rather than the
       gate. Done through the store's own hash rule by running
       the preview. */
    await callApi(`/api/schedules/${ids[i]}/run`, learner.token, {
      method: "POST",
    });
  }

  const first = await callApi<{ schedule: { enabled: boolean } }>(
    `/api/schedules/${ids[0]}/enable`,
    learner.token,
    { method: "POST" }
  );
  const second = await callApi<{ schedule: { enabled: boolean } }>(
    `/api/schedules/${ids[1]}/enable`,
    learner.token,
    { method: "POST" }
  );
  const third = await callApi<{ code: string }>(
    `/api/schedules/${ids[2]}/enable`,
    learner.token,
    { method: "POST" }
  );

  check(
    "two schedules can run at once",
    first.body.schedule?.enabled === true && second.body.schedule?.enabled === true,
    "the configured cap is 2"
  );

  check(
    "the third is refused by the cap",
    third.status === 409 && third.body.code === "too_many",
    `status ${third.status}, code ${third.body.code}`
  );
}

/* =========================================================
   3. THE CLAIM

   Two ticks at once must not run one schedule twice, and an
   outage must not replay as a burst.
========================================================= */

async function checkClaim() {
  section("3. THE CLAIM");

  const learner = await makeLearner("claim");
  const agentId = await makeAgent(
    learner,
    "Claimed",
    "Answer in one short sentence.",
    ["chat"]
  );

  const made = await admin
    .from("agent_schedules")
    .insert({
      user_id: learner.id,
      agent_id: agentId,
      label: "Due now",
      task: "Say the word ready and nothing else.",
      cadence: "every_6_hours",
      timezone: "UTC",
      enabled: true,
      /* Due 19 hours ago: three six-hour windows missed. */
      next_run_at: new Date(Date.now() - 19 * 3_600_000).toISOString(),
      verified_task_hash: "seeded",
    })
    .select("id")
    .single();

  const scheduleId = made.data!.id as string;

  /*
   * Two claims, concurrently. The second must come back empty:
   * `for update skip locked` means it steps over the row the
   * first one is holding rather than waiting for it.
   */
  const [a, b] = await Promise.all([claimDue(5, 900), claimDue(5, 900)]);

  const mine = [...a, ...b].filter((row) => row.scheduleId === scheduleId);

  check(
    "two concurrent ticks claim one schedule exactly once",
    mine.length === 1,
    `${mine.length} claim(s)`
  );

  check(
    "a missed outage is reported, not replayed",
    mine[0] !== undefined && mine[0].missedRuns >= 2,
    `missed_runs = ${mine[0]?.missedRuns ?? "n/a"} for a 19-hour gap`
  );

  /* And the due time was pushed forward FROM NOW, not from the
     stale value — otherwise it would be due again immediately. */
  const after = await admin
    .from("agent_schedules")
    .select("next_run_at, lease_until")
    .eq("id", scheduleId)
    .single();

  const nextRun = new Date(after.data!.next_run_at as string).getTime();

  check(
    "the next run is pushed forward from now, not from the stale due time",
    nextRun > Date.now() + 5 * 3_600_000,
    `next run in ${Math.round((nextRun - Date.now()) / 3_600_000)}h`
  );

  check(
    "the claim holds a lease",
    Boolean(after.data!.lease_until),
    "so a second tick cannot re-enter a run in progress"
  );

  /* A third claim now finds nothing: it is leased and not due. */
  const third = await claimDue(5, 900);

  check(
    "an immediate third tick finds nothing to do",
    third.every((row) => row.scheduleId !== scheduleId),
    "no backlog burst"
  );

  return { learner, agentId, scheduleId };
}

/* =========================================================
   4. A REAL SCHEDULED RUN

   The whole path, end to end, against a live model.
========================================================= */

async function checkRun() {
  section("4. A REAL SCHEDULED RUN");

  const learner = await makeLearner("run");
  const agentId = await makeAgent(
    learner,
    "Adder",
    "You are a careful assistant. Answer briefly.",
    ["chat", "code_execution"]
  );

  const made = await admin
    .from("agent_schedules")
    .insert({
      user_id: learner.id,
      agent_id: agentId,
      label: "Sum check",
      task: "Work out the sum of the numbers 17, 34 and 51, and state the total.",
      cadence: "every_6_hours",
      timezone: "UTC",
      enabled: true,
      next_run_at: new Date(Date.now() - 60_000).toISOString(),
      verified_task_hash: "seeded",
    })
    .select("id")
    .single();

  const scheduleId = made.data!.id as string;

  const claimed = (await claimDue(5, 900)).find(
    (row) => row.scheduleId === scheduleId
  );

  check("the due schedule is claimed", Boolean(claimed), claimed ? "claimed" : "missed");

  if (!claimed) {
    return;
  }

  const report = await runScheduled({
    scheduleId: claimed.scheduleId,
    agentId: claimed.agentId,
    userId: claimed.userId,
    task: claimed.task,
    trigger: "schedule",
    cadence: claimed.cadence,
    hourLocal: claimed.hourLocal,
    weekdayLocal: claimed.weekdayLocal,
    timezone: claimed.timezone,
    missedRuns: claimed.missedRuns,
  });

  check(
    "it runs and is not a failure",
    report.outcome === "succeeded" || report.outcome === "limit_reached",
    `outcome ${report.outcome}${report.detail ? ` (${report.detail})` : ""}`
  );

  check(
    "it produced output",
    report.output.trim().length > 0,
    `${report.output.trim().length} chars`
  );

  /* Read the ROW back, not the report. */
  const row = await admin
    .from("agent_schedule_runs")
    .select("outcome, trigger, output, steps, tool_calls, finished_at, xp_spent, missed_runs")
    .eq("id", report.runId!)
    .single();

  check(
    "the run row is settled in the database",
    row.data?.outcome === report.outcome && Boolean(row.data?.finished_at),
    `outcome=${row.data?.outcome} finished=${Boolean(row.data?.finished_at)}`
  );

  check(
    "it is marked as a scheduled run, not a manual one",
    row.data?.trigger === "schedule"
  );

  check(
    "the run row carries the answer",
    typeof row.data?.output === "string" && row.data.output.length > 0,
    `${(row.data?.output as string)?.length ?? 0} chars stored`
  );

  /* The ledger. A scheduled turn must not hide as an agent_test. */
  const usage = await admin
    .from("ai_usage")
    .select("feature, model")
    .eq("user_id", learner.id);

  const rows = usage.data ?? [];

  check(
    "the ledger records the turn as agent_scheduled",
    rows.some((r) => r.feature === "agent_scheduled"),
    `features: ${[...new Set(rows.map((r) => r.feature))].join(", ") || "(none)"}`
  );

  check(
    "a scheduled turn writes NO agent_test rows",
    !rows.some((r) => r.feature === "agent_test"),
    "it must not be billed as somebody sitting in the Builder"
  );

  /* The schedule's own state after a good run. */
  const sched = await admin
    .from("agent_schedules")
    .select("consecutive_failures, lease_until, next_run_at, enabled")
    .eq("id", scheduleId)
    .single();

  check(
    "the lease is released when the run settles",
    sched.data?.lease_until === null,
    "otherwise the schedule would lose its next window"
  );

  check(
    "a completed run resets the failure counter",
    sched.data?.consecutive_failures === 0
  );

  check(
    "the schedule is still enabled after a good run",
    sched.data?.enabled === true
  );
}

/* =========================================================
   5. THE CIRCUIT BREAKER

   Driven through the settle function directly, because what is
   being tested is the state machine rather than the model: three
   failures disable, two confabulations disable sooner, and a
   completed run resets both.
========================================================= */

async function checkBreaker() {
  section("5. THE CIRCUIT BREAKER");

  const learner = await makeLearner("breaker");
  const agentId = await makeAgent(learner, "Breaks", "Answer briefly.", ["chat"]);

  const seed = async (label: string) => {
    const made = await admin
      .from("agent_schedules")
      .insert({
        user_id: learner.id,
        agent_id: agentId,
        label,
        task: "Say anything at all, briefly.",
        cadence: "every_6_hours",
        timezone: "UTC",
        enabled: true,
        next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
        verified_task_hash: "seeded",
      })
      .select("id")
      .single();

    return made.data!.id as string;
  };

  const fail = async (scheduleId: string, outcome: string) => {
    const runId = await startRun({
      scheduleId,
      agentId,
      userId: learner.id,
      trigger: "schedule",
    });

    return await settleRun({
      runId,
      outcome: outcome as never,
      detail: "verify",
    });
  };

  /* ---- three infra failures ---- */

  const a = await seed("Three strikes");

  const one = await fail(a, "infra_failure");
  const two = await fail(a, "infra_failure");

  check(
    "one failure does not disable",
    one?.disabled === false && one?.consecutiveFailures === 1,
    `count ${one?.consecutiveFailures}`
  );

  check(
    "two failures do not disable",
    two?.disabled === false && two?.consecutiveFailures === 2,
    `count ${two?.consecutiveFailures} — an outage can span two ticks`
  );

  const three = await fail(a, "infra_failure");

  check(
    "the THIRD consecutive failure disables the schedule",
    three?.disabled === true && three?.disabledReason === "consecutive_failures",
    `reason ${three?.disabledReason}`
  );

  const afterA = await admin
    .from("agent_schedules")
    .select("enabled, next_run_at, disabled_reason")
    .eq("id", a)
    .single();

  check(
    "and the row is actually switched off, with no due time",
    afterA.data?.enabled === false && afterA.data?.next_run_at === null,
    `enabled=${afterA.data?.enabled} next=${afterA.data?.next_run_at}`
  );

  /* ---- two confabulations ---- */

  const b = await seed("Two lies");

  const lie1 = await fail(b, "confabulated");

  check(
    "one confabulation does not disable, but is counted twice over",
    lie1?.disabled === false &&
      lie1?.consecutiveConfabulations === 1 &&
      lie1?.consecutiveFailures === 1,
    `confabs ${lie1?.consecutiveConfabulations}, failures ${lie1?.consecutiveFailures}`
  );

  const lie2 = await fail(b, "confabulated");

  check(
    "the SECOND confabulation disables it — sooner than a failure",
    lie2?.disabled === true && lie2?.disabledReason === "confabulation",
    `reason ${lie2?.disabledReason} at ${lie2?.consecutiveConfabulations} confabulations`
  );

  /* ---- a completed run resets ---- */

  const c = await seed("Recovers");

  await fail(c, "infra_failure");
  await fail(c, "infra_failure");

  const recovered = await fail(c, "succeeded");

  check(
    "a completed run resets the counters",
    recovered?.disabled === false && recovered?.consecutiveFailures === 0,
    `count back to ${recovered?.consecutiveFailures}`
  );

  const fourth = await fail(c, "infra_failure");

  check(
    "so the streak starts again from one",
    fourth?.consecutiveFailures === 1 && fourth?.disabled === false,
    `count ${fourth?.consecutiveFailures}`
  );

  /* ---- limit_reached is not a failure ---- */

  const d = await seed("Runs long");

  await fail(d, "infra_failure");
  const limited = await fail(d, "limit_reached");

  check(
    "limit_reached resets the failure counter — the pipeline worked",
    limited?.consecutiveFailures === 0 && limited?.consecutiveLimits === 1,
    `failures ${limited?.consecutiveFailures}, limits ${limited?.consecutiveLimits}`
  );

  for (let i = 0; i < 5; i += 1) {
    await fail(d, "limit_reached");
  }

  const stillOn = await admin
    .from("agent_schedules")
    .select("enabled")
    .eq("id", d)
    .single();

  check(
    "and six of them still do NOT disable it",
    stillOn.data?.enabled === true,
    "an under-specified task is an edit to make, not a switch to throw"
  );

  /* ---- skipped touches nothing ---- */

  const e = await seed("Skips");

  await fail(e, "infra_failure");
  const skipped = await fail(e, "skipped");

  /*
   * A skip is NEUTRAL. It does not increment the failure counter
   * — being out of XP is not a broken schedule — and it does not
   * reset it either, because a run that never happened is no
   * evidence that the schedule is healthy. The streak is left
   * exactly where it was.
   */
  check(
    "a skipped run does not count as a failure",
    skipped?.consecutiveFailures === 1 && skipped?.consecutiveSkips === 1,
    `failures held at ${skipped?.consecutiveFailures}, skips ${skipped?.consecutiveSkips}`
  );

  /* ---- settling twice is a no-op ---- */

  const f = await seed("Idempotent");

  const runId = await startRun({
    scheduleId: f,
    agentId,
    userId: learner.id,
    trigger: "schedule",
  });

  const firstSettle = await settleRun({ runId, outcome: "infra_failure" });
  const secondSettle = await settleRun({ runId, outcome: "infra_failure" });

  check(
    "settling the same run twice moves the counter once",
    firstSettle?.consecutiveFailures === 1 && secondSettle === null,
    "the reaper and a late runner can both reach one row"
  );

  return { learner, agentId };
}

/* =========================================================
   6. NOTIFICATIONS

   That the disable actually reaches somebody, and that a
   preview does not.
========================================================= */

async function checkNotifications(learner: Learner) {
  section("6. NOTIFICATIONS");

  const feed = await callApi<{
    notifications: Array<{ kind: string; title: string }>;
    unread: number;
  }>("/api/schedules/feed/notifications", learner.token);

  check(
    "the feed is readable by its owner",
    feed.status === 200 && Array.isArray(feed.body.notifications),
    `status ${feed.status}`
  );

  /* Section 5 disabled two schedules through the settle path,
     which does not itself notify — the tick reconciles. Prove
     the reconciliation writes exactly one notice per schedule. */
  const { reconcileDisables } = await import(
    "../server/src/agents/schedule/notify"
  );

  const first = await reconcileDisables();
  const second = await reconcileDisables();

  check(
    "a disable with no notice is reconciled into one",
    first > 0,
    `${first} notice(s) written`
  );

  check(
    "and reconciling again writes no duplicates",
    second === 0,
    `${second} on the second pass`
  );

  const after = await callApi<{
    notifications: Array<{ kind: string; scheduleId: string }>;
    unread: number;
  }>("/api/schedules/feed/notifications", learner.token);

  const disables = after.body.notifications.filter(
    (n) => n.kind === "schedule_disabled"
  );

  const perSchedule = new Map<string, number>();

  for (const notice of disables) {
    perSchedule.set(notice.scheduleId, (perSchedule.get(notice.scheduleId) ?? 0) + 1);
  }

  check(
    "exactly one disable notice per disabled schedule",
    [...perSchedule.values()].every((count) => count === 1),
    `${disables.length} notice(s) across ${perSchedule.size} schedule(s)`
  );

  check(
    "the unread badge counts them",
    after.body.unread >= disables.length,
    `unread ${after.body.unread}`
  );
}

/* =========================================================
   7. THE XP RESERVE
========================================================= */

async function checkReserve() {
  section("7. THE XP RESERVE");

  const learner = await makeLearner("broke");
  const agentId = await makeAgent(learner, "Broke", "Answer briefly.", ["chat"]);

  await admin
    .from("user_credits")
    .upsert({ user_id: learner.id, balance: 2, daily_allowance: 40 });

  const made = await admin
    .from("agent_schedules")
    .insert({
      user_id: learner.id,
      agent_id: agentId,
      label: "Too poor",
      task: "Say anything at all, briefly.",
      cadence: "every_6_hours",
      timezone: "UTC",
      enabled: true,
      next_run_at: new Date(Date.now() - 60_000).toISOString(),
      verified_task_hash: "seeded",
    })
    .select("id")
    .single();

  const report = await runScheduled({
    scheduleId: made.data!.id as string,
    agentId,
    userId: learner.id,
    task: "Say anything at all, briefly.",
    trigger: "schedule",
    cadence: "every_6_hours",
    timezone: "UTC",
    weekdayLocal: null,
  });

  check(
    "a run below the reserve is SKIPPED, not failed",
    report.outcome === "skipped" && report.detail === "out_of_xp",
    `outcome ${report.outcome} (${report.detail})`
  );

  const sched = await admin
    .from("agent_schedules")
    .select("enabled, consecutive_failures, consecutive_skips")
    .eq("id", made.data!.id as string)
    .single();

  check(
    "it does not touch the failure counter",
    sched.data?.consecutive_failures === 0,
    "a learner spending XP on lessons has not broken their schedule"
  );

  check(
    "and the schedule stays on",
    sched.data?.enabled === true,
    "it picks up again on its own when they earn XP"
  );

  /* A MANUAL run is the foreground thing and is not held to the
     background reserve. */
  const manual = await runScheduled({
    scheduleId: made.data!.id as string,
    agentId,
    userId: learner.id,
    task: "Say anything at all, briefly.",
    trigger: "manual",
  });

  check(
    "but a manual preview is not held to it",
    manual.outcome !== "skipped",
    `outcome ${manual.outcome} — somebody pressed a button`
  );
}

/* =========================================================
   CLEAN UP
========================================================= */

async function cleanup() {
  section("CLEAN UP");

  let removed = 0;

  for (const id of created) {
    const gone = await admin.auth.admin.deleteUser(id);

    if (!gone.error) {
      removed += 1;
    }
  }

  check(
    "test learners removed",
    removed === created.length,
    `${removed}/${created.length} (cascades take their schedules, runs and notifications)`
  );
}

/* =========================================================
   RUN
========================================================= */

console.log("BUILDGENTIC — SCHEDULED RUNS, LIVE PROOF");
console.log(`  API: ${API}`);

try {
  await checkMigration();
  await checkPreviewGate();
  await checkCap();
  await checkClaim();
  await checkRun();
  const breaker = await checkBreaker();
  if (breaker) await checkNotifications(breaker.learner);
  await checkReserve();
} catch (error) {
  failed += 1;
  failures.push("the suite threw");
  console.log(`\n  FAIL  the suite threw - ${error instanceof Error ? error.message : error}`);
} finally {
  await cleanup();
}

section("SUMMARY");
console.log(`  ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\n  Failures:");
  for (const label of failures) {
    console.log(`    - ${label}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
