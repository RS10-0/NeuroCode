import { supabase } from "../lib/supabase";
import { platformBudget, type DeploymentLimits } from "./config";
import { AiRuntimeError } from "./errors";
import type {
  AiFeature,
  QuotaLimits,
  ResolvedPowerSource,
} from "./types";

/*
 * The gate every model call goes through.
 *
 * The whole decision — count six windows, then insert the row
 * that proves this request happened — is one SQL function, and
 * that is the point. Counting in Node and inserting afterwards
 * gives you two round trips with a gap in between, and ten
 * parallel requests all read "0 used" in that gap. See
 * supabase/migrations/0004_byok_and_platform_budget.sql.
 *
 * Nothing here trusts the client. There is no counter in the
 * browser to be edited, no header to be dropped, and no state in
 * this process to be reset by a restart.
 */

export interface Admission {
  /* The pending ai_usage row. Must be closed by UsageRecorder. */
  usageId: string;
  usedMinute: number;
  usedDay: number;
  inFlight: number;
  tokensToday: number;
}

interface AdmitRow {
  admitted: boolean;
  reason: string | null;
  usage_id: string | null;
  used_minute: number;
  used_day: number;
  in_flight: number;
  tokens_today: number;
  platform_day_requests: number;
  platform_day_tokens: number;
  platform_month_requests: number;
  platform_month_tokens: number;
  deployment_minute: number;
  deployment_day: number;
  deployment_in_flight: number;
  retry_after_seconds: number;
}

/*
 * A deployed agent's own ceiling, alongside its owner's.
 *
 * Passed only by the deployment route. Everything else — the
 * Lab, the Builder, the dev harness — leaves this undefined and
 * the SQL skips those three windows entirely.
 */
export interface DeploymentAdmission {
  id: string;
  limits: DeploymentLimits;
}

/*
 * Turns a refusal into the error the learner sees.
 *
 * Six different refusals on purpose. "Too fast", "that is all
 * for today", "you already have two running", "your prompts are
 * too big" and "BuildGentic's own budget is spent" call for five
 * different reactions from the person reading them, and a single
 * message covering all of them tells them none of it.
 *
 * The platform cases are the important ones to get right: they
 * are not the learner's fault and there is nothing they can do,
 * so they must not read like a telling-off.
 */
function refuse(
  row: AdmitRow,
  limits: QuotaLimits,
  deployment?: DeploymentAdmission
): never {
  const retryAfterSeconds = Math.max(1, row.retry_after_seconds || 1);

  switch (row.reason) {
    /*
     * The three below are the deployment's own ceiling rather
     * than the owner's. They are worth their own codes because
     * they mean something different: nothing about the owner's
     * account is exhausted, one endpoint is simply being called
     * harder than it is allowed to be.
     *
     * These messages are written for the owner, who is the only
     * person who can act on them. The deployment route maps
     * every one of them down to a generic 429 before it reaches
     * an external caller, because the figures below describe
     * somebody else's account.
     */
    case "deployment_daily_exceeded":
      throw new AiRuntimeError(
        "deployment_quota_exceeded",
        `This deployment has used all ${
          deployment?.limits.requestsPerDay ?? 0
        } of its requests for today. Its allowance refills over the next 24 hours.`,
        { retryAfterSeconds }
      );

    case "deployment_rate_limited":
      throw new AiRuntimeError(
        "deployment_rate_limited",
        `This deployment is limited to ${
          deployment?.limits.requestsPerMinute ?? 0
        } requests a minute. Wait ${retryAfterSeconds}s and try again.`,
        { retryAfterSeconds }
      );

    case "deployment_too_many_concurrent":
      throw new AiRuntimeError(
        "deployment_too_many_concurrent",
        `This deployment already has ${
          deployment?.limits.maxConcurrent ?? 0
        } requests running. Wait for one to finish.`,
        { retryAfterSeconds }
      );

    case "platform_monthly_exceeded":
      throw new AiRuntimeError(
        "platform_budget_exceeded",
        "BuildGentic's AI budget for this month is spent. This is a limit on BuildGentic, not on your account — it resets at the start of next month.",
        { retryAfterSeconds }
      );

    case "platform_daily_exceeded":
      throw new AiRuntimeError(
        "platform_budget_exceeded",
        "BuildGentic's AI budget for today is spent. This is a limit on BuildGentic, not on your account — try again tomorrow, or connect your own API key.",
        { retryAfterSeconds }
      );

    case "quota_exceeded":
      throw new AiRuntimeError(
        "quota_exceeded",
        `You have used all ${limits.requestsPerDay} AI requests for today. Your allowance refills over the next 24 hours.`,
        { retryAfterSeconds }
      );

    case "token_quota_exceeded":
      throw new AiRuntimeError(
        "token_quota_exceeded",
        `You have used your ${limits.tokensPerDay.toLocaleString()}-token allowance for today. Shorter prompts go further — it refills over the next 24 hours.`,
        { retryAfterSeconds }
      );

    case "rate_limited":
      throw new AiRuntimeError(
        "rate_limited",
        `That is more than ${limits.requestsPerMinute} requests in a minute. Wait ${retryAfterSeconds}s and try again.`,
        { retryAfterSeconds }
      );

    case "too_many_concurrent":
      throw new AiRuntimeError(
        "too_many_concurrent",
        `You already have ${limits.maxConcurrent} AI requests running. Wait for one to finish.`,
        { retryAfterSeconds }
      );

    default:
      /* A reason the SQL grew that this file has not learned. */
      throw new AiRuntimeError(
        "rate_limited",
        "You have hit an AI usage limit. Please try again shortly.",
        { retryAfterSeconds, internalDetail: `Unmapped reason: ${row.reason}` }
      );
  }
}

export interface AdmitInput {
  userId: string;
  source: ResolvedPowerSource;
  model: string;
  feature: AiFeature;
  /*
   * What this request could cost, in tokens: estimated input
   * plus the maximum output allowed. Token budgets have to be
   * checked against the ceiling, not the outcome, because the
   * outcome is not knowable until the money is already spent.
   */
  estimatedTokens: number;
  /* The BYOK key paying, when one is. */
  keyId?: string;
  providerId: string;
  /* The saved agent this call belongs to, when one does. */
  agentId?: string;
  /* The deployment answering, when this call arrived from
     outside BuildGentic. Adds its own windows to the gate. */
  deployment?: DeploymentAdmission;
}

export async function admit(input: AdmitInput): Promise<Admission> {
  const { source } = input;

  const { data, error } = await supabase.rpc("ai_usage_admit", {
    p_user_id: input.userId,
    p_quota_key: source.quotaKey,
    p_power_source_kind: source.kind,
    p_provider_id: input.providerId,
    p_model: input.model,
    p_feature: input.feature,
    p_key_id: input.keyId ?? null,
    p_estimated_tokens: Math.max(0, Math.round(input.estimatedTokens)),

    p_limit_per_minute: source.limits.requestsPerMinute,
    p_limit_per_day: source.limits.requestsPerDay,
    p_limit_concurrent: source.limits.maxConcurrent,
    p_limit_tokens_per_day: source.limits.tokensPerDay,

    /*
     * Sent on every call, ignored by the SQL unless the kind is
     * 'platform'. A learner spending their own provider credit
     * must not be stopped because BuildGentic's budget ran out.
     */
    p_platform_daily_requests: platformBudget.dailyRequests,
    p_platform_daily_tokens: platformBudget.dailyTokens,
    p_platform_monthly_requests: platformBudget.monthlyRequests,
    p_platform_monthly_tokens: platformBudget.monthlyTokens,

    p_agent_id: input.agentId ?? null,

    /*
     * Null for every call that did not arrive through a
     * deployment, in which case the SQL reads none of the three
     * deployment windows at all.
     */
    p_deployment_id: input.deployment?.id ?? null,
    p_deployment_limit_per_minute:
      input.deployment?.limits.requestsPerMinute ?? 0,
    p_deployment_limit_per_day: input.deployment?.limits.requestsPerDay ?? 0,
    p_deployment_limit_concurrent: input.deployment?.limits.maxConcurrent ?? 0,
  });

  if (error) {
    /*
     * A missing migration, diagnosed rather than left as a
     * generic failure.
     *
     * Every capability that adds a spend also adds a word to
     * `ai_usage.feature`'s CHECK constraint, and the migration
     * that widens it is applied by hand. Skip one and every
     * request for that capability fails inside this insert with
     * a Postgres message about a constraint — which reads like a
     * database fault rather than like a step somebody has not
     * done yet.
     *
     * The learner still sees the generic sentence: this is not
     * their problem and there is nothing they can do. The log
     * line names the fix.
     */
    if (/ai_usage_feature_check|violates check constraint/i.test(error.message)) {
      console.error(
        `[ai] ai_usage rejected feature "${input.feature}". The migration that adds it has not been applied — run the latest file in supabase/migrations against this project.`
      );
    }

    /*
     * Failing closed. If the quota table cannot be reached there
     * is no way to know whether this request is the first or the
     * thousandth, and guessing "first" is how a provider bill
     * gets interesting.
     */
    throw new AiRuntimeError(
      "internal_error",
      "BuildGentic could not check your AI usage allowance. Please try again.",
      { internalDetail: `ai_usage_admit failed: ${error.message}` }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as AdmitRow | null;

  if (!row) {
    throw new AiRuntimeError(
      "internal_error",
      "BuildGentic could not check your AI usage allowance. Please try again.",
      { internalDetail: "ai_usage_admit returned no row." }
    );
  }

  if (!row.admitted || !row.usage_id) {
    refuse(row, source.limits, input.deployment);
  }

  return {
    usageId: row.usage_id,
    usedMinute: row.used_minute,
    usedDay: row.used_day,
    inFlight: row.in_flight,
    tokensToday: Number(row.tokens_today ?? 0),
  };
}

/* =========================================================
   SNAPSHOT

   Read-only. What the usage meter shows, taken from the same
   rows the gate counts, so the two can never disagree.
========================================================= */

export interface UsageSnapshot {
  usedMinute: number;
  usedDay: number;
  inFlight: number;
  inputTokens: number;
  outputTokens: number;
  tokensToday: number;
  platformDayRequests: number;
  platformDayTokens: number;
  platformMonthRequests: number;
  platformMonthTokens: number;
}

export async function snapshot(quotaKey: string): Promise<UsageSnapshot> {
  const { data, error } = await supabase.rpc("ai_usage_snapshot", {
    p_quota_key: quotaKey,
  });

  if (error) {
    throw new AiRuntimeError(
      "internal_error",
      "Unable to load your AI usage.",
      { internalDetail: `ai_usage_snapshot failed: ${error.message}` }
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    number
  > | null;

  const read = (key: string) => Number(row?.[key] ?? 0);

  return {
    usedMinute: read("used_minute"),
    usedDay: read("used_day"),
    inFlight: read("in_flight"),
    inputTokens: read("input_tokens"),
    outputTokens: read("output_tokens"),
    tokensToday: read("tokens_today"),
    platformDayRequests: read("platform_day_requests"),
    platformDayTokens: read("platform_day_tokens"),
    platformMonthRequests: read("platform_month_requests"),
    platformMonthTokens: read("platform_month_tokens"),
  };
}
