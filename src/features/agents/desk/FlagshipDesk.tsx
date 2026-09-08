import { Link } from "react-router-dom";
import { ExternalLink, Sparkles } from "lucide-react";

import { Callout } from "../../../components/ui";
import EmailSection from "../EmailSection";
import KnowledgeSection from "../KnowledgeSection";
import MemorySection from "../MemorySection";
import RecordsSection from "../RecordsSection";
import { findCapability } from "../capabilities";
import { findFlagship, flagshipPublishable } from "../flagships";
import { flagshipIdentity } from "../../sites/flagship/identity";
import { deskCopy } from "./deskCopy";
import type { AgentDraft, KnowledgeEntry } from "../types";
import type { AgentMemoryState } from "../useAgentMemory";
import type { KnowledgeIndexStatus } from "../knowledgeIndex";

/*
 * The screen a student gets for an agent they bought.
 *
 * The Builder is for an agent somebody is BUILDING: seven tabs,
 * every one of them a decision. A flagship has had those
 * decisions made for it, so four of those tabs — Identity,
 * Answering, Capabilities, Connections — rendered a grey panel
 * saying "you cannot change this" and nothing else. Somebody
 * spent a hundred XP and landed on a screen that was four
 * sevenths empty and showed them nothing they had bought.
 *
 * This is the other half of an argument the Builder already
 * makes. Its own comment says that for a flagship the
 * CONFIGURATION is fixed but the MATERIAL is the learner's,
 * which is why Knowledge and Memory stayed editable there. The
 * desk makes that the shape of the screen instead of a
 * footnote explaining four dead panels: what you unlocked, then
 * the one thing you can actually do to change how it answers.
 *
 * One component for all six, driven by a copy table. See
 * deskCopy.ts for why that is enough.
 */

export interface FlagshipDeskProps {
  draft: AgentDraft;
  /* Null only in the dev gallery. A real flagship is saved by
     the purchase itself, so on the product path this is set. */
  agentId: string | null;
  flagshipId: string | null;

  /* ----- everything the material section needs, straight
           through from the Builder ----- */
  knowledge: KnowledgeEntry[];
  systemBudget: number;
  onKnowledgeChange: (entries: KnowledgeEntry[]) => void;
  index: KnowledgeIndexStatus | null;
  indexing: boolean;
  indexError: string | null;
  dirty: boolean;
  onReindex: () => void;

  memory: AgentMemoryState;
}

export default function FlagshipDesk({
  draft,
  agentId,
  flagshipId,
  knowledge,
  systemBudget,
  onKnowledgeChange,
  index,
  indexing,
  indexError,
  dirty,
  onReindex,
  memory,
}: FlagshipDeskProps) {
  const flagship = findFlagship(flagshipId);
  const copy = deskCopy(flagshipId);

  /*
   * Optional decoration, not identity.
   *
   * identity.ts is a Partial on purpose — Email Agent has no
   * public page and therefore no page design. So the desk takes
   * its NAME and DESCRIPTION from the catalogue, which has all
   * six, and uses the page identity only to borrow that agent's
   * palette. The sixth simply keeps the application's own.
   */
  const identity = flagshipIdentity(flagshipId);

  const hasEmail =
    draft.capabilities.includes("email_read") ||
    draft.capabilities.includes("email_draft") ||
    draft.capabilities.includes("email_send") ||
    draft.capabilities.includes("email_organize");

  /* The nudge is written for exactly one moment — an agent that
     is markedly better once it has been given something, before
     it has been given anything. Shown then and not after. */
  const nudge =
    knowledge.length === 0 ? flagship?.onboardingNudge ?? null : null;

  /* `chat` is on every agent and says nothing; the rest is what
     the Capabilities tab should have been showing all along. */
  const abilities = draft.capabilities
    .filter((id) => id !== "chat")
    .map((id) => findCapability(id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <div
      className="desk deskskin"
      /*
       * Borrows the flagship's own palette from the block that
       * already themes its public page. Deliberately NOT the
       * `.fs` class those blocks are keyed to as well: that one
       * sets min-height 100vh and resets margins and list styles
       * on everything beneath it, which would fight every
       * application component nested in here. Same trick, and
       * the same scoping, as `.labsurface`.
       */
      {...(identity ? { "data-flagship": identity.id } : {})}
      {...(identity ? { "data-mode": identity.mode } : {})}
    >
      {/* -------------------------------------------------
          WHAT YOU UNLOCKED
          ------------------------------------------------- */}
      <section className="desk__head">
        <div className="desk__headtext">
          {/*
            The eyebrow, and no title under it.

            The page header directly above already carries this
            agent's avatar, its name and its actions. Repeating
            them here read as a bug rather than as a masthead —
            the same name twice, sixty pixels apart. So the desk
            opens on the one sentence the header does not have.
          */}
          <p className="desk__eyebrow meta">
            {identity?.eyebrow ?? "BuildGentic agent"}
          </p>
          <p className="desk__opening">{copy.opening}</p>
          <p className="desk__description">{draft.description}</p>
        </div>

        {abilities.length > 0 ? (
          <div className="desk__abilities">
            <h3 className="desk__subtitle">What it can do</h3>
            <dl className="desk__abilitylist">
              {abilities.map((ability) => (
                <div key={ability.id} className="desk__ability">
                  <dt>{ability.label}</dt>
                  <dd>{ability.blurb}</dd>
                </div>
              ))}
            </dl>
            <p className="desk__note">
              These were chosen for this agent and are part of what you
              unlocked. Build your own agent to pick your own.
            </p>
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------
          YOUR MATERIAL — the point of the screen
          ------------------------------------------------- */}
      <section className="desk__section">
        <h3 className="desk__sectiontitle">{copy.material.title}</h3>
        <p className="desk__sectionlede">{copy.material.lede}</p>

        {nudge ? (
          <Callout tone="info" title="Start here">
            <span className="desk__nudge">
              <Sparkles size={14} aria-hidden="true" />
              {nudge}
            </span>
          </Callout>
        ) : null}

        {knowledge.length === 0 ? (
          <ul className="desk__examples">
            {copy.material.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        ) : null}

        <KnowledgeSection
          draft={draft}
          knowledge={knowledge}
          systemBudget={systemBudget}
          onChange={onKnowledgeChange}
          index={index}
          indexing={indexing}
          indexError={indexError}
          dirty={dirty}
          onReindex={onReindex}
        />
      </section>

      {/* -------------------------------------------------
          THE MAILBOX — only for the agent that has one
          ------------------------------------------------- */}
      {hasEmail ? (
        <section className="desk__section">
          <EmailSection
            draft={draft}
            agentId={agentId}
            /*
             * The desk has no Capabilities screen to open, and
             * for a flagship there would be nothing to change on
             * it. Anything asking to go there is asking for a
             * decision BuildGentic already made.
             */
            onOpenCapabilities={() => undefined}
          />
        </section>
      ) : null}

      {/* -------------------------------------------------
          WHAT IT HAS WORKED OUT, AND WHAT IT WROTE DOWN
          ------------------------------------------------- */}
      <section className="desk__section">
        <MemorySection
          draft={draft}
          agentId={agentId}
          memory={memory}
          onOpenCapabilities={() => undefined}
        />
      </section>

      <section className="desk__section">
        <RecordsSection
          draft={draft}
          agentId={agentId}
          onOpenCapabilities={() => undefined}
        />
      </section>

      {/* -------------------------------------------------
          ITS PAGE

          Published during the purchase itself, and until now
          never mentioned to the person who bought it — the
          unlock response carries the address and the Library
          throws it away.
          ------------------------------------------------- */}
      {agentId && flagshipPublishable(flagshipId) ? (
        <section className="desk__section desk__section--page">
          <h3 className="desk__sectiontitle">Its page</h3>
          <p className="desk__sectionlede">
            This agent has a public page of its own, designed by BuildGentic to
            match it. Anyone with the link can use it — they do not need an
            account, and it never reaches your material or your mailbox.
          </p>
          <Link className="btn btn--secondary" to={`/agents/${agentId}/site`}>
            <ExternalLink size={15} aria-hidden="true" />
            Its address and whether it is published
          </Link>
        </section>
      ) : null}
    </div>
  );
}
