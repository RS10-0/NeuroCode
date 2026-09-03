/*
 * Proof that a notification can actually leave the building.
 *
 * The outbox is the one part of scheduled runs that talks to a
 * third party, and it is deliberately the part a run's outcome
 * does NOT depend on — a provider having a bad minute must never
 * turn a succeeded run into a failed one. That independence is
 * what makes this worth its own suite: nothing else in the
 * system fails when email does, so nothing else would tell you.
 *
 * Runs the REAL path. It does not construct its own request:
 * every send goes through notify.ts's `drainOutbox`, which reads
 * rows written by `createNotification` and hands them to
 * mail.ts. If this passes, the thing that passed is the code a
 * scheduled run uses.
 *
 * Needs server/.env with NEUROLINK_RESEND_API_KEY and
 * NEUROLINK_MAIL_FROM. Without them section 1 reports email as
 * off and the rest is skipped, which is a supported
 * configuration rather than a failure.
 *
 *   npx tsx ./scripts/verify-mail.mts                  (no send)
 *   npx tsx ./scripts/verify-mail.mts --to you@x.com   (real send)
 *
 * The --to form writes one notification owned by that address,
 * drains the outbox, and sends exactly one email. If the address
 * already has a BuildGentic account it BORROWS it and removes only
 * the notification it wrote; a temporary account is created, and
 * deleted, only when no account owns the address.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

/* ---------------------------------------------------------
   ENV — installed before the server modules are imported, for
   the reason verify-schedules-e2e.mts documents.
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

const { mail, mailEnabled } = await import("../server/src/ai/config");
const { drainOutbox } = await import("../server/src/agents/schedule/notify");
const { createNotification } = await import(
  "../server/src/agents/schedule/NotificationStore"
);

const admin = createClient(
  serverEnv.SUPABASE_URL,
  serverEnv.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
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

const recipient = (() => {
  const at = process.argv.indexOf("--to");
  return at >= 0 ? process.argv[at + 1] : null;
})();

/* =========================================================
   1. CONFIGURATION

   Including the one thing that must never be true: the key
   reaching anything a browser can read.
========================================================= */

function checkConfig(): boolean {
  section("1. CONFIGURATION");

  check("email is configured", mailEnabled(), mailEnabled() ? "key and from-address both set" : "not set — the feed still works, nothing is sent");

  if (!mailEnabled()) {
    return false;
  }

  /*
   * RFC 5322, because the failure is silent otherwise. A
   * from-address the provider will not accept produces a 422
   * per send, on a timer, recorded only in
   * agent_notifications.email_error where nobody is looking.
   */
  const from = mail.from ?? "";
  const wellFormed = /^[^<>]*<[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+>$|^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(from);

  check(
    "the from-address is a shape a provider will accept",
    wellFormed,
    from
  );

  /*
   * The key must be readable by the server and by nothing else.
   * Checked here rather than trusted because it is one careless
   * `VITE_` prefix away from being in every learner's browser —
   * which is the exact mistake server/.env.example opens by
   * warning about.
   */
  const key = mail.apiKey ?? "";

  check(
    "the key is not exposed under a VITE_ prefix",
    !Object.keys(process.env).some(
      (name) => name.startsWith("VITE_") && process.env[name] === key
    ),
    "Vite inlines VITE_* into the browser bundle"
  );

  let clientEnv = "";
  try {
    clientEnv = readFileSync(".env.local", "utf8");
  } catch {
    /* No client env file: nothing to leak into. */
  }

  check(
    "the key is not in the client env file",
    key.length > 0 && !clientEnv.includes(key),
    ".env.local is shipped to the browser"
  );

  return true;
}

/* =========================================================
   2. THE CREDENTIAL

   Authenticated against the SENDING endpoint, not against
   /domains, and the distinction cost this suite a false failure
   worth recording.

   Resend keys carry a scope. A "Sending access" key — the
   correct, least-privilege choice for a server that only ever
   sends — is refused by /domains with a 401 while working
   perfectly for POST /emails. Validating against /domains
   therefore reports a properly-scoped key as broken, which is
   exactly what this suite did on its first run.

   So this posts a request that is deliberately invalid and
   asserts on WHICH way it fails. Resend checks authorisation
   before it validates the body, so a 422 proves the key was
   accepted and a 401 or 403 proves it was not. Nothing is sent
   either way, because there is no recipient to send to.
========================================================= */

async function checkCredential() {
  section("2. THE CREDENTIAL");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${mail.apiKey}`,
      "content-type": "application/json",
    },
    /* No `to`. Refused for a missing field — after auth. */
    body: JSON.stringify({ from: mail.from, to: [], subject: "", text: "" }),
  }).catch(() => null);

  if (!response) {
    check("the provider is reachable", false, "no response — offline?");
    return;
  }

  check(
    "the API key is accepted by the sending endpoint",
    response.status !== 401 && response.status !== 403,
    `POST /emails with no recipient -> ${response.status} (auth is checked before the body)`
  );

  /*
   * Scope, reported rather than asserted. Knowing the key is
   * sending-only is what stops the next person "fixing" a 401
   * from /domains by issuing a full-access key this server has
   * no use for.
   */
  const scope = await fetch("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${mail.apiKey}` },
  }).catch(() => null);

  console.log(
    scope && scope.status === 401
      ? "  NOTE  sending-scoped key (401 from /domains) — least privilege, and correct here."
      : `  NOTE  this key also has account access (/domains -> ${scope?.status ?? "no response"}).`
  );

  if (scope && scope.ok) {
    const body = (await scope.json().catch(() => ({}))) as {
      data?: Array<{ name: string; status: string }>;
    };

    const domains = body.data ?? [];

    /*
     * Not a failure, but the thing that decides who a real send
     * can reach. `onboarding@resend.dev` is Resend's shared
     * sender: it needs no verified domain, and in exchange it
     * delivers only to the address that owns the account. A
     * verified domain of your own is what lifts that.
     */
    console.log(
      domains.length === 0
        ? "  NOTE  no verified domain — with onboarding@resend.dev, Resend delivers\n        only to the account owner's own address."
        : `  NOTE  verified domains: ${domains
            .map((d) => `${d.name} (${d.status})`)
            .join(", ")}`
    );
  }
}

/* =========================================================
   3. THE OUTBOX

   The mechanics, with no send: a notification written with
   email off must sit at 'none' and never enter the queue.
========================================================= */

async function checkOutboxMechanics() {
  section("3. THE OUTBOX");

  /*
   * Resend's own test recipient. It is accepted, counted and
   * delivered nowhere, which is exactly what this section needs:
   * proof that a queued row travels the whole path and comes
   * back `sent`, without a human inbox being involved.
   *
   * NOT an example.com address. Resend refuses those by policy
   * with a 422, which would prove the request reached the
   * provider and nothing else — the interesting half is what a
   * SUCCESSFUL send does to the row.
   */
  const learner = await resolveLearner("delivered@resend.dev");

  const quiet = await createNotification({
    userId: learner.id,
    kind: "run_output",
    title: "A run that does not email",
    body: "Feed only.",
    email: false,
  });

  const quietRow = await admin
    .from("agent_notifications")
    .select("email_state")
    .eq("id", quiet!)
    .single();

  check(
    "a feed-only notification never enters the queue",
    quietRow.data?.email_state === "none",
    `email_state=${quietRow.data?.email_state}`
  );

  const queued = await createNotification({
    userId: learner.id,
    kind: "schedule_disabled",
    title: "A run that does email",
    body: "Queued.",
    email: true,
  });

  const queuedRow = await admin
    .from("agent_notifications")
    .select("email_state")
    .eq("id", queued!)
    .single();

  check(
    "an emailing notification is queued as pending",
    queuedRow.data?.email_state === "pending",
    `email_state=${queuedRow.data?.email_state}`
  );

  const drained = await drainOutbox();

  const afterRow = await admin
    .from("agent_notifications")
    .select("email_state, email_attempts, email_error, email_sent_at")
    .eq("id", queued!)
    .single();

  const state = afterRow.data?.email_state;

  check(
    "the drain sends it and marks the row sent",
    state === "sent",
    `email_state=${state}, attempts=${afterRow.data?.email_attempts}, error=${
      String(afterRow.data?.email_error ?? "none").slice(0, 120)
    }`
  );

  check(
    "the row records WHEN it went, so a retry cannot re-send it",
    Boolean(afterRow.data?.email_sent_at)
  );

  /* A second drain must find nothing: a sent row has left the
     queue. Without this, every tick would re-send every
     notification ever written. */
  const again = await drainOutbox();

  check(
    "a second drain does not send it again",
    again.sent === 0,
    `second drain sent=${again.sent}`
  );

  check(
    "the feed entry survives whatever email did",
    Boolean(afterRow.data),
    "email is the second copy, never the only one"
  );

  console.log(`  NOTE  drain reported sent=${drained.sent} failed=${drained.failed}`);

  await cleanupLearner(learner, queued);
}

/* =========================================================
   4. A REAL SEND

   Only with --to. Sends exactly one email, through the same
   path a disabled schedule uses.
========================================================= */

async function checkRealSend(to: string) {
  section("4. A REAL SEND");

  const learner = await resolveLearner(to);

  console.log(
    learner.owned
      ? `  NOTE  no BuildGentic account had ${to}; a temporary one was created and will be deleted.`
      : `  NOTE  ${to} already has a BuildGentic account — borrowing it, and leaving it exactly as found.`
  );

  const id = await createNotification({
    userId: learner.id,
    kind: "schedule_disabled",
    title: "BuildGentic email is working",
    body: [
      "This is a test of the scheduled-run email path.",
      "",
      "It travelled the same route a real notification takes: a row in",
      "agent_notifications with email_state 'pending', drained by the",
      "scheduler tick, sent through Resend as plain text.",
      "",
      "If you are reading this, outbox -> Resend -> inbox works.",
    ].join("\n"),
    email: true,
  });

  check("the notification was queued", Boolean(id), id ?? "not written");

  if (!id) {
    await cleanupLearner(learner, null);
    return;
  }

  const drained = await drainOutbox();

  const row = await admin
    .from("agent_notifications")
    .select("email_state, email_attempts, email_error, email_sent_at")
    .eq("id", id)
    .single();

  check(
    `the email was accepted by Resend for ${to}`,
    row.data?.email_state === "sent",
    row.data?.email_state === "sent"
      ? `sent at ${row.data.email_sent_at}`
      : `state=${row.data?.email_state} error=${String(row.data?.email_error ?? "").slice(0, 140)}`
  );

  check(
    "the send was recorded, not merely attempted",
    Boolean(row.data?.email_sent_at) || row.data?.email_state !== "sent",
    "email_sent_at is what stops a retry re-sending it"
  );

  console.log(`  NOTE  drain reported sent=${drained.sent} failed=${drained.failed}`);

  await cleanupLearner(learner, id);
}

/* ---------------------------------------------------------
   A learner whose auth address is the recipient.

   The address is read from auth.users by the notifier and can
   come from nowhere else — there is no recipient column and no
   API field — so a test of the real path needs an account that
   owns the address.

   EXISTING ACCOUNTS ARE REUSED, NEVER REPLACED, and the caller
   is told which it got. Two reasons, and the second one matters
   more than the convenience:

   A real address usually already has an account — that is what
   makes it a real address — so creating one fails, which is how
   this suite first met this function.

   And an account this script did not create is somebody's, so
   it must survive the test. `owned` is what the cleanup reads:
   a borrowed account keeps its rows and loses only the one
   notification written into it.
   --------------------------------------------------------- */

interface TestLearner {
  id: string;
  /* True when this run created it, and therefore may delete it. */
  owned: boolean;
}

async function resolveLearner(email: string): Promise<TestLearner> {
  /*
   * The EMAIL is fixed on purpose here — it is Resend's
   * sandbox address, and borrowing the account it already
   * made is this function's whole design. The USERNAME must
   * still be unique: profiles.username is unique, so a
   * constant one made the FIRST create fail against any
   * leftover holding the name, and this function would then
   * fall through to the borrow path and report that it could
   * not find a learner — hiding a name collision behind a
   * message about the address.
   */
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const made = await admin.auth.admin.createUser({
    email,
    password: `verify-${crypto.randomUUID()}`,
    email_confirm: true,
    user_metadata: { username: `mail-verify-${stamp}` },
  });

  if (!made.error && made.data.user) {
    return { id: made.data.user.id, owned: true };
  }

  /* Already registered: borrow it. */
  const existing = await admin.auth.admin.listUsers({ perPage: 200 });
  const found = existing.data.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase()
  );

  if (!found) {
    throw new Error(
      `could not create or find a learner for ${email}: ${made.error?.message}`
    );
  }

  return { id: found.id, owned: false };
}

/*
 * Removes only what this run added.
 *
 * A created account goes entirely. A borrowed one keeps
 * everything except the notification written into it — leaving
 * a test message sitting unread in somebody's real feed would be
 * this suite failing at the one thing it is checking.
 */
async function cleanupLearner(
  learner: TestLearner,
  notificationId: string | null
): Promise<void> {
  if (learner.owned) {
    await admin.auth.admin.deleteUser(learner.id);
    return;
  }

  if (notificationId) {
    await admin.from("agent_notifications").delete().eq("id", notificationId);
  }
}

/* =========================================================
   RUN
========================================================= */

console.log("BUILDGENTIC — SCHEDULED-RUN EMAIL");

try {
  if (checkConfig()) {
    await checkCredential();
    await checkOutboxMechanics();

    if (recipient) {
      await checkRealSend(recipient);
    } else {
      section("4. A REAL SEND");
      console.log("  SKIP  no --to given; nothing was sent to a real inbox.");
    }
  }
} catch (error) {
  failed += 1;
  failures.push("the suite threw");
  console.log(`\n  FAIL  the suite threw - ${error instanceof Error ? error.message : error}`);
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
