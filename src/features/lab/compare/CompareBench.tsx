import { Suspense, lazy, useEffect, useId, useState } from "react";
import {
  ArrowRight,
  CircleStop,
  FlaskConical,
  Play,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";

import type { AiRequestLimits } from "../../../lib/aiClient";
import { relativeTime } from "../relativeTime";
import type { LabSettings } from "../types";
import BenchIntro from "./BenchIntro";
import { allPassed, runChecks, type Challenge } from "./challenges";
import { describeLength, lengthDelta, type Side } from "./experiment";
import type { ExperimentApi } from "./useExperiment";

/*
 * The same renderer the Playground uses.
 *
 * Models write markdown because that is what they were trained
 * on, so an answer arrives full of `**bold**` and pipe tables.
 * Showing that as literal characters made the bench look broken
 * — and worse, made the ANSWERS look bad, on the one screen
 * whose entire job is judging which answer is better.
 *
 * Lazy for the reason NeuralResponse loads it lazily: a markdown
 * parser, KaTeX and a syntax highlighter are a large chunk, and
 * nothing here needs them until an answer arrives. Two panes
 * share the one chunk.
 */
const ResponseMarkdown = lazy(() => import("../ResponseMarkdown"));

/*
 * The Prompt Canvas: two versions of one request, run together.
 *
 * WHAT THIS IS FOR, because three earlier attempts at this
 * workspace got it wrong in exactly the same way.
 *
 * Those three were all places to WRITE a prompt — a structured
 * composer, a two-lane editor, a guided wizard. Each was a
 * better prompt editor than the last and none of them taught
 * anything, because writing the prompt is the boring half. The
 * Playground next door already has two perfectly good fields for
 * that and nobody has ever complained about them.
 *
 * Lesson 6 of the Prompt Engineering course says the thing this
 * screen exists to make true: "A rewritten prompt that produces
 * a nicer-sounding answer has not necessarily fixed anything. If
 * the audience is still unstated, you got lucky on one run."
 *
 * One run proves nothing. So this runs two, side by side, from a
 * B that started as a copy of A — which means the only way they
 * can differ is that you changed something, and whatever you
 * changed is named in the strip between them. Then you judge,
 * the winner becomes the new A, and you go again.
 *
 * Change one thing. Run both. Judge. Keep the winner. Repeat.
 */

interface CompareBenchProps {
  api: ExperimentApi;
  requestLimits: AiRequestLimits | undefined;
  /* False when the learner cannot afford two runs, or there is
     no model. The bench still composes; it just cannot fire. */
  canRun: boolean;
  /* Why not, when not. One sentence. */
  blockedReason: string | null;
  /* What two runs cost, so the button can say so. */
  cost: number;
}

export default function CompareBench({
  api,
  requestLimits,
  canRun,
  blockedReason,
  cost,
}: CompareBenchProps) {
  const { experiment, challenge } = api;

  /* Warm the renderer's chunk while the learner is still
     typing, so two answers landing at once do not both wait on
     the same download. A failure here is not worth reporting —
     Suspense waits for the retry when a pane actually needs
     it. */
  useEffect(() => {
    void import("../ResponseMarkdown").catch(() => {});
  }, []);

  /*
   * Somebody who asked to start from nothing.
   *
   * Local, and deliberately not stored: on a reload with no
   * prompt written, showing the explanation again is the right
   * answer, because a learner who left without writing anything
   * did not finish being introduced to this.
   */
  const [dismissed, setDismissed] = useState(false);

  const blank =
    experiment.a.prompt.trim() === "" && experiment.b.prompt.trim() === "";

  /*
   * The machinery waits until there is an idea to put in it.
   *
   * Two empty boxes labelled "System instructions" is what a
   * twelve-year-old used to arrive at, and there was nothing on
   * the screen telling them what the two boxes were for or why
   * there were two.
   */
  if (blank && !challenge && !dismissed) {
    return (
      <BenchIntro
        onChallenge={(id) => api.startChallenge(id, experiment.a)}
        onOwn={() => setDismissed(true)}
      />
    );
  }

  return (
    <section className="bench" aria-labelledby="bench-heading">
      <h2 className="sr-only" id="bench-heading">
        Prompt experiment
      </h2>

      <Goal api={api} challenge={challenge} />

      <Steps api={api} cost={cost} />

      <div className="bench__pair">
        <Variant
          side="a"
          api={api}
          challenge={challenge}
          requestLimits={requestLimits}
        />

        <Variant
          side="b"
          api={api}
          challenge={challenge}
          requestLimits={requestLimits}
        />
      </div>

      {/*
        Only once something HAS changed.

        This used to announce "Nothing — A and B are identical"
        at a learner who had just opened a challenge, which reads
        as a status report on a screen where what they needed was
        an instruction. Step 1 above says what to do instead, and
        this says what they did once they have done it.
      */}
      {api.differences.length > 0 ? <Changed api={api} /> : null}

      <Launch
        api={api}
        canRun={canRun}
        blockedReason={blockedReason}
        cost={cost}
      />

      <Judgement api={api} />

      <Findings api={api} />
    </section>
  );
}

/* =========================================================
   WHAT YOU ARE TRYING TO FIND OUT

   The only thing on the screen that is a goal rather than a
   setting, so it goes at the top and it is the largest text
   here. An experiment without a question is fiddling.
========================================================= */

function Goal({
  api,
  challenge,
}: {
  api: ExperimentApi;
  challenge: Challenge | undefined;
}) {
  const id = useId();

  /*
   * Starting over clears the prompts, which brings the openers
   * back — that is the only route back to the challenge list
   * once one has been picked, so it cannot be hidden behind
   * anything.
   */
  const startOver = (
    <button
      type="button"
      className="goal__reset"
      title="Clear both sides and go back to the starting points. Your findings are kept."
      onClick={() =>
        api.startFresh({ ...api.experiment.a, system: "", prompt: "" })
      }
    >
      Start over
    </button>
  );

  if (challenge) {
    return (
      <header className="goal goal--challenge">
        <div className="goal__top">
          <p className="goal__eyebrow">
            <Target size={14} aria-hidden="true" />
            Challenge
          </p>

          {startOver}
        </div>

        <h3 className="goal__text">{challenge.title}</h3>
        <p className="goal__detail">{challenge.goal}</p>
        <p className="goal__why">{challenge.why}</p>
      </header>
    );
  }

  return (
    <header className="goal">
      <div className="goal__top">
        <label className="goal__eyebrow" htmlFor={id}>
          <FlaskConical size={14} aria-hidden="true" />
          What are you trying to find out?
        </label>

        {startOver}
      </div>

      <input
        id={id}
        className="goal__input"
        value={api.experiment.question}
        placeholder="e.g. does adding an output format make it shorter?"
        onChange={(event) => api.setQuestion(event.target.value)}
      />
    </header>
  );
}

/* =========================================================
   WHAT TO DO NOW

   Three steps, and the current one lit.

   The bench was legible and still left a twelve-year-old
   staring at two identical panels with no idea what was being
   asked of them. Everything on the screen described a STATE —
   here is A, here is B, they are identical, this costs 2 XP —
   and nothing named an ACTION.

   So: one line that always says what happens next, derived from
   what is actually on the bench rather than from a tutorial
   somebody has to be walked through. It is the loop, written
   down: change one thing, run both, pick a winner.
========================================================= */

function Steps({ api, cost }: { api: ExperimentApi; cost: number }) {
  const changed = api.differences.length > 0;

  const at = api.comparable ? 3 : changed ? 2 : 1;

  const how =
    at === 1
      ? "Add a rule, cut the question down, swap a word — anything. Just one thing, so you know what caused the difference."
      : at === 2
        ? `Both go at the same moment, so neither gets a better run of the AI than the other. Costs ${cost} XP.`
        : "Read them side by side. The one you keep becomes the new A, and you go again.";

  const steps = [
    { n: 1, label: "Change one thing in B" },
    { n: 2, label: "Run both" },
    { n: 3, label: "Pick the better answer" },
  ];

  return (
    <div className="steps">
      <ol className="steps__list">
        {steps.map((step) => (
          <li
            key={step.n}
            className={
              step.n === at
                ? "step step--now"
                : step.n < at
                  ? "step step--done"
                  : "step"
            }
            aria-current={step.n === at ? "step" : undefined}
          >
            <span className="step__num" aria-hidden="true">
              {step.n < at ? "✓" : step.n}
            </span>
            {step.label}
          </li>
        ))}
      </ol>

      <p className="steps__how">{how}</p>
    </div>
  );
}

/* =========================================================
   ONE SIDE

   The Playground's two fields, and the answer underneath them.
   Nothing invented: this is the composer everybody already
   understands, twice, with a colour each.
========================================================= */

function Variant({
  side,
  api,
  challenge,
  requestLimits,
}: {
  side: Side;
  api: ExperimentApi;
  challenge: Challenge | undefined;
  requestLimits: AiRequestLimits | undefined;
}) {
  const systemId = useId();
  const promptId = useId();

  const settings = side === "a" ? api.experiment.a : api.experiment.b;
  const run = side === "a" ? api.a : api.b;

  const results = challenge ? runChecks(challenge.checks, run.output) : [];
  const passed = challenge ? allPassed(results) : false;

  const streaming = run.phase === "streaming";

  return (
    <article className="variant" data-side={side}>
      <header className="variant__head">
        <span className="variant__letter" aria-hidden="true">
          {side.toUpperCase()}
        </span>

        <h3 className="variant__name">
          {side === "a" ? "Your prompt" : "Same prompt, one change"}
        </h3>

        {/* Said on B, where the editing happens, as well as in
            step 1 above. A learner who has scrolled past the
            steps is looking at this panel, and this is the panel
            the instruction is about. */}
        {side === "b" && api.differences.length === 0 ? (
          <span className="variant__nudge">edit me</span>
        ) : null}

        {run.done ? (
          <span className="variant__stat">
            {run.output.trim().length.toLocaleString()} chars
            {run.done.latencyMs
              ? ` · ${(run.done.latencyMs / 1000).toFixed(1)}s`
              : ""}
          </span>
        ) : null}
      </header>

      {/*
        Plain words first, the API's own name underneath in small
        type.

        "System instructions" means nothing to somebody who has
        only ever typed into a chat box, and leading with it
        teaches them that this tool is not for them. "Rules for
        the AI" is a thing they already understand, and the real
        name sitting under it is then something they can attach
        to it — which is the whole reason a teaching product
        shows both rather than picking one.
      */}
      <label className="variant__label" htmlFor={systemId}>
        Rules for the AI
        <span className="variant__optional">optional</span>
        <span className="variant__jargon">system instructions</span>
      </label>

      <textarea
        id={systemId}
        className="variant__field"
        rows={3}
        value={settings.system}
        /* An example, not another explanation — the label above
           already says what this field is, and a second
           paragraph of grey prose repeated across both panels
           was most of what made this screen look busy. */
        placeholder={
          side === "a"
            ? "e.g. Answer in three bullets. Never say “it depends”."
            : "Try changing this one."
        }
        maxLength={requestLimits?.maxSystemChars}
        disabled={streaming}
        spellCheck
        onChange={(event) => api.edit(side, { system: event.target.value })}
      />

      <label className="variant__label" htmlFor={promptId}>
        What you're asking
        <span className="variant__jargon">user prompt</span>
      </label>

      <textarea
        id={promptId}
        className="variant__field"
        rows={3}
        value={settings.prompt}
        placeholder="e.g. Is it better to learn Python or JavaScript first?"
        maxLength={requestLimits?.maxMessageChars}
        disabled={streaming}
        spellCheck
        onChange={(event) => api.edit(side, { prompt: event.target.value })}
      />

      <div
        className="variant__answer"
        aria-busy={streaming}
        role="region"
        aria-label={`Answer from ${side.toUpperCase()}`}
      >
        {streaming ? (
          <p className="variant__streaming">
            <span className="variant__dot" aria-hidden="true" />
            Answering…
          </p>
        ) : null}

        {run.output ? (
          /* Rendered as what it is. The text itself is untouched
             — `output` is still exactly what the provider
             streamed, which is what the checks and the length
             measurement read. */
          <Suspense
            fallback={<p className="variant__idle">Preparing the answer…</p>}
          >
            <div className="variant__text">
              <ResponseMarkdown source={run.output} streaming={streaming} />
            </div>
          </Suspense>
        ) : run.error ? (
          <p className="variant__error">{run.error.message}</p>
        ) : !streaming ? (
          <p className="variant__idle">Nothing run yet.</p>
        ) : null}
      </div>

      {/*
        The check, when there is one.

        Deterministic and boring on purpose — a word count, a
        string test, a JSON parse. A quality score out of a
        hundred would feel better and would teach a learner to
        optimise for the judge.
      */}
      {challenge && run.output ? (
        <ul className={passed ? "checks checks--passed" : "checks"}>
          {challenge.checks.map((check, index) => (
            <li
              key={check.label}
              className={
                results[index]?.passed ? "check check--pass" : "check"
              }
            >
              <span className="check__mark" aria-hidden="true">
                {results[index]?.passed ? "✓" : "✗"}
              </span>
              <span className="check__label">{check.label}</span>
              <span className="check__detail">{results[index]?.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/* =========================================================
   THE ONE THING THAT CHANGED

   The bar between the two sides, and the reason B is cloned
   from A rather than starting empty. `diffSettings` next door
   already computes this — it was written for the Playground's
   "What Changed?" panel, which asks the same question about two
   consecutive runs.
========================================================= */

function Changed({ api }: { api: ExperimentApi }) {
  const identical = api.differences.length === 0;
  const tooMany = api.differences.length > 1;

  return (
    <div
      className={
        identical
          ? "changed changed--none"
          : tooMany
            ? "changed changed--many"
            : "changed"
      }
    >
      <span className="changed__label">One thing changed</span>
      <p className="changed__text">{api.changeSummary}</p>
    </div>
  );
}

/* =========================================================
   RUN BOTH
========================================================= */

function Launch({
  api,
  canRun,
  blockedReason,
  cost,
}: {
  api: ExperimentApi;
  canRun: boolean;
  blockedReason: string | null;
  cost: number;
}) {
  const nothingToRun =
    api.experiment.a.prompt.trim() === "" ||
    api.experiment.b.prompt.trim() === "";

  const reason = nothingToRun
    ? "Both sides need a prompt before they can be compared."
    : blockedReason;

  return (
    <div className="launch">
      {api.running ? (
        <button
          type="button"
          className="runbtn runbtn--stop"
          onClick={api.stop}
        >
          <CircleStop size={18} aria-hidden="true" />
          Stop both
        </button>
      ) : (
        <button
          type="button"
          className="runbtn"
          disabled={!canRun || nothingToRun}
          title={reason ?? undefined}
          onClick={() => void api.runBoth()}
        >
          <Play size={17} aria-hidden="true" />
          Run both
          <span className="runbtn__cost">{cost} XP</span>
        </button>
      )}

      <p className="launch__note">
        {api.running
          ? "Both requests are in flight. Stopping aborts them at the provider, so the rest is never generated and never billed."
          : (reason ??
            "Two requests, sent at the same moment so neither gets a better run of the provider than the other.")}
      </p>
    </div>
  );
}

/* =========================================================
   THE VERDICT

   The point of the whole screen, and the one thing on it that
   is not automated. Which answer is better is a judgement, and
   handing that judgement to a second language model would be
   the fastest way to teach a learner not to read the output.
========================================================= */

function Judgement({ api }: { api: ExperimentApi }) {
  const [note, setNote] = useState("");
  const id = useId();

  if (!api.comparable) {
    return null;
  }

  const delta = lengthDelta(api.a.output, api.b.output);
  const measured = describeLength(delta);

  function decide(winner: Side) {
    api.judge(winner, note.trim());
    setNote("");
  }

  return (
    <div className="judge">
      <div className="judge__head">
        <Trophy size={15} aria-hidden="true" />
        <p className="judge__question">Which answer is better?</p>
        {measured ? <span className="judge__measure">{measured}</span> : null}
      </div>

      <label className="sr-only" htmlFor={id}>
        What did you notice?
      </label>

      <input
        id={id}
        className="judge__note"
        value={note}
        placeholder="Optional — what did you notice? (this becomes a finding)"
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="judge__buttons">
        <button
          type="button"
          className="judge__pick judge__pick--a"
          onClick={() => decide("a")}
        >
          A wins
        </button>

        <button
          type="button"
          className="judge__pick judge__pick--b"
          onClick={() => decide("b")}
        >
          B wins
        </button>
      </div>

      <p className="judge__note-why">
        The winner becomes the new A and B is copied from it, so the next thing
        you change is measured against what just won.
      </p>
    </div>
  );
}

/* =========================================================
   FINDINGS

   What a learner walks away with. Kept after the experiment
   that produced them is gone, because the conclusions are the
   point and the prompts were the scaffolding.
========================================================= */

function Findings({ api }: { api: ExperimentApi }) {
  if (api.findings.length === 0) {
    return null;
  }

  return (
    <section className="findings" aria-labelledby="findings-heading">
      <div className="findings__head">
        <h3 className="findings__title" id="findings-heading">
          What you've found out
        </h3>

        <button
          type="button"
          className="findings__clear"
          onClick={api.clearFindings}
        >
          <Trash2 size={13} aria-hidden="true" />
          Clear
        </button>
      </div>

      <ol className="findings__list">
        {api.findings.map((entry) => (
          <li key={entry.id} className="finding">
            <span className="finding__when">{relativeTime(entry.at)}</span>

            <div className="finding__body">
              {entry.question ? (
                <p className="finding__question">{entry.question}</p>
              ) : null}

              <p className="finding__changed">
                <ArrowRight size={12} aria-hidden="true" />
                {entry.changed}
              </p>

              <p className="finding__outcome">{entry.outcome}</p>

              {entry.note ? (
                <p className="finding__note">“{entry.note}”</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export type { LabSettings };
