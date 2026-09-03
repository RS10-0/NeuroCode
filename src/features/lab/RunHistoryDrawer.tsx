import { useEffect, useRef } from "react";
import { History, RotateCcw, Trash2, X } from "lucide-react";

import { abbreviate, diffSettings, type LabRun } from "./types";

/*
 * The experiment log.
 *
 * Moved out of the page and into a drawer during the redesign,
 * for two reasons. It is a session-level thing rather than a
 * property of the current experiment, so it belongs with the
 * other session-level actions in the top bar; and it was the
 * third panel competing for the right rail, where the two that
 * matter while you are working — parameters, and what changed —
 * now have room to breathe.
 *
 * Scope is deliberately small and has not changed. Runs live in
 * this browser tab, for as long as it is open, and are never
 * sent anywhere. Phase 2.1 decided that BuildGentic records the
 * shape and cost of a request but never its text; a
 * server-side history would undo that quietly, and it is not
 * needed to make the comparison work.
 */

interface RunHistoryDrawerProps {
  open: boolean;
  runs: LabRun[];
  /* The run currently loaded into the workspace, if any. */
  activeId: string | null;
  /* From the top bar. Matches prompt, system text and model. */
  search: string;
  onRestore: (run: LabRun) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function RunHistoryDrawer({
  open,
  runs,
  activeId,
  search,
  onRestore,
  onClear,
  onClose,
}: RunHistoryDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const returnTo = document.activeElement;

    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      /*
       * A focus trap. Without it, tabbing past the last control
       * lands on the page behind a panel that is covering it,
       * which for a keyboard or screen-reader user is
       * indistinguishable from the drawer having closed.
       */
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled])"
      );

      if (!focusable || focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);

      if (returnTo instanceof HTMLElement) {
        returnTo.focus();
      }
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const query = search.trim().toLowerCase();

  const visible = query
    ? runs.filter((run) =>
        [run.settings.prompt, run.settings.system]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
    : runs;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-heading"
        /* The scrim closes on click; the panel must not pass its
           own clicks up to it. */
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer__head">
          <h2 className="drawer__title" id="history-heading">
            <History size={16} aria-hidden="true" />
            Run History
          </h2>

          <button
            type="button"
            className="drawer__close"
            aria-label="Close the run history"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <p className="drawer__privacy">
          Runs stay in this browser tab and are cleared when you close it.
          BuildGentic&apos;s server records that a request happened and what it
          cost — never your prompt or the answer.
        </p>

        {query ? (
          <p className="drawer__filter" role="status">
            {visible.length} of {runs.length} run
            {runs.length === 1 ? "" : "s"} match “{search.trim()}”.
          </p>
        ) : null}

        {runs.length === 0 ? (
          <div className="drawer__empty">
            <p className="drawer__empty-title">No runs yet</p>
            <p className="drawer__empty-text">
              Once you have run an experiment twice, this list shows what you
              changed between them.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="drawer__empty">
            <p className="drawer__empty-title">Nothing matched</p>
            <p className="drawer__empty-text">
              No run this session has that in its prompt, system instructions
              or model.
            </p>
          </div>
        ) : (
          <ol className="drawer__list">
            {visible.map((run) => {
              /* The previous run in TIME, taken from the full
                 list — a filtered neighbour would describe a
                 change that never happened. */
              const index = runs.indexOf(run);

              return (
                <HistoryRow
                  key={run.id}
                  run={run}
                  previous={runs[index + 1]}
                  active={run.id === activeId}
                  onRestore={() => onRestore(run)}
                />
              );
            })}
          </ol>
        )}

        {runs.length > 0 ? (
          <div className="drawer__foot">
            <button type="button" className="drawer__clear" onClick={onClear}>
              <Trash2 size={14} aria-hidden="true" />
              Clear this session&apos;s history
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* =========================================================
   ONE RUN
========================================================= */

function HistoryRow({
  run,
  previous,
  active,
  onRestore,
}: {
  run: LabRun;
  previous: LabRun | undefined;
  active: boolean;
  onRestore: () => void;
}) {
  const changes = previous ? diffSettings(previous.settings, run.settings) : [];

  const outcome = describeOutcome(run);

  return (
    <li className={active ? "hrow hrow--active" : "hrow"}>
      <div className="hrow__head">
        <span className={`hrow__badge hrow__badge--${outcome.tone}`}>
          {outcome.label}
        </span>

        <span className="hrow__time">{relativeTime(run.at)}</span>

        <button type="button" className="hrow__load" onClick={onRestore}>
          <RotateCcw size={12} aria-hidden="true" />
          Load
        </button>
      </div>

      <p className="hrow__prompt">{abbreviate(run.settings.prompt, 110)}</p>

      <p className="hrow__facts">
        <span>temp {run.settings.temperature.toFixed(2)}</span>
        {run.done ? (
          <>
            <span>
              {run.done.usage.inputTokens.toLocaleString()} →{" "}
              {run.done.usage.outputTokens.toLocaleString()}
            </span>
            <span>{(run.done.latencyMs / 1000).toFixed(1)} s</span>
          </>
        ) : null}
      </p>

      {previous ? (
        changes.length > 0 ? (
          <ul className="hrow__changes">
            {changes.map((change) => (
              <li key={change.field}>
                <strong>{change.label}</strong>{" "}
                <span className="hrow__from">
                  {abbreviate(change.from, 22)}
                </span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only">changed to</span>
                <span className="hrow__to">{abbreviate(change.to, 22)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hrow__same">
            Identical settings to the run before — any difference in the answer
            came from the model&apos;s own sampling.
          </p>
        )
      ) : null}
    </li>
  );
}

/* =========================================================
   PRESENTATION
========================================================= */

function describeOutcome(run: LabRun): {
  label: string;
  tone: "correct" | "caution" | "error";
} {
  if (run.error) {
    return run.error.code === "cancelled"
      ? { label: "Stopped", tone: "caution" }
      : { label: run.error.code.replace(/_/g, " "), tone: "error" };
  }

  if (run.done?.finishReason === "length") {
    return { label: "Cut off", tone: "caution" };
  }

  return { label: "Completed", tone: "correct" };
}

function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  return `${Math.round(minutes / 60)} h ago`;
}
