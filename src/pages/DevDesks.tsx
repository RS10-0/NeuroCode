import { useState } from "react";

import { FLAGSHIPS, type FlagshipId } from "../features/agents/flagships";
import FlagshipDesk from "../features/agents/desk/FlagshipDesk";
import type { AgentMemoryState } from "../features/agents/useAgentMemory";
import type { KnowledgeEntry } from "../features/agents/types";

/*
 * Developer gallery — the owner's desk, for all six.
 *
 * Same reasoning as /dev/flagships and /dev/sites, and the same
 * gate: DEV only, outside the auth gate, tree shaken out of a
 * production build. The difference is that this one is worth
 * more than the others, because the screen it shows is the one
 * that is hardest to reach in the real product. Seeing it
 * otherwise costs an account, a hundred XP, a purchase and a
 * round trip — which is exactly the friction that let four
 * empty tabs sit there unnoticed.
 *
 * It renders the REAL FlagshipDesk against the REAL catalogue,
 * so the copy, the capability list and each agent's palette are
 * what a buyer gets. What it fakes is only the data that would
 * come from a database: the knowledge list, the index status
 * and the memory hook.
 *
 * ALL SIX ARE LISTED, unlike /dev/flagships, which builds its
 * picker from what is publishable. That gallery is showing a
 * public page and Email Agent must never have one; this is
 * showing the screen its owner gets, and Email Agent has an
 * owner like the rest.
 */

/* Nothing loaded, nothing failed, nothing remembered — the
   state a freshly bought agent is actually in. */
const EMPTY_MEMORY: AgentMemoryState = {
  status: null,
  loading: false,
  error: null,
  refresh: () => undefined,
  forget: async () => undefined,
  clear: async () => undefined,
  busy: false,
};

/* Two entries, so the populated case shows the list, the budget
   meter and the per-entry badges rather than just the empty
   state. */
const SOME_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "dev-1",
    kind: "text",
    title: "Course specification",
    content:
      "Paper 1 covers cell biology, transport across membranes and enzyme action. Paper 2 covers inheritance, variation and ecosystems. Both papers are 1h45m and carry equal weight.",
    sourceName: null,
    charCount: 192,
    position: 0,
    status: "indexed",
  },
  {
    id: "dev-2",
    kind: "file",
    title: "week-6-notes.md",
    content:
      "Osmosis is the movement of water across a partially permeable membrane, from a dilute solution to a concentrated one. Worth remembering that water potential is always negative in a solution.",
    sourceName: "week-6-notes.md",
    charCount: 188,
    position: 1,
    status: "inline",
  },
];

export default function DevDesks() {
  const [id, setId] = useState<FlagshipId>("study-tutor");
  const [populated, setPopulated] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const flagship = FLAGSHIPS.find((entry) => entry.id === id) ?? FLAGSHIPS[0];
  const knowledge = populated ? SOME_KNOWLEDGE : [];

  return (
    <div className="page page--flush">
      <div style={{ padding: "var(--space-5)", display: "grid", gap: "var(--space-4)" }}>
        <h1 className="page__title">Flagship desks</h1>

        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          {FLAGSHIPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={
                entry.id === id ? "btn btn--primary" : "btn btn--secondary"
              }
              onClick={() => setId(entry.id)}
            >
              {entry.avatarEmoji} {entry.name}
            </button>
          ))}
        </div>

        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPopulated((value) => !value)}
          >
            {populated ? "Show it empty" : "Show it with material"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setUnavailable((value) => !value)}
          >
            {unavailable ? "Search working" : "Search unavailable"}
          </button>
        </div>
      </div>

      <div className="agentshell">
        <div className="agentwork">
          <FlagshipDesk
            /* Remounted per agent so no section keeps the
               previous one's local state. */
            key={`${id}-${String(populated)}-${String(unavailable)}`}
            draft={{
              name: flagship.name,
              description: flagship.description,
              avatarEmoji: flagship.avatarEmoji,
              avatarTone: flagship.avatarTone,
              /* Empty on a real flagship row too — the prompt is
                 resolved server side on every read. */
              instructions: "",
              model: "neurolink-1",
              temperature: flagship.temperature,
              maxOutputTokens: 1024,
              capabilities: flagship.capabilities,
              status: "ready",
            }}
            /* Null, so the sections that hang off a saved agent
               explain themselves rather than calling an API this
               gallery has no session for. */
            agentId={null}
            flagshipId={flagship.id}
            knowledge={knowledge}
            systemBudget={8000}
            onKnowledgeChange={() => undefined}
            index={
              unavailable
                ? {
                    embeddingModel: null,
                    unavailableReason:
                      "BuildGentic's server has no embedding model configured, so knowledge cannot be indexed. This is a server problem, not something you did.",
                    retrievalEnabled: true,
                    entries: [],
                    pending: 0,
                    totalChunks: 0,
                  }
                : null
            }
            indexing={false}
            indexError={null}
            dirty={false}
            onReindex={() => undefined}
            memory={EMPTY_MEMORY}
          />
        </div>
      </div>
    </div>
  );
}
