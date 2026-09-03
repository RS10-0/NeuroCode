import AssistantTemplate from "./AssistantTemplate";
import FlagshipSite from "../flagship/FlagshipSite";
import { flagshipIdentity } from "../flagship/identity";
import PortfolioTemplate from "./PortfolioTemplate";
import ResearchTemplate from "./ResearchTemplate";
import StudyTemplate from "./StudyTemplate";
import type { PublicSite } from "../publicApi";
import type { SiteConfig } from "../schema";
import type { PublicAgentFace } from "../publicApi";

/*
 * A stored document becomes a page.
 *
 * Two jobs, and nothing else. It resolves the theme onto data
 * attributes — which is all a palette is, because every
 * component below reads semantic token names and none of them
 * knows which palette is active — and it picks a layout.
 *
 * The `preview` flag is what lets the editor show a real page
 * rather than a picture of one. The Customise screen renders
 * this same component against its unsaved draft, so what a
 * student is looking at while they type is the renderer that
 * will serve their visitors, not a second implementation that
 * agrees with it today.
 */

export interface TemplateProps {
  slug: string;
  config: SiteConfig;
  agent: PublicAgentFace;
  chatLive: boolean;
}

export interface SiteRendererProps {
  site: PublicSite;
  /*
   * Set when this is the editor's preview.
   *
   * It suppresses nothing visual — a preview that looked
   * different from the page would be worth very little. What it
   * does is stop the chat from talking to the live endpoint on
   * every keystroke, because a preview that spent the student's
   * allowance while they were choosing a font would be a
   * genuinely expensive surprise.
   */
  preview?: boolean;
}

export default function SiteRenderer({ site, preview }: SiteRendererProps) {
  const { config } = site;

  /*
   * ONE OF BUILDGENTIC'S OWN FIVE.
   *
   * A flagship does not render as one of the four templates. It
   * has a page designed around what it is for, and that design
   * is resolved from the catalogue rather than from the stored
   * document — see the note at the top of flagship/FlagshipSite.
   *
   * Checked before the theme is resolved, because none of the
   * attributes below apply to it: a signature page brings its
   * own palette, its own typography and its own mode, and
   * layering a student's palette tokens over it would be
   * exactly the "same page, different colours" outcome the
   * whole thing exists to avoid.
   *
   * The condition is deliberately narrow. `flagshipId` is only
   * ever sent for an agent the row marks as BuildGentic's, and an
   * id this build has no design for falls straight through to
   * the generic renderer below — so nothing a student built can
   * reach this branch, and nothing that reaches it can fail to
   * render.
   */
  if (flagshipIdentity(site.agent.flagshipId)) {
    return <FlagshipSite site={site} preview={preview} />;
  }

  const props: TemplateProps = {
    slug: site.slug,
    config,
    agent: site.agent,
    chatLive: preview ? false : site.chatLive,
  };

  return (
    <div
      className={`site site--${config.template}`}
      data-palette={config.theme.palette}
      data-mode={config.theme.mode}
      data-font={config.theme.font}
      data-corners={config.theme.corners}
      /*
       * Tells the browser what kind of surface this is, so form
       * controls, scrollbars and the space behind a short page
       * follow the student's palette rather than staying white
       * under a dark theme.
       */
      style={{ colorScheme: config.theme.mode }}
    >
      <Layout {...props} />
    </div>
  );
}

function Layout(props: TemplateProps) {
  switch (props.config.template) {
    case "study":
      return <StudyTemplate {...props} />;

    case "portfolio":
      return <PortfolioTemplate {...props} />;

    case "research":
      return <ResearchTemplate {...props} />;

    case "assistant":
    default:
      return <AssistantTemplate {...props} />;
  }
}
