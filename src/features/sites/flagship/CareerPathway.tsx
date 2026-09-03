import { useCallback, useState } from "react";

import FlagshipChat from "./FlagshipChat";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * CAREER EXPLORER — the pathway board.
 *
 * The signature element is a real one: a horizontal rail with
 * four stages on it, and every stage is a question rather than
 * a step you complete. That is the design argument. A careers
 * page drawn as a funnel says there is a right end to get to;
 * a page drawn as a path you can join anywhere says the
 * opposite, which is the thing this agent is actually for.
 *
 * So the rail is not decoration. Each node asks the agent the
 * question that stage is about, the composer shows which stage
 * the conversation is in, and on a narrow screen the rail
 * becomes a vertical list without losing a single affordance.
 *
 * The right-hand board carries fields people actually ask
 * about. It is a set of openings, not a menu of careers, and
 * it says so — a list of six jobs presented as the options
 * would be exactly the pressure this agent exists to take off.
 */

interface Stage {
  id: string;
  index: string;
  label: string;
  question: string;
  ask: string;
}

const STAGES: Stage[] = [
  {
    id: "explore",
    index: "01",
    label: "Explore",
    question: "What am I drawn to?",
    ask: "I want to work out what I am actually drawn to. Ask me some questions and help me notice patterns I might be missing.",
  },
  {
    id: "compare",
    index: "02",
    label: "Compare",
    question: "What is the work really like?",
    ask: "I want to know what the day-to-day work is really like in the fields I am considering — the boring parts and the hard parts included.",
  },
  {
    id: "test",
    index: "03",
    label: "Test",
    question: "How do I find out cheaply?",
    ask: "How do I test whether I would actually like a career before committing years to it? Give me small, cheap ways to find out.",
  },
  {
    id: "move",
    index: "04",
    label: "Move",
    question: "What do I do this month?",
    ask: "Given where I am now, what could I realistically do in the next month that would move me forward? Ask me what you need to know first.",
  },
];

/* Openings people arrive with, in their own words. The first
   one is the most common thing a sixteen-year-old says. */
const OPENERS = [
  {
    label: "I have no idea what I want to do",
    text: "I have no idea what I want to do. Where do we even start?",
    meta: "The usual starting point",
  },
  {
    label: "I like two very different things",
    text: "I am interested in two subjects that seem to lead in completely different directions. How do I think about that?",
    meta: "Choosing without closing doors",
  },
  {
    label: "Everyone expects one thing from me",
    text: "People around me assume I will go one particular route and I am not sure it is mine. How do I think that through honestly?",
    meta: "Other people's plans",
  },
];

/*
 * Fields, as openings rather than as options.
 *
 * Six because a longer list starts to read as a shortlist
 * somebody is supposed to pick from, which is the opposite of
 * the point. The note underneath says so out loud.
 */
const FIELDS = [
  "Medicine and health",
  "Software and data",
  "Design and making",
  "Law and policy",
  "Teaching and research",
  "Trades and engineering",
];

export default function CareerPathway({
  slug,
  identity,
  live,
}: FlagshipLayoutProps) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();

  /* A changed id rather than changed text, so pressing the same
     node twice is two questions — see `ask` in FlagshipChat. */
  const send = useCallback((text: string) => {
    setAsk((current) => ({ text, id: (current?.id ?? 0) + 1 }));
  }, []);

  const chooseStage = (entry: Stage) => {
    setStage(entry);
    send(entry.ask);
  };

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
          THE RAIL.

          A list, semantically, because that is what it is — the
          drawing is CSS. Each node is a button so it is
          reachable by keyboard in reading order, and the
          connector between them is drawn behind with a
          pseudo-element rather than as elements nobody can use.
        */}
        <nav className="fs-path__rail" aria-label="Where to start">
          <ol className="fs-path__stages">
            {STAGES.map((entry) => (
              <li className="fs-path__stage" key={entry.id}>
                <button
                  type="button"
                  className="fs-path__node"
                  aria-pressed={stage?.id === entry.id}
                  disabled={!live}
                  onClick={() => chooseStage(entry)}
                >
                  <span className="fs-path__dot" aria-hidden="true" />
                  <span className="fs-path__index">{entry.index}</span>
                  <span className="fs-path__label">{entry.label}</span>
                  <span className="fs-path__question">{entry.question}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="fs-path__board">
          <div className="fs-path__talk">
            <FlagshipChat
              slug={slug}
              identity={identity}
              live={live}
              variant="path"
              ask={ask}
              prompts={OPENERS}
              head={
                <header className="fs-path__chathead">
                  <span className="fs-path__chatname">
                    Talking with {identity.name}
                  </span>
                  <span className="fs-path__chatstage">
                    {stage ? `${stage.index} · ${stage.label}` : "Open"}
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
            />
          </div>

          <aside className="fs-path__side">
            <section className="fs-path__card">
              <h2 className="fs-path__cardtitle">Fields people ask about</h2>

              <ul className="fs-path__fields">
                {FIELDS.map((field) => (
                  <li key={field}>
                    <button
                      type="button"
                      className="fs-path__field"
                      disabled={!live}
                      onClick={() =>
                        send(
                          `What is working in ${field.toLowerCase()} actually like day to day, what does it take to get there, and who tends to be unhappy in it?`
                        )
                      }
                    >
                      <span>{field}</span>
                      <span className="fs-path__fieldarrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <p className="fs-path__cardnote">
                Openings, not a shortlist. Name anything that is not here and
                it will take it just as seriously.
              </p>
            </section>

            <section className="fs-path__card fs-path__card--quiet">
              <h2 className="fs-path__cardtitle">What it will not do</h2>

              <ul className="fs-path__nots">
                <li>Tell you what to be.</li>
                <li>Pretend a path is safe when it is not.</li>
                <li>Rank you against anybody else.</li>
              </ul>

              <p className="fs-path__cardnote">
                It asks questions and lays out what is true. The decision
                stays with you.
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
