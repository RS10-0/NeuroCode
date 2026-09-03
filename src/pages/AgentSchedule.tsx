import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  FileDown,
  ArrowLeft,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";

import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  Input,
  Panel,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "../components/ui";
import AgentFace from "../features/agents/AgentFace";
import {
  downloadDocument,
  listAgentDocuments,
  type StoredDocumentSummary,
} from "../features/agents/documentsApi";
import { getAgent } from "../features/agents/agentStore";
import type { Agent } from "../features/agents/types";
import {
  CADENCE_LABEL,
  CADENCE_RUNS_PER_DAY,
  WEEKDAYS,
  createSchedule,
  deleteSchedule,
  describeNextRun,
  disableSchedule,
  enableSchedule,
  fetchSchedule,
  isClockAnchored,
  listSchedules,
  localTimezone,
  outcomeCopy,
  runNow,
  updateSchedule,
  type Cadence,
  type Run,
  type Schedule,
  type ScheduleFields,
  type ScheduleLimits,
} from "../features/agents/scheduleApi";

/*
 * Scheduling an agent.
 *
 * The screen answers four questions in the order a learner asks
 * them: what will it do, how often, what does that cost, and did
 * it work. Everything on it is arranged around the one rule that
 * makes the feature safe to hand to a fifteen-year-old — a
 * schedule cannot be switched on until they have watched it work
 * once, and editing the task takes them back to that gate.
 *
 * The other thing this page is careful about is the flags. A
 * scheduled run happens with nobody watching, so the run history
 * is the only place the truth about it lives: a run that claimed
 * to use a tool it never used says so in red, with the sentence
 * it said, because a warning a learner cannot check is a warning
 * they learn to scroll past.
 */

const XP_PER_RUN = 3;

/* =========================================================
   THE FORM
========================================================= */

/* The form is exactly the fields the server accepts — there is
   nothing extra to hold, and nothing here it will not read. */
type FormState = ScheduleFields;

function blankForm(): FormState {
  return {
    label: "",
    task: "",
    cadence: "daily",
    hourLocal: 9,
    weekdayLocal: 1,
    timezone: localTimezone(),
    notifyEmail: true,
    notifyOnSuccess: true,
  };
}

function formFrom(schedule: Schedule): FormState {
  return {
    label: schedule.label,
    task: schedule.task,
    cadence: schedule.cadence,
    hourLocal: schedule.hourLocal,
    weekdayLocal: schedule.weekdayLocal ?? 1,
    timezone: schedule.timezone,
    notifyEmail: schedule.notifyEmail,
    notifyOnSuccess: schedule.notifyOnSuccess,
  };
}

function costPerDay(cadence: Cadence): number {
  return Math.round(CADENCE_RUNS_PER_DAY[cadence] * XP_PER_RUN * 10) / 10;
}

interface ScheduleFormProps {
  value: FormState;
  onChange: (next: FormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  submitLabel: string;
}

function ScheduleForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
}: ScheduleFormProps) {
  const set = <K extends keyof FormState>(key: K, next: FormState[K]) =>
    onChange({ ...value, [key]: next });

  const taskTooShort = value.task.trim().length > 0 && value.task.trim().length < 10;

  return (
    <form
      className="schedform"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Name" hint="Just for you — it labels the run history.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={value.label}
            maxLength={80}
            placeholder="Morning news digest"
            onChange={(event) => set("label", event.target.value)}
          />
        )}
      </Field>

      <Field
        label="What it should do"
        hint="This exact sentence is everything your agent is told, every single run. It cannot see this page, and it does not remember the last run."
        error={taskTooShort ? "A bit longer — say what you want back." : undefined}
      >
        {({ id, invalid, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={4}
            value={value.task}
            maxLength={2000}
            placeholder="Check the BBC News front page and write me three bullet points on the top science story."
            invalid={invalid}
            onChange={(event) => set("task", event.target.value)}
          />
        )}
      </Field>

      <div className="schedform__row">
        <Field label="How often">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={value.cadence}
              onChange={(event) => set("cadence", event.target.value as Cadence)}
            >
              {(Object.keys(CADENCE_LABEL) as Cadence[]).map((cadence) => (
                <option key={cadence} value={cadence}>
                  {CADENCE_LABEL[cadence]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/*
         * Shown only for the two cadences that read them. An
         * interval cadence is an offset from its own last run,
         * so a time of day would be a control that changes
         * nothing — and a control that does nothing is worse
         * than no control.
         */}
        {isClockAnchored(value.cadence) ? (
          <Field label="At">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={String(value.hourLocal)}
                onChange={(event) => set("hourLocal", Number(event.target.value))}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {value.cadence === "weekly" ? (
          <Field label="On">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={String(value.weekdayLocal ?? 1)}
                onChange={(event) => set("weekdayLocal", Number(event.target.value))}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>

      {/*
       * The price, before they find it out by running out.
       *
       * A student earns 40 XP a day. A six-hourly schedule takes
       * about 12 of them, which is a real share of what they have
       * to spend on lessons — so the number goes next to the
       * control that sets it, not in a help page.
       */}
      <Callout tone="info" title="What this costs">
        About <strong>{costPerDay(value.cadence)} XP a day</strong> at this
        frequency. You earn 40 XP a day by logging in, plus whatever you earn
        from lessons. Runs stop automatically if your balance drops below 10 XP,
        so a schedule can never spend the XP you need for a lesson.
      </Callout>

      <div className="schedform__toggles">
        <label className="schedtoggle">
          <input
            type="checkbox"
            checked={value.notifyOnSuccess}
            onChange={(event) => set("notifyOnSuccess", event.target.checked)}
          />
          <span>
            <strong>Tell me what it found</strong>
            <small>A note in your feed each time it runs.</small>
          </span>
        </label>

        <label className="schedtoggle">
          <input
            type="checkbox"
            checked={value.notifyEmail}
            onChange={(event) => set("notifyEmail", event.target.checked)}
          />
          <span>
            <strong>Email it to me too</strong>
            <small>
              Goes to your account email. You cannot send it anywhere else —
              this is your agent reporting to you, not a mailing tool.
            </small>
          </span>
        </label>
      </div>

      <div className="schedform__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* =========================================================
   A RUN

   The evidence half of the feature. Everything a learner needs
   to decide whether to believe the answer is on this card.
========================================================= */

function RunCard({
  run,
  documents,
}: {
  run: Run;
  documents: StoredDocumentSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const copy = outcomeCopy(run);

  const when = new Date(run.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className={`runcard runcard--${copy.tone}`}>
      <div className="runcard__head">
        <Badge tone={copy.tone}>{copy.label}</Badge>
        <span className="runcard__when">{when}</span>
        {run.trigger === "manual" ? (
          <Badge tone="neutral">Test run</Badge>
        ) : null}
        <span className="runcard__meta">
          {run.latencyMs !== null ? `${(run.latencyMs / 1000).toFixed(1)}s` : "—"}
          {run.xpSpent > 0 ? ` · ${run.xpSpent} XP` : ""}
          {run.toolCalls > 0
            ? ` · ${run.toolCalls} tool ${run.toolCalls === 1 ? "step" : "steps"}`
            : ""}
        </span>
      </div>

      <p className="runcard__meaning">{copy.meaning}</p>

      {/*
       * The files this run produced.
       *
       * Built from document rows, never from the run's output
       * text — which is the whole of why this is trustworthy. A
       * run whose answer says "the report is attached" and which
       * made no file shows nothing here, and the contradiction
       * sits directly under the claim.
       */}
      {documents.length > 0 ? (
        <div className="runcard__files">
          {documents.map((file) => (
            <div className="runcard__file" key={file.id}>
              <FileDown size={13} aria-hidden="true" />
              <span className="runcard__file-name">{file.filename}</span>
              <span className="runcard__file-size">
                {file.bytes < 1024
                  ? `${file.bytes} bytes`
                  : `${Math.round(file.bytes / 1024)} KB`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={downloading === file.id}
                onClick={async () => {
                  setDownloading(file.id);
                  setFileError(null);

                  try {
                    await downloadDocument(file.id, file.filename);
                  } catch (cause) {
                    setFileError(
                      cause instanceof Error
                        ? cause.message
                        : "The file could not be downloaded."
                    );
                  } finally {
                    setDownloading(null);
                  }
                }}
              >
                {downloading === file.id ? "Opening…" : "Download"}
              </Button>

              {file.degraded ? (
                <p className="runcard__file-note">{file.degraded}</p>
              ) : null}
            </div>
          ))}

          {fileError ? <p className="runcard__claim">{fileError}</p> : null}
        </div>
      ) : null}

      {/*
       * The confabulation banner, and the sentence that caused
       * it. Showing the phrase is the difference between a
       * warning a learner can check and one they have to take on
       * faith — and the second kind gets ignored.
       */}
      {run.outcome === "confabulated" && run.claimPhrase ? (
        <p className="runcard__claim">
          <AlertTriangle size={13} aria-hidden="true" /> It said:{" "}
          <q>{run.claimPhrase}</q>
        </p>
      ) : null}

      {run.missedRuns > 0 ? (
        <p className="runcard__missed">
          {run.missedRuns} earlier run{run.missedRuns === 1 ? "" : "s"} were
          missed while BuildGentic was unreachable. They were not repeated.
        </p>
      ) : null}

      {run.output ? (
        <>
          <button
            type="button"
            className="runcard__toggle"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"} what it said
            {run.trace.length > 0 ? ` and what it ran (${run.trace.length})` : ""}
          </button>

          {open ? (
            <div className="runcard__body">
              {run.trace.length > 0 ? (
                <ol className="runtrace">
                  {run.trace.map((entry, index) => (
                    <li
                      key={`${entry.step}-${entry.kind}-${index}`}
                      className={`runtrace__item runtrace__item--${entry.kind}`}
                    >
                      <Wrench size={12} aria-hidden="true" />
                      <span className="runtrace__tool">
                        {entry.tool ?? (entry.kind === "limit" ? "step limit" : "unreadable action")}
                      </span>
                      <span className="runtrace__detail">
                        {entry.kind === "call"
                          ? "asked to run"
                          : entry.kind === "limit"
                            ? entry.reason === "budget"
                              ? "no room left for more tool output"
                              : "used all 4 steps"
                            : entry.ok
                              ? entry.summary
                              : entry.error}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}

              <pre className="runcard__output">{run.output}</pre>

              {run.outputTruncated ? (
                <p className="runcard__missed">
                  The answer was longer than this and was cut off.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/* =========================================================
   ONE SCHEDULE
========================================================= */

interface ScheduleCardProps {
  schedule: Schedule;
  runs: Run[];
  documentsByRun: Record<string, StoredDocumentSummary[]>;
  busy: boolean;
  previewing: boolean;
  onEdit: () => void;
  onRunNow: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function ScheduleCard({
  schedule,
  runs,
  documentsByRun,
  busy,
  previewing,
  onEdit,
  onRunNow,
  onToggle,
  onDelete,
}: ScheduleCardProps) {
  const disabledByMachine =
    !schedule.enabled &&
    schedule.disabledReason !== null &&
    schedule.disabledReason !== "owner";

  return (
    <Panel
      title={schedule.label}
      actions={
        schedule.enabled ? (
          <Badge tone="correct" icon={<Clock size={12} />}>
            Runs {describeNextRun(schedule.nextRunAt)}
          </Badge>
        ) : (
          <Badge tone={disabledByMachine ? "error" : "neutral"}>
            {disabledByMachine ? "Switched off automatically" : "Off"}
          </Badge>
        )
      }
    >
      {/*
       * The breaker, led with. When a schedule has switched
       * itself off this is the only thing on the card that
       * matters, so it goes above the configuration rather than
       * below the run history.
       */}
      {disabledByMachine ? (
        <Callout
          tone="error"
          title={
            schedule.disabledReason === "confabulation"
              ? "Switched off after 2 runs that reported work they had not done"
              : "Switched off after 3 failed runs in a row"
          }
        >
          {schedule.disabledReason === "confabulation" ? (
            <>
              Your agent said it used a tool when no tool had run. Waiting will
              not fix that — it usually means the task is asking for something
              the agent cannot actually do, so check which capabilities it has
              switched on in the Builder, then change the task.
            </>
          ) : (
            <>
              Three runs in a row could not complete. Have a look at the run
              history below, then test it once when you are ready.
            </>
          )}{" "}
          <strong>Run it once to test</strong> before switching it back on.
        </Callout>
      ) : null}

      <dl className="schedfacts">
        <div>
          <dt>How often</dt>
          <dd>
            {CADENCE_LABEL[schedule.cadence]}
            {isClockAnchored(schedule.cadence)
              ? ` at ${String(schedule.hourLocal).padStart(2, "0")}:00`
              : ""}
            {schedule.cadence === "weekly" && schedule.weekdayLocal !== null
              ? ` on ${WEEKDAYS[schedule.weekdayLocal]}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Costs about</dt>
          <dd>{costPerDay(schedule.cadence)} XP a day</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>
            {schedule.lastRunAt
              ? new Date(schedule.lastRunAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "never"}
          </dd>
        </div>
      </dl>

      <p className="schedtask">{schedule.task}</p>

      {/*
       * The gate, explained where the button is.
       *
       * A disabled control with no reason beside it is the
       * commonest way an interface makes somebody feel stupid.
       */}
      {!schedule.verified && !schedule.enabled ? (
        <Callout tone="caution" title="Test it before switching it on">
          A schedule can only run on its own once you have watched it work.
          Press <strong>Run once to test</strong> — it costs the same as a real
          run — and if it comes back looking right, the switch below unlocks.
          Changing the task locks it again.
        </Callout>
      ) : null}

      <div className="schedactions">
        <Button
          variant="primary"
          icon={previewing ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          onClick={onRunNow}
          disabled={busy || previewing}
        >
          {previewing ? "Running…" : "Run once to test"}
        </Button>

        <Button
          icon={schedule.enabled ? <Pause size={14} /> : <Clock size={14} />}
          onClick={onToggle}
          disabled={busy || previewing || (!schedule.enabled && !schedule.verified)}
        >
          {schedule.enabled ? "Switch off" : "Switch on"}
        </Button>

        <Button onClick={onEdit} disabled={busy || previewing}>
          Edit
        </Button>

        <Button
          icon={<Trash2 size={14} />}
          onClick={onDelete}
          disabled={busy || previewing}
        >
          Delete
        </Button>
      </div>

      <h3 className="schedruns__title">Run history</h3>

      {runs.length === 0 ? (
        <p className="schedruns__empty">
          Nothing yet. Press <strong>Run once to test</strong> to see what it
          does.
        </p>
      ) : (
        <ul className="schedruns">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              documents={documentsByRun[run.id] ?? []}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* =========================================================
   PAGE
========================================================= */

/*
 * One fetch's worth of the page.
 *
 * Stamped with the id it was fetched for, so a response that
 * arrives after the learner has moved to another agent can be
 * dropped rather than painted over the new one.
 */
interface Loaded {
  forId: string;
  agent: Agent | null;
  schedules: Schedule[];
  limits: ScheduleLimits | null;
  runsById: Record<string, Run[]>;
  /*
   * The files this agent has produced, grouped by the run that
   * made them.
   *
   * Fetched once for the agent rather than per run card, which
   * is one request instead of one per card — and the route
   * already returns each document's run id, so the grouping is
   * free. It also means a card cannot be expanded into a
   * loading state, which on a list of ten runs would flicker.
   */
  documentsByRun: Record<string, StoredDocumentSummary[]>;
  failed: boolean;
}

export default function AgentSchedule() {
  const { agentId } = useParams<{ agentId: string }>();
  const { notify } = useToast();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runsById, setRunsById] = useState<Record<string, Run[]>>({});
  const [documentsByRun, setDocumentsByRun] = useState<
    Record<string, StoredDocumentSummary[]>
  >({});
  const [limits, setLimits] = useState<ScheduleLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  /*
   * Fetches, and returns what it found. Sets no state.
   *
   * The same shape AgentDeploy's loader has, and for the reason
   * its effect gives: a loader that calls setState synchronously
   * turns every mount into a cascading render, so the state lands
   * in the `.then` instead — which is also what makes the
   * `active` guard below able to drop a response that arrived
   * after the learner navigated away.
   */
  const load = useCallback(async (): Promise<Loaded> => {
    if (!agentId) {
      return {
        forId: "",
        agent: null,
        schedules: [],
        limits: null,
        runsById: {},
        documentsByRun: {},
        failed: true,
      };
    }

    try {
      const [found, list] = await Promise.all([
        getAgent(agentId),
        listSchedules(agentId),
      ]);

      /* Run history per schedule, in parallel. A learner with two
         schedules should not wait for two sequential round
         trips. */
      const details = await Promise.all(
        list.schedules.map((schedule) =>
          fetchSchedule(schedule.id).catch(() => null)
        )
      );

      const runsById: Record<string, Run[]> = {};

      for (const detail of details) {
        if (detail) {
          runsById[detail.schedule.id] = detail.runs;
        }
      }

      /*
       * Files last, and its failure is swallowed on purpose.
       *
       * A schedule page whose run history refuses to render
       * because a document listing hiccuped would be the
       * retention feature breaking the scheduling feature. The
       * cards simply show no files, which is also what they
       * correctly show when there are none.
       */
      const documentsByRun: Record<string, StoredDocumentSummary[]> = {};

      for (const document of await listAgentDocuments(agentId).catch(() => [])) {
        if (document.runId) {
          documentsByRun[document.runId] = [
            ...(documentsByRun[document.runId] ?? []),
            document,
          ];
        }
      }

      return {
        forId: agentId,
        agent: found,
        schedules: list.schedules,
        limits: list.limits,
        runsById,
        documentsByRun,
        failed: false,
      };
    } catch {
      return {
        forId: agentId,
        agent: null,
        schedules: [],
        limits: null,
        runsById: {},
        documentsByRun: {},
        failed: true,
      };
    }
  }, [agentId]);

  const apply = useCallback((next: Loaded) => {
    setAgent(next.agent);
    setSchedules(next.schedules);
    setLimits(next.limits);
    setRunsById(next.runsById);
    setDocumentsByRun(next.documentsByRun);
    setFailed(next.failed);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    apply(await load());
  }, [apply, load]);

  useEffect(() => {
    let active = true;

    void load().then((next) => {
      if (active) {
        apply(next);
      }
    });

    return () => {
      active = false;
    };
  }, [load, apply]);

  const guard = useCallback(
    async (verb: string, action: () => Promise<void>) => {
      setBusy(true);

      try {
        await action();
      } catch (error) {
        notify(
          error instanceof Error ? error.message : `Could not ${verb}.`,
          "error"
        );
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  const atCap = useMemo(
    () => (limits ? limits.enabled >= limits.maxPerUser : false),
    [limits]
  );

  const onCreate = () =>
    guard("save that schedule", async () => {
      if (!agentId || !form) {
        return;
      }

      await createSchedule(agentId, form);
      setForm(null);
      setEditingId(null);
      await refresh();
      notify("Schedule saved. Test it once before switching it on.", "correct");
    });

  const onUpdate = () =>
    guard("update that schedule", async () => {
      if (!editingId || !form) {
        return;
      }

      await updateSchedule(editingId, form);
      setForm(null);
      setEditingId(null);
      await refresh();
      notify("Saved.", "correct");
    });

  const onRunNow = (schedule: Schedule) => {
    setPreviewingId(schedule.id);

    void (async () => {
      try {
        const result = await runNow(schedule.id);

        await refresh();

        if (result.outcome === "succeeded") {
          notify("It worked. You can switch it on now.", "correct");
        } else if (result.outcome === "confabulated") {
          notify(
            "It said it used a tool it never used. Look at the run before switching this on.",
            "error"
          );
        } else if (result.outcome === "skipped") {
          notify("Skipped — check the run for why.", "info");
        } else {
          notify("That run did not work. See the run history.", "error");
        }
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Could not run that.",
          "error"
        );
      } finally {
        setPreviewingId(null);
      }
    })();
  };

  const onToggle = (schedule: Schedule) =>
    guard("change that schedule", async () => {
      if (schedule.enabled) {
        await disableSchedule(schedule.id);
        notify("Switched off.", "info");
      } else {
        await enableSchedule(schedule.id);
        notify("Switched on. It will run on its own from now.", "correct");
      }

      await refresh();
    });

  const onDelete = (schedule: Schedule) =>
    guard("delete that schedule", async () => {
      await deleteSchedule(schedule.id);
      await refresh();
      notify("Deleted.", "info");
    });

  /* --------------------------------------------------------
     RENDER
     -------------------------------------------------------- */

  if (loading) {
    return (
      <div className="page">
        <Skeleton height="38px" width="40%" />
        <Skeleton height="220px" />
      </div>
    );
  }

  if (failed || !agent) {
    return (
      <div className="page">
        <EmptyState
          title="That agent could not be loaded"
          text="It may have been deleted, or the connection dropped."
          action={<Link to="/agents" className="btn">Back to agents</Link>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Agents</p>

        <h1 className="page__title schedhead__title">
          <AgentFace emoji={agent.avatarEmoji} tone={agent.avatarTone} size="md" />
          Schedule {agent.name}
        </h1>

        <p className="page__lede">
          Give it one job and a rhythm, and it will do that job on its own —
          with your browser closed. You will get the result in your feed, and by
          email if you want it.
        </p>

        <Link className="btn btn--ghost btn--sm" to={`/agents/${agent.id}`}>
          <span className="btn__icon" aria-hidden="true">
            <ArrowLeft size={15} />
          </span>
          Back to Builder
        </Link>
      </header>

      {schedules.length === 0 && !form ? (
        <EmptyState
          title="No schedule yet"
          text="Pick one thing you would like this agent to do regularly — a morning digest, a weekly summary, a check on something that changes."
          action={
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => {
                setForm(blankForm());
                setEditingId(null);
              }}
            >
              Create a schedule
            </Button>
          }
        />
      ) : null}

      {schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          runs={runsById[schedule.id] ?? []}
          documentsByRun={documentsByRun}
          busy={busy}
          previewing={previewingId === schedule.id}
          onEdit={() => {
            setEditingId(schedule.id);
            setForm(formFrom(schedule));
          }}
          onRunNow={() => onRunNow(schedule)}
          onToggle={() => onToggle(schedule)}
          onDelete={() => onDelete(schedule)}
        />
      ))}

      {form ? (
        <Panel title={editingId ? "Edit schedule" : "New schedule"}>
          <ScheduleForm
            value={form}
            onChange={setForm}
            onSubmit={editingId ? onUpdate : onCreate}
            onCancel={() => {
              setForm(null);
              setEditingId(null);
            }}
            busy={busy}
            submitLabel={editingId ? "Save changes" : "Create schedule"}
          />
        </Panel>
      ) : schedules.length > 0 ? (
        <div className="schedadd">
          <Button
            icon={<Plus size={14} />}
            onClick={() => {
              setForm(blankForm());
              setEditingId(null);
            }}
          >
            Add another schedule
          </Button>

          {atCap ? (
            <p className="schedadd__note">
              You have {limits?.maxPerUser} schedules running, which is the most
              at once. You can still create another — you just have to switch
              one off before it can run.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
