import { useCallback, useState } from "react";

import FlagshipChat, { type FlagshipPrompt } from "./FlagshipChat";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * STUDY TUTOR — the study desk.
 *
 * A notebook, ruled and tabbed, and the brief for it was
 * "welcoming, not childish" — which in practice meant taking
 * every decision one step towards plain. Ruled lines rather
 * than a cartoon desk; dividers rather than stickers; an index
 * card for an explanation because that is genuinely how a
 * good one is shaped.
 *
 * The MODE TABS are the supporting UI and they change what the
 * page is for: explaining, practising and reviewing are three
 * different sessions, and a tutor page that offered one set of
 * openings for all three would be pretending they are the same
 * activity. Switching a tab changes the ways in and the card
 * beside them. It does not send anything and it does not clear
 * anything — one conversation runs underneath all three.
 *
 * The session checklist is local to the browser and
 * deliberately unsaved. It is a place to put your own list for
 * the next half hour, not a record anybody keeps.
 */

type ModeId = "explain" | "practise" | "review";

interface Mode {
  id: ModeId;
  label: string;
  blurb: string;
  prompts: FlagshipPrompt[];
  card: { title: string; body: string; points: string[] };
}

const MODES: Mode[] = [
  {
    id: "explain",
    label: "Explain",
    blurb: "Understand something properly for the first time.",
    prompts: [
      {
        label: "Explain this from the start",
        text: "Explain this topic to me from the start, checking I have followed before you move on. Ask me what I already know first.",
        meta: "It will check you are following",
      },
      {
        label: "I am stuck on one step",
        text: "I understand most of this but I am stuck on one particular step. Ask me where, then take that step slowly.",
        meta: "For the one bit that will not land",
      },
      {
        label: "Why is it done this way?",
        text: "I can follow the method but I do not understand why it works. Explain the reason behind it rather than the steps.",
        meta: "Method versus reason",
      },
    ],
    card: {
      title: "How a good explanation goes",
      body: "It will ask you things back. That is not it being awkward — it is how it finds the exact place your understanding stops.",
      points: [
        "Say what you already think is true, even if you are unsure.",
        "Stop it the moment a word goes past you.",
        "Ask for a second example before you say you have got it.",
      ],
    },
  },
  {
    id: "practise",
    label: "Practise",
    blurb: "Find out whether you actually know it.",
    prompts: [
      {
        label: "Quiz me on what I just studied",
        text: "Quiz me on what I have just been studying. Ask one question at a time, wait for my answer, and tell me what my mistakes have in common.",
        meta: "One question at a time",
      },
      {
        label: "Give me a worked example",
        text: "Give me a worked example, then a second one for me to try on my own, and mark my attempt honestly.",
        meta: "Watch one, do one",
      },
      {
        label: "Mark this like an examiner",
        text: "Here is my answer to a practice question. Mark it the way an examiner would and tell me exactly where the marks went.",
        meta: "Paste an answer to mark",
      },
    ],
    card: {
      title: "Practice that is worth the time",
      body: "Testing yourself before you feel ready is uncomfortable and is the part that works. Re-reading your notes is the part that feels productive and is not.",
      points: [
        "Answer before you look anything up.",
        "Write the answer out — recognising it is not knowing it.",
        "Come back to what you got wrong tomorrow, not tonight.",
      ],
    },
  },
  {
    id: "review",
    label: "Review",
    blurb: "Work out what to do next.",
    prompts: [
      {
        label: "What do I keep getting wrong?",
        text: "Looking at what we have covered, what do I keep getting wrong, and what is the pattern behind it?",
        meta: "Patterns, not single mistakes",
      },
      {
        label: "Plan the next two weeks",
        text: "Help me plan the next two weeks of revision. Ask me what I am being tested on and how much time I actually have.",
        meta: "Realistic, not aspirational",
      },
      {
        label: "Summarise what we covered",
        text: "Summarise what we have covered so far in a form I could revise from, and flag anything I only half understood.",
        meta: "Turn the session into notes",
      },
    ],
    card: {
      title: "It remembers the last session",
      body: "You are not starting from nothing every time. Say what you are being tested on and it keeps that in view across the weeks.",
      points: [
        "Tell it your exam board or course if you have one.",
        "Say when the test is. It changes what is worth doing.",
        "Ask it what you have not looked at in a while.",
      ],
    },
  },
];

/* A place to put the next half hour. Ticks live in this tab
   and nowhere else — see the note at the top of the file. */
const CHECKLIST = [
  "Say what I am working on",
  "Get one thing explained properly",
  "Try a question without looking",
  "Write down what I got wrong",
];

export default function StudyDesk({
  slug,
  identity,
  live,
}: FlagshipLayoutProps) {
  const [mode, setMode] = useState<ModeId>("explain");
  const [done, setDone] = useState<string[]>([]);
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();

  const active = MODES.find((entry) => entry.id === mode) ?? MODES[0];

  /* A changed id rather than changed text, so pressing the same
     way in twice is two questions — see `ask` in FlagshipChat. */
  const send = useCallback((text: string) => {
    setAsk((current) => ({ text, id: (current?.id ?? 0) + 1 }));
  }, []);

  const toggle = useCallback((item: string) => {
    setDone((current) =>
      current.includes(item)
        ? current.filter((entry) => entry !== item)
        : [...current, item]
    );
  }, []);

  return (
    <div className="fs-study">
      <header className="fs-study__top">
        <div className="fs-study__topwrap">
          <span className="fs-study__topname">{identity.name}</span>
          <span className="fs-study__topeyebrow">{identity.eyebrow}</span>
          <BuildGenticMark />
        </div>
      </header>

      <div className="fs-study__wrap">
        <section className="fs-study__hero">
          <h1 className="fs-study__headline">{identity.headline}</h1>
          <p className="fs-study__deck">{identity.deck}</p>
        </section>

        {/*
          The dividers. A tablist rather than three buttons,
          because that is what they are — and because arrow-key
          movement between them is the behaviour somebody using
          a keyboard will expect from something drawn as tabs.
        */}
        <div className="fs-study__tabs" role="tablist" aria-label="Session type">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`fs-study-tab-${entry.id}`}
              aria-selected={mode === entry.id}
              aria-controls="fs-study-panel"
              tabIndex={mode === entry.id ? 0 : -1}
              className="fs-study__tab"
              onClick={() => setMode(entry.id)}
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

                const index = MODES.findIndex((item) => item.id === mode);
                const next = MODES[(index + step + MODES.length) % MODES.length];

                setMode(next.id);

                /* Focus follows selection — see the same handler
                   on the workbench's tab strip. */
                document.getElementById(`fs-study-tab-${next.id}`)?.focus();
              }}
            >
              <span className="fs-study__tablabel">{entry.label}</span>
              <span className="fs-study__tabblurb">{entry.blurb}</span>
            </button>
          ))}
        </div>

        <div
          className="fs-study__board"
          id="fs-study-panel"
          role="tabpanel"
          aria-labelledby={`fs-study-tab-${mode}`}
        >
          <div className="fs-study__session">
            <FlagshipChat
              slug={slug}
              identity={identity}
              live={live}
              variant="study"
              ask={ask}
              /*
               * No `prompts`, and no remount on a mode change.
               *
               * The ways in live in the rail beside the chat
               * rather than inside it — the same arrangement the
               * generic study template uses, and for a better
               * reason here: a tab strip that reset the
               * conversation would punish somebody for looking
               * at what "Practise" offers, and one whose
               * openings vanished after the first question
               * would stop meaning anything the moment it
               * mattered. In the rail they change with the tab
               * and stay reachable all session.
               */
              head={
                <header className="fs-study__sessionhead">
                  <span className="fs-study__sessionlabel">
                    {active.label} session
                  </span>
                  <span className="fs-study__sessionmeta">
                    with {identity.name}
                  </span>
                </header>
              }
              mark={(turn) =>
                turn.role === "user" ? (
                  <span className="fs-study__pencil">✎</span>
                ) : (
                  <span className="fs-study__cardtab" />
                )
              }
              opening={
                <div className="fs-study__opening">
                  <p className="fs-study__openingtitle">
                    {identity.chat.openingTitle}
                  </p>
                  <p className="fs-study__openingbody">
                    {identity.chat.openingBody}
                  </p>
                </div>
              }
            />
          </div>

          <aside className="fs-study__rail">
            <section className="fs-study__card">
              <h2 className="fs-study__cardtitle">
                Ways in &mdash; {active.label.toLowerCase()}
              </h2>

              <ul className="fs-study__ways">
                {active.prompts.map((prompt) => (
                  <li key={prompt.label}>
                    <button
                      type="button"
                      className="fs-study__way"
                      disabled={!live}
                      onClick={() => send(prompt.text)}
                    >
                      <span className="fs-study__waylabel">{prompt.label}</span>
                      {prompt.meta ? (
                        <span className="fs-study__waymeta">{prompt.meta}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>

              <p className="fs-study__cardbody">{active.card.body}</p>

              <ul className="fs-study__points">
                {active.card.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>

            <section className="fs-study__card fs-study__card--list">
              <h2 className="fs-study__cardtitle">This session</h2>

              <ul className="fs-study__checklist">
                {CHECKLIST.map((item) => {
                  const ticked = done.includes(item);

                  return (
                    <li key={item}>
                      <label className="fs-study__check">
                        {/*
                          The real control, styled directly
                          rather than hidden behind a drawn
                          stand-in. A visually-hidden input with
                          a span beside it is the usual way to
                          get a custom tick, and it is two
                          elements to keep in step and one that
                          assistive technology has to be
                          persuaded still exists. `appearance:
                          none` and a pseudo-element on the box
                          itself is the same picture with none
                          of that.
                        */}
                        <input
                          className="fs-study__box"
                          type="checkbox"
                          checked={ticked}
                          onChange={() => toggle(item)}
                        />
                        <span className="fs-study__checklabel">{item}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <p className="fs-study__cardnote">
                Yours, for the next half hour. Nothing here is saved or seen by
                anybody.
              </p>
            </section>

            <section className="fs-study__card fs-study__card--nudge">
              <h2 className="fs-study__cardtitle">Bring your own material</h2>
              <p className="fs-study__cardbody">
                Paste your notes, a mark scheme, or the exact question you were
                set. It will work from what you are actually being tested on
                rather than from a general version of the topic.
              </p>
            </section>
          </aside>
        </div>
      </div>

      <div className="fs-study__wrap">
        <FlagshipFooter identity={identity} />
      </div>
    </div>
  );
}
