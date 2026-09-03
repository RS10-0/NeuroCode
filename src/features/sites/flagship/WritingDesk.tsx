import { useState } from "react";

import FlagshipChat from "./FlagshipChat";
import { wordCount } from "./words";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * WRITING COACH — the manuscript desk.
 *
 * A page for somebody who arrived holding a draft.
 *
 * The layout is a spread rather than a column: the working
 * page on the left, a margin on the right, and the agent's
 * replies set as marginalia against the visitor's text. That
 * is the one idea the whole design runs on — your words are
 * the manuscript, its words are the notes — and everything
 * else follows from it. The transcript is ruled paper with a
 * printer's margin rule down it; a reply carries a numbered
 * annotation mark in the gutter, the way a copy-editor's would;
 * the visitor's own turns are set in the reading face, because
 * they are the text and the notes are not.
 *
 * The REVISION PASSES are the supporting UI, and they are the
 * reason this is a workspace rather than a chatbot with a
 * serif. Choosing one does not send anything: it sets the mode
 * the next message goes in under, exactly as a writer decides
 * which pass they are doing before they read. The chosen pass
 * is prepended to the message and shown in the transcript, so
 * the record is what was actually asked.
 */

interface Pass {
  id: string;
  label: string;
  meta: string;
  /* What gets prepended. Written as an instruction the agent
     can act on, not as a keyword. */
  directive: string;
}

/*
 * Four passes, in the order an editor actually works: shape
 * before sentences, sentences before voice, voice before
 * commas. A page that offered "proofread" first would be
 * teaching the wrong order.
 */
const PASSES: Pass[] = [
  {
    id: "structure",
    label: "Structure",
    meta: "Does the argument hold?",
    directive:
      "Structure pass. Look at the shape of this draft — the order of the ideas, what the opening promises, whether each paragraph earns its place. Do not fix the sentences yet.",
  },
  {
    id: "line",
    label: "Line",
    meta: "Sentence by sentence",
    directive:
      "Line pass. Go through this sentence by sentence. Show me the three or four worst lines, say precisely what is wrong with each, and name the principle behind the fix.",
  },
  {
    id: "voice",
    label: "Voice",
    meta: "Does it sound like me?",
    directive:
      "Voice pass. Tell me what this draft sounds like and where it stops sounding like one person. Point at the places I am imitating an essay instead of writing one.",
  },
  {
    id: "proof",
    label: "Proof",
    meta: "Last read before it goes",
    directive:
      "Proof pass. Last read before this goes out. Grammar, punctuation, agreement, repeated words, anything that would embarrass me. List them; do not rewrite the piece.",
  },
];

/* Openers for somebody who does not have a draft in hand yet.
   Deliberately about the craft rather than about the agent. */
const OPENERS = [
  {
    label: "What makes an opening line work?",
    text: "What actually makes an opening line work? Show me two or three that do and say why.",
  },
  {
    label: "How do I cut 200 words?",
    text: "I need to cut about 200 words from an essay without losing the argument. Where should I look first?",
  },
  {
    label: "Is my tone right for a teacher?",
    text: "How do I tell whether the tone of something I have written is right for a teacher rather than a friend?",
  },
];

export default function WritingDesk({
  slug,
  identity,
  live,
}: FlagshipLayoutProps) {
  /* Null is a real state and the default one: most people
     paste a draft and ask a question in their own words. */
  const [pass, setPass] = useState<Pass | null>(null);

  return (
    <div className="fs-desk">
      <header className="fs-desk__masthead">
        <div className="fs-desk__mastwrap">
          <span className="fs-desk__mastname">{identity.name}</span>
          <span className="fs-desk__mastrule" aria-hidden="true" />
          <span className="fs-desk__masteyebrow">{identity.eyebrow}</span>
          <BuildGenticMark />
        </div>
      </header>

      <div className="fs-desk__wrap">
        <section className="fs-desk__titleblock">
          <p className="fs-desk__folio">
            <span aria-hidden="true">§</span> Notes for the author
          </p>

          <h1 className="fs-desk__headline">{identity.headline}</h1>

          <p className="fs-desk__deck">{identity.deck}</p>

          <dl className="fs-desk__terms">
            <div>
              <dt>Notes, not rewrites</dt>
              <dd>
                It marks up what you wrote and tells you why. The sentences
                stay yours.
              </dd>
            </div>
            <div>
              <dt>Every edit names its principle</dt>
              <dd>
                So the second draft is better because you learned something,
                not because somebody fixed it.
              </dd>
            </div>
            <div>
              <dt>It remembers the piece</dt>
              <dd>
                Come back tomorrow and it still knows what you are writing and
                what you already changed.
              </dd>
            </div>
          </dl>
        </section>

        <div className="fs-desk__spread">
          <div className="fs-desk__page">
            <FlagshipChat
              slug={slug}
              identity={identity}
              live={live}
              variant="desk"
              prefix={pass?.directive}
              prompts={OPENERS}
              head={
                <header className="fs-desk__pagehead">
                  <span className="fs-desk__pagehead-label">
                    Working page
                  </span>
                  <span className="fs-desk__pagehead-state">
                    {pass ? `${pass.label} pass` : "No pass set"}
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
              fieldLead={
                pass ? (
                  <div className="fs-desk__active">
                    <span className="fs-desk__activelabel">
                      {pass.label} pass
                    </span>
                    <span className="fs-desk__activemeta">{pass.meta}</span>
                    <button
                      type="button"
                      className="fs-desk__activeclear"
                      onClick={() => setPass(null)}
                    >
                      Clear
                    </button>
                  </div>
                ) : null
              }
              meter={(draft) => {
                const words = wordCount(draft);

                return (
                  <span className="fs-desk__count">
                    {words === 1 ? "1 word" : `${words} words`}
                  </span>
                );
              }}
            />
          </div>

          <aside className="fs-desk__margin">
            <section className="fs-desk__marginblock">
              <h2 className="fs-desk__marginlabel">Revision passes</h2>

              <p className="fs-desk__marginnote">
                Pick one, then paste the draft. It sets what the read is for.
              </p>

              <ul className="fs-desk__passes">
                {PASSES.map((entry) => {
                  const active = pass?.id === entry.id;

                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="fs-desk__pass"
                        aria-pressed={active}
                        onClick={() => setPass(active ? null : entry)}
                      >
                        <span className="fs-desk__passmark" aria-hidden="true">
                          {active ? "▸" : ""}
                        </span>
                        <span className="fs-desk__passlabel">
                          {entry.label}
                        </span>
                        <span className="fs-desk__passmeta">{entry.meta}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="fs-desk__marginblock">
              <h2 className="fs-desk__marginlabel">House rules</h2>

              <ol className="fs-desk__rules">
                <li>It will not write the piece for you, and will say so.</li>
                <li>
                  Vague notes are a failure. If a note does not point at a
                  line, ask it which line.
                </li>
                <li>
                  Tell it the reader — a teacher, an admissions officer, a
                  friend — and the notes change.
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
