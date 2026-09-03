import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  Bot,
  Plug,
  Boxes,
  Brain,
  Database,
  Mail,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";

import {
  Callout,
  Dialog,
  Skeleton,
  useScrollEdges,
  useToast,
} from "../components/ui";
import type { AiRuntimeInfo } from "../lib/aiClient";

import { useAiRuntime } from "../features/lab/useAiRuntime";
import { useCredits } from "../features/credits/useCredits";

import AgentFace from "../features/agents/AgentFace";
import ActionsSection from "../features/agents/ActionsSection";
import CapabilitiesSection from "../features/agents/CapabilitiesSection";
import EmailSection from "../features/agents/EmailSection";
import IdentitySection from "../features/agents/IdentitySection";
import KnowledgeSection from "../features/agents/KnowledgeSection";
import MemorySection from "../features/agents/MemorySection";
import RecordsSection from "../features/agents/RecordsSection";
import ModelSection from "../features/agents/ModelSection";
import SaveBar from "../features/agents/SaveBar";
import TestPanel from "../features/agents/TestPanel";
import { getAgent, listKnowledge } from "../features/agents/agentStore";
import { fingerprint, type Agent } from "../features/agents/types";
import { useAgentChat } from "../features/agents/useAgentChat";
import { useAttachments } from "../features/agents/attachments";
import { useAgentDraft } from "../features/agents/useAgentDraft";
import { useKnowledgeIndex } from "../features/agents/useKnowledgeIndex";
import { useAgentMemory } from "../features/agents/useAgentMemory";
import {
  hasErrors,
  validateConfig,
  validateRun,
} from "../features/agents/validate";

/*
 * The Agent Builder.
 *
 * An agent is a saved configuration that points at BuildGentic's
 * existing AI runtime — a model, a power source, standing
 * instructions, a body of knowledge, a set of capabilities. It
 * is not a second kind of AI, it does not have its own provider,
 * and there is no agent endpoint. Every answer produced on this
 * page comes out of the same POST /api/ai/chat the Lab uses,
 * counted by the same quota gate, paid for out of the same
 * allowance.
 *
 * The layout carries the argument. Configuration on the left, a
 * live agent on the right, both at once: a learner changes an
 * instruction and asks the same question again without leaving
 * the page, because that loop IS the work. A builder that made
 * testing a separate destination would teach that you configure
 * first and find out whether it was any good later, which is the
 * opposite of true.
 *
 * The page is split in two the way the Lab's is. The outer
 * component owns loading and failure; the workbench underneath
 * only ever exists once there is a real model catalogue to build
 * a draft from, so its opening model and parameters come from
 * the server rather than being guessed and corrected a render
 * later.
 */

type SectionId =
  | "identity"
  | "model"
  | "knowledge"
  | "memory"
  | "records"
  | "email"
  | "capabilities"
  | "actions";

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  icon: typeof Wrench;
}> = [
  { id: "identity", label: "Identity", icon: Sparkles },
  { id: "model", label: "Answering", icon: Wrench },
  { id: "knowledge", label: "Knowledge", icon: Boxes },
  /*
   * Between Knowledge and Capabilities on purpose. The two are
   * constantly confused — one is what the owner gave the agent,
   * the other is what the agent learned about a person — and
   * sitting them next to each other is the cheapest way to make
   * a learner read both ledes and notice the difference.
   */
  { id: "memory", label: "Memory", icon: Brain },
  /*
   * Directly after Memory, for exactly the reason Memory sits
   * directly after Knowledge: the two are constantly confused,
   * and putting them side by side is the cheapest way to make a
   * learner read both ledes and notice that one is what the
   * agent worked out and the other is what it was asked to
   * keep.
   */
  { id: "records", label: "Records", icon: Database },
  /*
   * After Records and before Capabilities, which puts it at the
   * end of the run of sections that show what an agent HAS —
   * knowledge, memory, records, mailbox — and immediately before
   * the one that decides what it MAY.
   *
   * Unlike every section above it, this one is hidden entirely
   * unless the agent has an email capability. The others are
   * always worth seeing: a learner reading the Memory tab with
   * memory off is learning what memory is. This one would be a
   * tab offering to connect a real mailbox to an agent that
   * cannot read one, which is not a lesson, it is a mistake
   * waiting to be made.
   */
  { id: "email", label: "Email", icon: Mail },
  { id: "capabilities", label: "Capabilities", icon: Bot },
  /*
   * Last, and after Capabilities rather than before it, because
   * it is the only section that is meaningless on its own: a
   * connection does nothing until Call APIs is switched on one
   * screen up. Reading them in this order, a learner turns the
   * capability on and then finds the place to configure it,
   * which is the order the two actually happen in.
   */
  { id: "actions", label: "Connections", icon: Plug },
];

export default function AgentBuilder() {
  const { agentId } = useParams<{ agentId: string }>();
  const runtime = useAiRuntime();

  /*
   * The agent being edited, once it has been fetched.
   *
   * Stamped with the id it was fetched for, which is what makes
   * "still loading" a derived fact rather than a second piece of
   * state. Setting a loading flag at the top of the effect would
   * be a synchronous setState inside an effect — a cascading
   * render, and the thing the lint rule is right to object to.
   *
   * `error` carries the sentinel "not-found" for both a bad id
   * and somebody else's agent, which RLS makes deliberately
   * indistinguishable.
   */
  const [loaded, setLoaded] = useState<{
    forId: string;
    agent: Agent | null;
    knowledge: Awaited<ReturnType<typeof listKnowledge>>;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!agentId) {
      return;
    }

    let active = true;

    getAgent(agentId)
      .then(async (agent) => {
        if (!agent) {
          return {
            forId: agentId,
            agent: null,
            knowledge: [],
            error: "not-found",
          };
        }

        return {
          forId: agentId,
          agent,
          knowledge: await listKnowledge(agent.id),
          error: null,
        };
      })
      .then((result) => {
        if (active) {
          setLoaded(result);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoaded({
            forId: agentId,
            agent: null,
            knowledge: [],
            error:
              error instanceof Error
                ? error.message
                : "This agent could not be loaded.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [agentId]);

  /* Only trusted when it describes the agent currently in the
     URL — a fetch for the previous one may still be in flight. */
  const current = loaded && loaded.forId === agentId ? loaded : null;

  const loadingAgent = Boolean(agentId) && current === null;
  const loadError = current?.error ?? null;

  const existing = current?.agent
    ? { agent: current.agent, knowledge: current.knowledge }
    : null;

  if ((runtime.loading && !runtime.info) || loadingAgent) {
    return (
      <div className="page page--flush">
        <div className="agentboot">
          <Skeleton width="220px" height="34px" />
          <Skeleton width="100%" height="120px" />
          <Skeleton width="100%" height="280px" />
        </div>
      </div>
    );
  }

  if (!runtime.info) {
    return (
      <div className="page page--flush">
        <div className="agentboot">
          <h1 className="page__title">Agent Builder</h1>

          <Callout
            tone="error"
            title="The Builder could not reach BuildGentic's AI runtime"
          >
            {runtime.error?.message ??
              "The model catalogue could not be loaded, and an agent cannot be configured without one. Reload the page to try again."}
          </Callout>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page page--flush">
        <div className="agentboot">
          <h1 className="page__title">Agent Builder</h1>

          <Callout
            tone={loadError === "not-found" ? "caution" : "error"}
            title={
              loadError === "not-found"
                ? "No such agent"
                : "That agent could not be loaded"
            }
          >
            {loadError === "not-found"
              ? "It may have been deleted, or the link may be wrong."
              : loadError}{" "}
            <Link to="/agents">Back to My Agents</Link>.
          </Callout>
        </div>
      </div>
    );
  }

  return (
    <Workbench
      /* Remounting on a change of agent is what clears one
         agent's draft and conversation out of the next one's
         Builder, with no effect to keep in step. */
      key={agentId ?? "new"}
      info={runtime.info}
      usage={runtime.usage}
      existing={existing}
      refreshUsage={runtime.refreshUsage}
      refreshInfo={runtime.refreshInfo}
    />
  );
}

/* =========================================================
   WORKBENCH
========================================================= */

interface WorkbenchProps {
  info: AiRuntimeInfo;
  usage: ReturnType<typeof useAiRuntime>["usage"];
  existing: {
    agent: Agent;
    knowledge: Awaited<ReturnType<typeof listKnowledge>>;
  } | null;
  refreshUsage: () => Promise<void>;
  refreshInfo: () => Promise<AiRuntimeInfo | null>;
}

function Workbench({
  info,
  usage,
  existing,
  refreshUsage,
}: WorkbenchProps) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { credits, canAfford, refresh: refreshCredits } = useCredits();

  const [section, setSection] = useState<SectionId>("identity");
  const [leaveOpen, setLeaveOpen] = useState(false);

  /* Which way the section tabs run off the edge, so the strip
     can say so. Eight tabs do not fit a phone.

     Destructured here rather than read as `tabStrip.ref` in the
     JSX below: react-hooks/refs reads any property access on a
     ref-bearing object during render as touching `.current`,
     and it is right to be strict about that even when this
     particular access is not. */
  const { ref: tabStripRef, edges: tabStripEdges } =
    useScrollEdges<HTMLDivElement>();

  /*
   * ONE OF BUILDGENTIC'S OWN AGENTS, unlocked from the Library.
   *
   * Its configuration is not the learner's to change, and this
   * page is where that has to be visible rather than merely
   * true. The database already refuses the write — migration
   * 0015 tightened the WITH CHECK on `agents` so an official
   * row cannot be updated from a browser at all — so nothing
   * below is the security boundary. It is the explanation.
   *
   * What stays editable is deliberate, not an oversight:
   *
   *   Knowledge — Study Tutor's entire onboarding asks the
   *   learner to upload their notes. The CONFIGURATION is
   *   fixed; the material it works from is theirs.
   *
   *   Memory — what an agent remembers about the person using
   *   it is that person's, on every agent, and the Memory
   *   screen is where they read and delete it.
   *
   * The Test panel keeps working throughout. An agent you
   * cannot talk to is not much of a purchase, and the prompt is
   * composed server-side for these — see the note in
   * server/src/routes/ai.ts.
   */
  const official = existing?.agent.isOfficial ?? false;

  const draftState = useAgentDraft({
    info,
    agent: existing?.agent ?? null,
  });

  const {
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
  } = draftState;

  /* Adopts the loaded agent's knowledge as the saved baseline,
     so opening an agent and touching nothing does not read as
     unsaved work. */
  useEffect(() => {
    if (existing) {
      adoptSaved(existing.agent, existing.knowledge);
    }
  }, [existing, adoptSaved]);

  /*
   * Keeping the agent's knowledge searchable.
   *
   * Owned here rather than inside KnowledgeSection because the
   * Knowledge tab is unmounted whenever the learner is looking
   * at another section, and an index run that stopped the moment
   * somebody clicked "Model" would be a run that mostly never
   * finished.
   */
  const index = useKnowledgeIndex(agentId, {
    /*
     * Every reading is folded straight back into the draft, so
     * the browser's idea of which entries are searchable never
     * lags the server's.
     *
     * Not cosmetic. `status` is what composeSystem branches on,
     * so a stale copy means the Test panel pastes a document
     * into the system prompt that the runtime is separately
     * retrieving — the same text twice, and a budget meter that
     * never falls.
     */
    onStatus: useCallback(
      (status: { entries: Array<{ knowledgeId: string; inline: boolean }> }) =>
        applyIndexState(status.entries),
      [applyIndexState]
    ),
  });

  /*
   * Owned here rather than inside MemorySection for the reason
   * the index above is: the Builder unmounts a section the
   * moment a learner switches away from it, and the panel has
   * to be up to date when they come BACK — which is exactly the
   * moment they want to check whether the thing they just said
   * was actually remembered.
   */
  const memories = useAgentMemory(agentId ?? null);

  /* Pulled out so `onSettled` below depends on the stable
     callback rather than on the hook's result object, which is
     rebuilt every render. */
  const refreshMemories = memories.refresh;

  const onSettled = useCallback(() => {
    /* The meters have to move the moment an answer lands, or
       they read as broken. */
    void refreshUsage();

    /* And the wallet, which this turn just spent from. */
    void refreshCredits();

    /*
     * And so does the memory list, for a sharper reason. A turn
     * can write a memory, so a Memory section still showing the
     * previous state would contradict the chip the learner has
     * just read under the answer — and being believed is most
     * of the value of this capability.
     *
     * Cheap: one indexed select, no provider call, and only
     * when an agent is actually saved.
     */
    refreshMemories();
  }, [refreshUsage, refreshCredits, refreshMemories]);

  const chat = useAgentChat({ onSettled });

  const streaming = chat.state.phase === "streaming";

  /* ---------------------------------------------------------
     ATTACHMENTS

     Owned here rather than inside the Test panel for the same
     reason the index run is: the panel is one component among
     several on a page that rearranges, and a file somebody has
     just waited thirty seconds to have read must not be thrown
     away by a layout change.
     --------------------------------------------------------- */

  const fileAnalysisOn = draft.capabilities.includes("file_analysis");

  const attachments = useAttachments({ limits: info.fileLimits });

  /*
   * Switching the capability off clears whatever was attached.
   *
   * Otherwise a learner turns File Analysis off to compare the
   * answers, the paperclip disappears, and their file is still
   * silently riding along on the next request — where the server
   * reports it as ignored and they have no control left to
   * remove it with.
   *
   * The dependency is the stable `clear` callback rather than
   * the hook's return value. Depending on the whole object ran
   * this effect on every render, and clearing an already-empty
   * list re-rendered, which re-ran the effect — an infinite
   * loop that React reports as "Maximum update depth exceeded".
   */
  const clearAttachments = attachments.clear;

  useEffect(() => {
    if (!fileAnalysisOn) {
      clearAttachments();
    }
  }, [fileAnalysisOn, clearAttachments]);

  /*
   * An image on a model that cannot see one.
   *
   * The server refuses this with a clear message, and this is
   * so the refusal is not the first the learner hears of it.
   * Read from the live model rather than from a capability flag
   * because it changes when they change the model, which is
   * exactly when somebody would hit it.
   */
  const visionWarning =
    attachments.hasImage && model && !model.vision
      ? `${model.displayName} cannot look at images. Pick a model that can, or remove the image.`
      : null;

  /* ---------------------------------------------------------
     VALIDATION
     --------------------------------------------------------- */

  const configErrors = validateConfig(draft, model, info.requestLimits);

  /*
   * What the next message would send, so the run checks measure
   * the real thing rather than the transcript so far.
   */
  const pendingMessages = useMemo(
    () =>
      chat.state.turns
        .filter((turn) => !turn.error && turn.content.trim().length > 0)
        .map((turn) => ({ role: turn.role, content: turn.content })),
    [chat.state.turns]
  );

  const runErrors = validateRun(
    draft,
    knowledge,
    pendingMessages,
    limits,
    info.requestLimits
  );

  const canSave = !hasErrors(configErrors);

  /* Advisory, like the Lab's. The server's spend_credits is
     what actually refuses. */
  const testCost = credits?.costs.agentTest ?? 2;

  const canSend =
    !streaming &&
    models.length > 0 &&
    Boolean(model) &&
    !hasErrors(runErrors) &&
    canAfford(testCost);

  /* ---------------------------------------------------------
     THE CONFIGURATION THE TEST PANEL RUNS

     Rebuilt on every change on purpose: a test always uses what
     is on screen now, never a copy taken when the conversation
     started.
     --------------------------------------------------------- */

  const chatConfig = useMemo(
    () => ({
      draft,
      knowledge,
      budget: info.requestLimits.maxSystemChars,
      agentId,
      /*
       * Only the files that finished uploading. One still being
       * read has no server id to send, and Send is disabled
       * while that is true — so this can never be a partial
       * list at the moment it is used.
       */
      attachments: attachments.sent,
      attachmentIds: attachments.ids,
    }),
    [
      draft,
      knowledge,
      info.requestLimits.maxSystemChars,
      agentId,
      attachments.sent,
      attachments.ids,
    ]
  );

  /*
   * Whether the configuration has moved since the last answer.
   *
   * The transcript is deliberately not wiped when a setting
   * changes — throwing away a learner's conversation because
   * they nudged the temperature is the worse surprise — so this
   * is what lets the panel say that what is on screen was
   * produced by an older configuration.
   *
   * Recorded when a message is sent rather than watched for in
   * an effect. Sending is an event, and the configuration it
   * used is known at exactly that moment; an effect would be
   * synchronising against a change that has already happened.
   */
  const [answeredPrint, setAnsweredPrint] = useState<string | null>(null);
  const currentPrint = fingerprint(draft, knowledge);

  const stale = answeredPrint !== null && answeredPrint !== currentPrint;

  const runChat = useCallback(
    (prompt: string, config: typeof chatConfig) => {
      setAnsweredPrint(fingerprint(config.draft, config.knowledge));
      void chat.send(prompt, config);

      /*
       * Cleared as the message goes, not when the answer comes
       * back. The files belong to the turn now in the
       * transcript, which shows them; leaving them in the
       * composer would attach the same spreadsheet to the next
       * question as well, and charge for it again.
       *
       * The server keeps holding them for the retention window,
       * which is what lets Retry re-ask the same question with
       * the same file.
       */
      attachments.clear();
    },
    [chat, attachments]
  );

  const retryChat = useCallback(
    (config: typeof chatConfig) => {
      setAnsweredPrint(fingerprint(config.draft, config.knowledge));
      void chat.retry(config);
    },
    [chat]
  );

  /* ---------------------------------------------------------
     ACTIONS
     --------------------------------------------------------- */

  async function handleSave() {
    const stored = await save();

    if (!stored) {
      return;
    }

    notify(
      agentId ? "Agent saved." : `${stored.name} created.`,
      "correct"
    );

    /*
     * The text has just changed, so whatever was indexed from it
     * is out of date. Not awaited: saving is finished, and a
     * learner should not watch a spinner while an embedding
     * provider is called. The Knowledge section shows the run as
     * it goes.
     *
     * A no-op on a brand-new agent, whose id does not exist yet
     * from this callback's point of view — the effect inside the
     * hook picks that case up the moment the id arrives.
     */
    index.sync();

    /* A new agent gains a URL of its own, so a reload or a
       bookmark reopens the thing that was just made rather than
       an empty Builder. Replaced rather than pushed: Back should
       go where the learner came from, not to a blank draft of an
       agent that now exists. */
    if (!agentId) {
      navigate(`/agents/${stored.id}`, { replace: true });
    }
  }

  function leave() {
    if (dirty) {
      setLeaveOpen(true);
      return;
    }

    void navigate("/agents");
  }

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */

  const knowledgeCount = knowledge.length;

  /* Whether the Email tab is offered at all. See the filter on
     SECTIONS below for why this one hides rather than
     explaining itself. */
  const hasEmail =
    draft.capabilities.includes("email_read") ||
    draft.capabilities.includes("email_draft") ||
    draft.capabilities.includes("email_send") ||
    draft.capabilities.includes("email_organize");

  return (
    <div className="page page--flush">
      <div className="agentshell">
        <header className="agenthead">
          <div className="agenthead__text">
            <p className="agenthead__eyebrow">Agents</p>

            <h1 className="agenthead__title">
              <AgentFace
                emoji={draft.avatarEmoji}
                tone={draft.avatarTone}
                size="md"
              />

              <span
                className={
                  draft.name.trim()
                    ? "agenthead__name"
                    : "agenthead__name agenthead__name--empty"
                }
              >
                {draft.name.trim() || "Untitled agent"}
              </span>
            </h1>

            <p className="agenthead__lede">
              {official
                ? "One of BuildGentic's own agents. Its instructions and settings are maintained by BuildGentic, so they are not yours to change — but its knowledge, its memory and its page are, and you can talk to it here."
                : "An agent is a saved configuration that runs on the same AI runtime as the Lab — instructions, a model, knowledge. Change something on the left and ask it a question on the right."}
            </p>
          </div>

          <div className="agenthead__actions">
            {/*
              Only once there is something to deploy. An unsaved
              draft has no id, and offering the link anyway would
              be offering a page that cannot load.

              A plain link, not a save-then-deploy shortcut:
              deploying is a decision made on its own screen,
              with the endpoint and the key in front of you.
            */}
            {agentId ? (
              <Link
                className="btn btn--ghost"
                to={`/agents/${agentId}/deploy`}
              >
                <Rocket size={15} aria-hidden="true" />
                Deploy
              </Link>
            ) : null}

            {/*
              Same condition and the same reasoning as Deploy: a
              schedule hangs off a saved agent, so an unsaved
              draft has nothing to schedule.
            */}
            {agentId ? (
              <Link
                className="btn btn--ghost"
                to={`/agents/${agentId}/schedule`}
              >
                <Clock size={15} aria-hidden="true" />
                Schedule
              </Link>
            ) : null}

            <button type="button" className="btn btn--ghost" onClick={leave}>
              <ArrowLeft size={15} aria-hidden="true" />
              My Agents
            </button>
          </div>
        </header>

        <div className="agentwork">
          <nav className="agentnav" aria-label="Agent sections">
            {/*
             * The strip is a separate element from the nav so
             * that the fade has something to sit on.
             *
             * `mask-image` applies to everything the element
             * paints, so masking the nav itself would fade its
             * background and take the bottom rule with it at
             * both ends. Background, border and sticky
             * positioning stay outside; scrolling and the fade
             * are in here.
             */}
            <div
              className="agentnav__strip"
              ref={tabStripRef}
              data-edges={tabStripEdges}
            >
              {SECTIONS.filter(
                /*
                 * Email is the one section that is hidden rather
                 * than shown-and-explained, and the exception is
                 * deliberate.
                 *
                 * Every other tab is worth opening with its
                 * capability off: reading the Memory tab with
                 * memory switched off is how a learner finds out
                 * what memory is, and the section says so. This
                 * one would offer to connect a real mailbox to an
                 * agent that cannot read one — which is not a
                 * lesson, it is a mistake standing by.
                 */
                ({ id }) => id !== "email" || hasEmail
              ).map(({ id, label, icon: Icon }) => {
                const alert =
                  (id === "identity" &&
                    Boolean(
                      configErrors.name ??
                        configErrors.description ??
                        configErrors.instructions
                    )) ||
                  (id === "model" &&
                    Boolean(
                      configErrors.model ??
                        configErrors.temperature ??
                        configErrors.maxOutputTokens
                    )) ||
                  (id === "knowledge" && Boolean(runErrors.knowledge));

                return (
                  <button
                    key={id}
                    type="button"
                    className={
                      section === id
                        ? "agentnav__item agentnav__item--on"
                        : "agentnav__item"
                    }
                    aria-current={section === id ? "page" : undefined}
                    onClick={() => setSection(id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {label}

                    {id === "knowledge" && knowledgeCount > 0 ? (
                      <span className="agentnav__count">{knowledgeCount}</span>
                    ) : null}

                    {alert ? (
                      <span
                        className="agentnav__alert"
                        /* Named, because a red dot with no
                           accessible text is a decoration. */
                        role="img"
                        aria-label="Needs attention"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </nav>

          {section === "identity" && official ? (
            <OfficialNotice
              title="Written by BuildGentic"
              body="This agent's name, description and instructions are part of what you unlocked. They are maintained by BuildGentic and improve over time — any change made to them reaches your copy automatically."
            />
          ) : null}

          {section === "identity" && !official ? (
            <IdentitySection
              draft={draft}
              errors={configErrors}
              systemBudget={info.requestLimits.maxSystemChars}
              onChange={patch}
            />
          ) : null}

          {section === "model" && official ? (
            <OfficialNotice
              title="Tuned by BuildGentic"
              body="The model and the answering settings were chosen for this agent and tested against it. They are part of what makes it work the way it does."
            />
          ) : null}

          {section === "model" && !official ? (
            <ModelSection
              usage={usage}
              draft={draft}
              models={models}
              model={model}
              limits={limits}
              errors={configErrors}
              disabled={streaming}
              onChange={patch}
            />
          ) : null}

          {section === "knowledge" ? (
            <KnowledgeSection
              draft={draft}
              knowledge={knowledge}
              systemBudget={info.requestLimits.maxSystemChars}
              onChange={replaceKnowledge}
              index={index.status}
              indexing={index.indexing}
              indexError={index.error}
              dirty={dirty}
              onReindex={index.reindex}
            />
          ) : null}

          {section === "memory" ? (
            <MemorySection
              draft={draft}
              agentId={agentId ?? null}
              memory={memories}
              onOpenCapabilities={() => setSection("capabilities")}
            />
          ) : null}

          {section === "records" ? (
            <RecordsSection
              draft={draft}
              agentId={agentId ?? null}
              onOpenCapabilities={() => setSection("capabilities")}
            />
          ) : null}

          {section === "email" ? (
            <EmailSection
              draft={draft}
              agentId={agentId ?? null}
              onOpenCapabilities={() => setSection("capabilities")}
            />
          ) : null}

          {section === "capabilities" && official ? (
            <OfficialNotice
              title="Chosen for this agent"
              body="Each of BuildGentic's agents has the capabilities its job needs, and only those. Turning one on or off would change what it is."
            />
          ) : null}

          {section === "capabilities" && !official ? (
            <CapabilitiesSection
              capabilities={draft.capabilities}
              onChange={(capabilities) => patch({ capabilities })}
            />
          ) : null}

          {section === "actions" && official ? (
            <OfficialNotice
              title="Set up by BuildGentic"
              body="BuildGentic's own agents reach only the services they were built with. Build your own agent to connect it to something of yours."
            />
          ) : null}

          {section === "actions" && !official ? (
            <ActionsSection
              agentId={agentId ?? null}
              capabilities={draft.capabilities}
            />
          ) : null}

          {saveError ? (
            <div className="agentsec" style={{ paddingTop: 0 }}>
              <Callout tone="error" title="That did not save">
                {saveError}
              </Callout>
            </div>
          ) : null}
        </div>

        <TestPanel
          draft={draft}
          turns={chat.state.turns}
          streaming={streaming}
          streamingId={chat.state.streamingId}
          stale={stale}
          runErrors={runErrors}
          canSend={canSend}
          config={chatConfig}
          onSend={runChat}
          onStop={chat.stop}
          onClear={() => {
            chat.clear();
            setAnsweredPrint(null);
          }}
          onRetry={retryChat}
          /*
           * Both for the drafted-reply card. `agentId` is null
           * on an unsaved draft, which is also the state in
           * which no draft row can exist — so the card cannot
           * appear without one, and the panel does not have to
           * decide what to do about that case.
           *
           * `canSendEmail` decides whether the card offers a
           * Send button or explains which switch is off. The
           * server checks the same capability again on the
           * request; this is so the panel is honest about what
           * pressing it would do, not so the browser decides.
           */
          agentId={agentId ?? null}
          canSendEmail={draft.capabilities.includes("email_send")}
          files={
            fileAnalysisOn
              ? {
                  attachments: attachments.attachments,
                  limits: info.fileLimits,
                  busy: attachments.busy,
                  visionWarning,
                  onAdd: (picked) =>
                    attachments.add(picked, { agentId }),
                  onRemove: attachments.remove,
                }
              : null
          }
        />

        {/* No Save bar for an agent that cannot be saved. A
            disabled one would be a control asking to be
            pressed, and the answer would come from the
            database as a policy violation. */}
        {official ? null : (
          <SaveBar
            dirty={dirty}
            saving={saving}
            valid={canSave}
            agentId={agentId}
            invalidHint={
              canSave ? undefined : "Fix what is marked before saving."
            }
            onSave={() => void handleSave()}
          />
        )}
      </div>

      <Dialog
        open={leaveOpen}
        title="Leave without saving?"
        text="This agent has changes that have not been saved. Leaving now discards them."
        confirmLabel="Discard and leave"
        cancelLabel="Stay here"
        destructive
        onConfirm={() => {
          setLeaveOpen(false);
          void navigate("/agents");
        }}
        onCancel={() => setLeaveOpen(false)}
      />
    </div>
  );
}

/*
 * What sits where a form would be, on one of BuildGentic's own
 * agents.
 *
 * A sentence about why, rather than a greyed-out copy of the
 * fields. A disabled form is an invitation with the door shut:
 * it shows a learner exactly what they cannot have and leaves
 * them looking for the reason. This says the reason instead —
 * and, in the identity case, says the thing that makes the
 * restriction a benefit: their copy gets better when BuildGentic
 * improves the original.
 */
function OfficialNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="agentsec">
      <Callout tone="info" title={title}>
        {body}
      </Callout>
    </div>
  );
}
