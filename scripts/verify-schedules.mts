/*
 * Proof that a schedule computes the right next run, and that a
 * run which lied about itself is caught.
 *
 * The two things in Phase 2 that are pure functions, and
 * therefore the two that can be proved without a database, a
 * server, a model or a network. Everything else about scheduled
 * runs — the claim, the breaker, the ledger — needs the real
 * thing and lives in verify-schedules-e2e.mts.
 *
 * The split matters more here than it did for actions. Cadence
 * arithmetic is wrong only on the days nobody is testing on: a
 * clock change, a Sunday, the hour a schedule was created. Those
 * are trivial to assert against a fixed instant and nearly
 * impossible to catch by using the product. So they are asserted
 * against fixed instants, here, on every run.
 *
 * Imports the modules directly and runs under tsx, the same way
 * verify-actions.mts does and for the same reason: what is being
 * proved lives inside these functions.
 *
 *   npx tsx ./scripts/verify-schedules.mts
 */

import {
  CADENCES,
  describe as describeCadence,
  intervalMinutes,
  isCadence,
  isClockAnchored,
  isTimeZone,
  nextRunAt,
  runsPerDay,
  type Cadence,
} from "../server/src/agents/schedule/cadence";

import {
  findClaim,
  inspect,
  type ToolEvidence,
} from "../server/src/agents/schedule/confabulation";

/* ---------------------------------------------------------
   HARNESS

   Same shape as the other suites: a pass is printed, a failure
   is printed and remembered, and the exit code is the summary.
   --------------------------------------------------------- */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function iso(date: Date): string {
  return date.toISOString();
}

/* =========================================================
   1. THE VOCABULARY

   Small, but it is the guard on the frequency floor: the floor
   is structural because there is no cadence value that means
   "every minute". A test that lets one in is the first step to
   an agent that runs sixty times an hour.
========================================================= */

function checkVocabulary() {
  section("1. THE CADENCE VOCABULARY");

  check(
    "there are exactly four cadences",
    CADENCES.length === 4,
    CADENCES.join(", ")
  );

  check(
    "the shortest cadence is six hours",
    Math.min(...CADENCES.map(intervalMinutes)) === 360,
    "360 minutes"
  );

  check(
    "no cadence is shorter than the configured floor",
    CADENCES.every((c) => intervalMinutes(c) >= 360),
    "the floor cannot be undercut by choosing a value"
  );

  check(
    "an unknown cadence is not a cadence",
    !isCadence("every_minute") && !isCadence("* * * * *") && !isCadence(""),
    "cron strings are not accepted anywhere"
  );

  check(
    "every real cadence passes the guard",
    CADENCES.every(isCadence)
  );

  check(
    "only the clock-anchored two read a timezone",
    isClockAnchored("daily") &&
      isClockAnchored("weekly") &&
      !isClockAnchored("every_6_hours") &&
      !isClockAnchored("every_12_hours")
  );

  check(
    "the cost line's arithmetic is right",
    runsPerDay("every_6_hours") === 4 && runsPerDay("daily") === 1,
    "4 runs a day at the floor"
  );

  check(
    "every cadence has copy for the UI",
    CADENCES.every((c) => describeCadence(c).length > 0),
    CADENCES.map(describeCadence).join(" / ")
  );
}

/* =========================================================
   2. INTERVAL CADENCES

   The easy half, asserted anyway because "plus six hours" is
   the kind of thing that survives a refactor as "plus six
   minutes".
========================================================= */

function checkIntervals() {
  section("2. INTERVAL CADENCES");

  const from = new Date("2026-06-01T12:00:00.000Z");

  const six = nextRunAt({
    cadence: "every_6_hours",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "UTC",
    from,
  });

  check(
    "every_6_hours lands six hours later",
    iso(six) === "2026-06-01T18:00:00.000Z",
    iso(six)
  );

  const twelve = nextRunAt({
    cadence: "every_12_hours",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "UTC",
    from,
  });

  check(
    "every_12_hours lands twelve hours later",
    iso(twelve) === "2026-06-02T00:00:00.000Z",
    iso(twelve)
  );

  /*
   * An interval cadence must not care about the timezone. If it
   * ever starts to, a learner who moves country would find
   * their six-hourly agent silently skipping or doubling a run
   * on the day they changed the field.
   */
  const kolkata = nextRunAt({
    cadence: "every_6_hours",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "Asia/Kolkata",
    from,
  });

  check(
    "an interval cadence ignores the timezone entirely",
    iso(kolkata) === iso(six),
    "same instant in Asia/Kolkata as in UTC"
  );
}

/* =========================================================
   3. CLOCK-ANCHORED CADENCES

   The half that is worth having a suite for.
========================================================= */

function checkDaily() {
  section("3. DAILY, AND THE CLOCK");

  const at = (fromIso: string, timezone = "UTC", hourLocal = 9) =>
    nextRunAt({
      cadence: "daily",
      hourLocal,
      weekdayLocal: null,
      timezone,
      from: new Date(fromIso),
    });

  check(
    "before today's hour, it runs today",
    iso(at("2026-06-01T08:00:00.000Z")) === "2026-06-01T09:00:00.000Z",
    iso(at("2026-06-01T08:00:00.000Z"))
  );

  check(
    "after today's hour, it runs tomorrow",
    iso(at("2026-06-01T10:00:00.000Z")) === "2026-06-02T09:00:00.000Z",
    iso(at("2026-06-01T10:00:00.000Z"))
  );

  /*
   * The one that stops a schedule firing twice on its own due
   * minute. A run settling at exactly 09:00 must compute
   * tomorrow, not today — "next" is strictly after.
   */
  check(
    "exactly on the hour, it runs tomorrow rather than again now",
    iso(at("2026-06-01T09:00:00.000Z")) === "2026-06-02T09:00:00.000Z",
    iso(at("2026-06-01T09:00:00.000Z"))
  );

  check(
    "it crosses a month boundary",
    iso(at("2026-06-30T10:00:00.000Z")) === "2026-07-01T09:00:00.000Z",
    iso(at("2026-06-30T10:00:00.000Z"))
  );

  check(
    "it crosses a year boundary",
    iso(at("2026-12-31T10:00:00.000Z")) === "2027-01-01T09:00:00.000Z",
    iso(at("2026-12-31T10:00:00.000Z"))
  );

  /* A half-hour zone, because an offset that is not a whole
     number of hours is where naive arithmetic shows up. */
  check(
    "a half-hour offset resolves correctly",
    iso(at("2026-06-01T00:00:00.000Z", "Asia/Kolkata")) ===
      "2026-06-01T03:30:00.000Z",
    `09:00 IST = ${iso(at("2026-06-01T00:00:00.000Z", "Asia/Kolkata"))}`
  );

  check(
    "midnight is a legal hour and is not read as 24",
    iso(at("2026-06-01T10:00:00.000Z", "UTC", 0)) ===
      "2026-06-02T00:00:00.000Z",
    iso(at("2026-06-01T10:00:00.000Z", "UTC", 0))
  );
}

function checkDaylightSaving() {
  section("4. DAYLIGHT SAVING");

  /*
   * The whole reason this arithmetic is in TypeScript rather
   * than in the claim's SQL.
   *
   * British Summer Time began on 29 March 2026 at 01:00 UTC. A
   * daily 09:00 London schedule therefore fires at 09:00Z the
   * day before and 08:00Z the day after — the same wall clock,
   * a different instant. A schedule that stayed on 09:00Z would
   * arrive an hour late for seven months, which is exactly the
   * sort of wrong that nobody reports and everybody notices.
   */
  const springForward = nextRunAt({
    cadence: "daily",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "Europe/London",
    from: new Date("2026-03-28T10:00:00.000Z"),
  });

  check(
    "a daily run follows the wall clock across spring-forward",
    iso(springForward) === "2026-03-29T08:00:00.000Z",
    `09:00 BST = ${iso(springForward)}`
  );

  /* And back again on 25 October 2026, when London returns to
     GMT and 09:00 local is 09:00Z once more. */
  const fallBack = nextRunAt({
    cadence: "daily",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "Europe/London",
    from: new Date("2026-10-24T10:00:00.000Z"),
  });

  check(
    "and across fall-back",
    iso(fallBack) === "2026-10-25T09:00:00.000Z",
    `09:00 GMT = ${iso(fallBack)}`
  );

  /*
   * A southern-hemisphere zone, where the transitions run the
   * other way round. Sydney left daylight time on 5 April 2026
   * at 16:00 UTC the previous day; either side of it, 09:00
   * local is a different instant.
   */
  const sydneyBefore = nextRunAt({
    cadence: "daily",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "Australia/Sydney",
    from: new Date("2026-04-03T00:00:00.000Z"),
  });

  const sydneyAfter = nextRunAt({
    cadence: "daily",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "Australia/Sydney",
    from: new Date("2026-04-06T00:00:00.000Z"),
  });

  const shifted =
    (sydneyBefore.getTime() % 86_400_000) !==
    (sydneyAfter.getTime() % 86_400_000);

  check(
    "a southern-hemisphere transition shifts the instant too",
    shifted,
    `${iso(sydneyBefore)} then ${iso(sydneyAfter)}`
  );

  /*
   * The pathological hour. 02:30 on a spring-forward morning
   * does not exist in London — the clocks go straight from
   * 01:00 to 02:00. There is no right answer, and the only
   * requirement is that there is AN answer: a real instant,
   * near the intent, with nothing thrown. A schedule that
   * crashed here would become an infra_failure, and three of
   * those disable it.
   */
  let skipped: Date | null = null;
  let threw = false;

  try {
    skipped = nextRunAt({
      cadence: "daily",
      hourLocal: 1,
      weekdayLocal: null,
      timezone: "Europe/London",
      from: new Date("2026-03-28T12:00:00.000Z"),
    });
  } catch {
    threw = true;
  }

  check(
    "the hour that does not exist still resolves to an instant",
    !threw && skipped !== null && Number.isFinite(skipped.getTime()),
    skipped ? iso(skipped) : "threw"
  );
}

function checkWeekly() {
  section("5. WEEKLY");

  const at = (fromIso: string, weekdayLocal: number, hourLocal = 9) =>
    nextRunAt({
      cadence: "weekly",
      hourLocal,
      weekdayLocal,
      timezone: "UTC",
      from: new Date(fromIso),
    });

  /*
   * Asserted relationally rather than against a hardcoded date,
   * because the property is what matters: whatever instant comes
   * back must be the requested weekday, at the requested hour,
   * strictly in the future, and within a week.
   */
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const from = "2026-06-03T12:00:00.000Z";
    const result = at(from, weekday);
    const ahead = result.getTime() - new Date(from).getTime();

    check(
      `weekday ${weekday} lands on the right day at the right hour`,
      result.getUTCDay() === weekday &&
        result.getUTCHours() === 9 &&
        ahead > 0 &&
        ahead <= 7 * 86_400_000,
      `${iso(result)} (day ${result.getUTCDay()})`
    );
  }

  /*
   * The wrap case: today IS the target weekday and the hour has
   * already passed. The answer is next week, not nine hours ago
   * and not in eleven minutes.
   */
  const wednesday = new Date("2026-06-03T12:00:00.000Z");
  const sameDayLate = at("2026-06-03T12:00:00.000Z", wednesday.getUTCDay());

  check(
    "on the target day after the hour, it waits a full week",
    sameDayLate.getTime() - wednesday.getTime() > 6 * 86_400_000,
    iso(sameDayLate)
  );

  /* And the same day BEFORE the hour runs today. */
  const sameDayEarly = nextRunAt({
    cadence: "weekly",
    hourLocal: 23,
    weekdayLocal: wednesday.getUTCDay(),
    timezone: "UTC",
    from: wednesday,
  });

  check(
    "on the target day before the hour, it runs today",
    iso(sameDayEarly) === "2026-06-03T23:00:00.000Z",
    iso(sameDayEarly)
  );

  /* A missing weekday must not become "whatever zero means". */
  const noWeekday = nextRunAt({
    cadence: "weekly",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "UTC",
    from: wednesday,
  });

  check(
    "a null weekday falls back to Monday rather than crashing",
    noWeekday.getUTCDay() === 1,
    iso(noWeekday)
  );
}

/* =========================================================
   6. BAD DATA

   Every one of these reaches the runner from a database row,
   and a row can have been written by an older build or by hand
   in the SQL editor. Nothing in the scheduled path may throw
   over one: the run would be recorded as an infra_failure, and
   three of those disable the schedule. An owner told their
   agent is broken because their timezone is misspelled has been
   told the wrong thing.
========================================================= */

function checkBadInput() {
  section("6. BAD DATA DEGRADES, IT DOES NOT THROW");

  check(
    "a real zone is recognised",
    isTimeZone("Europe/London") && isTimeZone("UTC"),
  );

  check(
    "a nonsense zone is rejected by the guard",
    !isTimeZone("Middle/Earth") && !isTimeZone("")
  );

  let fellBack: Date | null = null;

  try {
    fellBack = nextRunAt({
      cadence: "daily",
      hourLocal: 9,
      weekdayLocal: null,
      timezone: "Middle/Earth",
      from: new Date("2026-06-01T08:00:00.000Z"),
    });
  } catch {
    /* left null */
  }

  check(
    "an unknown timezone falls back to UTC instead of throwing",
    fellBack !== null && iso(fellBack) === "2026-06-01T09:00:00.000Z",
    fellBack ? iso(fellBack) : "threw"
  );

  const wildHour = nextRunAt({
    cadence: "daily",
    hourLocal: 99,
    weekdayLocal: null,
    timezone: "UTC",
    from: new Date("2026-06-01T08:00:00.000Z"),
  });

  check(
    "an out-of-range hour is clamped rather than wrapped",
    wildHour.getUTCHours() === 23,
    iso(wildHour)
  );

  const wildWeekday = nextRunAt({
    cadence: "weekly",
    hourLocal: 9,
    weekdayLocal: 42,
    timezone: "UTC",
    from: new Date("2026-06-03T12:00:00.000Z"),
  });

  check(
    "an out-of-range weekday is normalised into the week",
    wildWeekday.getUTCDay() >= 0 && wildWeekday.getUTCDay() <= 6,
    `day ${wildWeekday.getUTCDay()}`
  );
}

/* =========================================================
   7. THE FLOOR

   Two different properties, and conflating them is a bug this
   suite already caught once.

   The floor governs how often a schedule REPEATS. It says
   nothing about how soon the next run may be: a daily 09:00
   schedule enabled at 08:00 runs in an hour, and clamping that
   to six would fire it at 14:00 on the first day — the one day
   its owner is watching — and at 09:00 every day after.

   So: every run is strictly in the future, and every CONSECUTIVE
   PAIR is at least the floor apart. The second is measured by
   asking for the run after the run.
========================================================= */

function checkFloor() {
  section("7. THE FREQUENCY FLOOR HOLDS FOR EVERY INPUT");

  const froms = [
    "2026-01-01T00:00:00.000Z",
    "2026-03-29T00:30:00.000Z",
    "2026-06-15T23:59:59.000Z",
    "2026-10-25T01:00:00.000Z",
    "2026-12-31T23:00:00.000Z",
  ];

  const zones = ["UTC", "Europe/London", "Asia/Kolkata", "Australia/Sydney"];

  let worstRepeat = Infinity;
  let worstAt = "";
  let allAhead = true;
  let aheadExample = "";
  let combinations = 0;

  for (const cadence of CADENCES as readonly Cadence[]) {
    for (const fromIso of froms) {
      for (const timezone of zones) {
        for (const hourLocal of [0, 9, 23]) {
          const from = new Date(fromIso);
          const shared = { cadence, hourLocal, weekdayLocal: 1, timezone };

          const next = nextRunAt({ ...shared, from });
          /* The run after the run: the gap between these two is
             the repeat interval the floor actually governs. */
          const after = nextRunAt({ ...shared, from: next });

          combinations += 1;

          if (next.getTime() <= from.getTime()) {
            allAhead = false;
            aheadExample = `${cadence} ${timezone} ${fromIso} h${hourLocal}`;
          }

          const repeatMinutes = (after.getTime() - next.getTime()) / 60_000;

          if (repeatMinutes < worstRepeat) {
            worstRepeat = repeatMinutes;
            worstAt = `${cadence} ${timezone} ${fromIso} h${hourLocal}`;
          }
        }
      }
    }
  }

  check(
    "every computed run is strictly in the future",
    allAhead,
    allAhead
      ? `${combinations} combinations of cadence, zone, hour and instant`
      : `past or present due time: ${aheadExample}`
  );

  check(
    "no combination repeats faster than the six-hour floor",
    worstRepeat >= 360,
    `tightest repeat ${worstRepeat} minutes (${worstAt})`
  );

  /*
   * And the property the floor exists for, stated directly: a
   * clock-anchored schedule may run soon, but it may not run
   * OFTEN. The first gap is allowed to be small; the second one
   * is not.
   */
  const soon = nextRunAt({
    cadence: "daily",
    hourLocal: 9,
    weekdayLocal: null,
    timezone: "UTC",
    from: new Date("2026-06-01T08:59:00.000Z"),
  });

  check(
    "a daily schedule enabled a minute before its hour runs that minute",
    iso(soon) === "2026-06-01T09:00:00.000Z",
    `${iso(soon)} — the floor governs repeats, not the first run`
  );
}

/* =========================================================
   8. CONFABULATION

   The check that replaces a human reading the answer.

   The negative cases are as important as the positive ones and
   there are more of them, deliberately: this runs unattended,
   and a flag it raises wrongly is a flag a student learns to
   ignore.
========================================================= */

const NO_TOOLS: ToolEvidence = { calls: 0, succeeded: 0, failed: 0 };

function checkClaimPatterns() {
  section("8. CLAIM DETECTION");

  const claims = [
    "I ran the numbers and the total is 4,182.",
    "I executed a quick check against the API.",
    "I computed the sum of the digits: 115.",
    "I calculated it for you — 42.",
    "I counted 200 integers in the range.",
    "I fetched the latest figures this morning.",
    "I checked the endpoint and it returned 200.",
    "I queried the service and got three rows.",
    "I used the run_code tool to work this out.",
    "I used the http_request tool for the lookup.",
    "I used the tool and it came back empty.",
    "Ran a short JavaScript loop that counted the integers from 1 to 200.",
    "Executed a quick script to parse the response.",
  ];

  let missed = 0;
  let missedExample = "";

  for (const text of claims) {
    if (!findClaim(text).matched) {
      missed += 1;
      missedExample = text;
    }
  }

  check(
    "every measured claim shape is caught",
    missed === 0,
    missed === 0
      ? `${claims.length}/${claims.length} matched`
      : `MISSED ${missed}: ${missedExample}`
  );

  /*
   * The near misses. An agent describing what a tool WOULD do is
   * being helpful; only an agent describing what it DID do, with
   * nothing behind it, is the failure. The tense is the whole
   * distinction, and these are the sentences that prove the
   * patterns respect it.
   */
  const innocent = [
    "I could run this in a sandbox if you want the exact figure.",
    "Running this would give you the total, but I do not have the tool enabled.",
    "I can check that for you if you turn on Call APIs.",
    "You could run this yourself with a short script.",
    "If I ran it, the answer would depend on the input.",
    "The script fetched nothing because the endpoint was down.",
    "Running a loop over 200 integers is cheap.",
    "This code would execute in well under a second.",
    "I am not able to run code, so here is the method instead.",
    "To calculate it, sum the digits of the expanded number.",
    "I have not run anything — the tool was unavailable.",
  ];

  let falsePositives = 0;
  let falseExample = "";

  for (const text of innocent) {
    const found = findClaim(text);

    if (found.matched) {
      falsePositives += 1;
      falseExample = `"${text}" -> ${found.phrase ?? ""}`;
    }
  }

  check(
    "and nothing innocent is caught with it",
    falsePositives === 0,
    falsePositives === 0
      ? `${innocent.length}/${innocent.length} clean`
      : `FALSE POSITIVE ${falsePositives}: ${falseExample}`
  );

  const evidence = findClaim("Right — I ran a script and the total came to 91.");

  check(
    "a match carries the sentence as evidence, not just a boolean",
    Boolean(evidence.phrase && evidence.phrase.includes("I ran")),
    evidence.phrase ?? "(none)"
  );
}

function checkVerdict() {
  section("9. THE VERDICT AGAINST THE TRACE");

  /*
   * The case that matters most, and the one the e2e suite
   * measured: tools available, none used, and the answer claims
   * otherwise.
   */
  const lied = inspect({
    text: "I ran a short JavaScript loop that counted the integers. The answer is 200.",
    evidence: NO_TOOLS,
    toolsAvailable: true,
  });

  check(
    "a claim with no tool events at all is confabulation",
    lied.confabulated && lied.claimMatched,
    lied.claimPhrase ?? ""
  );

  /*
   * The case the e2e suite does NOT cover, and the sharper one
   * unattended: the tools ran, every one of them failed, and the
   * agent reported results anyway. renderFailure exists to stop
   * exactly this — "You have NO result from it" — and
   * interactively a learner sees the red step and disbelieves
   * the answer. Nobody sees it here.
   */
  const allFailed = inspect({
    text: "I fetched the prices and the average is 31.40.",
    evidence: { calls: 2, succeeded: 0, failed: 2 },
    toolsAvailable: true,
  });

  check(
    "a claim when every tool FAILED is also confabulation",
    allFailed.confabulated,
    "two calls, zero successes, and a reported result"
  );

  /*
   * The guard that keeps a regex away from the common case. A
   * run with real tool output is never inspected at all, so a
   * true sentence about work that genuinely happened cannot be
   * flagged however it is phrased.
   */
  const honest = inspect({
    text: "I ran the code and it printed 115.",
    evidence: { calls: 1, succeeded: 1, failed: 0 },
    toolsAvailable: true,
  });

  check(
    "a run with real tool output is never inspected",
    !honest.confabulated && !honest.claimMatched,
    "one successful result is enough to clear it"
  );

  const mixed = inspect({
    text: "I fetched the page, then computed the total: 12.",
    evidence: { calls: 3, succeeded: 1, failed: 2 },
    toolsAvailable: true,
  });

  check(
    "one success among failures still clears the run",
    !mixed.confabulated,
    "it had something real to report"
  );

  /* ---------------------------------------------------------
     THE PHASE 3 CLAIMS

     Two capabilities that produce something OUTSIDE the answer,
     and therefore two new ways to claim work that did not
     happen. The document one is the more dangerous: "I've
     attached the full report" is a sentence somebody reading an
     email on a phone believes without scrolling to look for a
     paperclip.

     Positives AND negatives, because the negatives are what
     stop a widened pattern punishing the sentence an honest
     agent writes when it has no tool.
     --------------------------------------------------------- */

  const claimedDocument = inspect({
    text: "I've attached the full PDF report with the quarterly figures.",
    evidence: { calls: 0, succeeded: 0, failed: 0 },
    toolsAvailable: true,
  });

  check(
    "claiming an attached report with nothing run is confabulation",
    claimedDocument.confabulated,
    claimedDocument.claimPhrase ?? ""
  );

  const claimedExport = inspect({
    text: "I generated a spreadsheet for you with all 40 rows in it.",
    evidence: { calls: 1, succeeded: 0, failed: 1 },
    toolsAvailable: true,
  });

  check(
    "claiming a generated spreadsheet after a failed step is confabulation",
    claimedExport.confabulated,
    claimedExport.claimPhrase ?? ""
  );

  const claimedStore = inspect({
    text: "I saved that to my notes so I will have it next week.",
    evidence: { calls: 0, succeeded: 0, failed: 0 },
    toolsAvailable: true,
  });

  check(
    "claiming a saved record with nothing run is confabulation",
    claimedStore.confabulated,
    claimedStore.claimPhrase ?? ""
  );

  /*
   * The negatives. Each of these is the shape of an HONEST
   * answer from an agent that could not act, and each would be
   * a false accusation.
   */
  const offers: Array<[string, string]> = [
    [
      "an offer to make one is not a claim",
      "I could generate a PDF report of this if you would like one.",
    ],
    [
      "a conditional is not a claim",
      "If I generated a report it would show the same three regions.",
    ],
    [
      "describing the capability is not a claim",
      "This agent can produce a spreadsheet when you ask for one.",
    ],
    [
      "an admitted failure to make one is not a claim",
      "I could not create the document because the data fetch failed.",
    ],
    [
      "an offer to save is not a claim",
      "I can save that to my notes if you want me to remember it.",
    ],
    [
      "reporting an empty store is not a claim",
      "There is nothing saved under that name yet.",
    ],
  ];

  for (const [label, text] of offers) {
    const verdict = inspect({
      text,
      evidence: { calls: 0, succeeded: 0, failed: 0 },
      toolsAvailable: true,
    });

    check(label, !verdict.confabulated, verdict.claimPhrase ?? "clean");
  }

  /* An honest admission of failure must never be flagged. */
  const admitted = inspect({
    text: "The lookup did not work, so I cannot give you a figure. Nothing ran successfully.",
    evidence: { calls: 1, succeeded: 0, failed: 1 },
    toolsAvailable: true,
  });

  check(
    "an admitted gap is not confabulation",
    !admitted.confabulated,
    "the behaviour the prompt asks for is not punished"
  );

  /* A plain answer from an agent that simply did not need a
     tool is the ordinary case, not a suspicious one. */
  const plain = inspect({
    text: "Photosynthesis converts light energy into chemical energy.",
    evidence: NO_TOOLS,
    toolsAvailable: true,
  });

  check(
    "answering without a tool is not by itself confabulation",
    !plain.confabulated,
    "most questions do not need one"
  );

  check(
    "but it is recorded, so a schedule that never acts can be spotted",
    plain.noToolsUsed,
    "no_tools_used is advisory, never an outcome"
  );

  const noTools = inspect({
    text: "Photosynthesis converts light energy into chemical energy.",
    evidence: NO_TOOLS,
    toolsAvailable: false,
  });

  check(
    "an agent with no tools available is not flagged for not using any",
    !noTools.noToolsUsed && !noTools.confabulated,
    "nothing to have used"
  );
}

/* =========================================================
   RUN
========================================================= */

console.log("BUILDGENTIC — SCHEDULED RUNS, OFFLINE PROOF");

checkVocabulary();
checkIntervals();
checkDaily();
checkDaylightSaving();
checkWeekly();
checkBadInput();
checkFloor();
checkClaimPatterns();
checkVerdict();

section("SUMMARY");
console.log(`  ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\n  Failures:");
  for (const label of failures) {
    console.log(`    - ${label}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
