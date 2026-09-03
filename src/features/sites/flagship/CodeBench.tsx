import { useState, type ReactNode } from "react";

import FlagshipChat from "./FlagshipChat";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import { flagshipCan } from "./identity";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * CODING COACH — the workbench.
 *
 * An editor window, and the only one of the five that is dark,
 * which is a decision about honesty rather than taste: this is
 * the agent a student opens beside their real editor, and a
 * page that glared white next to it would be a page they turn
 * away from.
 *
 * The window chrome is not a picture of an editor. The tab
 * strip switches a real document pane between the brief, the
 * method and the questions people ask, which is the whole of
 * this page's written content — so the "decoration" is where
 * the reading actually happens, rather than being an ornament
 * somebody has to scroll past to reach the session.
 *
 * The gutter numbers are drawn by CSS counters on the blocks
 * themselves. They are `aria-hidden` and outside the flow of
 * the text, so a screen reader gets prose and a sighted reader
 * gets an editor.
 */

type TabId = "brief" | "method" | "faq";

interface Tab {
  id: TabId;
  file: string;
  lang: string;
}

const TABS: Tab[] = [
  { id: "brief", file: "brief.md", lang: "markdown" },
  { id: "method", file: "method.ts", lang: "typescript" },
  { id: "faq", file: "faq.json", lang: "json" },
];

const COMMANDS = [
  {
    label: "explain",
    meta: "Walk me through code I did not write",
    text: "Explain what this code does, line by line, and tell me which parts I should understand before I change anything. Here it is:",
  },
  {
    label: "debug",
    meta: "Find out why it is broken",
    text: "This is not doing what I expect. Ask me what it should do, then help me find the bug myself rather than just telling me the fix. Here is the code and the error:",
  },
  {
    label: "build",
    meta: "Start something from nothing",
    text: "I want to build something small from scratch and actually understand it. Ask me what I am interested in and help me scope it down to something I can finish.",
  },
];

export default function CodeBench({
  slug,
  identity,
  live,
}: FlagshipLayoutProps) {
  const [tab, setTab] = useState<TabId>("brief");

  const reads = flagshipCan("coding-coach", "file_analysis");
  const remembers = flagshipCan("coding-coach", "memory");

  return (
    <div className="fs-bench">
      <div className="fs-bench__wrap">
        <header className="fs-bench__hero">
          <p className="fs-bench__eyebrow">
            <span className="fs-bench__prompt" aria-hidden="true">
              ~/
            </span>
            {identity.eyebrow}
          </p>

          <h1 className="fs-bench__headline">{identity.headline}</h1>

          <p className="fs-bench__deck">{identity.deck}</p>

          <BuildGenticMark />
        </header>

        <div className="fs-bench__window">
          <div className="fs-bench__titlebar">
            <span className="fs-bench__lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>

            <span className="fs-bench__path">
              buildgentic / {identity.name.toLowerCase().replace(/\s+/g, "-")}
            </span>
          </div>

          {/*
            A real tab strip. `role="tablist"` because it is one:
            three panels, one visible, arrow keys and all. The
            alternative — three headings stacked — would have
            been the same words in a shape that says nothing
            about what this page is.
          */}
          <div className="fs-bench__tabs" role="tablist" aria-label="Documents">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`fs-bench-tab-${entry.id}`}
                aria-selected={tab === entry.id}
                /* One panel, swapped in place, so every tab
                   points at the same element rather than at
                   three ids only one of which is ever in the
                   document. */
                aria-controls="fs-bench-panel"
                tabIndex={tab === entry.id ? 0 : -1}
                className="fs-bench__tab"
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;

                  if (step === 0) {
                    return;
                  }

                  event.preventDefault();

                  const index = TABS.findIndex((item) => item.id === tab);
                  const next = TABS[(index + step + TABS.length) % TABS.length];

                  setTab(next.id);

                  /*
                   * Focus follows selection, which is what a
                   * tablist with automatic activation owes
                   * somebody using arrow keys — otherwise the
                   * ring is left on a tab that is no longer the
                   * one being read, and the next arrow press
                   * moves from the wrong place. All three
                   * buttons are always rendered, so this can
                   * run now rather than after a paint.
                   */
                  document.getElementById(`fs-bench-tab-${next.id}`)?.focus();
                }}
              >
                <span className="fs-bench__tabdot" aria-hidden="true" />
                {entry.file}
              </button>
            ))}
          </div>

          <div className="fs-bench__panes">
            <section
              className="fs-bench__doc"
              role="tabpanel"
              id="fs-bench-panel"
              aria-labelledby={`fs-bench-tab-${tab}`}
              tabIndex={0}
            >
              <Document tab={tab} />
            </section>

            <div className="fs-bench__session">
              <FlagshipChat
                slug={slug}
                identity={identity}
                live={live}
                variant="bench"
                prompts={COMMANDS}
                head={
                  <header className="fs-bench__sessionhead">
                    <span className="fs-bench__sessionlabel">session</span>
                    <span className="fs-bench__sessionmeta">
                      {identity.name.toLowerCase().replace(/\s+/g, "-")} · shell
                    </span>
                  </header>
                }
                mark={(turn) => (
                  <span className="fs-bench__turnmark">
                    {turn.role === "user" ? "❯" : "//"}
                  </span>
                )}
                opening={
                  <div className="fs-bench__opening">
                    <p className="fs-bench__openingline">
                      <span aria-hidden="true">$ </span>
                      coach --help
                    </p>
                    <p className="fs-bench__openingtitle">
                      {identity.chat.openingTitle}
                    </p>
                    <p className="fs-bench__openingbody">
                      {identity.chat.openingBody}
                      <span className="fs-bench__blink" aria-hidden="true" />
                    </p>
                  </div>
                }
              />
            </div>
          </div>

          {/*
            The status bar states capabilities, and it reads them
            from the catalogue rather than asserting them. A
            claim on a status bar is the most believable kind of
            claim a page makes, so it is the last place that
            should be able to go stale.
          */}
          <div className="fs-bench__status">
            <span className="fs-bench__statusdot" aria-hidden="true" />
            <span className="fs-bench__statusitem">
              {live ? "connected" : "paused"}
            </span>
            {reads ? (
              <span className="fs-bench__statusitem">reads files</span>
            ) : null}
            {remembers ? (
              <span className="fs-bench__statusitem">remembers you</span>
            ) : null}
            <span className="fs-bench__statusitem fs-bench__statusitem--push">
              explains · does not hand over the answer
            </span>
          </div>
        </div>

        <FlagshipFooter identity={identity} />
      </div>
    </div>
  );
}

/* =========================================================
   THE DOCUMENT PANE

   One component, three documents. Each block is a "line" as
   far as the gutter is concerned; the numbers come from a CSS
   counter so nothing here has to know its own position.
========================================================= */

function Document({ tab }: { tab: TabId }) {
  if (tab === "method") {
    return (
      <Lines>
        <Comment>// how a session usually goes</Comment>
        <Line>
          <Key>1.</Key> You paste the code and what it should be doing. Both
          halves matter — a bug is only a bug against an expectation.
        </Line>
        <Line>
          <Key>2.</Key> It asks you what you think is happening before it says
          what is happening. Answering that badly is how you find out where the
          model in your head is wrong.
        </Line>
        <Line>
          <Key>3.</Key> It points at the line and names the category — off-by-one,
          shadowed variable, async that never awaited — so the next one is
          yours to spot.
        </Line>
        <Line>
          <Key>4.</Key> You write the fix. It reads it back and tells you
          whether it holds for the cases you did not try.
        </Line>
        <Comment>
          // it will refuse to just paste the answer. that is not politeness,
          // it is the entire product.
        </Comment>
      </Lines>
    );
  }

  if (tab === "faq") {
    return (
      <Lines>
        <Line>
          <Key>Q:</Key> Will it write my homework?
        </Line>
        <Line>
          <Value>
            No. It will explain anything, review anything, and refuse to hand
            you a finished answer you did not build.
          </Value>
        </Line>
        <Line>
          <Key>Q:</Key> Which languages?
        </Line>
        <Line>
          <Value>
            The ones students actually turn up with — Python, JavaScript and
            TypeScript, Java, HTML and CSS, SQL. It is honest when a language
            is outside what it knows well.
          </Value>
        </Line>
        <Line>
          <Key>Q:</Key> I am completely new. Is this for me?
        </Line>
        <Line>
          <Value>
            Yes. Say so in the first message and it will start further back
            rather than assuming you know what a stack trace is.
          </Value>
        </Line>
      </Lines>
    );
  }

  return (
    <Lines>
      <Heading># What this is</Heading>
      <Line>
        A coach for the part of programming nobody teaches: reading an error
        properly, forming a guess, and testing the guess.
      </Line>
      <Heading># What you bring</Heading>
      <Line>
        Broken code, a stack trace, a half-finished idea, or a file you have
        been handed and do not understand.
      </Line>
      <Heading># What you leave with</Heading>
      <Line>
        The fix, written by you, and the reason it was broken — stated plainly
        enough that you will recognise the shape of it next time.
      </Line>
    </Lines>
  );
}

function Lines({ children }: { children: ReactNode }) {
  return <div className="fs-bench__lines">{children}</div>;
}

function Line({ children }: { children: ReactNode }) {
  return <p className="fs-bench__line">{children}</p>;
}

function Heading({ children }: { children: ReactNode }) {
  return <p className="fs-bench__line fs-bench__line--head">{children}</p>;
}

function Comment({ children }: { children: ReactNode }) {
  return <p className="fs-bench__line fs-bench__line--comment">{children}</p>;
}

function Key({ children }: { children: ReactNode }) {
  return <span className="fs-bench__key">{children}</span>;
}

function Value({ children }: { children: ReactNode }) {
  return <span className="fs-bench__value">{children}</span>;
}
