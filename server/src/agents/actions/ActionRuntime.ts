import { actionLimitsFor } from "../../ai/config";
import { AiRuntimeError, normalizeError } from "../../ai/errors";
import { admit } from "../../ai/QuotaGuard";
import { finish } from "../../ai/UsageRecorder";
import type { ActionToolId, ResolvedPowerSource } from "../../ai/types";
import { toolFor, type ToolContext, type ToolOutcome } from "./catalog";

/*
 * Every tool an agent runs goes through here.
 *
 * Same shape, same order, same reasons as WebSearchRuntime:
 *
 *   resolve who is paying
 *   → take a quota slot
 *   → do the work, timed
 *   → always close the usage row
 *
 * Nothing above this file counts a quota or writes a usage row
 * for a tool. Running code and calling an API are not model
 * calls, but they are both this server spending real resources
 * on a learner's behalf, and there is no version of this
 * feature where that skips the gate a Lab prompt cannot.
 */

/* =========================================================
   THE QUOTA KEY

   `action:platform:<userId>`, derived from the source's own
   key rather than rebuilt from the user id, so the split the
   power source encodes is inherited instead of restated —
   the trick searchSource and embeddingSource both play.

   Its own windows because an action-backed turn is up to nine
   calls where a plain one is a single call. See the note on
   actionLimitsFor in config.ts.
========================================================= */

export function actionSource(source: ResolvedPowerSource): ResolvedPowerSource {
  return {
    ...source,
    quotaKey: `action:${source.quotaKey}`,
    limits: actionLimitsFor(),
  };
}

export interface RunToolInput extends ToolContext {
  tool: ActionToolId;
  args: Record<string, unknown>;
  source: ResolvedPowerSource;
}

/*
 * One tool: admitted, timed, run, recorded.
 *
 * Does NOT throw for a tool that failed. A tool that could not
 * do its job produces an outcome the model reads and can react
 * to, which is most of what makes this a loop rather than a
 * pipeline — see renderFailure in protocol.ts. It throws only
 * for a refusal that happened before the tool was reached: a
 * quota, or a tool that does not exist.
 */
export async function runTool(input: RunToolInput): Promise<ToolOutcome> {
  const spec = toolFor(input.tool);

  if (!spec) {
    /* Unreachable through the parser, which checks the same
       registry. Here because "unreachable" and "impossible"
       are different words. */
    throw new AiRuntimeError("invalid_request", "That tool does not exist.");
  }

  const admission = await admit({
    userId: input.userId,
    source: input.source,
    /*
     * `model` and `provider_id` on a tool row.
     *
     * ai_usage is the ledger of what somebody's turn cost, and
     * a sandbox run is part of that even though no model ran.
     * So the row says what it actually was — `tool:run_code`
     * where a model id would go — rather than borrowing the
     * answering model's id and making the ledger read as if
     * the agent answered twice. The same honesty a
     * `web-search` row carries.
     */
    model: `tool:${input.tool}`,
    providerId: "neurolink",
    feature: "agent_action",
    /* A tool spends no model tokens. The request windows are
       what bound it. */
    estimatedTokens: 0,
    agentId: input.agentId,
    /*
     * Deliberately no `deployment`, for the reason
     * WebSearchRuntime states: the request that provoked this
     * already took a slot from the deployment's windows when
     * it was admitted to answer, and charging its tools there
     * as well would quietly redefine "20 requests a minute" as
     * "five, if the agent does anything".
     */
  });

  const startedAt = Date.now();

  let failure: AiRuntimeError | null = null;
  let outcome: ToolOutcome | null = null;

  try {
    /*
     * EVERY FIELD OF ToolContext, NOT A HAND-PICKED THREE.
     *
     * This used to forward `userId`, `agentId` and `signal`
     * and silently drop `runId` and `turn`, which
     * `RunToolInput` had been carrying since Phase 3. Two
     * things were broken by that and neither looked like a bug
     * from outside:
     *
     *   `turn` was always undefined, so the per-turn ceilings
     *   on documents and store writes never applied — the tools
     *   check `context.turn && ...`, which is false when there
     *   is no budget, so a turn could write as many as the step
     *   limit allowed.
     *
     *   `runId` was always absent, so a document made during a
     *   scheduled run was written with a null run id — and
     *   notify.ts finds a notification's attachments BY run id.
     *   Every scheduled email that should have carried a file
     *   went out without one.
     *
     * Spreading the input is what stops it happening again: a
     * field added to ToolContext now arrives without this
     * function having to be told about it.
     */
    const { tool, args, source, ...context } = input;

    /* The three fields that are this function's business rather
       than a tool's. `void` rather than a rest-sibling ignore,
       which is the idiom runner.ts already uses for the same
       shape of discard. */
    void tool;
    void args;
    void source;

    outcome = await spec.run(input.args, context);
  } catch (error) {
    /*
     * A tool that threw rather than returning a failure. Every
     * tool in the catalogue is written to return one, so this
     * is a bug in a tool rather than an ordinary outcome — but
     * it must not take the turn down with it. Recorded as a
     * failure on the usage row, handed to the model as a
     * failed step.
     */
    failure = normalizeError(error);

    if (failure.internalDetail) {
      console.error(`[actions] ${input.tool} ${failure.code}: ${failure.internalDetail}`);
    }

    outcome = {
      ok: false,
      output: "",
      error: failure.message,
      summary: "the tool failed unexpectedly",
      ms: Date.now() - startedAt,
    };
  } finally {
    /* Always. A pending row holds one of this learner's action
       concurrency slots until the reaper sweeps it. */
    await finish(admission.usageId, {
      usage: { inputTokens: 0, outputTokens: 0, reported: true },
      latencyMs: Date.now() - startedAt,
      ok: failure === null && outcome?.ok === true,
      errorCode: failure?.code,
    });
  }

  return outcome;
}
