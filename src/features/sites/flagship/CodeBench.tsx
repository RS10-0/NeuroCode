import { useCallback, useRef, useState, type ReactNode } from "react";

import FlagshipChat from "./FlagshipChat";
import {
  attachmentBlock,
  describeFile,
  readCodeFile,
  MAX_FILES,
  type CodeFile,
} from "./textfiles";
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
 *
 * KEEPING THE WORKBENCH WITHOUT KEEPING THE DOOR POLICY.
 *
 * The window, the tabs, the gutter and the shell prompt stay,
 * because they are what makes this page the one a student opens
 * beside their editor. What changed is the set of small signals
 * that quietly said "you should already know this": the command
 * cards now lead with the plain sentence and keep the slash
 * command as the smaller second line, the first card is for
 * somebody who has never done this before, and the hero says
 * out loud that no experience is assumed. None of that is a
 * softer product — the agent still refuses to hand over the
 * answer — it is the difference between a workbench and a
 * members' club.
 *
 * DROPPING A FILE.
 *
 * The agent's own starter prompt has always said "paste code or
 * upload file" and this page never had an upload. It does now,
 * and `textfiles.ts` explains at length what it really is: a
 * source file is text, so the browser reads it and its contents
 * ride along inside the message. Nothing is uploaded anywhere,
 * no capability has to be on for it to work, and a PDF or a
 * screenshot is refused by name rather than pasted as
 * gibberish.
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

/*
 * Four ways in, and the first one is the reason this list
 * changed.
 *
 * A page whose only openings are `explain`, `debug` and `build`
 * has quietly assumed you already have code and already know
 * which of those three you need. The most common state a
 * student is actually in — never done this, does not know what
 * a stack trace is, not sure this page is for them — was
 * answered nowhere except the third tab of a document pane.
 * It is the first card now.
 *
 * `meta` leads and `label` follows: the plain sentence is what
 * somebody is choosing between, and the slash command is the
 * flavour, not the interface.
 */
const COMMANDS = [
  {
    label: "start",
    meta: "New to this? Start from the beginning",
    text: "I am new to programming and I am not sure where to start. Do not assume I know what a stack trace or a function signature is. Ask me what I am trying to do — or what I have been set — and take it from there.",
  },
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

/* Helps the file picker default to something useful without
   stopping anybody choosing "all files" — an unfamiliar
   extension is read if it looks like text, and refused with a
   reason if it does not. See textfiles.ts. */
const FILE_ACCEPT =
  "text/*,.py,.js,.mjs,.jsx,.ts,.tsx,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.sql,.html,.css,.scss,.json,.yml,.yaml,.sh,.md,.txt,.log,.csv";

export default function CodeBench({
  slug,
  identity,
  live,
  offline,
}: FlagshipLayoutProps) {
  const [tab, setTab] = useState<TabId>("brief");
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pickerRef = useRef<HTMLInputElement | null>(null);

  const remembers = flagshipCan("coding-coach", "memory");

  /*
   * Reads what was dropped or chosen, and says what it could
   * not take.
   *
   * Every refusal `readCodeFile` produces is surfaced rather
   * than swallowed: a file that silently fails to appear is the
   * worst outcome here, because the visitor goes on to ask a
   * question about code the coach cannot see.
   */
  const addFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) {
        return;
      }

      /*
       * Copied out of the FileList before the first `await`,
       * and that is load-bearing rather than tidy.
       *
       * A FileList is live. The picker's change handler clears
       * `input.value` so the same file can be chosen twice in a
       * row, and that clear lands while this function is
       * suspended on the read below — at which point the list
       * it was handed is empty. Reading `list.length` after the
       * await therefore saw 0, and the "only so many at a time"
       * warning never fired: files were dropped in silence,
       * which is the one failure this whole function exists to
       * prevent.
       */
      const incoming = Array.from(list);
      const room = MAX_FILES - files.length;

      if (room <= 0) {
        setFileNote(`Already holding ${MAX_FILES} files — remove one first.`);
        return;
      }

      const chosen = incoming.slice(0, room);
      const results = await Promise.all(chosen.map(readCodeFile));

      const added: CodeFile[] = [];
      const problems: string[] = [];

      for (const result of results) {
        if (result.ok) {
          added.push(result.file);
        } else {
          problems.push(`${result.name} — ${result.reason}`);
        }
      }

      if (incoming.length > chosen.length) {
        problems.push(
          `Only ${MAX_FILES} files at a time — ${
            incoming.length - chosen.length
          } not added.`
        );
      }

      if (added.length > 0) {
        setFiles((current) => [...current, ...added]);
      }

      setFileNote(problems.length > 0 ? problems.join(" ") : null);
    },
    [files.length]
  );

  const removeFile = useCallback((id: string) => {
    setFiles((current) => current.filter((entry) => entry.id !== id));
    setFileNote(null);
  }, []);

  /* Sent with the question rather than instead of it — see
     `suffix` in FlagshipChat, and `attachmentBlock`. */
  const attachment = files.length > 0 ? attachmentBlock(files) : "";

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

          {/* Said plainly, above the fold, because the rest of
              this page looks like a terminal and a terminal is
              the thing that puts a beginner off it. */}
          <p className="fs-bench__welcome">
            <span className="fs-bench__welcomemark" aria-hidden="true">
              #
            </span>
            No experience assumed. Drop a file in, paste an error, or say you
            have never done this before — all three are a normal way to start.
          </p>

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

            {/*
              The whole session pane is the drop target, not
              just the strip that shows the result. Aiming a
              dragged file at a 40px band is a fiddly gesture
              that fails often enough to be worse than no drag
              at all; the affordance below says what happened.

              `dragleave` fires on every child boundary crossed
              on the way in, so it only counts when the pointer
              has genuinely left the container.
            */}
            <div
              className="fs-bench__session"
              data-dragging={dragging ? "true" : undefined}
              onDragOver={(event) => {
                if (!live) {
                  return;
                }

                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                if (
                  !event.relatedTarget ||
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setDragging(false);
                }
              }}
              onDrop={(event) => {
                if (!live) {
                  return;
                }

                event.preventDefault();
                setDragging(false);
                void addFiles(event.dataTransfer.files);
              }}
            >
              <FlagshipChat
                slug={slug}
                identity={identity}
                live={live}
                offline={offline}
                variant="bench"
                /*
                 * A suggested prompt carries its own complete
                 * text and never takes the suffix, so the
                 * attachment is folded in here instead. Three
                 * of these four end mid-sentence — "Here it
                 * is:" — which is exactly where a file belongs.
                 */
                prompts={COMMANDS.map((command) =>
                  attachment
                    ? { ...command, text: `${command.text}\n\n${attachment}` }
                    : command
                )}
                suffix={attachment || undefined}
                beforeForm={
                  <div className="fs-bench__attach">
                    <input
                      ref={pickerRef}
                      type="file"
                      multiple
                      accept={FILE_ACCEPT}
                      className="fs-bench__attachinput"
                      aria-label="Add code files"
                      onChange={(event) => {
                        void addFiles(event.target.files);
                        /* So choosing the same file twice in a
                           row still fires a change. */
                        event.target.value = "";
                      }}
                    />

                    <div className="fs-bench__attachrow">
                      <button
                        type="button"
                        className="fs-bench__attachbtn"
                        onClick={() => pickerRef.current?.click()}
                      >
                        <span aria-hidden="true">+</span> Add a code file
                      </button>

                      <span className="fs-bench__attachhint">
                        {dragging
                          ? "Drop it anywhere here"
                          : "or drag one onto this panel"}
                      </span>
                    </div>

                    {files.length > 0 ? (
                      <ul className="fs-bench__chips">
                        {files.map((file) => (
                          <li className="fs-bench__chip" key={file.id}>
                            <span className="fs-bench__chipname">
                              {file.name}
                            </span>
                            <span className="fs-bench__chipmeta">
                              {describeFile(file)}
                            </span>
                            <button
                              type="button"
                              className="fs-bench__chipx"
                              aria-label={`Remove ${file.name}`}
                              onClick={() => removeFile(file.id)}
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {/* A live region: a refusal that appeared
                        silently would leave somebody asking
                        about code that was never sent. */}
                    <p
                      className="fs-bench__attachnote"
                      role="status"
                      aria-live="polite"
                    >
                      {fileNote}
                    </p>
                  </div>
                }
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
            The status bar states capabilities, and a claim on a
            status bar is the most believable kind a page makes,
            so it is the last place that should be able to go
            stale. `remembers you` is therefore read from the
            catalogue rather than asserted.

            THE FILE LINE IS NOT, AND THE CHANGE IS DELIBERATE.
            It used to say "reads files" on the strength of the
            agent's `file_analysis` capability — which is real,
            and which the published door cannot reach: the
            public endpoint takes messages and nothing else. So
            the old line was true about the agent and false
            about this page. What this page can honestly say is
            what it now does, which is read text files in the
            browser and send their contents along.
          */}
          <div className="fs-bench__status">
            <span className="fs-bench__statusdot" aria-hidden="true" />
            <span className="fs-bench__statusitem">
              {live ? "connected" : "paused"}
            </span>
            <span className="fs-bench__statusitem">reads code files</span>
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
