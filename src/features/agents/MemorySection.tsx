import { useState } from "react";
import { Brain, Loader2, RefreshCw, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  IconButton,
  Meter,
  type BadgeTone,
} from "../../components/ui";
import type { AgentMemory } from "./memory";
import type { AgentMemoryState } from "./useAgentMemory";
import type { AgentDraft } from "./types";

/*
 * Everything the agent has decided to remember, and the only
 * place it can be taken away.
 *
 * This section is not a nice-to-have on top of the capability;
 * it is half of what makes the capability defensible. Something
 * that quietly writes down what you say and replays it back for
 * months is a reasonable thing to be uneasy about, and the only
 * answer that actually helps is a screen where every sentence
 * it kept can be read in plain language and deleted in one
 * click.
 *
 * So the design rule here is: no summaries, no counts standing
 * in for content, no "37 memories" without the 37 sentences. If
 * the agent knows it, the learner reads it.
 *
 * The second thing this screen has to teach is the ownership
 * model, because it is the one people get wrong. Memory belongs
 * to THIS agent — telling a maths tutor about an exam does not
 * tell an essay coach — and the sentence saying so is worth the
 * space, because the alternative is somebody assuming the
 * opposite and being quietly surprised.
 */

interface MemorySectionProps {
  draft: AgentDraft;
  /* Null until the draft has been saved once. Memories hang off
     an agent, so this is the difference between a working
     section and an explanation of why it is not. */
  agentId: string | null;
  memory: AgentMemoryState;
  /* Switches the Builder to Capabilities. Passed in rather than
     rendered as a link because the sections are page state, not
     routes — a link here would either navigate nowhere or need
     a route that does not exist. */
  onOpenCapabilities: () => void;
}

/*
 * The learner's words for each kind, not the schema's.
 *
 * Loosely indexed so a kind written by a newer build renders as
 * a plain note rather than an empty badge.
 */
const LABELS: Record<string, string> = {
  profile: "About you",
  preference: "How you like to learn",
  goal: "Working towards",
  project: "Working on",
  fact: "Noted",
};

const TONES: Record<string, BadgeTone> = {
  profile: "accent",
  preference: "accent",
  goal: "correct",
  project: "correct",
  fact: "neutral",
};

/* "3 minutes ago" beats a timestamp here: the question a
   learner is asking is "did it just learn that?", not "what
   time was it". */
function when(iso: string | null): string {
  if (!iso) {
    return "never";
  }

  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function MemorySection({
  draft,
  agentId,
  memory,
  onOpenCapabilities,
}: MemorySectionProps) {
  const [confirming, setConfirming] = useState<null | "all" | "deployment">(
    null
  );

  const on = draft.capabilities.includes("memory");
  const status = memory.status;

  const all = status?.memories ?? [];
  const mine = all.filter((entry) => entry.scope === "owner");
  const theirs = all.filter((entry) => entry.scope === "deployment");

  /* Counted against the per-scope cap, which is what the server
     actually enforces — so the meter fills for the learner's own
     memories rather than for the sum of every scope, which would
     read as nearly full on an agent whose endpoint is busy. */
  const limit = status?.limits.maxMemories ?? 0;

  return (
    <section className="agentsec" aria-labelledby="agentsec-memory">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-memory">
          Memory
        </h2>

        <p className="agentsec__lede">
          What your agent has learned about the people it helps, kept between
          conversations.{" "}
          {on ? (
            <>
              It decides for itself what is worth keeping — goals, preferences,
              what somebody is working on — and it belongs to this agent alone.
              What you tell this one is not shared with your other agents.
            </>
          ) : (
            <>
              Memory is switched off, so nothing is being recorded and nothing
              below can grow. Turn it on in Capabilities.
            </>
          )}
        </p>
      </div>

      <div className="agentsec__body">
        {/* ---------------------------------------------------------
            THE THREE STATES BEFORE THERE IS ANYTHING TO SHOW

            Each is a different sentence because each has a
            different fix, and a single "nothing here yet" would
            leave two of the three looking broken.
            --------------------------------------------------------- */}

        {!agentId ? (
          <Callout tone="info" title="Save this agent first">
            Memories are stored against a saved agent, not a draft — that is
            what keeps one agent's memory separate from another's. Save, have a
            conversation in the Test panel, and what it learns will appear here.
          </Callout>
        ) : !on ? (
          <Callout tone="caution" title="Memory is off">
            Your agent starts every conversation knowing nothing about who it
            is talking to. Anything it remembered before is kept below and is
            not being used while this is off — delete it here if you would
            rather it were gone.
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button variant="secondary" size="sm" onClick={onOpenCapabilities}>
                Open Capabilities
              </Button>
            </div>
          </Callout>
        ) : null}

        {memory.error ? (
          <Callout tone="error" title="Could not read this agent's memory">
            {memory.error}
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={memory.refresh}
                icon={<RefreshCw size={14} />}
              >
                Try again
              </Button>
            </div>
          </Callout>
        ) : null}

        {agentId && !status && !memory.error ? (
          <p className="agentsec__note">
            <Loader2 size={14} className="spin" aria-hidden="true" /> Reading
            what this agent remembers…
          </p>
        ) : null}

        {agentId && status ? (
          <div className="memories">
            {/* -----------------------------------------------
                THE LEARNER'S OWN MEMORIES
                ----------------------------------------------- */}

            <div className="memories__head">
              <Meter
                label="Remembered about you"
                used={mine.length}
                limit={limit}
                unit="memories"
              />

              <div className="memories__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={memory.refresh}
                  disabled={memory.loading || memory.busy}
                  icon={<RefreshCw size={14} />}
                >
                  Refresh
                </Button>

                {all.length > 0 ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirming("all")}
                    disabled={memory.busy}
                    icon={<Trash2 size={14} />}
                  >
                    Forget everything
                  </Button>
                ) : null}
              </div>
            </div>

            {mine.length === 0 ? (
              <EmptyState
                icon={<Brain size={22} />}
                title="It has not learned anything about you yet"
                text={
                  on
                    ? "Tell it something worth keeping in the Test panel — what you are working towards, or how you like things explained — and it will appear here."
                    : "Memory is off, so it will not learn anything until you switch it on."
                }
              />
            ) : (
              <ul className="memories__list">
                {mine.map((entry) => (
                  <MemoryRow
                    key={entry.id}
                    entry={entry}
                    busy={memory.busy}
                    onForget={() => void memory.forget(entry.id)}
                  />
                ))}
              </ul>
            )}

            {/* -----------------------------------------------
                WHAT THE DEPLOYED ENDPOINT HAS LEARNED

                Shown only when it exists, because on an agent
                nobody has deployed it is an explanation of
                something that has not happened.

                Shown at all because it is the owner's storage,
                on their agent, at their expense — and because
                "delete what my agent has learned about other
                people" is an action somebody may be obliged to
                take rather than merely want to.

                Who those people are is not shown, and cannot
                be: the caller's key is stored as a salted
                digest, so the most this can say is that these
                were different people.
                ----------------------------------------------- */}

            {theirs.length > 0 ? (
              <div className="memories__deployed">
                <div className="memories__head">
                  <div>
                    <h3 className="memories__subtitle">
                      Learned from your deployed endpoint
                    </h3>
                    <p className="agentsec__note">
                      {theirs.length}{" "}
                      {theirs.length === 1 ? "memory" : "memories"} about{" "}
                      {new Set(theirs.map((entry) => entry.subject)).size}{" "}
                      {new Set(theirs.map((entry) => entry.subject)).size === 1
                        ? "caller"
                        : "callers"}
                      . Your agent keeps these separately from yours — a caller
                      cannot read what you told it here, and it does not use
                      these when answering you.
                    </p>
                  </div>

                  <div className="memories__actions">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirming("deployment")}
                      disabled={memory.busy}
                      icon={<Trash2 size={14} />}
                    >
                      Clear these
                    </Button>
                  </div>
                </div>

                <ul className="memories__list">
                  {theirs.map((entry) => (
                    <MemoryRow
                      key={entry.id}
                      entry={entry}
                      busy={memory.busy}
                      onForget={() => void memory.forget(entry.id)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="agentsec__note">
              Your agent writes these itself, from what people tell it. It can
              add to them and correct them; it can never delete one — that is
              only ever this screen, so nothing said in a conversation can make
              it forget something.
            </p>
          </div>
        ) : null}
      </div>

      <Dialog
        open={confirming !== null}
        title={
          confirming === "deployment"
            ? "Clear what callers taught it?"
            : "Forget everything?"
        }
        text={
          confirming === "deployment"
            ? `This deletes all ${theirs.length} memories your deployed endpoint has collected. Your own memories are kept. This cannot be undone.`
            : `This deletes all ${all.length} memories this agent holds, including anything its deployed endpoint has learned. Memory stays switched on and it will start learning again from your next conversation. This cannot be undone.`
        }
        confirmLabel={confirming === "deployment" ? "Clear them" : "Forget everything"}
        destructive
        busy={memory.busy}
        onConfirm={() => {
          void memory.clear(confirming === "deployment" ? "deployment" : "all");
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}

function MemoryRow({
  entry,
  busy,
  onForget,
}: {
  entry: AgentMemory;
  busy: boolean;
  onForget: () => void;
}) {
  return (
    <li className="memory">
      <div className="memory__main">
        <Badge tone={TONES[entry.kind] ?? "neutral"}>
          {LABELS[entry.kind] ?? "Noted"}
        </Badge>

        <p className="memory__text">{entry.content}</p>
      </div>

      <div className="memory__meta">
        <span>
          {entry.revision > 1
            ? `updated ${when(entry.updatedAt)}`
            : `learned ${when(entry.createdAt)}`}
        </span>

        {/*
          How often it has actually been carried into a prompt.
          The most useful number on the row: a memory used
          eleven times is earning its place, and one used never
          is the first thing the agent will forget when it runs
          out of room.
        */}
        <span>
          used {entry.useCount} {entry.useCount === 1 ? "time" : "times"}
        </span>

        {entry.subject ? <span>caller {entry.subject}</span> : null}

        <IconButton
          label="Forget this"
          icon={<Trash2 size={15} />}
          onClick={onForget}
          disabled={busy}
        />
      </div>
    </li>
  );
}
