import { authHeaders } from "./api";

/*
 * The browser's half of the AI runtime.
 *
 * Everything the Lab and, later, the Agent Builder need in order
 * to talk to BuildGentic's server — and nothing about a provider.
 * There is no key here, no vendor SDK, and no vendor URL: the
 * browser knows only that it POSTs to /api/ai and reads text
 * coming back.
 */

/* =========================================================
   ERRORS
========================================================= */

/*
 * Mirrors server/src/ai/errors.ts, plus one code the server can
 * never send: `connection_lost`, for a stream that stops without
 * ever saying why. The UI needs to tell that apart from a clean
 * finish, because a half-written answer is not an answer.
 */
export type AiErrorCode =
  | "unauthenticated"
  | "invalid_request"
  | "model_not_allowed"
  | "rate_limited"
  | "quota_exceeded"
  | "token_quota_exceeded"
  | "platform_budget_exceeded"
  /*
   * The learner has no XP left for this action.
   *
   * Distinct from quota_exceeded, which is a rolling rate
   * limit that refills whatever they do. This one is a balance
   * — it refills daily, but it can also be EARNED back by
   * finishing a lesson, so the UI has something to offer
   * besides "come back tomorrow".
   */
  | "out_of_xp"
  | "too_many_concurrent"
  | "provider_not_configured"
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_malformed_response"
  | "empty_response"
  | "timeout"
  | "cancelled"
  | "internal_error"
  | "connection_lost";

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AiErrorCode,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/*
 * True for the three limit codes.
 *
 * Grouped here rather than re-listed at each call site so that a
 * fourth limit added on the server does not need finding in five
 * different components.
 */
export function isQuotaError(error: unknown): error is AiError {
  return (
    error instanceof AiError &&
    (error.code === "rate_limited" ||
      error.code === "quota_exceeded" ||
      error.code === "token_quota_exceeded" ||
      error.code === "too_many_concurrent")
  );
}

/*
 * BuildGentic's own budget, not this learner's allowance.
 *
 * Worth its own check because the remedy is different: nothing
 * the learner does with their own usage will help, but
 * connecting their own API key will.
 */
export function isPlatformBudgetError(error: unknown): error is AiError {
  return error instanceof AiError && error.code === "platform_budget_exceeded";
}

interface WireError {
  error?: string;
  code?: AiErrorCode;
  retryAfterSeconds?: number;
}

function toAiError(body: WireError | null, status: number): AiError {
  if (body?.code) {
    return new AiError(
      body.code,
      body.error ?? "The AI request failed.",
      body.retryAfterSeconds
    );
  }

  /* A non-JSON body, or a failure from something other than the
     runtime — a proxy, a gateway. Map by status so the UI still
     gets something it can branch on. */
  if (status === 401) {
    return new AiError("unauthenticated", "You must be signed in.");
  }

  if (status === 429) {
    return new AiError("rate_limited", "Too many requests. Please slow down.");
  }

  return new AiError(
    status >= 500 ? "provider_unavailable" : "invalid_request",
    body?.error ?? `The AI request failed (HTTP ${status}).`
  );
}

async function readErrorBody(response: Response): Promise<WireError | null> {
  try {
    return (await response.json()) as WireError;
  } catch {
    return null;
  }
}

/* =========================================================
   SHAPES
========================================================= */

export interface AiChatMessage {
  /* No "system" — system instructions go in their own field, so
     the server can put them wherever the provider wants them. */
  role: "user" | "assistant";
  content: string;
}

/*
 * What part of the product is spending. Mirrors CLIENT_FEATURES
 * in server/src/ai/validation.ts — the server's list is the one
 * that is enforced, and naming anything outside it is a 400.
 */
export type AiFeature = "lab" | "compare" | "agent_test" | "dev_harness";

export interface AiChatRequest {
  messages: AiChatMessage[];
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  stop?: string[];
  feature?: AiFeature;
  /*
   * The saved agent this call belongs to, so its usage can be
   * told apart from the Lab's. Only meaningful once an agent has
   * been saved and has an id; an unsaved draft simply omits it.
   */
  agentId?: string;
  /*
   * Whether the server should search this agent's indexed
   * knowledge before answering, and put the matching parts in
   * front of the model.
   *
   * A flag rather than any actual retrieval, and that is the
   * design: the browser never embeds anything, never runs a
   * search and never chooses which passages are sent. All of it
   * happens inside the runtime, on the request that is about to
   * answer, so a deployed agent and this one cannot end up with
   * two implementations that disagree.
   */
  knowledgeRetrieval?: boolean;
  /*
   * Whether the server may search the live web before answering.
   *
   * A permission rather than an instruction, and the difference
   * is the whole design. Sending `true` does not make the agent
   * search; the runtime asks the model whether the question
   * needs looking up, and most questions do not. What it does
   * is decide whether that question is ever asked.
   *
   * As with retrieval, the browser never runs a search, never
   * writes a query and never chooses which results are sent.
   * All of it happens inside the runtime, on the request that is
   * about to answer, so a deployed agent and this one cannot end
   * up with two implementations that disagree.
   */
  webSearch?: boolean;
  /*
   * Whether the server may read the files attached to this
   * message.
   *
   * A permission, like `webSearch`, and separate from
   * `attachments` on purpose: switching the capability off has
   * to stop the agent reading files, not merely stop the
   * Builder offering the paperclip. A request that carries
   * attachments with this false gets them ignored and is told
   * so, rather than getting an agent that quietly still reads
   * them.
   */
  fileAnalysis?: boolean;
  /*
   * Whether the server may recall what this agent already knows
   * about the person talking to it, and add to it afterwards.
   *
   * A permission, like the two above, and the one that only
   * means anything alongside `agentId`. Memories hang off an
   * agent rather than off a learner — `User -> Agent ->
   * Memories` — so an unsaved draft has nothing to hang them
   * on, and the server says `no_agent` rather than pretending.
   *
   * Sent even without an agentId for exactly that reason: the
   * honest report is more useful than a conditional in the
   * browser that would quietly make the switch look broken.
   */
  memory?: boolean;
  /*
   * Whether the server may run code the agent writes, in a
   * sandbox.
   *
   * A permission, like the four above. Sending `true` does not
   * make the agent run anything — it decides for itself whether
   * a question is worth computing rather than answering
   * directly, and most are not.
   *
   * The browser never runs the code, never sees the sandbox and
   * never chooses what goes into it. All of it happens inside
   * the runtime, on the request that is about to answer, so a
   * deployed agent and this one cannot end up with two
   * implementations that disagree.
   */
  codeExecution?: boolean;
  /*
   * Whether the server may make outbound HTTP requests on this
   * agent's behalf.
   *
   * A permission, like the rest, and the only one whose effects
   * leave BuildGentic. What it grants is the ability to make a
   * request, never the ability to choose where: public calls
   * are GET-only and every address is checked against the
   * private and internal ranges server-side, and anything
   * authenticated goes through a connection its owner saved
   * against a host they chose.
   */
  httpActions?: boolean;
  /*
   * Whether the server may turn an answer into a real file.
   *
   * A permission, like the five above, and one whose effects
   * outlive the request — the file is stored against the
   * agent and downloadable until it expires. Safe to send from
   * a browser for the reason `codeExecution` is: it grants the
   * ability to render, never the ability to choose who
   * receives it. The document is written against the caller's
   * own id and reachable only through a session that matches
   * the same id.
   */
  documentGeneration?: boolean;
  /*
   * Whether the server may read and write this agent's records.
   *
   * The permission on this list closest in kind to
   * `httpActions`, because it is the other one whose effects
   * outlive the turn — what an agent writes here it reads back
   * on a scheduled run tomorrow. Safe from a browser for the
   * same shape of reason: it grants the use of a store, never
   * the choice of whose. Every read and write is scoped to the
   * caller's own id and the agent id on this request, and the
   * agent id is itself checked against the caller.
   */
  dataStore?: boolean;
  /*
   * Whether the server may read, draft into, or rearrange the
   * caller's mailbox.
   *
   * Three permissions rather than one, because reading
   * somebody's correspondence, writing a reply for them to
   * approve and relabelling their inbox are three different
   * things to be allowed. Safe to send from a browser for the
   * shape of reason `dataStore` is, and it has to hold harder:
   * the flag grants the use of A mailbox, never the choice of
   * whose. The account is resolved from the caller's own id,
   * out of a table the browser cannot select from at all.
   *
   * THERE IS NO `emailSend` FIELD, and its absence is the
   * point. Sending is not something a chat request can ask for,
   * because it is not something a turn does — it is a separate
   * authenticated POST against a draft a person has read on
   * screen. A field here would be a way to ask for it.
   */
  emailRead?: boolean;
  emailDraft?: boolean;
  emailOrganize?: boolean;
  /*
   * Which uploaded files this message is about.
   *
   * Ids, never bytes. The file was uploaded once, to a route
   * that validated and read it server-side, and everything
   * afterwards refers to it by an opaque id — so no chat
   * request carries a document, and nothing about the file can
   * be re-asserted on the way to the model.
   */
  attachments?: string[];
}

/*
 * One page the agent read before it answered.
 *
 * `ordinal` is the number the model was told to cite, so a [2]
 * in the answer is this list's number 2 — which is what makes a
 * citation something a learner can follow rather than something
 * they have to trust.
 *
 * Owner-facing. A deployed agent's response carries none of it:
 * what somebody's agent searched for describes their
 * configuration.
 */
export interface AiWebSource {
  ordinal: number;
  title: string;
  url: string;
  /* The domain, for a strip with no room for a full URL. */
  site: string;
  chars: number;
  publishedAt?: string;
}

/*
 * Why an answer carried no web results.
 *
 *   off         - the capability is switched off, so the server
 *                 sends no event at all. The browser's own
 *                 value, never on the wire.
 *   not_needed  - the agent read the question and decided the
 *                 live web could not improve the answer.
 *   no_results  - searched, and found nothing usable.
 *   unavailable - the decision or the search failed. It
 *                 answered anyway, without this.
 */
export type AiWebSearchReason =
  | "off"
  | "not_needed"
  | "no_results"
  | "unavailable";

export interface AiWebSearchInfo {
  /* Not the same as `sources.length > 0`: a search that ran and
     found nothing is a different thing from one that never ran. */
  searched: boolean;
  /* Exactly what went to the search provider. */
  queries: string[];
  provider: string;
  /* What came back, before the prompt budget decided how many
     fit. Always at least `sources.length`. */
  resultCount: number;
  sources: AiWebSource[];
  /* The search alone, not the model calls around it. */
  latencyMs: number;
  reason?: AiWebSearchReason;
}

/*
 * One passage the agent looked up before it answered.
 *
 * Owner-facing. A deployed agent's response carries none of
 * this: which parts of somebody's knowledge answered a question,
 * and how closely they matched, describes their configuration.
 */
export interface AiRetrievedSource {
  knowledgeId: string;
  title: string;
  /* Which piece of that entry, 0-based. */
  ordinal: number;
  chars: number;
  /* 0-1. How close the match was. */
  similarity: number;
}

/*
 * Why nothing was retrieved, when nothing was.
 *
 * `off` is the browser's own: the server does not search when
 * the capability is switched off, so it has nothing to report
 * and sends no event at all.
 */
export type AiRetrievalReason =
  | "off"
  | "none_indexed"
  | "no_match"
  | "unavailable";

export interface AiRetrievalInfo {
  sources: AiRetrievedSource[];
  reason?: AiRetrievalReason;
}

/*
 * What kind of thing one memory is.
 *
 * Matches the server's closed vocabulary. A value outside it
 * means a newer server, and the panel renders it as a plain
 * note rather than breaking.
 */
export type AiMemoryKind =
  | "profile"
  | "preference"
  | "goal"
  | "project"
  | "fact";

/*
 * Why a turn carried nothing remembered.
 *
 *   off         - the capability is switched off, and no event
 *                 is sent at all.
 *   no_agent    - Memory is on but this draft has never been
 *                 saved, so there is no agent to hang memories
 *                 off. A state to fix, in one click.
 *   none        - this agent has never remembered anything
 *                 about this person. An ordinary first
 *                 conversation.
 *   ranked      - memories were carried, but chosen by recency
 *                 rather than by what was asked, because the
 *                 relevance search was unavailable.
 *   unavailable - reading the store failed. The agent answered
 *                 without knowing anything.
 */
export type AiMemoryReason =
  | "off"
  | "no_agent"
  | "none"
  | "ranked"
  | "unavailable";

/* Why a turn wrote nothing down. See the server's
   MemoryWriteReason for what each one means. */
export type AiMemoryWriteReason =
  | "off"
  | "no_agent"
  | "trivial"
  | "nothing_new"
  | "full"
  | "unavailable";

/*
 * One memory the agent carried into this turn.
 *
 * Carries the content, unlike AiRetrievedSource which carries
 * only a title — and the difference matters. A retrieved
 * passage is something the learner wrote and can go and read; a
 * memory is a sentence they never wrote, produced by a machine
 * that decided it was true about them. Showing only a label
 * would put the one thing worth checking off screen.
 */
export interface AiRecalledMemory {
  id: string;
  kind: AiMemoryKind;
  content: string;
  /* Present only on memories the relevance search chose. */
  similarity?: number;
  updatedAt: string;
}

export interface AiMemoryInfo {
  memories: AiRecalledMemory[];
  /* Which store this came from: the learner's own, or the
     deployed endpoint's. */
  scope: "owner" | "deployment";
  reason?: AiMemoryReason;
}

/* One memory this turn wrote. `replaced` distinguishes "learned
   something new" from "corrected something it already knew",
   which is why the count did not go up. */
export interface AiWrittenMemory {
  id: string;
  kind: AiMemoryKind;
  content: string;
  replaced: boolean;
}

export interface AiMemoryWriteInfo {
  written: AiWrittenMemory[];
  reason?: AiMemoryWriteReason;
}

/* =========================================================
   ACTIONS

   The only telemetry on this list that describes a LOOP rather
   than a lookup, which is why these are the only events that
   can arrive more than once in a turn, and the only ones that
   can arrive between deltas rather than before them.

   Owner-facing. A deployed caller sees the tool's name and
   whether it worked; a published page sees none of it. What an
   agent ran, and what it sent where, is a fact about somebody
   else's configuration.
========================================================= */

export type AiToolId = "run_code" | "http_request";

export type AiToolLimitReason = "step_limit" | "budget";

/*
 * The agent decided to do something. Fires BEFORE the tool
 * runs, so a five-second sandbox call or a slow API is a step
 * the panel can show as running rather than dead air.
 */
export interface AiToolCallInfo {
  /* 1-based, and the same number the matching result carries.
     A turn's trace is read as a sequence. */
  step: number;
  tool: AiToolId;
  /* What the agent asked for, after validation. Carries no
     credential: a connection is named here, never its key. */
  args: Record<string, unknown>;
}

/*
 * What came back. `ok: false` is a normal step, not an error —
 * the agent is told what went wrong and gets to try something
 * else, which is most of what makes this a loop.
 */
export interface AiToolResultInfo {
  step: number;
  /* Absent when the action could not be read, because nothing
     ran and naming a tool would misreport the trace. */
  tool?: AiToolId;
  ok: boolean;
  /* Tool time only, not the model calls around it. */
  latencyMs: number;
  /* A short line — "HTTP 200, 1.2 KB", "ran in 118ms". Never
     the payload: that went to the model, not to this panel. */
  summary: string;
  error?: string;
  truncated?: boolean;
}

/*
 * The loop stopped before the agent was finished.
 *
 * Exists because "ran out of steps" and "decided it was done"
 * produce answers that look identical, and only one of them is
 * a reason to simplify the task.
 */
/*
 * A file the agent made, and the id needed to fetch it.
 *
 * Carries no bytes and no URL. The download is a
 * session-authenticated GET on this id, which is the whole
 * reason a page visitor and a deployment key holder cannot have
 * this event: neither has a session to authenticate with, so
 * both doors refuse the capability rather than emit an event
 * pointing at something they could not collect.
 */
export interface AiDocumentInfo {
  step: number;
  id: string;
  title: string;
  filename: string;
  format: "pdf" | "xlsx" | "docx";
  bytes: number;
  pages?: number;
  rows?: number;
  sheets?: number;
  /* Present when something could not be rendered — today only
     the PDF's Latin-1 ceiling. A warning, never an error: the
     file opens, and some characters in it are placeholders. */
  degraded?: string;
}

/*
 * One email the agent drafted, as its owner sees it.
 *
 * The sibling of AiDocumentInfo, carrying the whole body where
 * that one carries only a filename — and the difference runs
 * the way it does on purpose. A document is a file somebody
 * downloads; a draft is a paragraph somebody has to READ before
 * deciding whether to send it. A card that made them click
 * through to find out what they were approving would be a card
 * that teaches them to approve without looking.
 *
 * It is the ONLY evidence any surface accepts that a draft
 * exists. The tray, the Test panel card and the run card are
 * all built from this and the row behind it, never from what
 * the answer said — so an agent claiming it replied to somebody
 * produces no card at all, and one claiming it SENT a reply
 * produces a card that says Draft with the button still on it.
 */
export interface AiEmailDraftInfo {
  step: number;
  id: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  isReply: boolean;
}

export interface AiToolLimitInfo {
  step: number;
  reason: AiToolLimitReason;
}

/*
 * One file the agent was given, as its owner sees it.
 *
 * Carries no content — the learner has the file — and every
 * count describes what actually reached the model rather than
 * what the document contains. `truncated` is the field that
 * earns the type: "the agent did not mention the conclusion"
 * and "the conclusion was never sent" look identical from the
 * outside and have completely different fixes.
 *
 * Owner-facing. A deployed agent's chat response carries none of
 * it: how much of a caller's file fitted somebody's prompt
 * budget is a fact about that somebody's configuration.
 */
export interface AiAnalysedFile {
  id: string;
  name: string;
  kind: "pdf" | "docx" | "xlsx" | "csv" | "image";
  bytes: number;
  /* Characters of extracted text that reached the prompt. Zero
     for an image, which reaches the model as pixels. */
  chars: number;
  truncated: boolean;
  pages?: number;
  sheets?: string[];
  rows?: number;
  width?: number;
  height?: number;
  latencyMs: number;
}

/*
 * Why a turn carried no analysed file.
 *
 *   off         - the capability is switched off, so the files
 *                 attached to it were not read.
 *   none        - nothing was attached.
 *   expired     - the attachment is no longer held.
 *   no_room     - it did not fit the prompt.
 *   unavailable - resolving it failed outright.
 *
 * `none` never reaches the browser in practice: the server
 * sends no event at all for a message with no attachments.
 */
export type AiFileAnalysisReason =
  | "off"
  | "none"
  | "expired"
  | "no_room"
  | "unavailable";

export interface AiFileAnalysisInfo {
  files: AiAnalysedFile[];
  reason?: AiFileAnalysisReason;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /* False when the numbers are BuildGentic's estimate rather than
     the provider's own count. */
  reported: boolean;
}

/*
 * The turn has begun. That is the entire message.
 *
 * It used to carry `model`, `provider` and `powerSource`. All
 * three named the vendor that answered, which under BuildGentic's
 * provider cascade is whichever one happened to be free at that
 * moment — and is the one fact the routing exists to keep
 * private. There is one AI here and it is called BuildGentic.
 */
export type AiStartInfo = Record<string, never>;

export interface AiDoneInfo {
  finishReason: "stop" | "length" | "filtered" | "cancelled" | "error";
  usage: AiUsage;
  latencyMs: number;
}

export interface AiModel {
  id: string;
  displayName: string;
  blurb: string;
  contextWindow: number;
  /* Already clamped by the power source's own ceiling, so this
     is the real upper bound rather than the catalogue's. */
  maxOutputTokens: number;
  defaultTemperature: number;
  /* What the server would use if the caller sent no cap. */
  defaultMaxOutputTokens: number;
  /*
   * Whether this model can actually look at an image.
   *
   * Published so the Builder can warn before a learner attaches
   * a photograph to a model that cannot see one. The server's
   * refusal is what enforces it; this is so the refusal is not
   * the first they hear of it.
   */
  vision: boolean;
}

export interface AiLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
  maxInputChars: number;
  maxOutputTokens: number;
  tokensPerDay: number;
}

/* BuildGentic's own ceilings, shared by every learner. */
export interface AiPlatformBudget {
  dailyRequests: number;
  dailyTokens: number;
  monthlyRequests: number;
  monthlyTokens: number;
}

/*
 * The shape limits the server's validator enforces, so the
 * composer can count against the real budget instead of a copy
 * of it that drifts.
 */
export interface AiRequestLimits {
  maxMessages: number;
  maxMessageChars: number;
  maxSystemChars: number;
}

/*
 * What the attachment control needs before anybody picks a
 * file.
 *
 * Read from the server for the reason `requestLimits` is: a
 * picker that says "up to 8 MB" has to get 8 from somewhere,
 * and the only alternative is a copy of the number in the
 * browser that drifts the first time the server's moves.
 *
 * The client check is a courtesy, never the enforcement. The
 * server refuses the same file again, from its bytes, on a
 * request that has already crossed the network.
 */
export interface AiFileLimits {
  maxFileBytes: number;
  maxImageBytes: number;
  maxFilesPerMessage: number;
  maxImagesPerMessage: number;
  retentionMinutes: number;
  /* Extensions for the file picker's `accept`. */
  accept: string[];
}

export interface AiRuntimeInfo {
  defaultModel: string;
  models: AiModel[];
  limits: AiLimits;
  platformBudget: AiPlatformBudget;
  requestLimits: AiRequestLimits;
  fileLimits: AiFileLimits;
}

export interface AiUsageReport {
  limits: AiLimits;
  used: {
    requestsThisMinute: number;
    requestsToday: number;
    inFlight: number;
    inputTokensToday: number;
    outputTokensToday: number;
    tokensToday: number;
  };
  platform: {
    budget: AiPlatformBudget;
    used: {
      requestsToday: number;
      tokensToday: number;
      requestsThisMonth: number;
      tokensThisMonth: number;
    };
  };
}

/* =========================================================
   METADATA
========================================================= */

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/ai${path}`, {
    headers: await authHeaders(),
    signal,
  });

  if (!response.ok) {
    throw toAiError(await readErrorBody(response), response.status);
  }

  return (await response.json()) as T;
}

/* Which models this learner can run, and their limits. */
export function fetchAiRuntimeInfo(
  signal?: AbortSignal
): Promise<AiRuntimeInfo> {
  return getJson<AiRuntimeInfo>("/models", signal);
}

/* Today's spend, for the usage meter. */
export function fetchAiUsage(
  signal?: AbortSignal
): Promise<AiUsageReport> {
  return getJson<AiUsageReport>("/usage", signal);
}

/* =========================================================
   STREAMING
========================================================= */

export interface AiStreamHandlers {
  onStart?: (info: AiStartInfo) => void;
  /* Fires once, between `start` and the first token, when the
     request asked for knowledge retrieval. */
  onRetrieval?: (info: AiRetrievalInfo) => void;
  /* Fires once, in the same window, when the request allowed a
     web search — whether or not one actually happened. */
  onWebSearch?: (info: AiWebSearchInfo) => void;
  /* Fires once, in the same window, when the message carried
     attachments — including when the capability was off and
     they were therefore ignored. */
  onFileAnalysis?: (info: AiFileAnalysisInfo) => void;
  /* Fires once, in the same window, when the request allowed
     memory — whether or not anything was recalled. */
  onMemory?: (info: AiMemoryInfo) => void;
  onDelta: (text: string) => void;
  onDone?: (info: AiDoneInfo) => void;
  /*
   * Fires AFTER `done`, when memory was allowed and the write
   * finished in time to be reported.
   *
   * The only handler that can fire after the answer is
   * complete, because it describes something that had not
   * finished happening when the answer started. It may not fire
   * at all on a slow write — the memory is still stored, and
   * the Memory section shows it — so nothing should depend on
   * it having run.
   */
  onMemoryWrite?: (info: AiMemoryWriteInfo) => void;
  /*
   * The three action handlers, and the only ones that can fire
   * repeatedly within a single turn. A consumer that treats
   * them as "set once" will show the last step and lose the
   * trace, which is the thing worth seeing.
   */
  onToolCall?: (info: AiToolCallInfo) => void;
  onToolResult?: (info: AiToolResultInfo) => void;
  onToolLimit?: (info: AiToolLimitInfo) => void;
  /*
   * A file now exists, fired after the result of the step that
   * made it.
   *
   * Separate from `onToolResult` because a result is a line of
   * summary text the panel prints, and this is a thing with an
   * id that can be downloaded. Keeping them apart is also what
   * makes the download button honest: it is rendered from this
   * event, never from what the answer said, so an agent that
   * claims a report it did not make shows no button beside its
   * own prose.
   */
  onDocument?: (info: AiDocumentInfo) => void;
  /*
   * A reply now exists and is waiting for a person.
   *
   * Same contract as `onDocument`: the card is built from this
   * event, never from the prose beside it, which is what makes
   * "drafted" and "sent" impossible for an agent to blur.
   */
  onEmailDraft?: (info: AiEmailDraftInfo) => void;
}

/*
 * Streams a completion, calling `onDelta` as text arrives.
 *
 * Resolves when the server has sent `done`. Rejects with an
 * AiError for everything else — including a stream that simply
 * stops, which is the one failure a naive reader mistakes for
 * success.
 *
 * Cancellation is the caller's AbortSignal. Aborting closes the
 * socket, which the server turns into an aborted provider
 * request, so pressing stop actually stops the spend rather than
 * just hiding the output.
 */
export async function streamChat(
  request: AiChatRequest,
  handlers: AiStreamHandlers,
  signal?: AbortSignal
): Promise<AiDoneInfo> {
  let response: Response;

  try {
    response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ ...request, stream: true }),
      signal,
    });
  } catch (error) {
    if (isAbort(error, signal)) {
      throw new AiError("cancelled", "Stopped.");
    }

    throw new AiError(
      "provider_unavailable",
      "Could not reach BuildGentic. Check your connection and try again."
    );
  }

  if (!response.ok) {
    throw toAiError(await readErrorBody(response), response.status);
  }

  if (!response.body) {
    throw new AiError(
      "connection_lost",
      "The AI response could not be read. Please try again."
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let done: AiDoneInfo | null = null;
  let streamError: AiError | null = null;

  function dispatch() {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }

    const raw = dataLines.join("\n");
    dataLines = [];

    const name = eventName;
    eventName = "";

    let payload: unknown;

    try {
      payload = JSON.parse(raw);
    } catch {
      streamError = new AiError(
        "provider_malformed_response",
        "The AI response could not be read. Please try again."
      );
      return;
    }

    switch (name) {
      case "start":
        handlers.onStart?.(payload as AiStartInfo);
        break;

      case "retrieval":
        handlers.onRetrieval?.(payload as AiRetrievalInfo);
        break;

      case "web_search":
        handlers.onWebSearch?.(payload as AiWebSearchInfo);
        break;

      case "file_analysis":
        handlers.onFileAnalysis?.(payload as AiFileAnalysisInfo);
        break;

      case "memory":
        handlers.onMemory?.(payload as AiMemoryInfo);
        break;

      case "memory_write":
        handlers.onMemoryWrite?.(payload as AiMemoryWriteInfo);
        break;

      case "tool_call":
        handlers.onToolCall?.(payload as AiToolCallInfo);
        break;

      case "tool_result":
        handlers.onToolResult?.(payload as AiToolResultInfo);
        break;

      case "tool_limit":
        handlers.onToolLimit?.(payload as AiToolLimitInfo);
        break;

      case "document":
        handlers.onDocument?.(payload as AiDocumentInfo);
        break;

      case "email_draft":
        handlers.onEmailDraft?.(payload as AiEmailDraftInfo);
        break;

      case "delta":
        handlers.onDelta((payload as { text: string }).text);
        break;

      case "done":
        done = payload as AiDoneInfo;
        handlers.onDone?.(done);
        break;

      case "error":
        streamError = toAiError(payload as WireError, 500);
        break;

      default:
        /* An event type this client has not learned. Ignoring it
           is right: the server may add one, and an old tab
           should keep working. */
        break;
    }
  }

  try {
    for (;;) {
      const { done: finished, value } = await reader.read();

      if (finished) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");

      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);

        if (line === "") {
          dispatch();
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }

        newline = buffer.indexOf("\n");
      }

      if (streamError) {
        break;
      }
    }

    /* A final event with no trailing blank line. */
    if (!streamError && dataLines.length > 0) {
      dispatch();
    }
  } catch (error) {
    if (isAbort(error, signal)) {
      throw new AiError("cancelled", "Stopped.");
    }

    throw new AiError(
      "connection_lost",
      "The connection dropped while the AI was answering."
    );
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* Already closed. */
    }
  }

  if (streamError) {
    throw streamError;
  }

  if (!done) {
    /*
     * The stream ended without saying it was finished. The text
     * already shown is real but incomplete, and telling the
     * learner it is complete would be a lie the UI cannot take
     * back.
     */
    throw new AiError(
      "connection_lost",
      "The AI response stopped partway through. Please try again."
    );
  }

  return done;
}

/*
 * The whole answer in one call, for callers that have nothing to
 * do with the text until it is finished. Same runtime, same
 * quota, same usage row.
 */
export async function sendChat(
  request: AiChatRequest,
  signal?: AbortSignal
): Promise<{
  text: string;
  finishReason: AiDoneInfo["finishReason"];
  usage: AiUsage;
  latencyMs: number;
}> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ ...request, stream: false }),
    signal,
  });

  if (!response.ok) {
    throw toAiError(await readErrorBody(response), response.status);
  }

  return await response.json();
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}
