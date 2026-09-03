import { supabase } from "../lib/supabase";
import type { AiErrorCode } from "./errors";
import type { TokenUsage } from "./types";

/*
 * Closes the ai_usage row the quota gate opened.
 *
 * Called from a `finally`, always — a clean answer, a provider
 * outage, a timeout and a learner pressing stop all end here.
 * A row that is never closed keeps counting against that user's
 * concurrency limit until the reaper in ai_usage_admit sweeps
 * it, so "always" is not a stylistic preference.
 *
 * What gets stored is deliberately narrow: who, which model, how
 * many tokens, how long, and whether it worked. No prompt, no
 * completion, no system instruction. Phase 2.1 has no
 * requirement to keep conversations, and a table of everything
 * every learner has ever typed into an AI is a liability nobody
 * asked for.
 */

export interface UsageOutcome {
  usage: TokenUsage;
  latencyMs: number;
  ok: boolean;
  errorCode?: AiErrorCode;
  /*
   * Who actually served this, once it is known.
   *
   * Admission has to open the row before any provider has been
   * contacted, so what it wrote was a prediction — the first
   * candidate in the cascade. These correct it, and they are the
   * only record anywhere of a fallback having fired. Omitted
   * when nothing answered, in which case the prediction is as
   * true as anything else.
   */
  providerId?: string;
  model?: string;
}

export async function finish(
  usageId: string,
  outcome: UsageOutcome
): Promise<void> {
  const core = {
    p_usage_id: usageId,
    p_input_tokens: Math.max(0, Math.round(outcome.usage.inputTokens)),
    p_output_tokens: Math.max(0, Math.round(outcome.usage.outputTokens)),
    p_latency_ms: Math.max(0, Math.round(outcome.latencyMs)),
    p_ok: outcome.ok,
    p_error_code: outcome.errorCode ?? null,
  };

  let { error } = await supabase.rpc("ai_usage_finish", {
    ...core,
    /* Null leaves whatever admission predicted. */
    p_provider_id: outcome.providerId ?? null,
    p_model: outcome.model ?? null,
  });

  /*
   * The migration that widened this function is applied by hand,
   * so there is a real window where the code knows about
   * p_provider_id and the database does not. PostgREST answers
   * that with "could not find the function ... in the schema
   * cache" rather than anything more specific.
   *
   * Closing the row matters more than recording which provider
   * closed it: a row left pending holds one of this learner's
   * concurrency slots until the reaper sweeps it ten minutes
   * later, so the next few requests get worse. So fall back to
   * the six-argument call and say once, loudly, what is missing.
   */
  if (error && /could not find the function/i.test(error.message)) {
    console.error(
      "[ai] ai_usage_finish does not accept p_provider_id yet — apply supabase/migrations/0011_user_credits_and_byok_teardown.sql. Closing the row without it."
    );

    ({ error } = await supabase.rpc("ai_usage_finish", core));
  }

  if (error) {
    /*
     * Logged, not thrown. This runs after the answer has already
     * been streamed to the learner; turning a bookkeeping
     * failure into a visible error would break a request that
     * actually succeeded. The reaper handles the row.
     */
    console.error(
      `[ai] could not close usage row ${usageId}: ${error.message}`
    );
  }
}
