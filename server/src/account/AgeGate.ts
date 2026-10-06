import { supabase } from "../lib/supabase";
import {
  mayPublish,
  mayRecordAge,
  mayUseTrainingProviders,
  mustWithdrawPublic,
  isBlocked,
  statusOf,
  type AgeBand,
  type AgeStatus,
  type ConsentStatus,
  type ScopeFacts,
} from "./rules";

/*
 * Reading and recording an account's age band.
 *
 * Every decision is in rules.ts; this file is the database half.
 * It writes user_account_scope with the service role — the only
 * writer that table has ever been allowed (0020) — and keeps a
 * short cache so that asking "is this account blocked?" on every
 * authenticated request costs a lookup a minute, not a lookup a
 * request.
 */

export class AccountError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AccountError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/* =========================================================
   READING, WITH A CACHE
========================================================= */

const CACHE_MS = 60_000;

const cache = new Map<string, { facts: ScopeFacts | null; at: number }>();

/*
 * The account's recorded facts, or null if it has never
 * answered. THROWS on a database error — callers choose which
 * way to fail, because the right answer differs: blocking fails
 * open, publishing fails closed.
 */
export async function scopeFactsOf(userId: string): Promise<ScopeFacts | null> {
  const hit = cache.get(userId);

  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.facts;
  }

  const { data, error } = await supabase
    .from("user_account_scope")
    .select("age_band, consent_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`age lookup failed: ${error.message}`);
  }

  const row = data as { age_band: AgeBand | null; consent_status: ConsentStatus | null } | null;

  const facts = row?.age_band
    ? { ageBand: row.age_band, consentStatus: row.consent_status }
    : null;

  cache.set(userId, { facts, at: Date.now() });

  /* Bounded, so a long-running instance does not hold every
     account it has ever seen. Oldest out first. */
  if (cache.size > 5_000) {
    const oldest = cache.keys().next().value;

    if (oldest) {
      cache.delete(oldest);
    }
  }

  return facts;
}

export function forgetAccount(userId: string): void {
  cache.delete(userId);
}

export async function ageStatusOf(userId: string): Promise<{
  status: AgeStatus;
  band: AgeBand | null;
}> {
  forgetAccount(userId);
  const facts = await scopeFactsOf(userId);

  return { status: statusOf(facts), band: facts?.ageBand ?? null };
}

/*
 * Is this account shut out until a parent answers?
 *
 * FAILS OPEN. A database hiccup must not turn into every learner
 * on the site being refused at once — and the accounts this
 * exists for are already behind the app's own gate, which keeps
 * a pending learner on the waiting screen regardless.
 */
export async function accountBlocked(userId: string): Promise<boolean> {
  try {
    return isBlocked(await scopeFactsOf(userId));
  } catch (error) {
    console.error(`[age] ${describe(error)} — not blocking ${userId}`);
    return false;
  }
}

/*
 * May this account create something strangers can reach?
 *
 * FAILS CLOSED, the opposite of the above and on purpose: the
 * cost of a wrong "no" is a learner retrying in a minute, the
 * cost of a wrong "yes" is a child's page on the internet.
 */
export async function accountMayPublish(userId: string): Promise<boolean> {
  try {
    return mayPublish(await scopeFactsOf(userId));
  } catch (error) {
    console.error(`[age] ${describe(error)} — refusing publish for ${userId}`);
    return false;
  }
}

/*
 * May this account's prompts reach a provider that trains on
 * them? FAILS CLOSED: a lookup that errors routes the request to
 * the providers that do not train, which costs capacity for a
 * moment and never costs a child's privacy.
 */
export async function accountMayUseTrainingProviders(userId: string): Promise<boolean> {
  try {
    return mayUseTrainingProviders(await scopeFactsOf(userId));
  } catch (error) {
    console.error(`[age] ${describe(error)} — keeping ${userId} on non-training providers`);
    return false;
  }
}

/*
 * Should something this account already published stop
 * answering? Only a recorded under-13 answer says yes, and a
 * failed lookup says no — see mustWithdrawPublic for why the
 * default runs this way.
 */
export async function ownerMustWithdraw(userId: string): Promise<boolean> {
  try {
    return mustWithdrawPublic(await scopeFactsOf(userId));
  } catch (error) {
    console.error(`[age] ${describe(error)} — leaving ${userId}'s public pages up`);
    return false;
  }
}

/* =========================================================
   RECORDING
========================================================= */

/*
 * Write the band, once.
 *
 * Also writes page_context_scope, which the extension's gate
 * (agents/extension/AccountScope.ts) has been reading since 0020
 * with nothing to fill it: denied under 13, allowed otherwise.
 *
 * The consent request itself is consent.ts's job; this only
 * records that one is owed.
 */
export async function writeAgeBand(
  userId: string,
  band: AgeBand
): Promise<void> {
  forgetAccount(userId);

  const existing = await scopeFactsOf(userId);

  if (!mayRecordAge(existing)) {
    throw new AccountError(
      409,
      "already_answered",
      "This account's age is already on record."
    );
  }

  const under13 = band === "under_13";
  const now = new Date().toISOString();

  const { error } = await supabase.from("user_account_scope").upsert(
    {
      user_id: userId,
      age_band: band,
      consent_status: under13 ? "pending" : "not_required",
      page_context_scope: under13 ? "denied" : "allowed",
      source: "signup_age_gate",
      decided_at: now,
      updated_at: now,
    },
    { onConflict: "user_id" }
  );

  forgetAccount(userId);

  if (error) {
    throw new Error(`age write failed: ${error.message}`);
  }
}

export async function writeConsentGranted(userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_account_scope")
    .update({ consent_status: "granted", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("age_band", "under_13");

  forgetAccount(userId);

  if (error) {
    throw new Error(`consent write failed: ${error.message}`);
  }
}

/*
 * Delete the account and everything it owns.
 *
 * Every table holding a user's rows references auth.users with
 * ON DELETE CASCADE (checked across all migrations when this was
 * written), so deleting the auth user is the whole job.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(userId);

  forgetAccount(userId);

  if (error) {
    throw new Error(`account delete failed: ${error.message}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
