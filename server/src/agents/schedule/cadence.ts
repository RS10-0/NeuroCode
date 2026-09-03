import { schedule } from "../../ai/config";

/*
 * When a schedule is next due.
 *
 * This file exists in TypeScript rather than in SQL for one
 * reason: timezones. `agent_schedule_claim` advances
 * `next_run_at` by a plain interval, which is enough to
 * guarantee a claimed row cannot fire again immediately — and
 * that is all the database needs to be right about. The precise
 * value, the one that keeps a daily digest arriving at nine in
 * the morning through a clock change, is computed here and
 * written back when the run settles.
 *
 * Splitting it that way means the fiddly half is the half that
 * can be unit-tested offline, with no database, against fixed
 * instants either side of a DST boundary. That is what
 * verify-schedules.mts does.
 *
 * If the runner never gets as far as writing the precise value —
 * a crash, a killed container — the claim's provisional interval
 * is what remains. A schedule an hour off its usual minute is a
 * far better failure than one that fires in a loop, and the
 * ordering is deliberate.
 */

/* =========================================================
   THE VOCABULARY

   A closed union, not a cron string, and the reason is the same
   one ActionToolId gives for being closed: it makes the
   frequency floor STRUCTURAL rather than validated. There is no
   value here that means "every minute", so no code path has to
   refuse one, and no validator can be bypassed by a caller that
   skips it.

   The second reason is the audience. A fifteen-year-old should
   not have to learn cron's five-field syntax to make their agent
   check something twice a day, and four options render as four
   buttons.
========================================================= */

export const CADENCES = [
  "every_6_hours",
  "every_12_hours",
  "daily",
  "weekly",
] as const;

export type Cadence = (typeof CADENCES)[number];

export function isCadence(value: unknown): value is Cadence {
  return typeof value === "string" && (CADENCES as readonly string[]).includes(value);
}

/*
 * How far apart two runs of this cadence are.
 *
 * An approximation for the clock-anchored two — a "day" is 24
 * hours here even across a DST boundary where it is 23 or 25 —
 * and that is fine, because this number is only used for the
 * floor check and for the cost estimate the UI quotes. The
 * actual next run comes from nextRunAt below, which does the
 * real calendar arithmetic.
 */
export function intervalMinutes(cadence: Cadence): number {
  switch (cadence) {
    case "every_6_hours":
      return 6 * 60;
    case "every_12_hours":
      return 12 * 60;
    case "daily":
      return 24 * 60;
    case "weekly":
      return 7 * 24 * 60;
  }
}

/* Runs per day, for the cost line the schedule page shows. */
export function runsPerDay(cadence: Cadence): number {
  return (24 * 60) / intervalMinutes(cadence);
}

/*
 * Whether this cadence reads `hourLocal` and `weekdayLocal`.
 *
 * An interval cadence is an offset from its own last run, so it
 * has nothing to anchor to a wall clock and a timezone would be
 * a field that changes nothing. The UI hides the pickers on the
 * strength of this rather than showing controls that do not
 * work.
 */
export function isClockAnchored(cadence: Cadence): boolean {
  return cadence === "daily" || cadence === "weekly";
}

export function describe(cadence: Cadence): string {
  switch (cadence) {
    case "every_6_hours":
      return "every 6 hours";
    case "every_12_hours":
      return "every 12 hours";
    case "daily":
      return "once a day";
    case "weekly":
      return "once a week";
  }
}

/* =========================================================
   TIMEZONE ARITHMETIC

   Three small functions, and the awkwardness in them is real
   rather than incidental: JavaScript can format an instant in
   any IANA zone, and cannot directly construct an instant FROM
   a wall-clock time in one. The second is what a schedule needs
   — "nine in the morning in Europe/London" is a wall clock, and
   which UTC instant that is depends on the date.
========================================================= */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /* 0 = Sunday, matching Date#getDay, because the browser side
     of this feature will be reading the same numbers out of a
     Date and the two must not disagree by one. */
  weekday: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/*
 * Is this a zone this runtime actually knows?
 *
 * Checked rather than trusted because the value reaches here
 * from a row somebody could have written by hand in the SQL
 * editor, and an unknown zone makes Intl throw. Nothing in the
 * scheduled path may throw over a data problem: the run would
 * become an infra_failure, three of those disable the schedule,
 * and the owner would be told their agent is broken when their
 * timezone is misspelled.
 */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function safeZone(timeZone: string): string {
  if (isTimeZone(timeZone)) {
    return timeZone;
  }

  console.warn(
    `[schedule] "${timeZone}" is not a timezone this runtime knows; using UTC.`
  );

  return "UTC";
}

function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    /* h23 rather than hour12:false. The latter is permitted to
       render midnight as "24" in some ICU versions, which would
       put this a day out exactly once per day. */
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(instant);

  const read = (type: string): string =>
    formatted.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    weekday: WEEKDAY_INDEX[read("weekday")] ?? 0,
  };
}

/*
 * The UTC instant at which the clocks in `timeZone` read the
 * given wall time.
 *
 * Two passes, and the second one is not belt and braces.
 *
 * The first pass measures the zone's offset at roughly the
 * wrong moment — the wall time read as if it were UTC — and
 * corrects by it. Where that correction crosses a DST boundary,
 * the offset it used is the one from the wrong side. The second
 * pass re-measures at the corrected instant and applies the
 * offset that actually applies there, which is the answer.
 *
 * On the two pathological hours a year this cannot be exactly
 * right, because the question has no exact answer: the hour that
 * is skipped forward has no instant, and the hour repeated
 * backwards has two. It resolves to a real instant either way,
 * within an hour of the intent, which for a daily digest is a
 * difference nobody will notice and no correctness depends on.
 */
function utcForLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let guess = wall;

  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsInZone(new Date(guess), timeZone);

    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      0,
      0
    );

    /* How far ahead of UTC the zone is at `guess`. */
    const offset = seenAsUtc - guess;

    guess = wall - offset;
  }

  return guess;
}

/*
 * Calendar arithmetic on a date, with no instant involved.
 *
 * Done on a fictional UTC date on purpose: adding a day to a
 * calendar date is a question about the calendar, not about
 * elapsed time, and doing it on a real zoned instant is how a
 * schedule ends up skipping the day a clock changed.
 */
function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(year, month - 1, day));

  moved.setUTCDate(moved.getUTCDate() + days);

  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/* =========================================================
   THE ANSWER
========================================================= */

export interface NextRunInput {
  cadence: Cadence;
  /* 0-23, read only by the clock-anchored cadences. */
  hourLocal: number;
  /* 0 = Sunday. Read only by `weekly`. */
  weekdayLocal: number | null;
  timezone: string;
  /* The instant to compute forward from — `now()` in the
     runner, a fixed instant in the tests. Passed in rather than
     read from the clock so this function is pure and its DST
     behaviour can be asserted. */
  from: Date;
}

/*
 * Strictly after `from`, always.
 *
 * The strictness is what stops a schedule firing twice on the
 * same due minute: a run that settles at exactly its own due
 * time must not compute itself as due again.
 */
export function nextRunAt(input: NextRunInput): Date {
  const zone = safeZone(input.timezone);
  const fromMs = input.from.getTime();

  if (isClockAnchored(input.cadence)) {
    /*
     * NO FLOOR HERE, and the omission is the point.
     *
     * The floor governs how often a schedule REPEATS, not how
     * soon its next run may be. Consecutive runs of a daily
     * cadence are a day apart and of a weekly one a week, so
     * there is nothing left to enforce — while the gap from
     * *now* to the next run is legitimately anything from a
     * minute to a week, depending only on when somebody
     * happened to switch it on.
     *
     * Clamping it here would mean a daily 09:00 schedule
     * enabled at 08:00 silently firing at 14:00 instead, and
     * then every day after that at 09:00 — one wrong run,
     * on the first day, which is the day the owner is
     * watching.
     */
    return new Date(clockAnchored(input, zone, fromMs));
  }

  /*
   * The floor, applied to the interval cadences only.
   *
   * Under the shipped defaults it cannot bite: the shortest
   * cadence is six hours and the floor is six hours. It is here
   * for the case that would otherwise be silent — an operator
   * raising NEUROLINK_SCHEDULE_MIN_INTERVAL_MINUTES above 360
   * and expecting existing 6-hourly schedules to slow down.
   * Without this they would not, and nothing would say so.
   */
  const computed = fromMs + intervalMinutes(input.cadence) * 60_000;
  const floor = fromMs + Math.max(1, schedule.minIntervalMinutes) * 60_000;

  return new Date(Math.max(computed, floor));
}

function clockAnchored(
  input: NextRunInput,
  zone: string,
  fromMs: number
): number {
  const hour = Math.min(23, Math.max(0, Math.trunc(input.hourLocal)));
  const here = partsInZone(input.from, zone);

  if (input.cadence === "daily") {
    const today = utcForLocal(here.year, here.month, here.day, hour, 0, zone);

    if (today > fromMs) {
      return today;
    }

    const tomorrow = addCalendarDays(here.year, here.month, here.day, 1);

    return utcForLocal(tomorrow.year, tomorrow.month, tomorrow.day, hour, 0, zone);
  }

  /* weekly */
  const target = normaliseWeekday(input.weekdayLocal);

  /* Days from today to the next occurrence of `target`, which is
     0 when today IS the target day — the time-of-day check below
     is what decides whether that means today or next week. */
  const ahead = (target - here.weekday + 7) % 7;

  const onDay = addCalendarDays(here.year, here.month, here.day, ahead);
  const candidate = utcForLocal(onDay.year, onDay.month, onDay.day, hour, 0, zone);

  if (candidate > fromMs) {
    return candidate;
  }

  const nextWeek = addCalendarDays(here.year, here.month, here.day, ahead + 7);

  return utcForLocal(nextWeek.year, nextWeek.month, nextWeek.day, hour, 0, zone);
}

/*
 * A weekday a `weekly` schedule can actually use.
 *
 * Null is Monday rather than Sunday, which is a small opinion:
 * a weekly digest a student sets up is far more often "start of
 * the week" than "the weekend", and a row written by hand with
 * no weekday should land somewhere defensible rather than at
 * whatever zero happens to mean.
 */
function normaliseWeekday(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return 1;
  }

  return ((Math.trunc(value) % 7) + 7) % 7;
}
