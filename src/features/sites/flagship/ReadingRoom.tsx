import { useCallback, useEffect, useRef, useState } from "react";

import FlagshipChat from "./FlagshipChat";
import { badgeFor, hostOf } from "./sources";
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
 * RESEARCH ASSISTANT — the reading room.
 *
 * Still set as a journal paper, because the apparatus of one is
 * exactly the apparatus this agent is trying to teach: a
 * question stated plainly, a method you can check, a ledger of
 * what counts as a source, and caveats written down rather than
 * buried in prose.
 *
 * WHAT CHANGED IS THAT THE PAGE NOW KNOWS WHERE YOU ARE.
 *
 * An essay is not one activity. Finding a question, reading and
 * annotating, drafting, and fixing citations are four different
 * jobs a fortnight apart, and the old page offered the same
 * three enquiries to all of them. The stage tracker is the fix:
 * pick the week you are actually in and the launchpad below
 * becomes the three things that matter in that week. It is the
 * same argument the career board's rail makes — a path you join
 * where you are — applied to a piece of work rather than a
 * life.
 *
 * THE LEDGER IS THE STUDENT'S, NOT THE AGENT'S.
 *
 * Sources pinned there are typed or saved by the reader and
 * kept in their own browser. Nothing is sent anywhere and
 * nothing is graded. The badge beside a source says only what
 * its ADDRESS proves — see sources.ts, which refuses to score
 * anything — and every badge carries the caveat that goes with
 * it, because "on a university domain" and "good" are not the
 * same claim and the whole point of this agent is knowing the
 * difference.
 *
 * WHAT THE PAGE WILL NOT DO. It will not tell you a source is
 * peer-reviewed: a hostname cannot establish that, and a badge
 * claiming it would teach exactly the habit this agent exists
 * to break. It will not write a citation either — the format
 * switcher tells the AGENT which style to answer in; the
 * formatting is its work, and it can say when it is unsure of a
 * field.
 */

/* =========================================================
   THE STAGES
========================================================= */

interface Action {
  id: string;
  glyph: string;
  title: string;
  body: string;
  cta: string;
  /* Sent with whatever is attached appended. */
  directive: string;
}

interface Stage {
  id: string;
  index: string;
  glyph: string;
  label: string;
  question: string;
  actions: Action[];
}

const STAGES: Stage[] = [
  {
    id: "topic",
    index: "01",
    glyph: "🎯",
    label: "Topic & Sources",
    question: "What am I actually asking?",
    actions: [
      {
        id: "credibility",
        glyph: "🔍",
        title: "Source & credibility check",
        body: "Paste an article, a link or a claim and get bias, funding, review status and whether it would survive a marker.",
        cta: "Check a source",
        directive:
          "Source check. Look at what I have pasted below and tell me: who wrote it and what they are for, whether it has been through review of any kind, who funded it, what it is good evidence OF and what it is not, and whether I could defend citing it. Where you cannot establish something, say so plainly rather than guessing.",
      },
      {
        id: "question",
        glyph: "🎯",
        title: "Narrow a topic into a question",
        body: "Turn a subject you like into something arguable, answerable, and the right size for the word count.",
        cta: "Sharpen the question",
        directive:
          "Help me turn a topic into a research question. Ask me the word count and the subject, then show me two or three candidate questions at different scopes and say what evidence each one would need. Do not pick for me.",
      },
      {
        id: "landscape",
        glyph: "🗺️",
        title: "Map what is already out there",
        body: "Who the main voices are, where they disagree, and which debate you would be joining.",
        cta: "Map the field",
        directive:
          "Give me the lay of the land on the topic below: the main positions people take, where the genuine disagreement is, and which of those debates a student essay could realistically join. Name specific work where you can, and say where you are unsure.",
      },
    ],
  },
  {
    id: "annotate",
    index: "02",
    glyph: "📝",
    label: "Annotate & Outline",
    question: "What does this actually say?",
    actions: [
      {
        id: "annotate",
        glyph: "📌",
        title: "Annotate & summarise",
        body: "Dense academic text in, key claims out — the method, the limitations, and quotes worth keeping.",
        cta: "Annotate this",
        directive:
          "Annotate the text below. Give me: the central claim in one sentence, the method or evidence it rests on, its stated limitations, and two or three direct quotations worth keeping with a note on what each one is useful FOR. Quote exactly; do not paraphrase into quotation marks.",
      },
      {
        id: "outline",
        glyph: "🧱",
        title: "Build an outline from my notes",
        body: "Group findings into an argument, name the contradictions, and show what is still missing.",
        cta: "Shape an outline",
        directive:
          "Turn the notes below into an outline. Group the findings into an argument rather than by source, name every contradiction rather than smoothing it, and end with a list of what I still have no evidence for.",
      },
      {
        id: "gaps",
        glyph: "🕳️",
        title: "Find the holes in my reading",
        body: "What a marker would notice is missing — a perspective, a decade, a counter-position.",
        cta: "Find the gaps",
        directive:
          "Look at the sources and notes below and tell me what is missing: a perspective I have not read, a time period I have skipped, a counter-position I am not engaging with, or an over-reliance on one author. Be specific about what to go and find.",
      },
    ],
  },
  {
    id: "draft",
    index: "03",
    glyph: "✍️",
    label: "Draft & Feedback",
    question: "Does the argument hold?",
    actions: [
      {
        id: "logic",
        glyph: "🛠️",
        title: "Draft feedback & logic audit",
        body: "Flow, argument strength, and the places a claim is carrying more weight than its evidence.",
        cta: "Review the draft",
        directive:
          "Read the draft below as a marker would. Tell me where the argument does not follow, where a claim is carrying more weight than its evidence supports, where a paragraph fails to earn the next one, and where the tone slips out of academic register. Quote the exact sentences. Do not rewrite it for me.",
      },
      {
        id: "counter",
        glyph: "⚔️",
        title: "Argue against me",
        body: "The strongest objection to your thesis, so you can answer it before a marker raises it.",
        cta: "Attack the thesis",
        directive:
          "Take the strongest possible position against the argument below. Give me the best counterargument a well-read critic would make, the evidence they would cite, and what my draft would have to do to answer it honestly.",
      },
      {
        id: "evidence",
        glyph: "⚖️",
        title: "Check evidence against claims",
        body: "Every claim matched to what supports it, and every claim that has nothing.",
        cta: "Audit the evidence",
        directive:
          "Go through the draft below claim by claim. For each substantial claim, say what evidence in the text supports it and how strong that support is. List separately every claim that is carrying no evidence at all.",
      },
    ],
  },
  {
    id: "cite",
    index: "04",
    glyph: "📚",
    label: "Citation & Proofing",
    question: "Is it ready to hand in?",
    actions: [
      {
        id: "citation",
        glyph: "📑",
        title: "Citations & bibliography",
        body: "Every source formatted in the style you are marked in, with the fields a reader needs to find it.",
        cta: "Build citations",
        directive:
          "Format the sources below as citations. Give me both the in-text form and the bibliography entry for each, in the style named above. If a source is missing a field the style requires — a date, a publisher, a page range — say which field is missing rather than inventing it.",
      },
      {
        id: "consistency",
        glyph: "🔎",
        title: "Check my citations are consistent",
        body: "Mismatched styles, missing page numbers, and sources cited but never listed.",
        cta: "Check consistency",
        directive:
          "Check the citations in the text below for consistency: mixed styles, missing page numbers, entries formatted differently from each other, anything cited in the text but absent from the bibliography or the other way round. List what to fix.",
      },
      {
        id: "proof",
        glyph: "✅",
        title: "Last read before hand-in",
        body: "The read that catches what you stopped seeing three drafts ago.",
        cta: "Do the last read",
        directive:
          "Last read before this is handed in. Grammar, punctuation, agreement, repeated words, inconsistent terminology, anything that would cost easy marks. List them; do not rewrite the piece.",
      },
    ],
  },
];

/* =========================================================
   THE READING MOVES

   Cross-cutting rather than per-stage, and that is the point:
   these four are things you do to a text whenever you meet
   one, which is why they sit over the composer at every stage
   instead of moving with the tracker.
========================================================= */

const MOVES = [
  {
    id: "counter",
    label: "Find counterarguments",
    directive:
      "Read the text below for what argues against it. What would a serious critic say, and what would they cite?",
  },
  {
    id: "quotes",
    label: "Extract direct quotes",
    directive:
      "Pull the quotable lines out of the text below. Quote exactly, give me each one with a note on what it is evidence FOR, and do not paraphrase into quotation marks.",
  },
  {
    id: "bias",
    label: "Check bias",
    directive:
      "Read the text below for bias. Who is speaking, what do they gain, what is framed as settled that is not, and what has been left out?",
  },
  {
    id: "abstract",
    label: "Simplify the abstract",
    directive:
      "Put the text below into plain English without losing what it actually claims. Then tell me which technical terms I genuinely need to keep and what each one means.",
  },
];

/* =========================================================
   CITATION STYLES

   The switcher does not format anything — it tells the AGENT
   which style to answer in, carried on every request as a
   prefix so a two-word follow-up is still in the right style.
========================================================= */

const STYLES = ["APA 7", "MLA 9", "Chicago", "Harvard"];

/* =========================================================
   THE LEDGER

   The student's own shelf, in their own browser. Same storage
   convention as the rest of this feature — `neurolink.site.`
   prefixed and per-slug — so a second agent's page does not
   inherit it and clearing site data forgets it.
========================================================= */

interface Pinned {
  id: string;
  text: string;
  note?: string;
}

const ledgerKey = (slug: string): string => `neurolink.site.ledger.${slug}`;
const styleKey = (slug: string): string => `neurolink.site.citestyle.${slug}`;

function readLedger(slug: string): Pinned[] {
  try {
    const raw = window.localStorage.getItem(ledgerKey(slug));
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    if (!Array.isArray(parsed)) {
      return [];
    }

    /* Validated item by item rather than trusted: this is the
       one input on the page that survives a reload, so a
       hand-edited or half-written value must not take the
       whole ledger down with it. */
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }

      const { id, text, note } = entry as Record<string, unknown>;

      return typeof id === "string" && typeof text === "string"
        ? [{ id, text, note: typeof note === "string" ? note : undefined }]
        : [];
    });
  } catch {
    return [];
  }
}

function readStyle(slug: string): string {
  try {
    const raw = window.localStorage.getItem(styleKey(slug));

    return raw && STYLES.includes(raw) ? raw : STYLES[0];
  } catch {
    return STYLES[0];
  }
}

let pinCounter = 0;

export default function ReadingRoom({
  slug,
  identity,
  live,
  offline,
}: FlagshipLayoutProps) {
  const [stageId, setStageId] = useState<string>(STAGES[0].id);
  const [style, setStyle] = useState<string>(() => readStyle(slug));
  const [pinned, setPinned] = useState<Pinned[]>(() => readLedger(slug));
  const [pinDraft, setPinDraft] = useState("");
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(
    null
  );
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();

  const pickerRef = useRef<HTMLInputElement | null>(null);

  const stage = STAGES.find((entry) => entry.id === stageId) ?? STAGES[0];

  /* Read from the catalogue, never asserted here. Switching web
     search off for this agent has to switch this sentence off
     with it — the reasoning in FlagshipStore.flagshipSections. */
  const searches = flagshipCan("research-assistant", "web_search");

  useEffect(() => {
    try {
      window.localStorage.setItem(ledgerKey(slug), JSON.stringify(pinned));
    } catch {
      /* A full or blocked store loses the shelf on reload and
         nothing else. Not worth interrupting a reader over. */
    }
  }, [slug, pinned]);

  useEffect(() => {
    try {
      window.localStorage.setItem(styleKey(slug), style);
    } catch {
      /* As above. */
    }
  }, [slug, style]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(null), 1800);

    return () => window.clearTimeout(timer);
  }, [copied]);

  /* A changed id rather than changed text, so pressing the same
     control twice is two questions — see `ask` in FlagshipChat. */
  const send = useCallback((text: string) => {
    setAsk((current) => ({ text, id: (current?.id ?? 0) + 1 }));
  }, []);

  const attachment = files.length > 0 ? attachmentBlock(files) : "";

  /*
   * Every action carries the citation style and whatever is
   * attached.
   *
   * The style is added HERE rather than left to FlagshipChat's
   * `prefix`, which applies only to text somebody typed. The
   * launchpad cards, the reading moves and the ledger's buttons
   * all go through `ask`, which sends verbatim — so the
   * switcher's promise ("sent with every question") was true of
   * the composer and false of every card on the page, which is
   * how most of it is actually used.
   *
   * The attachment means nobody pastes the same three pages
   * twice to get two kinds of reading on them. Empty is fine:
   * the agent asks for the text.
   */
  const sendWithFiles = useCallback(
    (directive: string) => {
      const withStyle = `Citation style: ${style}.\n\n${directive}`;

      send(attachment ? `${withStyle}\n\n---\n\n${attachment}` : withStyle);
    },
    [attachment, send, style]
  );

  const addFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) {
        return;
      }

      /* Copied out before the first await: a FileList is live
         and the picker's reset empties it mid-read. Same trap
         the workbench documents at length. */
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
          `Only ${MAX_FILES} at a time — ${
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

  const pin = useCallback((text: string, note?: string) => {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    pinCounter += 1;
    setPinned((current) => [
      ...current,
      { id: `p${pinCounter}-${Date.now()}`, text: trimmed, note },
    ]);
  }, []);

  const copy = useCallback((id: string, text: string) => {
    if (!navigator.clipboard) {
      setCopied({ id, ok: false });
      return;
    }

    navigator.clipboard.writeText(text).then(
      () => setCopied({ id, ok: true }),
      () => setCopied({ id, ok: false })
    );
  }, []);

  return (
    <div className="fs-room">
      <header className="fs-room__runninghead">
        <div className="fs-room__headwrap">
          <span className="fs-room__headleft">
            BuildGentic · {identity.name}
          </span>
          <span className="fs-room__headright">{identity.eyebrow}</span>
          <BuildGenticMark label="" />
        </div>
      </header>

      <div className="fs-room__wrap">
        <section className="fs-room__titleblock">
          <h1 className="fs-room__title">{identity.headline}</h1>

          <p className="fs-room__byline">
            A BuildGentic flagship agent
            {searches ? ", with live source retrieval" : ""}
          </p>

          <p className="fs-room__deck">{identity.deck}</p>
        </section>

        {/*
          THE STAGE TRACKER.

          A list, semantically, because that is what it is. Each
          stage is a button so it is reachable by keyboard in
          reading order, and the connector between two stages is
          owned by the one on its left — a segment its own column
          wide plus the grid gap, which is the distance between
          two markers by construction. Same mechanism the career
          board uses, and it turns ninety degrees on a phone by
          swapping a width for a height.
        */}
        <nav className="fs-room__tracker" aria-label="Where you are">
          <ol className="fs-room__stages">
            {STAGES.map((entry, index) => {
              const active = entry.id === stageId;
              const reached = STAGES.findIndex((s) => s.id === stageId);

              return (
                <li className="fs-room__stage" key={entry.id}>
                  <button
                    type="button"
                    className="fs-room__stagebtn"
                    data-state={
                      active ? "active" : index < reached ? "done" : "ahead"
                    }
                    aria-pressed={active}
                    /*
                     * Switches the launchpad and asks nothing.
                     *
                     * The career board's rail sends on click
                     * because a stage there IS the question.
                     * Here a stage is a filter over three cards,
                     * and firing a request every time somebody
                     * looked at what stage 3 offers would spend
                     * their allowance on browsing. The cards
                     * below are what asks.
                     */
                    onClick={() => setStageId(entry.id)}
                  >
                    {index < STAGES.length - 1 ? (
                      <span
                        className="fs-room__track"
                        data-lit={index < reached ? "true" : undefined}
                        aria-hidden="true"
                      />
                    ) : null}

                    <span className="fs-room__marker" aria-hidden="true">
                      {entry.glyph}
                    </span>

                    <span className="fs-room__stageindex">{entry.index}</span>
                    <span className="fs-room__stagelabel">{entry.label}</span>
                    <span className="fs-room__stagequestion">
                      {entry.question}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="fs-room__board">
          <div className="fs-room__main">
            {/*
              THE LAUNCHPAD, which really does change with the
              stage — three different jobs, not three relabelled
              ones. One control per card: the whole panel is the
              target and it is one tab stop.
            */}
            <section
              className="fs-room__launch"
              aria-label={`${stage.label} — ways in`}
            >
              {stage.actions.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  className="fs-room__card"
                  disabled={!live}
                  onClick={() => sendWithFiles(action.directive)}
                >
                  <span className="fs-room__cardglyph" aria-hidden="true">
                    {action.glyph}
                  </span>

                  <span className="fs-room__cardtitle">{action.title}</span>
                  <span className="fs-room__cardbody">{action.body}</span>

                  <span className="fs-room__cardcta">
                    {action.cta}
                    <span className="fs-room__cardarrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </button>
              ))}
            </section>

            {/*
              The desk. The whole panel takes a dropped file —
              aiming at a strip is a gesture that fails often
              enough to be worse than no drag at all.
            */}
            <div
              className="fs-room__desk"
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
                variant="room"
                ask={ask}
                /* The style rides on every typed message, so a
                   two-word follow-up is still in the right one. */
                prefix={`Citation style: ${style}.`}
                suffix={attachment || undefined}
                head={
                  <header className="fs-room__deskhead">
                    <span className="fs-room__desklabel">Enquiry desk</span>
                    <span className="fs-room__deskstage">
                      {stage.index} · {stage.label}
                    </span>
                  </header>
                }
                mark={(turn) => (
                  <span className="fs-room__turnmark">
                    {turn.role === "user" ? "Q" : "A"}
                  </span>
                )}
                foot={(turn) => {
                  if (
                    turn.role !== "assistant" ||
                    turn.failed ||
                    turn.id === "greeting" ||
                    !turn.content
                  ) {
                    return null;
                  }

                  const flash = copied?.id === turn.id ? copied : null;

                  return (
                    <div className="fs-room__answertools">
                      <button
                        type="button"
                        className="fs-room__answertool"
                        onClick={() => copy(turn.id, turn.content)}
                      >
                        <span aria-hidden="true">⧉</span>{" "}
                        {flash ? (flash.ok ? "Copied" : "Copy failed") : "Copy"}
                      </button>

                      <button
                        type="button"
                        className="fs-room__answertool"
                        onClick={() =>
                          pin(turn.content.slice(0, 400), "Saved answer")
                        }
                      >
                        <span aria-hidden="true">＋</span> Save to ledger
                      </button>
                    </div>
                  );
                }}
                opening={
                  <div className="fs-room__opening">
                    <p className="fs-room__openingtitle">
                      {identity.chat.openingTitle}
                    </p>
                    <p className="fs-room__openingbody">
                      {identity.chat.openingBody}
                    </p>
                  </div>
                }
                beforeForm={
                  <div className="fs-room__deskfoot">
                    <div
                      className="fs-room__moves"
                      role="group"
                      aria-label="Reading moves"
                    >
                      {MOVES.map((move) => (
                        <button
                          type="button"
                          key={move.id}
                          className="fs-room__move"
                          onClick={() => sendWithFiles(move.directive)}
                        >
                          {move.label}
                        </button>
                      ))}
                    </div>

                    <input
                      ref={pickerRef}
                      type="file"
                      multiple
                      accept="text/*,.txt,.md,.markdown,.rtf,.csv,.json,.html,.tex,.bib"
                      className="fs-room__pickerinput"
                      aria-label="Add text files"
                      onChange={(event) => {
                        void addFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />

                    <div className="fs-room__attachrow">
                      <button
                        type="button"
                        className="fs-room__attachbtn"
                        onClick={() => pickerRef.current?.click()}
                      >
                        <span aria-hidden="true">+</span> Add a text file
                      </button>

                      <span className="fs-room__attachhint">
                        {dragging
                          ? "Drop it anywhere on the desk"
                          : "or drop one here — plain text, not PDF"}
                      </span>
                    </div>

                    {files.length > 0 ? (
                      <ul className="fs-room__chips">
                        {files.map((file) => (
                          <li className="fs-room__chip" key={file.id}>
                            <span className="fs-room__chipname">
                              {file.name}
                            </span>
                            <span className="fs-room__chipmeta">
                              {describeFile(file)}
                            </span>
                            <button
                              type="button"
                              className="fs-room__chipx"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setFiles((current) =>
                                  current.filter(
                                    (entry) => entry.id !== file.id
                                  )
                                )
                              }
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <p
                      className="fs-room__attachnote"
                      role="status"
                      aria-live="polite"
                    >
                      {fileNote}
                    </p>
                  </div>
                }
              />
            </div>
          </div>

          {/* ----- THE LEDGER ----- */}
          <aside className="fs-room__ledgerpanel">
            <section className="fs-room__block">
              <h2 className="fs-room__blocklabel">Citation style</h2>

              <div
                className="fs-room__styles"
                role="group"
                aria-label="Citation style"
              >
                {STYLES.map((entry) => (
                  <button
                    type="button"
                    key={entry}
                    className="fs-room__style"
                    aria-pressed={style === entry}
                    onClick={() => setStyle(entry)}
                  >
                    {entry}
                  </button>
                ))}
              </div>

              <p className="fs-room__blocknote">
                Sent with every question, so an answer comes back in the style
                you are marked in.
              </p>
            </section>

            <section className="fs-room__block">
              <h2 className="fs-room__blocklabel">
                Source ledger
                {pinned.length > 0 ? (
                  <span className="fs-room__count">{pinned.length}</span>
                ) : null}
              </h2>

              <form
                className="fs-room__pinform"
                onSubmit={(event) => {
                  event.preventDefault();
                  pin(pinDraft);
                  setPinDraft("");
                }}
              >
                <input
                  type="text"
                  className="fs-room__pininput"
                  placeholder="Paste a link or type a title…"
                  aria-label="Add a source to the ledger"
                  value={pinDraft}
                  onChange={(event) => setPinDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className="fs-room__pinadd"
                  disabled={!pinDraft.trim()}
                >
                  Pin
                </button>
              </form>

              {pinned.length === 0 ? (
                <p className="fs-room__blocknote">
                  Empty. Pin a source and it stays here while you work —
                  in this browser only, never sent anywhere.
                </p>
              ) : (
                <ul className="fs-room__pins">
                  {pinned.map((entry) => {
                    const badge = badgeFor(entry.text);
                    const host = hostOf(entry.text);

                    return (
                      <li className="fs-room__pin" key={entry.id}>
                        <div className="fs-room__pintop">
                          <span className="fs-room__pintext">
                            {host ?? entry.text}
                          </span>

                          <button
                            type="button"
                            className="fs-room__pinx"
                            aria-label="Remove from ledger"
                            onClick={() =>
                              setPinned((current) =>
                                current.filter((p) => p.id !== entry.id)
                              )
                            }
                          >
                            <span aria-hidden="true">×</span>
                          </button>
                        </div>

                        {badge ? (
                          <span
                            className="fs-room__badge"
                            data-kind={badge.kind}
                          >
                            {badge.label}
                          </span>
                        ) : null}

                        <p className="fs-room__pinnote">
                          {badge ? badge.note : entry.note ?? "Saved note."}
                        </p>

                        <div className="fs-room__pinactions">
                          <button
                            type="button"
                            className="fs-room__pinaction"
                            disabled={!live}
                            onClick={() =>
                              send(
                                `Citation style: ${style}.\n\nEvaluate this source for me — who wrote it, what review it has been through, who funded it, and whether I could defend citing it. Then give me the in-text citation and bibliography entry, and name any field you cannot establish rather than inventing it.\n\n${entry.text}`
                              )
                            }
                          >
                            Evaluate & cite
                          </button>

                          <button
                            type="button"
                            className="fs-room__pinaction"
                            onClick={() => copy(entry.id, entry.text)}
                          >
                            {copied?.id === entry.id
                              ? copied.ok
                                ? "Copied"
                                : "Copy failed"
                              : "Copy"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {pinned.length > 0 ? (
                <p className="fs-room__blocknote">
                  The badge reads the web address and nothing else. Whether a
                  source is any good is the question you ask the agent.
                </p>
              ) : null}
            </section>
          </aside>
        </div>
      </div>

      <div className="fs-room__wrap">
        <FlagshipFooter identity={identity} />
      </div>
    </div>
  );
}
