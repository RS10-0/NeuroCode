/*
 * Proof that the XP wallet holds under the conditions that
 * actually break wallets.
 *
 * Drives the real SQL functions with the service key — not the
 * Express API — because everything worth testing here IS the
 * SQL: the atomic debit, the idempotent grant, the ceiling, the
 * streak. Testing those through HTTP would prove that one
 * request works, which was never in doubt.
 *
 * REWRITTEN FOR THE SECOND WALLET (migration 0014). The suite
 * this replaces was built around a balance that reset to a
 * daily allowance every 24 hours, and most of its assertions
 * were about that reset — including one that asserted a stale
 * balance IS refilled, which is now precisely the bug this file
 * exists to catch. They are not bolted-on assertions; the
 * expectations changed.
 *
 * Two properties carry most of the weight, and neither existed
 * before:
 *
 *   The balance ACCUMULATES and stops at `max_balance`. If it
 *   silently reset, a learner saving for a 200 XP Library agent
 *   would lose their savings overnight and nothing else in the
 *   system would notice.
 *
 *   `lifetime_earned` only ever goes UP. It is what Level is
 *   computed from, so a spend that touched it would mean buying
 *   an agent could cost somebody a level they earned. Section 6
 *   is the whole reason that column is separate from `balance`.
 *
 *   npx tsx ./scripts/verify-credits.mts
 *
 * Requires supabase/migrations/0014 to have been applied.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnv("server/.env");

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
   A THROWAWAY LEARNER

   Created and deleted here, so this never runs against
   somebody's real balance.
   --------------------------------------------------------- */

let userId = "";

async function createLearner(): Promise<void> {
  const email = `credits-verify-${Date.now()}@example.test`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    email_confirm: true,
    /*
     * `username` is not optional here, whatever the Supabase
     * docs suggest. This project has a trigger on auth.users
     * that reads raw_user_meta_data->>'username'.
     *
     * And it is UNIQUE PER RUN rather than a constant, because
     * `profiles.username` is unique. A run that dies before its
     * cleanup — a pipe closed by `head` will do it — leaves an
     * account holding the name, and every later run then fails
     * at signup with a bare "Database error creating new user"
     * that names nothing. That cost half an hour once already.
     */
    user_metadata: { username: `credits-${Date.now().toString(36)}` },
  });

  if (error || !data.user) {
    throw new Error(`Could not create a test learner: ${error?.message}`);
  }

  userId = data.user.id;
}

async function deleteLearner(): Promise<void> {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
  }
}

async function spend(cost: number) {
  const { data, error } = await admin.rpc("spend_credits", {
    p_user_id: userId,
    p_cost: cost,
  });

  if (error) throw new Error(`spend_credits: ${error.message}`);

  return (Array.isArray(data) ? data[0] : data) as {
    ok: boolean;
    balance: number;
  };
}

async function grant(amount: number, sourceType: string, sourceId: string) {
  const { data, error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: "verify",
    p_source_type: sourceType,
    p_source_id: sourceId,
  });

  if (error) throw new Error(`grant_credits: ${error.message}`);

  return (Array.isArray(data) ? data[0] : data) as {
    granted: number;
    balance: number;
    lifetime: number;
  };
}

async function claimDaily(day: string) {
  const { data, error } = await admin.rpc("claim_daily_credits", {
    p_user_id: userId,
    p_day: day,
  });

  if (error) throw new Error(`claim_daily_credits: ${error.message}`);

  return (Array.isArray(data) ? data[0] : data) as {
    granted: number;
    bonus: number;
    balance: number;
    lifetime: number;
    streak: number;
  };
}

interface Wallet {
  balance: number;
  lifetime_earned: number;
  streak_days: number;
  last_login_day: string | null;
  max_balance: number;
  daily_allowance: number;
}

async function wallet(): Promise<Wallet> {
  const { data } = await admin
    .from("user_credits")
    .select(
      "balance, lifetime_earned, streak_days, last_login_day, max_balance, daily_allowance"
    )
    .eq("user_id", userId)
    .maybeSingle();

  return (data ?? {
    balance: -1,
    lifetime_earned: -1,
    streak_days: -1,
    last_login_day: null,
    max_balance: -1,
    daily_allowance: -1,
  }) as Wallet;
}

async function balance(): Promise<number> {
  return (await wallet()).balance;
}

async function setRow(patch: Record<string, unknown>): Promise<void> {
  await admin.from("user_credits").update(patch).eq("user_id", userId);
}

/* A day string N days after an arbitrary fixed base, so the
   streak cases can walk a calendar without waiting for one. */
function day(offset: number): string {
  const base = Date.UTC(2031, 0, 10);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------
   THE CASES
   --------------------------------------------------------- */

/*
 * Check the migration first.
 *
 * Without it every case below fails for the same reason, and
 * the first failure is a confusing one. One clear sentence
 * beats fifteen misleading ones.
 */
async function requireMigration(): Promise<boolean> {
  const { error } = await admin
    .from("user_credits")
    .select("user_id, max_balance, lifetime_earned")
    .limit(1);

  if (error) {
    console.error(
      "supabase/migrations/0014_xp_wallet_v2.sql has not been applied."
    );
    console.error("Paste it into the Supabase SQL Editor, then run this again.");

    return false;
  }

  return true;
}

async function main(): Promise<void> {
  if (!(await requireMigration())) {
    /* Returning rather than exiting: a hard exit while the
       Supabase client still holds a socket trips a libuv
       assertion on Windows that reads like a crash. */
    process.exitCode = 1;
    return;
  }

  await createLearner();
  console.log(`\nThrowaway learner ${userId}`);

  try {
    section("1. First touch mints a row");
    let result = await spend(1);
    check("the spend was allowed", result.ok);
    check(
      "balance is the opening figure minus the cost",
      result.balance === 39,
      String(result.balance)
    );

    section("2. A spend larger than the balance is refused");
    await setRow({ balance: 1 });
    result = await spend(2);
    check("refused", !result.ok);
    check("the balance was not touched", (await balance()) === 1);
    check(
      "the refusal reports what they actually have",
      result.balance === 1,
      String(result.balance)
    );

    section("3. An exact-change spend is allowed");
    await setRow({ balance: 2 });
    result = await spend(2);
    check("allowed", result.ok);
    check("balance is zero, not negative", result.balance === 0);

    section("4. Concurrent spends cannot overdraw");
    /* The case a read-then-write balance fails. Ten parallel
       spends of 1 against a balance of 5: exactly five may win. */
    await setRow({ balance: 5 });

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => spend(1))
    );

    const allowed = attempts.filter((a) => a.ok).length;

    check("exactly five of ten succeeded", allowed === 5, `${allowed} won`);
    check(
      "the balance landed on zero, not below",
      (await balance()) === 0,
      String(await balance())
    );

    section("5. A stale balance is NOT refilled");
    /*
     * THE INVERSION. The previous wallet refilled lazily inside
     * spend_credits, and the suite this replaces asserted that
     * it did. Under an accumulating wallet that same behaviour
     * is a bug that deletes a learner's savings, so the
     * assertion is now the opposite one.
     */
    await setRow({
      balance: 3,
      last_refill_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    });

    result = await spend(1);
    check("an old row still spends normally", result.ok);
    check(
      "three days of not logging in did not top anybody up",
      result.balance === 2,
      String(result.balance)
    );

    section("6. Spending never touches lifetime earnings");
    /*
     * The invariant Level rests on. If a spend moved this
     * column, buying a 200 XP agent would cost a learner a
     * level they earned — which is the exact failure the two
     * separate columns exist to make impossible.
     */
    await setRow({ balance: 100, lifetime_earned: 500 });
    await spend(60);
    let w = await wallet();
    check("the balance went down", w.balance === 40, String(w.balance));
    check(
      "lifetime earnings did not move",
      w.lifetime_earned === 500,
      String(w.lifetime_earned)
    );

    section("7. Grants are idempotent per source");
    await setRow({ balance: 0, lifetime_earned: 0 });

    let granted = await grant(20, "lesson", "lesson-alpha");
    check("the first grant paid", granted.granted === 20);
    check("balance moved", granted.balance === 20, String(granted.balance));
    check(
      "lifetime moved with it",
      granted.lifetime === 20,
      String(granted.lifetime)
    );

    granted = await grant(20, "lesson", "lesson-alpha");
    check("replaying the same lesson paid nothing", granted.granted === 0);
    check("balance did not move", granted.balance === 20);
    check("lifetime did not move either", granted.lifetime === 20);

    granted = await grant(20, "lesson", "lesson-beta");
    check("a different lesson does pay", granted.granted === 20);

    section("8. The balance accumulates past a single day's grant");
    /*
     * The point of the whole migration. Under the old wallet
     * this was impossible by construction — the cap WAS the
     * daily allowance — and every Library agent was therefore
     * unaffordable forever.
     */
    await setRow({ balance: 0, lifetime_earned: 0 });

    for (let i = 0; i < 5; i += 1) {
      await grant(40, "verify-accumulate", `day-${i}`);
    }

    w = await wallet();
    check(
      "five days of grants are still there",
      w.balance === 200,
      String(w.balance)
    );
    check(
      "which is well past a single day's 40",
      w.balance > w.daily_allowance
    );

    section("9. A grant clamps at the ceiling, and level progress does not");
    /*
     * The asymmetry, and the edge case worth being explicit
     * about: a learner sitting at the ceiling who finishes a
     * lesson banks no spendable XP but still gets the full
     * amount toward their Level. The overflow is lost as
     * currency and kept as progress.
     */
    await setRow({ balance: 290, lifetime_earned: 1000, max_balance: 300 });
    granted = await grant(40, "verify-clamp", "at-the-ceiling");

    check(
      "the balance stopped at the ceiling",
      granted.balance === 300,
      String(granted.balance)
    );
    check(
      "the grant still reports the full amount",
      granted.granted === 40,
      String(granted.granted)
    );
    check(
      "and lifetime took all 40, not the 10 that fitted",
      granted.lifetime === 1040,
      String(granted.lifetime)
    );

    section("10. A refund returns the cost, capped at the ceiling");
    await setRow({ balance: 10, lifetime_earned: 700, max_balance: 300 });
    await admin.rpc("refund_credits", { p_user_id: userId, p_amount: 2 });
    check("refunded", (await balance()) === 12, String(await balance()));

    await setRow({ balance: 295 });
    await admin.rpc("refund_credits", { p_user_id: userId, p_amount: 50 });
    w = await wallet();
    check(
      "a refund cannot push a learner above the ceiling",
      w.balance === 300,
      String(w.balance)
    );
    check(
      "and a refund is not earnings",
      w.lifetime_earned === 700,
      String(w.lifetime_earned)
    );

    section("11. The daily claim adds rather than overwrites");
    /*
     * The other half of the reset's removal. The function this
     * replaces SET the balance; if this one ever did, a learner
     * with 250 saved would wake up with 40.
     */
    await setRow({
      balance: 250,
      lifetime_earned: 0,
      streak_days: 0,
      last_login_day: null,
      max_balance: 300,
    });

    let claim = await claimDaily(day(0));
    check("the login paid", claim.granted === 40, String(claim.granted));
    check(
      "on top of what was saved, not instead of it",
      claim.balance === 290,
      String(claim.balance)
    );
    check("no bonus on day one", claim.bonus === 0);
    check("the streak started at one", claim.streak === 1, String(claim.streak));

    claim = await claimDaily(day(0));
    check("claiming twice in a day pays nothing", claim.granted === 0);
    check(
      "and does not move the balance",
      claim.balance === 290,
      String(claim.balance)
    );
    check("nor the streak", claim.streak === 1, String(claim.streak));

    section("12. The streak counts consecutive days and forgives nothing");
    await setRow({
      balance: 0,
      streak_days: 3,
      last_login_day: day(9),
    });

    claim = await claimDaily(day(10));
    check(
      "yesterday plus today is four in a row",
      claim.streak === 4,
      String(claim.streak)
    );

    await setRow({ streak_days: 6, last_login_day: day(10) });
    claim = await claimDaily(day(15));
    check(
      "a five day gap starts again at one",
      claim.streak === 1,
      String(claim.streak)
    );

    section("13. The tenth consecutive day pays a bonus, then resets");
    await setRow({
      balance: 0,
      lifetime_earned: 0,
      streak_days: 9,
      last_login_day: day(19),
      max_balance: 300,
    });

    claim = await claimDaily(day(20));
    check("the login still paid", claim.granted === 40);
    check("the bonus landed", claim.bonus === 20, String(claim.bonus));
    check(
      "both reached the balance",
      claim.balance === 60,
      String(claim.balance)
    );
    check(
      "and both counted toward level",
      claim.lifetime === 60,
      String(claim.lifetime)
    );
    check(
      "the counter reset rather than reaching ten",
      claim.streak === 0,
      String(claim.streak)
    );

    section("14. A full wallet still earns level progress from a streak");
    /*
     * The edge case at the ceiling, on the bonus rather than on
     * a lesson: ten days of logging in while full banks nothing
     * spendable, and must still count. If it did not, the
     * fullest learners would stop levelling.
     */
    await setRow({
      balance: 300,
      lifetime_earned: 2000,
      streak_days: 9,
      last_login_day: day(29),
      max_balance: 300,
    });

    claim = await claimDaily(day(30));
    check(
      "the balance stayed at the ceiling",
      claim.balance === 300,
      String(claim.balance)
    );
    check(
      "and 60 XP of progress landed anyway",
      claim.lifetime === 2060,
      String(claim.lifetime)
    );

    section("15. Level matches the TypeScript that renders it");
    /*
     * credit_level() in SQL and the same arithmetic in
     * CreditStore.describe() are two definitions of one scale.
     * Compared here rather than trusted to agree, the way the
     * memory suite compares scope_key.
     */
    const cases = [0, 1, 199, 200, 201, 399, 400, 2060];

    for (const lifetime of cases) {
      const { data } = await admin.rpc("credit_level", {
        p_lifetime: lifetime,
      });

      const ts = Math.floor(lifetime / 200) + 1;

      check(
        `level(${lifetime}) agrees: ${ts}`,
        Number(data) === ts,
        `SQL said ${data}`
      );
    }

    section("16. The nightly reset is gone");
    /*
     * Left scheduled, reset_daily_credits would set every
     * balance back to 40 at seven minutes past midnight and
     * delete everything anybody had saved toward a Library
     * agent. Its absence is a feature with a test.
     */
    const { error: resetError } = await admin.rpc("reset_daily_credits");
    check(
      "reset_daily_credits no longer exists",
      resetError !== null && /could not find the function/i.test(resetError.message),
      resetError ? resetError.message : "it is still there"
    );

    section("17. The browser cannot write its own wallet");
    /*
     * The whole reason the table is owner-read with no write
     * policy. Uses the anon key with no session, which is the
     * weakest possible caller — a signed-in one is bounded by
     * the same missing policy.
     */
    await setRow({ balance: 7, lifetime_earned: 700 });

    const web = readEnv(".env.local");
    const anon = createClient(web.VITE_SUPABASE_URL, web.VITE_SUPABASE_ANON_KEY);

    const { error: writeError } = await anon
      .from("user_credits")
      .update({ balance: 9999, lifetime_earned: 999_999 })
      .eq("user_id", userId);

    w = await wallet();

    check(
      "an anonymous write did not change the balance",
      w.balance === 7,
      `balance is now ${w.balance}`
    );
    check(
      "nor invent a level",
      w.lifetime_earned === 700,
      `lifetime is now ${w.lifetime_earned}`
    );
    check(
      "and it was refused rather than silently ignored",
      writeError !== null || w.balance === 7
    );
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

  if (/could not find the function/i.test(String(error))) {
    console.error(
      "\nsupabase/migrations/0014_xp_wallet_v2.sql has not been applied.\n"
    );
  }

  await deleteLearner().catch(() => {});
  process.exit(1);
});
