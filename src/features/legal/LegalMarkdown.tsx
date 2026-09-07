import ReactMarkdown from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";

/*
 * The body of a legal document.
 *
 * Its own module purely so pages/Legal.tsx can lazy() it — the
 * reasoning for that split is in the comment above the import
 * there.
 *
 * Deliberately much smaller than the Lab's ResponseMarkdown,
 * and the differences are all the same difference: that one
 * renders text a model produced, this one renders a constant
 * we wrote.
 *
 *   No rehype-sanitize. The source is src/content/legal.ts,
 *   compiled into the bundle. Sanitising it would imply it is
 *   untrusted, which would be a misleading thing for the next
 *   person to read — and react-markdown does not render raw
 *   HTML without rehype-raw in any case. If these documents
 *   ever start arriving from the database, that assumption
 *   changes and SANITIZE_SCHEMA in features/lab/markdown.ts is
 *   what to reach for.
 *
 *   No KaTeX and no highlighter. A policy has neither equations
 *   nor code, and those two are most of the Lab chunk's weight.
 *
 *   No stabilize(). Nothing here streams.
 *
 * GFM is kept because the documents use its dash-and-asterisk
 * list handling and autolinks.
 */

const REMARK: PluggableList = [remarkGfm];

interface LegalMarkdownProps {
  source: string;
}

export default function LegalMarkdown({ source }: LegalMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK}
      components={{
        /*
         * The only links these documents contain are mailto:
         * ones to our own address, so this is a guard against
         * what somebody adds later rather than against anything
         * present today: an off-site link in a policy should not
         * replace the policy in the same tab.
         *
         * mailto: is left alone — target="_blank" on one opens a
         * blank tab beside the mail client in some browsers.
         */
        a: ({ href, ...props }) =>
          href?.startsWith("http") ? (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer" />
          ) : (
            <a {...props} href={href} />
          ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
