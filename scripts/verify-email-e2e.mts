/*
 * The half of the Email Agent that verify-email.mts cannot see.
 *
 * That suite is pure: it proves a set of ABSENCES — no tool
 * sends, no tool deletes, no recipient can carry a MIME header,
 * the full-access scope is never in the list — by reading the
 * catalogue and the address guard with no server, no database
 * and no keys. Those proofs are worth having and they are not
 * this file's job.
 *
 * This one asks the questions that only a running system can
 * answer, and it asks them of the real HTTP routes with a real
 * session, asserting on the DATABASE rather than on an API's
 * report of its own success — the same rule the other e2e suite
 * follows.
 *
 * The question it exists for is the one that has actually gone
 * wrong in production: WHICH PERMISSIONS DOES THE CONSENT SCREEN
 * ASK FOR. `/email/connect` derives the scope list from the
 * agent's own capabilities, so an agent connected before its
 * draft and send capabilities were switched on gets a mailbox
 * that can only ever read — and nothing in the product says so
 * until a draft fails much later. Section 2 pins that mapping
 * down at every combination.
 *
 * Sections 1-3 need no mailbox and no Google round trip: they
 * run anywhere the API is up and Gmail is configured. Sections
 * 4-5 need a real mailbox and SKIP without one, rather than
 * failing — an absent test account is a missing input, not a
 * broken feature.
 *
 * Needs the API running, supabase/migrations/0019 applied, and
 * NEUROLINK_SECRET_KEY set. To run the mailbox sections, also
 * set NEUROLINK_VERIFY_GMAIL_REFRESH_TOKEN and
 * NEUROLINK_VERIFY_GMAIL_ADDRESS for a mailbox you are willing
 * to have a test read, draft into, and send from.
 *
 *   npx tsx ./scripts/verify-email-e2e.mts
 *   API_BASE=https://api.buildgentic.com npx tsx ./scripts/verify-email-e2e.mts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/* ---------------------------------------------------------
   ENV
   --------------------------------------------------------- */

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};

  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* Absent is a normal state for a fresh clone; the caller
       reports what it could not find. */
  }

  return out;
}

const serverEnv = readEnv("server/.env");
const webEnv = readEnv(".env.local");

const SUPABASE_URL = process.env.SUPABASE_URL ?? serverEnv.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY ?? serverEnv.SUPABASE_SECRET_KEY;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ?? webEnv.VITE_SUPABASE_ANON_KEY;
const API = process.env.API_BASE ?? "http://localhost:3001";

/*
 * Set before anything calls `seal`, because crypto.ts reads the
 * key once and caches the answer. Importing it earlier is fine;
 * calling it earlier is not.
 */
if (!process.env.NEUROLINK_SECRET_KEY && serverEnv.NEUROLINK_SECRET_KEY) {
  process.env.NEUROLINK_SECRET_KEY = serverEnv.NEUROLINK_SECRET_KEY;
}

const TEST_REFRESH_TOKEN =
  process.env.NEUROLINK_VERIFY_GMAIL_REFRESH_TOKEN ?? "";
const TEST_ADDRESS = process.env.NEUROLINK_VERIFY_GMAIL_ADDRESS ?? "";

const admin = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* Google's own scope strings, repeated here on purpose.

   Importing SCOPE_FOR from the provider would make this suite
   agree with the provider by construction — including when the
   provider is wrong. A test of "does it ask for the right
   permissions" has to name the right permissions itself. */
const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_DRAFT = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_ORGANIZE = "https://www.googleapis.com/auth/gmail.modify";

/* The one that must never appear. It carries IMAP, SMTP and
   permanent deletion. */
const GMAIL_FULL = "https://mail.google.com/";

/* ---------------------------------------------------------
   HARNESS

   Same shape as every other suite: a pass is printed, a failure
   is printed and remembered, and the exit code is the summary.
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

let skipped = 0;
const skips: string[] = [];

function skip(label: string, why: string) {
  skipped += 1;
  skips.push(label);
  console.log(`  SKIP  ${label} - ${why}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* ---------------------------------------------------------
   A LEARNER, AND THE THINGS THEY OWN
   --------------------------------------------------------- */

interface Learner {
  id: string;
  email: string;
  token: string;
}

function userClient(token: string) {
  return createClient(SUPABASE_URL ?? "", ANON_KEY ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function makeLearner(): Promise<Learner> {
  /*
   * Unique per run, and the USERNAME half is the load-bearing
   * one: a trigger on auth.users copies user_metadata.username
   * into public.profiles, where it is unique. A fixed name means
   * one leftover account from an interrupted run makes every
   * later run die at createUser with a bare "Database error
   * creating new user".
   */
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email = `neurolink-email-verify+${stamp}@example.com`;
  const password = `verify-${crypto.randomUUID()}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `email-verify-${stamp}` },
  });

  if (created.error || !created.data.user) {
    throw new Error(
      `Could not create the test learner: ${created.error?.message}`
    );
  }

  const anon = createClient(SUPABASE_URL ?? "", ANON_KEY ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await anon.auth.signInWithPassword({ email, password });

  if (signIn.error || !signIn.data.session) {
    /* The account exists and is unusable, so it goes back out
       again before this throws — otherwise its username is held
       against every later run. */
    await admin.auth.admin
      .deleteUser(created.data.user.id)
      .catch(() => undefined);

    throw new Error(`Could not sign in: ${signIn.error?.message}`);
  }

  return {
    id: created.data.user.id,
    email,
    token: signIn.data.session.access_token,
  };
}

async function makeAgent(
  learner: Learner,
  name: string,
  capabilities: string[]
): Promise<string> {
  const as = userClient(learner.token);

  const created = await as
    .from("agents")
    .insert({
      user_id: learner.id,
      name,
      description: "Created by verify-email-e2e.mts",
      avatar_emoji: "📬",
      avatar_tone: "accent",
      system_instructions:
        "You read the mailbox you are given and draft replies. You never claim to have sent anything.",
      model: "neurolink/mock-1",
      temperature: 0,
      max_output_tokens: 600,
      capabilities,
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (created.error || !created.data) {
    throw new Error(`Could not create the agent: ${created.error?.message}`);
  }

  return created.data.id as string;
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

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    /* An empty or non-JSON body is a legitimate answer for some
       of these routes; the status carries the meaning. */
  }

  return { status: response.status, body: body as T };
}

/* =========================================================
   1. PRECONDITIONS

   Every one of these is a thing that, when absent, makes every
   section below fail for a reason that has nothing to do with
   what is being tested.
========================================================= */

interface EmailStatus {
  configured?: boolean;
  provider?: string;
  accounts?: Array<{ id: string; emailAddress?: string }>;
}

async function checkPreconditions(learner: Learner): Promise<boolean> {
  section("1. PRECONDITIONS");

  let tablesPresent = true;

  for (const table of [
    "user_email_accounts",
    "agent_email_drafts",
    "user_email_oauth_states",
  ]) {
    const { error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true });

    const present = !error;

    if (!present) tablesPresent = false;

    check(
      `migration 0019: ${table} exists`,
      present,
      error ? (error.code ?? error.message) : ""
    );
  }

  check(
    "NEUROLINK_SECRET_KEY is set",
    Boolean(process.env.NEUROLINK_SECRET_KEY?.trim()),
    "without it no refresh token can be stored"
  );

  const { status, body } = await callApi<EmailStatus>(
    "/api/agents/email/status",
    learner.token
  );

  check("GET /email/status answers to a session", status === 200, `HTTP ${status}`);

  const configured = body?.configured === true;

  check(
    "the server reports Gmail as configured",
    configured,
    configured
      ? `provider ${body?.provider ?? "?"}`
      : "NEUROLINK_GMAIL_CLIENT_ID / _SECRET missing, or the secret key is unset"
  );

  check(
    "a brand new learner has no mailbox attached",
    Array.isArray(body?.accounts) && body.accounts.length === 0,
    `${body?.accounts?.length ?? "?"} account(s)`
  );

  return tablesPresent && configured;
}

/* =========================================================
   2. THE CONSENT SCREEN ASKS FOR WHAT THE AGENT CAN DO

   The section this file was written for.

   `/email/connect` reads the agent's stored capabilities and
   asks Google for exactly the matching scopes — nothing more,
   so that a person connecting a mailbox for a read-only agent
   is not asked for permission to send mail, and nothing less,
   so that an agent which can draft is not handed a mailbox that
   will refuse to draft.

   `read` is always in the list: every other grant is useless
   without it.
========================================================= */

async function scopesFor(
  learner: Learner,
  capabilities: string[]
): Promise<{ scopes: Set<string>; params: URLSearchParams } | null> {
  const agentId = await makeAgent(
    learner,
    `Scope probe ${capabilities.join("+")}`,
    capabilities
  );

  const { status, body } = await callApi<{ url?: string; error?: string }>(
    "/api/agents/email/connect",
    learner.token,
    { method: "POST", body: JSON.stringify({ agentId }) }
  );

  if (status !== 200 || !body?.url) {
    check(
      `connect URL for [${capabilities.join(", ")}]`,
      false,
      `HTTP ${status} ${body?.error ?? ""}`
    );
    return null;
  }

  const params = new URL(body.url).searchParams;

  return {
    scopes: new Set((params.get("scope") ?? "").split(/\s+/).filter(Boolean)),
    params,
  };
}

async function checkConsentScopes(learner: Learner) {
  section("2. THE CONSENT SCREEN ASKS FOR WHAT THE AGENT CAN DO");

  const read = await scopesFor(learner, ["chat", "email_read"]);

  if (read) {
    check("read-only agent: asks to read", read.scopes.has(GMAIL_READ));
    check(
      "read-only agent: does NOT ask to draft",
      !read.scopes.has(GMAIL_DRAFT)
    );
    check(
      "read-only agent: does NOT ask to send",
      !read.scopes.has(GMAIL_SEND)
    );
    check(
      "read-only agent: does NOT ask to modify",
      !read.scopes.has(GMAIL_ORGANIZE)
    );

    /*
     * The parameters that decide whether a connection survives
     * the hour. Without access_type=offline there is no refresh
     * token at all; without prompt=consent there is none on a
     * RECONNECT, which is the single most common way to get
     * this flow wrong — a mailbox that works until lunch.
     */
    check(
      "offline access is requested",
      read.params.get("access_type") === "offline"
    );
    check(
      "consent is forced, so a reconnect returns a refresh token",
      read.params.get("prompt") === "consent"
    );
    check(
      "PKCE is used",
      read.params.get("code_challenge_method") === "S256" &&
        Boolean(read.params.get("code_challenge"))
    );
    check(
      "the redirect URI is the API's own callback",
      (read.params.get("redirect_uri") ?? "").endsWith(
        "/api/agents/email/callback"
      ),
      read.params.get("redirect_uri") ?? "(none)"
    );
  }

  const draft = await scopesFor(learner, ["chat", "email_read", "email_draft"]);

  if (draft) {
    check("drafting agent: asks to draft", draft.scopes.has(GMAIL_DRAFT));
    check(
      "drafting agent: still does NOT ask to send",
      !draft.scopes.has(GMAIL_SEND)
    );
  }

  const send = await scopesFor(learner, [
    "chat",
    "email_read",
    "email_draft",
    "email_send",
  ]);

  if (send) {
    check("sending agent: asks to send", send.scopes.has(GMAIL_SEND));
  }

  const all = await scopesFor(learner, [
    "chat",
    "email_read",
    "email_draft",
    "email_send",
    "email_organize",
  ]);

  if (all) {
    check("organising agent: asks to modify", all.scopes.has(GMAIL_ORGANIZE));
    check(
      "the fully-capable agent asks for exactly four Gmail scopes",
      [GMAIL_READ, GMAIL_DRAFT, GMAIL_SEND, GMAIL_ORGANIZE].every((s) =>
        all.scopes.has(s)
      ) &&
        [...all.scopes].filter((s) => s.includes("gmail")).length === 4,
      [...all.scopes].filter((s) => s.includes("gmail")).length + " gmail scopes"
    );
  }

  /* The absence that matters most, asserted at every
     combination rather than once. */
  for (const [name, probe] of [
    ["read-only", read],
    ["drafting", draft],
    ["sending", send],
    ["everything", all],
  ] as const) {
    if (probe) {
      check(
        `${name} agent never asks for full mailbox access`,
        !probe.scopes.has(GMAIL_FULL)
      );
    }
  }

  /*
   * No agent named at all. The route defaults to read, because
   * a connection with no grants is a connection that does
   * nothing.
   */
  const bare = await callApi<{ url?: string }>(
    "/api/agents/email/connect",
    learner.token,
    { method: "POST", body: JSON.stringify({}) }
  );

  if (bare.status === 200 && bare.body?.url) {
    const scopes = new Set(
      (new URL(bare.body.url).searchParams.get("scope") ?? "").split(/\s+/)
    );

    check("connecting without an agent still asks to read", scopes.has(GMAIL_READ));
    check(
      "connecting without an agent asks for nothing else",
      !scopes.has(GMAIL_DRAFT) &&
        !scopes.has(GMAIL_SEND) &&
        !scopes.has(GMAIL_ORGANIZE)
    );
  } else {
    check("connecting without an agent is allowed", false, `HTTP ${bare.status}`);
  }
}

/* =========================================================
   3. THE CALLBACK REFUSES WHAT IT SHOULD

   The one route on this server a stranger can cause a browser
   to reach, so what it does with rubbish matters more than what
   it does with a real code.
========================================================= */

async function checkCallback() {
  section("3. THE CALLBACK REFUSES WHAT IT SHOULD");

  const base = `${API}/api/agents/email/callback`;

  /* An unknown state is the forged case: a state row this
     server never issued. */
  const forged = await fetch(
    `${base}?state=${encodeURIComponent("not-a-real-state")}&code=irrelevant`,
    { redirect: "manual" }
  );

  const location = forged.headers.get("location") ?? "";

  check(
    "an unknown state is redirected, not 500'd",
    forged.status >= 300 && forged.status < 400,
    `HTTP ${forged.status}`
  );

  check(
    "the failure lands on the app, not on an attacker's host",
    location.includes("/agents?email=") &&
      !location.includes("evil.example"),
    location.slice(0, 80) || "(no location header)"
  );

  /*
   * The open-redirect probe. A redirect target taken off the
   * query string would be the whole bug; the route builds its
   * target from config instead, so this must change nothing.
   */
  const injected = await fetch(
    `${base}?state=x&code=y&returnPath=${encodeURIComponent(
      "https://evil.example/steal"
    )}&redirect_uri=${encodeURIComponent("https://evil.example/steal")}`,
    { redirect: "manual" }
  );

  const injectedLocation = injected.headers.get("location") ?? "";

  check(
    "a redirect target in the query string is ignored",
    !injectedLocation.includes("evil.example"),
    injectedLocation.slice(0, 80) || "(no location header)"
  );

  /* Google's own refusal, when somebody presses Cancel. Not an
     error on anybody's part, and it should not read like one. */
  const cancelled = await fetch(`${base}?error=access_denied`, {
    redirect: "manual",
  });

  check(
    "pressing Cancel is reported as cancelled, not failed",
    (cancelled.headers.get("location") ?? "").includes("email=cancelled"),
    cancelled.headers.get("location")?.slice(0, 80) ?? "(none)"
  );
}

/* =========================================================
   4. A REAL MAILBOX

   Skipped without one. The account row is written here rather
   than earned through Google's consent screen, because a script
   cannot click a consent screen — but everything downstream of
   it is the real thing: a real sealed refresh token, the real
   provider, the real routes.
========================================================= */

async function checkMailbox(learner: Learner): Promise<string | null> {
  section("4. A REAL MAILBOX");

  if (!TEST_REFRESH_TOKEN || !TEST_ADDRESS) {
    skip(
      "reading, drafting and sending against a real mailbox",
      "set NEUROLINK_VERIFY_GMAIL_REFRESH_TOKEN and NEUROLINK_VERIFY_GMAIL_ADDRESS to run this"
    );
    return null;
  }

  const { seal } = await import("../server/src/ai/crypto");

  const inserted = await admin
    .from("user_email_accounts")
    .insert({
      user_id: learner.id,
      provider: "gmail",
      email_address: TEST_ADDRESS,
      granted_scopes: [GMAIL_READ, GMAIL_DRAFT, GMAIL_SEND].join(" "),
      refresh_token: seal(TEST_REFRESH_TOKEN),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    check(
      "the test mailbox could be attached",
      false,
      inserted.error?.message ?? "no row"
    );
    return null;
  }

  check("the test mailbox is attached", true, TEST_ADDRESS);

  const status = await callApi<EmailStatus>(
    "/api/agents/email/status",
    learner.token
  );

  check(
    "the mailbox shows up on /email/status",
    (status.body?.accounts ?? []).length === 1,
    `${status.body?.accounts?.length ?? 0} account(s)`
  );

  return inserted.data.id as string;
}

/* =========================================================
   5. A MAILBOX THAT ONLY GRANTED READ MUST REFUSE TO SEND

   The state production is actually in: an account connected
   before its agent had draft and send switched on. Google
   returned two scopes, the agent has four capabilities, and the
   honest behaviour is a refusal that names the reason rather
   than a 403 reported as a BuildGentic fault.
========================================================= */

async function checkScopeRefusal(learner: Learner) {
  section("5. A READ-ONLY MAILBOX REFUSES TO SEND");

  if (!TEST_REFRESH_TOKEN || !TEST_ADDRESS) {
    skip("a read-only grant refuses the send route", "no test mailbox");
    return;
  }

  /* Same mailbox, deliberately narrowed. */
  await admin
    .from("user_email_accounts")
    .update({ granted_scopes: GMAIL_READ })
    .eq("user_id", learner.id);

  const agentId = await makeAgent(learner, "Narrowed", [
    "chat",
    "email_read",
    "email_draft",
    "email_send",
  ]);

  const account = await admin
    .from("user_email_accounts")
    .select("id")
    .eq("user_id", learner.id)
    .single();

  const draft = await admin
    .from("agent_email_drafts")
    .insert({
      user_id: learner.id,
      agent_id: agentId,
      account_id: account.data?.id ?? null,
      to_addresses: ["nobody@example.com"],
      subject: "verify-email-e2e",
      body: "This draft exists to be refused.",
      status: "draft",
    })
    .select("id")
    .single();

  if (draft.error || !draft.data) {
    check("a draft could be written", false, draft.error?.message ?? "no row");
    return;
  }

  const sent = await callApi<{ error?: string; code?: string }>(
    `/api/agents/${agentId}/email/drafts/${draft.data.id}/send`,
    learner.token,
    { method: "POST", body: JSON.stringify({}) }
  );

  check(
    "the send is refused when the mailbox never granted send",
    sent.status >= 400,
    `HTTP ${sent.status} ${sent.body?.code ?? ""}`
  );

  const after = await admin
    .from("agent_email_drafts")
    .select("status")
    .eq("id", draft.data.id)
    .single();

  check(
    "the draft is still a draft afterwards",
    after.data?.status === "draft",
    `status ${after.data?.status ?? "?"}`
  );
}

/* =========================================================
   TEARDOWN
========================================================= */

async function teardown(learner: Learner) {
  section("TEARDOWN");

  const removed = await admin.auth.admin.deleteUser(learner.id);

  check(
    "the test learner was deleted",
    !removed.error,
    removed.error?.message ?? learner.email
  );

  for (const table of ["user_email_accounts", "agent_email_drafts"]) {
    const leftovers = await admin
      .from(table)
      .select("id")
      .eq("user_id", learner.id);

    check(
      `${table} went with the learner`,
      (leftovers.data ?? []).length === 0,
      `${(leftovers.data ?? []).length} left`
    );
  }
}

/* =========================================================
   MAIN
========================================================= */

async function main() {
  console.log("\nBUILDGENTIC — EMAIL AGENT, END TO END\n");
  console.log(`  api: ${API}`);

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error("Missing Supabase credentials in server/.env or .env.local.");
    process.exit(1);
  }

  const health = await fetch(`${API}/api/health`).catch(() => null);

  if (!health || !health.ok) {
    console.error(`The API is not answering at ${API}. Start it and retry.`);
    process.exit(1);
  }

  const learner = await makeLearner();

  try {
    const ready = await checkPreconditions(learner);

    if (!ready) {
      console.error(
        "\nPreconditions failed. Every section below would fail for reasons that are not about email; stopping here."
      );
    } else {
      await checkConsentScopes(learner);
      await checkCallback();
      await checkMailbox(learner);
      await checkScopeRefusal(learner);
    }
  } finally {
    await teardown(learner);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (skips.length > 0) {
    console.log(`\n  Skipped:`);
    for (const label of skips) {
      console.log(`    - ${label}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n  Failed:`);
    for (const label of failures) {
      console.log(`    - ${label}`);
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

void main();
