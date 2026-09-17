import { ArrowRight, PenLine } from "lucide-react";

import { CHALLENGES } from "./challenges";

/*
 * What a twelve-year-old sees first.
 *
 * The bench works. What it did not do was explain itself: a
 * newcomer arrived at two empty boxes labelled "System
 * instructions", a strip announcing that nothing had changed
 * yet, and a button costing 2 XP — and had no way to tell what
 * any of it was for. The machinery was on screen before the
 * idea.
 *
 * So the machinery waits. This is the whole bench until there is
 * something on it, and it does three things in this order,
 * because that is the order the questions arrive in:
 *
 *   WHAT AM I LOOKING AT   a picture of the mechanic, before any
 *                          prose, because a diagram of two boxes
 *                          becoming two answers is understood in
 *                          about a second and a paragraph is not
 *
 *   WHY WOULD I DO THAT    one sentence, thirty-five words, and
 *                          the only paragraph in the workspace
 *
 *   WHAT DO I DO NOW       four things to try, as the largest
 *                          targets on the screen
 *
 * The diagram is inline SVG rather than a picture: it has to
 * recolour with the Lab's own tokens, and A and B have to be the
 * same sage and indigo they are on the bench itself. A learner
 * who has seen this then sees the real thing should recognise
 * the shapes.
 */

interface BenchIntroProps {
  onChallenge: (id: string) => void;
  /* Straight to the bench with nothing in it, for somebody who
     already has a prompt in mind. */
  onOwn: () => void;
}

export default function BenchIntro({ onChallenge, onOwn }: BenchIntroProps) {
  return (
    <section className="intro" aria-labelledby="intro-heading">
      <div className="intro__pitch">
        <h2 className="intro__title" id="intro-heading">
          Two prompts. One difference.
        </h2>

        <p className="intro__body">
          Write a prompt, copy it, and change one small thing. Run both at the
          same time and put the answers side by side — whatever comes back
          differently came from the thing you changed.
        </p>
      </div>

      <Diagram />

      <div className="intro__start">
        <p className="intro__label">Pick something to try</p>

        <div className="intro__challenges">
          {CHALLENGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="trythis"
              onClick={() => onChallenge(entry.id)}
            >
              <span className="trythis__title">{entry.title}</span>
              <span className="trythis__goal">{entry.goal}</span>
              <ArrowRight
                size={15}
                aria-hidden="true"
                className="trythis__arrow"
              />
            </button>
          ))}
        </div>

        <button type="button" className="intro__own" onClick={onOwn}>
          <PenLine size={14} aria-hidden="true" />
          …or start from your own prompt
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   THE PICTURE

   Two prompts, one marked as changed, both producing an answer,
   with the two answers being compared. That is the entire
   workspace, and it is the thing that has to land before any
   label on it means anything.

   Drawn rather than written because the sentence version — "you
   compose two variants of a request and run them concurrently
   for comparison" — is exactly the sort of thing a
   twelve-year-old reads twice and still cannot picture.
========================================================= */

function Diagram() {
  return (
    <svg
      className="introfig"
      viewBox="0 0 560 208"
      role="img"
      aria-label="Diagram: prompt A and prompt B, which is the same prompt with one thing changed, each produce an answer, and the two answers are compared."
    >
      {/* ---- the two prompts ---- */}
      <g className="introfig__a">
        <rect x="38" y="14" width="196" height="56" rx="10" />
        <text className="introfig__tag" x="52" y="36">
          A
        </text>
        <text className="introfig__text" x="72" y="36">
          your prompt
        </text>
        <line className="introfig__rule" x1="72" y1="48" x2="206" y2="48" />
        <line className="introfig__rule" x1="72" y1="58" x2="176" y2="58" />
      </g>

      <g className="introfig__b">
        <rect x="326" y="14" width="196" height="56" rx="10" />
        <text className="introfig__tag" x="340" y="36">
          B
        </text>
        <text className="introfig__text" x="360" y="36">
          the same prompt
        </text>
        <line className="introfig__rule" x1="360" y1="48" x2="494" y2="48" />
        {/* The one line drawn differently — the change itself. */}
        <line className="introfig__changed" x1="360" y1="58" x2="440" y2="58" />
      </g>

      {/* ---- what differs ---- */}
      <g className="introfig__delta">
        <rect x="244" y="28" width="72" height="26" rx="13" />
        <text className="introfig__deltatext" x="280" y="45">
          1 change
        </text>
      </g>

      {/* ---- down to the answers ---- */}
      <path className="introfig__flow introfig__flow--a" d="M136 74 L136 112" />
      <path className="introfig__flow introfig__flow--b" d="M424 74 L424 112" />

      <g className="introfig__a">
        <rect x="38" y="116" width="196" height="54" rx="10" />
        <text className="introfig__text" x="52" y="140">
          its answer
        </text>
        <line className="introfig__rule" x1="52" y1="152" x2="206" y2="152" />
        <line className="introfig__rule" x1="52" y1="161" x2="160" y2="161" />
      </g>

      <g className="introfig__b">
        <rect x="326" y="116" width="196" height="54" rx="10" />
        <text className="introfig__text" x="340" y="140">
          its answer
        </text>
        <line className="introfig__rule" x1="340" y1="152" x2="452" y2="152" />
      </g>

      {/* ---- the comparison ---- */}
      <path className="introfig__compare" d="M234 143 L316 143" />
      <text className="introfig__caption" x="280" y="196">
        which one is better?
      </text>
    </svg>
  );
}
