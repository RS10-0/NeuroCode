import { useId } from "react";
import type { ReactNode } from "react";
import {
  BookMarked,
  Download,
  FlaskConical,
  Grid3x3,
  History,
  MessagesSquare,
  PenLine,
  Search,
  SquareCheckBig,
  X,
} from "lucide-react";

/*
 * The Lab's own frame, inside BuildGentic's.
 *
 * The global rail — Dashboard, Courses, Lab, Agents, Published —
 * stays exactly where it is and looks exactly as it does
 * everywhere else. This file adds a second, subordinate level
 * of navigation *within* the Lab, and it is horizontal on
 * purpose: a second vertical sidebar beside the first would
 * make two columns compete for the role of primary navigation
 * and would cost the workbench 200px it has better uses for.
 *
 * So the shape is the one a section of a larger product usually
 * takes. A page header with the session's actions on the right,
 * a row of workspace tabs under it, and then the bench.
 *
 * Nothing in this file knows anything about models, quotas or
 * providers. It is the room, not the equipment.
 */

/* =========================================================
   WORKSPACES

   Playground is the one that exists. The rest are the shape of
   the Lab as it is being built out, and they are rendered as
   what they are — visible, ordered, and plainly not ready —
   rather than as tabs that would take a learner nowhere.

   Showing them is a deliberate choice: the Playground makes far
   more sense as one bench in a laboratory than as a page that
   happens to have a prompt box on it. Making them look
   available would be a different, worse choice.
   ========================================================= */

/* The ids of the workspaces that exist. A union rather than a
   string, so a typo in a tab handler is a build error rather
   than a page that renders nothing. */
export type WorkspaceId = "playground" | "prompt-canvas";

interface Workspace {
  id: string;
  label: string;
  hint: string;
  icon: typeof FlaskConical;
  ready: boolean;
}

const WORKSPACES: Workspace[] = [
  {
    id: "playground",
    label: "Playground",
    hint: "Run a prompt and watch what changes",
    icon: FlaskConical,
    ready: true,
  },
  {
    id: "prompt-canvas",
    label: "Prompt Canvas",
    hint: "Run two versions of a prompt and see what changed",
    icon: PenLine,
    ready: true,
  },
  {
    id: "dataset-matrix",
    label: "Dataset Matrix",
    hint: "Run one prompt across many inputs",
    icon: Grid3x3,
    ready: false,
  },
  {
    id: "evaluation-suite",
    label: "Evaluation Suite",
    hint: "Score runs against expectations",
    icon: SquareCheckBig,
    ready: false,
  },
  {
    id: "api-reference",
    label: "API Reference",
    hint: "The endpoints behind this page",
    icon: BookMarked,
    ready: false,
  },
  {
    id: "community-hub",
    label: "Community Hub",
    hint: "Experiments other learners published",
    icon: MessagesSquare,
    ready: false,
  },
];

/* =========================================================
   SHELL
========================================================= */

interface LabShellProps {
  /* Which bench is on screen. Owned by the page rather than by
     the shell, because what the tabs switch between is the
     page's content — the shell only draws them. */
  workspace: WorkspaceId;
  onWorkspace: (id: WorkspaceId) => void;
  /* Search is owned by the page, because what it filters — the
     run history — is the page's state. */
  search: string;
  onSearch: (value: string) => void;
  onOpenHistory: () => void;
  historyCount: number;
  onExport: () => void;
  /* False before a first prompt, when there is no configuration
     worth writing to a file. */
  canExport: boolean;
  /* Null renders no rail and gives the width to the bench. */
  aside: ReactNode;
  children: ReactNode;
}

export default function LabShell({
  workspace,
  onWorkspace,
  search,
  onSearch,
  onOpenHistory,
  historyCount,
  onExport,
  canExport,
  aside,
  children,
}: LabShellProps) {
  return (
    <div className="labshell">
      <LabHeader
        search={search}
        onSearch={onSearch}
        onOpenHistory={onOpenHistory}
        historyCount={historyCount}
        onExport={onExport}
        canExport={canExport}
      />

      <WorkspaceTabs active={workspace} onSelect={onWorkspace} />

      <div className="labmain">{children}</div>

      {/*
        No rail at all when there is nothing to put in it.

        An empty 344px column with a rule down its left edge is a
        promise of content that never arrives, and on the
        Canvas's opening screen — which is deliberately close to
        empty — it was the loudest thing on the page. Omitting
        the element lets the bench take the width back; see
        `.labshell:not(:has(.labside))` in lab.css.
      */}
      {aside ? (
        <aside className="labside" aria-label="Experiment controls">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/* =========================================================
   HEADER

   The title, and the three things that belong to the whole
   session rather than to the current experiment: finding an
   earlier run, reopening the log, and taking a configuration
   away with you.
========================================================= */

interface LabHeaderProps {
  search: string;
  onSearch: (value: string) => void;
  onOpenHistory: () => void;
  historyCount: number;
  onExport: () => void;
  canExport: boolean;
}

function LabHeader({
  search,
  onSearch,
  onOpenHistory,
  historyCount,
  onExport,
  canExport,
}: LabHeaderProps) {
  const searchId = useId();

  return (
    <header className="lab-head">
      <div className="lab-head__text">
        <p className="lab-eyebrow">Lab</p>

        <h1 className="lab-title">AI Lab</h1>

        <p className="lab-lede">
          Change one instruction, run it again, and see exactly what moved.
          Every experiment shows the request that was sent, how long it took,
          and what it cost you.
        </p>
      </div>

      <div className="lab-head__actions">
        <div className="labsearch">
          <Search className="labsearch__icon" size={15} aria-hidden="true" />

          <label className="sr-only" htmlFor={searchId}>
            Search your experiments
          </label>

          <input
            id={searchId}
            type="search"
            className="labsearch__input"
            placeholder="Search your experiments and prompts"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            /*
              Searching opens the log, because the log is the
              only place results can appear. A search box that
              filters something you cannot see is a search box
              that looks broken.
            */
            onFocus={() => {
              if (search.trim()) {
                onOpenHistory();
              }
            }}
          />

          {search ? (
            <button
              type="button"
              className="labsearch__clear"
              aria-label="Clear the search"
              onClick={() => onSearch("")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="labactions">
          <button type="button" className="labaction" onClick={onOpenHistory}>
            <History size={15} aria-hidden="true" />
            <span className="labaction__label">Run History</span>

            {historyCount > 0 ? (
              <span className="labaction__count">{historyCount}</span>
            ) : null}
          </button>

          <button
            type="button"
            className="labaction"
            disabled={!canExport}
            /* A disabled control has to say why, or it reads as
               broken rather than as not yet applicable. */
            title={
              canExport
                ? "Download this experiment's configuration as JSON"
                : "Write a prompt first — there is nothing to export yet."
            }
            onClick={onExport}
          >
            <Download size={15} aria-hidden="true" />
            <span className="labaction__label">Export Config</span>
          </button>
        </div>
      </div>
    </header>
  );
}

/* =========================================================
   WORKSPACE TABS

   Secondary navigation, and it should read that way: smaller
   than the page title, lighter than the global rail, and
   attached to the content below it by an underline rather than
   floated in a box of its own.

   Two of the six are real now. They are a tablist — arrow keys
   move between them, which is what a keyboard user expects of
   something that looks like this — while the four that are not
   built keep the disabled treatment they had, in place, so the
   row still says what the Lab is going to be.
========================================================= */

function WorkspaceTabs({
  active,
  onSelect,
}: {
  active: WorkspaceId;
  onSelect: (id: WorkspaceId) => void;
}) {
  const ready = WORKSPACES.filter((workspace) => workspace.ready);

  /*
   * Left and right move between the tabs that exist, skipping
   * the ones that do not — stopping on a disabled tab would be
   * a dead end a keyboard user has to press through, and the
   * only reason those tabs are focusable at all is so their
   * one-line description can be read.
   *
   * Focus follows the selection. Only the selected tab is in the
   * tab order, so leaving focus behind on the tab you just
   * arrowed away from would strand it on an element with
   * tabIndex -1 — the next Tab press would jump somewhere
   * unrelated, and the arrow keys would appear to have moved a
   * highlight that focus was not attached to.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

    if (step === 0) {
      return;
    }

    event.preventDefault();

    const index = ready.findIndex((workspace) => workspace.id === active);
    const at = (index + step + ready.length) % ready.length;

    onSelect(ready[at].id as WorkspaceId);

    /* The buttons are in document order, and React keeps the
       same DOM nodes across this re-render, so the element can
       be focused straight away rather than after a round trip
       through an effect. */
    const tabs =
      event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');

    tabs[at]?.focus();
  }

  return (
    <nav className="wstabs" aria-label="Lab workspaces">
      <ul className="wstabs__list" role="tablist" onKeyDown={handleKeyDown}>
        {WORKSPACES.map(({ id, label, hint, icon: Icon, ready: built }) => {
          const on = built && id === active;

          return (
            <li key={id} role="presentation">
              {built ? (
                <button
                  type="button"
                  role="tab"
                  className={on ? "wstab wstab--on" : "wstab"}
                  aria-selected={on}
                  /* Only the selected tab is in the tab order;
                     the arrow keys reach the rest. Anything else
                     makes a six-item row six stops on the way to
                     the workbench. */
                  tabIndex={on ? 0 : -1}
                  title={hint}
                  onClick={() => onSelect(id as WorkspaceId)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </button>
              ) : (
                /*
                 * A disabled button rather than a dead link. It
                 * stays in the tab order so a keyboard user can
                 * read what is coming, announces itself as
                 * unavailable, and carries its one-line
                 * description as a title for anyone hovering.
                 */
                <button
                  type="button"
                  className="wstab"
                  aria-disabled="true"
                  title={hint}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                  <span className="wstab__soon">Soon</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* The active workspace's own line, which is the one worth
          reading. The rest carry theirs on hover. */}
      <p className="wstabs__hint">
        {WORKSPACES.find((workspace) => workspace.id === active)?.hint}
      </p>
    </nav>
  );
}
