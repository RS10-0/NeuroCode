import { useCallback, useEffect, useRef, useState } from "react";

import {
  AiError,
  streamChat,
  type AiChatMessage,
  type AiAnalysedFile,
  type AiDocumentInfo,
  type AiEmailDraftInfo,
  type AiDoneInfo,
  type AiFileAnalysisInfo,
  type AiMemoryInfo,
  type AiMemoryWriteInfo,
  type AiRetrievalInfo,
  type AiStartInfo,
  type AiToolCallInfo,
  type AiToolLimitInfo,
  type AiToolResultInfo,
  type AiWebSearchInfo,
} from "../../lib/aiClient";
import { buildTestRequest } from "./compose";
import { newId, type AgentDraft, type KnowledgeEntry } from "./types";

/*
 * The Test panel's conversation.
 *
 * The one thing worth being precise about: this runs the DRAFT,
 * not the saved row. A learner configures, tests, and only then
 * saves — that is the order the Builder is laid out in — so an
 * agent has to be runnable before it exists in the database. The
 * request is composed here from whatever is on screen, and the
 * agent's id, when it has one, is passed along only so the usage
 * row can say which agent the spend belongs to.
 *
 * Which also means there is nothing agent-shaped on the wire. It
 * is the same POST /api/ai/chat the Lab sends, with a system
 * field this feature happened to assemble.
 *
 * The transcript lives in a ref as well as in state, and the ref
 * is the authority. A send has to read the history synchronously
 * in order to build its request, and a state updater does not
 * run until React next renders — reading the array from inside
 * one would build every request from the turns as they were a
 * render ago, which for the first question means from nothing at
 * all.
 */

export type ChatPhase = "idle" | "streaming" | "error";

/*
 * Marks the last step as the one the loop stopped at.
 *
 * A function rather than an inline ternary because narrowing a
 * `let` does not survive into a closure — TypeScript widens it
 * back to include null inside the map, and the result no longer
 * matches the field it is being assigned to. Taking it as a
 * parameter fixes it at the boundary.
 */
function withLimit(
  steps: ActionStep[],
  limit: AiToolLimitInfo | null
): ActionStep[] {
  if (!limit || steps.length === 0) {
    return steps;
  }

  return steps.map((entry, index) =>
    index === steps.length - 1 ? { ...entry, limit } : entry
  );
}

/*
 * One thing the agent did, as the Test panel shows it.
 *
 * The call and its result are folded into a single row rather
 * than kept as two events, because a step with no result yet is
 * exactly what "running…" means on screen — and merging them
 * afterwards in the component would mean the component owning
 * the pairing rule.
 */
export interface ActionStep {
  step: number;
  /* Null when the agent wrote something that was not a
     readable action, so no tool was ever chosen. */
  tool: AiToolCallInfo["tool"] | null;
  args: Record<string, unknown>;
  /* Null while the tool is still running. */
  result: AiToolResultInfo | null;
  /* Set on the last step only, when the loop stopped because
     it ran out of room rather than because the agent was
     finished. */
  limit?: AiToolLimitInfo;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /*
   * Set on an assistant turn that failed. The turn is kept
   * rather than removed so the question that provoked it stays
   * on screen with its answer — and so Retry has something to
   * retry.
   */
  error: AiError | null;
  /* Telemetry for a finished assistant turn. */
  start: AiStartInfo | null;
  done: AiDoneInfo | null;
  /*
   * What the agent looked up before writing this turn, or null
   * when it did not look anything up.
   *
   * Kept per turn rather than per conversation because that is
   * the point of showing it: asking about photosynthesis and
   * then about the Treaty of Versailles should visibly retrieve
   * different passages, and a single panel showing "the last
   * search" would erase the comparison.
   */
  retrieval: AiRetrievalInfo | null;
  /*
   * Whether this turn went to the web, and what it read there.
   * Null when the capability is off, in which case the server
   * sends no event at all.
   *
   * Per turn, for the same reason retrieval is: the lesson of
   * this capability is that the SAME agent searches for one
   * question and does not for the next, and a single panel
   * showing "the last search" would erase exactly that
   * comparison.
   */
  webSearch: AiWebSearchInfo | null;
  /*
   * What the agent was handed with this turn, or null when
   * nothing was attached.
   *
   * Per turn, and that is the whole point of showing it: an
   * attachment belongs to the question it was asked with, so a
   * transcript where the third question had a spreadsheet and
   * the fourth did not should look like that. A single panel
   * showing "the current attachment" would erase which answer
   * came from what.
   */
  fileAnalysis: AiFileAnalysisInfo | null;
  /*
   * What the agent already knew about the person asking, or
   * null when Memory is off and the server sent no event.
   *
   * Per turn, like the three above, and for a reason specific
   * to this capability: the lesson is that memory ACCUMULATES.
   * A transcript where the first answer knew nothing and the
   * fourth knew three things is the demonstration, and a single
   * panel showing "what it currently remembers" would erase it
   * completely.
   */
  memory: AiMemoryInfo | null;
  /*
   * What it wrote down afterwards.
   *
   * Separate from `memory` above because they answer different
   * questions and arrive at different times — one is "what did
   * it know when it wrote this", which lands before the first
   * token, and the other is "what did it learn from this",
   * which lands after the last.
   *
   * Null is not the same as "nothing was written": the server
   * reports nothing-written with a reason, and this stays null
   * only when the write was still running when the stream
   * closed. The memory is stored either way.
   */
  memoryWrite: AiMemoryWriteInfo | null;
  /*
   * What the agent DID before it answered, in order.
   *
   * An array rather than a single value, unlike every other
   * field here, because this is the one capability that is a
   * loop: an agent can fetch, compute, and fetch again inside
   * one turn, and the sequence is the thing worth seeing. A
   * "last action" field would show the final step and hide the
   * reasoning that led to it.
   *
   * Per turn for the same reason retrieval and search are: the
   * lesson is that the SAME agent acts on one question and
   * answers the next straight off, and a single panel would
   * erase that comparison.
   */
  actions: ActionStep[];
  /*
   * The files this turn produced, if any.
   *
   * Kept alongside `actions` rather than inside a step,
   * because a document is not a step's summary line — it is a
   * thing that now exists and can be downloaded, and it stays
   * on the turn after the step list is collapsed.
   *
   * Populated from the runtime's `document` event and from
   * nothing else. That is what makes the download button
   * honest: an agent that writes "I have attached the report"
   * without making one produces no button beside its own
   * sentence.
   */
  documents: AiDocumentInfo[];
  /*
   * The replies this turn drafted, if any.
   *
   * Alongside `documents` and for the same reason, doing the
   * same job with more riding on it: a draft is a thing that
   * now exists and that somebody has to decide about, and it
   * stays on the turn after the step list is collapsed.
   *
   * Populated from the runtime's `email_draft` event and from
   * nothing else, which is what makes the card honest in both
   * directions. An agent that says it replied to somebody and
   * drafted nothing produces no card. An agent that says it
   * SENT a reply produces a card that says Draft, with a Send
   * button still on it, directly under its own sentence.
   */
  drafts: AiEmailDraftInfo[];
  /*
   * What the learner attached, for the user turn.
   *
   * Kept separately from the server's own report above because
   * they answer different questions: this is "what did I send",
   * which belongs on the question, and that is "what did the
   * agent actually read", which belongs on the answer.
   */
  attachments: TurnAttachment[];
}

/* One file on a user turn, as it is shown back in the log. */
export interface TurnAttachment {
  /* The server's own id for the upload, which is what a retry
     re-sends — see `retry` below. */
  id: string;
  name: string;
  kind: AiAnalysedFile["kind"];
}

export interface AgentChatState {
  turns: ChatTurn[];
  phase: ChatPhase;
  /* The id of the assistant turn currently being written. */
  streamingId: string | null;
}

export interface ChatConfig {
  draft: AgentDraft;
  knowledge: KnowledgeEntry[];
  budget: number;
  agentId: string | null;
  /*
   * The uploads this message carries: ids for the request, and
   * enough about each to show it back in the transcript.
   *
   * On the config rather than passed to `send` separately
   * because it is part of what the next message IS, like the
   * draft and the knowledge — and because `retry` rebuilds a
   * request from the config alone.
   */
  attachments: TurnAttachment[];
  attachmentIds: string[];
}

interface UseAgentChatOptions {
  /* Called after every completed send, successful or not, so the
     page can move the usage meters. Meters that lag a run read
     as broken. */
  onSettled?: () => void;
}

/*
 * The turns that go on the wire.
 *
 * Three of the server's structural rules are satisfied here
 * rather than discovered as a 400: a turn that failed carries no
 * usable content and is dropped, system instructions never
 * appear as a message because they travel in their own field,
 * and the array therefore always ends on the user turn being
 * answered.
 */
function toMessages(turns: ChatTurn[]): AiChatMessage[] {
  return turns
    .filter((turn) => !turn.error && turn.content.trim().length > 0)
    .map((turn) => ({ role: turn.role, content: turn.content }));
}

export function useAgentChat({ onSettled }: UseAgentChatOptions = {}) {
  const [state, setState] = useState<AgentChatState>({
    turns: [],
    phase: "idle",
    streamingId: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  /* The authority for the transcript. See the header note. */
  const turnsRef = useRef<ChatTurn[]>([]);

  const settledRef = useRef(onSettled);

  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  /* A stream in flight when the page goes away is a stream
     nobody will read. Aborting closes the socket, which the
     server turns into an aborted provider request — so leaving
     actually stops the spend. */
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  /* Writes the ref and the state together, so the two can never
     describe different conversations. */
  const commit = useCallback(
    (turns: ChatTurn[], phase: ChatPhase, streamingId: string | null) => {
      turnsRef.current = turns;
      setState({ turns, phase, streamingId });
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    commit([], "idle", null);
  }, [commit]);

  const send = useCallback(
    async (prompt: string, config: ChatConfig) => {
      const question = prompt.trim();

      if (!question) {
        return;
      }

      /* A second send while one is in flight replaces it rather
         than racing it. */
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      const userTurn: ChatTurn = {
        id: newId(),
        role: "user",
        content: question,
        error: null,
        start: null,
        done: null,
        retrieval: null,
        webSearch: null,
        fileAnalysis: null,
        memory: null,
        memoryWrite: null,
        actions: [],
        documents: [],
        drafts: [],
        attachments: config.attachments,
      };

      const answerId = newId();

      /* Everything up to and including the new question is what
         the model is asked to answer. */
      const asked = [...turnsRef.current, userTurn];
      const messages = toMessages(asked);

      commit(
        [
          ...asked,
          {
            id: answerId,
            role: "assistant",
            content: "",
            error: null,
            start: null,
            done: null,
            retrieval: null,
            webSearch: null,
            fileAnalysis: null,
            memory: null,
            memoryWrite: null,
            actions: [],
            documents: [],
            drafts: [],
            attachments: [],
          },
        ],
        "streaming",
        answerId
      );

      /*
       * The answer so far, kept outside the ref-and-state pair
       * because it changes on every delta and rebuilding the
       * whole transcript array to append a character would be a
       * lot of garbage for no benefit.
       */
      let output = "";
      let start: AiStartInfo | null = null;
      let done: AiDoneInfo | null = null;
      let retrieval: AiRetrievalInfo | null = null;
      let webSearch: AiWebSearchInfo | null = null;
      let fileAnalysis: AiFileAnalysisInfo | null = null;
      let memory: AiMemoryInfo | null = null;
      let memoryWrite: AiMemoryWriteInfo | null = null;
      /*
       * Rebuilt rather than mutated on every event, because
       * patchAnswer spreads into a new turn object and a shared
       * array would make the old and new turns the same array —
       * which reads as "the trace was always complete" when
       * React re-renders an earlier frame.
       */
      let actions: ActionStep[] = [];
      /* A fresh array per turn, for the reason the note above
         gives about `actions`: a shared one would make an
         earlier frame re-render with a later turn's files. */
      let documents: AiDocumentInfo[] = [];
      /* Same reasoning again: per turn, never shared. */
      let drafts: AiEmailDraftInfo[] = [];
      let limit: AiToolLimitInfo | null = null;
      let failure: AiError | null = null;

      const patchAnswer = (patch: Partial<ChatTurn>) => {
        commit(
          turnsRef.current.map((turn) =>
            turn.id === answerId ? { ...turn, ...patch } : turn
          ),
          "streaming",
          answerId
        );
      };

      try {
        await streamChat(
          buildTestRequest({
            draft: config.draft,
            knowledge: config.knowledge,
            budget: config.budget,
            messages,
            agentId: config.agentId,
            attachments: config.attachmentIds,
          }),
          {
            onStart: (info) => {
              start = info;
              patchAnswer({ start: info });
            },

            /* Arrives before the first token, so the sources are
               on screen while the answer is still being written
               — which is the order that makes the connection
               between them obvious. */
            onRetrieval: (info) => {
              retrieval = info;
              patchAnswer({ retrieval: info });
            },

            /* Also before the first token, so a learner watches
               the agent go and look before they watch it
               write. */
            onWebSearch: (info) => {
              webSearch = info;
              patchAnswer({ webSearch: info });
            },

            /* Also before the first token, so a learner sees
               that the file arrived before they see anything
               written about it. */
            onFileAnalysis: (info) => {
              fileAnalysis = info;
              patchAnswer({ fileAnalysis: info });
            },

            /* Also before the first token, so a learner sees
               what the agent already knew about them before
               they see what it did with that. */
            onMemory: (info) => {
              memory = info;
              patchAnswer({ memory: info });
            },

            /*
             * Between deltas rather than before them, unlike
             * every handler above. An agent can answer half a
             * sentence, decide it needs a number, go and get
             * it, and carry on — and the panel should show that
             * in the order it happened.
             */
            onToolCall: (info: AiToolCallInfo) => {
              actions = [
                ...actions,
                {
                  step: info.step,
                  tool: info.tool,
                  args: info.args,
                  result: null,
                },
              ];
              patchAnswer({ actions });
            },

            onToolResult: (info: AiToolResultInfo) => {
              const matched = actions.some((entry) => entry.step === info.step);

              actions = matched
                ? actions.map((entry) =>
                    entry.step === info.step
                      ? { ...entry, result: info }
                      : entry
                  )
                : /* A result with no call before it. The server
                     sends one for an action it could not read,
                     which never became a call — showing it as a
                     failed step is more honest than dropping
                     it. */
                  [
                    ...actions,
                    {
                      step: info.step,
                      tool: info.tool ?? null,
                      args: {},
                      result: info,
                    },
                  ];

              patchAnswer({ actions });
            },

            onToolLimit: (info: AiToolLimitInfo) => {
              limit = info;
            },

            /*
             * Applied immediately rather than at the end, like
             * the tool handlers above it and unlike the
             * telemetry ones.
             *
             * A file arrives mid-turn, often several seconds
             * before the answer that describes it, and the
             * download button appearing at that moment is the
             * clearest possible evidence that the agent really
             * made something. Holding it back until `done`
             * would show the claim before the proof.
             */
            onDocument: (info: AiDocumentInfo) => {
              documents = [...documents, info];
              patchAnswer({ documents });
            },

            /*
             * A drafted reply, shown the moment it exists and
             * before the sentence describing it.
             *
             * The same argument the document handler above
             * makes, pointed at the one action in this product
             * with a consequence outside the account: the card
             * appearing is the proof, and it arrives before the
             * claim rather than after it.
             */
            onEmailDraft: (info: AiEmailDraftInfo) => {
              drafts = [...drafts, info];
              patchAnswer({ drafts });
            },

            onDelta: (text) => {
              output += text;
              patchAnswer({ content: output });
            },

            onDone: (info) => {
              done = info;
            },

            /*
             * After the answer, which is the only honest place
             * for it: what a turn was worth remembering is not
             * decided until the turn has happened.
             *
             * Patched straight onto the turn rather than held
             * for the commit below, because the commit runs
             * after `streamChat` resolves and this can arrive a
             * moment earlier — showing it as soon as it lands
             * is what makes the chip feel like the agent
             * thinking rather than a delayed render.
             */
            onMemoryWrite: (info) => {
              memoryWrite = info;
              patchAnswer({ memoryWrite: info });
            },
          },
          controller.signal
        );
      } catch (error) {
        failure =
          error instanceof AiError
            ? error
            : new AiError("internal_error", String(error));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }

      /*
       * A stop is an outcome, not a fault. The learner asked for
       * it and the partial answer on screen is genuine, so it is
       * kept as an ordinary assistant turn — colouring it as an
       * error would say something broke when nothing did.
       */
      const stopped = failure?.code === "cancelled";

      commit(
        turnsRef.current.map((turn) =>
          turn.id === answerId
            ? {
                ...turn,
                content: output,
                start,
                done,
                retrieval,
                webSearch,
                fileAnalysis,
                memory,
                memoryWrite,
                /*
                 * The limit, if one was hit, is folded onto the
                 * last step rather than carried as its own
                 * field. "It ran out of room after this one" is
                 * a fact about where the trace stops, and it
                 * reads best at the bottom of the trace.
                 */
                actions: withLimit(actions, limit),
                error: stopped ? null : failure,
              }
            : turn
        ),
        !stopped && failure ? "error" : "idle",
        null
      );

      settledRef.current?.();
    },
    [commit]
  );

  /*
   * Drops the failed answer and asks the same question again.
   *
   * Rebuilt from the last user turn rather than from a stored
   * copy of the request, so a retry uses the configuration as it
   * is NOW — which is the point, since the usual reason to press
   * it is that the learner has just changed something.
   */
  const retry = useCallback(
    async (config: ChatConfig) => {
      const turns = turnsRef.current;

      let index = -1;

      for (let i = turns.length - 1; i >= 0; i -= 1) {
        if (turns[i].role === "user") {
          index = i;
          break;
        }
      }

      if (index === -1) {
        return;
      }

      const question = turns[index].content;

      /*
       * The files that question was asked with, not the ones in
       * the composer now.
       *
       * The composer is cleared on send, so a retry that took
       * its attachments from the current config would quietly
       * re-ask about nothing — and the commonest reason to press
       * Retry is a rate limit, where the question and its
       * spreadsheet were both perfectly fine. The ids still
       * resolve: the server holds an upload for far longer than
       * anybody waits before retrying.
       */
      const attachments = turns[index].attachments;

      /* Everything from that question onwards goes; `send` puts
         the question back. */
      commit(turns.slice(0, index), "idle", null);

      await send(question, {
        ...config,
        attachments,
        attachmentIds: attachments.map((entry) => entry.id),
      });
    },
    [commit, send]
  );

  return { state, send, stop, clear, retry };
}
