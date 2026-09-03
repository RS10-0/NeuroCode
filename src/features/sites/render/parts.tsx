import {
  Brain,
  BookOpen,
  Clock,
  FileText,
  Globe,
  MessagesSquare,
  Search,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Wand2,
} from "lucide-react";

import type {
  PublicAgentFace,
} from "../publicApi";
import type { SectionIcon, SiteSection } from "../schema";
import { anchorFor } from "./anchors";

/*
 * The pieces every template arranges.
 *
 * A template decides where these go and nothing else. That is
 * what makes switching templates non-destructive: a section
 * rendered by the portfolio layout and the same section
 * rendered by the research layout are the same component with
 * different CSS around it, so no content can be lost in the
 * move because no template has its own idea of what a section
 * contains.
 */

/* =========================================================
   PROSE

   The single most important function in the renderer, and the
   reason it is four lines long.

   A body is plain text. It is split on blank lines and emitted
   as paragraphs — through React's children, which escape. There
   is no markdown parser here and there is no `dangerously
   SetInnerHTML` anywhere in this feature, so a student who
   types a script tag into an About section gets a paragraph
   containing the literal characters of a script tag.

   That is deliberate and it is the whole reason the stored
   document holds text rather than markup. These pages sit on
   BuildGentic's own origin, beside the session of every signed-in
   learner who visits one; a single interpolation of stored
   markup anywhere in this directory would undo it.
========================================================= */

export function Prose({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return null;
  }

  return (
    <div className={className ?? "site-body"}>
      {paragraphs.map((block, index) => (
        <p key={index}>{block}</p>
      ))}
    </div>
  );
}

/* =========================================================
   AVATAR
========================================================= */

export function SiteAvatar({
  agent,
  size = "md",
}: {
  agent: PublicAgentFace;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={`site-avatar site-avatar--${size}`}
      /* The glyph is decorative — the agent's name is already
         beside it in text, so announcing an emoji as well only
         adds noise for a screen reader. */
      aria-hidden="true"
    >
      {agent.avatarEmoji}
    </div>
  );
}

/* =========================================================
   SECTION ICONS

   The stored document holds a name from a closed list; this is
   where a name becomes something drawn. Keeping the mapping
   here rather than in the schema is what lets the schema stay
   dependency-free and importable by the server.
========================================================= */

const ICONS: Record<SectionIcon, typeof Sparkles> = {
  spark: Sparkles,
  book: BookOpen,
  search: Search,
  chat: MessagesSquare,
  file: FileText,
  brain: Brain,
  globe: Globe,
  shield: Shield,
  clock: Clock,
  chart: TrendingUp,
  target: Target,
  wand: Wand2,
};

export function SectionIconGlyph({ icon }: { icon: SectionIcon }) {
  const Glyph = ICONS[icon] ?? Sparkles;

  return <Glyph size={18} strokeWidth={1.75} aria-hidden="true" />;
}

/* =========================================================
   SECTIONS

   One renderer per kind, dispatched from the union. Exhaustive
   by construction: adding a kind to the schema without adding
   it here is a TypeScript error rather than a section that
   silently fails to appear.
========================================================= */

export function SectionBody({ section }: { section: SiteSection }) {
  switch (section.kind) {
    case "about":
    case "text":
      return <Prose text={section.body} className="site-body site__prose" />;

    case "features":
      return (
        <div className="site-features">
          {section.items.map((item) => (
            <article className="site-feature" key={item.id}>
              <div className="site-feature__icon">
                <SectionIconGlyph icon={item.icon} />
              </div>
              <h3 className="site-feature__title">{item.title}</h3>
              <Prose text={item.body} className="site-feature__body" />
            </article>
          ))}
        </div>
      );

    case "steps":
      return (
        <ol className="site-steps">
          {section.items.map((item, index) => (
            <li className="site-step" key={item.id}>
              <span className="site-step__num" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3 className="site-step__title">{item.title}</h3>
                <Prose text={item.body} className="site-step__body" />
              </div>
            </li>
          ))}
        </ol>
      );

    case "faq":
      return (
        <div className="site-faq">
          {section.items.map((item) => (
            <div className="site-faq__item" key={item.id}>
              <h3 className="site-faq__q">{item.question}</h3>
              <Prose text={item.answer} className="site-faq__a" />
            </div>
          ))}
        </div>
      );
  }
}

/*
 * A section with its heading, in the plain arrangement three of
 * the four templates use. The portfolio and research layouts
 * compose the heading themselves — one puts it in a sticky
 * left column, the other numbers it — so they call
 * `SectionBody` directly rather than this.
 */
export function Section({ section }: { section: SiteSection }) {
  return (
    <section className="site-section" id={anchorFor(section.id)}>
      {section.title ? (
        <h2 className="site-section__title">{section.title}</h2>
      ) : null}
      <SectionBody section={section} />
    </section>
  );
}

/* =========================================================
   FOOTER
========================================================= */

export function SiteFooter({
  showBadge,
  note,
}: {
  showBadge: boolean;
  note: string;
}) {
  return (
    <footer className="site-footer">
      <span>{note}</span>

      {showBadge ? (
        <a
          className="site-footer__badge"
          href="/"
          /* Opens BuildGentic itself rather than staying inside a
             page that is not part of it. */
          target="_blank"
          rel="noreferrer noopener"
        >
          Built with BuildGentic
        </a>
      ) : (
        /*
         * The badge is optional; saying the page is AI is not.
         *
         * A chat box on an unfamiliar page, answering in the
         * first person, is something a visitor is entitled to
         * know the nature of — so turning off the branding
         * turns on the plainer sentence rather than removing
         * both.
         */
        <span>AI-generated responses. Built by a student.</span>
      )}
    </footer>
  );
}
