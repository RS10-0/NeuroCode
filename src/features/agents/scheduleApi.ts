import { ApiError, authHeaders } from "../../lib/api";

/*
 * The Schedule screen's half of the scheduling API.
 *
 * Same shape and same borrowings as deploymentApi.ts: none of
 * this streams, so it does not go near aiClient, and it takes
 * `authHeaders` and `ApiError` from lib/api so the session token
 * is attached in one place and a failure here is a shape callers
 * already handle.
 *
 * The thing worth stating about these types is what is NOT in
 * them. There is no capability field, no model field, no step
 * budget and no email recipient — not because the screen chooses
 * not to send them, but because the server would not read them.
 * Capabilities come off the agent row, the step budget is the
 * same four the Test panel uses, and a scheduled run's output
 * goes to the account's own address. A browser that could name
 * any of those would be choosing what an unattended process may
 * do, which is the whole thing this feature is careful about.
 */

export type Cadence =
  | "every_6_hours"
  | "every_12_hours"
  | "daily"
  | "weekly";

export type RunOutcome =
  | "succeeded"
  | "limit_reached"
  | "confabulated"
  | "infra_failure"
  | "skipped";

export type DisabledReason =
  | "consecutive_failures"
  | "confabulation"
  | "agent_unavailable"
  | "owner";

export interface Schedule {
  id: string;
  agentId: string;
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
  /*
   * Whether THIS task text has a successful preview run behind
   * it. The enable button is bound to this and nothing else —
   * the server refuses anyway, so the disabled state is an
   * explanation rather than the guard.
   */
  verified: boolean;
  notifyEmail: boolean;
  notifyOnSuccess: boolean;
  createdAt: string;
  updatedAt: string;
}

/* One line of what the agent did, exactly as the runtime emitted
   it — the same events the Test panel's step list renders. */
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

export interface Run {
  id: string;
  scheduleId: string;
  trigger: "schedule" | "manual";
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
  /* The confabulation verdict, kept as evidence rather than only
     as a label: the UI shows the sentence that matched, because
     a flag a learner cannot audit is one they learn to ignore. */
  claimMatched: boolean;
  claimPhrase: string | null;
  noToolsUsed: boolean;
  xpSpent: number;
  missedRuns: number;
}

export interface ScheduleLimits {
  maxPerUser: number;
  enabled: number;
  minIntervalMinutes: number;
  xpReserve: number;
  maxSteps: number;
}

export interface ScheduleList {
  schedules: Schedule[];
  limits: ScheduleLimits;
}

export interface ScheduleDetail {
  schedule: Schedule;
  runs: Run[];
  costPerDay: number;
  clockAnchored: boolean;
}

export interface ScheduleFields {
  label: string;
  task: string;
  cadence: Cadence;
  hourLocal: number;
  weekdayLocal: number | null;
  timezone: string;
  notifyEmail: boolean;
  notifyOnSuccess: boolean;
}

export interface RunNowResult {
  outcome: RunOutcome;
  detail: string | null;
  run: Run | null;
  schedule: Schedule;
}

export interface Notification {
  id: string;
  kind: "run_output" | "run_failed" | "schedule_disabled" | "limit_advisory";
  scheduleId: string | null;
  /* Joined from the schedule, so the feed entry can link to the
     page that fixes it. Null once the schedule is deleted. */
  agentId: string | null;
  runId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface Feed {
  notifications: Notification[];
  unread: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/schedules${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...init.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const body = (await response.json()) as { error?: string };

      if (body.error) {
        message = body.error;
      }
    } catch {
      /* Non-JSON error body; keep the status message. */
    }

    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function listSchedules(agentId?: string): Promise<ScheduleList> {
  return call<ScheduleList>(agentId ? `?agentId=${encodeURIComponent(agentId)}` : "");
}

export function fetchSchedule(scheduleId: string): Promise<ScheduleDetail> {
  return call<ScheduleDetail>(`/${scheduleId}`);
}

export function createSchedule(
  agentId: string,
  fields: ScheduleFields
): Promise<{ schedule: Schedule; costPerDay: number }> {
  return call(`/`, {
    method: "POST",
    body: JSON.stringify({ agentId, ...fields }),
  });
}

export function updateSchedule(
  scheduleId: string,
  fields: ScheduleFields
): Promise<{ schedule: Schedule; costPerDay: number }> {
  return call(`/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export function deleteSchedule(scheduleId: string): Promise<void> {
  return call<void>(`/${scheduleId}`, { method: "DELETE" });
}

export function enableSchedule(scheduleId: string): Promise<{ schedule: Schedule }> {
  return call(`/${scheduleId}/enable`, { method: "POST" });
}

export function disableSchedule(scheduleId: string): Promise<{ schedule: Schedule }> {
  return call(`/${scheduleId}/disable`, { method: "POST" });
}

/*
 * The preview behind the enable gate.
 *
 * Slow on purpose — it is a real run against a real model, and
 * the caller shows a spinner rather than an optimistic result.
 * Anything faster would be a different code path, and a preview
 * that goes down a different path is evidence about a different
 * thing than the one being switched on.
 */
export function runNow(scheduleId: string): Promise<RunNowResult> {
  return call<RunNowResult>(`/${scheduleId}/run`, { method: "POST" });
}

export function fetchFeed(): Promise<Feed> {
  return call<Feed>("/feed/notifications");
}

export function markFeedRead(notificationId?: string): Promise<{ unread: number }> {
  return call(`/feed/read`, {
    method: "POST",
    body: JSON.stringify(notificationId ? { notificationId } : {}),
  });
}

/* =========================================================
   COPY

   The words a learner reads for each machine value, kept beside
   the types they describe so a new outcome cannot be added
   without somebody deciding what it says.
========================================================= */

export const CADENCE_LABEL: Record<Cadence, string> = {
  every_6_hours: "Every 6 hours",
  every_12_hours: "Every 12 hours",
  daily: "Once a day",
  weekly: "Once a week",
};

export const CADENCE_RUNS_PER_DAY: Record<Cadence, number> = {
  every_6_hours: 4,
  every_12_hours: 2,
  daily: 1,
  weekly: 1 / 7,
};

export function isClockAnchored(cadence: Cadence): boolean {
  return cadence === "daily" || cadence === "weekly";
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface OutcomeCopy {
  label: string;
  tone: "correct" | "caution" | "error" | "neutral";
  /* Shown on the run card. Written for a fifteen-year-old, not
     for a log. */
  meaning: string;
}

export function outcomeCopy(run: Run): OutcomeCopy {
  switch (run.outcome) {
    case "succeeded":
      return {
        label: "Ran",
        tone: "correct",
        meaning:
          run.toolCalls > 0
            ? `Used ${run.toolCalls} tool ${run.toolCalls === 1 ? "step" : "steps"}.`
            : "Answered without needing a tool.",
      };

    case "limit_reached":
      return {
        label: "Ran out of steps",
        tone: "caution",
        meaning:
          "It used all 4 of its tool steps and answered with what it had. The task is probably asking for more than one turn can do.",
      };

    case "confabulated":
      return {
        label: "Said it did something it did not do",
        tone: "error",
        meaning:
          "This run claimed it used a tool. No tool ran. Do not trust any figures in its answer — they were not measured.",
      };

    case "infra_failure":
      return {
        label: "Could not run",
        tone: "error",
        meaning: failureMeaning(run.detail),
      };

    case "skipped":
      return {
        label: "Skipped",
        tone: "neutral",
        meaning:
          run.detail === "out_of_xp"
            ? "Your XP balance was too low. Scheduled runs stop before they spend the XP you need for lessons."
            : "The agent it points at was not available.",
      };

    default:
      return {
        label: "Running…",
        tone: "neutral",
        meaning: "This run has not finished yet.",
      };
  }
}

function failureMeaning(detail: string | null): string {
  switch (detail) {
    case "timeout":
      return "It took too long to answer and was stopped.";
    case "empty_response":
      return "The answer came back empty.";
    case "abandoned":
      return "The run was interrupted and never finished.";
    case "quota_exceeded":
    case "rate_limited":
      return "It had already run as often as it is allowed to today.";
    case "provider_unavailable":
    case "provider_not_configured":
      return "BuildGentic could not reach an AI provider.";
    default:
      return "Something went wrong on our side. The next run will try again.";
  }
}

/*
 * "in 4 hours", "tomorrow at 09:00" — in the reader's own clock.
 *
 * The server stores an instant; a learner thinks in their own
 * timezone, and a schedule page that showed UTC would be asking
 * them to do arithmetic to know when their agent runs.
 */
export function describeNextRun(iso: string | null): string {
  if (!iso) {
    return "not scheduled";
  }

  const when = new Date(iso);
  const ms = when.getTime() - Date.now();

  if (ms <= 0) {
    return "due now";
  }

  const minutes = Math.round(ms / 60_000);

  if (minutes < 60) {
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `in ${hours} hour${hours === 1 ? "" : "s"} (${timeOnly(when)})`;
  }

  const days = Math.round(hours / 24);

  return `in ${days} day${days === 1 ? "" : "s"} (${dayAndTime(when)})`;
}

function timeOnly(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayAndTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* The learner's own zone, so a new schedule defaults to the
   clock on their wall rather than to UTC. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
