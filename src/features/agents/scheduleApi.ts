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
  | "owner"
  /*
   * Its window ran out. The odd one in this union, and the UI
   * has to treat it as such: every other machine reason here
   * means something went wrong and wants a red banner, while
   * this one means a schedule did exactly what it was set up to
   * do for exactly as long as it was asked to.
   */
  | "expired";

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
   * When this schedule switches itself off, or null if it never
   * will — an older row, or one switched off already.
   *
   * Shown while it is running rather than only at the end. A
   * deadline somebody can see coming is a deadline they can act
   * on; one that only appears after it has passed is a surprise.
   */
  expiresAt: string | null;
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
  /* `search` is emitted before the loop has a first step — Web
     Search is decided and performed ahead of the answer, so it
     produces no call and no result of its own. It is in the
     trace because a search that came back empty is otherwise
     invisible: the answer still arrives, fluent and green. */
  kind: "call" | "result" | "limit" | "search";
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  error?: string;
  latencyMs?: number;
  truncated?: boolean;
  reason?: string;
  resultCount?: number;
  /* `search` only: which provider answered. Shown because a
     chain falls through silently when a monthly allowance runs
     out, and "duckduckgo" appearing where "tavily" used to is
     the first visible sign of it. */
  provider?: string;
}

/*
 * Whether this run looked things up and came back with nothing.
 *
 * Worth its own function rather than an inline check, because
 * the honest reading of it is not obvious: the run SUCCEEDED,
 * the agent did everything it was asked, and the answer it
 * produced is nonetheless the one least worth believing —
 * written from training data on a question whose whole point was
 * that it needed the live web.
 */
export function searchedAndFoundNothing(run: Run): boolean {
  return run.trace.some(
    (entry) => entry.kind === "search" && entry.ok === false
  );
}

/*
 * How many pages a successful search put in front of the model,
 * or null if it did not search or found nothing.
 *
 * Needed because Web Search leaves `toolCalls` at zero — it runs
 * before the loop, so it is not a tool call — and describing a
 * run that read five pages as one that used none of its tools is
 * the same failure as the one this whole change is about, just
 * pointing the other way.
 */
export function pagesRead(run: Run): number | null {
  const search = run.trace.find(
    (entry) => entry.kind === "search" && entry.ok === true
  );

  return search ? (search.resultCount ?? 0) : null;
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
  /*
   * A trailing slash never reaches the API, and the way it
   * fails gives no hint why.
   *
   * `vercel.json` rewrites `/api/:path*` to the Render service.
   * That pattern does not match `/api/schedules/` — the trailing
   * slash leaves an empty final segment — so the request falls
   * through to the SPA catch-all and Vercel answers a POST to a
   * static index.html with 405 Method Not Allowed, no body, and
   * no CORS or route error anywhere to explain it. The request
   * never leaves Vercel, so nothing is logged server side
   * either.
   *
   * Creating a schedule used to pass "/" here for the collection
   * root, which is how it hit exactly that. Normalised rather
   * than only fixed at the call site: the next person to write
   * `call("/")` should get a working request, not another
   * afternoon.
   */
  const suffix = path === "/" ? "" : path.replace(/\/+$/, "");

  const response = await fetch(`/api/schedules${suffix}`, {
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
  return call("", {
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

/*
 * How long a schedule of this cadence runs before it switches
 * itself off, in the words the warning uses.
 *
 * Mirrors describeWindow in server/src/agents/schedule/cadence.ts,
 * which is where the real numbers live. Spelled out rather than
 * counted in days because the unit somebody thinks in is the one
 * their cadence is named after: a person setting up a weekly
 * digest counts Mondays, not thirty-five days.
 */
export const CADENCE_WINDOW_LABEL: Record<Cadence, string> = {
  every_6_hours: "a week",
  every_12_hours: "a week",
  daily: "a week",
  weekly: "five weeks",
};

/*
 * The same window with no article on the front.
 *
 * Two forms rather than one because English needs two, and the
 * first draft shipped with one: "after a week" is right and
 * "for another a week" is not, and both came out of the same
 * constant. This is the form for "another ___" and "its ___".
 */
export const CADENCE_WINDOW_NOUN: Record<Cadence, string> = {
  every_6_hours: "week",
  every_12_hours: "week",
  daily: "week",
  weekly: "five weeks",
};

export function isClockAnchored(cadence: Cadence): boolean {
  return cadence === "daily" || cadence === "weekly";
}

/*
 * The hour of the day as a clock face rather than as the number
 * we store. `hourLocal` is 0-23 because that is the only form
 * arithmetic can be done on, but nobody picking a time for their
 * own agent thinks in 13:00 — they think in 1:00 PM, and a
 * picker that makes you convert is a picker you get wrong.
 *
 * Midnight and noon are the two that catch a naive `% 12`:
 * both land on 0, and both should read 12.
 */
export function describeHour(hourLocal: number): string {
  const hour = Math.min(23, Math.max(0, Math.trunc(hourLocal)));
  const face = hour % 12 === 0 ? 12 : hour % 12;

  return `${face}:00 ${hour < 12 ? "AM" : "PM"}`;
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
    case "succeeded": {
      /*
       * A search that found nothing outranks the tool count, and
       * it is the one case here that must not read as good news.
       *
       * The old copy for a zero-tool run was "Answered without
       * needing a tool", which asserts something no part of this
       * system is in a position to know. Whether a tool was
       * NEEDED is a fact about the question, not about the run.
       * Said to a fifteen-year-old under a green chip, on an
       * answer written from training data because the web search
       * came back empty, it is worse than saying nothing: it
       * talks them out of the doubt they should have had.
       */
      if (searchedAndFoundNothing(run)) {
        return {
          label: "Ran",
          tone: "caution",
          meaning:
            "It searched the web and got nothing back, then answered from memory. " +
            "Anything in here that sounds like news — dates, numbers, events — was not looked up. Check it before you trust it.",
        };
      }

      const pages = pagesRead(run);
      const steps =
        run.toolCalls > 0
          ? `${run.toolCalls} tool ${run.toolCalls === 1 ? "step" : "steps"}`
          : null;
      const web =
        pages !== null ? `${pages} ${pages === 1 ? "page" : "pages"} from the web` : null;

      return {
        label: "Ran",
        tone: "correct",
        meaning:
          web && steps
            ? `Read ${web}, then used ${steps}.`
            : web
              ? `Read ${web}.`
              : steps
                ? `Used ${steps}.`
                : "Answered straight away, without using any of its tools.",
      };
    }

    case "limit_reached":
      /*
       * Truncation is a limit_reached run, and it is not the
       * same story as running out of steps.
       *
       * The label matters as much as the sentence. "Ran out of
       * steps" on a run whose answer was complete teaches a
       * learner that the caution chip means nothing, which is
       * the one thing this project's flags cannot afford — see
       * the note above about a search that found nothing.
       */
      if (run.detail === "truncated") {
        return {
          label: "Its tool requests kept getting cut off",
          tone: "caution",
          meaning:
            "It tried to use a tool, could not finish writing the request, and stopped trying. " +
            "The answer may well be complete — read it before changing anything. If this keeps " +
            "happening, the agent probably has a tool switched on that this task does not need.",
        };
      }

      return {
        label: "Ran out of steps",
        tone: "caution",
        /*
         * The number comes off THIS RUN rather than from a
         * constant here.
         *
         * It used to be a literal 4, which is what the limit
         * happens to be today — so the copy was a guess the
         * client had no way to check, and an operator who raised
         * NEUROLINK_ACTION_MAX_STEPS would have had it lying to
         * every learner with nothing to notice. A run that hit
         * the ceiling used every step there was, so its own
         * `steps` IS the ceiling, measured rather than assumed.
         */
        meaning:
          `It used all ${run.steps > 0 ? `${run.steps} of its` : "of its"} tool ` +
          "steps and answered with what it had. The task is probably asking for " +
          "more than one turn can do.",
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
    /*
     * Split, because one of these clears on its own and the
     * other never will, and telling a learner the wrong one
     * wastes their afternoon either way.
     *
     * `provider_unavailable` means all four models in the
     * cascade refused or timed out at once. That is rare and
     * almost always brief — the commonest cause is the first
     * heavy request after the API restarts, when nothing is
     * warm yet. The old copy stopped at the diagnosis and left
     * a fifteen-year-old staring at a red box with no next
     * move, which reads as "this product is broken" rather
     * than "try that again". The `default` case below has said
     * the reassuring half all along; this one just never got
     * it.
     */
    case "provider_unavailable":
      return "Every AI provider was busy at once. This usually clears in a minute — press Run once to test again.";
    case "provider_not_configured":
      return "BuildGentic has no AI provider set up. This one is on us, not on you — it will not fix itself by retrying.";
    default:
      return "Something went wrong on our side. The next run will try again.";
  }
}

/*
 * "in 4 hours", "tomorrow at 9:00 AM" — in the reader's own clock.
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

/*
 * When this schedule switches itself off.
 *
 * A separate function rather than describeNextRun with a
 * different label, because two of that one's answers are wrong
 * here. "not scheduled" describes a schedule with no next run;
 * a schedule with no expiry is the opposite, one that keeps
 * going. And "due now" reads as something about to happen for
 * you rather than something about to stop.
 *
 * Rounded DOWN rather than to nearest, which is the one
 * deliberate difference from the function above. "Switches off
 * in 7 days" on something with six and a half days left is a
 * promise of a day that is not there; a countdown should never
 * flatter itself.
 */
export function describeExpiry(iso: string | null): string {
  if (!iso) {
    return "never";
  }

  const ms = new Date(iso).getTime() - Date.now();

  if (ms <= 0) {
    return "any moment now";
  }

  const hours = Math.floor(ms / 3_600_000);

  if (hours < 1) {
    return "in under an hour";
  }

  if (hours < 24) {
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.floor(hours / 24);

  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function timeOnly(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayAndTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
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
