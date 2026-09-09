import { useCallback, useEffect, useRef, useState } from "react";

import FlagshipChat from "./FlagshipChat";
import {
  academicMeters,
  analyseDraft,
  creativeMeters,
  quotedFromReply,
  type Meter,
} from "./draft";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * WRITING COACH — the writing studio.
 *
 * A page for somebody who arrived holding a draft, and the
 * only one of the five that is two rooms.
 *
 * WHY TWO.
 *
 * The other four flagships serve one activity. This one serves
 * a novelist at eleven at night and a student with a
 * bibliography due, and those are not the same person wanting
 * a different colour — they want different tools. A sensory
 * anchor is noise on an essay. A citation audit is noise on a
 * chapter. The old page split the difference with four generic
 * revision passes, which is the honest failure mode of one
 * room: it was correct for both and built for neither.
 *
 * So the switch at the top is not a theme picker. It changes
 * the palette and the reading face, and it also changes the
 * three launchpad actions, the filters over the composer, and
 * what the panel on the right measures. The colour is the
 * signal that the tools underneath it moved.
 *
 * THE SPLIT VIEW IS THE POINT OF THE PAGE.
 *
 * Left is the visitor's draft and it STAYS THERE. Every action
 * on the page sends the draft along with the instruction, so
 * nobody pastes the same three paragraphs into a chat box four
 * times to get four kinds of note on it. Right is the coach's
 * reply. That is the whole workflow, and it is what the old
 * single-column transcript could not do.
 *
 * WHAT THE NOTES MAY AND MAY NOT DO TO THE DRAFT.
 *
 * Nothing this agent writes is ever put into the draft pane by
 * this page, and there is no control that would. The rule is
 * the agent's own and it is the hardest one in its prompt —
 * "never write a student's content for them wholesale" — so a
 * one-click control that spliced generated prose into the
 * manuscript would be this page building the exact artefact
 * the agent refuses to build. What a note gets instead is SHOW
 * ME WHERE: it finds the line the coach quoted, selects it in
 * the draft, and puts the cursor in it. The reader makes the
 * edit. That is not a lesser version of accepting a change; on
 * a page whose promise is "the sentences stay yours" it is the
 * correct version.
 */

type StudioId = "creative" | "academic";

interface Launch {
  id: string;
  glyph: string;
  title: string;
  body: string;
  cta: string;
  /* Sent with the draft appended. Written as an instruction the
     agent can act on, and every one of them ends by refusing
     the rewrite — see the note above. */
  directive: string;
}

interface Filter {
  id: string;
  label: string;
  directive: string;
}

interface PanelAsk {
  id: string;
  label: string;
  directive: string;
}

interface Studio {
  id: StudioId;
  /* On the switch. */
  glyph: string;
  switchLabel: string;
  /* In the title block, where the mode announces itself. */
  eyebrow: string;
  brief: string;
  draftLabel: string;
  draftPlaceholder: string;
  notesLabel: string;
  launches: Launch[];
  filters: Filter[];
  panelTitle: string;
  panelNote: string;
  asks: PanelAsk[];
  meters: (draft: string) => Meter[];
}

/* =========================================================
   MODE A — THE NOVELISTS' DESK
========================================================= */

const CREATIVE: Studio = {
  id: "creative",
  glyph: "✒️",
  switchLabel: "Creative studio",
  eyebrow: "Novelists' desk",
  brief:
    "Late, lamplit, and only interested in whether the thing moves. Bring a scene.",
  draftLabel: "Manuscript",
  draftPlaceholder:
    "Paste a scene, a chapter, a paragraph you keep rewriting…",
  notesLabel: "Marginalia",
  launches: [
    {
      id: "dialogue",
      glyph: "🎭",
      title: "Character & dialogue polish",
      body: "Make two people sound like two people — distinct, evasive, and both wanting something.",
      cta: "Polish the dialogue",
      directive:
        "Dialogue pass. Read the dialogue below. Tell me where the voices sound like the same person, where somebody says exactly what they mean instead of talking around it, and where the exchange has nothing at stake. Quote the exact lines you mean so I can find them. Name the principle behind each note. Do not rewrite the lines for me.",
    },
    {
      id: "world",
      glyph: "🌍",
      title: "Worldbuilding & scene setting",
      body: "Sensory anchors for a place — what the light does, what a body notices first.",
      cta: "Anchor the scene",
      directive:
        "Scene pass. Here is a setting. Tell me which senses I have left out, and what a body actually in this place would notice first — as things I could go and write, not as sentences to paste in. Then say which single detail would do the most work, and why that one.",
    },
    {
      id: "pace",
      glyph: "⚡",
      title: "Pacing & show-don't-tell",
      body: "Find the flat exposition and the places the scene sags, and say what should be happening instead.",
      cta: "Fix the pacing",
      directive:
        "Pacing pass. Find the places below where I am reporting events rather than showing them, and the places where the pace sags. Quote the exact sentences. For each one, say what the reader is being told that they should have been left to work out, and what would have to happen on the page instead. Do not write the replacement.",
    },
  ],
  filters: [
    {
      id: "tension",
      label: "Inject tension",
      directive:
        "Read this for tension. Where does the pressure drop, and what is the reader not worried about that they should be?",
    },
    {
      id: "sharpen",
      label: "Sharpen dialogue",
      directive:
        "Read this for dialogue. Where do the voices blur into one, and where is somebody being far too articulate for the moment they are in?",
    },
    {
      id: "sensory",
      label: "Sensory details",
      directive:
        "Read this for the senses. What would a body in this scene notice that is not on the page?",
    },
  ],
  panelTitle: "Story bible",
  panelNote:
    "Counts from your draft, not a verdict on it. The reading is the coach's job.",
  asks: [
    {
      id: "cast",
      label: "Who is in this?",
      directive:
        "From the draft below, list the people who appear, what each one seems to want, and what I have actually shown about them rather than stated.",
    },
    {
      id: "threads",
      label: "What threads are open?",
      directive:
        "From the draft below, list the questions this raises and has not answered — the open threads a reader would be carrying — and flag any I seem to have dropped.",
    },
    {
      id: "sag",
      label: "Where does it sag?",
      directive:
        "Read the draft below for pace alone. Point at the paragraphs where a reader would start skimming, and say what is happening in each one that should not be.",
    },
  ],
  meters: (draft) => creativeMeters(analyseDraft(draft)),
};

/* =========================================================
   MODE B — THE SCHOLAR'S DESK
========================================================= */

const ACADEMIC: Studio = {
  id: "academic",
  glyph: "🎓",
  switchLabel: "Academic lab",
  eyebrow: "Scholar's desk",
  brief:
    "Clean light, one argument, and every claim asked to show its evidence.",
  draftLabel: "Draft",
  draftPlaceholder:
    "Paste an essay, a paragraph, a thesis statement you are unsure of…",
  notesLabel: "Feedback",
  launches: [
    {
      id: "thesis",
      glyph: "🎯",
      title: "Thesis & argument builder",
      body: "Turn a vague idea into a claim somebody could actually disagree with.",
      cta: "Build the thesis",
      directive:
        "Thesis pass. Take what is below and help me get to a thesis I could defend. Tell me what it currently claims, why it is not yet arguable — an obvious statement is the usual problem — and ask me the questions you need answered to sharpen it. Show me the shape of a strong thesis and let me fill it in; do not write mine for me.",
    },
    {
      id: "evidence",
      glyph: "🔬",
      title: "Evidence & citation review",
      body: "Where a claim carries no evidence, where evidence sits uninterpreted, and whether the citations are consistent.",
      cta: "Review the evidence",
      directive:
        "Evidence pass. Go through the draft below. Find claims carrying no evidence, evidence quoted but never interpreted, and citations doing decorative work. Quote the exact sentences. Say which citation style this looks like — APA, MLA or something else — and where it is inconsistent with itself.",
    },
    {
      id: "clarity",
      glyph: "🧹",
      title: "Clarity & conciseness audit",
      body: "Cut the fluff, unhide the passive voice, and find where a shorter word is the more precise one.",
      cta: "Audit the prose",
      directive:
        "Clarity pass. Find the fluff, the passive constructions hiding who did what, and the places where I have reached for a long word that is less precise than a short one. Quote the worst offenders and name the principle behind each fix. List them; do not rewrite the piece.",
    },
  ],
  filters: [
    {
      id: "formal",
      label: "Sound more formal",
      directive:
        "Read this for register. Where does it slip out of academic voice, and where am I being stiff rather than formal — which is a different fault?",
    },
    {
      id: "transition",
      label: "Strengthen transitions",
      directive:
        "Read this for transitions. Where does one paragraph fail to earn the next, and where is a connective doing work the argument should be doing?",
    },
    {
      id: "fluff",
      label: "Cut fluff",
      directive:
        "Read this for padding. Show me the sentences that could go entirely and the phrases that could be one word, and say what each cut costs.",
    },
  ],
  panelTitle: "Thesis scorecard",
  panelNote:
    "Mechanical checks on your text, not a grade. Nothing here reads the argument.",
  asks: [
    {
      id: "arguable",
      label: "Is my thesis arguable?",
      directive:
        "Find the thesis in the draft below, quote it back to me, and tell me straight whether a reasonable person could disagree with it. If they could not, say what is missing.",
    },
    {
      id: "thin",
      label: "Where is my evidence thin?",
      directive:
        "Go through the draft below and show me every claim that is carrying more weight than its evidence supports. Quote the claim and say what evidence it would need.",
    },
    {
      id: "style",
      label: "Check my citation style",
      directive:
        "Look at the citations in the draft below. Tell me which style they are closest to, where they are inconsistent, and what an in-text citation and a reference entry should look like in that style.",
    },
  ],
  meters: (draft) => academicMeters(analyseDraft(draft)),
};

const STUDIOS: Studio[] = [CREATIVE, ACADEMIC];

/* =========================================================
   REMEMBERING THE ROOM

   Which studio somebody was last in is a per-visitor
   convenience and nothing else, so it stays in their browser
   and never reaches the server. Same key shape as
   `useLocalTheme` and the visitor key — `neurolink.site.`
   prefixed and per-slug — so a second agent's page does not
   inherit it, and clearing site data forgets this exactly the
   way it forgets the rest.

   Every access is wrapped: a private window, a browser set to
   block site data, or a thumbnail capture can all make
   localStorage throw on read, and a writing page that refused
   to render because it could not remember a colour scheme
   would be a bad trade.
========================================================= */

const storageKey = (slug: string): string => `neurolink.site.studio.${slug}`;

function readStudio(slug: string): StudioId | null {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));

    return raw === "creative" || raw === "academic" ? raw : null;
  } catch {
    return null;
  }
}

export default function WritingDesk({
  slug,
  identity,
  live,
  offline,
}: FlagshipLayoutProps) {
  /*
   * Creative is the default, and the default is the one a
   * first-time visitor sees before they have an opinion. It
   * matches `identity.mode`, which is what the page's very
   * first paint uses — see the note there.
   */
  const [studioId, setStudioId] = useState<StudioId>(
    () => readStudio(slug) ?? "creative"
  );

  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(
    null
  );

  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const studio = STUDIOS.find((entry) => entry.id === studioId) ?? CREATIVE;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(slug), studioId);
    } catch {
      /* Nothing to do and nothing worth telling anybody. The
         page works; it just will not remember. */
    }
  }, [slug, studioId]);

  /* The copied flag clears itself. An effect rather than a
     bare setTimeout so unmounting mid-flash cancels it. */
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

  /*
   * Every action carries the draft.
   *
   * This is the single most useful thing on the page and it is
   * four lines: the instruction, a rule, then the manuscript.
   * Nobody re-pastes anything. With the pane empty the
   * directive goes on its own and the coach asks for the text,
   * which is a better empty state than a disabled button.
   */
  const sendWithDraft = useCallback(
    (directive: string) => {
      const body = draft.trim();

      send(body ? `${directive}\n\n---\n\n${body}` : directive);
    },
    [draft, send]
  );

  /*
   * SHOW ME WHERE.
   *
   * Selects the quoted line inside the textarea and leaves the
   * cursor in it, so the next keystroke edits the right words.
   * The selection IS the highlight — native, in the real
   * control, with no second copy of the draft to keep in step.
   *
   * The scroll is proportional to the character offset rather
   * than counted in lines, because a line count is wrong the
   * moment any line wraps and this has to work on a phone. It
   * is an approximation that lands the line comfortably inside
   * the pane, which is all it needs to do.
   */
  const showMeWhere = useCallback(
    (fragment: string) => {
      const field = draftRef.current;
      const at = draft.indexOf(fragment);

      if (!field || at < 0) {
        return;
      }

      field.focus();
      field.setSelectionRange(at, at + fragment.length);

      const share = at / Math.max(1, draft.length);
      field.scrollTop = Math.max(
        0,
        share * field.scrollHeight - field.clientHeight / 3
      );
    },
    [draft]
  );

  const copyNote = useCallback((id: string, text: string) => {
    /* Absent over plain http and refusable everywhere, so the
       failure is a real branch rather than a catch that hides
       one. The control says so rather than going quiet. */
    if (!navigator.clipboard) {
      setCopied({ id, ok: false });
      return;
    }

    navigator.clipboard.writeText(text).then(
      () => setCopied({ id, ok: true }),
      () => setCopied({ id, ok: false })
    );
  }, []);

  const metrics = studio.meters(draft);
  const analysis = analyseDraft(draft);

  return (
    <div className="fs-desk" data-studio={studioId}>
      <header className="fs-desk__masthead">
        <div className="fs-desk__mastwrap">
          <span className="fs-desk__mastname">{identity.name}</span>
          <span className="fs-desk__mastrule" aria-hidden="true" />
          <span className="fs-desk__masteyebrow">{studio.eyebrow}</span>
          <BuildGenticMark />
        </div>
      </header>

      {/*
        THE SWITCH.

        Two real radios in a fieldset rather than buttons with
        aria-checked on them: a radio group already does the
        arrow-key behaviour, the grouped label and the single
        tab stop that a hand-built one would have to reimplement
        and would eventually get wrong. The switch look is
        entirely CSS over the top.
      */}
      <div className="fs-desk__switchbar">
        <fieldset className="fs-desk__switch">
          <legend className="fs-desk__switchlegend">Studio</legend>

          <div className="fs-desk__switchtrack">
            <span className="fs-desk__switchthumb" aria-hidden="true" />

            {STUDIOS.map((entry) => (
              <label className="fs-desk__switchside" key={entry.id}>
                <input
                  type="radio"
                  className="fs-desk__switchinput"
                  name={`studio-${slug}`}
                  value={entry.id}
                  checked={studioId === entry.id}
                  onChange={() => setStudioId(entry.id)}
                />
                {/* One wrapper, so the checked and focused
                    states can be reached from the input with a
                    plain sibling combinator. See the note in
                    the stylesheet. */}
                <span className="fs-desk__switchface">
                  <span className="fs-desk__switchglyph" aria-hidden="true">
                    {entry.glyph}
                  </span>
                  <span className="fs-desk__switchtext">
                    {entry.switchLabel}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="fs-desk__wrap">
        <section className="fs-desk__titleblock">
          <p className="fs-desk__folio">
            <span aria-hidden="true">§</span> {studio.eyebrow}
          </p>

          <h1 className="fs-desk__headline">{identity.headline}</h1>

          <p className="fs-desk__deck">{identity.deck}</p>

          <p className="fs-desk__brief">{studio.brief}</p>
        </section>

        {/*
          THE LAUNCHPAD.

          One control per card rather than a card with a button
          in it: the whole panel is the target, it is one tab
          stop, and the thing that looks like the call to action
          is the thing that was pressed.
        */}
        <section className="fs-desk__launch" aria-label="Ways in">
          {studio.launches.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className="fs-desk__card"
              disabled={!live}
              onClick={() => sendWithDraft(entry.directive)}
            >
              <span className="fs-desk__cardglyph" aria-hidden="true">
                {entry.glyph}
              </span>

              <span className="fs-desk__cardtitle">{entry.title}</span>
              <span className="fs-desk__cardbody">{entry.body}</span>

              <span className="fs-desk__cardcta">
                {entry.cta}
                <span className="fs-desk__cardarrow" aria-hidden="true">
                  →
                </span>
              </span>
            </button>
          ))}
        </section>

        <div className="fs-desk__studio">
          {/* ----- LEFT: THE DRAFT, WHICH STAYS PUT ----- */}
          <section className="fs-desk__draft">
            <header className="fs-desk__drafthead">
              <h2 className="fs-desk__draftlabel">{studio.draftLabel}</h2>

              <span className="fs-desk__draftcount">
                {analysis.words === 1 ? "1 word" : `${analysis.words} words`}
                {analysis.sentences > 0
                  ? ` · ${analysis.sentences} sentence${
                      analysis.sentences === 1 ? "" : "s"
                    }`
                  : ""}
              </span>
            </header>

            <textarea
              ref={draftRef}
              className="fs-desk__draftfield"
              value={draft}
              placeholder={studio.draftPlaceholder}
              aria-label={`${studio.draftLabel} — your text`}
              spellCheck
              onChange={(event) => setDraft(event.target.value)}
            />

            <p className="fs-desk__draftnote">
              Stays here. Every action on this page sends it along, so you
              never paste it twice — and nothing the coach writes is ever put
              into it.
            </p>
          </section>

          {/* ----- RIGHT: THE NOTES ----- */}
          <div className="fs-desk__notes">
            <FlagshipChat
              slug={slug}
              identity={identity}
              live={live}
              offline={offline}
              variant="desk"
              ask={ask}
              head={
                <header className="fs-desk__pagehead">
                  <span className="fs-desk__pagehead-label">
                    {studio.notesLabel}
                  </span>
                  <span className="fs-desk__pagehead-state">
                    {studio.switchLabel}
                  </span>
                </header>
              }
              mark={(turn, index) => {
                if (turn.role === "user") {
                  return <span className="fs-desk__pen">✎</span>;
                }

                if (turn.id === "greeting" || turn.failed) {
                  return <span className="fs-desk__pen">§</span>;
                }

                /*
                 * The note number.
                 *
                 * Derived from position rather than counted,
                 * because the transcript is strictly greeting,
                 * then question, then answer: an answer is
                 * always at an even index and the nth answer is
                 * at 2n. A counter kept in state would be the
                 * same number with a chance of disagreeing with
                 * the list it labels.
                 */
                return (
                  <span className="fs-desk__notenum">
                    {Math.max(1, Math.ceil(index / 2))}
                  </span>
                );
              }}
              foot={(turn) => {
                if (
                  turn.role !== "assistant" ||
                  turn.failed ||
                  turn.id === "greeting" ||
                  !turn.content
                ) {
                  return null;
                }

                /* Only when the note quotes something really in
                   the draft. See `quotedFromReply`. */
                const found = quotedFromReply(turn.content, draft);
                const flash = copied?.id === turn.id ? copied : null;

                return (
                  <div className="fs-desk__notetools">
                    {found ? (
                      <button
                        type="button"
                        className="fs-desk__notetool"
                        onClick={() => showMeWhere(found)}
                      >
                        <span aria-hidden="true">⤺</span> Show me where
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="fs-desk__notetool"
                      onClick={() => copyNote(turn.id, turn.content)}
                    >
                      <span aria-hidden="true">⧉</span>{" "}
                      {flash ? (flash.ok ? "Copied" : "Copy failed") : "Copy"}
                    </button>
                  </div>
                );
              }}
              opening={
                <div className="fs-desk__opening">
                  <p className="fs-desk__openingtitle">
                    {identity.chat.openingTitle}
                  </p>
                  <p className="fs-desk__openingbody">
                    {identity.chat.openingBody}
                  </p>
                </div>
              }
              beforeForm={
                <div
                  className="fs-desk__filters"
                  role="group"
                  aria-label="Quick reads"
                >
                  {studio.filters.map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      className="fs-desk__filter"
                      onClick={() => sendWithDraft(entry.directive)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              }
            />
          </div>

          {/* ----- THE PANEL ----- */}
          <aside className="fs-desk__panel">
            <section className="fs-desk__panelblock">
              <h2 className="fs-desk__panellabel">{studio.panelTitle}</h2>

              <ul className="fs-desk__meters">
                {metrics.map((meter) => (
                  <li className="fs-desk__meter" key={meter.id}>
                    <span className="fs-desk__meterlabel">{meter.label}</span>
                    <span className="fs-desk__metervalue">{meter.value}</span>

                    <span className="fs-desk__meterbar" aria-hidden="true">
                      <span
                        className="fs-desk__meterfill"
                        style={{ width: `${Math.round(meter.fill * 100)}%` }}
                      />
                    </span>

                    <span className="fs-desk__meternote">{meter.note}</span>
                  </li>
                ))}
              </ul>

              <p className="fs-desk__panelnote">{studio.panelNote}</p>
            </section>

            <section className="fs-desk__panelblock">
              <h2 className="fs-desk__panellabel">Ask about the draft</h2>

              <ul className="fs-desk__asks">
                {studio.asks.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="fs-desk__ask"
                      disabled={!live}
                      onClick={() => sendWithDraft(entry.directive)}
                    >
                      <span>{entry.label}</span>
                      <span className="fs-desk__askarrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="fs-desk__panelblock fs-desk__panelblock--rules">
              <h2 className="fs-desk__panellabel">House rules</h2>

              <ol className="fs-desk__rules">
                <li>It will not write the piece for you, and will say so.</li>
                <li>
                  Vague notes are a failure. If a note does not point at a
                  line, ask it which line.
                </li>
                <li>
                  Tell it the reader — a teacher, an agent, a friend — and the
                  notes change.
                </li>
              </ol>
            </section>
          </aside>
        </div>
      </div>

      <div className="fs-desk__wrap">
        <FlagshipFooter identity={identity}>
          <p className="fs-desk__colophon">
            Set in Fraunces and Inter. Notes are the agent&rsquo;s; the
            manuscript is yours.
          </p>
        </FlagshipFooter>
      </div>
    </div>
  );
}
