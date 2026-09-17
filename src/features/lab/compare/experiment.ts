import { abbreviate, diffSettings, type LabSettings } from "../types";

/*
 * An experiment: two versions of one request, and what you
 * concluded from running them.
 *
 * THE POINT OF THE WHOLE WORKSPACE IS IN THE COMMENT BELOW, so
 * it is worth stating before any code.
 *
 * Lesson 6 of the Prompt Engineering course says it better than
 * a docstring can: "A rewritten prompt that produces a
 * nicer-sounding answer has not necessarily fixed anything. If
 * the audience is still unstated, you got lucky on one run."
 *
 * One run proves nothing. The Playground next door runs exactly
 * one request at a time and instruments it beautifully, which
 * teaches what a request IS. It cannot teach what a CHANGE DOES,
 * because a change only exists between two runs, and by the time
 * you have made the second one the first is a memory and a
 * scroll position.
 *
 * So the unit here is not a prompt. It is a pair.
 *
 * A VARIANT IS JUST `LabSettings`. Three earlier attempts at this
 * workspace invented a document model — blocks, lanes, a
 * wizard — and all three ended up being about composing text
 * rather than about experimenting with it. The Playground's two
 * fields and three parameters are a perfectly good prompt
 * editor that nobody has complained about, and reusing the shape
 * means `diffSettings` already knows how to say what differs
 * between A and B.
 */

/* Which side. Used for colour, labels and which one a verdict
   promotes. */
export type Side = "a" | "b";

export interface Verdict {
  id: string;
  /* Epoch ms. Rendered as a relative time. */
  at: number;
  /* Which side the learner judged better. */
  winner: Side;
  /*
   * What differed, frozen at the moment of judging.
   *
   * Stored rather than recomputed, because the settings move on
   * the instant a winner is promoted — the finding "adding an
   * output format cut it by 71%" has to keep pointing at the
   * change that produced it, not at whatever is on screen now.
   */
  changed: string;
  /* The measured difference in output length, as a percentage.
     Null when a side did not produce an answer. */
  lengthDelta: number | null;
  /* The learner's own sentence. Optional — a verdict with no
     note is still a verdict, and demanding prose before you can
     move on is how a fast loop becomes a chore. */
  note: string;
}

export interface Experiment {
  id: string;
  /* What you are trying to find out. Free text, and the one
     thing on the screen that is a goal rather than a setting. */
  question: string;
  /* Set when the experiment came from a challenge, so the check
     and the goal can be found again after a reload. */
  challengeId: string | null;
  a: LabSettings;
  b: LabSettings;
  verdicts: Verdict[];
  createdAt: number;
  updatedAt: number;
}

/* Not crypto, and does not need to be — these ids exist to give
   React a stable key and to address a row in storage. */
function mintId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function experimentId(): string {
  return mintId("x");
}

export function verdictId(): string {
  return mintId("v");
}

/*
 * B starts as a copy of A.
 *
 * Not empty, and this is the load-bearing decision of the whole
 * design. An empty B invites a learner to write a second,
 * unrelated prompt and compare two things that differ in nine
 * ways — which is the habit the workspace exists to break. A
 * cloned B means the only way to make the two differ is to
 * change something, and whatever you change is visibly the one
 * thing that changed.
 */
export function newExperiment(
  settings: LabSettings,
  question = ""
): Experiment {
  const now = Date.now();

  return {
    id: experimentId(),
    question,
    challengeId: null,
    a: { ...settings, stop: [...settings.stop] },
    b: { ...settings, stop: [...settings.stop] },
    verdicts: [],
    createdAt: now,
    updatedAt: now,
  };
}

/* =========================================================
   WHAT CHANGED

   `diffSettings` in features/lab/types.ts already does the
   comparing, labelling and abbreviating — it was written for
   the Playground's "What Changed?" panel, which asks the same
   question about two consecutive runs. This is the same
   question about two simultaneous ones, so nothing here
   re-implements it.
========================================================= */

export interface Difference {
  /* "System instructions", "Temperature" — the label
     diffSettings already supplies. */
  label: string;
  from: string;
  to: string;
}

export function differences(experiment: Experiment): Difference[] {
  return diffSettings(experiment.a, experiment.b).map((change) => ({
    label: change.label,
    from: abbreviate(change.from, 60),
    to: abbreviate(change.to, 60),
  }));
}

/*
 * One sentence naming the change, for a finding.
 *
 * Deliberately blunt about the case the workspace is trying to
 * discourage. Two identical variants are a wasted pair of runs,
 * and four differences at once is an experiment that cannot tell
 * you which of the four did anything — saying so is more useful
 * than listing them.
 */
export function describeChange(differences: Difference[]): string {
  if (differences.length === 0) {
    return "Nothing — A and B are identical.";
  }

  if (differences.length === 1) {
    const only = differences[0];

    if (only.from === "empty") {
      return `${only.label} added: “${only.to}”`;
    }

    if (only.to === "empty") {
      return `${only.label} removed.`;
    }

    return `${only.label}: “${only.from}” → “${only.to}”`;
  }

  return `${differences.length} things at once — ${differences
    .map((entry) => entry.label.toLowerCase())
    .join(", ")}. Change one at a time and you will know which one did it.`;
}

/* =========================================================
   MEASURING THE OUTPUTS

   Deliberately small, and deliberately not a quality score.

   A number that claimed to rate an answer's quality would be
   invented, and a learner would optimise for it instead of for
   the answer. Length and speed are facts. Which answer is
   BETTER is the learner's call, and leaving that call to them is
   the part of this that is actually teaching.
========================================================= */

export function lengthDelta(
  aOutput: string,
  bOutput: string
): number | null {
  const from = aOutput.trim().length;

  if (from === 0 || bOutput.trim().length === 0) {
    return null;
  }

  return Math.round(((bOutput.trim().length - from) / from) * 100);
}

/* "71% shorter" reads; "-71%" has to be decoded. */
export function describeLength(delta: number | null): string | null {
  if (delta === null || Math.abs(delta) < 5) {
    return null;
  }

  return delta < 0
    ? `B came back ${Math.abs(delta)}% shorter.`
    : `B came back ${delta}% longer.`;
}
