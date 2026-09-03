/*
 * Proof that the extension's three tables hold their ground
 * against a browser.
 *
 * Asserts on the DATABASE and, more importantly, THROUGH THE
 * ANON KEY — the same client a learner's browser uses, under
 * the same RLS. Everything in verify-extension.mts is pure and
 * proves the request shape; nothing there can prove a policy.
 * A policy is only proved by trying to get past it with the
 * credential a real attacker would hold.
 *
 * The negatives are the point. Anyone can write a test that
 * saves a setting and reads it back. What has to be proved is
 * that a browser CANNOT write the account scope that decides
 * whether a child's browsing may be read, cannot mint itself an
 * extension token, and cannot read another learner's anything.
 *
 * And one positive that is really a regression test: a
 * FLAGSHIP agent can be extension-enabled. Migration 0015 makes
 * a purchased agent unwritable by its owner, which is why the
 * setting is a separate table at all — see §4.2 of the phase-4
 * doc. If that ever regresses, a learner who spent 100 XP on
 * Study Tutor silently cannot use it here.
 *
 * Needs supabase/migrations/0019 and 0020 applied. Section 0
 * checks that first, by WRITING rather than reading a
 * catalogue — 0016's lesson — because every section after it
 * fails incomprehensibly without them.
 *
 *   npx tsx ./scripts/verify-phase4-e2e.mts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

/* ---------------------------------------------------------
   ENV

   Read and installed into process.env BEFORE any server module
   is imported, for the reason the other e2e suites give:
   lib/supabase.ts throws at module scope without SUPABASE_URL,
   and this script runs from the repo root where dotenv/config
   finds nothing.
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

process.env.NEUROLINK_SCHEDULER = "off";

const SUPABASE_URL = serverEnv.SUPABASE_URL;
const SERVICE_KEY = serverEnv.SUPABASE_SECRET_KEY;
const ANON_KEY = webEnv.VITE_SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    "\n.env.local has no VITE_SUPABASE_ANON_KEY. The RLS half of this suite\n" +
      "needs the key a browser actually uses; the service role bypasses RLS\n" +
      "and would prove nothing.\n"
  );
  process.exit(1);
}

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

const createdUsers: string[] = [];

interface Learner {
  id: string;
  email: string;
  password: string;
  /* An ordinary agent they built. */
  agentId: string;
  /* A purchased flagship — is_official true, unwritable by its
     owner under 0015. The §4.2 regression case. */
  flagshipId: string;
  /* A browser client, signed in as this learner, under RLS. */
  browser: SupabaseClient;
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
  const email = `neurolink-p4-verify+${tag}-${stamp}@example.com`;
  const password = `verify-${crypto.randomUUID()}`;

  const made = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `p4-verify-${tag}-${stamp}` },
  });

  if (made.error || !made.data.user) {
    throw new Error(`Could not create the test learner: ${made.error?.message}`);
  }

  const id = made.data.user.id;
  createdUsers.push(id);

  const agent = async (name: string, official: boolean): Promise<string> => {
    const row = await admin
      .from("agents")
      .insert({
        user_id: id,
        name,
        description: "Created by verify-phase4-e2e.mts",
        avatar_emoji: "🧩",
        avatar_tone: "accent",
        system_instructions: official ? "" : "Answer briefly.",
        model: "neurolink/mock-1",
        temperature: 0,
        max_output_tokens: 500,
        capabilities: ["chat"],
        status: "ready",
        is_official: official,
        flagship_id: official ? "study-tutor" : null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (row.error || !row.data) {
      throw new Error(`Could not create an agent: ${row.error?.message}`);
    }

    return row.data.id as string;
  };

  /* The browser: anon key, real session, real RLS. */
  const browser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await browser.auth.signInWithPassword({ email, password });

  if (signIn.error) {
    throw new Error(`Could not sign the test learner in: ${signIn.error.message}`);
  }

  return {
    id,
    email,
    password,
    agentId: await agent("Built Agent", false),
    flagshipId: await agent("Study Tutor", true),
    browser,
  };
}

async function cleanup() {
  for (const id of createdUsers) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

/* =========================================================
   0. THE MIGRATIONS

   Checked by WRITING, not by reading a catalogue. A table that
   exists but refuses the shape this build expects is the
   failure worth catching, and only a write catches it.
========================================================= */

async function checkMigrations(learner: Learner): Promise<boolean> {
  section("0. Migrations 0019 and 0020");

  const settings = await admin
    .from("agent_extension_settings")
    .insert({
      agent_id: learner.agentId,
      user_id: learner.id,
      extension_enabled: false,
      extension_page_context: false,
    })
    .select("agent_id")
    .single();

  check(
    "0020: agent_extension_settings accepts a row",
    !settings.error,
    settings.error?.message ?? ""
  );

  const scope = await admin
    .from("user_account_scope")
    .insert({ user_id: learner.id, page_context_scope: "unknown" })
    .select("user_id")
    .single();

  check(
    "0020: user_account_scope accepts a row",
    !scope.error,
    scope.error?.message ?? ""
  );

  const session = await admin
    .from("extension_sessions")
    .insert({
      user_id: learner.id,
      token_prefix: crypto.randomBytes(6).toString("hex"),
      token_hash: crypto.randomBytes(32).toString("hex"),
      last4: "abcd",
      label: "Verify browser",
    })
    .select("id")
    .single();

  check(
    "0020: extension_sessions accepts a row",
    !session.error,
    session.error?.message ?? ""
  );

  /* 0019's table, and 0020's columns on it — the join that
     failed when 0019 had not been applied. */
  const draft = await admin
    .from("agent_email_drafts")
    .select("id, source_page_url, source_page_title, source_page_text, source_capture_mode")
    .limit(0);

  check(
    "0019 + 0020: agent_email_drafts carries the provenance columns",
    !draft.error,
    draft.error?.message ?? ""
  );

  return !settings.error && !scope.error && !session.error && !draft.error;
}

/* =========================================================
   1. THE ACCOUNT GATE — the table a browser must not write

   The one that decides whether a child's browsing may be read.
   Every one of these is attempted with the ANON KEY as a
   signed-in learner, which is the credential that actually
   exists in a browser.
========================================================= */

async function checkAccountScope(a: Learner, b: Learner) {
  section("1. user_account_scope — read-only to a browser");

  const insert = await a.browser
    .from("user_account_scope")
    .insert({ user_id: a.id, page_context_scope: "allowed" });

  check(
    "a browser CANNOT insert its own scope",
    Boolean(insert.error),
    insert.error ? `refused: ${insert.error.code}` : "INSERT SUCCEEDED"
  );

  const update = await a.browser
    .from("user_account_scope")
    .update({ page_context_scope: "allowed" })
    .eq("user_id", a.id);

  const stillUnknown = await admin
    .from("user_account_scope")
    .select("page_context_scope")
    .eq("user_id", a.id)
    .maybeSingle();

  check(
    "a browser CANNOT update its own scope to allowed",
    stillUnknown.data?.page_context_scope === "unknown",
    `update error: ${update.error?.code ?? "none"}, value now: ${
      stillUnknown.data?.page_context_scope
    }`
  );

  const upsert = await a.browser
    .from("user_account_scope")
    .upsert({ user_id: a.id, page_context_scope: "allowed" });

  const afterUpsert = await admin
    .from("user_account_scope")
    .select("page_context_scope")
    .eq("user_id", a.id)
    .maybeSingle();

  check(
    "a browser CANNOT upsert its scope either",
    afterUpsert.data?.page_context_scope === "unknown",
    `upsert error: ${upsert.error?.code ?? "none"}`
  );

  const del = await a.browser
    .from("user_account_scope")
    .delete()
    .eq("user_id", a.id);

  const afterDelete = await admin
    .from("user_account_scope")
    .select("user_id")
    .eq("user_id", a.id)
    .maybeSingle();

  check(
    "a browser CANNOT delete its scope",
    Boolean(afterDelete.data),
    `delete error: ${del.error?.code ?? "none"}`
  );

  /* The one thing it MAY do: read its own, so the UI can
     explain itself. */
  const own = await a.browser
    .from("user_account_scope")
    .select("page_context_scope")
    .eq("user_id", a.id)
    .maybeSingle();

  check(
    "a browser CAN read its own scope",
    !own.error && own.data?.page_context_scope === "unknown",
    own.error?.message ?? String(own.data?.page_context_scope)
  );

  const other = await a.browser
    .from("user_account_scope")
    .select("page_context_scope")
    .eq("user_id", b.id)
    .maybeSingle();

  check(
    "a browser CANNOT read another learner's scope",
    !other.data,
    other.data ? "LEAKED" : "no row visible"
  );
}

/* =========================================================
   2. THE FLAGSHIP REGRESSION — §4.2

   The test that would have failed under the columns-on-agents
   design, and the whole reason the settings live in their own
   table.
========================================================= */

async function checkFlagship(learner: Learner) {
  section("2. A purchased flagship can be extension-enabled");

  /* First: prove the premise. 0015 must still refuse a write to
     the official agent row itself — otherwise this section is
     testing nothing. */
  const editOfficial = await learner.browser
    .from("agents")
    .update({ name: "Renamed by the owner" })
    .eq("id", learner.flagshipId)
    .select("id");

  const stillNamed = await admin
    .from("agents")
    .select("name")
    .eq("id", learner.flagshipId)
    .single();

  check(
    "0015 still holds: the owner cannot edit an official agent row",
    stillNamed.data?.name === "Study Tutor",
    `name is now "${stillNamed.data?.name}", update error: ${
      editOfficial.error?.code ?? "none"
    }`
  );

  /* Now the point: the SETTING is writable even though the
     agent is not. */
  const enable = await learner.browser
    .from("agent_extension_settings")
    .upsert(
      {
        agent_id: learner.flagshipId,
        user_id: learner.id,
        extension_enabled: true,
        extension_page_context: false,
      },
      { onConflict: "agent_id" }
    );

  const stored = await admin
    .from("agent_extension_settings")
    .select("extension_enabled")
    .eq("agent_id", learner.flagshipId)
    .maybeSingle();

  check(
    "a browser CAN extension-enable a purchased flagship",
    !enable.error && stored.data?.extension_enabled === true,
    enable.error ? `${enable.error.code}: ${enable.error.message}` : "enabled"
  );
}

/* =========================================================
   3. THE PER-AGENT SETTINGS
========================================================= */

async function checkSettings(a: Learner, b: Learner) {
  section("3. agent_extension_settings");

  const own = await a.browser
    .from("agent_extension_settings")
    .upsert(
      {
        agent_id: a.agentId,
        user_id: a.id,
        extension_enabled: true,
        extension_page_context: true,
      },
      { onConflict: "agent_id" }
    );

  check(
    "the owner CAN enable their own agent",
    !own.error,
    own.error?.message ?? ""
  );

  /* The CHECK constraint: page context without the agent
     enabled is a state the database refuses to hold. */
  const impossible = await admin
    .from("agent_extension_settings")
    .update({ extension_enabled: false, extension_page_context: true })
    .eq("agent_id", a.agentId);

  check(
    "page context without the agent enabled is REFUSED by the CHECK",
    Boolean(impossible.error),
    impossible.error ? `refused: ${impossible.error.code}` : "ACCEPTED"
  );

  /* Cross-learner: B tries to enable A's agent. */
  const cross = await b.browser.from("agent_extension_settings").upsert(
    {
      agent_id: a.agentId,
      user_id: b.id,
      extension_enabled: true,
      extension_page_context: true,
    },
    { onConflict: "agent_id" }
  );

  const untouched = await admin
    .from("agent_extension_settings")
    .select("user_id, extension_enabled")
    .eq("agent_id", a.agentId)
    .maybeSingle();

  check(
    "another learner CANNOT enable somebody else's agent",
    untouched.data?.user_id === a.id,
    cross.error ? `refused: ${cross.error.code}` : `owner is ${untouched.data?.user_id}`
  );

  const read = await b.browser
    .from("agent_extension_settings")
    .select("agent_id")
    .eq("agent_id", a.agentId)
    .maybeSingle();

  check(
    "another learner CANNOT read somebody else's settings",
    !read.data,
    read.data ? "LEAKED" : "no row visible"
  );

  /* The composite FK makes "settings on an agent that is not
     yours" unrepresentable rather than merely unreachable —
     proved with the SERVICE ROLE, which bypasses RLS, so only
     the constraint can stop it.

     AGAINST A FRESH AGENT, deliberately. The first version of
     this used `a.agentId`, which already had a settings row, so
     the insert tripped the PRIMARY KEY (23505) and the test
     passed without ever reaching the foreign key. A test that
     passes for the wrong reason is worse than no test — it
     would have gone on passing with the FK removed. */
  const fresh = await admin
    .from("agents")
    .insert({
      user_id: a.id,
      name: "FK probe agent",
      description: "Created by verify-phase4-e2e.mts",
      avatar_emoji: "🔗",
      avatar_tone: "accent",
      system_instructions: "Answer briefly.",
      model: "neurolink/mock-1",
      temperature: 0,
      max_output_tokens: 500,
      capabilities: ["chat"],
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const forged = await admin.from("agent_extension_settings").insert({
    agent_id: fresh.data?.id,
    /* A's agent, B's user id. */
    user_id: b.id,
    extension_enabled: true,
    extension_page_context: false,
  });

  check(
    "the composite FK refuses settings whose user does not own the agent",
    forged.error?.code === "23503",
    forged.error
      ? `refused: ${forged.error.code}${
          forged.error.code === "23503" ? " (foreign key)" : " — WRONG CONSTRAINT"
        }`
      : "ACCEPTED — FK MISSING"
  );
}

/* =========================================================
   4. EXTENSION SESSIONS — the token table
========================================================= */

async function checkSessions(a: Learner, b: Learner) {
  section("4. extension_sessions");

  const mint = await a.browser.from("extension_sessions").insert({
    user_id: a.id,
    token_prefix: crypto.randomBytes(6).toString("hex"),
    token_hash: crypto.randomBytes(32).toString("hex"),
    last4: "beef",
    label: "Forged browser",
  });

  check(
    "a browser CANNOT mint itself a token",
    Boolean(mint.error),
    mint.error ? `refused: ${mint.error.code}` : "INSERT SUCCEEDED"
  );

  /* It may list its own, but the secret columns must not be
     selectable — that is a column grant, which a policy cannot
     express. */
  const safe = await a.browser
    .from("extension_sessions")
    .select("id, last4, label, created_at, last_used_at, revoked_at, expires_at")
    .eq("user_id", a.id);

  check(
    "a browser CAN list its own paired browsers",
    !safe.error && (safe.data?.length ?? 0) > 0,
    safe.error?.message ?? `${safe.data?.length} row(s)`
  );

  for (const secret of ["token_hash", "token_prefix"]) {
    const leak = await a.browser
      .from("extension_sessions")
      .select(secret)
      .eq("user_id", a.id);

    check(
      `a browser CANNOT select ${secret}, even its own`,
      Boolean(leak.error),
      leak.error ? `refused: ${leak.error.code}` : "LEAKED"
    );
  }

  /* Revoking is the one write it needs. */
  const mine = await admin
    .from("extension_sessions")
    .select("id")
    .eq("user_id", a.id)
    .limit(1)
    .single();

  const revoke = await a.browser
    .from("extension_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", mine.data?.id);

  const afterRevoke = await admin
    .from("extension_sessions")
    .select("revoked_at")
    .eq("id", mine.data?.id)
    .single();

  check(
    "a browser CAN revoke its own session",
    !revoke.error && Boolean(afterRevoke.data?.revoked_at),
    revoke.error?.message ?? "revoked"
  );

  /* But it must not be able to extend its own expiry. */
  const extend = await a.browser
    .from("extension_sessions")
    .update({ expires_at: "2099-01-01T00:00:00Z" })
    .eq("id", mine.data?.id);

  const afterExtend = await admin
    .from("extension_sessions")
    .select("expires_at")
    .eq("id", mine.data?.id)
    .single();

  check(
    "a browser CANNOT extend its own expiry",
    !String(afterExtend.data?.expires_at).startsWith("2099"),
    extend.error ? `refused: ${extend.error.code}` : `expires_at ${afterExtend.data?.expires_at}`
  );

  const other = await b.browser
    .from("extension_sessions")
    .select("id, last4")
    .eq("user_id", a.id);

  check(
    "another learner CANNOT see somebody else's paired browsers",
    (other.data?.length ?? 0) === 0,
    other.data?.length ? "LEAKED" : "no rows visible"
  );
}

/* =========================================================
   5. DRAFT PROVENANCE — §2.3.1

   Round-tripped through the real store, so the columns and the
   mapper are proved to agree. A provenance that is written and
   cannot be read back is the failure this catches.
========================================================= */

async function checkProvenance(learner: Learner) {
  section("5. Draft provenance round-trip");

  const { createDraft, getDraft } = await import(
    "../server/src/agents/email/DraftStore"
  );

  const account = await admin
    .from("user_email_accounts")
    .insert({
      user_id: learner.id,
      provider: "gmail",
      email_address: `p4-verify-${Date.now()}@example.com`,
      /* `granted_scopes` is a space-separated TEXT column with a
         '' default, not a text[]. Guessed wrong the first time,
         which is exactly what a live suite is for. */
      granted_scopes: "read draft",
      /* `refresh_token` is NOT NULL. Nothing here is a real
         credential — the store is never asked to use it. */
      refresh_token: "v1.verify.not-a-real-token",
      access_token: "v1.verify.not-a-real-token",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    })
    .select("id")
    .single();

  if (account.error) {
    check(
      "could create a mailbox row to hang a draft off",
      false,
      account.error.message
    );
    return;
  }

  const page = {
    url: "https://example.com/articles/photosynthesis",
    title: "Photosynthesis",
    mode: "page" as const,
    text: "Plants convert light into chemical energy.",
    truncated: false,
  };

  const withPage = await createDraft({
    userId: learner.id,
    agentId: learner.agentId,
    accountId: account.data.id as string,
    to: ["someone@example.com"],
    cc: [],
    subject: "About that page",
    body: "Here is what it said.",
    sourcePage: page,
  });

  check(
    "a draft written with page context carries it back",
    withPage.sourcePage?.url === page.url &&
      withPage.sourcePage?.text === page.text &&
      withPage.sourcePage?.mode === "page" &&
      withPage.sourcePage?.title === page.title,
    JSON.stringify(withPage.sourcePage)
  );

  const reread = await getDraft(learner.id, withPage.id);

  check(
    "and survives a re-read from the database",
    reread?.sourcePage?.text === page.text,
    reread?.sourcePage ? "present" : "LOST"
  );

  /*
   * 0021. The marker §2.3.1 asks for alongside the character
   * count, and the case that motivates the whole column: a
   * capture that stopped at the cap must not read as a whole
   * page, because a learner who reaches the end of one and
   * finds nothing alarming has concluded something the text
   * never supported.
   */
  const cut = await createDraft({
    userId: learner.id,
    agentId: learner.agentId,
    accountId: account.data.id as string,
    to: ["someone@example.com"],
    cc: [],
    subject: "About a long page",
    body: "Here is what the top of it said.",
    sourcePage: { ...page, truncated: true },
  });

  const cutAgain = await getDraft(learner.id, cut.id);

  check(
    "a truncated capture says so, and still says so after a re-read",
    cut.sourcePage?.truncated === true &&
      cutAgain?.sourcePage?.truncated === true,
    `written ${String(cut.sourcePage?.truncated)}, ` +
      `re-read ${String(cutAgain?.sourcePage?.truncated)}`
  );

  check(
    "a complete capture does not claim truncation",
    withPage.sourcePage?.truncated === false &&
      reread?.sourcePage?.truncated === false,
    `written ${String(withPage.sourcePage?.truncated)}, ` +
      `re-read ${String(reread?.sourcePage?.truncated)}`
  );

  /*
   * The impossible state 0021 refuses: a truncation flag on a
   * row with no captured text. Written straight through the
   * service role, because the application cannot produce it —
   * which is exactly why the constraint rather than the code is
   * what has to hold.
   */
  const forgedCut = await admin.from("agent_email_drafts").insert({
    user_id: learner.id,
    agent_id: learner.agentId,
    account_id: account.data.id as string,
    to_addresses: ["someone@example.com"],
    cc_addresses: [],
    subject: "Truncated nothing",
    body: "There is no capture on this row.",
    status: "draft",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    source_page_truncated: true,
  });

  check(
    "a truncation flag without captured text is refused",
    forgedCut.error !== null,
    forgedCut.error?.message ?? "THE INSERT SUCCEEDED"
  );

  const without = await createDraft({
    userId: learner.id,
    agentId: learner.agentId,
    accountId: account.data.id as string,
    to: ["someone@example.com"],
    cc: [],
    subject: "No page here",
    body: "Written from the Builder.",
  });

  check(
    "a draft written without page context has none",
    without.sourcePage === null,
    String(without.sourcePage)
  );

  /* The sweep takes provenance with the draft, because they are
     columns on the same row. Proved by expiring one and running
     the real function. */
  /*
   * An HOUR into the past, not a second.
   *
   * The first version used `Date.now() - 1000`, which failed
   * intermittently — and the reason is worth keeping. The
   * sweep compares against Postgres's `now()`, on Supabase's
   * clock, while the timestamp is computed here on this
   * machine's. A one-second margin sits inside the skew
   * between the two, so the row was simply not expired yet
   * and the sweep was right to leave it.
   *
   * A test whose margin is smaller than the clock difference
   * it spans is testing the clocks.
   */
  const expiry = await admin
    .from("agent_email_drafts")
    .update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() })
    .eq("id", withPage.id)
    .select("id");

  check(
    "the draft could be expired for the sweep",
    !expiry.error && (expiry.data?.length ?? 0) === 1,
    expiry.error?.message ?? "expired"
  );

  const swept = await admin.rpc("sweep_email_drafts");

  const gone = await admin
    .from("agent_email_drafts")
    .select("id, source_page_text")
    .eq("id", withPage.id)
    .maybeSingle();

  check(
    "sweep_email_drafts removes the draft AND its provenance",
    !gone.data,
    swept.error ? `rpc error: ${swept.error.message}` : gone.data ? "STILL THERE" : "gone"
  );
}

/* =========================================================
   RUN
========================================================= */

async function main() {
  console.log("\nBuildGentic — Phase 4 end-to-end (live database)\n");

  let a: Learner | null = null;
  let b: Learner | null = null;

  try {
    a = await makeLearner("a");
    b = await makeLearner("b");

    const ready = await checkMigrations(a);

    if (!ready) {
      console.log(
        "\nMigrations 0019/0020 are not fully applied. Stopping here rather\n" +
          "than reporting a cascade of failures that all mean the same thing.\n"
      );
      return;
    }

    await admin
      .from("user_account_scope")
      .insert({ user_id: b.id, page_context_scope: "unknown" })
      .select("user_id")
      .maybeSingle();

    await checkAccountScope(a, b);
    await checkFlagship(a);
    await checkSettings(a, b);
    await checkSessions(a, b);
    await checkProvenance(a);
  } finally {
    await cleanup();
  }

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
