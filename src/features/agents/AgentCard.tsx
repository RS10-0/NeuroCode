import { Link } from "react-router-dom";
import { Copy, Rocket, Server, Sparkles, Trash2 } from "lucide-react";

import { Badge, IconButton } from "../../components/ui";
import type { AiRuntimeInfo } from "../../lib/aiClient";
import { findCapability } from "./capabilities";
import AgentFace from "./AgentFace";
import type { Agent } from "./types";

/*
 * One agent on the shelf.
 *
 * Two kinds appear here and the card has to tell them apart at
 * a glance: agents the learner built, and BuildGentic's own,
 * unlocked from the Library. The Official badge does that, and
 * it is first in the facts row rather than last so it reads
 * before the model name.
 *
 * The facts chosen for the card are the ones that answer "what
 * would this thing do if I opened it": which model, whose
 * account pays, what it can do, and how much it has been told.
 * A preview of the instructions was the obvious alternative and
 * is worse — the first eighty characters of a system prompt are
 * almost always throat-clearing.
 */

interface AgentCardProps {
  agent: Agent;
  /* Used only to turn a model id into its display name. Null
     while the catalogue is still loading, in which case the id
     is shown — which is honest, and better than a blank. */
  info: AiRuntimeInfo | null;
  knowledgeCount: number | null;
  busy: boolean;
  onDuplicate: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}

function modelName(agent: Agent, info: AiRuntimeInfo | null): string {
  if (!info) {
    return agent.model;
  }

  const found = info.models.find((entry) => entry.id === agent.model);

  return found?.displayName ?? agent.model;
}

/*
 * Relative where it helps and absolute where it does not.
 *
 * "3 days ago" is what somebody wants for something they
 * touched this week; past that it stops meaning anything and a
 * date is more use.
 */
function when(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) {
    return "";
  }

  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  if (seconds < 604_800) {
    const days = Math.round(seconds / 86_400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return new Date(then).toLocaleDateString();
}

export default function AgentCard({
  agent,
  info,
  knowledgeCount,
  busy,
  onDuplicate,
  onDelete,
}: AgentCardProps) {
  const extras = agent.capabilities.filter((id) => id !== "chat");

  return (
    <li className="agentcard">
      <div className="agentcard__head">
        <AgentFace emoji={agent.avatarEmoji} tone={agent.avatarTone} size="md" />

        <div className="agentcard__text">
          <h3 className="agentcard__name">
            {/*
              The whole card is not a link. A card-sized click
              target swallows the buttons in its own footer, and
              a name that is a real anchor middle-clicks and
              opens in a new tab the way a learner expects.
            */}
            <Link to={`/agents/${agent.id}`}>{agent.name}</Link>
          </h3>

          <p
            className={
              agent.description
                ? "agentcard__desc"
                : "agentcard__desc agentcard__desc--empty"
            }
          >
            {agent.description || "No description."}
          </p>
        </div>
      </div>

      <div className="agentcard__facts">
        {agent.isOfficial ? (
          <Badge tone="accent" icon={<Sparkles size={11} />}>
            Official
          </Badge>
        ) : null}

        <Badge tone="neutral" mono>
          {modelName(agent, info)}
        </Badge>

        <Badge tone="accent" icon={<Server size={11} />}>
          BuildGentic AI
        </Badge>

        {knowledgeCount !== null && knowledgeCount > 0 ? (
          <Badge tone="neutral">
            {knowledgeCount} knowledge{" "}
            {knowledgeCount === 1 ? "entry" : "entries"}
          </Badge>
        ) : null}

        {extras.map((id) => {
          const capability = findCapability(id);

          return capability ? (
            <Badge key={id} tone="correct">
              {capability.label}
            </Badge>
          ) : null;
        })}
      </div>

      <div className="agentcard__foot">
        <span className="agentcard__when">Edited {when(agent.updatedAt)}</span>

        <div className="agentcard__actions">
          {/*
            A link rather than a button, so deploying opens in a
            new tab on a middle click the way the agent's name
            does. It leads to a screen, not to an action -- an
            agent is never deployed by one click from a list.
          */}
          <Link
            className="icon-btn icon-btn--sm"
            to={`/agents/${agent.id}/deploy`}
            aria-label={`Deploy ${agent.name}`}
            title={`Deploy ${agent.name}`}
          >
            <Rocket size={15} aria-hidden="true" />
          </Link>

          {/*
            No duplicate for one of BuildGentic's own agents.

            A copy would be an ORDINARY agent — the database
            refuses `is_official` from the browser — carrying no
            instructions at all, because a flagship's prompt
            lives server-side and its row is empty. So the
            button would hand a learner a broken agent that
            looks like the one they paid for. There is also
            nothing it would be for: they already own this one,
            for good, and can re-add it from the Library free.
          */}
          {agent.isOfficial ? null : (
            <IconButton
              label={`Duplicate ${agent.name}`}
              icon={<Copy size={15} />}
              size="sm"
              disabled={busy}
              onClick={() => onDuplicate(agent)}
            />
          )}

          <IconButton
            label={`Delete ${agent.name}`}
            icon={<Trash2 size={15} />}
            size="sm"
            disabled={busy}
            onClick={() => onDelete(agent)}
          />
        </div>
      </div>
    </li>
  );
}
