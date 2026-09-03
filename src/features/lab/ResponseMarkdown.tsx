import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

import { SANITIZE_SCHEMA, stabilize } from "./markdown";

/*
 * The model's answer, rendered as what it is.
 *
 * Models write markdown and LaTeX because that is what they were
 * trained on. Showing `$KE = \frac{1}{2}mv^2$` as literal
 * characters is not neutral — for a physics question it is
 * strictly worse than useless, because the one thing the learner
 * came for is the equation and the equation is the part they
 * cannot read. So it is parsed properly rather than patched over
 * with regular expressions, which is a job that looks nearly
 * done at every stage and never actually finishes.
 *
 * Nothing here touches the runtime. `output` arrives from
 * useLabRun exactly as the provider streamed it and is stored
 * exactly as it arrived; this is the last step before pixels.
 */

interface ResponseMarkdownProps {
  source: string;
  /* Only true while tokens are still arriving. See markdown.ts
     for why the two cases render differently. */
  streaming: boolean;
}

/*
 * Plugin order is load-bearing; the reasoning is in markdown.ts.
 * Sanitise first, then let KaTeX and the highlighter build their
 * markup out of text that has already been cleaned.
 */
const REMARK: PluggableList = [remarkGfm, remarkMath];

const REHYPE: PluggableList = [
  [rehypeSanitize, SANITIZE_SCHEMA],
  [
    rehypeKatex,
    {
      /*
       * A malformed expression renders as red source text
       * instead of throwing. A model that emits slightly wrong
       * LaTeX should cost the learner one bad-looking line, not
       * the whole answer.
       */
      throwOnError: false,
      /* Warnings about unicode and other quibbles are not the
         learner's problem. */
      strict: false,
      /*
       * KaTeX's own escape hatch, kept shut. With `trust` off,
       * \href, \url and \includegraphics cannot introduce a
       * javascript: URL — which matters here precisely because
       * the LaTeX reaching this point was written by a model.
       */
      trust: false,
      output: "htmlAndMathml",
    },
  ],
  [
    rehypeHighlight,
    {
      /* An unknown language tag is a plain code block, not a
         crash. */
      ignoreMissing: true,
      /* Guessing a grammar for an untagged block gets it wrong
         often enough to be noise. */
      detect: false,
    },
  ],
];

function ResponseMarkdown({ source, streaming }: ResponseMarkdownProps) {
  const text = useMemo(
    () => stabilize(source, streaming),
    [source, streaming]
  );

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={{
          /*
           * A model can emit a link, and a link in a model's
           * answer is one a learner did not choose to follow.
           * The sanitiser has already restricted the protocol to
           * http/https/mailto; this stops it from replacing the
           * Lab in the same tab and from handing the opened page
           * a reference back to this one.
           */
          a: ({ ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
          ),

          /*
           * Wide content scrolls in its own box rather than
           * widening the page. A markdown table from a model is
           * routinely wider than a phone.
           */
          table: ({ ...props }) => (
            <div className="md__scroll">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/*
 * Memoised on the text.
 *
 * A stream re-renders the panel on every delta — dozens of times
 * a second — and each render re-parses the whole answer and
 * re-typesets every equation in it. Without this the panel gets
 * visibly slower as the answer grows, which is the one place a
 * learner would notice.
 */
export default memo(ResponseMarkdown);
