import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Braces,
  Brain,
  Check,
  Clock,
  ExternalLink,
  FileDown,
  Globe,
  Inbox,
  ListChecks,
  Loader2,
  PenLine,
  Plug,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Button, Callout, IconButton, Textarea } from "../../components/ui";
import type {
  AiDocumentInfo,
  AiEmailDraftInfo,
  AiMemoryInfo,
  AiMemoryWriteInfo,
  AiRetrievalInfo,
  AiWebSearchInfo,
} from "../../lib/aiClient";
import { downloadDocument } from "./documentsApi";
import { discardDraft, sendDraft } from "./emailApi";
import type { ActionStep } from "./useAgentChat";
import {
  AttachmentStrip,
  FilesRead,
  SentFiles,
  type FilesControl,
} from "./AttachmentUi";
import { explainError } from "../lab/explain";
import AgentFace from "./AgentFace";
import type { ChatConfig, ChatTurn } from "./useAgentChat";
import type { AgentErrors } from "./validate";
import type { AgentDraft } from "./types";

/*
 * Testing the agent that is on screen, not the one in the
 * database.
 *
 * That distinction is the reason this panel is always visible
 * rather than living behind a button. A learner's loop is change
 * one instruction, ask the same question, see whether the answer
 * moved — and a builder that made them save first would teach
 * that testing is something you do at the end, to a finished
 * thing. It is not; it is how the thing gets finished.
 *
 * Everything below goes through streamChat to /api/ai/chat, the
 * same call the Lab makes. The only difference is a `system`
 * field this feature assembled and a `feature: "agent_test"` so
 * the usage row can say where the spend came from.
 */

/*
 * Split out of the main bundle, for the reason spelled out in
 * NeuralResponse: the markdown parser, KaTeX and the syntax
 * highlighter come to roughly 190 kB gzipped between them, and
 * none of it is needed to read a lesson or sit a quiz.
 *
 * The Lab already imports the same chunk, so a learner who has
 * been there arrives here with it cached.
 */
const ResponseMarkdown = lazy(() => import("../lab/ResponseMarkdown"));

/*
 * How each kind of memory is introduced in the log.
 *
 * Deliberately the learner's words rather than the schema's.
 * "preference" is a column name; "How you like to learn" is
 * what it means, and this strip is the only place most people
 * will ever see the distinction.
 *
 * Indexed loosely so a kind from a newer server renders as a
 * plain note instead of an empty span.
 */
const MEMORY_LABELS: Record<string, string> = {
  profile: "About you",
  preference: "How you like to learn",
  goal: "Working towards",
  project: "Working on",
  fact: "Noted",
};

interface TestPanelProps {
  draft: AgentDraft;
  turns: ChatTurn[];
  streaming: boolean;
  streamingId: string | null;
  /* Set when the configuration has moved since the last answer,
     so the transcript can say it describes an older agent. */
  stale: boolean;
  runErrors: AgentErrors;
  canSend: boolean;
  config: ChatConfig;
  onSend: (prompt: string, config: ChatConfig) => void;
  onStop: () => void;
  onClear: () => void;
  onRetry: (config: ChatConfig) => void;
  /*
   * The attachment control's whole state, owned by the page.
   *
   * Passed in rather than held here because the Builder
   * unmounts nothing when a learner switches section, but a
   * future rearrangement that did would otherwise throw away a
   * file somebody has just waited thirty seconds for.
   *
   * Null when File Analysis is switched off, which is what
   * removes the paperclip entirely — a control that is present
   * and refuses is worse than one that is not there.
   */
  files: FilesControl | null;
  /*
   * The saved agent, and whether it may send.
   *
   * Both needed by the drafted-reply card, which is the only
   * thing in this panel with a consequence outside BuildGentic.
   * `agentId` is null on an unsaved draft, which is also the
   * state in which no draft row can exist — so the card cannot
   * appear without one.
   *
   * `canSendEmail` decides whether the card offers a Send
   * button or explains that it will not. The server checks the
   * same capability again on the request; this is so the UI is
   * honest about what pressing it would do, not so the browser
   * decides.
   */
  agentId: string | null;
  canSendEmail: boolean;
}

export default function TestPanel({
  draft,
  turns,
  streaming,
  streamingId,
  stale,
  runErrors,
  canSend,
  config,
  onSend,
  onStop,
  onClear,
  onRetry,
  files,
  agentId,
  canSendEmail,
}: TestPanelProps) {
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /*
   * Anchored to the bottom while text streams, but only when the
   * learner is already there. Yanking the view back down while
   * somebody is reading three answers up is the single most
   * irritating thing a chat log can do.
   */
  useEffect(() => {
    const log = logRef.current;

    if (!log) {
      return;
    }

    const nearBottom =
      log.scrollHeight - log.scrollTop - log.clientHeight < 120;

    if (nearBottom) {
      log.scrollTop = log.scrollHeight;
    }
  }, [turns]);

  /*
   * A file still being read blocks Send.
   *
   * Not a nicety: sending now would ask about a document the
   * server has not finished parsing, and the request would
   * either arrive without it or refuse. The button says
   * "Reading file…" instead, which is the honest description of
   * what everybody is waiting for.
   */
  const reading = files?.busy === true;

  function submit() {
    if (!canSend || reading || !prompt.trim()) {
      return;
    }

    onSend(prompt, config);
    setPrompt("");
  }

  const blocked = runErrors.knowledge ?? runErrors.conversation;

  /*
   * Whether this panel is a mail desk rather than a chat box.
   *
   * Read off the draft's capabilities, so a learner switching
   * Read Email on watches the workflows appear — which is the
   * clearest possible demonstration of what the capability
   * changed, and the same trick the paperclip plays for File
   * Analysis.
   */
  const emailDesk = draft.capabilities.includes("email_read");

  const runWorkflow = (text: string) => {
    if (!canSend || reading) {
      return;
    }

    onSend(text, config);
  };

  return (
    <aside className="agenttest" aria-label="Test your agent">
      <div className="agenttest__head">
        <h2 className="agenttest__title">Test Agent</h2>

        {turns.length > 0 ? (
          <IconButton
            label="Clear this conversation"
            icon={<RefreshCw size={15} />}
            size="sm"
            onClick={onClear}
          />
        ) : null}
      </div>

      <div className="agenttest__log" ref={logRef}>
        {turns.length === 0 ? (
          <p className="agenttest__empty">
            {emailDesk ? (
              <>
                Pick something below, or ask in your own words.
                <br />
                It reads your real mailbox, and it cannot send anything
                without you.
              </>
            ) : (
              <>
                Ask it something.
                <br />
                This runs the configuration as it stands right now — you do
                not have to save first.
              </>
            )}
          </p>
        ) : (
          turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
              draft={draft}
              streaming={turn.id === streamingId}
              onRetry={() => onRetry(config)}
              agentId={agentId}
              canSendEmail={canSendEmail}
            />
          ))
        )}
      </div>

      <div className="agenttest__foot">
        {stale && turns.length > 0 ? (
          <p className="agenttest__stale">
            <TriangleAlert size={13} aria-hidden="true" />
            You have changed the configuration since these answers. The next
            message uses the new one.
          </p>
        ) : null}

        {blocked ? (
          <div style={{ marginBottom: "var(--space-3)" }}>
            <Callout tone="caution" title="Cannot send yet">
              {blocked}
            </Callout>
          </div>
        ) : null}

        {/*
          THE WORKFLOWS, ABOVE THE COMPOSER.

          An email agent that opened as an empty text box would
          be a chatbot with a mailbox attached, and a student
          looking at one does not know that "which of these can
          wait until Monday" is a thing it will answer well. Six
          buttons is the difference between a capability and a
          product.

          They send ORDINARY MESSAGES rather than calling
          anything special — each one is a sentence typed into
          the same composer, through the same runtime, hitting
          the same tools. That matters for two reasons: there is
          no second path to keep in step with the first, and a
          learner can see exactly what was asked and edit it
          next time.
        */}
        {emailDesk ? (
          <EmailWorkflows
            onRun={runWorkflow}
            onFill={(text) => {
              setPrompt(text);

              /* Focus and put the cursor at the end, so the
                 next keystroke continues the sentence rather
                 than landing in the middle of it. */
              const box = document.getElementById("agenttest-prompt");

              if (box instanceof HTMLTextAreaElement) {
                box.focus();
                box.setSelectionRange(text.length, text.length);
              }
            }}
            disabled={!canSend || reading}
          />
        ) : null}

        {files ? (
          <AttachmentStrip
            files={files}
            disabled={streaming}
            onPick={() => fileRef.current?.click()}
            inputRef={fileRef}
          />
        ) : null}

        <div className="agenttest__composer">
          <label className="sr-only" htmlFor="agenttest-prompt">
            Message your agent
          </label>

          <Textarea
            id="agenttest-prompt"
            rows={2}
            value={prompt}
            placeholder="Ask your agent something…"
            style={{ flex: 1 }}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              /* Enter sends, Shift+Enter breaks the line — the
                 convention every chat box shares, and the one a
                 learner will try first. */
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />

          {streaming ? (
            <Button
              variant="secondary"
              icon={<Square size={14} />}
              onClick={onStop}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={
                reading ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Send size={15} />
                )
              }
              disabled={!canSend || reading || !prompt.trim()}
              onClick={submit}
            >
              {/* The three states this control has to
                  distinguish, in the learner's words rather than
                  the system's: their file is being read, the
                  agent is thinking, or it is their turn. */}
              {reading ? "Reading file…" : "Send"}
            </Button>
          )}
        </div>

        <p className="agenttest__hint">
          Enter sends, Shift+Enter adds a line.
          {files
            ? " Attach a file and ask your agent about it."
            : ""}{" "}
          Every message spends from the same allowance as the Lab.
        </p>
      </div>
    </aside>
  );
}

/* =========================================================
   ONE TURN
========================================================= */

function Turn({
  turn,
  draft,
  streaming,
  onRetry,
  agentId,
  canSendEmail,
}: {
  turn: ChatTurn;
  draft: AgentDraft;
  streaming: boolean;
  onRetry: () => void;
  agentId: string | null;
  canSendEmail: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="turn turn--user">
        <span className="turn__you" aria-hidden="true">
          <User size={15} />
        </span>

        <div className="turn__body">
          {turn.content}
          <SentFiles files={turn.attachments} />
        </div>
      </div>
    );
  }

  const guidance = turn.error ? explainError(turn.error) : null;

  return (
    <div className="turn turn--agent">
      <AgentFace emoji={draft.avatarEmoji} tone={draft.avatarTone} size="sm" />

      <div className="turn__body">
        {/* First, because it is the one the learner is waiting
            on: they attached something and want to know it
            arrived. */}
        {turn.fileAnalysis ? <FilesRead info={turn.fileAnalysis} /> : null}

        {/* Before the other two, because it is about WHO the
            agent was talking to rather than what it read, and
            that frames everything under it. */}
        {turn.memory ? <Remembered info={turn.memory} /> : null}

        {turn.retrieval ? <Retrieved info={turn.retrieval} /> : null}

        {turn.webSearch ? <WebSearched info={turn.webSearch} /> : null}

        {/*
          Last of the telemetry and directly above the answer,
          because unlike the four above it it is not background
          the agent was given — it is what the agent DID, and it
          reads as the first half of the answer rather than as a
          footnote to it.
        */}
        {turn.actions.length > 0 ? <Acted steps={turn.actions} /> : null}

        {/*
          BELOW the answer, unlike every other piece of turn
          telemetry, and the position is the argument. Retrieval,
          search and the step list are things the agent did
          BEFORE it wrote, and they read as the first half of the
          answer. A file is the outcome: the agent says what it
          made, and then here it is.
        */}
        {turn.documents.length > 0 ? (
          <Files documents={turn.documents} />
        ) : null}

        {/*
          ABOVE the answer, and it is the one piece of turn
          telemetry that sits there rather than below.
          Everything else on this screen is evidence about a
          sentence the learner is about to read; this is a
          decision they are about to be asked to make, and the
          agent's own "I have drafted a reply — shall I send
          it?" reads as a caption to the card rather than as a
          promise the card has to live up to.
        */}
        {turn.drafts.length > 0 && agentId ? (
          <Drafted
            drafts={turn.drafts}
            agentId={agentId}
            canSend={canSendEmail}
          />
        ) : null}

        {turn.content ? (
          <Suspense fallback={<span style={{ whiteSpace: "pre-wrap" }}>{turn.content}</span>}>
            <ResponseMarkdown source={turn.content} streaming={streaming} />
          </Suspense>
        ) : streaming ? (
          <span className="turn__caret" aria-hidden="true" />
        ) : null}

        {/* After the answer, because that is when it happened.
            The one strip on this panel that describes the
            future rather than the past: what this agent will
            know next time. */}
        {turn.memoryWrite ? <Learned info={turn.memoryWrite} /> : null}

        {/* Model, latency and tokens — the same reflex as the
            Lab's telemetry strip. An answer whose cost is
            invisible teaches that answers are free. */}
        {turn.done && turn.start ? (
          <div className="turn__telemetry">
            <span>{turn.start.model}</span>
            <span>{turn.done.latencyMs.toLocaleString()} ms</span>
            <span>
              {turn.done.usage.inputTokens.toLocaleString()} in ·{" "}
              {turn.done.usage.outputTokens.toLocaleString()} out
              {turn.done.usage.reported ? "" : " (est.)"}
            </span>
            {turn.done.finishReason === "length" ? (
              <span>hit the reply cap</span>
            ) : null}
          </div>
        ) : null}

        {guidance && turn.error ? (
          <div className="turn__error">
            <Callout tone={guidance.tone} title={guidance.title}>
              {/*
                The runtime's own sentence, first and always. It
                is the only part that knows which failure this
                actually was — "out of credit" rather than
                "unavailable" — and errors.ts guarantees it
                carries no provider internals. The guidance adds
                context to it; it never replaces it.
              */}
              <p>{turn.error.message}</p>

              {guidance.body ? <p>{guidance.body}</p> : null}

              {guidance.action ? (
                <p className="row gap-2" style={{ marginTop: "var(--space-3)" }}>
                  {guidance.action === "retry" ? (
                    <Button size="sm" onClick={onRetry}>
                      Ask it again
                    </Button>
                  ) : null}

                  {guidance.action === "sign-in" ? (
                    /* A destination, not an action — so a real
                       link, which middle-clicks and opens in a
                       new tab the way a learner expects. */
                    <Link className="btn btn--secondary btn--sm" to="/login">
                      Sign in again
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </Callout>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* =========================================================
   WHAT IT LOOKED UP

   The single most educational object on this panel, and the
   reason the runtime emits a `retrieval` event at all.

   An agent that answers well from a large knowledge base is
   indistinguishable from one that got lucky, unless you can see
   which passages it actually read. Ask about photosynthesis and
   then about the Treaty of Versailles, and this strip changes —
   which is retrieval explained in one interaction, and nothing
   written on a page explains it as well.

   Collapsed by default. The answer is what the learner asked
   for; this is why they got it.
========================================================= */

function WebSearched({ info }: { info: AiWebSearchInfo }) {
  /*
   * Nothing happened, and saying which nothing is the point.
   *
   * "It decided not to look" and "it looked and found nothing"
   * and "it could not look" send a learner to three different
   * places, and only the last is a fault. Collapsing them into
   * silence — showing this strip only when a search succeeded —
   * would make the commonest outcome invisible and leave
   * somebody convinced the switch does nothing.
   */
  if (info.sources.length === 0) {
    const said = !info.searched
      ? info.reason === "unavailable"
        ? "Could not search the web this time, so it answered without it."
        : "Answered from what it already knows — it decided this did not need looking up."
      : info.reason === "unavailable"
        ? `Found ${info.resultCount} ${
            info.resultCount === 1 ? "result" : "results"
          }, but the prompt had no room for them.`
        : "Searched the web and found nothing useful for this.";

    return (
      <p className="turn__web turn__web--empty">
        <Globe size={12} aria-hidden="true" />
        {said}
      </p>
    );
  }

  return (
    <details className="turn__web">
      <summary>
        <Globe size={12} aria-hidden="true" />
        Searched the web · {info.sources.length}{" "}
        {info.sources.length === 1 ? "source" : "sources"} ·{" "}
        {info.latencyMs.toLocaleString()} ms
      </summary>

      {/*
        What it typed into the search box. The single most
        useful thing on this strip when an answer is wrong: a
        bad answer from a good search and a bad answer from a
        bad search have completely different fixes, and the
        second one is fixed by editing the agent's
        instructions.
      */}
      <p className="turn__web-queries">
        <span>Looked up</span>
        {info.queries.map((query) => (
          <code key={query}>{query}</code>
        ))}
      </p>

      <ol className="turn__web-sources">
        {info.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              <span className="turn__web-title">{source.title}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>

            <span className="turn__web-meta">
              {source.site}
              {source.publishedAt ? ` · ${source.publishedAt}` : ""}
            </span>
          </li>
        ))}
      </ol>

      <p className="turn__web-foot">
        {info.resultCount > info.sources.length
          ? `${info.resultCount} results came back; the ${info.sources.length} above fitted in the prompt. `
          : ""}
        Numbers in the answer, like [1], point at this list.
      </p>
    </details>
  );
}

/* =========================================================
   WHAT IT REMEMBERED

   Memory is the only capability whose work leaves no trace in
   the answer. A retrieved passage shows up as a citation and a
   searched page shows up as a link — but an agent that knows
   somebody is aiming for a 5 in May just writes a slightly
   better paragraph, and a learner has no way to tell that from
   the model guessing well.

   So these two strips ARE the capability, as far as anybody
   can see it. The first says what it walked in knowing. The
   second says what it will know next time.
========================================================= */

function Remembered({ info }: { info: AiMemoryInfo }) {
  /*
   * Nothing recalled, and saying which nothing is the whole
   * point.
   *
   * "It has not learned anything about you yet", "you have not
   * saved this agent so it cannot", and "it could not read its
   * memory" send a learner to three completely different
   * places, and only the last is a fault. Collapsing them into
   * silence would make the commonest outcome — a first
   * conversation — invisible, and leave somebody convinced the
   * switch does nothing.
   */
  if (info.memories.length === 0) {
    if (!info.reason) {
      return null;
    }

    const said =
      info.reason === "no_agent"
        ? "Save this agent and it will start remembering — memories are kept against a saved agent, not a draft."
        : info.reason === "unavailable"
          ? "Could not read what it remembers this time, so it answered without it."
          : "Nothing remembered about you yet. Tell it something worth keeping and watch this change.";

    return (
      <p className="turn__memory turn__memory--empty">
        <Brain size={12} aria-hidden="true" />
        {said}
      </p>
    );
  }

  return (
    <details className="turn__memory">
      <summary>
        <Brain size={12} aria-hidden="true" />
        Remembered {info.memories.length}{" "}
        {info.memories.length === 1 ? "thing" : "things"} about you
        {info.scope === "deployment" ? " (from its endpoint)" : ""}
      </summary>

      <ul>
        {info.memories.map((entry) => (
          <li key={entry.id}>
            <span className="turn__memory-kind">{MEMORY_LABELS[entry.kind] ?? "Note"}</span>
            <span className="turn__memory-text">{entry.content}</span>
          </li>
        ))}
      </ul>

      {/*
        The degraded case, named rather than hidden. "Your
        memory is bigger than one prompt" and "the part that
        picks the relevant ones was down" are different
        problems, and the second one is temporary.
      */}
      {info.reason === "ranked" ? (
        <p className="turn__memory-foot">
          These are its most recent memories rather than the ones closest to
          what you asked — matching by relevance was unavailable this time.
        </p>
      ) : null}
    </details>
  );
}

function Learned({ info }: { info: AiMemoryWriteInfo }) {
  /*
   * Most turns write nothing, and that is correct rather than
   * disappointing: the extractor is deliberately biased against
   * remembering, because a wrong memory is carried into every
   * future conversation while a missed one costs one sentence.
   *
   * Only the two outcomes a learner might act on are shown.
   * `trivial` and `nothing_new` are the ordinary silence of a
   * conversation with nothing durable in it, and a chip saying
   * "remembered nothing" after every message would be noise
   * that trains people to stop reading this panel.
   */
  if (info.written.length === 0) {
    if (info.reason !== "unavailable" && info.reason !== "full") {
      return null;
    }

    return (
      <p className="turn__learned turn__learned--empty">
        <Sparkles size={12} aria-hidden="true" />
        {info.reason === "full"
          ? "Its memory is full, so nothing new was kept. Delete some in the Memory section."
          : "Could not save what it learned from this."}
      </p>
    );
  }

  return (
    <details className="turn__learned">
      <summary>
        <Sparkles size={12} aria-hidden="true" />
        Remembered {info.written.length} new{" "}
        {info.written.length === 1 ? "thing" : "things"} from this
      </summary>

      <ul>
        {info.written.map((entry) => (
          <li key={entry.id}>
            <span className="turn__memory-kind">
              {entry.replaced ? "Updated" : MEMORY_LABELS[entry.kind] ?? "Note"}
            </span>
            <span className="turn__memory-text">{entry.content}</span>
          </li>
        ))}
      </ul>

      <p className="turn__memory-foot">
        It will know this in your next conversation too. Read or delete anything
        it has kept in the Memory section.
      </p>
    </details>
  );
}

function Retrieved({ info }: { info: AiRetrievalInfo }) {
  if (info.sources.length === 0) {
    if (!info.reason) {
      return null;
    }

    const said =
      info.reason === "none_indexed"
        ? "Nothing is searchable yet, so its knowledge was sent in full."
        : info.reason === "unavailable"
          ? "Its knowledge could not be searched this time, so it answered without it."
          : "Searched its knowledge and found nothing relevant to this.";

    return (
      <p className="turn__retrieval turn__retrieval--empty">
        <Search size={12} aria-hidden="true" />
        {said}
      </p>
    );
  }

  return (
    <details className="turn__retrieval">
      <summary>
        <Search size={12} aria-hidden="true" />
        Read {info.sources.length}{" "}
        {info.sources.length === 1 ? "passage" : "passages"} from its knowledge
      </summary>

      <ul>
        {info.sources.map((source) => (
          <li key={`${source.knowledgeId}-${source.ordinal}`}>
            <span className="turn__retrieval-title">
              {source.title.trim() || "Untitled"}
            </span>
            <span className="turn__retrieval-meta">
              part {source.ordinal + 1} · {Math.round(source.similarity * 100)}%
              match
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ---------------------------------------------------------
   WHAT THE AGENT DID

   The strip this whole capability exists to produce.

   Every other panel on a turn reports what the agent was
   GIVEN — passages, pages, files, memories. This one reports
   what it chose to do, and it is the difference a learner is
   actually looking for: an agent that answers "47" is
   indistinguishable from a chatbot that guessed "47" until you
   can see the four lines of JavaScript it ran to get there.

   So the code and the arguments are shown in full, open by
   default on a single step. The other strips collapse because
   their contents are reference material somebody may want to
   check; this one is the evidence, and hiding the evidence
   behind a disclosure triangle would be hiding the lesson.
   --------------------------------------------------------- */

function toolLabel(tool: ActionStep["tool"]): string {
  if (tool === "run_code") {
    return "Ran code";
  }

  if (tool === "http_request") {
    return "Called an API";
  }

  /* No tool was ever chosen: the agent wrote something that
     was not a readable action. Saying so beats naming a tool
     that never ran. */
  return "Tried to act";
}

/*
 * The one argument worth showing above the fold, per tool.
 *
 * A program is the whole point of a run_code step, so it gets a
 * code block. An address is the whole point of an http_request
 * step. Everything else is detail that would push the result
 * off the screen.
 */
function primaryArg(step: ActionStep): { label: string; value: string } | null {
  if (step.tool === null) {
    return null;
  }

  if (step.tool === "run_code") {
    const code = step.args.code;
    return typeof code === "string" ? { label: "Program", value: code } : null;
  }

  const url = step.args.url;

  if (typeof url !== "string") {
    return null;
  }

  const method =
    typeof step.args.method === "string" ? step.args.method.toUpperCase() : "GET";

  const connection =
    typeof step.args.connection === "string" ? `${step.args.connection}: ` : "";

  return { label: "Request", value: `${method} ${connection}${url}` };
}

/*
 * The files this turn made.
 *
 * Below the answer rather than above it, unlike every other
 * piece of turn telemetry, and the position is the argument.
 * Retrieval, search and the step list are all things the agent
 * did BEFORE it wrote — they read as the first half of the
 * answer. A file is the OUTCOME: the agent explains what it
 * made, and then here it is.
 *
 * Rendered from `turn.documents`, which is populated from the
 * runtime's `document` event and from nothing else. That is the
 * structural half of this feature's honesty — an agent that
 * writes "I have attached the report" without making one gets
 * no button under its own sentence, and the contradiction is on
 * screen rather than in a log.
 */
function Files({ documents }: { documents: AiDocumentInfo[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shape = (file: AiDocumentInfo): string => {
    const size =
      file.bytes < 1024
        ? `${file.bytes} bytes`
        : `${Math.round(file.bytes / 1024)} KB`;

    if (file.pages !== undefined) {
      return `${file.pages} page${file.pages === 1 ? "" : "s"} · ${size}`;
    }

    if (file.sheets !== undefined) {
      return `${file.sheets} sheet${file.sheets === 1 ? "" : "s"}, ${file.rows ?? 0} rows · ${size}`;
    }

    return size;
  };

  return (
    <div className="turn__files">
      {documents.map((file) => (
        <div className="turn__file" key={file.id}>
          <FileDown size={14} aria-hidden="true" />

          <span className="turn__file-name">{file.filename}</span>
          <span className="turn__file-shape">{shape(file)}</span>

          <Button
            size="sm"
            variant="ghost"
            disabled={busy === file.id}
            onClick={async () => {
              setBusy(file.id);
              setError(null);

              try {
                await downloadDocument(file.id, file.filename);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "The file could not be downloaded."
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === file.id ? "Opening…" : "Download"}
          </Button>

          {/*
            Said where the file is, not in a log. A PDF whose
            Japanese heading came out as [?] is a file its owner
            has to know about before they send it to somebody —
            and "the agent left that out" and "that could not be
            drawn" are different problems with different fixes.
          */}
          {file.degraded ? (
            <p className="turn__file-note">{file.degraded}</p>
          ) : null}
        </div>
      ))}

      {error ? <p className="turn__act-error">{error}</p> : null}
    </div>
  );
}

/*
 * A reply the agent wrote, and the button that sends it.
 *
 * THE ONLY CONTROL IN THIS PANEL WITH A CONSEQUENCE OUTSIDE
 * BUILDGENTIC, and every decision in it follows from that.
 *
 * THE WHOLE BODY IS ON SCREEN. Not a summary, not the first
 * line, not "Reply to Professor Ellis · 3 paragraphs". A card
 * that hid what was being approved would teach people to
 * approve without reading, and this is the one screen in the
 * product where that habit reaches somebody else's inbox.
 *
 * SENDING TAKES TWO DELIBERATE ACTS. The first press asks; the
 * second confirms, naming the recipient. "Are you sure" is a
 * question nobody reads — "send to ada@example.com?" is one
 * they answer, because the thing worth checking before a reply
 * leaves is who is about to receive it.
 *
 * AND THE CARD IS BUILT FROM THE `email_draft` EVENT, never
 * from the prose beside it. That is what makes the two words
 * this capability turns on impossible for an agent to blur: one
 * that claims it SENT a reply produces a card marked Draft with
 * an unpressed button on it, sitting directly under its own
 * sentence.
 */
function Drafted({
  drafts,
  agentId,
  canSend,
}: {
  drafts: AiEmailDraftInfo[];
  agentId: string;
  canSend: boolean;
}) {
  /* Which draft is mid-confirmation, and which has already
     gone. Held here rather than lifted, because a turn's cards
     outlive nothing — the transcript is the only place they
     appear and the Email screen is the durable tray. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="turn__drafts">
      {drafts.map((entry) => {
        const wasSent = sent[entry.id];
        const discarded = gone.includes(entry.id);

        return (
          <div className="turn__draft" key={entry.id}>
            <div className="turn__draft-head">
              <Send size={14} aria-hidden="true" />

              <span className="turn__draft-state">
                {wasSent ? "Sent" : discarded ? "Discarded" : "Draft"}
              </span>

              <span className="turn__draft-to">
                to {entry.to.join(", ") || "(no recipient)"}
                {entry.cc.length > 0 ? `, cc ${entry.cc.join(", ")}` : ""}
              </span>
            </div>

            <p className="turn__draft-subject">
              {entry.subject || "(no subject)"}
            </p>

            <pre className="turn__draft-body">{entry.body}</pre>

            {wasSent ? (
              <p className="turn__draft-note">
                <Check size={13} aria-hidden="true" /> Sent{" "}
                {new Date(wasSent).toLocaleTimeString()}. It is in your Sent
                folder.
              </p>
            ) : discarded ? (
              <p className="turn__draft-note">Discarded. Nothing was sent.</p>
            ) : confirming === entry.id ? (
              /*
               * The second act. It restates the recipient rather
               * than asking an abstract question, because that
               * is the fact worth checking — and it says the
               * thing that is actually true about email, which
               * is that there is no undo.
               */
              <div className="turn__draft-confirm">
                <p className="turn__draft-note">
                  Send this to <strong>{entry.to.join(", ")}</strong>? It cannot
                  be taken back.
                </p>

                <div className="turn__draft-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy === entry.id}
                    icon={<Send size={14} />}
                    onClick={async () => {
                      setBusy(entry.id);
                      setError(null);

                      try {
                        const result = await sendDraft(agentId, entry.id);
                        setSent((current) => ({
                          ...current,
                          [entry.id]: result.sentAt ?? new Date().toISOString(),
                        }));
                        setConfirming(null);
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "That message could not be sent."
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === entry.id ? "Sending…" : "Yes, send it"}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === entry.id}
                    onClick={() => setConfirming(null)}
                  >
                    Not yet
                  </Button>
                </div>
              </div>
            ) : (
              <div className="turn__draft-actions">
                {canSend ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Send size={14} />}
                    onClick={() => setConfirming(entry.id)}
                  >
                    Send
                  </Button>
                ) : (
                  /*
                   * Not a disabled button. A control that is
                   * present and refuses teaches nothing; this
                   * says which switch is off and where the
                   * draft went, so the learner can act on
                   * either.
                   */
                  <p className="turn__draft-note">
                    Send Email is off for this agent, so this stays a draft. It
                    is waiting on the Email screen.
                  </p>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === entry.id}
                  icon={<X size={14} />}
                  onClick={async () => {
                    setBusy(entry.id);
                    setError(null);

                    try {
                      await discardDraft(agentId, entry.id);
                      setGone((current) => [...current, entry.id]);
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "That draft could not be discarded."
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Discard
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {error ? <p className="turn__act-error">{error}</p> : null}
    </div>
  );
}

/*
 * The six things an email agent is actually for.
 *
 * WHY A FIXED LIST RATHER THAN THE FLAGSHIP'S `starterPrompts`.
 *
 * Starter prompts are examples: they appear on an empty
 * transcript, they disappear once somebody has typed, and their
 * job is to show what a conversation with this agent looks
 * like. These are different in kind — they stay on screen for
 * the whole session, because "summarise this thread" is not a
 * way to start, it is a thing somebody does eleven times in a
 * morning.
 *
 * The wording is imperative and short, and each one is written
 * to be a COMPLETE request rather than a fragment somebody has
 * to finish. "Triage my inbox" gets an answer; "Triage…" gets a
 * clarifying question, which is a wasted turn charged to a
 * student's allowance.
 *
 * Two of them name no message and no thread on purpose. An
 * agent asked to summarise with nothing selected will ask which
 * one — and that is the right behaviour, because the browser
 * extension that would supply the current message does not
 * exist yet. When it does, it supplies context to the same
 * sentence and nothing here changes.
 */
const EMAIL_WORKFLOWS: Array<{
  label: string;
  icon: typeof Search;
  prompt: string;
  /*
   * Set on the one workflow that cannot be a complete request.
   *
   * "Find the email about…" needs the about. So instead of
   * sending a fragment and spending a turn on the agent asking
   * what, it puts the opening into the composer with the cursor
   * after it — the same click, one fewer round trip, and the
   * learner sees the sentence they are about to send.
   */
  fills?: boolean;
}> = [
  {
    label: "Triage",
    icon: Inbox,
    prompt:
      "Triage my inbox. Sort what is there into what needs a reply from me, what is time-sensitive, what is worth reading, what is bulk, and anything that looks unsafe — and say why for each one.",
  },
  {
    label: "Summarise",
    icon: Sparkles,
    prompt:
      "Summarise my recent unread email. For each one: who it is from, what they want, anything I have to do, and any deadline.",
  },
  {
    label: "Draft a reply",
    icon: PenLine,
    prompt:
      "Find the message I most need to reply to, read it, and draft a reply for me to look at.",
  },
  {
    label: "Find an email",
    icon: Search,
    prompt: "Find the email about ",
    fills: true,
  },
  {
    label: "Follow up",
    icon: Clock,
    prompt:
      "Which conversations am I still owing somebody a reply on? Check what has come in that I have not answered, and tell me what is waiting.",
  },
  {
    label: "Digest",
    icon: ListChecks,
    prompt:
      "Give me a digest of the last few days: what mattered, what I need to do, and anything with a date on it.",
  },
];

function EmailWorkflows({
  onRun,
  onFill,
  disabled,
}: {
  onRun: (prompt: string) => void;
  onFill: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mailbar" role="group" aria-label="Email workflows">
      {EMAIL_WORKFLOWS.map(({ label, icon: Icon, prompt, fills }) => (
        <button
          key={label}
          type="button"
          className="mailbar__act"
          disabled={disabled}
          onClick={() => (fills ? onFill(prompt) : onRun(prompt))}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function Acted({ steps }: { steps: ActionStep[] }) {
  return (
    <div className="turn__acts">
      {steps.map((step) => {
        const arg = primaryArg(step);
        const running = step.result === null;
        const failed = step.result?.ok === false;

        return (
          <div
            className={`turn__act${failed ? " turn__act--failed" : ""}`}
            key={step.step}
          >
            <p className="turn__act-head">
              {step.tool === "run_code" ? (
                <Braces size={12} aria-hidden="true" />
              ) : step.tool === "http_request" ? (
                <Plug size={12} aria-hidden="true" />
              ) : (
                <TriangleAlert size={12} aria-hidden="true" />
              )}

              <span className="turn__act-name">{toolLabel(step.tool)}</span>

              {/*
                A running step says so rather than showing an
                empty result row. A sandbox call is a second or
                two and an API can be ten, and unexplained dead
                air in the middle of an answer reads as a hung
                page.
              */}
              {running ? (
                <span className="turn__act-state">
                  <Loader2 size={11} className="spin" aria-hidden="true" />
                  running…
                </span>
              ) : (
                <span className="turn__act-state">
                  {failed ? (
                    <X size={11} aria-hidden="true" />
                  ) : (
                    <Check size={11} aria-hidden="true" />
                  )}
                  {step.result?.summary}
                </span>
              )}
            </p>

            {arg ? (
              <pre className="turn__act-arg" aria-label={arg.label}>
                <code>{arg.value}</code>
              </pre>
            ) : null}

            {/*
              A failure is shown in full, not summarised. The
              agent was given this sentence and decided what to
              do next from it, so a learner debugging "why did
              it give up" needs to read exactly what it read.
            */}
            {step.result?.error ? (
              <p className="turn__act-error">{step.result.error}</p>
            ) : null}

            {step.result?.truncated ? (
              <p className="turn__act-note">
                The output was longer than the agent was allowed to see, so it
                answered from the first part only.
              </p>
            ) : null}

            {/*
              "Ran out of steps" and "decided it was done"
              produce answers that look the same, and only one
              of them means the task needs breaking up.
            */}
            {step.limit ? (
              <p className="turn__act-note">
                {step.limit.reason === "budget"
                  ? "It gathered as much as this conversation had room for, and answered with that."
                  : "It used all the actions allowed in one turn, and answered with what it had."}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
