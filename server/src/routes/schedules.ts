import { Router, type Response } from "express";

import { requireUser } from "../lib/auth";
import { schedule as scheduleConfig, schedulerToken } from "../ai/config";
import { statusFor, toErrorBody } from "../ai/errors";
import { getAgent } from "../agents/AgentStore";
import {
  isCadence,
  isClockAnchored,
  isTimeZone,
  runsPerDay,
  type Cadence,
} from "../agents/schedule/cadence";
import {
  createSchedule,
  deleteSchedule,
  disableSchedule,
  enableSchedule,
  getSchedule,
  listRuns,
  listSchedules,
  updateSchedule,
} from "../agents/schedule/ScheduleStore";
import {
  listNotifications,
  markRead,
  unreadCount,
} from "../agents/schedule/NotificationStore";
import { runScheduled } from "../agents/schedule/runner";
import { tickOnce } from "../agents/schedule/ticker";
import { costOf, SURCHARGES } from "../credits/costs";

export const schedulesRouter = Router();

/*
 * The owner's side of scheduled runs.
 *
 * Transport and validation, nothing else — the same posture
 * routes/ai.ts takes. No policy decision is made here: the
 * frequency floor lives in the cadence vocabulary, the per-user
 * cap and the preview gate live in `agent_schedule_enable`, and
 * the breaker lives in `agent_schedule_settle`. A route that
 * decided any of those would be a second copy of a rule the
 * database already enforces, free to disagree with it.
 *
 * What IS decided here is what a browser may say. Which is very
 * little: a label, a task, a cadence, a time, and two toggles.
 * There is no capability field, no model field, no step field
 * and no recipient field, because none of those are the caller's
 * to choose.
 */

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

function bad(res: Response, message: string): void {
  res.status(400).json({ error: message, code: "invalid_request" });
}

/* =========================================================
   WHAT A BROWSER MAY SEND
========================================================= */

interface ScheduleFields {
  label: string;
  task: string;
  cadence: Cadence;
  hourLocal: number;
  weekdayLocal: number | null;
  timezone: string;
  notifyEmail: boolean;
  notifyOnSuccess: boolean;
}

/*
 * Returns the fields, or a message saying which one was wrong.
 *
 * Says WHICH field and WHY, the way ai/validation.ts does: a
 * validator that answers "invalid input" is a validator you
 * debug by guessing.
 */
function readFields(body: unknown): ScheduleFields | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "The request body must be a JSON object.";
  }

  const raw = body as Record<string, unknown>;

  const label = typeof raw.label === "string" ? raw.label.trim() : "";

  if (label.length < 1 || label.length > 80) {
    return "`label` must be between 1 and 80 characters.";
  }

  const task = typeof raw.task === "string" ? raw.task.trim() : "";

  if (task.length < 10 || task.length > 2000) {
    return "`task` must be between 10 and 2000 characters — it is the whole of what your agent is told.";
  }

  if (!isCadence(raw.cadence)) {
    /*
     * The floor, refused by name. A caller sending a cron string
     * or "hourly" is told what the options are rather than
     * silently given a default, because guessing here would
     * quietly halve somebody's expected frequency.
     */
    return "`cadence` must be one of every_6_hours, every_12_hours, daily, weekly.";
  }

  const cadence = raw.cadence;

  const hourLocal =
    raw.hourLocal === undefined ? 9 : Math.trunc(Number(raw.hourLocal));

  if (!Number.isFinite(hourLocal) || hourLocal < 0 || hourLocal > 23) {
    return "`hourLocal` must be between 0 and 23.";
  }

  let weekdayLocal: number | null = null;

  if (cadence === "weekly") {
    weekdayLocal =
      raw.weekdayLocal === undefined ? 1 : Math.trunc(Number(raw.weekdayLocal));

    if (!Number.isFinite(weekdayLocal) || weekdayLocal < 0 || weekdayLocal > 6) {
      return "`weekdayLocal` must be between 0 (Sunday) and 6 (Saturday).";
    }
  }

  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim() !== ""
      ? raw.timezone.trim()
      : "UTC";

  if (!isTimeZone(timezone)) {
    return "`timezone` must be an IANA timezone name, like Europe/London.";
  }

  return {
    label,
    task,
    cadence,
    hourLocal,
    weekdayLocal,
    timezone,
    notifyEmail: raw.notifyEmail !== false,
    notifyOnSuccess: raw.notifyOnSuccess !== false,
  };
}

/*
 * What a schedule costs a day, so the UI can say it before
 * somebody finds out by running out.
 */
function costPerDay(cadence: Cadence): number {
  return (
    runsPerDay(cadence) * (costOf("agent_scheduled") + SURCHARGES.actions)
  );
}

/* =========================================================
   GET /api/schedules            all of them
   GET /api/schedules?agentId=…  one agent's
========================================================= */

schedulesRouter.get("/", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    const agentId =
      typeof req.query.agentId === "string" ? req.query.agentId : undefined;

    const schedules = await listSchedules(user.id, agentId);

    res.json({
      schedules,
      limits: {
        maxPerUser: scheduleConfig.maxPerUser,
        enabled: schedules.filter((item) => item.enabled).length,
        minIntervalMinutes: scheduleConfig.minIntervalMinutes,
        xpReserve: scheduleConfig.xpReserve,
        maxSteps: 4,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   POST /api/schedules
========================================================= */

schedulesRouter.post("/", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  const agentId =
    typeof req.body?.agentId === "string" ? req.body.agentId : "";

  if (!agentId) {
    bad(res, "`agentId` is required.");
    return;
  }

  const fields = readFields(req.body);

  if (typeof fields === "string") {
    bad(res, fields);
    return;
  }

  try {
    /* Resolved against the verified user, so a forged agent id
       simply does not exist. */
    const agent = await getAgent(user.id, agentId);

    if (!agent) {
      bad(res, "That agent does not exist.");
      return;
    }

    const schedule = await createSchedule({
      userId: user.id,
      agentId,
      ...fields,
    });

    res.status(201).json({ schedule, costPerDay: costPerDay(fields.cadence) });
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   GET / PATCH / DELETE  /api/schedules/:scheduleId
========================================================= */

schedulesRouter.get("/:scheduleId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    const schedule = await getSchedule(user.id, req.params.scheduleId);

    if (!schedule) {
      res.status(404).json({ error: "That schedule does not exist.", code: "not_found" });
      return;
    }

    const runs = await listRuns(user.id, schedule.id, 20);

    res.json({
      schedule,
      runs,
      costPerDay: costPerDay(schedule.cadence),
      clockAnchored: isClockAnchored(schedule.cadence),
    });
  } catch (error) {
    sendError(res, error);
  }
});

schedulesRouter.patch("/:scheduleId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  const fields = readFields(req.body);

  if (typeof fields === "string") {
    bad(res, fields);
    return;
  }

  try {
    const schedule = await updateSchedule(user.id, req.params.scheduleId, fields);

    res.json({ schedule, costPerDay: costPerDay(schedule.cadence) });
  } catch (error) {
    sendError(res, error);
  }
});

schedulesRouter.delete("/:scheduleId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    await deleteSchedule(user.id, req.params.scheduleId);
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   POST /api/schedules/:scheduleId/enable
   POST /api/schedules/:scheduleId/disable

   The gate is in SQL, not here. This route's whole job is to
   turn its answer into a sentence.
========================================================= */

schedulesRouter.post("/:scheduleId/enable", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    const result = await enableSchedule(user.id, req.params.scheduleId);

    if (!result.enabled) {
      res.status(result.reason === "not_found" ? 404 : 409).json({
        error: enableMessage(result.reason),
        code: result.reason,
      });
      return;
    }

    const schedule = await getSchedule(user.id, req.params.scheduleId);

    res.json({ schedule });
  } catch (error) {
    sendError(res, error);
  }
});

function enableMessage(reason: string): string {
  switch (reason) {
    case "not_verified":
      return "Run it once first. A schedule can only be switched on after a test run of its current task has worked — that way you see what it does before it starts doing it on its own.";
    case "too_many":
      return `You can have ${scheduleConfig.maxPerUser} schedules running at once. Switch one off to start another.`;
    case "not_found":
      return "That schedule does not exist.";
    default:
      return "That schedule could not be switched on.";
  }
}

schedulesRouter.post("/:scheduleId/disable", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    await disableSchedule(user.id, req.params.scheduleId);

    const schedule = await getSchedule(user.id, req.params.scheduleId);

    res.json({ schedule });
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   POST /api/schedules/:scheduleId/run

   "Run once now" — the preview behind the enable gate.

   It is the SAME path a scheduled run takes: same runner, same
   composed prompt, same tools, same cost, same categorisation,
   same run row. That is the whole point of it. A preview that
   went down a different path would be evidence about a different
   thing than the one being switched on.

   It does not notify. Somebody pressed a button and is looking
   at the answer; telling them what they can see is how an inbox
   becomes worthless.
========================================================= */

schedulesRouter.post("/:scheduleId/run", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    const schedule = await getSchedule(user.id, req.params.scheduleId);

    if (!schedule) {
      res.status(404).json({ error: "That schedule does not exist.", code: "not_found" });
      return;
    }

    const report = await runScheduled({
      scheduleId: schedule.id,
      agentId: schedule.agentId,
      userId: user.id,
      task: schedule.task,
      trigger: "manual",
    });

    const runs = await listRuns(user.id, schedule.id, 1);
    const fresh = await getSchedule(user.id, schedule.id);

    res.json({
      outcome: report.outcome,
      detail: report.detail,
      run: runs[0] ?? null,
      /* So the UI can unlock the enable toggle without a second
         request. */
      schedule: fresh,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   THE FEED
========================================================= */

schedulesRouter.get("/feed/notifications", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    const [notifications, unread] = await Promise.all([
      listNotifications(user.id, 30),
      unreadCount(user.id),
    ]);

    res.json({ notifications, unread });
  } catch (error) {
    sendError(res, error);
  }
});

schedulesRouter.post("/feed/read", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) return;

  try {
    const id =
      typeof req.body?.notificationId === "string"
        ? req.body.notificationId
        : undefined;

    await markRead(user.id, id);

    res.json({ unread: await unreadCount(user.id) });
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   POST /internal/scheduler/tick

   The external driver, for a host that sleeps when idle.

   Mounted by index.ts ABOVE the CORS middleware, like the
   deployments router, so no browser makes a cross-origin call to
   it. Authenticated by a bearer read from the ENVIRONMENT — the
   token is deliberately not in the database, which is the single
   biggest reason this feature does not use pg_cron: a cron job
   can only hold its credential in its own SQL body, readable by
   anyone with SQL Editor access, which in this project is how
   every migration is applied.

   With no token configured it refuses everything. An
   unauthenticated way to make this server spend a learner's
   credits is worse than a scheduler that only runs in-process.
========================================================= */

export const schedulerTickRouter = Router();

schedulerTickRouter.post("/internal/scheduler/tick", async (req, res) => {
  const expected = schedulerToken();

  if (!expected) {
    res.status(404).json({ error: "Not found.", code: "not_found" });
    return;
  }

  const presented = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];

  if (!presented || !safeEqual(presented, expected)) {
    /*
     * 404 rather than 401, so an unauthenticated prober cannot
     * tell a wrong token from an endpoint that is not there. The
     * same posture the deployments router takes.
     */
    res.status(404).json({ error: "Not found.", code: "not_found" });
    return;
  }

  const result = await tickOnce();

  res.json(result);
});

/*
 * Length-safe, timing-safe-ish comparison.
 *
 * The token is a shared secret compared on every external tick,
 * so a short-circuiting `===` leaks its prefix to anybody willing
 * to measure. Not the most sophisticated attack surface on this
 * server, and not one worth leaving open for the sake of one
 * character.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
