import { attachFiles, NO_FILES, type AttachOutcome } from "../agents/files/attach";
import {
  renderPageContext,
  type CapturedPage,
} from "../agents/extension/pageContext";
import { retrieveKnowledge } from "../agents/knowledge/retrieve";
import { recallMemory, type RecallOutcome } from "../agents/memory/recall";
import type { MemoryScope } from "../agents/memory/scope";
import {
  writeMemories,
  type MemoryWriteOutcome,
} from "../agents/memory/write";
import {
  runAgentWebSearch,
  type AgentWebSearchOutcome,
} from "../agents/websearch/search";
import { actionSource, runTool } from "../agents/actions/ActionRuntime";
import { renderActionContext } from "../agents/actions/context";
import { newTurnBudget, toolsFor } from "../agents/actions/catalog";
import { listConnections } from "../agents/actions/http/ConnectionStore";
import {
  ActionScanner,
  newSentinel,
  renderFailure,
  renderResult,
  renderStepLimit,
  renderUnreadable,
  type ActionSentinel,
} from "../agents/actions/protocol";
import type { FileScope } from "../files/FileStore";
import { FILE_ACCEPT } from "../files/sniff";
import {
  actions as actionConfig,
  fileAnalysis,
  firstTokenTimeoutMs,
  memory as memoryConfig,
  memoryLimitsFor,
  platformBudget,
  requestLimits,
  requestTimeoutMs,
  retrieval,
  searchLimitsFor,
} from "./config";
import { AiRuntimeError, normalizeError } from "./errors";
import { findModel } from "./models";
import { settle as settleProvider } from "./ProviderHealth";
import { registerProviders } from "./providers";
import { refund, spend } from "../credits/CreditStore";
import { costOf, SURCHARGES } from "../credits/costs";
import { resolvePowerSource } from "./resolveChain";
import { streamFromChain } from "./streamFromChain";
import { admit, type DeploymentAdmission } from "./QuotaGuard";
import {
  countInputChars,
  estimateInputTokens,
  estimateTokensFromChars,
  resolveUsage,
} from "./tokens";
import { finish } from "./UsageRecorder";
import { buildModelRequest, type ParsedChatBody } from "./validation";
import type {
  ActionCapabilityFlags,
  ActionLimitReason,
  ChainCandidate,
  ChatMessage,
  FinishReason,
  ModelDescriptor,
  QuotaLimits,
  ResolvedPowerSource,
  RetrievalReason,
  RetrievedSource,
  RuntimeStreamEvent,
  TokenUsage,
} from "./types";

/*
 * The single entry point for every model call BuildGentic makes.
 *
 * The Lab calls this. The Agent Builder will call this. The
 * public agent endpoint and Vibe Coding will call this. None of
 * them holds a key, chooses a provider, counts a quota or writes
 * a usage row, because all of that happens once, here.
 *
 * The order below is the whole design and it is not arbitrary:
 *
 *   resolve who is paying
 *   → resolve and authorise the model
 *   → validate and size the request
 *   → take a quota slot
 *   → stream from the provider
 *   → always close the usage row
 *
 * Everything that can be refused for free is refused before the
 * quota slot is taken, and the quota slot is taken before a
 * single byte goes to a provider.
 */

export interface RuntimeChatOptions {
  userId: string;
  body: ParsedChatBody;
  /* Aborted when the client disconnects, or the caller stops. */
  signal?: AbortSignal;
  /*
   * Set only by the deployed-agent endpoint, which is the one
   * caller that is not the account holder.
   *
   * It belongs here rather than on `body` because it is a fact
   * about who is calling, not about what they asked for — and
   * because `body` is the shape a browser's JSON is parsed into,
   * where a caller-supplied deployment id would be a claim
   * rather than a resolution.
   *
   * Adds the deployment's own windows to the admission below.
   * It does not replace anything: `userId` above is still the
   * owner, so the owner's quota and BuildGentic's platform budget
   * bind a deployed request exactly as they bind a Lab one.
   */
  deployment?: DeploymentAdmission;
  /*
   * Which windows this call is counted in, when it is not the
   * learner's ordinary chat allowance.
   *
   * Set by exactly one caller: the web-search decision below,
   * which is a model call this server decided to make on the
   * way to answering another one. A search-backed turn is three
   * calls, and charging all three to the window a learner uses
   * for the Lab would cut what they can do to a third the
   * moment they switch the capability on.
   *
   * It is a scope, not an exemption. The same atomic SQL gate,
   * the same platform budget, the same usage row — a different
   * key to count them under. Exactly what EmbeddingRuntime does
   * with `embed:`, and it lives here rather than there because
   * the decision call goes through this function and must not
   * become a second copy of it.
   */
  quotaScope?: QuotaScope;
  /*
   * Which attachments this caller may reach.
   *
   * Set by the two routes that can accept an upload, and it is
   * the whole of File Analysis's authorisation model. A learner
   * testing in the Builder gets their own scope; a deployed
   * caller gets the deployment's, which is not the owner's — so
   * an owner cannot read a caller's document out of their own
   * Builder, and a caller cannot reach anything the owner
   * attached.
   *
   * It belongs here rather than on `body` for the same reason
   * `deployment` does: it is a fact about who is calling, not
   * about what they asked for, and `body` is the shape a
   * browser's JSON is parsed into — where a caller-supplied
   * scope would be a claim rather than a resolution.
   *
   * Absent means no attachment resolves, whatever ids the body
   * carries. That is the correct default for the one caller
   * that never sets it: the web-search decision call below,
   * which is this server talking to itself.
   */
  fileScope?: FileScope;
  /*
   * The web page the learner was looking at when they asked.
   *
   * Set by exactly one caller — routes/extension.ts — and only
   * after two independent permissions have been resolved: the
   * per-agent switch its owner set, and whether this ACCOUNT
   * may have pages read from it at all. See
   * agents/extension/AccountScope.ts for the second, which is
   * the age and consent-scope gate.
   *
   * It belongs here rather than on `body` for the reason
   * `fileScope` and `deployment` do, and the reason bites
   * hardest on this one: `body` is the shape a client's JSON is
   * parsed into, and this is the field where a claim would be
   * most valuable to forge. By the time it is a
   * `CapturedPage` it has been through parsePageContext —
   * bounded, flattened, query-stripped — and the permission
   * questions have already been answered somewhere the client
   * cannot reach.
   *
   * Absent means no page reaches the prompt, whatever the body
   * carried. That is the correct default for every caller but
   * one.
   */
  pageContext?: CapturedPage;
  /*
   * Whose memory this call may read and add to.
   *
   * Set by the two routes that answer as an agent, and it is
   * the whole of Memory's authorisation model. It belongs here
   * rather than on `body` for the same reason `deployment` and
   * `fileScope` do: it is a fact about who is calling, resolved
   * from a session or from a verified deployment row, and
   * `body` is the shape a browser's JSON is parsed into — where
   * a caller-supplied scope would be a claim rather than a
   * resolution.
   *
   * It carries the agent id as well as the person, because
   * BuildGentic's memory is `User -> Agent -> Memories` and never
   * `User -> Memories`. A learner's Maths Tutor and their Essay
   * Coach hold entirely separate stores, and this is the type
   * that makes mixing them impossible rather than merely
   * unlikely — there is no way to name a memory without naming
   * the agent it belongs to. See agents/memory/scope.ts.
   *
   * Absent means the turn neither recalls nor records, whatever
   * `body.memory` says. That is the correct default for the two
   * callers that never set it: the Lab, which is not an agent,
   * and the web-search decision call below, which is this
   * server talking to itself.
   */
  memoryScope?: MemoryScope;
  /*
   * Recall from the scope above, but never add to it.
   *
   * Set by exactly one caller: the scheduled runner. It is not
   * an optimisation and it is not about cost — a write is
   * already free — it is about what a memory MEANS.
   *
   * A memory is an inference about a person drawn from a
   * conversation with them. A scheduled run is not a
   * conversation: it is the same sentence the owner typed once,
   * four times a day, for as long as the schedule lives. So
   * everything a run could learn from it, it learned on the
   * first run — and leaving writes on would fill the store with
   * one fact restated a thousand times, crowding out the things
   * the owner actually said while building the agent.
   *
   * Recall stays on, because the agent knowing its owner is the
   * entire value of the capability and a scheduled run is still
   * that owner's agent acting on their behalf.
   */
  memoryReadOnly?: boolean;
  /*
   * The run row a document produced by this turn belongs to.
   *
   * Set by the scheduler — for both a scheduled run and a
   * manual preview — and by nobody else. A Test panel turn, a
   * deployment and a page have no run row, and a document they
   * produced simply carries a null.
   *
   * It belongs here rather than on `body` for the reason
   * `deployment` does: `body` is the shape a browser's JSON is
   * parsed into, and a caller-supplied run id would be a claim
   * rather than a resolution. It is what lets the mail outbox
   * find a notification's attachments without the notification
   * carrying a document column.
   */
  documentRunId?: string;
}

export interface QuotaScope {
  /* Prefixed onto the power source's own quota key. */
  prefix: string;
  limits: QuotaLimits;
}

function scoped(
  source: ResolvedPowerSource,
  scope?: QuotaScope
): ResolvedPowerSource {
  if (!scope) {
    return source;
  }

  return {
    ...source,
    quotaKey: `${scope.prefix}:${source.quotaKey}`,
    limits: scope.limits,
  };
}

/*
 * Picks the model, and refuses anything the caller is not
 * entitled to.
 *
 * A client-supplied id is never forwarded to a provider on
 * trust. It has to be in the catalogue, and it has to be one
 * this power source may reach — which is both an entitlement
 * check and a cost control, since the platform catalogue is
 * deliberately cheaper than the BYOK one.
 */
function resolveModel(
  requested: string | undefined,
  source: ResolvedPowerSource
): ModelDescriptor {
  if (!requested) {
    const fallback = findModel(source.defaultModel);

    if (!fallback) {
      throw new AiRuntimeError(
        "internal_error",
        "No AI model is configured. Please try again later.",
        {
          internalDetail: `Default model "${source.defaultModel}" is not in the catalogue.`,
        }
      );
    }

    return fallback;
  }

  const model = findModel(requested);
  const available = source.allowedModels.map((entry) => entry.id).join(", ");

  if (!model) {
    throw new AiRuntimeError(
      "model_not_allowed",
      `"${requested}" is not a model BuildGentic offers. Available: ${available}.`
    );
  }

  if (!source.allowedModels.some((entry) => entry.id === model.id)) {
    /*
     * Catalogued but not reachable, which after the collapse to
     * a single public identity is close to unreachable itself.
     * Kept because the catalogue is still the allowlist, and an
     * allowlist with no refusal branch is not one.
     */
    throw new AiRuntimeError(
      "model_not_allowed",
      `That is not a model BuildGentic offers. Available: ${available}.`
    );
  }

  return model;
}

/*
 * Runs the lookup, when this call is an agent that has one.
 *
 * Null when it is not — an ordinary Lab prompt does no work
 * here at all, and emits no `retrieval` event, so nothing about
 * the Lab changed when this capability landed.
 *
 * The query is the last user turn and only the last user turn.
 * Folding the whole conversation in sounds more thorough and is
 * measurably worse: a ten-turn chat about chemistry embeds to
 * "chemistry" no matter what the eleventh question asks, and
 * the agent keeps retrieving what it was talking about instead
 * of what it was just asked.
 */
async function retrieveContext(options: RuntimeChatOptions): Promise<{
  text: string;
  sources: RetrievedSource[];
  reason?: RetrievalReason;
} | null> {
  if (!options.body.knowledgeRetrieval || !options.body.agentId) {
    return null;
  }

  const lastUser = [...options.body.messages]
    .reverse()
    .find((message) => message.role === "user");

  const outcome = await retrieveKnowledge({
    userId: options.userId,
    agentId: options.body.agentId,
    query: lastUser?.content ?? "",
    signal: options.signal,
  });

  /*
   * The one thing that could make a retrieved block dangerous
   * rather than merely useless: a prompt so large the model
   * truncates it and drops the instructions at the top.
   *
   * The arithmetic says it cannot happen — a client system
   * prompt is capped at maxSystemChars, a rendered block at
   * retrieval.contextChars plus its preamble — so this is a
   * belt-and-braces check on the sum rather than a limit
   * anybody is expected to reach. If it ever does, the context
   * is dropped and the agent answers without it, which is the
   * same degradation every other failure here produces.
   */
  const ceiling =
    requestLimits.maxSystemChars > 0
      ? requestLimits.maxSystemChars + retrieval.contextChars + 2_000
      : 0;

  const total = (options.body.system?.length ?? 0) + outcome.text.length;

  if (outcome.text && ceiling > 0 && total > ceiling) {
    console.error(
      `[retrieval] agent ${options.body.agentId}: composed system would be ${total} chars, over the ${ceiling} ceiling; answering without retrieved context.`
    );

    return { text: "", sources: [], reason: "unavailable" };
  }

  return outcome;
}

/*
 * Reads what this agent already knows about the person it is
 * talking to, when it is allowed to.
 *
 * Null when it is not — an ordinary Lab prompt does no work
 * here at all and emits no `memory` event, so nothing about the
 * Lab changed when this capability landed.
 *
 * Two distinct off-states, and reporting them separately
 * matters. `memory: false` is the capability switched off and
 * produces no event, like the other three. A scope that is
 * absent while the flag is on is something else entirely: it
 * means an unsaved draft, because memories hang off an agent
 * and a draft has no id to hang them on. Reporting that as
 * `no_agent` rather than as silence is what stops a learner
 * concluding the switch is broken — "save this agent first" is
 * a state they can fix in one click.
 *
 * Like retrieval, it never throws. See recall.ts.
 */
async function recallContext(
  options: RuntimeChatOptions
): Promise<RecallOutcome | null> {
  if (!options.body.memory) {
    return null;
  }

  if (!options.memoryScope) {
    return { text: "", memories: [], chars: 0, held: 0, reason: "no_agent" };
  }

  const lastUser = [...options.body.messages]
    .reverse()
    .find((message) => message.role === "user");

  return recallMemory({
    scope: options.memoryScope,
    query: lastUser?.content ?? "",
    signal: options.signal,
  });
}

/*
 * Runs the web lookup, when this call is an agent that has one.
 *
 * Null when it is not — an ordinary Lab prompt does no work
 * here at all and emits no `web_search` event, so nothing about
 * the Lab changed when this capability landed.
 *
 * The decision call goes back through `runChat`, and that is
 * the whole design rather than a shortcut. The alternative was
 * a second path to a provider, with its own credential lookup,
 * its own timeout handling and its own usage row — which is
 * precisely the drift this runtime exists to prevent. Going
 * round again means the decision is admitted by the same gate,
 * timed by the same timers, recorded in the same table and
 * refused by the same rules as the answer it precedes.
 *
 * Recursion is bounded structurally: the body below sets
 * `webSearch: false` and `knowledgeRetrieval: false`, so the
 * inner call cannot reach this function again. It is not a
 * depth counter that somebody has to remember to increment.
 *
 * It never throws — see websearch/search.ts. A failed lookup
 * produces an empty result and a reason, and the answer happens
 * anyway.
 */
async function searchWeb(
  options: RuntimeChatOptions,
  source: ResolvedPowerSource,
  model: ModelDescriptor
): Promise<AgentWebSearchOutcome | null> {
  if (!options.body.webSearch) {
    return null;
  }

  return runAgentWebSearch({
    userId: options.userId,
    agentId: options.body.agentId,
    /* What the agent is for, so the decision is made in its
       terms rather than in the abstract. */
    instructions: options.body.system,
    messages: options.body.messages,
    signal: options.signal,

    ask: async ({ system, messages, maxOutputTokens, temperature }) => {
      let text = "";

      for await (const event of runChat({
        userId: options.userId,
        signal: options.signal,
        quotaScope: {
          prefix: "search",
          limits: searchLimitsFor(),
        },
        body: {
          /* The agent's own model, so the decision is made by
             the thing that will have to answer — and so a BYOK
             agent decides on its owner's key, not BuildGentic's. */
          model: model.id,
                system,
          messages,
          settings: { temperature, maxOutputTokens },
          feature: "agent_web_search",
          agentId: options.body.agentId,
          knowledgeRetrieval: false,
          webSearch: false,
          /*
           * And no attachments either. The decision call is
           * asking "does this question need the live web?",
           * which is answerable from the question — re-sending
           * a spreadsheet to decide whether to search would
           * pay for the whole document twice and change nothing
           * about the answer.
           *
           * This is also what makes the recursion bounded
           * structurally rather than by a depth counter: with
           * all three capability flags off, the inner call
           * cannot reach any of the three branches again.
           */
          fileAnalysis: false,
          /*
           * And it does not remember either. The decision call
           * is asking "does this question need the live web?",
           * which is answerable from the question — and a
           * server talking to itself about search strategy is
           * not a conversation anybody should have facts
           * extracted from.
           */
          memory: false,
          /*
           * Both action flags off, and this is now the load-
           * bearing half of the bounding argument rather than a
           * formality.
           *
           * With every capability flag false, an inner call
           * cannot reach any capability branch — which used to
           * make the recursion bounded by its own shape, with
           * no counter anywhere. Actions break that symmetry:
           * the outer loop is bounded by a real step counter
           * because a tool result feeds a call that may want
           * another tool. These two lines are what keep the
           * INNER calls out of that entirely, so a decision
           * call can never itself start acting.
           */
          codeExecution: false,
          httpActions: false,
          documentGeneration: false,
          dataStore: false,
          emailRead: false,
          emailDraft: false,
          emailOrganize: false,
          attachments: [],
          stream: false,
        },
      })) {
        if (event.type === "delta") {
          text += event.text;
        }
      }

      return text;
    },
  });
}

/*
 * Writes down anything in this turn worth remembering, when the
 * agent is allowed to.
 *
 * Null when it is not, and — unlike the three lookups above —
 * this one is STARTED rather than awaited. It runs alongside
 * the provider stream and is collected after `done`, for a
 * reason worth stating: extraction reads what the person said,
 * not what the agent replied, so there is nothing to wait for.
 * Running it in sequence after the answer would add a whole
 * round trip to the end of every turn in exchange for nothing.
 *
 * Started after `admit` rather than before it, so a turn that
 * was refused for quota writes nothing. A refused turn is one
 * that never happened, and it should not be able to change what
 * an agent believes about somebody.
 *
 * It never throws — see write.ts. The promise it returns always
 * resolves, so the `void` handling below cannot produce an
 * unhandled rejection.
 */
function startMemoryWrite(
  options: RuntimeChatOptions,
  source: ResolvedPowerSource,
  model: ModelDescriptor,
  recalled: RecallOutcome | null
): Promise<MemoryWriteOutcome> | null {
  if (!options.body.memory) {
    return null;
  }

  /*
   * A read-only turn recalls and records nothing. Reported as a
   * reason rather than as silence, so the Test panel and the run
   * row can both say WHY nothing was written — an owner looking
   * at a scheduled run that remembered nothing should find an
   * answer rather than an absence.
   */
  if (options.memoryReadOnly) {
    return Promise.resolve({ written: [], reason: "off" });
  }

  if (!options.memoryScope) {
    return Promise.resolve({ written: [], reason: "no_agent" });
  }

  const scope = options.memoryScope;

  return writeMemories({
    scope,
    /*
     * The agent's OWN instructions, off the body as the caller
     * sent them — never `fitted.system`, which by now has the
     * retrieved knowledge, the web results, the file text and
     * the memory block itself appended to it.
     *
     * This is the line that makes "a document cannot get itself
     * memorised" true. The extractor is given the conversation
     * and the owner's brief, and is never shown the material
     * the agent read, so there is no text in the room for an
     * injected paragraph to speak from. See extract.ts.
     */
    instructions: options.body.system,
    messages: options.body.messages,
    known: recalled?.memories ?? [],
    sourceFeature:
      options.body.feature === "agent_public" ? "agent_public" : "agent_test",
    model: model.id,
    signal: options.signal,

    ask: async ({ system, messages, maxOutputTokens, temperature }) => {
      let text = "";

      for await (const event of runChat({
        userId: options.userId,
        signal: options.signal,
        quotaScope: {
          prefix: "memory",
          limits: memoryLimitsFor(),
        },
        body: {
          /* The agent's own model, so a BYOK agent extracts on
             its owner's key rather than BuildGentic's — the same
             reasoning the search decision follows. */
          model: model.id,
                system,
          messages,
          settings: { temperature, maxOutputTokens },
          feature: "agent_memory",
          agentId: scope.agentId,
          /*
           * Every capability off, which is what bounds the
           * recursion structurally rather than with a depth
           * counter: with all four false the inner call cannot
           * reach this function, the search, the retrieval or
           * the file reader again.
           */
          knowledgeRetrieval: false,
          webSearch: false,
          fileAnalysis: false,
          memory: false,
          /*
           * Both action flags off, and this is now the load-
           * bearing half of the bounding argument rather than a
           * formality.
           *
           * With every capability flag false, an inner call
           * cannot reach any capability branch — which used to
           * make the recursion bounded by its own shape, with
           * no counter anywhere. Actions break that symmetry:
           * the outer loop is bounded by a real step counter
           * because a tool result feeds a call that may want
           * another tool. These two lines are what keep the
           * INNER calls out of that entirely, so a decision
           * call can never itself start acting.
           */
          codeExecution: false,
          httpActions: false,
          documentGeneration: false,
          dataStore: false,
          emailRead: false,
          emailDraft: false,
          emailOrganize: false,
          attachments: [],
          stream: false,
        },
      })) {
        if (event.type === "delta") {
          text += event.text;
        }
      }

      return text;
    },
  });
}

/*
 * Reads the files attached to this message, when the agent is
 * allowed to.
 *
 * Null when it is not — an ordinary Lab prompt does no work here
 * at all and emits no `file_analysis` event, so nothing about
 * the Lab changed when this capability landed.
 *
 * Unlike the two lookups above, this one THROWS, and the
 * asymmetry is the point. A failed search or a failed retrieval
 * degrades into an answer without them, because most questions
 * do not need either. An attachment is different: somebody
 * attached a document and asked about it, so an answer produced
 * without the document is not a worse answer to the same
 * question but a confident answer to a different one. Every
 * failure is therefore a refusal naming the cause — expired,
 * too many, model cannot see images, did not fit — all of which
 * the person can act on.
 *
 * Before `buildModelRequest`, so the file text is inside the
 * input the size limit is enforced against. Before `admit`, so
 * it is inside the token estimate the quota is charged for.
 * Doing it afterwards would make attached files the one part of
 * a prompt that nothing measures.
 */
function analyseAttachments(
  options: RuntimeChatOptions,
  model: ModelDescriptor
): AttachOutcome | null {
  const { attachments, fileAnalysis: allowed } = options.body;

  if (!allowed) {
    /*
     * The capability is off. Attachments sent anyway are
     * ignored rather than read, and the caller is told which
     * happened — a switch that leaves the behaviour unchanged
     * is worse than no switch, and silence here would look
     * exactly like that.
     */
    return attachments.length > 0 ? { ...NO_FILES, reason: "off" } : null;
  }

  if (!options.fileScope) {
    /*
     * The capability is on and this caller has no scope, so no
     * id could resolve. Reachable only from a caller that never
     * accepts uploads, which today is the web-search decision
     * call — and that one sends no attachments either.
     */
    return attachments.length > 0
      ? { ...NO_FILES, reason: "unavailable" }
      : null;
  }

  return attachFiles({
    scope: options.fileScope,
    attachments,
    model,
  });
}

/*
 * Puts the images on the turn they were attached to.
 *
 * The last user turn, and only that one. An image belongs to the
 * question asked with it; carrying it forward onto every
 * subsequent turn would re-send the same photograph — and
 * re-charge for it — on every follow-up, which providers bill
 * for and nobody asked for.
 */
function withImages(
  messages: ChatMessage[],
  images: AttachOutcome["images"]
): ChatMessage[] {
  if (images.length === 0) {
    return messages;
  }

  const last = messages.length - 1;

  return messages.map((message, index) =>
    index === last ? { ...message, images } : message
  );
}

/* =========================================================
   ACTIONS

   The one capability that is a loop rather than a lookup, and
   therefore the one that cannot be resolved before the turn
   starts. Everything below is only the SETUP: which tools this
   turn may use, what they are called, and the per-turn nonce
   the whole exchange is fenced with. The loop itself lives in
   runChat, because it wraps the cascade.
========================================================= */

interface ActionPlan {
  sentinel: ActionSentinel;
  flags: ActionCapabilityFlags;
  /* Appended to the system prompt. Held separately as well as
     folded in, because the closing pass rebuilds the prompt
     WITHOUT it — see the loop. */
  block: string;
}

/*
 * Never throws.
 *
 * A learner whose connections cannot be listed still gets an
 * agent that answers; it simply answers without its tools,
 * which is the same degradation a failed search produces. The
 * alternative is a database hiccup turning every turn of every
 * tool-using agent into an error, and an agent that answers
 * without acting is worth far more than one that refuses.
 */
async function planActions(
  options: RuntimeChatOptions
): Promise<ActionPlan | null> {
  const flags: ActionCapabilityFlags = {
    codeExecution: options.body.codeExecution,
    httpActions: options.body.httpActions,
    documentGeneration: options.body.documentGeneration,
    dataStore: options.body.dataStore,
    emailRead: options.body.emailRead,
    emailDraft: options.body.emailDraft,
    emailOrganize: options.body.emailOrganize,
  };

  if (toolsFor(flags).length === 0) {
    return null;
  }

  const sentinel = newSentinel();

  /*
   * Connections belong to a SAVED agent. A draft in the Test
   * panel has no id to hang them on, exactly as memories do
   * not, so it gets the tools without the credentials — which
   * is a coherent state rather than a broken one: public GETs
   * and the sandbox both still work.
   */
  let connections: Awaited<ReturnType<typeof listConnections>> = [];

  if (flags.httpActions && options.body.agentId) {
    try {
      connections = await listConnections(options.userId, options.body.agentId);
    } catch (error) {
      console.error(
        `[actions] could not list connections for agent ${options.body.agentId}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  /*
   * The store's key index, on the same terms as the connection
   * list above: a saved agent only, and a failure here costs
   * the agent a step rather than the turn.
   *
   * The keys go into the system prompt — see the note on
   * `renderStoreIndex` in actions/context.ts, which is where
   * the argument for that lives. What matters here is that a
   * database hiccup produces an agent that spends one action on
   * `data_list` instead of an agent that cannot answer.
   */
  let storeKeys: string[] = [];

  if (flags.dataStore && options.body.agentId) {
    try {
      const { indexKeys } = await import("../agents/data/DataStore");

      storeKeys = await indexKeys({
        kind: "owner",
        userId: options.userId,
        agentId: options.body.agentId,
      });
    } catch (error) {
      console.error(
        `[actions] could not list store keys for agent ${options.body.agentId}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  /*
   * Which mailbox is connected, on the same terms as the two
   * lookups above: a failure costs the agent its knowledge of
   * its own inbox rather than costing the learner the turn.
   *
   * Unlike those two, this does NOT require a saved agent — the
   * account belongs to the person, not to the agent, which is
   * the whole reason it is in a user-scoped table. A draft in
   * the Test panel can therefore see the mailbox; it just
   * cannot write a draft, because a draft row needs an agent id
   * to hang off. Both facts reach the agent as a sentence
   * rather than as a silent absence.
   *
   * Only the ADDRESS and what the agent may do is read out. No
   * token reaches this function, and there is no shape in which
   * one could: `listAccounts` returns `EmailAccount`, which has
   * no token field for a caller to forget to strip.
   */
  let mailbox: Parameters<typeof renderActionContext>[0]["mailbox"] = null;

  if (flags.emailRead || flags.emailDraft || flags.emailOrganize) {
    try {
      const { listAccounts } = await import("../agents/email/AccountStore");
      const accounts = await listAccounts(options.userId);
      const account = accounts[0];

      if (account) {
        mailbox = {
          address: account.emailAddress,
          /*
           * BOTH halves have to be true, and they are different
           * questions. The flag is what the agent's OWNER
           * allowed; the grant is what the MAILBOX'S owner
           * allowed on Google's consent screen. An agent told it
           * may draft when the account was connected read-only
           * spends a step finding out.
           */
          canDraft: flags.emailDraft && account.grants.includes("draft"),
          canOrganize:
            flags.emailOrganize && account.grants.includes("organize"),
        };
      }
    } catch (error) {
      console.error(
        `[email] could not resolve a mailbox for the prompt: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  const block = renderActionContext({
    sentinel,
    flags,
    connections,
    storeKeys,
    mailbox,
  });

  return block ? { sentinel, flags, block } : null;
}

/*
 * Fits the looked-up material into what the request may carry.
 *
 * Both budgets are additive to `maxSystemChars` rather than
 * carved out of it, so switching a capability on never shrinks
 * the space a learner's own instructions get. What they are all
 * inside is `maxInputChars`, the limit that actually protects
 * the bill — and with both capabilities on, a long conversation
 * and a full context block each, that is a sum somebody should
 * check rather than assume.
 *
 * So it is checked, and anything that does not fit is dropped
 * rather than truncated. Knowledge goes in first: it is the
 * agent's own material, chosen by its owner, and the web block
 * is the expendable one — a search that found things the prompt
 * had no room for is a worse answer, while a prompt clipped
 * mid-sentence is an unpredictable one.
 */
function fitExtras(
  options: RuntimeChatOptions,
  limits: QuotaLimits,
  blocks: Array<string | undefined>
): { system?: string; kept: boolean[] } {
  const budget = limits.maxInputChars > 0 ? limits.maxInputChars : Infinity;

  let used = countInputChars(options.body.messages, options.body.system);

  const parts: string[] = [];
  const kept: boolean[] = [];

  for (const block of blocks) {
    if (!block) {
      kept.push(false);
      continue;
    }

    /* Two for the blank line that will join it on. */
    const cost = block.length + 2;

    if (used + cost > budget) {
      console.error(
        `[ai] agent ${
          options.body.agentId ?? "(draft)"
        }: a looked-up block of ${block.length} chars did not fit the ${budget} input budget; answering without it.`
      );

      kept.push(false);
      continue;
    }

    used += cost;
    parts.push(block);
    kept.push(true);
  }

  if (parts.length === 0) {
    return { system: options.body.system, kept };
  }

  return {
    system: [options.body.system, ...parts]
      .filter((part): part is string => Boolean(part))
      .join("\n\n"),
    kept,
  };
}

/*
 * The result, if it arrives in time, and null if it does not.
 *
 * Used for exactly one thing: reporting what a turn remembered
 * without letting that report delay the turn. Losing the race
 * does not cancel anything — the promise carries on and its
 * writes land — so this is a question about what can be said,
 * never about what happens.
 *
 * The timer is cleared on the winning path, because a pending
 * timeout keeps the event loop alive and this runs on every
 * memory-backed turn.
 */
async function settledWithin<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  if (ms <= 0) {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    /* The promise this is used with does not reject. Guarded
       anyway, because a report failing must not be able to
       fail an answer that has already been delivered. */
    return null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function* runChat(
  options: RuntimeChatOptions
): AsyncGenerator<RuntimeStreamEvent> {
  registerProviders();

  const source = scoped(
    await resolvePowerSource(options.userId),
    options.quotaScope
  );
  const model = resolveModel(options.body.model, source);

  /*
   * No provider is chosen here, and that is the whole change.
   *
   * This used to resolve one adapter and one key before doing
   * anything else, which meant a single 429 from that one vendor
   * was the end of the request. The choice now happens at the
   * moment of the attempt, inside the loop below, from a list
   * that is re-read from the top on every request.
   */
  if (source.candidates.length === 0) {
    throw new AiRuntimeError(
      "provider_not_configured",
      "AI is not configured on this BuildGentic server yet."
    );
  }

  /* =====================================================
     THE XP GATE

     Before the capability work below, not merely before the
     provider call — and that placement is the point. Retrieval
     embeds the question, Web Search runs a model call to decide
     whether to search, File Analysis parses documents. All of
     that is spent on a learner's behalf, so a learner who
     cannot afford the turn must be turned away before any of it
     happens rather than after.

     It knows nothing about which provider will answer, and
     resolveChain knows nothing about XP. A Groq outage must not
     change what an experiment costs.
  ===================================================== */

  /*
   * The file surcharge is folded into the up-front gate rather
   * than collected afterwards, because it CAN be: attachments
   * arrive in the request body, so whether this turn will read
   * a document is knowable before any document is read. That
   * keeps the promise the placement above makes — a learner who
   * cannot afford the turn is turned away before the work, not
   * billed after it.
   *
   * Once per turn, not once per file. Somebody who attaches
   * three pages of a report attached one message and asked one
   * question; charging them three times would price the
   * capability by how badly their source was split up.
   */
  const analysesFiles =
    options.body.fileAnalysis && options.body.attachments.length > 0;

  const xpCost =
    costOf(options.body.feature) +
    (analysesFiles ? SURCHARGES.fileAnalysis : 0);

  if (xpCost > 0) {
    const wallet = await spend(options.userId, xpCost);

    if (!wallet.ok) {
      throw new AiRuntimeError(
        "out_of_xp",
        wallet.balance > 0
          ? `That costs ${xpCost} XP and you have ${wallet.balance}. Finish a lesson to earn more, or come back tomorrow for your daily XP.`
          : "You are out of XP. Finish a lesson to earn more, or come back tomorrow for your daily XP."
      );
    }
  }

  /*
   * WHAT THE AGENT LOOKED UP.
   *
   * Here, and nowhere else. This is the only retrieval
   * implementation in BuildGentic, and its position in this
   * function is most of the reason it can stay that way.
   *
   * Every caller reaches it — the Builder's Test panel and a
   * deployed agent answering somebody else's application both
   * arrive at `runChat`, so the two cannot drift and a learner's
   * own testing stays evidence about the deployed thing.
   *
   * Before `buildModelRequest`, so the retrieved text is inside
   * the input the size limit is enforced against. Before
   * `admit`, so it is inside the token estimate the quota is
   * charged for. Doing it afterwards would make retrieved
   * context the one part of a prompt that nothing measures.
   *
   * It never throws — see retrieve.ts. A failed lookup produces
   * an empty result and a reason, and the answer happens anyway.
   */
  /*
   * In parallel, because they are independent and a learner
   * waits through both. Searching the web is the slower of the
   * two by an order of magnitude — a decision call plus a
   * provider round trip against a vector query — so running
   * them in sequence would add the embedding's latency to a
   * turn that was already the longest one an agent has.
   *
   * Neither throws, so neither can take the other down.
   */
  /*
   * WHAT THE AGENT WAS HANDED.
   *
   * Before the two lookups rather than beside them, and
   * synchronous, because it is the one of the three that can
   * refuse. Resolving attachments does no I/O — the files were
   * read at upload time and the store is in this process — so
   * running it first costs nothing and means a refusal happens
   * before a search provider has been paid to answer a question
   * that is about to be abandoned.
   */
  const attached = analyseAttachments(options, model);

  /*
   * Memory joins the parallel pair, for the reason they were a
   * pair: they are independent, none of them throws, and
   * somebody is waiting through all of them. Recall is usually
   * the fastest of the three — one indexed select, and no
   * provider call at all unless the scope has outgrown its
   * budget — so adding it to the race costs nothing measurable
   * and adding it to the sequence would put a database round
   * trip in front of the slowest turn an agent has.
   */
  const [retrieved, web, recalled] = await Promise.all([
    retrieveContext(options),
    searchWeb(options, source, model),
    recallContext(options),
  ]);

  /*
   * THE WEB SEARCH SURCHARGE.
   *
   * Collected here rather than at the gate above, because until
   * this line nobody knew whether it was owed. Switching Web
   * Search on does not make an agent search — it makes it
   * ALLOWED to, and it decides question by question. Charging
   * at the gate would bill every turn for a capability most
   * turns do not use, which is the surest way to make a learner
   * switch off the thing that makes their agent good.
   *
   * `searched` rather than "sources came back": an agent that
   * searched and found nothing still spent a provider call and
   * still cost BuildGentic money, and a learner who is told "no
   * results, free of charge" learns the wrong lesson about what
   * searching costs.
   *
   * ONCE, however many queries the search ran, and regardless
   * of the fact that a searching turn writes two
   * `agent_web_search` usage rows — the decision call and the
   * search. Those are the runtime's business. The learner asked
   * one question.
   *
   * BEST EFFORT, and deliberately not a refusal. The search has
   * already happened by the time this runs, so refusing here
   * would take the learner's base XP and give them nothing for
   * it. Somebody who cannot cover the surcharge gets this one
   * search uncharged and is stopped by the ordinary gate on
   * their next turn — a bounded, one-turn leak, which is the
   * cheaper mistake.
   */
  if (web?.telemetry.searched) {
    const surcharge = await spend(options.userId, SURCHARGES.webSearch);

    if (!surcharge.ok) {
      console.warn(
        `[credits] could not collect the web search surcharge from ${options.userId}: balance ${surcharge.balance}`
      );
    }
  }

  /*
   * Files go in FIRST, ahead of knowledge and ahead of the web.
   *
   * The order is the priority order when the input budget runs
   * short, and an attachment outranks both: it is the subject of
   * the question rather than background for it. A turn about a
   * spreadsheet is not improved by dropping the spreadsheet to
   * make room for a search result.
   *
   * It cannot actually be dropped here — attach.ts has already
   * refused anything that would not fit its own budget, and that
   * budget is inside this one — so `kept[0]` is belt and braces
   * on an arithmetic guarantee, checked below like the others.
   */
  /*
   * Memory goes in SECOND, ahead of knowledge and ahead of the
   * web.
   *
   * The order is the priority order when the input budget runs
   * short, and memory outranks both of those for two reasons.
   * It is the smallest block by a wide margin — a few hundred
   * characters against several thousand — so dropping it buys
   * almost no room. And it is the one block whose absence the
   * person on the other end will notice as a personality
   * change: an agent that suddenly does not know who it is
   * talking to reads as broken in a way an agent that missed a
   * citation does not.
   *
   * It still ranks below an attachment, which is the subject of
   * the question rather than background for it.
   */
  /*
   * The captured page goes in SECOND, immediately after an
   * attachment and ahead of everything else.
   *
   * Same argument the attachment gets, for the same reason: it
   * is the SUBJECT of the question rather than background for
   * it. Somebody who pressed "ask about this page" and got an
   * answer drawn from the agent's knowledge instead has been
   * given the wrong answer confidently.
   *
   * Below an attachment rather than above it because an
   * attachment was deliberately chosen, file by file, whereas a
   * page capture is whatever happened to be on screen. When
   * both are present and only one fits, the one the learner
   * picked wins.
   */
  const page = options.pageContext
    ? renderPageContext(options.pageContext)
    : null;

  const fitted = fitExtras(options, source.limits, [
    attached?.text,
    page?.text,
    recalled?.text,
    retrieved?.text,
    web?.text,
  ]);

  if (attached?.text && !fitted.kept[0]) {
    throw new AiRuntimeError(
      "invalid_request",
      "This conversation has grown too long to attach a file to. Clear it and ask about the file in a fresh conversation."
    );
  }

  /*
   * REFUSED RATHER THAN DROPPED, which is the attachment's
   * treatment and not the web's.
   *
   * A search that did not fit is background the answer is
   * poorer without. A page that did not fit is the thing the
   * learner asked about — and the failure mode of dropping it
   * silently is the worst one this capability has: an agent
   * that describes a page it was never given, fluently, with
   * nothing on screen to say anything went missing. That is the
   * same reasoning attach.ts uses to refuse rather than drop a
   * document, and it is the reason page context is not simply
   * appended to the "dropped" reporting below.
   */
  if (page?.text && !fitted.kept[1]) {
    throw new AiRuntimeError(
      "invalid_request",
      "This conversation has grown too long to add the page to. Start a new conversation in the side panel and ask about the page there."
    );
  }

  const messages = withImages(options.body.messages, attached?.images ?? []);

  const body =
    fitted.system === options.body.system && messages === options.body.messages
      ? options.body
      : { ...options.body, system: fitted.system, messages };

  /*
   * A block that was found and then did not fit is reported as
   * unavailable rather than as nothing found. The distinction
   * matters to the only person who can act on it: "the web had
   * nothing" and "the web had six pages your prompt had no room
   * for" call for different fixes.
   *
   * Both tests below check that the block EXISTED before asking
   * whether it was kept, and that is not a formality. `kept` is
   * false for a block that was never there — a question its
   * knowledge did not cover, a search the agent decided against
   * — and reporting those as unavailable would turn the two
   * commonest honest outcomes into a fault. It did, briefly,
   * and the retrieval suite caught it.
   */
  /*
   * These three indices track the `blocks` array passed to
   * fitExtras above, and they shifted by one when page context
   * was inserted at position 1. Getting them wrong does not
   * fail loudly — it reports the wrong block as dropped — so
   * they are worth reading against that array rather than
   * trusting.
   *
   *   0 attachment   1 page   2 memory   3 knowledge   4 web
   */
  const memoryDropped = Boolean(recalled?.text) && !fitted.kept[2];

  const retrievalDropped = Boolean(retrieved?.text) && !fitted.kept[3];

  const webDropped =
    web !== null &&
    web.text !== "" &&
    !fitted.kept[4] &&
    web.telemetry.sources.length > 0;

  const webTelemetry =
    web && webDropped
      ? { ...web.telemetry, sources: [], reason: "unavailable" as const }
      : web?.telemetry;

  /*
   * WHAT THIS AGENT MAY DO.
   *
   * Added to the system prompt directly rather than through
   * fitExtras, and the difference is a real one. The blocks
   * fitExtras weighs are looked-up MATERIAL — passages, search
   * results, a document — and dropping one produces a worse
   * answer to the same question. This is an INSTRUCTION, in
   * BuildGentic's own voice, and dropping it produces an agent
   * that has been told it has tools by nothing at all and will
   * either never use them or describe using them without
   * doing so. It is a few hundred characters and it is not
   * optional.
   *
   * `baseSystem` is kept because the closing pass rebuilds the
   * prompt without this block — once an agent is out of steps,
   * the honest thing is to stop telling it that it can act.
   */
  const actionPlan = await planActions(options);

  const baseSystem = body.system;

  const bodyWithActions = actionPlan
    ? {
        ...body,
        system: [baseSystem, actionPlan.block]
          .filter((part): part is string => Boolean(part))
          .join("\n\n"),
      }
    : body;

  /* Throws invalid_request on an oversized conversation. Before
     the quota slot, so a too-large prompt costs nothing. */
  const request = buildModelRequest(bodyWithActions, model, source.limits);

  const estimatedInput = estimateInputTokens(request.messages, request.system);

  const admission = await admit({
    userId: options.userId,
    source,
    model: model.id,
    /*
     * A prediction, not a fact: admission has to open the usage
     * row before any provider is contacted, and which one
     * answers is not known until one produces a token. The
     * close corrects it — see UsageOutcome.providerId.
     */
    providerId: source.candidates[0].providerId,
    feature: options.body.feature,
    /* Input we can measure plus the most output we would allow:
       the ceiling on what this request can cost. */
    estimatedTokens: estimatedInput + request.settings.maxOutputTokens,
    agentId: options.body.agentId,
    deployment: options.deployment,
  });

  /*
   * Remembering starts here, the moment the turn is admitted,
   * and runs alongside the answer rather than after it. See
   * startMemoryWrite for why that is safe and why it is worth
   * doing.
   *
   * Deliberately not awaited anywhere except after `done`, and
   * even there only for a bounded moment. The write is real
   * work with its own quota slot and its own usage row; the
   * waiting is only so the stream can report what happened.
   */
  const writing = startMemoryWrite(options, source, model, recalled);

  const startedAt = Date.now();

  let usage: TokenUsage = {
    inputTokens: estimatedInput,
    outputTokens: 0,
    reported: false,
  };

  let outputChars = 0;
  let sawDelta = false;
  /*
   * Assigned by every pass of the loop below before anything
   * reads it — each step starts its own `stepFinish` at
   * "error" and hands it over here — so this needs no
   * initialiser of its own.
   */
  let finishReason: FinishReason;
  let failure: AiRuntimeError | null = null;

  /*
   * Set only once the `done` event has actually been handed to
   * the consumer. Nothing else is proof the request finished.
   *
   * A consumer that breaks out of its loop — which is exactly
   * what the SSE route does when the browser disconnects —
   * disposes this generator without throwing anything. The catch
   * block never runs, `failure` stays null, and the code below
   * would otherwise record a success for an answer that was
   * never delivered.
   */
  let completed = false;

  /*
   * One controller for three ways a request can stop early: the
   * client hangs up, the whole thing runs too long, or the
   * provider accepts the connection and then says nothing.
   *
   * They must be distinguishable afterwards. An abort tells you
   * the stream ended, not why, and recording a learner's cancel
   * as a timeout would make the usage table lie about the
   * provider's reliability.
   */
  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const overallTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);

  /*
   * Who actually answered. Null until a provider has produced a
   * token, which is the only moment the question has an answer.
   */
  let served: ChainCandidate | null = null;

  try {
    yield { type: "start" };

    /*
     * First of the three, because it is the one the learner is
     * waiting on: they attached something and want to know it
     * arrived. Between `start` and the first token, so the Test
     * panel can say what the agent was given before it says
     * what the agent thought.
     */
    if (attached) {
      yield {
        type: "file_analysis",
        files: attached.files,
        ...(attached.reason ? { reason: attached.reason } : {}),
      };
    }

    /*
     * Second, and before the first token, so the Test panel can
     * say what the agent already knew about somebody before it
     * says what the agent replied.
     *
     * This is the only evidence Memory produces. A retrieved
     * passage shows up as a citation and a searched page shows
     * up as a link, but an agent that remembers somebody's
     * deadline just writes a slightly better paragraph — and
     * without this event a learner has no way to tell that from
     * the model guessing well.
     */
    if (recalled) {
      yield {
        type: "memory",
        memories: memoryDropped ? [] : recalled.memories,
        scope: options.memoryScope?.kind ?? "owner",
        ...(memoryDropped
          ? { reason: "unavailable" as const }
          : recalled.reason
            ? { reason: recalled.reason }
            : {}),
      };
    }

    /*
     * Between `start` and the first token, because by now the
     * lookup has already happened and the UI should be able to
     * say what the agent read before it says what the agent
     * thought.
     */
    if (retrieved) {
      yield {
        type: "retrieval",
        sources: retrievalDropped ? [] : retrieved.sources,
        ...(retrievalDropped
          ? { reason: "unavailable" as const }
          : retrieved.reason
            ? { reason: retrieved.reason }
            : {}),
      };
    }

    /*
     * Immediately after, and before the first token, so the
     * Test panel can say what the agent went and read before it
     * says what the agent thought.
     */
    if (webTelemetry) {
      yield { type: "web_search", ...webTelemetry };
    }

    /* =====================================================
       THE CASCADE

       Extracted into streamFromChain so it can be driven by
       the verify script with fake adapters, no database and no
       network. Read that file for the commit-boundary rule,
       which is the whole of why this is safe.
    ===================================================== */

    /*
     * The loop exists only when the agent has tools. With none,
     * `actionPlan` is null, the scanner is never built, and
     * every line below behaves exactly as it did when this was
     * a single pass — one iteration, one break. That is the
     * property to preserve when editing here: an agent without
     * actions must not pay a single extra call, character or
     * millisecond for their existence.
     */
    let stepRequest = request;
    let stepBudget = estimatedInput + request.settings.maxOutputTokens;

    /* What the agent did and what came back, appended as real
       turns. Held apart from the caller's messages so the
       conversation that arrived is never mutated. */
    const actionTurns: ChatMessage[] = [];

    let step = 0;
    let resultChars = 0;
    let usedTools = false;
    let closing = actionPlan === null;

    /*
     * What this turn has already spent on the two tools that
     * have a per-TURN ceiling as well as a per-call one.
     *
     * One object, created here and handed to every tool, so the
     * dispatch below stays generic: a tool that needs a turn
     * ceiling checks and increments its own counter, and this
     * loop does not grow a branch per tool id.
     */
    const turnBudget = newTurnBudget();

    for (;;) {
      const scanner = closing || !actionPlan
        ? null
        : new ActionScanner(actionPlan.sentinel);

      let stepFinish: FinishReason = "error";
      let stepReported: TokenUsage | undefined;
      let stepChars = 0;

      /* What the scanner let through to the learner on this
         pass, as opposed to what the model wrote. */
      let releasedChars = 0;

      for await (const event of streamFromChain({
        candidates: source.candidates,
        request: stepRequest,
        /* Input we can measure plus the most output we would
           allow: the ceiling on what this request can cost. */
        tokenBudget: stepBudget,
        firstTokenTimeoutMs,
        signal: controller.signal,
      })) {
        if (event.type === "committed") {
          /* Who actually answered. Recorded on the usage row and
             nowhere else — never on the wire. */
          served = event.candidate;
          sawDelta = true;
          continue;
        }

        if (event.type === "delta") {
          stepChars += event.text.length;

          /*
           * The scanner decides what reaches the learner. It
           * holds back only text that could still turn out to
           * be the opening sentinel, which for an answer
           * beginning with a letter is nothing at all — so an
           * ordinary reply streams with no added latency.
           */
          const visible = scanner ? scanner.push(event.text) : event.text;

          if (visible.length > 0) {
            outputChars += visible.length;
            releasedChars += visible.length;
            yield { type: "delta", text: visible };
          }

          continue;
        }

        stepFinish = event.finishReason;
        stepReported = event.usage;
      }

      /* Anything the scanner was still holding that turned out
         not to be a sentinel after all. */
      if (scanner) {
        const tail = scanner.flush();

        if (tail.length > 0) {
          outputChars += tail.length;
          releasedChars += tail.length;
          yield { type: "delta", text: tail };
        }
      }

      finishReason = stepFinish;

      const stepUsage = resolveUsage(stepReported, {
        inputTokens: estimateInputTokens(
          stepRequest.messages,
          stepRequest.system
        ),
        outputTokens: estimateTokensFromChars(stepChars),
      });

      /*
       * Correct THIS step's reservation before the next one is
       * booked.
       *
       * The single settle that used to sit after the cascade
       * cannot serve a loop: each pass reserves its own budget
       * against the provider, so each pass has to give back
       * what it did not spend. Leaving four steps' worth of
       * unsettled reservations would push the next learner
       * down the chain for capacity nobody used.
       */
      if (served) {
        settleProvider(
          served.providerId,
          stepUsage.inputTokens + stepUsage.outputTokens
        );
      }

      usage =
        step === 0
          ? stepUsage
          : {
              inputTokens: usage.inputTokens + stepUsage.inputTokens,
              outputTokens: usage.outputTokens + stepUsage.outputTokens,
              /* Reported only if every step was. One estimated
                 leg makes the total an estimate. */
              reported: usage.reported && stepUsage.reported,
            };

      const parsed = scanner?.result() ?? null;

      if (!parsed || !actionPlan) {
        break;
      }

      /* -------------------------------------------------
         The agent asked to do something.
      ------------------------------------------------- */

      const nextStep = step + 1;

      const limit: ActionLimitReason | null =
        nextStep > actionConfig.maxSteps
          ? "step_limit"
          : resultChars >= actionConfig.totalResultChars
            ? "budget"
            : null;

      if (limit) {
        /*
         * Out of room. The agent is told so and asked to answer
         * with what it has, and the NEXT pass is the closing
         * one: no tools in the prompt, no scanner, so whatever
         * it writes is the answer. That is what stops this
         * being a loop that can talk its way into another turn.
         */
        yield { type: "tool_limit", step: nextStep, reason: limit };

        actionTurns.push(
          { role: "assistant", content: "(action not taken)" },
          { role: "user", content: renderStepLimit(limit) }
        );

        closing = true;
      } else if (!parsed.ok) {
        /*
         * A malformed action. Handed back as a failed step
         * rather than ended, because a model that wrote bad
         * JSON usually writes good JSON when told what was
         * wrong — and because the alternative is a turn that
         * dies on a punctuation mistake.
         */
        /* No `tool`: nothing ran, and naming one would put a
           tool in the trace that was never reached. */
        yield {
          type: "tool_result",
          step: nextStep,
          ok: false,
          latencyMs: 0,
          summary: "the action could not be read",
          error: parsed.error,
          ...(parsed.truncated ? { truncated: true } : {}),
        };

        actionTurns.push(
          { role: "assistant", content: "(unreadable action)" },
          { role: "user", content: renderUnreadable(parsed.error) }
        );

        step = nextStep;
      } else {
        /*
         * A paragraph break between what the model said before
         * acting and what it says after.
         *
         * Models often write a line of intent — "We need to
         * compute this, use the tool" — before the action line,
         * and the scanner releases it because swallowing it
         * would make the pause look like a stall. Without this,
         * that line runs straight into the answer with no gap:
         * "...Use tool.The sum of the digits is 115."
         *
         * Presentational, and the only text this runtime adds
         * to an answer. Two newlines rather than one because
         * the client renders markdown, where a single break is
         * not a paragraph.
         */
        if (releasedChars > 0) {
          outputChars += 2;
          yield { type: "delta", text: "\n\n" };
        }

        yield {
          type: "tool_call",
          step: nextStep,
          tool: parsed.tool,
          args: parsed.args,
        };

        usedTools = true;

        /*
         * runTool returns a failed outcome for a tool that did
         * not work, and THROWS for a refusal that happened
         * before the tool was reached — an exhausted action
         * quota, most often.
         *
         * That throw must not escape the loop. It would end a
         * turn the learner is already reading, leave the step
         * that provoked it showing "running…" for ever, and
         * report an infrastructure limit as a broken agent. So
         * it becomes a failed step like any other, and the loop
         * closes: if there is no allowance for one tool there
         * is none for the next, and the useful thing left to do
         * is answer with what is already in hand.
         */
        let outcome: Awaited<ReturnType<typeof runTool>>;

        try {
          outcome = await runTool({
            tool: parsed.tool,
            args: parsed.args,
            userId: options.userId,
            source: actionSource(source),
            ...(options.body.agentId ? { agentId: options.body.agentId } : {}),
            ...(options.documentRunId
              ? { runId: options.documentRunId }
              : {}),
            /*
             * Carried so a drafted reply can record what shaped
             * it. Only `email_draft` reads it — for every other
             * tool the page is already in the prompt, and a
             * tool re-reading it would be a second copy of the
             * same text with no reason to agree with the first.
             */
            ...(options.pageContext
              ? { pageContext: options.pageContext }
              : {}),
            turn: turnBudget,
            signal: controller.signal,
          });
        } catch (error) {
          const refusal = normalizeError(error);

          if (refusal.internalDetail) {
            console.error(
              `[actions] ${parsed.tool} refused: ${refusal.internalDetail}`
            );
          }

          outcome = {
            ok: false,
            output: "",
            error: refusal.message,
            summary: "could not be run",
            ms: 0,
          };

          closing = true;
        }

        const rendered = outcome.ok
          ? renderResult(actionPlan.sentinel, parsed.tool, outcome.output)
          : null;

        yield {
          type: "tool_result",
          step: nextStep,
          tool: parsed.tool,
          ok: outcome.ok,
          latencyMs: outcome.ms,
          summary: outcome.summary,
          ...(outcome.error ? { error: outcome.error } : {}),
          ...(rendered?.truncated ? { truncated: true } : {}),
        };

        /*
         * A file now exists, and this is the event that says so.
         *
         * After the result rather than instead of it: the result
         * is what the model is about to read, and this is what
         * the OWNER'S surfaces read — the Test panel's download
         * button, the run card's file strip, and the list of
         * attachments the mail outbox builds.
         *
         * Which is what makes the honesty structural. Every one
         * of those surfaces is built from this event and the row
         * behind it, never from what the answer says. An agent
         * that claims a report it did not make produces an email
         * with no attachment, contradicted by the surface next
         * to its own prose — a better guard than any classifier
         * reading the prose itself.
         */
        if (outcome.document) {
          yield { type: "document", step: nextStep, ...outcome.document };
        }

        /*
         * A draft exists now, and this is the only evidence any
         * surface will accept that one does.
         *
         * Beside the document event and for the same reason —
         * the Test panel's card, the Email screen's tray and the
         * run card are built from this and the row behind it,
         * never from what the answer says. It is what makes an
         * agent physically unable to blur "drafted" into "sent":
         * the card it produces has a Send button still on it.
         */
        if (outcome.draft) {
          yield { type: "email_draft", step: nextStep, ...outcome.draft };
        }

        const back = rendered
          ? rendered.text
          : renderFailure(parsed.tool, outcome.error ?? "It did not say why.");

        resultChars += back.length;

        /*
         * The action and its result go in as an assistant turn
         * and a user turn.
         *
         * Not a `tool` role, because ChatRole has none and
         * adding one would mean every provider adapter growing
         * a branch for a shape only some of them accept. A
         * plain user turn carrying fenced output is understood
         * by all four vendors and by the offline mock, which is
         * the same reason the call itself is text.
         */
        actionTurns.push(
          {
            role: "assistant",
            content: `${actionPlan.sentinel.open}${JSON.stringify({
              tool: parsed.tool,
              args: parsed.args,
            })}${actionPlan.sentinel.close}`,
          },
          { role: "user", content: back }
        );

        step = nextStep;
      }

      /*
       * REBUILD FOR THE NEXT PASS.
       *
       * A closing pass drops the tools block, so an agent that
       * has run out of steps is not still being told it can
       * act. Everything else — the owner's instructions, the
       * retrieved knowledge, the conversation — is unchanged.
       *
       * Tool results grow the prompt DURING the turn, which is
       * the one thing fitExtras cannot help with — it weighs
       * blocks that are all known before the first token.
       *
       * So the rebuild can fail on a conversation that was
       * perfectly legal a moment ago, and failing here is worse
       * than failing anywhere else: the learner has already
       * watched half an answer arrive. Dropping the OLDEST
       * results until it fits is the graceful version. The
       * model has already reasoned about those; the newest is
       * the one it is about to answer from.
       *
       * `totalResultChars` above is what makes this rare. This
       * is what makes it survivable.
       */
      let attempt = [...actionTurns];

      for (;;) {
        try {
          stepRequest = buildModelRequest(
            {
              ...bodyWithActions,
              /*
               * Recomputed inside the retry rather than above
               * it, because a drop can turn this into the
               * closing pass — and a closing pass must not
               * still be carrying the block that tells the
               * agent it can act.
               */
              system: closing ? baseSystem : bodyWithActions.system,
              messages: [...messages, ...attempt],
            },
            model,
            source.limits
          );

          break;
        } catch (error) {
          /* Pairs: the action, then its result. Dropping half a
             pair leaves an action with no answer, which reads
             to the model as a tool that silently did nothing. */
          if (attempt.length < 2) {
            throw error;
          }

          attempt = attempt.slice(2);

          if (!closing) {
            /* Whatever room is left is not enough to keep
               acting in. Say so, once. */
            yield { type: "tool_limit", step: step + 1, reason: "budget" };

            closing = true;
          }
        }
      }

      actionTurns.length = 0;
      actionTurns.push(...attempt);

      stepBudget =
        estimateInputTokens(stepRequest.messages, stepRequest.system) +
        stepRequest.settings.maxOutputTokens;

      /*
       * Every pass after the first is a model call the learner
       * did not ask for by name, so it is admitted and recorded
       * in the action windows rather than the chat ones. Same
       * reason the web search decision call is: charging a
       * capability's extra calls to the window somebody uses
       * for the Lab makes switching the capability on cost them
       * everything else.
       */
      const stepAdmission = await admit({
        userId: options.userId,
        source: actionSource(source),
        model: model.id,
        providerId: served?.providerId ?? source.candidates[0].providerId,
        feature: "agent_action",
        estimatedTokens: stepBudget,
        agentId: options.body.agentId,
      });

      /*
       * Closed immediately, with the cost of the step it
       * admits filled in on the next pass through the loop.
       * The row exists to be counted by the windows; the
       * tokens it carries are settled by the accumulation
       * above, which lands on the turn's own usage row.
       */
      await finish(stepAdmission.usageId, {
        usage: { inputTokens: 0, outputTokens: 0, reported: false },
        latencyMs: 0,
        ok: true,
      });
    }

    /*
     * The surcharge for having acted, collected once however
     * many steps ran.
     *
     * After the fact and best effort, exactly like the web
     * search surcharge above and for the same reason: how many
     * tools a turn would use is not knowable at the gate. A
     * failure here is a bounded one-turn leak, which is the
     * cheaper mistake — see the note on the search surcharge.
     */
    if (usedTools && SURCHARGES.actions > 0) {
      try {
        await spend(options.userId, SURCHARGES.actions);
      } catch (error) {
        console.warn(
          `[ai] action surcharge not collected for ${options.userId}: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
      }
    }

    /*
     * Order matters here. An aborted stream ends quietly rather
     * than throwing, so the three quiet endings have to be told
     * apart explicitly, most specific first.
     */
    if (timedOut) {
      throw new AiRuntimeError(
        "timeout",
        sawDelta
          ? "The AI response was cut short — the provider stopped partway through."
          : "The AI provider did not respond in time. Please try again."
      );
    }

    if (options.signal?.aborted || controller.signal.aborted) {
      throw new AiRuntimeError("cancelled", "The request was cancelled.");
    }

    /*
     * "Nothing answered" is handled inside the cascade, which is
     * the only place that knows whether it ran out of providers
     * or ran out of patience. Reaching here without a token
     * means one of the two quiet endings above should have
     * caught it.
     */

    /* Estimate the output if the provider never reported it. */
    if (usage.outputTokens === 0 && !usage.reported) {
      usage = { ...usage, outputTokens: estimateTokensFromChars(outputChars) };
    }

    /*
     * The reservation is corrected inside the loop, once per
     * pass, rather than here.
     *
     * It used to sit at this point, which was right when there
     * was exactly one pass. A turn that acts books its budget
     * against a provider several times, and a single settle
     * after the last one would leave every earlier booking
     * outstanding — a provider looking busy for capacity that
     * was released steps ago, and the next learner pushed down
     * the chain for it.
     */

    yield {
      type: "done",
      finishReason,
      usage,
      latencyMs: Date.now() - startedAt,
    };

    completed = true;

    /*
     * WHAT THE AGENT WROTE DOWN.
     *
     * After `done`, and it is the only event that comes after
     * it. That is not an oversight in the ordering: this
     * describes something which had not finished happening when
     * the answer started, and inventing a placeholder before
     * the first token would mean announcing a memory that might
     * never be written.
     *
     * `completed` is already true, so nothing below can turn a
     * delivered answer into a failure. The wait is bounded, and
     * losing the race is not an error — the memory is written
     * either way, because `writing` is a promise that is
     * already running and does not need anybody to await it.
     * All that is lost is the chip in the Test panel, and the
     * Memory screen shows the same thing a moment later.
     *
     * A deployed caller never sees this: the deployment route
     * forwards neither this event nor `memory`, for the reason
     * it forwards neither `retrieval` nor `web_search`.
     */
    if (writing) {
      const written = await settledWithin(writing, memoryConfig.writeWaitMs);

      if (written) {
        yield {
          type: "memory_write",
          written: written.written,
          ...(written.reason ? { reason: written.reason } : {}),
        };
      }
    }
  } catch (error) {
    failure = timedOut
      ? new AiRuntimeError(
          "timeout",
          "The AI provider did not respond in time. Please try again."
        )
      : normalizeError(error);

    if (failure.internalDetail) {
      /* The detail exists so it can be read here and nowhere
         else. It never reaches a response body. */
      console.error(`[ai] ${failure.code}: ${failure.internalDetail}`);
    }

    throw failure;
  } finally {
    clearTimeout(overallTimer);
    options.signal?.removeEventListener("abort", onCallerAbort);

    /*
     * Free the provider connection on every exit path, including
     * the one where the consumer broke out of the loop because
     * the browser went away. Without this, a closed tab leaves
     * the provider billing for tokens nobody will read.
     */
    controller.abort();

    /*
     * An abandoned run is one the consumer walked away from
     * before `done`. It threw nothing, so it is not a failure —
     * but it is certainly not a success either, and the usage
     * table has to say which.
     */
    const abandonedCode = timedOut ? "timeout" : "cancelled";

    /*
     * Always. A pending row holds one of this learner's
     * concurrency slots until the reaper sweeps it ten minutes
     * later, so a request that ends without closing its row
     * degrades the next one.
     */
    await finish(admission.usageId, {
      usage: {
        ...usage,
        outputTokens:
          usage.outputTokens || estimateTokensFromChars(outputChars),
      },
      latencyMs: Date.now() - startedAt,
      ok: failure === null && completed,
      errorCode: failure?.code ?? (completed ? undefined : abandonedCode),
      /*
       * The truth, where there is one. Overwrites the first-
       * candidate guess admission wrote, and is the only record
       * anywhere that a fallback fired.
       */
      ...(served
        ? { providerId: served.providerId, model: served.model }
        : {}),
    });

    /*
     * GIVE THE XP BACK IF NOTHING WAS DELIVERED.
     *
     * `sawDelta` is the test, not `completed`, and the
     * difference is the learner's cancel. Somebody who reads
     * half an answer and presses stop got what they paid for —
     * the provider generated those tokens and BuildGentic was
     * billed for them. Somebody who got no text at all did not,
     * whether that was every provider being down, a timeout
     * before the first token, or the quota gate refusing after
     * the wallet had already been debited.
     *
     * Last in the finally, after the usage row is closed, so a
     * refund failure cannot stop the books being balanced. It
     * never throws — see CreditStore.
     */
    if (xpCost > 0 && !sawDelta) {
      await refund(options.userId, xpCost);
    }
  }
}

/*
 * Everything the client needs to size a composer and draw a
 * usage meter, with no secret and no vendor anywhere in it.
 *
 * There is no model picker for this to feed any more, and no
 * second power source to describe. What is left is the shape of
 * the one AI the product has: how big a prompt it takes, how
 * much it will write back, and whether it can be shown a
 * picture.
 *
 * WHAT IS DELIBERATELY ABSENT: `provider`. It named the vendor
 * on every response this endpoint served, which under a cascade
 * would be a different vendor per request and is in any case
 * the one fact the routing exists to keep private.
 */
export async function describeRuntimeFor(userId: string) {
  registerProviders();

  const source = await resolvePowerSource(userId);

  const describeModels = (source: ResolvedPowerSource) =>
    source.allowedModels.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      blurb: model.blurb,
      contextWindow: model.contextWindow,
      maxOutputTokens: Math.min(
        model.maxOutputTokens,
        source.limits.maxOutputTokens > 0
          ? source.limits.maxOutputTokens
          : model.maxOutputTokens
      ),
      defaultTemperature: model.defaultTemperature,
      /*
       * The catalogue's own starting point for the output cap,
       * clamped the same way the ceiling above is.
       *
       * Published so the Lab's control can open at the value the
       * server would actually have used had the caller sent
       * nothing — rather than at a number the browser guessed,
       * which would quietly disagree with the runtime the moment
       * either default moved.
       */
      defaultMaxOutputTokens: Math.min(
        model.defaultMaxOutputTokens,
        source.limits.maxOutputTokens > 0
          ? source.limits.maxOutputTokens
          : model.maxOutputTokens
      ),
      /*
       * Published so the Builder can warn before a learner
       * attaches a photograph to a model that cannot see one.
       * The refusal in attach.ts is what enforces it — this is
       * so the refusal is not the first they hear of it.
       *
       * Not a secret: a caller discovers it by attaching one
       * image.
       */
      vision: model.vision === true,
    }));

  return {
    defaultModel: source.defaultModel,
    models: describeModels(source),
    limits: source.limits,
    /* Published so a learner can see how close BuildGentic itself
       is to its ceiling, rather than being surprised by it. */
    platformBudget,
    /*
     * The shape limits the validator enforces on a conversation.
     *
     * Published because a composer that shows "412 / 8,000
     * characters" has to get 8,000 from somewhere, and the only
     * alternative is a copy of the number in the browser that
     * drifts the first time the server's is changed. None of
     * these is a secret — a caller discovers every one of them
     * by sending one oversized request.
     *
     * Spelled out field by field rather than spreading
     * `requestLimits` wholesale. That object also carries
     * `maxApiKeyChars`, which no client needs and which nothing
     * should have to think about again: a response field whose
     * name contains "apiKey" is indistinguishable from a leak to
     * anything scanning for one, and the runtime's own security
     * test scans for exactly that. Publishing the three the
     * composer uses keeps that check meaningful.
     */
    requestLimits: {
      maxMessages: requestLimits.maxMessages,
      maxMessageChars: requestLimits.maxMessageChars,
      maxSystemChars: requestLimits.maxSystemChars,
    },
    /*
     * What the attachment control needs in order to refuse a
     * file before uploading it.
     *
     * Published for the reason `requestLimits` is: a picker that
     * says "up to 8 MB" has to get 8 from somewhere, and the
     * only alternative is a copy of the number in the browser
     * that drifts the first time the server's moves. None of it
     * is a secret — a caller discovers every one of these by
     * uploading one file that is too big.
     *
     * The client check is a courtesy, never the enforcement.
     * files/sniff.ts refuses the same file again, from its
     * bytes, on a request that has already crossed the network.
     */
    fileLimits: {
      maxFileBytes: fileAnalysis.maxFileBytes,
      maxImageBytes: fileAnalysis.maxImageBytes,
      maxFilesPerMessage: fileAnalysis.maxFilesPerMessage,
      maxImagesPerMessage: fileAnalysis.maxImagesPerMessage,
      retentionMinutes: Math.round(fileAnalysis.retentionMs / 60_000),
      accept: FILE_ACCEPT,
    },
    /*
     * What the Memory screen needs in order to draw a meter.
     *
     * Published for the reason `fileLimits` is: a panel that
     * says "18 of 120 remembered" has to get 120 from
     * somewhere, and the only alternative is a copy of the
     * number in the browser that drifts the first time the
     * server's moves. None of it is a secret — a caller
     * discovers every one of these by having a long
     * conversation.
     */
    memoryLimits: {
      maxMemories: memoryConfig.maxMemories,
      maxContentChars: memoryConfig.maxContentChars,
      contextChars: memoryConfig.contextChars,
    },
  };
}
