import { AiRuntimeError } from "./errors";
import { requestLimits } from "./config";
import { countInputChars } from "./tokens";
import type {
  AiFeature,
  ChatMessage,
  ChatRole,
  GenerationSettings,
  ModelDescriptor,
  ModelRequest,
  QuotaLimits,
} from "./types";

/*
 * Everything a client sends is treated as hostile until it has
 * been through this file.
 *
 * The rule is that nothing structural is inferred. A missing
 * field is a rejection, not a default, wherever the default
 * would cost money or change meaning — and where a default is
 * genuinely safe (temperature, model) it comes from the server's
 * own catalogue rather than from the body.
 *
 * Every failure is `invalid_request` with a message naming the
 * field, because a validator that says "invalid input" is a
 * validator you debug by guessing.
 */

function reject(message: string): never {
  throw new AiRuntimeError("invalid_request", message);
}

/*
 * Features a browser is allowed to name for itself.
 *
 * `agent_public` is deliberately absent. A public agent is
 * answered by a server-side caller that builds its own body from
 * a stored configuration, so a browser naming it would be
 * claiming to be something it is not.
 *
 * `agent_index` and `agent_retrieval` are absent for the same
 * reason. Both are written by EmbeddingRuntime on a call this
 * server decided to make; a browser naming one would be
 * mislabelling its own chat as an embedding, and the ledger's
 * only job is to say truthfully what was spent on what.
 */
const CLIENT_FEATURES: AiFeature[] = [
  "lab",
  "compare",
  "agent_test",
  "dev_harness",
];

/*
 * Canonical 8-4-4-4-12 hex. Checked because `agentId` is written
 * straight into a uuid column, and a malformed value would fail
 * in the SQL cast — a 500 for what is plainly a bad request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLES: ChatRole[] = ["system", "user", "assistant"];

function isRole(value: unknown): value is ChatRole {
  return typeof value === "string" && ROLES.includes(value as ChatRole);
}

export interface ParsedChatBody {
  model?: string;
  system?: string;
  messages: ChatMessage[];
  settings: GenerationSettings;
  feature: AiFeature;
  /*
   * Which saved agent this call belongs to, recorded on the
   * usage row so agent traffic can be told from Lab traffic
   * without guessing.
   *
   * Not ownership-checked, and that is a decision rather than an
   * omission. `ai_usage.agent_id` carries no foreign key and is
   * read by nothing but analytics; the row's `user_id` is always
   * the authenticated caller and ai_usage is owner-READ under
   * RLS. So the worst a forged id achieves is mislabelling a row
   * that only the forger can ever see. Verifying it would put a
   * select on the hot path of every agent request to prevent
   * that, which is a bad trade. The public agent endpoint in a
   * later phase resolves the agent server-side and gets
   * ownership for free.
   */
  agentId?: string;
  /*
   * Whether this call should search the agent's indexed
   * knowledge before answering.
   *
   * Only meaningful alongside `agentId`, and safe to accept
   * from a browser for the same reason `agentId` is: retrieval
   * is scoped in SQL to the authenticated caller's own rows, so
   * the most a forged value achieves is searching an agent the
   * forger already owns. The deployed endpoint does not accept
   * it at all — it sets the flag from the stored agent's
   * capabilities, which is the only place it can honestly come
   * from when the caller is not the owner.
   */
  knowledgeRetrieval: boolean;
  /*
   * Whether this call may search the live web before answering.
   *
   * A permission, not an instruction. Setting it does not make
   * the agent search — the runtime asks the model whether the
   * question needs looking up, and most do not. What it does
   * is decide whether that question is ever asked.
   *
   * Safe to accept from a browser for the same reason
   * `knowledgeRetrieval` is: the caller is the account holder,
   * every search is counted against their own quota key in
   * their own windows, and the queries are written by the model
   * and constrained server-side. The most a forged value
   * achieves is spending the forger's own search allowance.
   *
   * The deployed endpoint does not accept it at all — it sets
   * the flag from the stored agent's capabilities, which is the
   * only place it can honestly come from when the caller is not
   * the owner.
   */
  webSearch: boolean;
  /*
   * Whether this call may read the files attached to it.
   *
   * A permission, exactly like `webSearch`, and it exists
   * separately from `attachments` below for a reason worth
   * spelling out: switching the capability off must stop an
   * agent reading files, not merely stop the Builder offering
   * the paperclip. A caller who sent attachments with the
   * capability off gets them ignored, and is told so, rather
   * than getting an agent that quietly still reads them.
   *
   * Safe to accept from a browser for the same reason the other
   * two flags are: the caller is the account holder, every
   * upload is counted against their own quota key in their own
   * windows, and an attachment id only resolves for the scope
   * that created it. The deployed endpoint does not accept it
   * at all — it sets the flag from the stored agent's
   * capabilities, which is the only place it can honestly come
   * from when the caller is not the owner.
   */
  fileAnalysis: boolean;
  /*
   * Whether this call may remember, and be reminded of, things
   * about the person it is talking to.
   *
   * A permission, exactly like the three above, and the one
   * whose off-state is the most important to honour. Switching
   * Memory off must stop an agent both reading and writing —
   * an agent that quietly kept recording after somebody turned
   * the switch off would be the single worst failure this
   * capability could have.
   *
   * Unlike the other three it is only meaningful alongside
   * `agentId`, because memories hang off an agent rather than
   * off a learner: this is `User -> Agent -> Memories`, so an
   * unsaved draft has nothing to hang them on. The runtime
   * reports that as `no_agent` rather than ignoring the flag,
   * because "save this first" is a state to fix and silence
   * would look exactly like a broken switch.
   *
   * Safe to accept from a browser for the reason the others
   * are: the caller is the account holder, the scope is
   * resolved from their own session rather than from anything
   * they sent, and every call is counted against their own
   * quota key. The most a forged value achieves is spending
   * the forger's own memory allowance on an agent they already
   * own. The deployed endpoint does not accept it at all — it
   * sets the flag from the stored agent's capabilities.
   */
  memory: boolean;
  /*
   * Whether this call may run code it writes, in a sandbox.
   *
   * A permission, like the four above, and safe to accept from
   * a browser for a reason worth stating rather than inheriting
   * — because "the caller can only hurt themselves" is a weaker
   * argument when the capability executes code.
   *
   * It holds anyway. The sandbox is not a place a forged flag
   * gets somebody something: it has no filesystem, no
   * subprocesses, no network and no environment, so a learner
   * who switches this on for their own request gains the
   * ability to run arithmetic they could have run in their own
   * browser. What it costs is their own action allowance,
   * counted in their own windows.
   *
   * The deployed endpoint does not accept it at all — it sets
   * the flag from the stored agent's capabilities, which is
   * the only place it can honestly come from when the caller
   * is not the owner.
   */
  codeExecution: boolean;
  /*
   * Whether this call may make outbound HTTP requests.
   *
   * The one flag on this list where a forged value reaches
   * something outside BuildGentic, so it deserves its own
   * paragraph rather than a reference to the others.
   *
   * Still safe from a browser, and for a specific reason: the
   * flag grants the ability to make a request, never the
   * ability to choose where. Public calls are GET-only and go
   * through the address rules in actions/http/addresses.ts,
   * which refuse every private and internal range whatever the
   * caller asked for. Anything authenticated needs a saved
   * connection, and connections are read with the caller's own
   * user id — so a forged flag reaches the forger's own
   * credentials, against the hosts they themselves tied those
   * credentials to.
   *
   * The deployed endpoint does not accept it at all, and here
   * that matters most of anywhere: a caller who could set this
   * would be spending somebody else's saved credentials.
   */
  httpActions: boolean;
  /*
   * Whether this call may produce a file.
   *
   * Safe from a browser for the reason `codeExecution` is: the
   * flag grants the ability to render, never the ability to
   * choose who receives it. A document is written against the
   * caller's own user id and agent id, is reachable only
   * through a session-authenticated route that matches the same
   * user id, and expires. A forged flag makes the forger a file
   * they could already have made by switching the capability on
   * — at the cost of their own action allowance, in their own
   * windows, against their own retention ceiling.
   *
   * The deployed endpoint and the published page do not accept
   * it and do not enable it, and there the reason is structural
   * rather than cautious: neither caller has a session, so
   * neither could fetch what it produced.
   */
  documentGeneration: boolean;
  /*
   * Whether this call may read and write the agent's store.
   *
   * The flag on this list closest in kind to `httpActions`,
   * because it is the other one whose effects outlive the turn
   * — and it is safe from a browser for the same shape of
   * reason. It grants the ability to use a store, never the
   * ability to choose whose: every read and write goes through
   * DataStore with the caller's own user id and the agent id on
   * this body, and the agent id is itself checked against the
   * caller. A forged flag reaches the forger's own records.
   *
   * The deployed endpoint and the published page set it false.
   * A record here is a MODEL-CHOSEN write, unlike a memory,
   * which is only ever the server's own inference — so letting
   * strangers' turns write one is a step to take deliberately
   * rather than by inheritance. See agents/data/scope.ts.
   */
  dataStore: boolean;
  /*
   * Whether this call may read, draft into, or rearrange the
   * caller's mailbox.
   *
   * THE THREE FLAGS WHOSE FORGED VALUE REACHES THE MOST
   * SENSITIVE THING THIS PRODUCT TOUCHES, so they get their own
   * paragraph rather than a reference to the ones above.
   *
   * Still safe from a browser, and the reason is the same shape
   * as `dataStore`'s but has to hold harder. The flag grants
   * the ability to use A mailbox, never the ability to choose
   * WHOSE: `usableAccount` takes the caller's own user id and
   * queries a table the browser has no select on at all, so a
   * forged flag reaches the forger's own inbox — which they
   * could have reached by switching the capability on, at the
   * cost of their own action allowance.
   *
   * The deployed endpoint and the published page do not accept
   * these and do not enable them, and there the reasoning is
   * not about cost. A stranger with a forwarded link would be
   * reading somebody's private correspondence. See
   * deploymentRequest.ts and sites/siteRequest.ts, which both
   * refuse by name.
   *
   * THERE IS NO `emailSend` FIELD ON THIS INTERFACE, and that
   * is deliberate. Sending is not something a chat request can
   * ask for, because it is not something a turn does — it is a
   * separate authenticated POST against a draft a person has
   * read. A field here would be a way to ask, and there must
   * not be one.
   */
  emailRead: boolean;
  emailDraft: boolean;
  emailOrganize: boolean;
  /*
   * Which uploaded files this message is about.
   *
   * Ids, not content. The browser uploads a file once, to a
   * route that validates and reads it, and thereafter refers to
   * it by an opaque id — so a chat request never carries file
   * bytes, and nothing about the file can be re-asserted on the
   * way to the model.
   *
   * Unlike `agentId`, these ARE ownership-checked, and not
   * optionally: `FileStore.get` takes a scope alongside the id
   * and returns nothing when they do not match. An id belonging
   * to another learner is indistinguishable from one that has
   * expired, which is what it should look like.
   *
   * This one field IS accepted from a deployed caller, and it
   * is the only conversational field beyond `messages` that is.
   * An attachment is something the caller is asking about — it
   * is content, like the question itself — not a piece of the
   * agent's configuration.
   */
  attachments: string[];
  /* Streaming is the default; a caller must opt out explicitly. */
  stream: boolean;
}

export function parseChatBody(body: unknown): ParsedChatBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    reject("The request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  /* ----- messages ----- */

  if (!Array.isArray(raw.messages)) {
    reject("messages must be an array.");
  }

  if (raw.messages.length === 0) {
    reject("messages must contain at least one message.");
  }

  if (raw.messages.length > requestLimits.maxMessages) {
    reject(
      `A conversation may contain at most ${requestLimits.maxMessages} messages.`
    );
  }

  const messages: ChatMessage[] = raw.messages.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      reject(`messages[${index}] must be an object.`);
    }

    const item = entry as Record<string, unknown>;

    if (!isRole(item.role)) {
      reject(
        `messages[${index}].role must be one of ${ROLES.join(", ")}.`
      );
    }

    if (typeof item.content !== "string") {
      reject(`messages[${index}].content must be a string.`);
    }

    /*
     * A system turn buried in the array is refused rather than
     * silently promoted. Providers disagree about where system
     * text belongs and about how many are allowed, so the
     * runtime takes exactly one, from its own field, and the
     * adapter decides where to put it.
     */
    if (item.role === "system") {
      reject(
        `messages[${index}] has role "system". Send system instructions in the top-level "system" field instead.`
      );
    }

    if (item.content.length > requestLimits.maxMessageChars) {
      reject(
        `messages[${index}].content is ${item.content.length} characters; the limit is ${requestLimits.maxMessageChars}.`
      );
    }

    return { role: item.role, content: item.content };
  });

  /*
   * A trailing assistant turn means the caller is asking the
   * model to continue its own sentence. Some providers allow it,
   * some reject it, and nothing in BuildGentic needs it — so it is
   * refused here, once, rather than becoming a provider error
   * that reads like an outage.
   */
  if (messages[messages.length - 1].role !== "user") {
    reject("The last message must have role \"user\".");
  }

  /* ----- system ----- */

  let system: string | undefined;

  if (raw.system !== undefined && raw.system !== null) {
    if (typeof raw.system !== "string") {
      reject("system must be a string when supplied.");
    }

    if (raw.system.length > requestLimits.maxSystemChars) {
      reject(
        `system is ${raw.system.length} characters; the limit is ${requestLimits.maxSystemChars}.`
      );
    }

    if (raw.system.trim().length > 0) {
      system = raw.system;
    }
  }

  /* ----- model ----- */

  let model: string | undefined;

  if (raw.model !== undefined && raw.model !== null) {
    if (typeof raw.model !== "string" || raw.model.trim() === "") {
      reject("model must be a non-empty string when supplied.");
    }

    model = raw.model.trim();
  }

  /* ----- generation settings ----- */

  const settings: GenerationSettings = {};

  if (raw.temperature !== undefined && raw.temperature !== null) {
    if (typeof raw.temperature !== "number" || !Number.isFinite(raw.temperature)) {
      reject("temperature must be a number.");
    }

    if (raw.temperature < 0 || raw.temperature > 2) {
      reject("temperature must be between 0 and 2.");
    }

    settings.temperature = raw.temperature;
  }

  if (raw.maxOutputTokens !== undefined && raw.maxOutputTokens !== null) {
    if (
      typeof raw.maxOutputTokens !== "number" ||
      !Number.isInteger(raw.maxOutputTokens)
    ) {
      reject("maxOutputTokens must be an integer.");
    }

    if (raw.maxOutputTokens < 1) {
      reject("maxOutputTokens must be at least 1.");
    }

    settings.maxOutputTokens = raw.maxOutputTokens;
  }

  if (raw.stop !== undefined && raw.stop !== null) {
    if (!Array.isArray(raw.stop)) {
      reject("stop must be an array of strings.");
    }

    if (raw.stop.length > 4) {
      reject("stop may contain at most 4 sequences.");
    }

    if (!raw.stop.every((s) => typeof s === "string" && s.length > 0)) {
      reject("stop must contain only non-empty strings.");
    }

    settings.stop = raw.stop as string[];
  }

  /* ----- feature ----- */

  let feature: AiFeature = "lab";

  if (raw.feature !== undefined && raw.feature !== null) {
    if (
      typeof raw.feature !== "string" ||
      !CLIENT_FEATURES.includes(raw.feature as AiFeature)
    ) {
      reject(
        `feature must be one of ${CLIENT_FEATURES.join(", ")} when supplied.`
      );
    }

    feature = raw.feature as AiFeature;
  }

  /* ----- agent ----- */

  let agentId: string | undefined;

  if (raw.agentId !== undefined && raw.agentId !== null) {
    if (typeof raw.agentId !== "string" || !UUID.test(raw.agentId)) {
      reject("agentId must be a UUID when supplied.");
    }

    agentId = raw.agentId;
  }

  /* ----- knowledge retrieval ----- */

  if (
    raw.knowledgeRetrieval !== undefined &&
    raw.knowledgeRetrieval !== null &&
    typeof raw.knowledgeRetrieval !== "boolean"
  ) {
    reject("knowledgeRetrieval must be a boolean when supplied.");
  }

  /* ----- web search ----- */

  if (
    raw.webSearch !== undefined &&
    raw.webSearch !== null &&
    typeof raw.webSearch !== "boolean"
  ) {
    reject("webSearch must be a boolean when supplied.");
  }

  /* ----- file analysis ----- */

  if (
    raw.fileAnalysis !== undefined &&
    raw.fileAnalysis !== null &&
    typeof raw.fileAnalysis !== "boolean"
  ) {
    reject("fileAnalysis must be a boolean when supplied.");
  }

  /* ----- memory ----- */

  if (
    raw.memory !== undefined &&
    raw.memory !== null &&
    typeof raw.memory !== "boolean"
  ) {
    reject("memory must be a boolean when supplied.");
  }

  const attachments = parseAttachments(raw.attachments);

  /*
   * `powerSource` is deliberately not parsed, and an older
   * client still sending one is ignored rather than refused.
   * There is one payer now.
   */

  /* ----- stream ----- */

  if (raw.stream !== undefined && raw.stream !== null && typeof raw.stream !== "boolean") {
    reject("stream must be a boolean when supplied.");
  }

  return {
    model,
    system,
    messages,
    settings,
    feature,
    agentId,
    knowledgeRetrieval: raw.knowledgeRetrieval === true,
    webSearch: raw.webSearch === true,
    fileAnalysis: raw.fileAnalysis === true,
    memory: raw.memory === true,
    codeExecution: raw.codeExecution === true,
    httpActions: raw.httpActions === true,
    documentGeneration: raw.documentGeneration === true,
    dataStore: raw.dataStore === true,
    emailRead: raw.emailRead === true,
    emailDraft: raw.emailDraft === true,
    emailOrganize: raw.emailOrganize === true,
    attachments,
    stream: raw.stream === undefined || raw.stream === null ? true : raw.stream,
  };
}

/*
 * The attachment ids on a message.
 *
 * Checked for shape here and for ownership later, in
 * FileStore.get — the split is deliberate. A malformed id is a
 * bad request and should cost one regex; a well-formed id
 * belonging to somebody else is an authorisation question and
 * needs the store to answer it.
 *
 * The count limit is enforced in attach.ts rather than here,
 * where it can name the configured maximum in a sentence a
 * learner can act on. This one is a raw guard against a caller
 * posting a hundred thousand ids to make the server do a
 * hundred thousand map lookups.
 */
const MAX_RAW_ATTACHMENTS = 64;

function parseAttachments(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    reject("attachments must be an array of file ids.");
  }

  if (raw.length > MAX_RAW_ATTACHMENTS) {
    reject(`attachments may contain at most ${MAX_RAW_ATTACHMENTS} ids.`);
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "string" || !UUID.test(entry)) {
      reject(`attachments[${index}] must be a file id.`);
    }

    return entry;
  });
}

/*
 * Turns a parsed body plus a resolved model into the request an
 * adapter runs.
 *
 * This is where the quota's size limits bite, and where the two
 * ceilings meet: whatever the caller asked for is clamped by the
 * power source's budget and then by what the model itself can
 * actually produce.
 */
export function buildModelRequest(
  parsed: ParsedChatBody,
  model: ModelDescriptor,
  limits: QuotaLimits
): ModelRequest {
  const inputChars = countInputChars(parsed.messages, parsed.system);

  if (limits.maxInputChars > 0 && inputChars > limits.maxInputChars) {
    throw new AiRuntimeError(
      "invalid_request",
      `This conversation is ${inputChars.toLocaleString()} characters. The limit is ${limits.maxInputChars.toLocaleString()}. Shorten it or start a new one.`
    );
  }

  const requested =
    parsed.settings.maxOutputTokens ?? model.defaultMaxOutputTokens;

  const ceiling =
    limits.maxOutputTokens > 0
      ? Math.min(limits.maxOutputTokens, model.maxOutputTokens)
      : model.maxOutputTokens;

  return {
    model: model.id,
    system: parsed.system,
    messages: parsed.messages,
    settings: {
      temperature: parsed.settings.temperature ?? model.defaultTemperature,
      maxOutputTokens: Math.max(1, Math.min(requested, ceiling)),
      stop: parsed.settings.stop,
    },
  };
}
