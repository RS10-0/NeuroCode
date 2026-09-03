import CareerPathway from "./CareerPathway";
import CodeBench from "./CodeBench";
import ReadingRoom from "./ReadingRoom";
import StudyDesk from "./StudyDesk";
import WritingDesk from "./WritingDesk";
import { flagshipIdentity, type FlagshipIdentity } from "./identity";
import type { PublicAgentFace, PublicSite } from "../publicApi";

/*
 * A flagship's page.
 *
 * BuildGentic's own five agents do not render as one of the four
 * templates a student picks from. Each has a page designed
 * around what it is for — a manuscript desk, a pathway board, a
 * reading room, a workbench, a study desk — and this is the
 * junction between the stored row and the design that answers
 * for it.
 *
 * WHAT THIS LAYER MAY AND MAY NOT DO.
 *
 * It is presentation, and only presentation. Everything below
 * it is the machinery the generic pages already use: the same
 * `useSiteChat`, the same endpoint, the same visitor key, the
 * same memory scope, the same rate limit, the same streaming.
 * Nothing here configures the agent it is a page for, because
 * nothing on a published page ever may — which is the property
 * that stops "design the page" from becoming "edit the agent".
 *
 * WHY THE COPY IS NOT IN THE ROW.
 *
 * A flagship's page cannot be edited by anybody — the server
 * refuses through `requireEditableAgent` and the Customise
 * screen says so — so its words live in `identity.ts` and its
 * content lives in the five layouts, resolved on every render.
 * Same reasoning as `AgentStore` resolving flagship prompts
 * rather than storing them: improving a page improves it for
 * the learner who bought that agent last term, the next time
 * anybody opens it, with no migration in between.
 *
 * The stored config still owns the two things that are
 * genuinely the learner's: whether the page is published, and
 * what address it answers on.
 */

export interface FlagshipLayoutProps {
  /* Where to send a turn. The only identifier a visitor holds
     and the only one any of this needs. */
  slug: string;
  /* Name and glyph as the owner's row has them, for a layout
     that wants to show the agent rather than the design. */
  agent: PublicAgentFace;
  identity: FlagshipIdentity;
  /* Whether the agent will actually answer, folded together on
     the server. Layouts disable their own send affordances on
     this as well as passing it down. */
  live: boolean;
}

export interface FlagshipSiteProps {
  site: PublicSite;
  /* The editor's preview. Suppresses nothing visual — the
     owner should see exactly what a visitor sees — and only
     stops the chat talking to the live endpoint, which would
     otherwise spend their allowance while they looked at it. */
  preview?: boolean;
}

/*
 * Null when this build does not ship a design for the id on the
 * row, which is the same contract `findFlagship` has and is
 * what lets `SiteRenderer` fall through to the generic
 * templates rather than rendering nothing.
 */
export default function FlagshipSite({ site, preview }: FlagshipSiteProps) {
  const identity = flagshipIdentity(site.agent.flagshipId);

  if (!identity) {
    return null;
  }

  const props: FlagshipLayoutProps = {
    slug: site.slug,
    agent: site.agent,
    identity,
    live: preview ? false : site.chatLive,
  };

  return (
    <div
      className="fs"
      data-flagship={identity.id}
      /*
       * Light or dark is the design's, not the visitor's and not
       * the stored theme's. Every other page in this feature
       * takes its mode from a field a student chose; these five
       * were drawn one way each, and a workbench that opened
       * white would be a different product.
       */
      data-mode={identity.mode}
      /* So form controls, scrollbars and the space behind a
         short page follow the design rather than staying white
         underneath it. */
      style={{ colorScheme: identity.mode }}
    >
      <Layout {...props} />
    </div>
  );
}

function Layout(props: FlagshipLayoutProps) {
  switch (props.identity.id) {
    case "writing-coach":
      return <WritingDesk {...props} />;

    case "career-explorer":
      return <CareerPathway {...props} />;

    case "research-assistant":
      return <ReadingRoom {...props} />;

    case "coding-coach":
      return <CodeBench {...props} />;

    case "study-tutor":
      return <StudyDesk {...props} />;
  }
}
