/*
 * End-to-end proof that the course progression system persists.
 *
 * Drives the real Express API with a real bearer token, then
 * reads the database back with the service key to check what
 * actually landed. Nothing is asserted from the client's own
 * report of success.
 *
 *   node --experimental-strip-types __verify-progress.mts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { CURRICULA } from "../src/core/curriculum/registry.ts";
import { planLessonXp } from "../src/features/learn/xp.ts";

/* What each step is worth, per the curriculum the server reads. */
const PLAN: Record<string, number> = {};

for (const curriculum of CURRICULA) {
  for (const lesson of curriculum.lessons) {
    Object.assign(PLAN, planLessonXp(lesson));
  }
}

/* ---------------------------------------------------------
   ENV
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

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* ---------------------------------------------------------
   1. SCHEMA
   --------------------------------------------------------- */

async function checkSchema(): Promise<boolean> {
  section("1. SCHEMA");

  let ok = true;

  for (const table of [
    "lesson_step_progress",
    "onboarding",
    "lesson_progress",
    "course_progress",
    "user_stats",
  ]) {
    const { error } = await admin.from(table).select("*").limit(1);
    const present = !error;
    check(`table ${table}`, present, error?.message ?? "");
    if (!present) ok = false;
  }

  const { error: rpcError } = await admin.rpc("award_step_xp", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_lesson_id: "__schema_probe__",
    p_step_id: "__schema_probe__",
    p_xp: 0,
    p_score: null,
  });

  /* A foreign-key complaint means the function exists and ran. */
  const rpcPresent =
    !rpcError || !/schema cache|does not exist/i.test(rpcError.message);

  check("function award_step_xp", rpcPresent, rpcError?.message?.slice(0, 90) ?? "");
  if (!rpcPresent) ok = false;

  return ok;
}

/* ---------------------------------------------------------
   2. UNAUTHENTICATED ACCESS
   --------------------------------------------------------- */

async function checkUnauthenticated() {
  section("2. UNAUTHENTICATED ACCESS IS REJECTED");

  const cases: Array<[string, RequestInit]> = [
    [
      "POST /api/progress/step (no token)",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: "x", stepId: "y", xp: 100 }),
      },
    ],
    [
      "POST /api/progress/step (garbage token)",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer not-a-real-token",
        },
        body: JSON.stringify({ lessonId: "x", stepId: "y", xp: 100 }),
      },
    ],
  ];

  for (const [label, init] of cases) {
    const res = await fetch(`${API}/api/progress/step`, init);
    check(label, res.status === 401, `HTTP ${res.status}`);
  }

  const res = await fetch(`${API}/api/progress/steps/ai-foundations-01`);
  check(
    "GET /api/progress/steps/:id (no token)",
    res.status === 401,
    `HTTP ${res.status}`
  );
}

/* ---------------------------------------------------------
   3. THE XP RPC IS NOT REACHABLE FROM A BROWSER
   --------------------------------------------------------- */

async function checkRpcLockdown(accessToken: string) {
  section("3. XP RPC IS NOT CALLABLE BY A SIGNED-IN BROWSER");

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { error } = await asUser.rpc("award_step_xp", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_lesson_id: "farm",
    p_step_id: "farm",
    p_xp: 999999,
    p_score: null,
  });

  check(
    "authenticated role cannot execute award_step_xp",
    Boolean(error),
    error ? error.message.slice(0, 90) : "CALL SUCCEEDED - XP CAN BE FARMED"
  );

  const { error: incError } = await asUser.rpc("increment_xp", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_amount: 999999,
  });

  check(
    "authenticated role cannot execute increment_xp",
    Boolean(incError),
    incError ? incError.message.slice(0, 90) : "CALL SUCCEEDED - XP CAN BE FARMED"
  );
}

/* ---------------------------------------------------------
   4. STEP PERSISTENCE AND XP IDEMPOTENCY
   --------------------------------------------------------- */

async function checkStepFlow(userId: string, accessToken: string) {
  section("4. STEP PERSISTENCE AND XP IDEMPOTENCY");

  const lessonId = "ai-foundations-01";
  const stepId = "ai-foundations-01-step-02";
  const XP = PLAN[stepId];

  const post = (payload: unknown) =>
    fetch(API + "/api/progress/step", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
      },
      body: JSON.stringify(payload),
    });

  const readXp = async (): Promise<number> => {
    const r = await admin
      .from("user_stats")
      .select("xp")
      .eq("user_id", userId)
      .maybeSingle();
    return r.data?.xp ?? 0;
  };

  const xpBefore = await readXp();

  /* --- first award --- */
  const res1 = await post({ stepId, score: 100 });
  const body1 = await res1.json();

  check("first award returns 200", res1.status === 200, JSON.stringify(body1).slice(0, 120));
  check("first award reports newlyCompleted", body1.newlyCompleted === true);
  check(
    "first award grants the curriculum amount (" + XP + " xp)",
    body1.awarded === XP,
    "awarded=" + body1.awarded
  );

  const row1 = await admin
    .from("lesson_step_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("step_id", stepId)
    .maybeSingle();

  check("step row exists in the database", Boolean(row1.data));
  check("step row is marked completed", row1.data?.completed === true);
  check(
    "step row is filed under the curriculum's lesson",
    row1.data?.lesson_id === lessonId,
    "lesson_id=" + row1.data?.lesson_id
  );
  check("step row attempts = 1", row1.data?.attempts === 1, "attempts=" + row1.data?.attempts);
  check("step row records the xp granted", row1.data?.xp_awarded === XP);

  const xpAfterFirst = await readXp();

  check(
    "user_stats.xp rose by " + XP,
    xpAfterFirst === xpBefore + XP,
    xpBefore + " -> " + xpAfterFirst
  );

  /* --- replay the same step three times --- */
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await post({ stepId, score: 100 });
    const body = await res.json();

    check(
      "replay " + attempt + " awards 0 xp",
      body.awarded === 0 && body.newlyCompleted === false,
      "awarded=" + body.awarded + " newlyCompleted=" + body.newlyCompleted
    );
  }

  const xpAfterReplays = await readXp();

  check(
    "xp unchanged after three replays",
    xpAfterReplays === xpAfterFirst,
    xpAfterFirst + " -> " + xpAfterReplays
  );

  const row2 = await admin
    .from("lesson_step_progress")
    .select("attempts")
    .eq("user_id", userId)
    .eq("step_id", stepId)
    .maybeSingle();

  check(
    "replays still counted as attempts",
    row2.data?.attempts === 4,
    "attempts=" + row2.data?.attempts
  );

  const { count } = await admin
    .from("lesson_step_progress")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("step_id", stepId);

  check("exactly one row for the step", count === 1, "count=" + count);

  /* --- a forged xp amount and lesson id in the body are ignored ---
   *
   * This probe only means anything if the step is real. It used to
   * name a step id that the lesson restructure removed, so the
   * server rejected it as unknown and the assertion passed on
   * `undefined !== 999999` — a false pass that hid the fact that
   * nothing was being tested. Assert the fixture first.
   */
  const forgedStep = "ai-foundations-01-step-04";

  check(
    "forged-xp probe targets a real curriculum step",
    typeof PLAN[forgedStep] === "number" && PLAN[forgedStep] > 0,
    forgedStep + " -> plan " + PLAN[forgedStep]
  );

  const forged = await post({
    stepId: forgedStep,
    lessonId: "some-other-lesson",
    xp: 999999,
  });
  const forgedBody = await forged.json();

  check(
    "a client-supplied xp amount is ignored",
    forged.status === 200 && forgedBody.awarded === PLAN[forgedStep],
    "sent 999999, awarded " + forgedBody.awarded + " (plan says " + PLAN[forgedStep] + ")"
  );

  const forgedRow = await admin
    .from("lesson_step_progress")
    .select("lesson_id")
    .eq("user_id", userId)
    .eq("step_id", forgedStep)
    .maybeSingle();

  check(
    "a client-supplied lessonId is ignored",
    Boolean(forgedRow.data) && forgedRow.data?.lesson_id === "ai-foundations-01",
    forgedRow.data
      ? "lesson_id=" + forgedRow.data.lesson_id
      : "NO ROW WRITTEN - the probe never reached the database"
  );

  /* --- an invented step id is refused --- */
  const bogus = await post({ stepId: "not-a-real-step", xp: 500 });

  check("an unknown step id is rejected", bogus.status === 400, "HTTP " + bogus.status);

  const bogusRow = await admin
    .from("lesson_step_progress")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("step_id", "not-a-real-step");

  check("no row written for the unknown step", (bogusRow.count ?? 0) === 0);

  /* --- an unscored replay must not be recorded as scoring zero --- */
  const unscoredStep = "ai-foundations-02-step-04";
  await post({ stepId: unscoredStep });
  await post({ stepId: unscoredStep });

  const unscored = await admin
    .from("lesson_step_progress")
    .select("score")
    .eq("user_id", userId)
    .eq("step_id", unscoredStep)
    .maybeSingle();

  check(
    "an unscored replay leaves score null, not 0",
    unscored.data?.score === null,
    "score=" + unscored.data?.score
  );

  /* --- concurrency: ten simultaneous awards of one fresh step --- */
  const raceStep = "ai-foundations-01-step-06";
  const raceXp = PLAN[raceStep];

  const xpBeforeRace = await readXp();

  const races = await Promise.all(
    Array.from({ length: 10 }, () => post({ stepId: raceStep, score: 100 }))
  );
  const raceBodies = await Promise.all(races.map((r) => r.json()));
  const granted = raceBodies.reduce((sum, b) => sum + (b.awarded ?? 0), 0);

  const xpAfterRace = await readXp();

  check(
    "10 concurrent awards grant xp exactly once",
    granted === raceXp && xpAfterRace === xpBeforeRace + raceXp,
    "granted=" + granted + " (expected " + raceXp + "), xp " + xpBeforeRace + " -> " + xpAfterRace
  );

  /* --- level tracks xp --- */
  const stats = await admin
    .from("user_stats")
    .select("xp, level")
    .eq("user_id", userId)
    .maybeSingle();

  check(
    "level is derived from xp (500 per level)",
    stats.data?.level === Math.floor((stats.data?.xp ?? 0) / 500) + 1,
    "xp=" + stats.data?.xp + " level=" + stats.data?.level
  );

  /* --- GET restores step progress --- */
  const restore = await fetch(API + "/api/progress/steps/" + lessonId, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  const restored = await restore.json();

  check(
    "GET /steps/:lessonId returns the recorded steps",
    restore.status === 200 &&
      Array.isArray(restored.steps) &&
      restored.steps.some((s: { step_id: string }) => s.step_id === stepId),
    "HTTP " + restore.status + ", " + restored.steps?.length + " steps"
  );

  check(
    "GET /steps/:lessonId is scoped to one lesson",
    (restored.steps ?? []).every((s: { lesson_id: string }) => s.lesson_id === lessonId)
  );
}

/* ---------------------------------------------------------
   5. LESSON AND COURSE PERSISTENCE
   --------------------------------------------------------- */

async function checkLessonAndCourse(userId: string, accessToken: string) {
  section("5. LESSON AND COURSE PERSISTENCE (browser client, RLS enforced)");

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const lessonId = "ai-foundations-01";
  const now = new Date().toISOString();

  const lesson = await asUser
    .from("lesson_progress")
    .insert({
      user_id: userId,
      lesson_id: lessonId,
      completed: true,
      status: "completed",
      attempts: 1,
      successful_attempts: 1,
      mastery: "proficient",
      last_attempt_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  check(
    "browser client can write its own lesson_progress under RLS",
    !lesson.error,
    lesson.error?.message ?? ""
  );

  const course = await asUser
    .from("course_progress")
    .insert({
      user_id: userId,
      course_id: "ai-foundations",
      status: "in_progress",
      progress_percent: 13,
      current_lesson_id: "ai-foundations-02",
      started_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  check(
    "course_progress accepts progress_percent and current_lesson_id",
    !course.error,
    course.error?.message ?? ""
  );

  const readBack = await admin
    .from("course_progress")
    .select("progress_percent, current_lesson_id, status")
    .eq("user_id", userId)
    .eq("course_id", "ai-foundations")
    .maybeSingle();

  check(
    "course row reads back with the values written",
    Number(readBack.data?.progress_percent) === 13 &&
      readBack.data?.current_lesson_id === "ai-foundations-02",
    JSON.stringify(readBack.data)
  );

  /* Writing somebody else's row must be refused by RLS. */
  const forged = await asUser.from("lesson_progress").insert({
    user_id: "00000000-0000-0000-0000-000000000000",
    lesson_id: "forged",
    completed: true,
    status: "completed",
  });

  check(
    "RLS refuses a lesson_progress row for another user",
    Boolean(forged.error),
    forged.error?.message.slice(0, 80) ?? "INSERT SUCCEEDED"
  );
}

/* ---------------------------------------------------------
   6. CROSS-USER ISOLATION
   --------------------------------------------------------- */

async function checkIsolation(userId: string, accessToken: string, otherId: string) {
  section("6. A TOKEN ONLY EVER WRITES ITS OWN ROWS");

  const stepId = "ai-foundations-03-step-02";

  await fetch(`${API}/api/progress/step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    /* The body carries no user id at all - by design. */
    body: JSON.stringify({ stepId }),
  });

  const mine = await admin
    .from("lesson_step_progress")
    .select("user_id")
    .eq("step_id", stepId);

  check(
    "the row is owned by the token's user",
    mine.data?.length === 1 && mine.data[0].user_id === userId,
    `owner=${mine.data?.[0]?.user_id}`
  );

  check(
    "no row was written for anybody else",
    !mine.data?.some((r) => r.user_id === otherId)
  );

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const visible = await asUser.from("lesson_step_progress").select("user_id");

  check(
    "RLS hides other learners' step rows from the browser",
    (visible.data ?? []).every((r) => r.user_id === userId),
    `${visible.data?.length ?? 0} rows visible, all own`
  );
}

/* ---------------------------------------------------------
   RUN
   --------------------------------------------------------- */

async function main() {
  console.log(`API:      ${API}`);
  console.log(`Supabase: ${SUPABASE_URL}`);

  const schemaOk = await checkSchema();

  if (!schemaOk) {
    console.log(
      "\nSchema incomplete. Apply supabase/migrations/0002_step_progress_and_xp.sql" +
        "\nin the Supabase SQL Editor, then re-run this script.\n"
    );
    process.exit(1);
  }

  await checkUnauthenticated();

  /* A throwaway learner, removed again at the end. */
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
  const email = `neurocode-verify+${stamp}@example.com`;
  const password = `verify-${crypto.randomUUID()}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `verify-${stamp}` },
  });

  if (created.error || !created.data.user) {
    console.error("Could not create the test learner:", created.error?.message);
    process.exit(1);
  }

  const userId = created.data.user.id;
  console.log(`\nTest learner: ${email} (${userId})`);

  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const signIn = await anon.auth.signInWithPassword({ email, password });

    if (signIn.error || !signIn.data.session) {
      console.error("Could not sign in as the test learner:", signIn.error?.message);
      throw new Error("sign-in failed");
    }

    const accessToken = signIn.data.session.access_token;

    await checkRpcLockdown(accessToken);
    await checkStepFlow(userId, accessToken);
    await checkLessonAndCourse(userId, accessToken);

    const others = await admin
      .from("user_stats")
      .select("user_id")
      .neq("user_id", userId)
      .limit(1);

    await checkIsolation(userId, accessToken, others.data?.[0]?.user_id ?? "");
  } finally {
    await admin.auth.admin.deleteUser(userId);

    const leftover = await admin
      .from("lesson_step_progress")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    console.log(`\nTest learner deleted: ${userId}`);
    console.log(`Leftover step rows for that user: ${leftover.count ?? 0}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
