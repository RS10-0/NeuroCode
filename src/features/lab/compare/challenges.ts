import type { LabSettings } from "../types";

/*
 * Challenges: a bad starting prompt, a goal, and a check that
 * can actually tell you whether you hit it.
 *
 * This is lesson 6 of the Prompt Engineering course — "one
 * genuinely terrible prompt, and everything you now know" —
 * against a real model instead of a simulation.
 *
 * EVERY CHECK BELOW IS DETERMINISTIC, and that is not a
 * limitation, it is the point. The obvious thing to build here
 * is a quality score: ask a model to rate the answer out of a
 * hundred and show a number going up. It would feel great and it
 * would teach a lie, because a learner would start optimising
 * for the judge instead of for the answer, and the judge would
 * be a second language model with all the same failure modes as
 * the first.
 *
 * So: word counts, string tests, a JSON parse, a regular
 * expression. Things that are simply true or simply false, that
 * a learner can read and verify for themselves, and that cannot
 * be flattered. What "better" means past the check stays a human
 * judgement — which is the whole reason the workspace has a
 * verdict button rather than a leaderboard.
 */

export type CheckKind = "under_words" | "forbidden" | "required" | "json" | "pattern";

export interface Check {
  kind: CheckKind;
  /* Said in the goal, in the learner's words. */
  label: string;
  /* Word ceiling for `under_words`. */
  limit?: number;
  /* Lower-cased needles for `forbidden` / `required`. */
  words?: string[];
  /* Source for `pattern`, compiled per test so no lastIndex
     state leaks between two runs of the same check. */
  pattern?: string;
}

/*
 * The answer as a person reads it, not as the model typed it.
 *
 * Models write markdown, so a perfectly good forty-word answer
 * laid out as a table comes back carrying a row of pipes, a
 * separator made of hyphens, and a pair of asterisks around
 * every heading. Counted raw, one such answer measured THREE
 * HUNDRED AND TWENTY-THREE WORDS against a fifty-word limit —
 * and failed a challenge it had actually passed.
 *
 * So every text check reads this instead. It is not a markdown
 * parser and does not need to be: it only has to stop syntax
 * being mistaken for prose. The raw output is untouched and is
 * still what gets rendered, stored and measured for length.
 */
export function readable(output: string): string {
  return (
    output
      /* Fenced code, including the fence's language tag. The
         contents are still words, so they stay. */
      .replace(/```[a-z]*\n?/gi, "")
      /* Table separator rows — |---|:--:|---| — are pure
         punctuation and the single biggest source of phantom
         words. */
      .replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, "")
      /* Cell dividers. A space keeps the words either side
         apart. */
      .replace(/\|/g, " ")
      /* Heading hashes and blockquote markers at the start of a
         line. */
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      /* Bullets and numbered list markers. */
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      /* Horizontal rules: three or more of the same mark on a
         line of their own. The backreference is what stops
         this eating an ordinary line that opens with a dash. */
      .replace(/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, "")
      /* Links and images keep their text and lose their target. */
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      /* Emphasis and inline code markers. */
      .replace(/(\*\*\*|\*\*|\*|___|__|_|`)/g, "")
      .trim()
  );
}

export interface CheckResult {
  passed: boolean;
  /* What actually happened, in a few words. Shown whether it
     passed or failed — "48 words" is as useful as "61 words". */
  detail: string;
}

export function runCheck(check: Check, output: string): CheckResult {
  /* Syntax is not prose. See `readable`. The JSON check is the
     one exception and does its own thing with the raw text,
     because there the syntax IS the answer. */
  const text = check.kind === "json" ? output.trim() : readable(output);

  if (text === "") {
    return { passed: false, detail: "No answer yet." };
  }

  switch (check.kind) {
    case "under_words": {
      const words = text.split(/\s+/).filter(Boolean).length;
      const limit = check.limit ?? 50;

      return {
        passed: words <= limit,
        detail: `${words} words`,
      };
    }

    case "forbidden": {
      const haystack = text.toLowerCase();
      const found = (check.words ?? []).filter((word) =>
        haystack.includes(word)
      );

      return {
        passed: found.length === 0,
        detail: found.length === 0 ? "None of them" : `Said “${found[0]}”`,
      };
    }

    case "required": {
      const haystack = text.toLowerCase();
      const missing = (check.words ?? []).filter(
        (word) => !haystack.includes(word)
      );

      return {
        passed: missing.length === 0,
        detail:
          missing.length === 0 ? "All present" : `Missing “${missing[0]}”`,
      };
    }

    case "json": {
      /* Models wrap JSON in a fence more often than not, and
         failing a learner for the model's markdown habit would
         teach them to fight the wrong thing. */
      const fenced = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

      try {
        JSON.parse(fenced);
        return { passed: true, detail: "Parses" };
      } catch {
        return { passed: false, detail: "Not valid JSON" };
      }
    }

    case "pattern": {
      try {
        return {
          passed: new RegExp(check.pattern ?? "", "i").test(text),
          detail: check.label,
        };
      } catch {
        /* A malformed pattern is a bug in a challenge
           definition, not a learner failing. Say so rather than
           marking their answer wrong. */
        return { passed: false, detail: "This challenge is misconfigured." };
      }
    }
  }
}

export function runChecks(checks: Check[], output: string): CheckResult[] {
  return checks.map((check) => runCheck(check, output));
}

export function allPassed(results: CheckResult[]): boolean {
  return results.length > 0 && results.every((entry) => entry.passed);
}

/* =========================================================
   THE CHALLENGES
========================================================= */

export interface Challenge {
  id: string;
  title: string;
  /* The goal, in one line, in the second person. */
  goal: string;
  /* Why this is worth doing — one sentence, and it names the
     habit rather than the mechanic. */
  why: string;
  /* The deliberately bad prompt you start from. */
  start: Pick<LabSettings, "system" | "prompt">;
  checks: Check[];
}

export const CHALLENGES: Challenge[] = [
  {
    id: "hedging",
    title: "Make it stop hedging",
    goal: "Get a straight answer with no “it depends”, no “as an AI”, and no “there are many factors”.",
    why: "Hedging is the default voice of a model with no instructions. Watch which single instruction kills it.",
    start: {
      system: "",
      prompt: "Is it better to learn Python or JavaScript first?",
    },
    checks: [
      {
        kind: "forbidden",
        label: "No hedging phrases",
        words: [
          "it depends",
          "as an ai",
          "there are many",
          "both have their",
          "ultimately, the",
        ],
      },
    ],
  },
  {
    id: "short",
    title: "Get it under fifty words",
    goal: "Same question, same quality of answer, under fifty words.",
    why: "Asking for brevity and asking for a shape are not the same move. One of them works much better than the other.",
    start: {
      system: "",
      prompt: "Explain what an API is.",
    },
    checks: [{ kind: "under_words", label: "Under 50 words", limit: 50 }],
  },
  {
    id: "shape",
    title: "Make it answer in JSON",
    goal: "Get back something a program could actually read — valid JSON, with a `title` and a `steps` list.",
    why: "“Format your answer as JSON” gets you JSON with an apology on top of it about half the time. Find the version that does not.",
    start: {
      system: "",
      prompt: "Give me a recipe for scrambled eggs.",
    },
    checks: [
      { kind: "json", label: "Valid JSON" },
      { kind: "required", label: "Has title and steps", words: ["title", "steps"] },
    ],
  },
  {
    id: "terrible",
    title: "Fix a genuinely terrible prompt",
    goal: "Rewrite it so the answer names a real audience, picks a length, and does not invent facts about a product it has never heard of.",
    why: "Lesson six, for real this time. Four separate faults, and fixing three of them still leaves it wrong.",
    start: {
      system: "",
      prompt:
        "Write something short but detailed about our new product for everyone, make it professional but fun, thanks!",
    },
    checks: [
      { kind: "under_words", label: "Under 120 words", limit: 120 },
      {
        kind: "forbidden",
        label: "Does not invent a product",
        words: ["revolutionary", "game-changing", "cutting-edge"],
      },
    ],
  },
];

export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((entry) => entry.id === id);
}
