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
 * The global rail — Dashboard, Courses, Lab, Agents, Projects —
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
    hint: "Compose and version longer prompts",
    icon: PenLine,
    ready: false,
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
  aside: ReactNode;
  children: ReactNode;
}

export default function LabShell({
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

      <WorkspaceTabs />

      <div className="labmain">{children}</div>

      <aside className="labside" aria-label="Experiment controls">
        {aside}
      </aside>
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
========================================================= */

function WorkspaceTabs() {
  return (
    <nav className="wstabs" aria-label="Lab workspaces">
      <ul className="wstabs__list">
        {WORKSPACES.map(({ id, label, hint, icon: Icon, ready }) => (
          <li key={id}>
            {ready ? (
              <span className="wstab wstab--on" aria-current="page">
                <Icon size={15} aria-hidden="true" />
                {label}
              </span>
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
        ))}
      </ul>

      {/* The active workspace's own line, which is the one worth
          reading. The rest carry theirs on hover. */}
      <p className="wstabs__hint">
        {WORKSPACES.find((workspace) => workspace.ready)?.hint}
      </p>
    </nav>
  );
}
