import { useCallback, useState, type CSSProperties } from "react";

import FlagshipChat from "./FlagshipChat";
import { flagshipCan } from "./identity";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * CAREER EXPLORER — the journey board.
 *
 * The argument the page makes is unchanged and is the reason
 * the rail exists at all: a careers page drawn as a funnel says
 * there is a right end to get to, and a page drawn as a path
 * you can join anywhere says the opposite, which is the thing
 * this agent is actually for.
 *
 * What changed is the FIRST MOVE. The old page put a blank
 * composer in front of a sixteen-year-old whose whole problem
 * is not knowing what to say, and hoped a placeholder would do
 * the work. Three things fix that here, and none of them is
 * decoration:
 *
 *   THE PIPELINE tells you the shape of the whole conversation
 *   before you are in it — four stages, each one a question
 *   rather than a step you complete — and any of them is a
 *   legitimate place to join.
 *
 *   THE LAUNCHPAD names the three states people actually arrive
 *   in, in their own words, and each card is one control that
 *   sends a fully-formed request. Nobody has to compose a
 *   question about not knowing what their question is.
 *
 *   THE FIELD PILLS set a focus that is prepended to what gets
 *   typed, so a two-word follow-up still lands somewhere. The
 *   prefix goes into the turn itself rather than beside it —
 *   see `prefix` in FlagshipChat — so the transcript stays an
 *   honest record of what was asked.
 *
 * WHY THE LAUNCHPAD SENDS A LONG PROMPT AND NOT A SHORT ONE.
 *
 * The brief asks a card to produce a structured blueprint
 * rather than a paragraph. Nothing on this page invents one:
 * the numbers in a careers answer are the part a page must
 * never make up, and a hard-coded salary card under
 * BuildGentic's name would be exactly that. So the structure is
 * ASKED FOR — each route sends a request that names the
 * sections it wants back — and the stylesheet renders the
 * markdown that returns as a blueprint: banded headings, a
 * sapphire spine, framed tables. The shape is the page's; every
 * fact in it is the agent's, and the agent is the thing that
 * can say when it is unsure.
 */

/* =========================================================
   THE PIPELINE
========================================================= */

interface Stage {
  id: string;
  index: string;
  glyph: string;
  label: string;
  question: string;
  ask: string;
}

const STAGES: Stage[] = [
  {
    id: "explore",
    index: "01",
    glyph: "🌐",
    label: "Explore",
    question: "What am I drawn to?",
    ask: "I want to work out what I am actually drawn to. Ask me questions about what I lose time in and what I avoid, then tell me the patterns I am probably missing about myself.",
  },
  {
    id: "compare",
    index: "02",
    glyph: "⚖️",
    label: "Compare",
    question: "What is the daily reality?",
    ask: "What is the daily reality of the paths I am considering? Give me the ordinary Tuesday rather than the brochure — the admin, the boring stretches and the parts people quietly resent included.",
  },
  {
    id: "test",
    index: "03",
    glyph: "🧪",
    label: "Test Drive",
    question: "How do I try it risk-free?",
    ask: "How do I test whether I would actually like a career before committing years to it? Give me small, cheap, low-risk ways to find out this term — things I can do from where I am now.",
  },
  {
    id: "move",
    index: "04",
    glyph: "🚀",
    label: "Action Plan",
    question: "What do I do this month?",
    ask: "Given where I am now, what could I realistically do in the next month that would move me forward? Ask me what you need to know about my situation first, then give me a short ordered plan.",
  },
];

/* =========================================================
   THE LAUNCHPAD

   Three routes, because these are the three states people
   arrive in — not three topics. The first card is what a
   sixteen-year-old actually says out loud, so it is first and
   it is not softened.

   Each route lights the stage it belongs to, because a route is
   a way INTO a stage rather than a fifth one. Between them they
   open three of the four; the last is reached from the rail,
   which is the one stage that needs the conversation to have
   happened first.
========================================================= */

interface Route {
  id: string;
  stage: string;
  glyph: string;
  title: string;
  body: string;
  cta: string;
  ask: string;
}

const ROUTES: Route[] = [
  {
    id: "vibe",
    stage: "explore",
    glyph: "🧭",
    title: "I have no idea where to start",
    body: "A sixty-second vibe check on what you naturally like doing — no subjects, no grades, no plan required.",
    cta: "Start vibe test",
    ask: "I have no idea where to start. Run a quick vibe check on me: ask me five fast either/or questions about what I naturally like doing — all five in one message, no preamble — and tell me you will read the pattern back to me afterwards and name a few directions worth a look.",
  },
  {
    id: "torn",
    stage: "compare",
    glyph: "⚖️",
    title: "I'm torn between two paths",
    body: "A side-by-side on the day-to-day, what the money realistically looks like, and how much effort each one actually takes.",
    cta: "Compare 2 careers",
    ask: "I am torn between two paths. Ask me which two, then put them side by side under these headings: a real day in each, what the pay actually looks like starting out and ten years in, how hard the entry is, and what people in each one quietly regret. Say plainly which parts you are unsure about or where the numbers vary a lot.",
  },
  {
    id: "role",
    stage: "test",
    glyph: "🔍",
    title: "Tell me about a specific job",
    body: "The honest truth on what the work is, the skills that decide who gets in, and how to get near it — or into an internship — early.",
    cta: "Deconstruct a role",
    ask: "I want the honest truth about one specific job. Ask me which one, then deconstruct it under these headings: what the work actually is hour to hour, the skills that decide who gets in, what it really pays, and the cheapest way for me to get near it this year — work experience, a project I could build, or a kind of person I could email. Tell me where you are unsure.",
  },
];

/* =========================================================
   THE FIELD PILLS

   A focus, not a shortlist — the note under the utility panel
   says so out loud, because five buttons above a text box is
   the exact gesture that reads as "pick one of these five".
   Anything typed instead is taken just as seriously; the pills
   only decide what a two-word follow-up attaches to.
========================================================= */

interface Field {
  id: string;
  glyph: string;
  label: string;
}

const FIELDS: Field[] = [
  { id: "medicine", glyph: "🩺", label: "Medicine & Health" },
  { id: "tech", glyph: "💻", label: "Tech & AI" },
  { id: "creative", glyph: "🎨", label: "Creative & Design" },
  { id: "law", glyph: "⚖️", label: "Law & Policy" },
  { id: "engineering", glyph: "🛠️", label: "Engineering" },
];

/* What the reality preview promises to break down. Labels, not
   figures: the figures are the agent's job and it can say when
   it is unsure of one, which a hard-coded card cannot. */
const REALITY = [
  {
    id: "hours",
    label: "The hours",
    body: "What the day is really made of, admin included.",
  },
  {
    id: "pay",
    label: "The money",
    body: "Starting out and ten years in, with the spread.",
  },
  {
    id: "cost",
    label: "The cost",
    body: "What burns people out, and who tends to leave.",
  },
];

export default function CareerPathway({
  slug,
  identity,
  live,
  offline,
}: FlagshipLayoutProps) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();

  /* A changed id rather than changed text, so pressing the same
     node twice is two questions — see `ask` in FlagshipChat. */
  const send = useCallback((text: string) => {
    setAsk((current) => ({ text, id: (current?.id ?? 0) + 1 }));
  }, []);

  const chooseStage = (entry: Stage) => {
    setStage(entry);
    setRoute(null);
    send(entry.ask);
  };

  const chooseRoute = (entry: Route) => {
    setRoute(entry);
    setStage(STAGES.find((item) => item.id === entry.stage) ?? null);
    send(entry.ask);
  };

  /* The pill toggles rather than sends. It is a filter on what
     comes next, and a click that fired a question would make
     the five of them a menu of five careers. */
  const chooseField = (entry: Field) => {
    setField((current) => (current?.id === entry.id ? null : entry));
  };

  /* How far along the rail the lit segments run. -1 until a
     stage is chosen, which leaves every segment neutral rather
     than lighting the first one for somebody who has not
     started. */
  const reached = stage ? STAGES.findIndex((item) => item.id === stage.id) : -1;

  /* Looked up rather than guessed is a promise about a
     capability, so it is read from the catalogue rather than
     written down here. Same rule the study desk and the
     workbench follow: switching web search off has to switch
     the sentence off with it. */
  const searches = flagshipCan("career-explorer", "web_search");

  return (
    <div className="fs-path">
      <header className="fs-path__top">
        <div className="fs-path__topwrap">
          <span className="fs-path__topname">{identity.name}</span>
          <span className="fs-path__topeyebrow">{identity.eyebrow}</span>
          <BuildGenticMark />
        </div>
      </header>

      <div className="fs-path__wrap">
        <section className="fs-path__hero">
          <h1 className="fs-path__headline">{identity.headline}</h1>
          <p className="fs-path__deck">{identity.deck}</p>
        </section>

        {/*
          THE PIPELINE.

          A list, semantically, because that is what it is — the
          drawing is CSS. Each node is a button so it is
          reachable by keyboard in reading order, and the
          connector is a segment owned by the node to its left
          rather than one line stretched behind the row. That is
          what lets it stay exactly dot-to-dot at every width
          and turn ninety degrees on a phone without a single
          measurement changing.
        */}
        <nav className="fs-path__rail" aria-label="Where to start">
          <ol className="fs-path__stages">
            {STAGES.map((entry, index) => (
              <li className="fs-path__stage" key={entry.id}>
                <button
                  type="button"
                  className="fs-path__node"
                  data-state={
                    stage?.id === entry.id
                      ? "active"
                      : index < reached
                        ? "done"
                        : "ahead"
                  }
                  aria-pressed={stage?.id === entry.id}
                  disabled={!live}
                  onClick={() => chooseStage(entry)}
                >
                  {index < STAGES.length - 1 ? (
                    <span
                      className="fs-path__track"
                      data-lit={index < reached ? "true" : undefined}
                      aria-hidden="true"
                    />
                  ) : null}

                  <span className="fs-path__dot" aria-hidden="true">
                    <span className="fs-path__glyph">{entry.glyph}</span>
                  </span>

                  <span className="fs-path__index">{entry.index}</span>
                  <span className="fs-path__label">{entry.label}</span>
                  <span className="fs-path__question">{entry.question}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {/*
          THE LAUNCHPAD.

          One control per card rather than a card containing a
          button: the whole panel is the target, it is one tab
          stop, and the thing that looks like the call to action
          is the thing that was pressed.
        */}
        <section className="fs-path__launch" aria-label="Ways in">
          {ROUTES.map((entry, index) => (
            <button
              type="button"
              key={entry.id}
              className="fs-path__route"
              style={{ "--fs-delay": `${index * 70}ms` } as CSSProperties}
              data-active={route?.id === entry.id ? "true" : undefined}
              disabled={!live}
              onClick={() => chooseRoute(entry)}
            >
              <span className="fs-path__routeglyph" aria-hidden="true">
                {entry.glyph}
              </span>

              <span className="fs-path__routetitle">{entry.title}</span>
              <span className="fs-path__routebody">{entry.body}</span>

              <span className="fs-path__routecta">
                {entry.cta}
                <span className="fs-path__routearrow" aria-hidden="true">
                  →
                </span>
              </span>
            </button>
          ))}
        </section>

        <div className="fs-path__board">
          <div className="fs-path__talk">
            <FlagshipChat
              slug={slug}
              identity={identity}
              live={live}
              offline={offline}
              variant="path"
              ask={ask}
              /* What the pills set is what the typed line is
                 about. Sent inside the turn, never beside it. */
              prefix={field ? `Focus: ${field.label}.` : undefined}
              head={
                <header className="fs-path__chathead">
                  <span className="fs-path__chatname">
                    Talking with {identity.name}
                  </span>

                  <span
                    className="fs-path__chatstage"
                    data-open={stage ? undefined : "true"}
                  >
                    {stage
                      ? `${stage.index} · ${stage.label}`
                      : "Open — start anywhere"}
                  </span>
                </header>
              }
              mark={(turn) =>
                turn.role === "assistant" && !turn.failed ? (
                  <span className="fs-path__turnmark">↳</span>
                ) : null
              }
              opening={
                <div className="fs-path__opening">
                  <p className="fs-path__openingtitle">
                    {identity.chat.openingTitle}
                  </p>
                  <p className="fs-path__openingbody">
                    {identity.chat.openingBody}
                  </p>
                </div>
              }
              fieldLead={
                field ? (
                  <div className="fs-path__focus">
                    <span className="fs-path__focusglyph" aria-hidden="true">
                      {field.glyph}
                    </span>
                    <span className="fs-path__focuslabel">{field.label}</span>
                    <span className="fs-path__focusmeta">
                      added to what you send
                    </span>
                    <button
                      type="button"
                      className="fs-path__focusclear"
                      onClick={() => setField(null)}
                    >
                      Clear
                    </button>
                  </div>
                ) : null
              }
              beforeForm={
                <div className="fs-path__pills" role="group" aria-label="Focus">
                  {FIELDS.map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      className="fs-path__pill"
                      aria-pressed={field?.id === entry.id}
                      onClick={() => chooseField(entry)}
                    >
                      <span aria-hidden="true">{entry.glyph}</span>
                      <span>{entry.label}</span>
                    </button>
                  ))}
                </div>
              }
            />
          </div>

          {/*
            THE REALITY CHECK.

            Two cards and one job between them: say what this
            agent will actually give you, in the terms a student
            is sceptical about. The first is a control, not a
            readout — the breakdown it names is produced by the
            agent, which is the only thing here that can look
            something up and say when it is unsure of it.
          */}
          <aside className="fs-path__side">
            <section className="fs-path__card">
              <h2 className="fs-path__cardtitle">Day in the life</h2>

              <p className="fs-path__cardlede">
                {field
                  ? `An honest Tuesday in ${field.label} — workload against reward, both named.`
                  : "Pick a focus below the conversation, or name any field at all, and get the honest version of it."}
              </p>

              <ul className="fs-path__reality">
                {REALITY.map((item) => (
                  <li className="fs-path__realityrow" key={item.id}>
                    <span className="fs-path__realitylabel">{item.label}</span>
                    <span className="fs-path__realitybody">{item.body}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="fs-path__cardcta"
                disabled={!live || !field}
                onClick={() =>
                  field
                    ? send(
                        `Show me an honest Tuesday in ${field.label}: hour by hour what the work actually is, what the pay really looks like starting out and ten years in, and what makes people leave. Where you are not sure of a number, say so.`
                      )
                    : undefined
                }
              >
                {field ? `Show a real Tuesday` : "Pick a focus first"}
                <span aria-hidden="true">→</span>
              </button>
            </section>

            <section className="fs-path__card fs-path__card--truth">
              <h2 className="fs-path__cardtitle">Unfiltered truth</h2>

              <ul className="fs-path__truths">
                <li data-kind="does">
                  {searches
                    ? "Real salary ranges, looked up rather than guessed."
                    : "Real salary ranges, and it says when it is unsure."}
                </li>
                <li data-kind="does">
                  The ordinary parts of the job, not the brochure.
                </li>
                <li data-kind="does">
                  Says plainly when it does not know something.
                </li>
                <li data-kind="wont">Tells you what to be.</li>
                <li data-kind="wont">Pretends a path is safe when it is not.</li>
                <li data-kind="wont">Ranks you against anybody else.</li>
              </ul>

              <p className="fs-path__cardnote">
                No gatekeeping and no generic advice. It asks questions and
                lays out what is true — the decision stays with you.
              </p>
            </section>
          </aside>
        </div>
      </div>

      <div className="fs-path__wrap">
        <FlagshipFooter identity={identity} />
      </div>
    </div>
  );
}
