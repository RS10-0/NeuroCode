import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ChevronRight, Clock } from "lucide-react";

import { Badge, Callout, EmptyState, Skeleton } from "../components/ui";

import AgentFace from "../features/agents/AgentFace";
import { listAgents } from "../features/agents/agentStore";
import type { Agent } from "../features/agents/types";
import {
  CADENCE_LABEL,
  describeExpiry,
  describeNextRun,
  listSchedules,
  type Schedule,
} from "../features/agents/scheduleApi";

/*
 * Schedules — what your agents do while you are not watching.
 *
 * The counterpart to Published, and deliberately a separate
 * destination rather than a section of it. The two answer
 * different questions about different sets of agents:
 *
 *   Published — what other people can reach.
 *   Schedules — what happened while nobody was looking.
 *
 * An agent can be either, both, or neither, and the case that
 * settles it is the common one: a learner with a nightly study
 * digest and nothing deployed. Their Published page is empty
 * and always will be. Nesting this inside it would have hidden
 * the feature from exactly the person using it.
 *
 * AN INDEX, NOT A READER.
 *
 * The first version of this screen printed every schedule's run
 * history inline, and it was the wrong shape: opening a list of
 * two schedules meant scrolling past a page of run cards to
 * find out what you had. A list you cannot see the end of is
 * not a list.
 *
 * So each schedule is one row, carrying exactly the four things
 * that decide whether you need to open it: what it is, when it
 * next runs, whether it is on, and whether anything is going
 * wrong. The detail — run history, output, traces, files, and
 * every control — is on the agent's own Schedule screen, which
 * already owns all of it. Rebuilding that here would have meant
 * two places rendering the same run history and the same
 * warnings, free to drift apart.
 *
 * Which is also why this page makes no run query at all.
 * Everything a row needs is already on the schedule itself,
 * including the streak counters — and those are a better health
 * signal than the last run anyway: one bad run is a bad
 * afternoon, three running is a standing arrangement.
 */

/* =========================================================
   IS ANYTHING WRONG

   Read off the streak counters rather than off the last run,
   and the difference is the point. A single failed run is
   noise — a provider had a bad minute. A streak is the thing
   worth putting in front of somebody, and it is the same
   evidence the circuit breaker acts on.

   Ordered worst first, and only one is ever shown: a schedule
   that is both failing and hitting limits has one problem to
   go and look at, not two chips to decode.
========================================================= */

interface Health {
  label: string;
  tone: "error" | "caution";
}

function healthOf(schedule: Schedule): Health | null {
  if (schedule.consecutiveConfabulations > 0) {
    return {
      label:
        schedule.consecutiveConfabulations === 1
          ? "Said it did something it did not"
          : `Made things up ${schedule.consecutiveConfabulations} runs running`,
      tone: "error",
    };
  }

  if (schedule.consecutiveFailures > 0) {
    return {
      label:
        schedule.consecutiveFailures === 1
          ? "Last run failed"
          : `Failed ${schedule.consecutiveFailures} runs running`,
      tone: "error",
    };
  }

  if (schedule.consecutiveLimits > 0) {
    return { label: "Running out of steps", tone: "caution" };
  }

  if (schedule.consecutiveSkips > 0) {
    return { label: "Skipped — not enough XP", tone: "caution" };
  }

  return null;
}

/* When it last did anything, for a row that is not running and
   therefore has no next run to show instead. */
function lastRan(iso: string | null): string {
  if (!iso) {
    return "never ran";
  }

  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 3600) {
    return "ran within the hour";
  }

  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600);
    return `ran ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(seconds / 86_400);

  return `ran ${days} day${days === 1 ? "" : "s"} ago`;
}

/* =========================================================
   ONE ROW
========================================================= */

export interface ScheduleRowProps {
  schedule: Schedule;
  /* Null when the shelf query failed. The row still renders and
     still links — a way into the detail is worth more than a
     missing entry. */
  agent: Agent | null;
}

/* Exported for the developer gallery at /dev/schedules: the
   failing, confabulating and expired rows each need a schedule
   in a condition you cannot ask for. */
export function ScheduleRow({ schedule, agent }: ScheduleRowProps) {
  const health = healthOf(schedule);

  /*
   * `expired` is the odd value in the DisabledReason union and
   * has to read as such: every other one means something went
   * wrong, while this means the schedule did exactly what it was
   * set up to do for exactly as long as it was asked to. A
   * warning chip on that is a lie about a success.
   */
  const expired = schedule.disabledReason === "expired";

  return (
    <li>
      {/*
        The whole row is the link, and it can be here — unlike
        the cards on Published there is nothing inside it for a
        row-sized target to swallow. One destination, and the
        chevron says so.

        The hash is read by the Schedule screen, which scrolls
        that schedule into view once its data has arrived. An
        agent usually has one, but landing at the top of a page
        with two and having to find yours again is the small
        failure that stops people using an index.
      */}
      <Link
        className="schedrow"
        to={`/agents/${schedule.agentId}/schedule#schedule-${schedule.id}`}
      >
        {agent ? (
          <AgentFace
            emoji={agent.avatarEmoji}
            tone={agent.avatarTone}
            size="sm"
          />
        ) : null}

        <span className="schedrow__text">
          <span className="schedrow__label">{schedule.label}</span>

          <span className="schedrow__sub">
            {agent?.name ?? "An agent of yours"} ·{" "}
            {CADENCE_LABEL[schedule.cadence]}
            {schedule.enabled
              ? ` · next ${describeNextRun(schedule.nextRunAt)}`
              : ` · ${lastRan(schedule.lastRunAt)}`}
            {schedule.enabled && schedule.expiresAt
              ? ` · stops ${describeExpiry(schedule.expiresAt)}`
              : ""}
          </span>
        </span>

        <span className="schedrow__state">
          {health ? <Badge tone={health.tone}>{health.label}</Badge> : null}

          {schedule.enabled ? (
            <Badge tone="correct">Running</Badge>
          ) : (
            <Badge tone={expired ? "neutral" : "caution"}>
              {expired ? "Finished its run" : "Switched off"}
            </Badge>
          )}
        </span>

        <ChevronRight
          size={16}
          aria-hidden="true"
          className="schedrow__chevron"
        />
      </Link>
    </li>
  );
}

/* =========================================================
   PAGE
========================================================= */

interface Loaded {
  schedules: Schedule[];
  agents: Map<string, Agent>;
}

export default function Schedules() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Loaded> => {
    /*
     * The schedules decide whether this page has anything to
     * say, so their failure is the page's failure. The shelf
     * only supplies a name and a face, so a row that lost it
     * still lists and still links.
     */
    const list = await listSchedules();

    const agents = new Map<string, Agent>();

    try {
      for (const agent of await listAgents()) {
        agents.set(agent.id, agent);
      }
    } catch {
      /* A row shows "An agent of yours" instead of a name. */
    }

    return { schedules: list.schedules, agents };
  }, []);

  useEffect(() => {
    let live = true;

    load()
      .then((result) => {
        if (live) {
          setLoaded(result);
        }
      })
      .catch((loadError: unknown) => {
        if (live) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Something went wrong."
          );
          setLoaded({ schedules: [], agents: new Map() });
        }
      });

    return () => {
      live = false;
    };
  }, [load]);

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Unattended</p>
        <h1 className="page__title">Schedules</h1>
        <p className="page__lede">
          Everything your agents do on their own. Open one to read what it
          said, what it looked up and what it made. You set a schedule up on
          an agent&rsquo;s own Schedule screen.
        </p>
      </header>

      {loaded === null ? (
        <ul className="schedlist">
          {[0, 1, 2].map((key) => (
            <li key={key} className="schedrow schedrow--loading">
              <Skeleton width="45%" height="18px" />
              <Skeleton width="70%" height="13px" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <Callout tone="error" title="Your schedules could not be loaded">
          {error}
        </Callout>
      ) : loaded.schedules.length === 0 ? (
        <EmptyState
          icon={<Clock size={26} />}
          title="Nothing scheduled yet"
          text="A schedule points an agent at a task and a cadence — check this every morning, look this up every week — and the result lands here and in your inbox. You set one up from an agent, so start there."
          action={
            <Link className="btn btn--secondary" to="/agents">
              <Bot size={15} aria-hidden="true" />
              Go to My Agents
            </Link>
          }
        />
      ) : (
        <ul className="schedlist">
          {/*
            Anything wrong first, then anything running, then the
            rest. Somebody opening this after a week away is
            looking for the one that needs them, and making them
            read every row to find it is making them do the
            machine's job.
          */}
          {[...loaded.schedules]
            .sort((a, b) => {
              const rank = (entry: Schedule) =>
                healthOf(entry) ? 0 : entry.enabled ? 1 : 2;

              return rank(a) - rank(b);
            })
            .map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                agent={loaded.agents.get(schedule.agentId) ?? null}
              />
            ))}
        </ul>
      )}
    </div>
  );
}
