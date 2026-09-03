import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, Check, Lock, Sparkles, Zap } from "lucide-react";

import { Badge, Button, Callout, Dialog, Skeleton, useToast } from "../components/ui";
import AgentFace from "../features/agents/AgentFace";
import { findCapability } from "../features/agents/capabilities";
import type { AvatarTone } from "../features/agents/vocab";
import { useCredits } from "../features/credits/useCredits";
import {
  fetchLibrary,
  unlockFlagship,
  type LibraryAgent,
} from "../lib/library";
import { capStateOf } from "../lib/credits";

/*
 * The Agent Library — the shop.
 *
 * The third door in the Agents group, and the one that answers
 * a question the other two cannot: "what does a really good
 * agent look like?" A learner can spend an afternoon in the
 * Builder and produce something that works; these are what
 * BuildGentic can do with a page of behaviour rules, and the
 * point of being able to buy one is to have a good agent before
 * you know how to write one.
 *
 * WHAT MAKES THESE DIFFERENT, and what the page has to make
 * obvious without a paragraph of explanation:
 *
 *   They are BuildGentic's, not yours. The instructions are not
 *   shown, not editable, and not downloadable — they are the
 *   thing being sold, and they never leave the server.
 *
 *   Their page is designed for them. A learner can publish and
 *   share it; they cannot restyle it, which is the one
 *   deliberate difference from an agent they built.
 *
 *   Everything else is ordinary. Once bought, a flagship sits
 *   on the shelf beside the learner's own agents, remembers
 *   them, reads their uploads and spends their XP like any
 *   other.
 *
 * The card treatment carries the first of those: an accent rail
 * and an "Official" badge, so a flagship is never mistaken for
 * something a classmate built.
 */

export default function AgentLibrary() {
  const { notify } = useToast();
  const navigate = useNavigate();
  const { credits, refresh } = useCredits();

  const [agents, setAgents] = useState<LibraryAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Which agent the confirm dialog is about, and which purchase
     is in flight. Separate, because the dialog closes on
     confirm and the button keeps spinning. */
  const [pending, setPending] = useState<LibraryAgent | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /*
   * The balance comes from the Library endpoint as well as from
   * the wallet context, and the endpoint's answer wins while it
   * is fresher. Both are advisory: the server refuses a
   * purchase it cannot afford regardless of what this shows.
   */
  const balance = credits?.available ? credits.balance : null;

  /* A full wallet is the strongest possible reason to be on
     this page, so the balance line says so here rather than
     repeating the generic "earn more" advice. */
  const cap = capStateOf(credits);

  const load = useCallback(async () => {
    const state = await fetchLibrary();
    return state.agents;
  }, []);

  useEffect(() => {
    let active = true;

    load()
      .then((rows) => {
        if (active) {
          setAgents(rows);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The Agent Library could not be loaded."
          );
          setAgents([]);
        }
      });

    return () => {
      active = false;
    };
  }, [load]);

  async function handleUnlock(agent: LibraryAgent) {
    setPending(null);
    setBusyId(agent.id);

    try {
      const result = await unlockFlagship(agent.id);

      /* Both numbers moved: the wallet, and what the Library
         thinks is owned. Refresh both rather than patching
         either by hand. */
      await Promise.all([refresh(), load().then(setAgents)]);

      notify(
        result.alreadyOwned
          ? `${agent.name} is already yours — opening it.`
          : `${agent.name} unlocked for ${result.charged} XP.`,
        "correct"
      );

      navigate(`/agents/${result.agentId}`);
    } catch (unlockError) {
      notify(
        unlockError instanceof Error
          ? unlockError.message
          : "That agent could not be unlocked.",
        "error"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Agents</p>
        <h1 className="page__title">Agent Library</h1>
        <p className="page__lede">
          Agents built by BuildGentic, unlocked with XP. Each one is a finished
          agent — written, tested and given its own page — so you can work with
          a good one before you have built one. Once unlocked it lives on your
          shelf in{" "}
          <Link to="/agents">My Agents</Link> alongside the ones you make
          yourself.
        </p>
      </header>

      {balance !== null ? (
        <p className="library__balance">
          <Zap size={14} aria-hidden="true" />
          {cap === "full" ? (
            <span>
              You have <strong>{balance} XP</strong> and you are maxed out —
              anything you earn now is discarded until you spend some. Good
              time to unlock one of these.
            </span>
          ) : (
            <span>
              You have <strong>{balance} XP</strong> to spend. Finish a lesson
              or come back tomorrow to earn more.
            </span>
          )}
        </p>
      ) : null}

      {agents === null ? (
        <ul className="agentgrid">
          {[0, 1, 2].map((key) => (
            <li key={key} className="agentcard">
              <Skeleton width="60%" height="20px" />
              <Skeleton width="100%" height="32px" />
              <Skeleton width="40%" height="16px" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <Callout tone="error" title="The Agent Library could not be loaded">
          {error}
        </Callout>
      ) : (
        <ul className="agentgrid">
          {agents.map((agent) => (
            <LibraryCard
              key={agent.id}
              agent={agent}
              balance={balance}
              busy={busyId === agent.id}
              onPurchase={setPending}
              onAdd={(entry) => void handleUnlock(entry)}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        title={`Unlock ${pending?.name ?? "this agent"}?`}
        text={
          pending
            ? `This costs ${pending.xpCost} XP and is yours for good — you will not be charged for it again. It appears in My Agents with its own page, ready to use.`
            : ""
        }
        confirmLabel={`Unlock for ${pending?.xpCost ?? 0} XP`}
        busy={busyId !== null}
        onConfirm={() => {
          if (pending) {
            void handleUnlock(pending);
          }
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

/* =========================================================
   ONE AGENT IN THE SHOP
========================================================= */

interface LibraryCardProps {
  agent: LibraryAgent;
  /* Null while the wallet is still loading, or when there is no
     wallet at all. Either way the card must not claim the agent
     is unaffordable — the server decides that. */
  balance: number | null;
  busy: boolean;
  /*
   * TWO ACTIONS, NOT ONE, and the split is the whole point.
   *
   * `onPurchase` spends XP and therefore asks first.
   * `onAdd` rebuilds an agent against an entitlement the
   * learner already holds. It costs nothing and takes nothing
   * away, so confirming it would be asking permission to do a
   * free, reversible thing.
   *
   * These were the same handler once, which meant "Add again —
   * free" opened a dialog reading "This costs 90 XP". The
   * button and the dialog contradicted each other, and the
   * dialog was the one that was wrong.
   */
  onPurchase: (agent: LibraryAgent) => void;
  onAdd: (agent: LibraryAgent) => void;
}

function LibraryCard({
  agent,
  balance,
  busy,
  onPurchase,
  onAdd,
}: LibraryCardProps) {
  const extras = agent.capabilities.filter((id) => id !== "chat");

  /*
   * Optimistic while the balance is unknown, the same rule
   * `canAfford` follows in CreditsProvider: a button disabled
   * over a number that has not arrived is worse than a button
   * that presses and gets an honest refusal.
   */
  const affordable = balance === null || balance >= agent.xpCost;
  const short = balance !== null ? agent.xpCost - balance : 0;

  return (
    <li className="agentcard agentcard--official">
      <div className="agentcard__head">
        <AgentFace
          emoji={agent.avatarEmoji}
          tone={agent.avatarTone as AvatarTone}
          size="md"
        />

        <div className="agentcard__text">
          <h3 className="agentcard__name">
            {agent.owned && agent.agentId ? (
              <Link to={`/agents/${agent.agentId}`}>{agent.name}</Link>
            ) : (
              agent.name
            )}
          </h3>

          <p className="agentcard__desc">{agent.tagline}</p>
        </div>

        <Badge tone="accent" icon={<Sparkles size={11} />}>
          Official
        </Badge>
      </div>

      <p className="library__blurb">{agent.description}</p>

      <div className="agentcard__facts">
        {extras.map((id) => {
          const capability = findCapability(id);

          return capability ? (
            <Badge key={id} tone="correct">
              {capability.label}
            </Badge>
          ) : null;
        })}

        {agent.hasSeededKnowledge ? (
          <Badge tone="neutral" icon={<Boxes size={11} />}>
            Comes with reference material
          </Badge>
        ) : null}
      </div>

      <div className="agentcard__foot">
        <span className="library__price">
          <Zap size={13} aria-hidden="true" />
          {agent.xpCost} XP
        </span>

        <div className="agentcard__actions">
          {agent.owned && agent.agentId ? (
            /*
             * A real anchor rather than a button, so it
             * middle-clicks into a new tab the way the agent's
             * name above it does. Nothing is bought here — this
             * one is already theirs.
             */
            <Link className="btn btn--secondary btn--sm" to={`/agents/${agent.agentId}`}>
              <Check size={15} aria-hidden="true" />
              Owned — open it
            </Link>
          ) : agent.owned ? (
            /* Owns the entitlement, deleted the agent. Re-adding
               is free, so this does not open the confirm. */
            <Button
              variant="secondary"
              size="sm"
              icon={<Check size={15} />}
              disabled={busy}
              onClick={() => onAdd(agent)}
            >
              {busy ? "Adding…" : "Add again — free"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={affordable ? <Zap size={15} /> : <Lock size={15} />}
              disabled={busy || !affordable}
              title={
                affordable
                  ? undefined
                  : `${short} XP short. Finish a lesson to earn more.`
              }
              onClick={() => onPurchase(agent)}
            >
              {busy
                ? "Unlocking…"
                : affordable
                  ? `Unlock for ${agent.xpCost} XP`
                  : `${short} XP short`}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
