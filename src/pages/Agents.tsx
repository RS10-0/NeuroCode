import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Hammer } from "lucide-react";

import {
  Callout,
  Dialog,
  EmptyState,
  Skeleton,
  useToast,
} from "../components/ui";
import type { AiRuntimeInfo } from "../lib/aiClient";
import { fetchAiRuntimeInfo } from "../lib/aiClient";

import AgentCard from "../features/agents/AgentCard";
import {
  deleteAgent,
  duplicateAgent,
  listAgents,
} from "../features/agents/agentStore";
import { supabase } from "../lib/supabase";
import type { Agent } from "../features/agents/types";

/*
 * My Agents — the shelf.
 *
 * The other half of the Agents group: this is where finished
 * agents are viewed, revised and eventually deployed, while the
 * Builder is where they are made.
 *
 * The empty state still points at the Builder rather than only
 * saying there is nothing here, because "no agents yet" is only
 * useful next to the door you would go through to change that.
 */

export default function Agents() {
  const { notify } = useToast();

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * The model catalogue, purely so a card can print a model's
   * display name instead of its id. Decorative by comparison
   * with the list itself, so a failure to load it costs a nicer
   * label and nothing else.
   */
  const [info, setInfo] = useState<AiRuntimeInfo | null>(null);

  /* How many knowledge entries each agent holds. Counted in one
     query rather than one per card. */
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);

  /*
   * A pure fetcher: it returns the shelf, it does not set any
   * state. That keeps the effect below free of a synchronous
   * setState — the cascading render the lint rule exists to
   * catch — and lets the duplicate and delete handlers reuse the
   * same query without a second code path.
   */
  const fetchShelf = useCallback(async () => {
    const rows = await listAgents();

    /*
     * One query for every entry's agent_id, tallied here. The
     * alternative — a count per card — is N round trips for a
     * number that decorates a badge, and PostgREST offers no
     * group-by to do it in the database.
     */
    const tally: Record<string, number> = {};

    if (rows.length > 0) {
      const { data } = await supabase
        .from("agent_knowledge")
        .select("agent_id")
        .in(
          "agent_id",
          rows.map((row) => row.id)
        );

      for (const row of (data ?? []) as Array<{ agent_id: string }>) {
        tally[row.agent_id] = (tally[row.agent_id] ?? 0) + 1;
      }
    }

    return { rows, tally };
  }, []);

  const reload = useCallback(async () => {
    const { rows, tally } = await fetchShelf();
    setAgents(rows);
    setCounts(tally);
    setError(null);
  }, [fetchShelf]);

  useEffect(() => {
    let active = true;

    fetchShelf()
      .then(({ rows, tally }) => {
        if (active) {
          setAgents(rows);
          setCounts(tally);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Your agents could not be loaded."
          );
          setAgents([]);
        }
      });

    return () => {
      active = false;
    };
  }, [fetchShelf]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const runtime = await fetchAiRuntimeInfo();

        if (active) {
          setInfo(runtime);
        }
      } catch {
        /* A card shows a model id instead of a display name.
           The shelf keeps working. */
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleDuplicate(agent: Agent) {
    setBusyId(agent.id);

    try {
      const copy = await duplicateAgent(agent.id);
      await reload();
      notify(`${copy.name} created.`, "correct");
    } catch (duplicateError) {
      notify(
        duplicateError instanceof Error
          ? duplicateError.message
          : "That agent could not be duplicated.",
        "error"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) {
      return;
    }

    setDeleting(true);

    try {
      await deleteAgent(pendingDelete.id);
      await reload();
      notify(`${pendingDelete.name} deleted.`, "info");
      setPendingDelete(null);
    } catch (deleteError) {
      notify(
        deleteError instanceof Error
          ? deleteError.message
          : "That agent could not be deleted.",
        "error"
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Agents</p>
        <h1 className="page__title">My Agents</h1>
        <p className="page__lede">
          Agents you have built live here. Each one is a saved configuration —
          instructions, a model, knowledge — running on the same AI runtime as
          the Lab. Build a new one in the{" "}
          <Link to="/agents/builder">Agent Builder</Link>.
        </p>
      </header>

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
        <Callout tone="error" title="Your agents could not be loaded">
          {error}
        </Callout>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<Bot size={26} />}
          title="No agents yet"
          text="An agent is a saved set of instructions, a model and a body of knowledge, with a live chat to test it against. Build one and it will appear here."
          action={
            <Link className="btn btn--secondary" to="/agents/builder">
              <Hammer size={15} aria-hidden="true" />
              Open the Agent Builder
            </Link>
          }
        />
      ) : (
        <ul className="agentgrid">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              info={info}
              knowledgeCount={counts ? (counts[agent.id] ?? 0) : null}
              busy={busyId === agent.id}
              onDuplicate={(entry) => void handleDuplicate(entry)}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this agent"}?`}
        text="Its instructions and everything it knows go with it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
