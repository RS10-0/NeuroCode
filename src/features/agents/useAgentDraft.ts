import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AiRuntimeInfo } from "../../lib/aiClient";
import {
  createAgent,
  syncKnowledge,
  updateAgent,
} from "./agentStore";
import { reposition } from "./knowledge";
import {
  agentToDraft,
  fingerprint,
  newDraft,
  type Agent,
  type AgentDraft,
  type KnowledgeEntry,
  type KnowledgeStatus,
} from "./types";

/*
 * The configuration being edited, and whether it has been saved.
 *
 * One object patched through one callback rather than a dozen
 * useStates, which is the same shape the Lab's settings take and
 * for the same reason: every control here changes one field of
 * one thing, and spreading that across a dozen setters means a
 * dozen places to remember to also mark the draft dirty.
 */

export interface UseAgentDraftOptions {
  info: AiRuntimeInfo;
  /* The agent being edited, or null when building a new one. */
  agent: Agent | null;
}

export function useAgentDraft({ info, agent }: UseAgentDraftOptions) {
  const [draft, setDraft] = useState<AgentDraft>(() =>
    agent ? agentToDraft(agent) : newDraft(info)
  );

  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [agentId, setAgentId] = useState<string | null>(agent?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /*
   * What the database currently holds, as a fingerprint. Dirty
   * is a comparison against this rather than a boolean flag,
   * because a flag has to be cleared by every path that could
   * have set it and one of them is always forgotten — including
   * the path where a learner edits a field back to what it was.
   */
  const [savedPrint, setSavedPrint] = useState<string>(() =>
    fingerprint(agent ? agentToDraft(agent) : newDraft(info), [])
  );

  const currentPrint = useMemo(
    () => fingerprint(draft, knowledge),
    [draft, knowledge]
  );

  const dirty = currentPrint !== savedPrint;

  const patch = useCallback((next: Partial<AgentDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setSaveError(null);
  }, []);

  /* Always renumbered, so `position` stays 0..n-1 and the stored
     order matches the screen after any add, delete or move. */
  const replaceKnowledge = useCallback((entries: KnowledgeEntry[]) => {
    setKnowledge(reposition(entries));
    setSaveError(null);
  }, []);

  /*
   * Takes the server's word for which entries are searchable.
   *
   * `status` is the column both composers branch on, and after
   * Phase 2.5 only the server writes it — indexing is what
   * decides an entry has stopped being pasted into every prompt
   * and started arriving per question.
   *
   * Which means the browser's copy goes stale at exactly the
   * wrong moment. A save returns the rows as they were when the
   * upsert ran, the index run that follows flips them a second
   * later, and without this the Builder would go on believing
   * every entry is still inline: the budget meter would never
   * fall, and — much worse — the Test panel would paste the
   * whole library into the system prompt while the runtime was
   * separately retrieving it, sending every document twice.
   *
   * Not a save, and it does not make the draft dirty. See the
   * note on `fingerprint`.
   */
  const applyIndexState = useCallback(
    (states: Array<{ knowledgeId: string; inline: boolean }>) => {
      const byId = new Map(states.map((state) => [state.knowledgeId, state]));

      setKnowledge((current) => {
        let moved = false;

        const next = current.map((entry) => {
          const state = byId.get(entry.id);

          if (!state) {
            return entry;
          }

          const status: KnowledgeStatus = state.inline ? "inline" : "indexed";

          if (entry.status === status) {
            return entry;
          }

          moved = true;
          return { ...entry, status };
        });

        /* Same array when nothing changed, so a status poll that
           found no news does not re-render the section. */
        return moved ? next : current;
      });
    },
    []
  );

  /*
   * Adopts knowledge loaded for an existing agent as the saved
   * baseline. Called once the row has come back, so opening an
   * agent and touching nothing does not read as unsaved work.
   */
  const adoptSaved = useCallback(
    (nextAgent: Agent, entries: KnowledgeEntry[]) => {
      const nextDraft = agentToDraft(nextAgent);
      const positioned = reposition(entries);

      setDraft(nextDraft);
      setKnowledge(positioned);
      setAgentId(nextAgent.id);
      setSavedPrint(fingerprint(nextDraft, positioned));
    },
    []
  );

  /* ---------------------------------------------------------
     THE CATALOGUE

     One entry, and no source to switch between. What used to be
     here — a catalogue that changed under the draft whenever the
     power source moved, and the clamping that kept the chosen
     model from dangling — went with BYOK.
     --------------------------------------------------------- */

  const models = info.models;

  const model = useMemo(
    () => models.find((entry) => entry.id === draft.model),
    [models, draft.model]
  );

  const limits = info.limits;

  /* ---------------------------------------------------------
     SAVING
     --------------------------------------------------------- */

  /*
   * Writes the agent, then its knowledge.
   *
   * In that order because the knowledge rows carry a foreign key
   * to the agent, so a new agent has to exist before anything
   * can point at it. The two are not a transaction — PostgREST
   * has no way to make them one from the browser — so a failure
   * between them leaves a saved agent whose knowledge did not
   * land. That is recoverable by pressing Save again, and it is
   * the failure worth having: the alternative orderings lose the
   * agent instead.
   */
  const save = useCallback(async (): Promise<Agent | null> => {
    setSaving(true);
    setSaveError(null);

    try {
      const stored = agentId
        ? await updateAgent(agentId, draft)
        : await createAgent(draft);

      const storedKnowledge = await syncKnowledge(stored.id, knowledge);

      setAgentId(stored.id);
      setKnowledge(storedKnowledge);
      setSavedPrint(fingerprint(draft, storedKnowledge));

      return stored;
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "This agent could not be saved."
      );

      return null;
    } finally {
      setSaving(false);
    }
  }, [agentId, draft, knowledge]);

  /* ---------------------------------------------------------
     LEAVING WITH UNSAVED WORK

     Covers the tab closing and the browser navigating away.
     react-router's useBlocker would cover in-app navigation too,
     but it requires a data router and this app mounts a plain
     BrowserRouter — so the in-app case is handled where it can
     be, by the Builder confirming before it follows its own
     back link, and the rest is left honest rather than papered
     over.
     --------------------------------------------------------- */

  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }

      event.preventDefault();
      /* Browsers show their own wording and ignore any string
         given here; assigning one is still what marks the event
         as handled in older engines. */
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return {
    draft,
    knowledge,
    agentId,
    dirty,
    saving,
    saveError,
    models,
    model,
    limits,
    patch,
    replaceKnowledge,
    applyIndexState,
    adoptSaved,
    save,
  };
}
