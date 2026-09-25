import { useSurface } from "../components/Surface";
import RunCard from "../features/agents/RunCard";
import { ScheduleRow } from "./Schedules";
import type { Agent } from "../features/agents/types";
import type { StoredDocumentSummary } from "../features/agents/documentsApi";
import type { Run, Schedule, TraceEntry } from "../features/agents/scheduleApi";

/*
 * Developer gallery — every outcome a scheduled run can have.
 *
 * The sharpest case for a gallery in this project. Reaching one
 * of these states in the product means waiting for a real
 * unattended run to fail in a specific way: the confabulation
 * banner needs an agent that claimed to have done something it
 * did not, the empty-search line needs a web search that came
 * back with nothing, and the step-limit card needs a task that
 * genuinely runs out of room. You cannot ask for any of them.
 *
 * So they are the states most likely to ship broken, and the
 * ones where broken matters most — every one of them exists to
 * tell a learner not to believe an answer that reads perfectly
 * well. A warning that renders wrong is worse than no warning,
 * because the answer still looks confident underneath it.
 *
 * Renders the REAL RunCard, the same component the per-agent
 * Schedule screen and the Schedules tab both use. Only the data
 * is fabricated.
 */

const NOW = Date.now();

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function run(over: Partial<Run>): Run {
  return {
    id: `run-${Math.random().toString(36).slice(2, 9)}`,
    scheduleId: "s1",
    trigger: "schedule",
    outcome: "succeeded",
    detail: null,
    startedAt: iso(-1000 * 60 * 90),
    finishedAt: iso(-1000 * 60 * 89),
    latencyMs: 4200,
    output: "Here is what I found this morning.",
    outputTruncated: false,
    finishReason: "stop",
    steps: 1,
    toolCalls: 0,
    toolFailures: 0,
    trace: [],
    claimMatched: false,
    claimPhrase: null,
    noToolsUsed: true,
    xpSpent: 3,
    missedRuns: 0,
    ...over,
  };
}

const SEARCH_OK: TraceEntry = {
  step: 0,
  kind: "search",
  ok: true,
  resultCount: 5,
  provider: "tavily",
};

const SEARCH_EMPTY: TraceEntry = {
  step: 0,
  kind: "search",
  ok: false,
  provider: "duckduckgo",
};

const FILE: StoredDocumentSummary = {
  id: "doc-1",
  title: "Weekly summary",
  filename: "weekly-summary.pdf",
  format: "pdf",
  bytes: 48_112,
  pages: 3,
  agentId: "a1",
  runId: "run-files",
  createdAt: iso(-1000 * 60 * 89),
  expiresAt: iso(86_400_000 * 7),
};

interface Case {
  title: string;
  note: string;
  run: Run;
  documents: StoredDocumentSummary[];
}

const CASES: Case[] = [
  {
    title: "Succeeded, with a real search behind it",
    note: "The state everything else is measured against. Five pages read, a provider named, and an answer worth believing.",
    run: run({
      trace: [SEARCH_OK, { step: 1, kind: "result", tool: "fetch", ok: true, summary: "read 5 pages" }],
      toolCalls: 1,
      steps: 2,
      noToolsUsed: false,
      output:
        "Three things changed in the syllabus this week. First, the practical assessment weighting moved from 15% to 20%...",
    }),
    documents: [],
  },
  {
    title: "Succeeded — but the search found nothing",
    note: "The most dangerous card in the set. The run succeeded, the agent did everything asked, and the answer is the one least worth believing: written from training data on a question whose whole point was that it needed the live web. Must not read as good news.",
    run: run({
      trace: [SEARCH_EMPTY],
      output:
        "Based on what I know, the exam board usually publishes the specification in September.",
    }),
    documents: [],
  },
  {
    title: "Confabulated",
    note: "It claimed to have done something it did not do. The banner quotes the sentence that triggered the flag — a warning a learner cannot audit is one they learn to ignore.",
    run: run({
      outcome: "confabulated",
      claimMatched: true,
      claimPhrase: "I have emailed the summary to your teacher",
      output:
        "I have emailed the summary to your teacher and saved a copy to your files.",
    }),
    documents: [],
  },
  {
    title: "Produced a file",
    note: "The file list is built from document rows, never from the answer's own account of itself — so a run that says 'the report is attached' and made nothing shows nothing, and the contradiction sits directly under the claim.",
    run: run({
      id: "run-files",
      output: "I have put this week's summary together as a PDF.",
      toolCalls: 2,
      steps: 3,
      noToolsUsed: false,
    }),
    documents: [FILE],
  },
  {
    title: "Ran out of steps",
    note: "Hit the four-step ceiling before finishing. The trace says which kind of limit — all four steps used, or no room left for more tool output.",
    run: run({
      outcome: "limit_reached",
      steps: 4,
      toolCalls: 4,
      noToolsUsed: false,
      trace: [
        { step: 1, kind: "call", tool: "fetch" },
        { step: 2, kind: "result", tool: "fetch", ok: true, summary: "read 2 pages" },
        { step: 3, kind: "call", tool: "fetch" },
        { step: 4, kind: "limit", reason: "steps" },
      ],
      output: "I was partway through checking the third source when I",
      outputTruncated: true,
    }),
    documents: [],
  },
  {
    title: "A tool failed",
    note: "The action it was told to run refused. The trace carries the error rather than a generic failure, because the fix is usually in the connection the learner set up.",
    run: run({
      outcome: "infra_failure",
      toolCalls: 1,
      toolFailures: 1,
      noToolsUsed: false,
      trace: [
        { step: 1, kind: "call", tool: "post_to_sheet" },
        {
          step: 2,
          kind: "result",
          tool: "post_to_sheet",
          ok: false,
          error: "the connection returned 401",
        },
      ],
      output: null,
    }),
    documents: [],
  },
  {
    title: "Skipped, and runs were missed",
    note: "Two separate facts on one card: the balance was too low to run, and earlier runs were lost while BuildGentic was unreachable. The second says plainly that they were not repeated.",
    run: run({
      outcome: "skipped",
      output: null,
      xpSpent: 0,
      missedRuns: 3,
    }),
    documents: [],
  },
  {
    title: "A manual test run",
    note: "Triggered by the learner rather than the clock. Badged as such, because a preview run passing is what unlocks enabling the schedule.",
    run: run({
      trigger: "manual",
      output: "Test run looks right — I found this week's three updates.",
    }),
    documents: [],
  },
];


/* =========================================================
   THE INDEX ROW

   What the Schedules tab shows. Most of these states are read
   off streak counters that only a real run can move, and two
   of them read almost identically in the data while meaning
   opposite things: a schedule somebody switched off, and one
   that ran out its window exactly as designed. The second must
   not wear a warning chip.
========================================================= */

function agent(name: string, emoji: string, tone: Agent["avatarTone"]): Agent {
  return {
    id: "a1",
    name,
    description: "A fixture.",
    avatarEmoji: emoji,
    avatarTone: tone,
    instructions: "",
    model: "buildgentic-1",
    temperature: 0.7,
    maxOutputTokens: 1024,
    capabilities: ["chat"],
    status: "ready",
    isOfficial: false,
    flagshipId: null,
    createdAt: iso(-86_400_000 * 30),
    updatedAt: iso(-86_400_000),
  };
}

function schedule(over: Partial<Schedule>): Schedule {
  return {
    id: "s1",
    agentId: "a1",
    label: "Morning biology recap",
    task: "A fixture task.",
    cadence: "daily",
    hourLocal: 8,
    weekdayLocal: null,
    timezone: "Europe/London",
    enabled: true,
    nextRunAt: iso(1000 * 60 * 60 * 9),
    lastRunAt: iso(-1000 * 60 * 90),
    consecutiveFailures: 0,
    consecutiveConfabulations: 0,
    consecutiveLimits: 0,
    consecutiveSkips: 0,
    disabledAt: null,
    disabledReason: null,
    expiresAt: iso(86_400_000 * 25),
    verified: true,
    notifyEmail: true,
    notifyOnSuccess: false,
    createdAt: iso(-86_400_000 * 10),
    updatedAt: iso(-86_400_000),
    ...over,
  };
}

interface RowCase {
  title: string;
  note: string;
  schedule: Schedule;
  agent: Agent | null;
}

const ROWS: RowCase[] = [
  {
    title: "Healthy and running",
    note: "Cadence, next run and the date it stops itself, all on one line. No health chip, because there is nothing to say.",
    schedule: schedule({}),
    agent: agent("StudyBuddy", "📚", "accent"),
  },
  {
    title: "Confabulating",
    note: "The worst state, and the one worth crossing a page for: it has claimed to do things it did not do, twice running. Sorts to the top.",
    schedule: schedule({
      id: "s6",
      label: "Nightly homework email",
      consecutiveConfabulations: 2,
    }),
    agent: agent("Essay Feedback Bot", "✍️", "error"),
  },
  {
    title: "Failing",
    note: "Three failed runs in a row. One is a provider having a bad minute; a streak is the thing to show somebody.",
    schedule: schedule({
      id: "s7",
      label: "Weekly source check",
      consecutiveFailures: 3,
    }),
    agent: agent("Research Assistant", "🔎", "accent"),
  },
  {
    title: "Being skipped",
    note: "Not enough XP left to run. A caution rather than an error: nothing is broken, the balance is just low.",
    schedule: schedule({ id: "s8", consecutiveSkips: 2 }),
    agent: agent("StudyBuddy", "📚", "accent"),
  },
  {
    title: "Running, nothing yet",
    note: "Set up but not yet fired. Says when the first one lands rather than looking broken.",
    schedule: schedule({
      id: "s2",
      label: "Weekly past-paper hunt",
      cadence: "weekly",
      lastRunAt: null,
    }),
    agent: agent("StudyBuddy", "📚", "accent"),
  },
  {
    title: "Switched off by its owner",
    note: "A caution chip, because something a learner turned off is something they may want back on.",
    schedule: schedule({
      id: "s3",
      enabled: false,
      nextRunAt: null,
      disabledAt: iso(-86_400_000 * 2),
      disabledReason: "owner",
      expiresAt: null,
    }),
    agent: agent("Careers Helper", "🧭", "caution"),
  },
  {
    title: "Expired, having finished its window",
    note: "The one that must NOT read as a failure. Every other disabled reason means something went wrong; this one means the schedule did exactly what it was asked, for exactly as long as it was asked to.",
    schedule: schedule({
      id: "s4",
      enabled: false,
      nextRunAt: null,
      disabledAt: iso(-86_400_000),
      disabledReason: "expired",
      expiresAt: null,
    }),
    agent: agent("Lab Notes", "🔬", "correct"),
  },
  {
    title: "No agent on the shelf",
    note: "The shelf query failed, or the row is newer than it. The group still renders and the link still resolves.",
    schedule: schedule({ id: "s5", label: "Nightly inbox sweep" }),
    agent: null,
  },
];

export default function DevSchedules() {
  /* Same reason as the Published gallery: mounted outside the
     app shell, so nothing else sets the surface attribute the
     component stylesheets read their colours through. */
  useSurface();

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Developer gallery</p>
        <h1 className="page__title">Runs — every outcome</h1>
        <p className="page__lede">
          The real <code>RunCard</code>, against fabricated runs. Not part of
          the product; mounted only in development.
        </p>
      </header>

      {CASES.map((entry) => (
        <section key={entry.title} style={{ marginBottom: "var(--space-6)" }}>
          <h2 style={{ fontSize: "var(--text-md)" }}>{entry.title}</h2>
          <p
            className="meta"
            style={{
              marginBottom: "var(--space-3)",
              maxWidth: "62ch",
              lineHeight: "var(--leading-body)",
            }}
          >
            {entry.note}
          </p>

          <ul className="schedruns">
            <RunCard run={entry.run} documents={entry.documents} />
          </ul>
        </section>
      ))}

      <h2 style={{ fontSize: "var(--text-lg)", marginTop: "var(--space-7)" }}>
        The index row
      </h2>

      {ROWS.map((entry) => (
        <section key={entry.title} style={{ marginBottom: "var(--space-5)" }}>
          <h3 style={{ fontSize: "var(--text-md)" }}>{entry.title}</h3>
          <p
            className="meta"
            style={{
              marginBottom: "var(--space-3)",
              maxWidth: "62ch",
              lineHeight: "var(--leading-body)",
            }}
          >
            {entry.note}
          </p>

          <ul className="schedlist">
            <ScheduleRow schedule={entry.schedule} agent={entry.agent} />
          </ul>
        </section>
      ))}
    </div>
  );
}
