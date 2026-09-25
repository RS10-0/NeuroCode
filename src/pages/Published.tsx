import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Hammer,
  Rocket,
  Terminal,
} from "lucide-react";

import { Badge, Callout, EmptyState, IconButton, Skeleton } from "../components/ui";

import AgentFace from "../features/agents/AgentFace";
import { listAgents } from "../features/agents/agentStore";
import type { Agent } from "../features/agents/types";
import {
  fetchPublished,
  type PublishedItem,
} from "../features/agents/publishedApi";
import { findTemplate } from "../features/sites/templates";

/*
 * Published — what other people can reach.
 *
 * Every other screen in the app is addressed to one agent, and
 * between them they made one question unanswerable: which of my
 * things are live, and at what address. Finding out meant
 * opening each agent and clicking into two sub-screens, and the
 * shelf gave no hint which agents were worth opening.
 *
 * So this page is an inventory, not a workshop. It owns no
 * writes at all — every action on it is a link to the screen
 * that already owns that decision, with the confirmation dialog
 * and the consequence copy attached. Unpublishing from here
 * would be a second path to a destructive write, and a second
 * path is always the one that skips the warning.
 *
 * Two sources, joined by agent id:
 *
 *   fetchPublished() addresses and key state, which need the
 *                    server's configured origins to build
 *   listAgents()     the shelf, for a name and a face
 *
 * An agent appears here once it has a DEPLOYMENT, which is the
 * first step out of the building — not once it has a page. An
 * agent deployed as an API and never given a page is genuinely
 * published, and leaving it off this list would mean the
 * inventory disagreed with the deploy screen.
 */

/* =========================================================
   COPY

   Same shape as the Deploy screen's copy control, and the same
   two-part failure handling: the clipboard is absent in an
   insecure context — a dev server reached over a LAN address —
   and a browser may simply refuse. The address is on screen and
   selectable either way, so there is nothing to recover from
   beyond not claiming it worked.
========================================================= */

function CopyAddress({ value, what }: { value: string; what: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      label={copied ? `${what} copied` : `Copy ${what}`}
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      size="sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    />
  );
}

/* The protocol is noise in a list of addresses — every one of
   them has it, and dropping it buys the slug room to be read.
   The copied value keeps it, because a link without it is not
   a link. */
function readable(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/* =========================================================
   ONE AGENT'S ROWS
========================================================= */

export interface PublishedCardProps {
  item: PublishedItem;
  /* Null when the shelf query failed or the row is newer than
     the shelf we loaded. The card still renders — an address
     without a name is worth more than no row at all. */
  agent: Agent | null;
}

/* Exported for the developer gallery at /dev/published, which
   is the only way to see these rows without an account, a
   deployment and a published page behind them. */
export function PublishedCard({ item, agent }: PublishedCardProps) {
  const { site, deployment, key } = item;

  return (
    <li className="pubcard">
      <div className="pubcard__head">
        {agent ? (
          <AgentFace emoji={agent.avatarEmoji} tone={agent.avatarTone} size="sm" />
        ) : null}

        <h2 className="pubcard__name">
          {/*
            The name is the one thing on this card that comes
            from the shelf rather than from the inventory, so it
            is the one thing that can be missing while
            everything else is fine. Says that plainly — the
            link still resolves, and the address below is the
            fact the learner came for.
          */}
          <Link to={`/agents/${item.agentId}`}>
            {agent?.name ?? "An agent of yours"}
          </Link>
        </h2>

        {/*
          The one badge that belongs in the header rather than
          on a row: it is the answer to the question the page
          is for. A page that is up outranks everything below.
        */}
        {site?.published ? (
          <Badge tone="correct" icon={<Globe size={11} />}>
            Page live
          </Badge>
        ) : site ? (
          <Badge tone="caution">Page taken down</Badge>
        ) : (
          <Badge tone="neutral">API only</Badge>
        )}
      </div>

      <div className="pubrows">
        {/* --- THE PAGE --- */}

        {site ? (
          <div className="pubrow">
            <span className="pubrow__icon" aria-hidden="true">
              <Globe size={15} />
            </span>

            <span className="pubrow__body">
              <span className="pubrow__label">
                {/*
                  Not a link when the page is down. A published
                  address that 404s is a worse thing to hand
                  somebody than a plain string, and the learner
                  is the one person who already knows what it
                  said.
                */}
                {site.published ? (
                  <a href={site.url} target="_blank" rel="noreferrer">
                    {readable(site.url)}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : (
                  <span className="pubrow__dead">{readable(site.url)}</span>
                )}
              </span>

              <span className="pubrow__sub">
                {findTemplate(site.template).name}
                {site.siteName ? ` · ${site.siteName}` : ""}
                {site.published ? "" : " · nobody can open this"}
              </span>
            </span>

            <span className="pubrow__actions">
              <CopyAddress value={site.url} what="page address" />
              <Link
                className="btn btn--ghost btn--sm"
                to={`/agents/${item.agentId}/site`}
              >
                Edit page
              </Link>
            </span>
          </div>
        ) : (
          <div className="pubrow pubrow--absent">
            <span className="pubrow__icon" aria-hidden="true">
              <Globe size={15} />
            </span>

            <span className="pubrow__body">
              <span className="pubrow__label">No page</span>
              <span className="pubrow__sub">
                This agent answers the API but has no address a person can
                open.
              </span>
            </span>

            <span className="pubrow__actions">
              <Link
                className="btn btn--secondary btn--sm"
                to={`/agents/${item.agentId}/site`}
              >
                Give it a page
              </Link>
            </span>
          </div>
        )}

        {/* --- THE ENDPOINT --- */}

        <div className={key ? "pubrow" : "pubrow pubrow--absent"}>
          <span className="pubrow__icon" aria-hidden="true">
            <Terminal size={15} />
          </span>

          <span className="pubrow__body">
            <span className="pubrow__label pubrow__label--mono">
              {readable(deployment.endpoint)}
            </span>

            <span className="pubrow__sub">
              {key ? (
                <>Key ····{key.last4}</>
              ) : (
                /*
                 * The paused state, said as what it does rather
                 * than as what is missing. There is no third
                 * column for this — a revoked key IS the pause,
                 * see migration 0006.
                 */
                <>No active key · every call is refused</>
              )}
            </span>
          </span>

          <span className="pubrow__actions">
            <CopyAddress value={deployment.endpoint} what="endpoint" />
            <Link
              className="btn btn--ghost btn--sm"
              to={`/agents/${item.agentId}/deploy`}
            >
              Manage
            </Link>
          </span>
        </div>

        {/*
          SCHEDULES ARE NOT HERE, AND THAT IS THE FIX.

          They were, briefly, and it was wrong in a way worth
          recording. A row on this card can only exist for an
          agent that has a DEPLOYMENT, because that is what this
          screen lists — but a schedule needs no deployment at
          all; the server asks only for an agent. So the
          schedules shown here were the intersection of two
          unrelated things, and a learner running a nightly
          digest on an undeployed agent saw none of theirs.

          They live on /schedules now, which lists them by
          schedule rather than by address, and carries the run
          history that is the actual reason to look.
        */}
      </div>
    </li>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function Published() {
  const [items, setItems] = useState<PublishedItem[] | null>(null);
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    /*
     * The inventory decides whether this page has anything to
     * say, so its failure is the page's failure. The other two
     * only decorate it — a name and a face, a list of runs —
     * and a page that lost them is still worth showing, so they
     * are settled rather than awaited together.
     */
    const published = await fetchPublished();

    const byId = new Map<string, Agent>();

    try {
      for (const agent of await listAgents()) {
        byId.set(agent.id, agent);
      }
    } catch {
      /* A card shows an address without a name. Better than no
         card, and the link on it still resolves. */
    }

    return { items: published.items, byId };
  }, []);

  useEffect(() => {
    let live = true;

    load()
      .then((result) => {
        if (!live) {
          return;
        }

        setItems(result.items);
        setAgents(result.byId);
      })
      .catch((loadError: unknown) => {
        if (!live) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Something went wrong."
        );
        setItems([]);
      });

    return () => {
      live = false;
    };
  }, [load]);

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Share</p>
        <h1 className="page__title">Published</h1>
        <p className="page__lede">
          Everything you have put in front of other people — the pages
          strangers can open, the endpoints an app can call, and what your
          agents do while you are not watching. Publishing happens on an
          agent&rsquo;s own screens; this is where you can see all of it at
          once.
        </p>
      </header>

      {items === null ? (
        <ul className="pubgrid">
          {[0, 1].map((key) => (
            <li key={key} className="pubcard">
              <Skeleton width="40%" height="22px" />
              <Skeleton width="100%" height="56px" />
              <Skeleton width="100%" height="56px" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <Callout tone="error" title="Your published work could not be loaded">
          {error}
        </Callout>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Rocket size={26} />}
          title="Nothing is live yet"
          text="Deploy an agent and it appears here, with its address and its key. Give it a page as well and you get a link you can send to somebody who has never heard of BuildGentic."
          action={
            <Link className="btn btn--secondary" to="/agents">
              <Hammer size={15} aria-hidden="true" />
              Go to My Agents
            </Link>
          }
        />
      ) : (
        <ul className="pubgrid">
          {items.map((item) => (
            <PublishedCard
              key={item.deployment.id}
              item={item}
              agent={agents.get(item.agentId) ?? null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
