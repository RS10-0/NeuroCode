/*
 * The Agent Library, through the door a learner uses.
 *
 * verify-flagships.mts proves the SCHEMA: that purchase_flagship
 * debits once, that RLS refuses a forged official agent, that
 * entitlements outlive the rows they created. All of that is
 * SQL, and testing it over HTTP would only have proved the route
 * is polite about it.
 *
 * This suite proves the other half, which SQL cannot: that the
 * Express handler around that function actually BUILDS what a
 * learner paid for. A purchase is five writes, not one — the
 * agent row, its seeded knowledge, a deployment, a slug, a
 * published page — and four of those live in TypeScript where
 * no database constraint is watching.
 *
 * TWO THINGS ARE CHECKED HERE AND NOWHERE ELSE.
 *
 * All five agents, not one. The handler is shared, so the
 * temptation is to test one and assume the rest. That
 * assumption is exactly what hides a per-agent mistake: a wrong
 * price in the catalogue, a capability list that does not match
 * the spec, a template mapping that throws for one id. Five
 * purchases cost one extra minute and check five different sets
 * of data through one code path.
 *
 * The FILE ANALYSIS SURCHARGE, at runtime. costs.ts prices this
 * at zero and AiRuntime adds it per turn instead, because the
 * feature is recorded once per attached FILE and a learner
 * attaching three pages asked one question. That arithmetic is
 * invisible to a typechecker and wrong in a way nobody would
 * notice: the agent still answers, it just quietly costs the
 * wrong amount. So it is measured against a real upload, with a
 * control turn to prove the difference is attributable.
 *
 *   npx tsx ./scripts/verify-library-e2e.mts
 *
 * Requires migrations 0014 and 0015, and a RUNNING API:
 *   npm --prefix server run dev
 *   API_BASE=http://localhost:3002 npx tsx ./scripts/verify-library-e2e.mts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { FLAGSHIPS } from "../src/features/agents/flagships.ts";
import { flagshipKnowledge } from "../server/src/agents/flagshipPrompts.ts";
import { COSTS, SURCHARGES } from "../server/src/credits/costs.ts";

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnv("server/.env");
const web = readEnv(".env.local");

const API = process.env.API_BASE ?? "http://localhost:3001";

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ---------------------------------------------------------
   A THROWAWAY LEARNER, WITH A REAL TOKEN
   --------------------------------------------------------- */

let userId = "";
let token = "";

async function createLearner(): Promise<void> {
  const email = `library-e2e-${Date.now()}@example.test`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-9xQ!`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    /* Required by this project's auth.users trigger, and unique
       per run. See the note in verify-credits.mts. */
    user_metadata: { username: `libe2e-${Date.now().toString(36)}` },
  });

  if (error || !data.user) {
    throw new Error(`Could not create a test learner: ${error?.message}`);
  }

  userId = data.user.id;

  const anon = createClient(web.VITE_SUPABASE_URL, web.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signIn = await anon.auth.signInWithPassword({ email, password });

  if (signIn.error || !signIn.data.session) {
    throw new Error(`Could not sign in: ${signIn.error?.message}`);
  }

  token = signIn.data.session.access_token;
}

async function deleteLearner(): Promise<void> {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
  }
}

/*
 * Funded by writing the row directly rather than by granting.
 *
 * A grant would land in xp_transactions and make the ledger
 * part of what these assertions depend on. The only XP movement
 * this suite should have to reason about is the one it causes.
 */
async function fund(balance: number): Promise<void> {
  await admin.from("user_credits").upsert(
    { user_id: userId, balance, lifetime_earned: 1000, max_balance: 300 },
    { onConflict: "user_id" }
  );
}

async function balanceOf(): Promise<number> {
  const { data } = await admin
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  return Number((data as { balance?: number } | null)?.balance ?? -1);
}

interface UnlockBody {
  agentId?: string;
  alreadyOwned?: boolean;
  charged?: number;
  balance?: number;
  site?: { slug: string; url: string; published: boolean } | null;
  error?: string;
}

async function unlock(flagshipId: string): Promise<{
  status: number;
  body: UnlockBody;
}> {
  const response = await fetch(
    `${API}/api/agents/library/${encodeURIComponent(flagshipId)}/unlock`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );

  let body: UnlockBody = {};

  try {
    body = (await response.json()) as UnlockBody;
  } catch {
    body = {};
  }

  return { status: response.status, body };
}

/* ---------------------------------------------------------
   THE CHAT PATH, for the surcharge measurement
   --------------------------------------------------------- */

async function upload(name: string, bytes: Buffer, contentType: string) {
  const response = await fetch(`${API}/api/agents/files`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${token}`,
      "X-File-Name": encodeURIComponent(name),
      "X-Power-Source": "platform",
    },
    body: new Uint8Array(bytes),
  });

  const body = (await response.json().catch(() => null)) as {
    file?: { id: string };
    error?: string;
  } | null;

  /* `ok` rather than a status literal: the upload route answers
     201 Created, and an assertion pinned to 200 fails on a
     working upload — which it did, once. */
  return {
    ok: response.ok,
    status: response.status,
    id: body?.file?.id ?? null,
    body,
  };
}

/*
 * One turn, non-streaming.
 *
 * `webSearch: false` on every call here, and that is not
 * incidental — it is what makes the measurement deterministic.
 * Writing Coach has Web Search enabled, the model decides for
 * itself whether to use it, and a turn that searched would add
 * its own surcharge and turn this assertion into a coin flip.
 * Disabling the branch isolates the one cost being measured.
 */
async function ask(
  agentId: string,
  question: string,
  attachments: string[]
): Promise<{ status: number; error: string | null }> {
  const response = await fetch(`${API}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      feature: "agent_test",
      powerSource: "platform",
      agentId,
      temperature: 0,
      maxOutputTokens: 200,
      stream: false,
      webSearch: false,
      memory: false,
      knowledgeRetrieval: false,
      fileAnalysis: attachments.length > 0,
      attachments,
    }),
  });

  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;

  return {
    status: response.status,
    error: response.ok ? null : (body?.error ?? `HTTP ${response.status}`),
  };
}

/* A CSV, because it is the cheapest real document to build and
   the extractor reads it without a binary format in the way. */
function buildCsv(): Buffer {
  const rows = [
    "region,quarter,revenue",
    "north,Q1,18400",
    "north,Q2,21750",
    "south,Q1,15200",
    "south,Q2,16800",
  ];

  return Buffer.from(rows.join("\n"), "utf8");
}

async function apiReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${API}/api/credits`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.status !== 0;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------
   THE CASES
   --------------------------------------------------------- */

async function main(): Promise<void> {
  const { error: schemaError } = await admin
    .from("agent_unlocks")
    .select("id")
    .limit(1);

  if (schemaError) {
    console.error(
      "supabase/migrations/0015_flagship_agents.sql has not been applied."
    );
    process.exitCode = 1;
    return;
  }

  await createLearner();
  console.log(`\nThrowaway learner ${userId}`);
  console.log(`API ${API}`);

  try {
    if (!(await apiReachable())) {
      console.error(
        `\nNo API at ${API}. Start it with "npm --prefix server run dev", or set API_BASE.`
      );
      failed += 1;
      return;
    }

    /* ------------------------------------------------------
       1. EVERY AGENT, NOT JUST THE ONE
       ------------------------------------------------------ */

    section("1. All five agents purchase through the same handler");

    for (const flagship of FLAGSHIPS) {
      /* Refunded to the ceiling before each one so the most
         expensive agent is affordable and every delta is
         measured from a known number. */
      await fund(300);

      const before = await balanceOf();
      const { status, body } = await unlock(flagship.id);

      check(
        `${flagship.id}: purchase accepted`,
        status === 201 && body.agentId !== undefined,
        `HTTP ${status} ${body.error ?? ""}`
      );

      if (!body.agentId) {
        continue;
      }

      check(
        `${flagship.id}: charged ${flagship.xpCost} XP`,
        body.charged === flagship.xpCost,
        `charged ${body.charged}`
      );

      const after = await balanceOf();

      check(
        `${flagship.id}: balance fell by exactly the price`,
        before - after === flagship.xpCost,
        `${before} -> ${after}`
      );

      const { data: row } = await admin
        .from("agents")
        .select(
          "is_official, flagship_id, status, system_instructions, capabilities, temperature"
        )
        .eq("id", body.agentId)
        .maybeSingle();

      const agent = row as {
        is_official: boolean;
        flagship_id: string;
        status: string;
        system_instructions: string;
        capabilities: string[];
        temperature: number | string;
      } | null;

      check(`${flagship.id}: row is official`, agent?.is_official === true);
      check(
        `${flagship.id}: row names the flagship`,
        agent?.flagship_id === flagship.id
      );
      check(
        `${flagship.id}: ready to use, not a draft`,
        agent?.status === "ready",
        String(agent?.status)
      );
      /* The paywall, at the row level. A copied prompt here
         would mean an improvement never reaches this learner —
         and would put the thing they paid for somewhere the
         browser can read it. */
      check(
        `${flagship.id}: carries no copied prompt`,
        agent?.system_instructions === "",
        `${agent?.system_instructions?.length ?? "?"} chars stored`
      );
      check(
        `${flagship.id}: capabilities match the catalogue`,
        JSON.stringify([...(agent?.capabilities ?? [])].sort()) ===
          JSON.stringify([...flagship.capabilities].sort()),
        (agent?.capabilities ?? []).join(", ")
      );
      check(
        `${flagship.id}: temperature is the tuned one`,
        Number(agent?.temperature) === flagship.temperature,
        String(agent?.temperature)
      );

      const { count: knowledgeCount } = await admin
        .from("agent_knowledge")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", body.agentId);

      check(
        `${flagship.id}: seeded ${flagshipKnowledge(flagship.id).length} knowledge entries`,
        (knowledgeCount ?? 0) === flagshipKnowledge(flagship.id).length,
        `${knowledgeCount} present`
      );

      const { count: deploymentCount } = await admin
        .from("agent_deployments")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", body.agentId);

      check(
        `${flagship.id}: deployed`,
        (deploymentCount ?? 0) === 1,
        `${deploymentCount} deployments`
      );

      check(
        `${flagship.id}: published at a slug`,
        Boolean(body.site?.slug) && body.site?.published === true,
        JSON.stringify(body.site)
      );

      /* The page a visitor would actually open, fetched
         anonymously — no token — because that is who reads it. */
      if (body.site?.slug) {
        const page = await fetch(
          `${API}/api/sites/${encodeURIComponent(body.site.slug)}`
        );

        const pageBody = (await page.json().catch(() => null)) as {
          site?: { config?: { sections?: Array<{ title?: string }> } };
        } | null;

        const sections = pageBody?.site?.config?.sections ?? [];
        const text = JSON.stringify(sections);

        check(
          `${flagship.id}: its page is publicly readable`,
          page.status === 200,
          `HTTP ${page.status}`
        );
        /* The defect this suite exists partly to keep fixed:
           starterConfig's placeholder prose is written to be
           overwritten, and nobody can overwrite one of these. */
        check(
          `${flagship.id}: page carries no placeholder copy`,
          !/Replace this with|Say which documents|Say what a good answer/.test(
            text
          ),
          "starter placeholder text is published"
        );
      }
    }

    /* ------------------------------------------------------
       2. THE FILE ANALYSIS SURCHARGE
       ------------------------------------------------------ */

    section("2. File analysis costs its surcharge, once per turn");

    const coach = FLAGSHIPS.find((f) => f.id === "writing-coach")!;

    const { data: coachRow } = await admin
      .from("agents")
      .select("id")
      .eq("user_id", userId)
      .eq("flagship_id", coach.id)
      .maybeSingle();

    const coachId = (coachRow as { id: string } | null)?.id ?? "";

    check("the agent under test exists", coachId !== "");
    check(
      "and it can read files",
      coach.capabilities.includes("file_analysis")
    );

    if (coachId) {
      const base = COSTS.agent_test;
      const surcharge = SURCHARGES.fileAnalysis;

      /*
       * THE CONTROL, first.
       *
       * Without it, a delta of 4 proves only that a turn costs
       * 4 — not that 2 of those are the attachment. Running the
       * same agent, same question, same everything minus the
       * file is what makes the second measurement attributable.
       */
      await fund(300);
      const plainBefore = await balanceOf();
      const plain = await ask(coachId, "Say the word ok and nothing else.", []);
      const plainAfter = await balanceOf();

      check(
        "a turn with no attachment succeeded",
        plain.status === 200,
        plain.error ?? ""
      );
      check(
        `it cost the base ${base} XP and no more`,
        plainBefore - plainAfter === base,
        `${plainBefore} -> ${plainAfter}`
      );

      const csv = buildCsv();
      const uploaded = await upload("revenue.csv", csv, "text/csv");

      check(
        "a document uploads",
        uploaded.ok && Boolean(uploaded.id),
        `HTTP ${uploaded.status} ${JSON.stringify(uploaded.body)}`
      );

      if (uploaded.id) {
        await fund(300);
        const withBefore = await balanceOf();
        const withFile = await ask(
          coachId,
          "What columns are in this file? Answer in one short line.",
          [uploaded.id]
        );
        const withAfter = await balanceOf();

        check(
          "a turn carrying a document succeeded",
          withFile.status === 200,
          withFile.error ?? ""
        );
        check(
          `it cost ${base} + ${surcharge} = ${base + surcharge} XP`,
          withBefore - withAfter === base + surcharge,
          `${withBefore} -> ${withAfter}`
        );

        /*
         * ONCE PER TURN, NOT ONCE PER FILE.
         *
         * The whole reason this surcharge is not a price on the
         * agent_file_analysis feature: that feature is recorded
         * per document, so two attachments would be charged
         * twice for one question. A learner who split their
         * source across two files asked one question.
         */
        const second = await upload("revenue-2.csv", csv, "text/csv");

        if (second.id) {
          await fund(300);
          const twoBefore = await balanceOf();
          const twoFiles = await ask(
            coachId,
            "Do these two files have the same columns? One short line.",
            [uploaded.id, second.id]
          );
          const twoAfter = await balanceOf();

          check(
            "a turn carrying two documents succeeded",
            twoFiles.status === 200,
            twoFiles.error ?? ""
          );
          check(
            `two files still cost ${base + surcharge} XP, not ${base + surcharge * 2}`,
            twoBefore - twoAfter === base + surcharge,
            `${twoBefore} -> ${twoAfter}`
          );
        }
      }
    }
  } finally {
    await deleteLearner();
  }

  console.log(
    `\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed\n`
  );

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  await deleteLearner().catch(() => {});
  process.exit(1);
});
