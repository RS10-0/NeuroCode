import { authHeaders } from "./api";

/*
 * The learner's XP wallet, as the browser sees it.
 *
 * READ ONLY, and that is the whole design rather than an
 * omission. Every number here is advisory: the balance is a
 * meter, and the cost is a label next to a button. Neither
 * decides anything.
 *
 * What decides is `spend_credits`, running inside the request
 * the learner just made, on a row nothing in this tab can
 * write. If the two ever disagree — a second tab spent the last
 * of it, the day rolled over mid-session — the server wins and
 * the UI corrects itself on the next refresh.
 *
 * That distinction is worth being clear about because the
 * client-side check is genuinely useful and genuinely not
 * enforcement: it exists so a learner with 1 XP sees a disabled
 * Run button and a sentence explaining why, instead of pressing
 * it and waiting for a round trip to tell them no.
 */

export interface CreditCosts {
  lab: number;
  agentTest: number;
  agentPublic: number;
}

export interface CreditEarnings {
  lessonComplete: number;
  courseComplete: number;
  dailyLogin: number;
  streakBonus: number;
}

/* What a capability adds to the turn that used it, charged once
   per turn on top of the turn's own cost. */
export interface CreditSurcharges {
  webSearch: number;
  fileAnalysis: number;
}

export interface CreditState {
  /* False when the server has no wallet table yet. The meter
     hides rather than inventing a number nothing enforces. */
  available: boolean;
  balance: number;
  /*
   * The ceiling the balance stops at, NOT a daily figure it
   * resets to. Since the wallet became accumulating, XP carries
   * over from day to day and stops here — which is what makes
   * saving for a Library agent possible.
   */
  maxBalance: number;
  /* What arrives on a login. */
  dailyGrant: number;
  lastRefillAt: string | null;

  /*
   * Level, and how far through it the learner is.
   *
   * Derived server-side from everything they have ever earned,
   * which is a number this type deliberately does not carry: the
   * UI shows a level and a progress figure, and has no business
   * drawing its own conclusions from a running total.
   *
   * It never goes down. Spending 200 XP on a Library agent
   * cannot cost somebody a level they earned.
   */
  level: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  xpToNextLevel: number;

  costs: CreditCosts;
  surcharges: CreditSurcharges;
  earnings: CreditEarnings;
}

export async function fetchCredits(
  signal?: AbortSignal
): Promise<CreditState> {
  const response = await fetch("/api/credits", {
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) {
    throw new Error("Unable to load your XP.");
  }

  return (await response.json()) as CreditState;
}

export interface DailyClaim {
  granted: number;
  /* The ten-day streak bonus, on the day it lands. Reported
     apart from the login grant so it can be celebrated rather
     than showing one larger number with no explanation. */
  bonus: number;
  balance: number;
  streak: number;
}

/*
 * Claims today's login XP.
 *
 * Called on every mount, deliberately. The server grants it at
 * most once per UTC day against a unique index, so asking
 * repeatedly is free and cheaper than any scheme this tab could
 * use to remember whether it had already asked — a flag in
 * localStorage would be wrong the moment somebody opened a
 * second tab or a second device.
 *
 * `granted` is 0 on every call after the first of the day.
 */
export async function claimDailyBonus(
  signal?: AbortSignal
): Promise<DailyClaim> {
  const empty: DailyClaim = { granted: 0, bonus: 0, balance: 0, streak: 0 };

  const response = await fetch("/api/credits/daily", {
    method: "POST",
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) {
    return empty;
  }

  return (await response.json()) as DailyClaim;
}

/* =========================================================
   THE CEILING

   A learner whose balance is full stops banking XP. Grants
   clamp at `maxBalance`, so a lesson finished at 300/300 pays
   nothing spendable — the level progress still lands, but the
   XP itself is gone.

   That is the design, not a bug: the cap exists so XP is spent
   rather than hoarded. But it happens SILENTLY, and the silence
   is the problem. A learner cannot tell the difference between
   "I earned nothing" and "I earned it and it evaporated", and
   the second one feels like being cheated.

   So the UI says so, and says it as a prompt rather than as a
   loss: you are full, go spend some.
========================================================= */

export type CapState =
  /* Room to spare. Nothing to say. */
  | "fine"
  /* Full. Anything earned from here is discarded. */
  | "full"
  /* Not full yet, but tomorrow's login grant will not fit
     entirely. The last moment a warning is still actionable. */
  | "near";

/*
 * How close to the ceiling this learner is.
 *
 * "Near" is defined as "the next daily grant would overflow"
 * rather than as a percentage, and the difference matters. A
 * percentage is a number somebody picked; this is the actual
 * condition under which a learner starts losing XP, so the
 * warning appears exactly when it becomes true and not a day
 * early or late. It also stays correct for a learner given a
 * different allowance or ceiling, which a hardcoded 270 would
 * not.
 *
 * "fine" whenever the wallet is unknown or unavailable — the
 * same optimism `canAfford` applies, and for the same reason:
 * nagging somebody about a limit we cannot read is worse than
 * saying nothing.
 */
export function capStateOf(credits: CreditState | null): CapState {
  if (!credits || !credits.available || credits.maxBalance <= 0) {
    return "fine";
  }

  if (credits.balance >= credits.maxBalance) {
    return "full";
  }

  return credits.balance + credits.dailyGrant > credits.maxBalance
    ? "near"
    : "fine";
}
