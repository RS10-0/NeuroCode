import { createHash } from "node:crypto";

import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";
import { schedule as scheduleConfig } from "../../ai/config";
import { isCadence, nextRunAt, type Cadence } from "./cadence";

/*
 * The server's read and write of a schedule.
 *
 * Every write in this feature goes through here, with the
 * service role, and that is not the usual arrangement. Agents,
 * knowledge and sites are all edited by the browser under RLS,
 * because they are the learner's own data and RLS is the right
 * guard for it.
 *
 * Schedules are different in a way that decides the posture: the
 * columns on this table are not preferences, they are the
 * controls on an unattended process that spends money. A browser
 * that could write `consecutive_failures = 0` could keep a
 * schedule that has been caught lying running for ever. One that
 * could write `enabled = true` could skip the preview gate. One
 * that could write `next_run_at` could set it to a minute from
 * now, repeatedly, and the frequency floor would be a suggestion
 * to anyone who opens devtools.
 *
 * So migration 0017 grants the browser SELECT and nothing else,
 * and every mutation is a function in this file. Which means the
 * explicit `.eq("user_id", ...)` on every query below is not
 * belt and braces: the service-role client bypasses RLS, so that
 * predicate is the only thing standing between one learner and
 * another learner's schedule.
 */

/* =========================================================
   SHAPES
========================================================= */

export type RunOutcome =
  | "succeeded"
  | "limit_reached"
  | "confabulated"
  | "infra_failure"
  | "skipped";

export type RunTrigger = "schedule" | "manual";

export type DisabledReason =
  | "consecutive_failures"
  | "confabulation"
  | "agent_unavailable"
  | "owner";

export interface ScheduleRecord {
  id: string;
  agentId: string;
  userId: string;
  label: string;
  task: string;
  cadence: Cadence;
  hourLocal: number;
  weekdayLocal: number | null;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  consecutiveConfabulations: number;
  consecutiveLimits: number;
  consecutiveSkips: number;
  disabledAt: string | null;
  disabledReason: DisabledReason | null;
  /* Whether the CURRENT task text has a successful preview run
     behind it. The hash itself never leaves the server — a
     browser has no use for it and publishing it would only
     invite somebody to try matching it. */
  verified: boolean;
  notifyEmail: boolean;
  notifyOnSuccess: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  scheduleId: string;
  agentId: string;
  userId: string;
  trigger: RunTrigger;
  outcome: RunOutcome | null;
  detail: string | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  output: string | null;
  outputTruncated: boolean;
  finishReason: string | null;
  steps: number;
  toolCalls: number;
  toolFailures: number;
  trace: TraceEntry[];
  claimMatched: boolean;
  claimPhrase: string | null;
  noToolsUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  xpSpent: number;
  missedRuns: number;
}

/*
 * One line of what the agent did, as the runtime emitted it.
 *
 * Deliberately the wire shape rather than a reshaping of it: the
 * Test panel renders these same events, so a run's history and a
 * learner's live test show the same thing because they ARE the
 * same thing.
 */
export interface TraceEntry {
  step: number;
  kind: "call" | "result" | "limit";
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  error?: string;
  latencyMs?: number;
  truncated?: boolean;
  reason?: string;
}

export interface ClaimedSchedule {
  scheduleId: string;
  agentId: string;
  userId: string;
  task: string;
  cadence: Cadence;
  hourLocal: number;
  weekdayLocal: number | null;
  timezone: string;
  missedRuns: number;
  dueAt: string;
}

/* =========================================================
   ROWS IN, OBJECTS OUT

   Normalised on the way in, the way AgentStore does it and for
   the same reason: a row may have been written by an older build
   or by hand in the SQL editor, and a value outside the CHECK
   constraint's vocabulary must not become an unhandled branch
   three files later.
========================================================= */

const SCHEDULE_COLUMNS =
  "id, agent_id, user_id, label, task, cadence, hour_local, weekday_local, " +
  "timezone, enabled, next_run_at, last_run_at, consecutive_failures, " +
  "consecutive_confabulations, consecutive_limits, consecutive_skips, " +
  "disabled_at, disabled_reason, verified_task_hash, notify_email, " +
  "notify_on_success, created_at, updated_at";

const RUN_COLUMNS =
  "id, schedule_id, agent_id, user_id, trigger, outcome, detail, started_at, " +
  "finished_at, latency_ms, output, output_truncated, finish_reason, steps, " +
  "tool_calls, tool_failures, trace, claim_matched, claim_phrase, " +
  "no_tools_used, input_tokens, output_tokens, xp_spent, missed_runs";

interface ScheduleRow {
  id: string;
  agent_id: string;
  user_id: string;
  label: string;
  task: string;
  cadence: string;
  hour_local: number;
  weekday_local: number | null;
  timezone: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  consecutive_confabulations: number;
  consecutive_limits: number;
  consecutive_skips: number;
  disabled_at: string | null;
  disabled_reason: string | null;
  verified_task_hash: string | null;
  notify_email: boolean;
  notify_on_success: boolean;
  created_at: string;
  updated_at: string;
}

function asCadence(value: unknown): Cadence {
  return isCadence(value) ? value : "daily";
}

function asDisabledReason(value: unknown): DisabledReason | null {
  return value === "consecutive_failures" ||
    value === "confabulation" ||
    value === "agent_unavailable" ||
    value === "owner"
    ? value
    : null;
}

function toSchedule(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    label: row.label,
    task: row.task,
    cadence: asCadence(row.cadence),
    hourLocal: row.hour_local,
    weekdayLocal: row.weekday_local,
    timezone: row.timezone,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    consecutiveFailures: row.consecutive_failures,
    consecutiveConfabulations: row.consecutive_confabulations,
    consecutiveLimits: row.consecutive_limits,
    consecutiveSkips: row.consecutive_skips,
    disabledAt: row.disabled_at,
    disabledReason: asDisabledReason(row.disabled_reason),
    /* Compared here rather than exported, so the gate's answer
       travels and its secret does not. */
    verified: row.verified_task_hash !== null &&
      row.verified_task_hash === taskHash(row.task),
    notifyEmail: row.notify_email,
    notifyOnSuccess: row.notify_on_success,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id),
    agentId: String(row.agent_id),
    userId: String(row.user_id),
    trigger: row.trigger === "manual" ? "manual" : "schedule",
    outcome: (row.outcome as RunOutcome | null) ?? null,
    detail: (row.detail as string | null) ?? null,
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    latencyMs: (row.latency_ms as number | null) ?? null,
    output: (row.output as string | null) ?? null,
    outputTruncated: row.output_truncated === true,
    finishReason: (row.finish_reason as string | null) ?? null,
    steps: Number(row.steps ?? 0),
    toolCalls: Number(row.tool_calls ?? 0),
    toolFailures: Number(row.tool_failures ?? 0),
    trace: Array.isArray(row.trace) ? (row.trace as TraceEntry[]) : [],
    claimMatched: row.claim_matched === true,
    claimPhrase: (row.claim_phrase as string | null) ?? null,
    noToolsUsed: row.no_tools_used === true,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    xpSpent: Number(row.xp_spent ?? 0),
    missedRuns: Number(row.missed_runs ?? 0),
  };
}

/*
 * The preview gate's fingerprint.
 *
 * Trimmed before hashing, so that adding a trailing newline does
 * not silently re-lock a schedule its owner has already proved —
 * that would read as a bug rather than as a rule.
 */
export function taskHash(task: string): string {
  return createHash("sha256").update(task.trim(), "utf8").digest("hex");
}

/* =========================================================
   READS
========================================================= */

export async function listSchedules(
  userId: string,
  agentId?: string
): Promise<ScheduleRecord[]> {
  let query = supabase
    .from("agent_schedules")
    .select(SCHEDULE_COLUMNS)
    .eq("user_id", userId);

  if (agentId) {
    query = query.eq("agent_id", agentId);
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    throw storeError("could not read your schedules", error.message);
  }

  return (data ?? []).map((row) => toSchedule(row as unknown as ScheduleRow));
}

export async function getSchedule(
  userId: string,
  scheduleId: string
): Promise<ScheduleRecord | null> {
  const { data, error } = await supabase
    .from("agent_schedules")
    .select(SCHEDULE_COLUMNS)
    .eq("id", scheduleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw storeError("could not read that schedule", error.message);
  }

  return data ? toSchedule(data as unknown as ScheduleRow) : null;
}

export async function countEnabled(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("agent_schedules")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("enabled", true);

  if (error) {
    throw storeError("could not count your schedules", error.message);
  }

  return count ?? 0;
}

export async function listRuns(
  userId: string,
  scheduleId: string,
  limit = 20
): Promise<RunRecord[]> {
  const { data, error } = await supabase
    .from("agent_schedule_runs")
    .select(RUN_COLUMNS)
    .eq("user_id", userId)
    .eq("schedule_id", scheduleId)
    .order("started_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));

  if (error) {
    throw storeError("could not read the run history", error.message);
  }

  return (data ?? []).map((row) => toRun(row as unknown as Record<string, unknown>));
}

export async function getRun(
  userId: string,
  runId: string
): Promise<RunRecord | null> {
  const { data, error } = await supabase
    .from("agent_schedule_runs")
    .select(RUN_COLUMNS)
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw storeError("could not read that run", error.message);
  }

  return data ? toRun(data as unknown as Record<string, unknown>) : null;
}

/* =========================================================
   WRITES
========================================================= */

export interface CreateScheduleInput {
  userId: string;
  agentId: string;
  label: string;
  task: string;
  cadence: Cadence;
  hourLocal: number;
  weekdayLocal: number | null;
  timezone: string;
  notifyEmail: boolean;
  notifyOnSuccess: boolean;
}

export async function createSchedule(
  input: CreateScheduleInput
): Promise<ScheduleRecord> {
  const { data, error } = await supabase
    .from("agent_schedules")
    .insert({
      user_id: input.userId,
      agent_id: input.agentId,
      label: input.label.trim(),
      task: input.task.trim(),
      cadence: input.cadence,
      hour_local: input.hourLocal,
      weekday_local: input.weekdayLocal,
      timezone: input.timezone,
      notify_email: input.notifyEmail,
      notify_on_success: input.notifyOnSuccess,
      /* Created disabled, always. The preview gate is the only
         way to `enabled`, and there is no path here that skips
         it — not even for the caller who just created the row. */
      enabled: false,
    })
    .select(SCHEDULE_COLUMNS)
    .single();

  if (error) {
    throw storeError("could not save that schedule", error.message);
  }

  return toSchedule(data as unknown as ScheduleRow);
}

export interface UpdateScheduleInput {
  label?: string;
  task?: string;
  cadence?: Cadence;
  hourLocal?: number;
  weekdayLocal?: number | null;
  timezone?: string;
  notifyEmail?: boolean;
  notifyOnSuccess?: boolean;
}

/*
 * An edit, and the two things it does beyond writing columns.
 *
 * CHANGING THE TASK RE-LOCKS THE GATE. Not by clearing the hash
 * — the old hash is left in place and simply stops matching the
 * new text, which means an owner who edits a task and then
 * changes it back finds their schedule still verified. That is
 * the friendly reading of the same rule, and it falls out of
 * comparing rather than clearing.
 *
 * CHANGING THE CADENCE RECOMPUTES THE DUE TIME, but only for a
 * schedule that is already running. A disabled one has no due
 * time to correct, and enabling it will compute a fresh one.
 */
export async function updateSchedule(
  userId: string,
  scheduleId: string,
  input: UpdateScheduleInput
): Promise<ScheduleRecord> {
  const current = await getSchedule(userId, scheduleId);

  if (!current) {
    throw new AiRuntimeError("invalid_request", "That schedule does not exist.");
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.task !== undefined) patch.task = input.task.trim();
  if (input.cadence !== undefined) patch.cadence = input.cadence;
  if (input.hourLocal !== undefined) patch.hour_local = input.hourLocal;
  if (input.weekdayLocal !== undefined) patch.weekday_local = input.weekdayLocal;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.notifyEmail !== undefined) patch.notify_email = input.notifyEmail;
  if (input.notifyOnSuccess !== undefined) {
    patch.notify_on_success = input.notifyOnSuccess;
  }

  const timingChanged =
    input.cadence !== undefined ||
    input.hourLocal !== undefined ||
    input.weekdayLocal !== undefined ||
    input.timezone !== undefined;

  if (timingChanged && current.enabled) {
    patch.next_run_at = nextRunAt({
      cadence: input.cadence ?? current.cadence,
      hourLocal: input.hourLocal ?? current.hourLocal,
      weekdayLocal:
        input.weekdayLocal !== undefined
          ? input.weekdayLocal
          : current.weekdayLocal,
      timezone: input.timezone ?? current.timezone,
      from: new Date(),
    }).toISOString();
  }

  /*
   * A task edit on a RUNNING schedule switches it off.
   *
   * The alternative — leaving it running on an unverified
   * instruction — would let somebody paste a new task and walk
   * away, which is exactly the situation the preview gate
   * exists to prevent. Switching it off is honest: the thing
   * they proved is not the thing that would run.
   */
  if (
    input.task !== undefined &&
    current.enabled &&
    taskHash(input.task) !== taskHash(current.task)
  ) {
    patch.enabled = false;
    patch.next_run_at = null;
    patch.disabled_at = new Date().toISOString();
    patch.disabled_reason = "owner";
  }

  const { data, error } = await supabase
    .from("agent_schedules")
    .update(patch)
    .eq("id", scheduleId)
    .eq("user_id", userId)
    .select(SCHEDULE_COLUMNS)
    .single();

  if (error) {
    throw storeError("could not update that schedule", error.message);
  }

  return toSchedule(data as unknown as ScheduleRow);
}

export async function deleteSchedule(
  userId: string,
  scheduleId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_schedules")
    .delete()
    .eq("id", scheduleId)
    .eq("user_id", userId);

  if (error) {
    throw storeError("could not delete that schedule", error.message);
  }
}

/* =========================================================
   THE PREVIEW GATE
========================================================= */

/*
 * Records that this exact task text has completed successfully.
 *
 * Called by the runner after a MANUAL run that came back
 * `succeeded`, and by nothing else — a scheduled run cannot
 * verify itself, because a schedule that is running is already
 * past the gate and a schedule that is not running does not get
 * to run.
 */
export async function markVerified(
  scheduleId: string,
  task: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_schedules")
    .update({
      verified_task_hash: taskHash(task),
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId);

  if (error) {
    /* Logged, not thrown. The run itself succeeded and the
       learner has their output; failing the request now would
       report a successful run as broken. They can press Run
       once more. */
    console.error(
      `[schedule] could not mark ${scheduleId} verified: ${error.message}`
    );
  }
}

export type EnableReason =
  | "enabled"
  | "already_enabled"
  | "not_found"
  | "not_verified"
  | "too_many";

export interface EnableResult {
  enabled: boolean;
  reason: EnableReason;
}

/*
 * Switches a schedule on, through the SQL function, because two
 * of the three checks are races.
 *
 * The cap is the obvious one: two tabs both counting one enabled
 * schedule and both concluding they may be the second produce
 * three. The gate is the subtler one — between reading "this
 * task is verified" and writing `enabled`, the task can change.
 *
 * The hash is computed HERE from the stored row rather than sent
 * by the caller. A browser-supplied hash would make the gate a
 * claim rather than a check.
 */
export async function enableSchedule(
  userId: string,
  scheduleId: string
): Promise<EnableResult> {
  const current = await getSchedule(userId, scheduleId);

  if (!current) {
    return { enabled: false, reason: "not_found" };
  }

  const due = nextRunAt({
    cadence: current.cadence,
    hourLocal: current.hourLocal,
    weekdayLocal: current.weekdayLocal,
    timezone: current.timezone,
    from: new Date(),
  });

  const { data, error } = await supabase.rpc("agent_schedule_enable", {
    p_schedule_id: scheduleId,
    p_user_id: userId,
    p_task_hash: taskHash(current.task),
    p_next_run_at: due.toISOString(),
    p_max_enabled: scheduleConfig.maxPerUser,
  });

  if (error) {
    throw storeError("could not switch that schedule on", error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { enabled: boolean; reason: EnableReason }
    | undefined;

  return {
    enabled: row?.enabled === true,
    reason: row?.reason ?? "not_found",
  };
}

export async function disableSchedule(
  userId: string,
  scheduleId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_schedules")
    .update({
      enabled: false,
      next_run_at: null,
      disabled_at: new Date().toISOString(),
      disabled_reason: "owner",
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId)
    .eq("user_id", userId);

  if (error) {
    throw storeError("could not switch that schedule off", error.message);
  }
}

/* =========================================================
   THE TICK'S SIDE
========================================================= */

/*
 * Claims up to `limit` due schedules, atomically.
 *
 * Never throws for a database problem, and that is deliberate:
 * this is called on a timer with nobody watching, and a throw
 * would either take the process down or be swallowed by a
 * catch that logs nothing useful. A tick that could not read
 * the database claims nothing and says so; the next one is
 * sixty seconds away.
 */
export async function claimDue(
  limit = scheduleConfig.batch,
  leaseSeconds = scheduleConfig.leaseSeconds
): Promise<ClaimedSchedule[]> {
  const { data, error } = await supabase.rpc("agent_schedule_claim", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    console.error(`[schedule] could not claim due schedules: ${error.message}`);
    return [];
  }

  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    scheduleId: String(row.schedule_id),
    agentId: String(row.agent_id),
    userId: String(row.user_id),
    task: String(row.task),
    cadence: asCadence(row.cadence),
    hourLocal: Number(row.hour_local ?? 9),
    weekdayLocal:
      row.weekday_local === null || row.weekday_local === undefined
        ? null
        : Number(row.weekday_local),
    timezone: String(row.timezone ?? "UTC"),
    missedRuns: Number(row.missed_runs ?? 0),
    dueAt: String(row.due_at),
  }));
}

/*
 * Opens a run row before the work starts.
 *
 * Before, not after, and it is the difference between a system
 * that can see its own crashes and one that cannot. A row
 * written only on success has no way to record a process that
 * died mid-run — which is the failure an unattended feature most
 * needs to be able to show somebody. An open row with an expired
 * lease is exactly what the reaper in agent_schedule_claim looks
 * for.
 */
export async function startRun(input: {
  scheduleId: string;
  agentId: string;
  userId: string;
  trigger: RunTrigger;
  missedRuns?: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from("agent_schedule_runs")
    .insert({
      schedule_id: input.scheduleId,
      agent_id: input.agentId,
      user_id: input.userId,
      trigger: input.trigger,
      missed_runs: Math.max(0, input.missedRuns ?? 0),
    })
    .select("id")
    .single();

  if (error) {
    throw storeError("could not start that run", error.message);
  }

  return String(data.id);
}

export interface SettleInput {
  runId: string;
  outcome: RunOutcome;
  detail?: string | null;
  output?: string | null;
  outputTruncated?: boolean;
  finishReason?: string | null;
  steps?: number;
  toolCalls?: number;
  toolFailures?: number;
  trace?: TraceEntry[];
  claimMatched?: boolean;
  claimPhrase?: string | null;
  noToolsUsed?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  xpSpent?: number;
  latencyMs?: number;
  nextRunAt?: Date | null;
}

export interface SettleResult {
  disabled: boolean;
  disabledReason: DisabledReason | null;
  consecutiveFailures: number;
  consecutiveConfabulations: number;
  consecutiveLimits: number;
  consecutiveSkips: number;
  notifyEmail: boolean;
  notifyOnSuccess: boolean;
  scheduleId: string;
  scheduleLabel: string;
}

/*
 * Closes the run, moves the counters and trips the breaker, in
 * one statement.
 *
 * Returns null when the row was already settled — the reaper and
 * a late-returning runner can both reach the same run, and the
 * SQL is written so the second one changes nothing. A caller
 * seeing null should not notify: somebody else already did.
 */
export async function settleRun(
  input: SettleInput
): Promise<SettleResult | null> {
  const { data, error } = await supabase.rpc("agent_schedule_settle", {
    p_run_id: input.runId,
    p_outcome: input.outcome,
    p_detail: input.detail ?? null,
    p_output: input.output ?? null,
    p_output_truncated: input.outputTruncated ?? false,
    p_finish_reason: input.finishReason ?? null,
    p_steps: input.steps ?? 0,
    p_tool_calls: input.toolCalls ?? 0,
    p_tool_failures: input.toolFailures ?? 0,
    p_trace: input.trace ?? [],
    p_claim_matched: input.claimMatched ?? false,
    p_claim_phrase: input.claimPhrase ?? null,
    p_no_tools_used: input.noToolsUsed ?? false,
    p_input_tokens: input.inputTokens ?? 0,
    p_output_tokens: input.outputTokens ?? 0,
    p_xp_spent: input.xpSpent ?? 0,
    p_latency_ms: input.latencyMs ?? 0,
    p_next_run_at: input.nextRunAt ? input.nextRunAt.toISOString() : null,
  });

  if (error) {
    console.error(`[schedule] could not settle run ${input.runId}: ${error.message}`);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    return null;
  }

  return {
    disabled: row.disabled === true,
    disabledReason: asDisabledReason(row.disabled_reason),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    consecutiveConfabulations: Number(row.consecutive_confabulations ?? 0),
    consecutiveLimits: Number(row.consecutive_limits ?? 0),
    consecutiveSkips: Number(row.consecutive_skips ?? 0),
    notifyEmail: row.notify_email === true,
    notifyOnSuccess: row.notify_on_success === true,
    scheduleId: String(row.schedule_id),
    scheduleLabel: String(row.schedule_label ?? "your schedule"),
  };
}

/*
 * Retention. Swept on write for the reason FileStore gives: the
 * only way run rows accumulate is by being created, and the tick
 * is what creates them.
 */
export async function sweep(): Promise<number> {
  const { data, error } = await supabase.rpc("agent_schedule_sweep", {
    p_keep_days: scheduleConfig.keepDays,
    p_keep_runs: scheduleConfig.keepRuns,
  });

  if (error) {
    console.error(`[schedule] retention sweep failed: ${error.message}`);
    return 0;
  }

  return Number(data ?? 0);
}

/*
 * Schedules that are disabled for a machine reason and have no
 * unread disable notice.
 *
 * The reconciliation the design promised. Settling and notifying
 * are two statements, so a process that dies between them leaves
 * a schedule switched off with nobody told — which is the one
 * silent failure this feature cannot tolerate, since the whole
 * point is that somebody finds out. The tick asks this question
 * every minute and writes the missing notice.
 *
 * `owner` is excluded: a learner who switched their own schedule
 * off does not need an email about it.
 */
export async function disabledWithoutNotice(
  limit = 20
): Promise<Array<{ id: string; userId: string; label: string; reason: DisabledReason }>> {
  const { data, error } = await supabase
    .from("agent_schedules")
    .select("id, user_id, label, disabled_reason, disabled_at")
    .eq("enabled", false)
    .not("disabled_reason", "is", null)
    .neq("disabled_reason", "owner")
    .order("disabled_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[schedule] could not reconcile disables: ${error.message}`);
    return [];
  }

  const candidates = (data ?? []) as Array<Record<string, unknown>>;

  if (candidates.length === 0) {
    return [];
  }

  const { data: notices } = await supabase
    .from("agent_notifications")
    .select("schedule_id")
    .eq("kind", "schedule_disabled")
    .in("schedule_id", candidates.map((row) => String(row.id)));

  const told = new Set((notices ?? []).map((row) => String(row.schedule_id)));

  return candidates
    .filter((row) => !told.has(String(row.id)))
    .map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      label: String(row.label),
      reason: asDisabledReason(row.disabled_reason) ?? "consecutive_failures",
    }));
}

/* =========================================================
   ERRORS

   A store failure is a BuildGentic failure, not a learner's
   mistake, so the message says what could not be done and the
   database's own words go to the log rather than to the browser.
========================================================= */

function storeError(message: string, detail: string): AiRuntimeError {
  const error = new AiRuntimeError("internal_error", `Sorry — ${message}.`);

  console.error(`[schedule] ${message}: ${detail}`);

  return error;
}
