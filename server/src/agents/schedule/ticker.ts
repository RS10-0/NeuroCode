import {
  dataStore,
  schedule as scheduleConfig,
  schedulerMode,
} from "../../ai/config";
import { supabase } from "../../lib/supabase";

import { drainOutbox, notifyRunFinished, reconcileDisables } from "./notify";
import { runScheduled } from "./runner";
import { claimDue, sweep } from "./ScheduleStore";

/*
 * The thing that makes a schedule happen.
 *
 * Deliberately the least clever file in this feature. The
 * correctness is not here — it is in `agent_schedule_claim`,
 * which is atomic, leases what it hands out, and skips what
 * another tick is holding. This just asks, repeatedly.
 *
 * That split is what makes the timing source swappable. An
 * in-process timer is the default because every host that can
 * run this API at all runs a long-lived Node process — the
 * sandbox spawns a child and the SSRF guard resolves DNS, so
 * there is no serverless option to design for. But a host that
 * SLEEPS when idle has no timer running and nothing to wake it,
 * and there `POST /internal/scheduler/tick` driven by a platform
 * cron both fires the due runs and wakes the container. Both
 * call `tickOnce`; nothing else differs.
 *
 * On the FileStore precedent for not having timers: that note is
 * about a module whose import silently starts one, which turns a
 * clean shutdown into a hang and gives every test that touches
 * it a teardown it should not need. This is a process-level
 * service, started once, explicitly, from the entrypoint, and
 * `unref`ed so it never holds the event loop open. It is also
 * the one thing here that cannot use the lazy alternative:
 * FileStore sweeps on write because the only way entries
 * accumulate is by being added, and a schedule that fires only
 * when somebody happens to use the app is not a schedule.
 */

let timer: ReturnType<typeof setInterval> | null = null;

/*
 * Whether a tick is still going.
 *
 * A run can take up to two minutes and the interval is one, so
 * ticks WILL overlap without this. Overlapping is not a
 * correctness problem — the claim's lease means the second tick
 * would simply find nothing to do — but it is a pointless round
 * trip every minute, and it would let a slow batch stack up
 * timers behind it.
 */
let running = false;

/* Retention does not need to run every minute. Once an hour, off
   the back of a tick that was happening anyway. */
let ticksSinceSweep = 0;
const TICKS_PER_SWEEP = 60;

export interface TickResult {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  emailsSent: number;
  reconciled: number;
  swept: number;
}

const EMPTY: TickResult = {
  claimed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  emailsSent: 0,
  reconciled: 0,
  swept: 0,
};

/*
 * One pass.
 *
 * Ordered cheapest-first on purpose. The outbox and the
 * reconciliation are two small queries and finish in
 * milliseconds; the runs can take minutes. Doing the fast work
 * first means a backlog of runs never delays the email telling
 * somebody their schedule has been switched off — which is the
 * message that matters most and the one most likely to be
 * waiting behind exactly such a backlog.
 *
 * Never throws. It is called from a timer with nobody watching,
 * and an unhandled rejection there is a process that dies at
 * four in the morning.
 */
export async function tickOnce(): Promise<TickResult> {
  if (running) {
    return EMPTY;
  }

  running = true;

  const result: TickResult = { ...EMPTY };

  try {
    /* ---- 1. the fast, message-bearing work ---- */

    try {
      const drained = await drainOutbox();
      result.emailsSent = drained.sent;
    } catch (error) {
      console.error(`[schedule] outbox drain failed: ${describe(error)}`);
    }

    try {
      result.reconciled = await reconcileDisables();
    } catch (error) {
      console.error(`[schedule] disable reconciliation failed: ${describe(error)}`);
    }

    /* ---- 2. the runs ---- */

    const due = await claimDue();

    result.claimed = due.length;

    /*
     * In parallel, because they belong to different learners and
     * a slow API call in one person's agent should not delay
     * another person's digest by two minutes. The batch is
     * small, and each learner's own concurrency is already
     * bounded to one by the `sched:` quota window — so this
     * cannot become five simultaneous runs for the same account.
     *
     * allSettled rather than all: one run throwing must not
     * abandon the other four, each of which has an open run row
     * and a held lease.
     */
    const outcomes = await Promise.allSettled(
      due.map(async (claimed) => {
        const report = await runScheduled({
          scheduleId: claimed.scheduleId,
          agentId: claimed.agentId,
          userId: claimed.userId,
          task: claimed.task,
          trigger: "schedule",
          cadence: claimed.cadence,
          hourLocal: claimed.hourLocal,
          weekdayLocal: claimed.weekdayLocal,
          timezone: claimed.timezone,
          missedRuns: claimed.missedRuns,
        });

        await notifyRunFinished({
          report,
          agentId: claimed.agentId,
          userId: claimed.userId,
          scheduleId: claimed.scheduleId,
          scheduleLabel: report.settled?.scheduleLabel ?? "your schedule",
        });

        return report;
      })
    );

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        /*
         * The run itself is written down — `runScheduled` opens
         * its row before doing anything that can fail — so this
         * is only about the tick's own counters. The row is left
         * open and the reaper in the next claim will close it as
         * abandoned, which also moves the failure counter.
         */
        console.error(`[schedule] a run threw: ${describe(outcome.reason)}`);
        result.failed += 1;
        continue;
      }

      switch (outcome.value.outcome) {
        case "succeeded":
        case "limit_reached":
          result.succeeded += 1;
          break;
        case "skipped":
          result.skipped += 1;
          break;
        default:
          result.failed += 1;
          break;
      }
    }

    /* ---- 3. retention, once an hour ---- */

    ticksSinceSweep += 1;

    if (ticksSinceSweep >= TICKS_PER_SWEEP) {
      ticksSinceSweep = 0;
      result.swept = await sweep();

      /*
       * Expired documents and retired records, on the same
       * hourly branch.
       *
       * Here rather than in a timer of its own, for the reason
       * FileStore's header gives about module-level timers —
       * and because there is already a process-level service
       * whose job is being woken up. Its own try/catch so a
       * storage hiccup cannot take the run loop down with it:
       * retention that did not happen this hour happens next
       * hour, and nobody's schedule depends on it.
       */
      try {
        const { sweep: sweepDocuments } = await import(
          "../documents/DocumentStore"
        );

        result.swept += await sweepDocuments(dataStore.retiredDays);
      } catch (error) {
        console.error(`[schedule] document sweep failed: ${describe(error)}`);
      }

      /*
       * Unapproved drafts and abandoned OAuth states, on the
       * same branch and in its own try/catch for the same
       * reason.
       *
       * This one matters more than the others, and it is worth
       * saying why rather than treating it as one more retention
       * job. A draft is a paragraph about somebody's private
       * correspondence, held only so that a person can approve
       * it — and one nobody has approved in a week is the
       * clearest case in the product of text with no remaining
       * reason to exist. Everything else this sweep removes is
       * removed to save space; this is removed because keeping
       * it would be holding more of somebody's post than the
       * capability needs.
       */
      try {
        const { data, error } = await supabase.rpc("sweep_email_drafts");

        if (error) {
          console.error(`[schedule] email sweep failed: ${error.message}`);
        } else {
          result.swept += Number(data ?? 0);
        }
      } catch (error) {
        console.error(`[schedule] email sweep failed: ${describe(error)}`);
      }
    }
  } catch (error) {
    console.error(`[schedule] tick failed: ${describe(error)}`);
  } finally {
    running = false;
  }

  return result;
}

/* =========================================================
   STARTING AND STOPPING
========================================================= */

/*
 * Confirms 0017 is actually applied before the timer starts.
 *
 * Migration 0017 says the banner should do this, and the reason
 * is specific to unattended work. An un-applied migration under
 * an interactive feature shows somebody an error and they try
 * again. Under this one, every run fails inside an insert, on a
 * timer, with nobody watching — and since a refused insert is an
 * infra_failure, three ticks later the circuit breaker disables
 * the schedule and emails its owner to say their agent is
 * broken. It is not; the operator forgot a file.
 *
 * So a missing table stops the ticker and prints which file to
 * run, rather than producing three days of wrong emails.
 */
async function migrationApplied(): Promise<boolean> {
  const table = await supabase.from("agent_schedules").select("id").limit(1);

  if (table.error) {
    console.error(
      `[schedule] agent_schedules is not readable (${table.error.message}) — apply supabase/migrations/0017_agent_schedules.sql. Scheduled runs are OFF until you do.`
    );

    return false;
  }

  return true;
}

export async function startScheduler(): Promise<void> {
  const mode = schedulerMode();

  if (mode === "off") {
    console.log("[schedule] scheduler: off");
    return;
  }

  if (!(await migrationApplied())) {
    return;
  }

  if (mode === "external") {
    console.log(
      "[schedule] scheduler: external — no timer here; POST /internal/scheduler/tick to fire due runs"
    );
    return;
  }

  if (timer) {
    return;
  }

  const every = Math.max(10_000, scheduleConfig.tickMs);

  timer = setInterval(() => {
    void tickOnce();
  }, every);

  /*
   * So the timer never holds the process open. Without this a
   * clean shutdown waits for an interval that will never stop
   * firing, which is the exact complaint FileStore's header
   * makes about module-level timers.
   */
  timer.unref();

  console.log(
    `[schedule] scheduler: internal — every ${Math.round(every / 1000)}s, ` +
      `up to ${scheduleConfig.batch} runs a tick, ` +
      `${scheduleConfig.minIntervalMinutes / 60}h minimum between runs, ` +
      `${scheduleConfig.maxPerUser} schedules per learner`
  );
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
