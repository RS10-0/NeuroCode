import { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeOptions } from "rehype-sanitize";

/*
 * The two things that make rendering a model's answer different
 * from rendering a blog post: it is untrusted, and it arrives a
 * few characters at a time.
 *
 * This file holds the answer to both, away from the component so
 * that neither is buried in JSX.
 */

/* =========================================================
   SANITISING

   Model output is untrusted input. It is not an attacker in the
   usual sense, but it is text BuildGentic did not write, it can
   be steered by whatever a learner pastes into the prompt, and
   it ends up as HTML in another learner's browser the moment
   anything is ever shared. So it goes through the same gate any
   other untrusted markup would.

   Two layers, and both are doing work:

     react-markdown does not render raw HTML at all unless
     rehype-raw is added, which it is not. A model that emits
     <script> or <img onerror> gets inert text.

     rehype-sanitize then runs over the tree react-markdown
     built, which catches anything the first layer would have
     let through — a javascript: href being the obvious one.

   The ordering below matters more than it looks. Sanitising
   runs BEFORE KaTeX and the syntax highlighter, not after.
   Those two generate a great deal of markup — MathML, dozens of
   positioned spans — and allow-listing all of it would mean
   opening up exactly the elements and attributes most worth
   keeping shut. Running them afterwards means they are
   transforming text that has already been cleaned, and their
   output is ours rather than the model's.

   The cost of that ordering is this schema: the sanitiser has
   to be told to keep the two class names those plugins use to
   find their own targets, or it strips them and the plugins
   find nothing.
   ========================================================= */

export const SANITIZE_SCHEMA: SanitizeOptions = {
  ...defaultSchema,

  attributes: {
    ...defaultSchema.attributes,

    /*
     * remark-math marks maths as <span class="math math-inline">
     * and <div class="math math-display">; rehype-katex looks
     * for exactly those. Only those three values are allowed
     * through — a class name is otherwise still stripped, so
     * the model cannot reach into BuildGentic's own stylesheet.
     */
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", "math", "math-inline"],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "math", "math-display"],
    ],

    /*
     * `code` already permits /^language-./ in the default
     * schema, which is what rehype-highlight reads to pick a
     * grammar. Left exactly as it is.
     */
  },
};

/* =========================================================
   STREAMING

   Markdown assumes it is complete. Half of it is not markdown
   at all — it is the first half of a rule that has not closed
   yet, and rendering it as though it had produces exactly the
   flicker this whole feature is meant to remove: a raw
   `$$\frac{1` sitting on screen for 200ms, then a red KaTeX
   error, then the real thing.

   So while tokens are still arriving, an unterminated maths
   expression is held back until its closing delimiter shows up.
   It appears the instant it can be rendered properly, and never
   appears as syntax. An unterminated code fence is closed
   instead of hidden, because a code block's content is worth
   reading as it streams and gains nothing from being withheld.

   None of this touches the stored text. `output` in the run
   state is always the full, unmodified answer — this is a view
   concern, applied at render and only while `streaming` is
   true.
   ========================================================= */

/*
 * A copy of the source with code spans and code fences blanked
 * out, character for character.
 *
 * Same length as the original on purpose, so an index found in
 * the mask is an index into the real string. Without this, a
 * `$` inside a shell snippet or a LaTeX example in a code block
 * would be read as an opening maths delimiter and the scanner
 * would hold back the rest of the answer indefinitely.
 */
function maskCode(source: string): string {
  const blank = (match: string) => "x".repeat(match.length);

  return (
    source
      /* Fenced blocks, including one that has not closed yet —
         the trailing `$` alternative matches to end of input. */
      .replace(
        /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n[ \t]*\2|$)|$)/g,
        blank
      )
      /* Inline spans. */
      .replace(/`+[^`\n]*`+/g, blank)
  );
}

/* Where an unclosed maths expression begins, or -1. */
function openMathAt(masked: string): number {
  let i = 0;

  while (i < masked.length) {
    /* An escaped delimiter is a literal dollar sign, not maths. */
    if (masked[i] === "\\") {
      i += 2;
      continue;
    }

    if (masked.startsWith("$$", i)) {
      const close = masked.indexOf("$$", i + 2);

      if (close === -1) {
        return i;
      }

      i = close + 2;
      continue;
    }

    if (masked[i] === "$") {
      let j = i + 1;
      let close = -1;

      while (j < masked.length) {
        if (masked[j] === "\\") {
          j += 2;
          continue;
        }

        if (masked[j] === "$") {
          close = j;
          break;
        }

        j += 1;
      }

      if (close === -1) {
        return i;
      }

      i = close + 1;
      continue;
    }

    i += 1;
  }

  return -1;
}

/* How many fences are open at the end of the text. */
function hasOpenFence(source: string): boolean {
  const fences = source.match(/^[ \t]*(?:`{3,}|~{3,})/gm);
  return fences ? fences.length % 2 === 1 : false;
}

/*
 * The text to render this frame.
 *
 * `streaming` false returns the input untouched — a finished
 * answer is rendered exactly as the model wrote it, including
 * any maths it genuinely left unterminated, which is the
 * model's mistake to show rather than ours to hide.
 */
export function stabilize(source: string, streaming: boolean): string {
  if (!streaming || source === "") {
    return source;
  }

  const cut = openMathAt(maskCode(source));
  const text = cut === -1 ? source : source.slice(0, cut);

  return hasOpenFence(text) ? `${text}\n\`\`\`` : text;
}
