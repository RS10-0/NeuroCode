import { schedule as scheduleConfig, scheduleLimitsFor } from "../../ai/config";
import { normalizeError } from "../../ai/errors";
import { runChat } from "../../ai/AiRuntime";
import type {
  DraftedEmailEvent,
  GeneratedDocument,
  RuntimeStreamEvent,
} from "../../ai/types";
import { costOf, SURCHARGES } from "../../credits/costs";
import { snapshot } from "../../credits/CreditStore";
import { getAgent, listKnowledge } from "../AgentStore";

import { nextRunAt, type Cadence } from "./cadence";
import { inspect } from "./confabulation";
import { buildScheduledChat } from "./scheduledRequest";
import {
  markVerified,
  settleRun,
  startRun,
  type RunOutcome,
  type RunTrigger,
  type SettleResult,
  type TraceEntry,
} from "./ScheduleStore";

/*
 * One scheduled run, start to finish.
 *
 * This is the file that replaces the person. Everything an
 * interactive turn gets from having a learner in front of it —
 * a reader who notices a failure, a tab whose closing cancels
 * the request, somebody who disbelieves an answer with no
 * working behind it — has to happen here instead, as code, and
 * be written down in a row rather than noticed.
 *
 * What it deliberately does NOT do is run the agent. That is
 * `runChat`, unchanged, the same function the Lab, the Test
 * panel, a deployed agent and a published page all reach. This
 * file decides whether to call it, collects what it emitted, and
 * decides what the result was called.
 */

export interface ScheduledRunInput {
  scheduleId: string;
  agentId: string;
  userId: string;
  task: string;
  trigger: RunTrigger;
  /* Present for a claimed schedule; the manual path has no
     cadence to advance. */
  cadence?: Cadence;
  hourLocal?: number;
  weekdayLocal?: number | null;
  timezone?: string;
  missedRuns?: number;
}

export interface ScheduledRunReport {
  runId: string | null;
  outcome: RunOutcome;
  detail: string | null;
  /* What the settle decided — null when the row was already
     settled by the reaper, in which case somebody else has
     already dealt with it and this run must not notify. */
  settled: SettleResult | null;
  output: string;
  claimPhrase: string | null;
  toolCalls: number;
  /*
   * The files this run produced.
   *
   * Carried on the report so the notifier can name them without
   * a second query, and — the part that matters — so the line
   * in the email that says what is attached is built from what
   * the run ACTUALLY MADE rather than from what its answer
   * claims. An agent that says it attached a report and did
   * not produces an email with an empty list beside its own
   * prose.
   */
  documents: GeneratedDocument[];
  /*
   * The replies this run drafted, on the report for exactly the
   * reason the documents are — and with more riding on it.
   *
   * The notification says what happened while nobody was
   * watching, and it is built from THIS rather than from the
   * answer. So a run whose agent wrote "I replied to your
   * professor" but drafted nothing produces an email that lists
   * nothing; one that actually drafted three names three, each
   * still waiting for approval.
   *
   * A person reading that on a phone at seven in the morning is
   * the reader this capability's honesty is for.
   */
  drafts: DraftedEmailEvent[];
}

/* =========================================================
   PRECONDITIONS

   Checked before a run row is opened, because a run that was
   never attempted is not a run. Recording one would put a
   `skipped` row in the history for every six hours a learner
   spends below the XP reserve, and a history that is mostly
   non-events is a history nobody reads.

   The exception is a precondition that only a run row can
   explain — see the reserve below.
========================================================= */

interface Precondition {
  ok: boolean;
  detail?: string;
}

async function preflight(input: ScheduledRunInput): Promise<Precondition> {
  /*
   * The XP reserve, and it applies to SCHEDULED runs only.
   *
   * Automation must never spend the last XP a learner needs for
   * a lesson: this is a teaching tool, and the background thing
   * yields to the foreground thing. But a manual preview IS the
   * foreground thing — somebody is sitting there having pressed
   * a button — so holding it to a reserve meant for automation
   * would refuse a learner their own agent while telling them
   * they have credit.
   */
  if (input.trigger === "schedule") {
    const wallet = await snapshot(input.userId);

    if (wallet.balance < scheduleConfig.xpReserve) {
      return {
        ok: false,
        detail: "out_of_xp",
      };
    }
  }

  return { ok: true };
}

/* =========================================================
   THE RUN
========================================================= */

export async function runScheduled(
  input: ScheduledRunInput
): Promise<ScheduledRunReport> {
  const startedAt = Date.now();

  /*
   * The agent, and the one condition that disables rather than
   * skips.
   *
   * A missing agent should be unreachable — 0017's composite
   * foreign key cascades, so deleting an agent deletes its
   * schedules — which is exactly why it is handled rather than
   * assumed. "Unreachable" and "impossible" are different words,
   * and a schedule pointed at nothing would otherwise fail
   * forever, three at a time, until the breaker caught it and
   * told the owner the wrong thing.
   */
  const agent = await getAgent(input.userId, input.agentId).catch(() => null);

  if (!agent) {
    return await finishWithoutRunning(input, "skipped", "agent_unavailable");
  }

  const ready = await preflight(input);

  if (!ready.ok) {
    return await finishWithoutRunning(input, "skipped", ready.detail ?? null);
  }

  const knowledge = await listKnowledge(input.userId, input.agentId).catch(
    () => []
  );

  let chat: ReturnType<typeof buildScheduledChat>;

  try {
    chat = buildScheduledChat({ agent, knowledge, task: input.task });
  } catch (error) {
    /*
     * composeAgentSystem throws when the owner's instructions
     * and knowledge no longer fit the system budget. That is a
     * real condition the owner has to be told about, so it is a
     * failed run rather than a silently shorter prompt.
     */
    const failure = normalizeError(error);

    return await finishWithoutRunning(input, "infra_failure", failure.code);
  }

  const runId = await startRun({
    scheduleId: input.scheduleId,
    agentId: input.agentId,
    userId: input.userId,
    trigger: input.trigger,
    ...(input.missedRuns !== undefined ? { missedRuns: input.missedRuns } : {}),
  });

  /* ---------------------------------------------------------
     THE DEADLINE

     The bound that unattended execution needs and interactive
     execution gets for free. A browser aborts its request when
     the tab closes; nothing closes a scheduled run's tab. This
     aborts the same AbortController the sandbox and the HTTP
     client already accept, so a run that hangs inside a tool
     stops there rather than holding its lease to expiry.
     --------------------------------------------------------- */

  const deadline = new AbortController();

  const timer = setTimeout(() => {
    deadline.abort();
  }, Math.max(5_000, scheduleConfig.runTimeoutMs));

  const collected = collector();

  let thrown: string | null = null;

  try {
    for await (const event of runChat({
      userId: input.userId,
      signal: deadline.signal,
      body: chat.body,
      /*
       * The run this turn's files belong to.
       *
       * Set here and nowhere else. It is what lets the mail
       * outbox find a run's attachments by run id, so
       * agent_notifications needs no document column of its
       * own — and it is why a Test panel turn, which has no run
       * row, produces a document carrying a null instead.
       */
      documentRunId: runId,
      quotaScope: {
        /*
         * Its own windows, pointing in two directions at once.
         * A learner mid-Lab-session must not be refused because
         * a background schedule took the minute's slot; a
         * schedule must not fire faster than its own window
         * allows merely because the learner was idle.
         */
        prefix: "sched",
        limits: scheduleLimitsFor(),
      },
      ...(chat.body.memory
        ? {
            memoryScope: {
              kind: "owner" as const,
              userId: input.userId,
              agentId: input.agentId,
            },
            /* Recall, never record. See the note on the option. */
            memoryReadOnly: true,
          }
        : {}),
      /* No fileScope: a timer has nothing attached, and must not
         reach what the owner attached in their browser. */
    })) {
      collected.take(event);
    }
  } catch (error) {
    const failure = normalizeError(error);

    thrown = failure.code;

    if (failure.internalDetail) {
      console.error(
        `[schedule] run ${runId} ${failure.code}: ${failure.internalDetail}`
      );
    }
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;
  const result = collected.done();

  /* ---------------------------------------------------------
     WHAT TO CALL IT

     Order matters, and it is most-serious-first.

     A run can be more than one of these at once — it can hit
     the step limit AND claim results it never got — and the
     name it is filed under decides what the owner is told and
     whether the breaker moves. Confabulation outranks the step
     limit because "it ran out of room" is a task to edit and
     "it told you something that did not happen" is a reason to
     stop trusting the output.
     --------------------------------------------------------- */

  const verdict = inspect({
    text: result.output,
    evidence: {
      calls: result.toolCalls,
      succeeded: result.toolSucceeded,
      failed: result.toolFailures,
    },
    toolsAvailable: chat.toolsAvailable,
  });

  let outcome: RunOutcome;
  let detail: string | null = null;

  if (thrown) {
    outcome = "infra_failure";
    detail = thrown;
  } else if (verdict.confabulated) {
    outcome = "confabulated";
    detail = "claimed_without_evidence";
  } else if (result.limitReason) {
    outcome = "limit_reached";
    detail = result.limitReason;
  } else if (result.output.trim().length === 0) {
    /*
     * A turn that ended cleanly and said nothing.
     *
     * Called an infra_failure rather than a success, because it
     * is one from the only perspective that matters here: the
     * schedule exists to deliver something, and an empty
     * delivery on a timer is a fault however politely the
     * provider ended the stream. Interactively a learner sees a
     * blank reply and presses Run again; nobody presses Run
     * here.
     */
    outcome = "infra_failure";
    detail = "empty_response";
  } else {
    outcome = "succeeded";
  }

  /* ---------------------------------------------------------
     THE NEXT DUE TIME

     Computed here, in TypeScript, and written by the settle.
     The claim already pushed `next_run_at` forward by a plain
     interval so this row cannot fire again immediately; this
     replaces that floor with the value that keeps a daily digest
     arriving at nine in the morning through a clock change.

     Null for a manual run, which has no cadence to advance, and
     null for a run whose settle is about to disable the
     schedule — the SQL clears it in that case anyway.
     --------------------------------------------------------- */

  const due =
    input.trigger === "schedule" && input.cadence
      ? nextRunAt({
          cadence: input.cadence,
          hourLocal: input.hourLocal ?? 9,
          weekdayLocal: input.weekdayLocal ?? null,
          timezone: input.timezone ?? "UTC",
          from: new Date(),
        })
      : null;

  const output = result.output.slice(0, scheduleConfig.maxOutputChars);

  const settled = await settleRun({
    runId,
    outcome,
    detail,
    output,
    outputTruncated: result.output.length > output.length,
    finishReason: result.finishReason,
    steps: result.steps,
    toolCalls: result.toolCalls,
    toolFailures: result.toolFailures,
    trace: result.trace,
    claimMatched: verdict.claimMatched,
    claimPhrase: verdict.claimPhrase ?? null,
    noToolsUsed: verdict.noToolsUsed,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    xpSpent: estimateXp(result),
    latencyMs,
    nextRunAt: due,
  });

  /*
   * The preview gate closes here, and only from a manual run.
   *
   * A scheduled run cannot verify its own task: a schedule that
   * is running is already past the gate, and one that is not
   * running never reaches this line. So the only way to `enabled`
   * is a person pressing Run and watching it work.
   */
  if (input.trigger === "manual" && outcome === "succeeded") {
    await markVerified(input.scheduleId, input.task);
  }

  return {
    runId,
    outcome,
    detail,
    settled,
    output,
    claimPhrase: verdict.claimPhrase ?? null,
    toolCalls: result.toolCalls,
    documents: result.documents,
    drafts: result.drafts,
  };
}

/* =========================================================
   THE SKIPPED PATH

   A precondition failure still writes a run row, and it is
   worth saying why rather than treating it as symmetry for its
   own sake.

   A learner whose schedule has quietly not run for three days
   needs to be able to open the page and see three grey rows
   saying "skipped — your balance was under 10 XP". The
   alternative is a history that simply stops, which reads as
   the feature being broken and is the single most likely
   support question this feature will generate.

   It settles through the same function, so the skip counter
   moves under the same lock as everything else.
========================================================= */

async function finishWithoutRunning(
  input: ScheduledRunInput,
  outcome: RunOutcome,
  detail: string | null
): Promise<ScheduledRunReport> {
  const runId = await startRun({
    scheduleId: input.scheduleId,
    agentId: input.agentId,
    userId: input.userId,
    trigger: input.trigger,
    ...(input.missedRuns !== undefined ? { missedRuns: input.missedRuns } : {}),
  }).catch(() => null);

  if (!runId) {
    return {
      runId: null,
      outcome,
      detail,
      settled: null,
      output: "",
      claimPhrase: null,
      toolCalls: 0,
      documents: [],
      drafts: [],
    };
  }

  const due =
    input.trigger === "schedule" && input.cadence
      ? nextRunAt({
          cadence: input.cadence,
          hourLocal: input.hourLocal ?? 9,
          weekdayLocal: input.weekdayLocal ?? null,
          timezone: input.timezone ?? "UTC",
          from: new Date(),
        })
      : null;

  const settled = await settleRun({
    runId,
    outcome,
    detail,
    nextRunAt: due,
  });

  return {
    runId,
    outcome,
    detail,
    settled,
    output: "",
    claimPhrase: null,
    toolCalls: 0,
    documents: [],
    drafts: [],
  };
}

/* =========================================================
   COLLECTING THE STREAM

   The same job respondWhole does for a non-streaming HTTP
   caller, with one addition: the tool events are kept rather
   than dropped, because they are the evidence half of this
   feature. A learner asking "did it really fetch that number?"
   is asking to see these.
========================================================= */

interface Collected {
  output: string;
  trace: TraceEntry[];
  steps: number;
  toolCalls: number;
  toolSucceeded: number;
  toolFailures: number;
  limitReason: string | null;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  searched: boolean;
  documents: GeneratedDocument[];
  drafts: DraftedEmailEvent[];
}

function collector() {
  const state: Collected = {
    output: "",
    trace: [],
    steps: 0,
    toolCalls: 0,
    toolSucceeded: 0,
    toolFailures: 0,
    limitReason: null,
    finishReason: null,
    inputTokens: 0,
    outputTokens: 0,
    searched: false,
    documents: [],
    drafts: [],
  };

  const cap = Math.max(200, scheduleConfig.maxTraceArgChars);

  /*
   * Arguments are bounded, not dropped.
   *
   * They are safe to store — a connection's secret is attached
   * by the server on the way out and never appears in what the
   * model wrote, which is a Phase 1 property this inherits — but
   * one pathological request should not be able to dominate the
   * table. Bounded rather than removed because "which URL did it
   * call?" is most of what a trace is read for.
   */
  const boundArgs = (args: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      out[key] =
        typeof value === "string" && value.length > cap
          ? `${value.slice(0, cap)}… [${value.length} chars]`
          : value;
    }

    return out;
  };

  return {
    /*
     * Takes the runtime's own event union rather than a loose
     * bag, so the compiler checks each branch against the shape
     * the runtime actually emits. If a field is renamed in
     * ai/types.ts this stops building here instead of silently
     * writing zeroes into a run row nobody reads until it
     * matters.
     */
    take(event: RuntimeStreamEvent): void {
      switch (event.type) {
        case "delta":
          state.output += event.text;
          break;

        case "tool_call":
          state.toolCalls += 1;
          state.steps = Math.max(state.steps, event.step);
          state.trace.push({
            step: event.step,
            kind: "call",
            tool: event.tool,
            args: boundArgs(event.args),
          });
          break;

        case "tool_result": {
          if (event.ok) {
            state.toolSucceeded += 1;
          } else {
            state.toolFailures += 1;
          }

          state.steps = Math.max(state.steps, event.step);
          state.trace.push({
            step: event.step,
            kind: "result",
            /* Absent when the action could not be read at all.
               Naming a tool here would put one in the trace that
               nothing ever ran — the same lie the runtime's own
               event shape refuses to tell. */
            ...(event.tool ? { tool: event.tool } : {}),
            ok: event.ok,
            summary: event.summary,
            latencyMs: event.latencyMs,
            ...(event.error ? { error: event.error } : {}),
            ...(event.truncated ? { truncated: true } : {}),
          });
          break;
        }

        case "tool_limit":
          state.limitReason = event.reason;
          state.trace.push({
            step: event.step,
            kind: "limit",
            reason: event.reason,
          });
          break;

        case "web_search":
          state.searched = event.searched;
          break;

        case "document": {
          /* `step` is the loop's ordinal and belongs to the
             trace, not to the file. What is kept is the
             document itself, which is what the run card and
             the email attachment list are built from. */
          const { type, step, ...document } = event;
          void type;
          void step;
          state.documents.push(document);
          break;
        }

        case "email_draft": {
          /* The same shape as the document case above and the
             same reasoning: the ordinal belongs to the trace,
             and the draft itself is what the run card and the
             notification are built from. */
          const { type, step, ...draft } = event;
          void type;
          void step;
          state.drafts.push(draft);
          break;
        }

        case "done":
          state.finishReason = event.finishReason;
          state.inputTokens = event.usage.inputTokens;
          state.outputTokens = event.usage.outputTokens;
          break;

        default:
          /* start, retrieval, memory, memory_write, file_analysis
             — telemetry a run row has no column for. */
          break;
      }
    },

    done(): Collected {
      return state;
    },
  };
}

/*
 * What the run cost, reconstructed rather than reported.
 *
 * The runtime spends XP internally and does not tell its caller
 * how much, so this recomputes it from the same price list using
 * what the events showed. It is a display number — the ledger in
 * ai_usage is the record — and it is honest about the two
 * surcharges that are conditional, because those are exactly the
 * ones a learner asking "why did that cost 4?" is asking about.
 */
function estimateXp(result: Collected): number {
  return (
    costOf("agent_scheduled") +
    (result.toolCalls > 0 ? SURCHARGES.actions : 0) +
    (result.searched ? SURCHARGES.webSearch : 0)
  );
}
