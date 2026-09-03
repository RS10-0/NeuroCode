import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  Monitor,
  Rocket,
  Smartphone,
} from "lucide-react";

import {
  Badge,
  Button,
  Callout,
  Panel,
  SegmentedControl,
  Skeleton,
  Tabs,
  useToast,
} from "../components/ui";
import AgentFace from "../features/agents/AgentFace";
import { isFlagshipId } from "../features/agents/flagships";
import { getAgent } from "../features/agents/agentStore";
import type { Agent } from "../features/agents/types";
import AddressControls from "../features/sites/editor/AddressControls";
import AssistPanel from "../features/sites/editor/AssistPanel";
import ContentControls from "../features/sites/editor/ContentControls";
import DesignControls from "../features/sites/editor/DesignControls";
import { useSiteDraft } from "../features/sites/editor/useSiteDraft";
import SiteRenderer from "../features/sites/render/SiteRenderer";
import type { PublicSite } from "../features/sites/publicApi";

/*
 * Giving an agent a public page.
 *
 * The screen answers four questions in the order a student asks
 * them: what will this look like, what does it say, where will
 * it live, and what does it cost me when people visit.
 *
 * The preview on the right is the real renderer, fed the real
 * draft — the same component that serves visitors, not a
 * picture of it. That is the one decision this page is built
 * around, because a preview that merely resembles the page is
 * a second implementation that agrees with the first until it
 * does not.
 *
 * The chat inside the preview is deliberately dead. It renders
 * exactly as it will, composer and all, and refuses to send —
 * a preview that talked to the live agent would spend a
 * student's allowance while they were choosing a typeface.
 */

type Pane = "design" | "content" | "address";
type Width = "desktop" | "mobile";

export default function AgentSite() {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const { notify } = useToast();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [pane, setPane] = useState<Pane>("design");

  /* BuildGentic's own agents come with their page already
     designed. See the note beside the tabs below. */
  const official = agent?.isOfficial ?? false;
  const [width, setWidth] = useState<Width>("desktop");

  useEffect(() => {
    let cancelled = false;

    getAgent(agentId)
      .then((found) => {
        if (cancelled) {
          return;
        }

        if (!found) {
          setAgentError("No such agent.");
          return;
        }

        setAgent(found);
      })
      .catch(() => {
        if (!cancelled) {
          setAgentError("Could not load this agent.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const draft = useSiteDraft({
    agentId,
    agentName: agent?.name ?? "",
    agentDescription: agent?.description ?? "",
    onNotify: notify,
  });

  /*
   * The draft, shaped as the public endpoint would return it.
   *
   * Assembled here rather than inside the renderer so the
   * renderer has exactly one input shape and cannot grow an
   * "editing" branch — the moment it has one, the preview and
   * the page are two different things again.
   */
  const previewSite: PublicSite | null = useMemo(() => {
    if (!draft.config || !agent) {
      return null;
    }

    return {
      slug: draft.slug,
      config: draft.config,
      agent: {
        name: agent.name,
        avatarEmoji: agent.avatarEmoji,
        avatarTone: agent.avatarTone,
        /*
         * So an owner previewing one of BuildGentic's own agents
         * sees the page it actually has.
         *
         * The public endpoint sends this field for an official
         * agent and the renderer draws that flagship's own
         * design from it; without it here, the preview would
         * quietly show the generic template instead — a preview
         * that disagrees with the page, which is the one thing
         * this screen is built not to do.
         */
        flagshipId:
          agent.isOfficial && isFlagshipId(agent.flagshipId)
            ? agent.flagshipId
            : undefined,
      },
      chatLive: false,
    };
  }, [draft.config, draft.slug, agent]);

  if (agentError) {
    return (
      <div className="page">
        <Callout tone="error" title="Not found">
          {agentError} <Link to="/agents">Back to My Agents</Link>
        </Callout>
      </div>
    );
  }

  const loading = draft.loading || !agent;

  return (
    <div className="page siteedit">
      <header className="siteedit__top">
        <Link className="siteedit__back" to={`/agents/${agentId}`}>
          <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
          Back to the builder
        </Link>

        <div className="siteedit__title">
          {agent ? (
            <AgentFace
              emoji={agent.avatarEmoji}
              tone={agent.avatarTone}
              size="md"
            />
          ) : (
            <Skeleton width="44px" height="44px" />
          )}

          <div>
            <h1>Public page</h1>
            <p>
              {agent
                ? `A page anybody can open, with ${agent.name} on it.`
                : "Loading…"}
            </p>
          </div>

          {draft.state?.site ? (
            <Badge tone={draft.state.site.published ? "correct" : "neutral"}>
              {draft.state.site.published ? "Live" : "Hidden"}
            </Badge>
          ) : null}
        </div>
      </header>

      {draft.loadError ? (
        <Callout tone="error" title="Could not load this page">
          {draft.loadError}
          <div className="siteedit__confirm">
            <Button size="sm" onClick={draft.reload}>
              Try again
            </Button>
          </div>
        </Callout>
      ) : null}

      {/*
        A page needs a deployment behind it, and this is the one
        blocking state on the screen. Everything else stays
        editable — a student can design the whole thing and then
        deploy — but Publish cannot work without it, so it says
        so here rather than failing on the button.
      */}
      {!loading && draft.state && !draft.state.deployed ? (
        <Callout tone="caution" title="Deploy this agent first">
          <p>
            A public page is a door onto a deployed agent. Deploy{" "}
            {agent?.name} and the Publish button here will work — you can
            keep designing in the meantime.
          </p>
          <div className="siteedit__confirm">
            <Link
              className="btn btn--primary btn--sm"
              to={`/agents/${agentId}/deploy`}
            >
              <span className="btn__icon" aria-hidden="true">
                <Rocket size={14} strokeWidth={2} />
              </span>
              Go to Deploy
            </Link>
          </div>
        </Callout>
      ) : null}

      <div className="siteedit__split">
        <div className="siteedit__controls">
          {/*
            ONE OF BUILDGENTIC'S OWN AGENTS.

            Its page is designed by BuildGentic, so the editor is
            not offered — no Design, no Content, no natural
            language assistant. The Address pane stays, because
            the address is the one thing on this page that is
            genuinely the learner's: they choose where it lives
            and whether it is up at all.

            The server refuses the write regardless — PATCH and
            the assist endpoint both go through
            requireEditableAgent — so this is the explanation
            rather than the enforcement. That distinction is
            why the preview on the right stays exactly as it
            is: they can look at their page, share it, and take
            it down. They just cannot restyle it.
          */}
          {official ? (
            <Callout tone="info" title="Designed by BuildGentic">
              This is one of BuildGentic&rsquo;s own agents, and its page comes
              designed to match it. You choose its address and whether it is
              published; the layout and copy are maintained by BuildGentic.
              Agents you build yourself are yours to design however you like.
            </Callout>
          ) : (
            <Tabs
              label="What to edit"
              items={[
                { value: "design", label: "Design" },
                { value: "content", label: "Content" },
                { value: "address", label: "Address" },
              ]}
              value={pane}
              onChange={setPane}
            />
          )}

          {loading || !draft.config ? (
            <div className="siteedit__stack">
              <Skeleton height="120px" />
              <Skeleton height="90px" />
              <Skeleton height="200px" />
            </div>
          ) : (
            <>
              {/*
                Phase 2, and it sits ABOVE the tabs' content
                rather than inside one of them on purpose: a
                request like "make it darker and add an about
                section" crosses the Design/Content boundary,
                so putting it in either tab would make half of
                what it does invisible from where it lives.
              */}
              {official ? null : (
                <AssistPanel
                  agentId={agentId}
                  config={draft.config}
                  onApply={(next) => draft.replace(next)}
                  onUndo={(previous) => draft.replace(previous)}
                />
              )}

              {pane === "design" && !official ? (
                <DesignControls
                  config={draft.config}
                  onTemplate={draft.useTemplate}
                  onTheme={(theme) =>
                    draft.patch((current) => ({
                      theme: { ...current.theme, ...theme },
                    }))
                  }
                />
              ) : null}

              {pane === "content" && !official ? (
                <ContentControls
                  config={draft.config}
                  onPatch={(change) => draft.patch(change)}
                />
              ) : null}

              {(pane === "address" || official) && draft.state ? (
                <AddressControls
                  siteBase={draft.state.siteBase}
                  slug={draft.slug}
                  onSlug={draft.setSlug}
                  onSuggest={draft.suggestFromName}
                  check={draft.slugCheck}
                  problem={draft.slugProblem}
                  site={draft.state.site}
                  usage={draft.state.usage}
                  limits={draft.state.limits}
                  onPublishedChange={(published) =>
                    void draft.setPublished(published)
                  }
                  onTakeDown={() => void draft.takeDown()}
                />
              ) : null}
            </>
          )}
        </div>

        <div className="siteedit__previewcol">
          <Panel
            flush
            title={
              <span className="siteedit__previewtitle">
                <Globe size={15} strokeWidth={2} aria-hidden="true" />
                Preview
              </span>
            }
            actions={
              <div className="siteedit__previewactions">
                <SegmentedControl
                  label="Preview width"
                  options={[
                    {
                      value: "desktop",
                      label: "Wide",
                      icon: <Monitor size={14} strokeWidth={2} />,
                    },
                    {
                      value: "mobile",
                      label: "Phone",
                      icon: <Smartphone size={14} strokeWidth={2} />,
                    },
                  ]}
                  value={width}
                  onChange={setWidth}
                />

                {draft.state?.site ? (
                  <a
                    className="siteedit__open"
                    href={draft.state.site.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            }
          >
            <div
              className={`siteedit__viewport siteedit__viewport--${width}`}
              /*
               * The preview is a document inside a document, and
               * a screen reader walking this page would otherwise
               * read the whole of it — every heading, every
               * button — as part of the editor. It is announced
               * as one region and its interior is left out of the
               * tab order below.
               */
              role="region"
              aria-label="Preview of your published page"
            >
              {previewSite ? (
                <div className="siteedit__frame" inert>
                  <SiteRenderer site={previewSite} preview />
                </div>
              ) : (
                <Skeleton height="420px" />
              )}
            </div>
          </Panel>

          <p className="siteedit__previewnote">
            The chat is switched off in the preview so it does not spend your
            allowance while you work. It answers for real on the published
            page.
          </p>
        </div>
      </div>

      {/*
        The save bar, and it only appears when there is something
        to save — the same rule the Builder's SaveBar follows.
      */}
      {!loading && draft.dirty ? (
        <div className="siteedit__savebar">
          <div className="siteedit__savemsg">
            {draft.configError ? (
              <span className="siteedit__saveerror">
                {draft.configError.message}
              </span>
            ) : draft.saveError ? (
              <span className="siteedit__saveerror">{draft.saveError}</span>
            ) : (
              <span>
                {draft.state?.site
                  ? "Unsaved changes. Saving updates the live page immediately."
                  : "Ready to publish."}
              </span>
            )}
          </div>

          <Button
            variant="primary"
            icon={
              draft.state?.site ? undefined : <Rocket size={15} strokeWidth={2} />
            }
            disabled={
              !draft.canSave || (!draft.state?.site && !draft.state?.deployed)
            }
            onClick={() => void draft.save()}
          >
            {draft.phase === "saving"
              ? "Saving…"
              : draft.state?.site
                ? "Save changes"
                : "Publish page"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
