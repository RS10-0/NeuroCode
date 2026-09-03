import { supabase } from "../lib/supabase";
import { AiRuntimeError } from "../ai/errors";

/*
 * The XP wallet.
 *
 * A thin wrapper over the wallet's SQL functions, and thin on
 * purpose: every rule that matters — the atomic debit, the
 * idempotent grant, the ceiling, the streak, the purchase —
 * lives in supabase/migrations/0014 and 0015, where each can be
 * enforced in one statement rather than in two round trips with
 * a gap in the middle. See the migrations for why that gap is
 * the whole problem.
 *
 * NOTHING HERE TRUSTS THE CLIENT. There is no balance in the
 * browser to edit, no cost in a request body, and no way to
 * name your own price: the caller passes a feature, the price
 * list is server-side, and the user id comes from a verified
 * bearer token.
 *
 * SINCE 0014 THE BALANCE ACCUMULATES. It carries over from day
 * to day and stops at `max_balance` rather than being reset to
 * a daily figure, which is why nothing in this file refills
 * anything any more — `claimDaily` GRANTS, additively, and the
 * old reset function is gone. A second number rides alongside
 * it: `lifetime_earned`, which every grant increases and no
 * spend ever touches, and which is what Level is computed from.
 * Buying a 200 XP agent must not cost somebody a level they
 * earned.
 *
 * THIS FILE KNOWS NOTHING ABOUT PROVIDERS, and providerChain
 * knows nothing about XP. That separation is deliberate — how
 * much an action costs a learner has nothing to do with which
 * vendor happened to answer, and tying them together would mean
 * a Groq outage changing somebody's bill.
 */

export interface SpendResult {
  ok: boolean;
  /* The balance AFTER the spend, or the untouched balance when
     it was refused. */
  balance: number;
}

/*
 * Takes the cost, or refuses.
 *
 * Called before any provider is contacted, which is what makes
 * "out of XP" cost BuildGentic nothing: no socket is opened, no
 * token is spent, and the learner gets an answer immediately
 * rather than after a round trip.
 *
 * No longer refills anything. Under 0011 this statement carried
 * a lazy refill, because a learner whose balance ran out
 * yesterday had to be served on today's allowance. Balances
 * accumulate since 0014, so there is nothing to refill: what is
 * in the wallet is what is in the wallet until a grant arrives.
 */
export async function spend(
  userId: string,
  cost: number
): Promise<SpendResult> {
  /* Free actions do not touch the wallet at all. Worth
     short-circuiting rather than spending a round trip proving
     that zero is affordable. */
  if (cost <= 0) {
    return { ok: true, balance: await balanceOf(userId) };
  }

  const { data, error } = await supabase.rpc("spend_credits", {
    p_user_id: userId,
    p_cost: Math.max(0, Math.round(cost)),
  });

  if (error) {
    if (missingFunction(error.message)) {
      /*
       * The migration has not been applied.
       *
       * Failing OPEN here, unlike the quota gate, and the
       * difference is deliberate. QuotaGuard fails closed
       * because it bounds a real provider bill and guessing
       * "first request" is how that bill gets interesting. This
       * bounds a teaching allowance, and the platform budget in
       * ai_usage_admit still stands behind it — so the worst
       * case of failing open is a learner getting free XP for
       * as long as somebody has not run one SQL file, which
       * beats the Lab being dead on arrival.
       */
      console.error(
        "[credits] spend_credits is missing — apply supabase/migrations/0014_xp_wallet_v2.sql. Letting this request through."
      );

      return { ok: true, balance: 0 };
    }

    throw new AiRuntimeError(
      "internal_error",
      "BuildGentic could not check your XP balance. Please try again.",
      { internalDetail: `spend_credits failed: ${error.message}` }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    balance?: number;
  } | null;

  return {
    ok: row?.ok === true,
    balance: Number(row?.balance ?? 0),
  };
}

/*
 * Gives it back, when the answer never happened.
 *
 * Called only when every provider in the cascade failed. A
 * learner must not pay for an outage, and the alternative —
 * charging on success only — would mean holding the debit open
 * across a streaming response, which is exactly the read-then-
 * write gap the atomic spend exists to avoid.
 *
 * Never throws. This runs on a path that has already failed;
 * turning a refund problem into a second error would replace a
 * message the learner can act on with one they cannot.
 */
export async function refund(userId: string, amount: number): Promise<void> {
  if (amount <= 0) {
    return;
  }

  const { error } = await supabase.rpc("refund_credits", {
    p_user_id: userId,
    p_amount: Math.max(0, Math.round(amount)),
  });

  if (error && !missingFunction(error.message)) {
    console.error(
      `[credits] could not refund ${amount} XP to ${userId}: ${error.message}`
    );
  }
}

export interface GrantResult {
  granted: number;
  balance: number;
  /* Everything ever earned, after this grant. Level is derived
     from it, and it never goes down. */
  lifetime: number;
}

/*
 * Earning.
 *
 * `sourceType` and `sourceId` are what make it idempotent: the
 * ledger row IS the lock, so replaying a lesson or firing the
 * daily bonus twice pays once. Pass a stable pair or the grant
 * repeats.
 */
export async function grant(
  userId: string,
  amount: number,
  reason: string,
  sourceType: string,
  sourceId: string
): Promise<GrantResult> {
  const { data, error } = await supabase.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: Math.max(0, Math.round(amount)),
    p_reason: reason,
    p_source_type: sourceType,
    p_source_id: sourceId,
  });

  if (error) {
    if (missingFunction(error.message)) {
      console.error(
        "[credits] grant_credits is missing — apply supabase/migrations/0014_xp_wallet_v2.sql."
      );

      return { granted: 0, balance: 0, lifetime: 0 };
    }

    /*
     * Logged, not thrown. A learner who has just finished a
     * lesson must not be told their lesson failed because a
     * bonus could not be recorded.
     */
    console.error(
      `[credits] could not grant ${amount} XP to ${userId}: ${error.message}`
    );

    return { granted: 0, balance: 0, lifetime: 0 };
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    granted?: number;
    balance?: number;
    lifetime?: number;
  } | null;

  return {
    granted: Number(row?.granted ?? 0),
    balance: Number(row?.balance ?? 0),
    lifetime: Number(row?.lifetime ?? 0),
  };
}

export interface DailyClaimResult {
  /* The login grant. Zero when today has already been claimed. */
  granted: number;
  /* The ten-day streak bonus, on the day it lands. */
  bonus: number;
  balance: number;
  lifetime: number;
  /* Consecutive qualifying logins since the last bonus paid —
     NOT the display streak in user_stats, which keeps counting.
     See claim_daily_credits in 0014. */
  streak: number;
}

/*
 * Claims today's login grant, and advances the streak.
 *
 * Replaces the old "refill" idea entirely. Nothing resets a
 * balance any more; this adds the day's XP on top of whatever
 * was already saved, clamped at the learner's ceiling.
 *
 * Safe to call on every page load — the idempotency is a unique
 * index on (user_id, source_type, source_id) in the database,
 * not a check here and not a flag in a session.
 *
 * The day is passed in rather than read from the database
 * clock, so the caller owns the timezone. The route passes UTC.
 */
export async function claimDaily(
  userId: string,
  day: string
): Promise<DailyClaimResult> {
  const empty: DailyClaimResult = {
    granted: 0,
    bonus: 0,
    balance: 0,
    lifetime: 0,
    streak: 0,
  };

  const { data, error } = await supabase.rpc("claim_daily_credits", {
    p_user_id: userId,
    p_day: day,
  });

  if (error) {
    if (missingFunction(error.message)) {
      console.error(
        "[credits] claim_daily_credits is missing — apply supabase/migrations/0014_xp_wallet_v2.sql."
      );

      return empty;
    }

    /* Logged, not thrown, for the same reason `grant` does it:
       a learner opening the dashboard must not be shown an
       error because a bonus could not be recorded. */
    console.error(
      `[credits] could not claim the daily grant for ${userId}: ${error.message}`
    );

    return empty;
  }

  const row = (Array.isArray(data) ? data[0] : data) as Partial<
    Record<keyof DailyClaimResult, number>
  > | null;

  return {
    granted: Number(row?.granted ?? 0),
    bonus: Number(row?.bonus ?? 0),
    balance: Number(row?.balance ?? 0),
    lifetime: Number(row?.lifetime ?? 0),
    streak: Number(row?.streak ?? 0),
  };
}

export interface CreditSnapshot {
  balance: number;
  /*
   * The ceiling the balance stops at. NOT the daily grant —
   * those were the same number under 0011 and are deliberately
   * different now.
   */
  maxBalance: number;
  /* What arrives on a login. `daily_allowance` kept its column
     name and changed its meaning in 0014; see the migration. */
  dailyGrant: number;
  /*
   * Everything ever earned. The source of Level, and the one
   * number in this file that never decreases.
   *
   * Deliberately not called "xp" anywhere it reaches the
   * browser: user_stats.xp is a different number measuring a
   * different thing (curriculum score), and one of the two has
   * to keep a name that cannot be confused with the other.
   */
  lifetimeEarned: number;
  level: number;
  /* Progress through the current level, and the size of a
     level. The UI renders "120 / 200 XP to next level" from
     these rather than recomputing the divisor. */
  xpIntoLevel: number;
  xpPerLevel: number;
  lastRefillAt: string | null;
  /*
   * False when there is no wallet to read — the migration has
   * not been applied yet.
   *
   * Reported rather than faked, because the alternatives are
   * both worse: a 500 on every page load is noise, and
   * inventing "40 / 40" would put a number on screen that
   * nothing is enforcing. The client hides the meter instead,
   * which is the honest rendering of "there is no allowance
   * here yet".
   */
  available: boolean;
}

/*
 * What the meter reads.
 *
 * Read through the service role rather than letting the browser
 * select its own row, so there is exactly one code path that
 * knows the shape of this table. The RLS policy would allow the
 * browser to read it — that policy exists so a learner CAN see
 * their own balance — but going through here means the lazy
 * refill is visible to a client that has not spent anything yet.
 */
export async function snapshot(userId: string): Promise<CreditSnapshot> {
  const { data, error } = await supabase
    .from("user_credits")
    .select(
      "balance, daily_allowance, max_balance, lifetime_earned, last_refill_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (/could not find the table|does not exist|column/i.test(error.message)) {
      console.error(
        "[credits] user_credits is missing columns — apply supabase/migrations/0014_xp_wallet_v2.sql. The XP meter is hidden until then."
      );

      return unavailable();
    }

    throw new AiRuntimeError("internal_error", "Unable to load your XP.", {
      internalDetail: `user_credits select failed: ${error.message}`,
    });
  }

  if (!data) {
    /*
     * No row yet, which is the ordinary state of somebody who
     * has just signed up. Reported at the daily grant rather
     * than at zero, because that is what the first call to
     * claimDaily will mint — and a meter reading 0 for a
     * learner who has a day's XP waiting would be a lie.
     *
     * Lifetime is genuinely zero here, so Level 1 is correct
     * rather than optimistic.
     */
    return describe({
      balance: WALLET_DEFAULTS.dailyGrant,
      maxBalance: WALLET_DEFAULTS.maxBalance,
      dailyGrant: WALLET_DEFAULTS.dailyGrant,
      lifetimeEarned: 0,
      lastRefillAt: null,
    });
  }

  /*
   * No staleness branch any more, and its absence is the whole
   * point of 0014. Under the resetting wallet this function had
   * to predict the refill spend_credits was about to apply, or
   * the meter and the gate would disagree. Nothing refills now,
   * so what the row says is simply what the learner has.
   */
  return describe({
    balance: Number(data.balance),
    maxBalance: Number(data.max_balance),
    dailyGrant: Number(data.daily_allowance),
    lifetimeEarned: Number(data.lifetime_earned),
    lastRefillAt: data.last_refill_at,
  });
}

/*
 * Mirrors migration 0014's column defaults, for the one case
 * where there is no row to read them from.
 */
const WALLET_DEFAULTS = {
  dailyGrant: 40,
  maxBalance: 300,
} as const;

/*
 * Level, derived rather than stored.
 *
 * MUST STAY IDENTICAL TO credit_level() IN MIGRATION 0014. The
 * database owns the definition; this is the copy that saves a
 * round trip on every page load. They are compared in
 * scripts/verify-credits.mts rather than trusted to agree.
 */
function describe(
  base: Omit<
    CreditSnapshot,
    "level" | "xpIntoLevel" | "xpPerLevel" | "available"
  >
): CreditSnapshot {
  const lifetime = Math.max(0, base.lifetimeEarned);

  return {
    ...base,
    level: Math.floor(lifetime / XP_PER_LEVEL) + 1,
    xpIntoLevel: lifetime % XP_PER_LEVEL,
    xpPerLevel: XP_PER_LEVEL,
    available: true,
  };
}

const XP_PER_LEVEL = 200;

function unavailable(): CreditSnapshot {
  return {
    balance: 0,
    maxBalance: 0,
    dailyGrant: 0,
    lifetimeEarned: 0,
    level: 1,
    xpIntoLevel: 0,
    xpPerLevel: XP_PER_LEVEL,
    lastRefillAt: null,
    available: false,
  };
}

async function balanceOf(userId: string): Promise<number> {
  try {
    return (await snapshot(userId)).balance;
  } catch {
    return 0;
  }
}

/* PostgREST's answer when the function is not in the schema
   cache, which is what a missing migration looks like from
   here. */
function missingFunction(message: string): boolean {
  return /could not find the function/i.test(message);
}

/* =========================================================
   FLAGSHIP UNLOCKS

   Buying one of BuildGentic's own agents. The wallet side of it
   lives here beside every other path that moves XP; building
   the agent that results lives in the route, because that is
   agent work rather than money work.
========================================================= */

export interface PurchaseResult {
  ok: boolean;
  /* True when the learner already held this unlock. A success,
     not an error — see purchase_flagship in 0015. */
  alreadyOwned: boolean;
  balance: number;
  /* What was actually charged. Zero on an already-owned
     purchase, so a caller can report "no charge" honestly. */
  cost: number;
}

/*
 * Debits and entitles, atomically.
 *
 * `cost` MUST come from the flagship catalogue, never from a
 * request body. This function cannot check that for itself —
 * the price of 'writing-coach' is not a fact the database knows
 * — so the route is what must not let a caller name their own
 * price, and flagshipPrice() is the only thing it asks.
 */
export async function purchaseFlagship(
  userId: string,
  flagshipId: string,
  cost: number
): Promise<PurchaseResult> {
  const { data, error } = await supabase.rpc("purchase_flagship", {
    p_user_id: userId,
    p_flagship_id: flagshipId,
    p_cost: Math.max(0, Math.round(cost)),
  });

  if (error) {
    if (missingFunction(error.message)) {
      /*
       * Fails CLOSED, unlike `spend`.
       *
       * The difference is what each one is protecting. A
       * missing spend function bounds a teaching allowance and
       * the platform budget still stands behind it, so letting
       * a Lab run through beats a dead product. This grants a
       * permanent entitlement worth up to 200 XP, and handing
       * those out because a migration has not been applied is
       * not recoverable by applying it afterwards.
       */
      throw new AiRuntimeError(
        "internal_error",
        "The Agent Library is not available yet. Please try again later.",
        {
          internalDetail:
            "purchase_flagship is missing — apply supabase/migrations/0015_flagship_agents.sql.",
        }
      );
    }

    throw new AiRuntimeError(
      "internal_error",
      "BuildGentic could not complete that unlock. Please try again.",
      { internalDetail: `purchase_flagship failed: ${error.message}` }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    already_owned?: boolean;
    balance?: number;
    cost?: number;
  } | null;

  return {
    ok: row?.ok === true,
    alreadyOwned: row?.already_owned === true,
    balance: Number(row?.balance ?? 0),
    cost: Number(row?.cost ?? 0),
  };
}

/*
 * Which flagships this learner holds.
 *
 * Read through the service role rather than letting the browser
 * select its own rows, so there is one code path that knows the
 * shape of this table — the same reasoning `snapshot` gives.
 * The RLS policy would allow the browser to read it; that
 * policy exists so the Library CAN show what somebody owns.
 *
 * Returns ids only. The Library resolves them against the
 * catalogue itself, and a receipt is not something the browser
 * needs.
 */
export async function listUnlocks(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("agent_unlocks")
    .select("flagship_id")
    .eq("user_id", userId);

  if (error) {
    if (/could not find the table|does not exist/i.test(error.message)) {
      console.error(
        "[credits] agent_unlocks is missing — apply supabase/migrations/0015_flagship_agents.sql. The Library will show nothing as owned."
      );

      return [];
    }

    throw new AiRuntimeError(
      "internal_error",
      "Unable to load your Agent Library.",
      { internalDetail: `agent_unlocks select failed: ${error.message}` }
    );
  }

  return ((data ?? []) as Array<{ flagship_id: string }>).map(
    (row) => row.flagship_id
  );
}
