import type { WebSearchTelemetry } from "../search/types";

/*
 * The contracts the AI runtime is built from.
 *
 * Nothing in here names a vendor. A provider adapter implements
 * `AiProvider`, the runtime and every caller above it speak only
 * these shapes, and adding a second provider is one new file plus
 * one `register()` call — no change to routes, to the Lab, or to
 * the future Agent Builder.
 */

/* =========================================================
   PROVIDERS AND POWER SOURCES
========================================================= */

/*
 * Registered adapters. `mock` is always present and needs no
 * credentials; it is what the runtime falls back to when no
 * platform key is configured, so the whole app runs end to end
 * on a fresh clone.
 */
export type ProviderId =
  | "mock"
  | "groq"
  | "cloudflare"
  | "openrouter"
  | "mistral"
  /*
   * Embeddings only, and on its way out.
   *
   * Gemini no longer serves a single completion — it is not in
   * the cascade and cannot be reached by one. It survives here
   * because agent_knowledge_chunks and agent_memories hold
   * 768-dimension vectors it produced, and those must stay
   * searchable by a query embedded the same way until the
   * embedding path is repointed. See embeddingModels.ts.
   */
  | "gemini";

/*
 * Who is paying for a call.
 *
 *   platform — BuildGentic's own key. The default for every learner.
 *   byok     — the learner's own provider key.
 *   managed  — platform key on a higher tier. Not built.
 *
 * Stored verbatim in ai_usage.power_source_kind, which is what
 * lets the platform budget count platform traffic and ignore
 * traffic a learner is paying for themselves.
 */
export type PowerSourceKind = "platform" | "byok" | "managed";

/*
 * What part of the product is spending. Recorded on every usage
 * row so a later phase can tell Lab traffic from agent traffic
 * without guessing.
 */
export type AiFeature =
  | "lab"
  | "compare"
  | "agent_test"
  | "agent_public"
  /*
   * The spend a published page adds: a visitor who followed a
   * link, asking a student's agent a question.
   *
   * Separated from `agent_public` even though both are the
   * owner paying for somebody else's question, because the
   * somebody else is different in a way an owner reading a
   * bill needs to see. An `agent_public` row is an application
   * its owner wired up on purpose; an `agent_site` row is a
   * stranger with a URL. Not nameable by a browser, for the
   * same reason `agent_public` is not — routes/sites.ts sets
   * it, so nothing else gets to claim it.
   */
  | "agent_site"
  /*
   * The spend a natural-language page edit costs: one small
   * call that turns "make the background darker" into a field
   * change.
   *
   * Its own value rather than folding into `agent_site`,
   * because the two are opposite sides of the same page. An
   * `agent_site` row is a visitor spending the owner's
   * allowance; this is the OWNER spending their own while
   * building. An owner asking "what is my page costing me"
   * means the first and not the second.
   */
  | "site_edit"
  | "vibe"
  | "dev_harness"
  /*
   * The two spends retrieval adds. Separated from `agent_test`
   * and `agent_public` because they answer a different question:
   * these rows say what it cost to make an agent's knowledge
   * searchable and to search it, not what it cost to answer.
   *
   * Neither is nameable by a browser. See CLIENT_FEATURES.
   */
  | "agent_index"
  | "agent_retrieval"
  /*
   * The spend Web Search adds: the small model call that
   * decides whether to look something up, and the search
   * provider calls that follow it.
   *
   * One feature covering both because they answer one question
   * — what did searching cost — and because a decision that
   * concluded "no search needed" is part of that cost even
   * though no search happened. Not nameable by a browser, for
   * the same reason `agent_public` is not: this server decides
   * to make these calls, so nothing else gets to claim them.
   */
  | "agent_web_search"
  /*
   * The spend File Analysis adds: reading an uploaded file and
   * turning it into text the model can be given.
   *
   * No model runs, and the row says so by reporting zero
   * tokens — the same honesty a `web-search` row carries. What
   * it records is that this server spent CPU, memory and time
   * on somebody's behalf, which is a cost with no token column
   * and therefore one only the request counters can bound.
   *
   * Not nameable by a browser, for the same reason
   * `agent_web_search` is not: this server decides to do the
   * work, so nothing else gets to claim it. See CLIENT_FEATURES.
   */
  | "agent_file_analysis"
  /*
   * The spend Memory adds: the small model call that reads a
   * conversation and decides whether anything in it is worth
   * keeping, and the embedding of a memory as it is written or
   * of a question as it is recalled against.
   *
   * One feature covering all of it because they answer one
   * question — what did remembering cost — and because a turn
   * that concluded "nothing worth keeping here" is part of
   * that cost even though nothing was stored. Rows are told
   * apart by `model`: an extraction carries the answering
   * model's id, an embedding carries the embedding model's.
   *
   * Not nameable by a browser, for the same reason the four
   * above are not. See CLIENT_FEATURES.
   */
  | "agent_memory"
  /*
   * The spend Actions adds: the tools an agent runs between
   * the question and the answer, and the extra model calls
   * that read what came back.
   *
   * One feature covering both halves because they answer one
   * question — what did acting cost — and because the two are
   * inseparable in practice: a tool result nothing reads is
   * not a step, and a step with no tool in it is just the
   * answer. Rows are told apart by `model`, exactly as memory
   * rows are: a tool execution carries `tool:<id>` where a
   * model id would go, a continuation step carries the real
   * answering model.
   *
   * Not nameable by a browser, for the same reason the five
   * above are not: this server decides to make these calls,
   * and a caller who could name them could label their own
   * chat as somebody else's automation. See CLIENT_FEATURES.
   */
  | "agent_action"
  /*
   * The turn a SCHEDULE provoked: one model call, plus
   * whatever the action loop did inside it.
   *
   * Its own value rather than reusing `agent_test`, and the
   * distinction is the whole reason it exists. An `agent_test`
   * row is a learner sitting in the Builder pressing Run. One
   * of these is this server deciding, on a timer, to spend
   * that learner's allowance while they are asleep. Somebody
   * reading the ledger to answer "what is this account
   * spending on" needs those to be different words.
   *
   * It names WHO ASKED, not what ran: the tool rows a
   * scheduled turn writes still carry `agent_action`, because
   * a sandbox execution costs the same whoever provoked it.
   *
   * Not nameable by a browser, and here that matters more than
   * anywhere above it. A caller who could name this feature
   * could label an interactive request as automation — and
   * automation is the one category that is allowed to run with
   * nobody watching. See CLIENT_FEATURES.
   */
  | "agent_scheduled"
  /*
   * The turn a BROWSER EXTENSION provoked: the owner, in a side
   * panel, on some other website.
   *
   * Its own value rather than reusing `agent_test`, on the same
   * argument `agent_scheduled` makes one paragraph up. Both are
   * the same composed prompt through the same runChat, and both
   * are priced identically to a Builder test — but somebody
   * reading the ledger to answer "what is this account spending
   * on" needs "pressing Run in the Builder" and "asking from a
   * side panel while reading something else" to be different
   * words. They are different behaviours by the person, and one
   * of them may have carried a page.
   *
   * It names WHO ASKED, not what ran. The tool rows an
   * extension turn writes still carry `agent_action`.
   *
   * NOT NAMEABLE BY A BROWSER. The extension does not name it
   * either — agents/extensionRequest.ts hardcodes it, the way
   * scheduledRequest.ts and deploymentRequest.ts hardcode
   * theirs. A caller who could name it would be claiming to be
   * that file, and that file does not have to claim anything.
   * See CLIENT_FEATURES.
   */
  | "agent_extension";

/*
 * Provider credentials.
 *
 * Deliberately an object rather than a bare string: a BYOK key
 * will need to carry its own id so usage can be billed to it,
 * and a self-hosted provider will need a base URL. Widening this
 * later must not touch every adapter signature.
 *
 * This value never leaves the server process. It is not part of
 * any response shape and must never be logged.
 */
export interface ProviderCredentials {
  apiKey?: string;
  /* Set for byok, so usage can be attributed to the key. */
  keyId?: string;
}

/* =========================================================
   MODELS
========================================================= */

export interface ModelDescriptor {
  /*
   * The id the client sends. NOT the id a provider receives —
   * those live on ChainCandidate and never leave the server.
   */
  id: string;
  displayName: string;
  /* One line, shown wherever the AI is described. */
  blurb: string;
  contextWindow: number;
  maxOutputTokens: number;
  /* Used when the caller sends no generation settings. */
  defaultTemperature: number;
  defaultMaxOutputTokens: number;

  /*
   * How to tell THIS model to reason as little as possible.
   *
   * Some models think before answering and bill those tokens
   * without ever showing them. Left on, that produces answers
   * that are slower, dearer, and occasionally empty — which is
   * indefensible in a Lab whose whole job is showing a learner
   * what their prompt did.
   *
   * Spelled out per model rather than inferred, because the
   * encoding is not stable across a vendor's own generations:
   * Gemini 2.x took `thinkingBudget: 0` and Gemini 3.x rejects
   * that outright in favour of `thinkingLevel`. A boolean here
   * would silently send the wrong dialect to the next model
   * added, and the resulting 400 says only "invalid argument".
   */
  minimalThinking?: Record<string, string | number>;

  /*
   * Whether this model can actually look at an image.
   *
   * Written down per model rather than assumed per provider,
   * because it is not a provider-wide fact: vendors ship
   * text-only and multimodal models side by side under the same
   * key, and the mock is text-only in a way no amount of
   * hopefulness changes.
   *
   * Load-bearing rather than descriptive. File Analysis refuses
   * an image on a model without this flag and says why, because
   * the alternative — sending it and letting the provider drop
   * it — produces an agent that confidently describes a picture
   * it never received. That is the single worst failure this
   * capability could have, and it is silent.
   */
  vision?: boolean;
}

/* =========================================================
   EMBEDDINGS

   A second thing a provider can be asked for, and deliberately
   not a second runtime. An embedding is a model call: it costs
   money, it needs a key, and it has to be counted. So it
   resolves through the same PowerSourceResolver, takes a slot
   from the same quota gate, and closes a row in the same
   ai_usage table as a completion does.

   What it is NOT is part of `AiProvider.stream`. Embedding and
   completion are different endpoints with different shapes, and
   several vendors serve one without the other — Anthropic and
   OpenRouter have no embeddings API at all. Folding them
   together would force those two adapters to implement a method
   that can only throw.
========================================================= */

/*
 * What the vector is for.
 *
 * Not cosmetic. Google asks for this explicitly and returns
 * measurably better matches when it is told, because "a passage
 * somebody might search for" and "the thing somebody typed into
 * a search box" are different shapes of text. Providers that do
 * not distinguish them ignore it.
 */
export type EmbeddingPurpose = "document" | "query";

export interface EmbeddingRequest {
  /* The id the provider receives. */
  model: string;
  /* One vector comes back per entry, in this order. */
  texts: string[];
  purpose: EmbeddingPurpose;
  /*
   * How wide the vector should be. Asked for explicitly rather
   * than accepted, because the column that stores it is a fixed
   * width and a provider quietly changing its default would
   * make every insert fail.
   */
  dimensions: number;
}

export interface EmbeddingResult {
  /* Same length and same order as `texts`. */
  vectors: number[][];
  /* Only when the provider reports it. Estimated otherwise, and
     `reported` on the usage row says which. */
  inputTokens?: number;
}

export interface EmbeddingModelDescriptor {
  id: string;
  provider: ProviderId;
  displayName: string;
  /* Fixed, and the same across the catalogue: one database
     column has to hold all of them. */
  dimensions: number;
  /* Per text. Longer than any chunk the chunker will produce. */
  maxInputChars: number;
  /* How many texts may go in one request. One provider call is
     one usage row, so this is also the batching factor. */
  maxBatch: number;
  availableTo: PowerSourceKind[];
}

/* =========================================================
   REQUESTS
========================================================= */

export type ChatRole = "system" | "user" | "assistant";

/*
 * An image travelling with a message.
 *
 * The one thing in a request that is not text, and it is here
 * rather than in the system prompt because an image cannot be
 * described into one. A PDF becomes words and joins the
 * reference block; a photograph has to reach the provider as
 * pixels or it has not reached it at all.
 *
 * Base64 rather than a URL, deliberately. A URL would mean the
 * provider fetching something from BuildGentic, which means
 * BuildGentic serving uploaded files at an address — and an
 * address is exactly what "files should not become permanently
 * accessible because somebody knows a URL" rules out. Inline
 * bytes never leave the request they belong to.
 *
 * Only ever attached to the last user turn. An image belongs to
 * the question that was asked with it, and re-sending it on
 * every subsequent turn would bill a learner for the same
 * photograph five times.
 */
export interface ChatImage {
  /* Sanitised. Shown to the model so it can say which image it
     is talking about when there are two. */
  name: string;
  /* image/png or image/jpeg. Decided by magic bytes, never by
     what the upload claimed. */
  mediaType: string;
  dataBase64: string;
  width: number;
  height: number;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /*
   * Present only on a user turn carrying attached images, and
   * only on the last one. Adapters that can send images render
   * them; the runtime refuses before it gets that far if the
   * chosen model cannot — see `vision` on ModelDescriptor.
   */
  images?: ChatImage[];
}

export interface GenerationSettings {
  temperature?: number;
  maxOutputTokens?: number;
  stop?: string[];
}

/*
 * A validated model call.
 *
 * By the time this shape exists the model has been checked
 * against the catalogue and every field has been range-checked,
 * so an adapter can use it without re-validating.
 *
 * `system` is separate from `messages` because providers differ
 * on where system instructions belong, and that difference is an
 * adapter's problem, not a caller's.
 */
export interface ModelRequest {
  model: string;
  /*
   * Extra body fields for whichever provider is about to serve
   * this, merged verbatim by the adapter.
   *
   * Set per candidate rather than per request, because the same
   * conversation is sent to different vendors as the cascade
   * falls through and each spells its own controls differently.
   * Today this carries one thing: the reasoning suppression that
   * stops a thinking model spending a learner's whole output cap
   * on thoughts nobody sees. See ChainEntry.thinking.
   */
  providerOptions?: Record<string, string | number>;
  system?: string;
  messages: ChatMessage[];
  settings: Required<Pick<GenerationSettings, "temperature" | "maxOutputTokens">> &
    Pick<GenerationSettings, "stop">;
}

/* =========================================================
   RESPONSES
========================================================= */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /*
   * True when the provider reported these numbers. False means
   * they were estimated from character counts, which matters if
   * they are ever used for anything but a rough meter.
   */
  reported: boolean;
}

export type FinishReason =
  | "stop"
  | "length"
  | "filtered"
  | "cancelled"
  | "error";

/*
 * What an adapter yields while streaming.
 *
 * `delta` carries only new text, never the accumulated answer —
 * the transport re-emits these verbatim, so an adapter that
 * resent the whole string would quadruple the bytes on the wire
 * and force the UI to diff.
 */
export type ProviderStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: FinishReason; usage?: TokenUsage };

export interface AiProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /*
   * Whether this adapter can run at all with the credentials it
   * was handed. Checked before admission so a missing key costs
   * nothing and produces a clear error instead of a provider
   * round trip.
   */
  isConfigured(credentials: ProviderCredentials): boolean;

  /*
   * Cheap liveness check for a key the learner just pasted.
   *
   * Each provider decides what "valid" means and which endpoint
   * answers it — that is exactly the knowledge BYOK must not
   * hardcode centrally. Should be the cheapest authenticated
   * call the provider offers, and must never echo the key.
   */
  validateCredentials(
    credentials: ProviderCredentials,
    signal: AbortSignal
  ): Promise<CredentialCheck>;

  /*
   * Streams a completion. Must throw AiRuntimeError — never a
   * raw provider error — and must respect `signal`, both for
   * client disconnects and for the runtime's timeout.
   */
  stream(
    request: ModelRequest,
    credentials: ProviderCredentials,
    signal: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent>;

  /*
   * Turns text into vectors, for the adapters that can.
   *
   * Optional, and the optionality is the honest part: Anthropic
   * and OpenRouter publish no embeddings endpoint, so their
   * adapters leave this undefined rather than implementing a
   * method whose only behaviour is to throw. A learner whose
   * only connected key is one of those is told plainly that
   * their knowledge cannot be indexed yet, which is a sentence
   * they can act on.
   *
   * Must return exactly one vector per input, in order, and must
   * throw AiRuntimeError like `stream` does.
   */
  embed?(
    request: EmbeddingRequest,
    credentials: ProviderCredentials,
    signal: AbortSignal
  ): Promise<EmbeddingResult>;
}

/*
 * The answer to "does this key work?".
 *
 * `reason` is written for the person who just pasted it — "that
 * key was rejected", not an HTTP status — because they are the
 * only one who can fix it.
 */
export interface CredentialCheck {
  valid: boolean;
  reason?: string;
}

/* =========================================================
   QUOTAS
========================================================= */

/*
 * Every limit is configurable and every one is enforced
 * server-side. A zero disables that particular limit, which is
 * useful in development and is why the SQL checks `> 0`.
 */
export interface QuotaLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  maxConcurrent: number;
  /*
   * Input ceiling, in characters rather than tokens: it has to
   * be checked before anything is sent anywhere, and characters
   * are the only thing that can be counted exactly without a
   * tokenizer.
   */
  maxInputChars: number;
  maxOutputTokens: number;
  /*
   * The one that actually tracks money. Counting requests treats
   * a 20-token turn and a 6,000-token turn as equal when they
   * differ by orders of magnitude in cost.
   */
  tokensPerDay: number;
}

/*
 * The ceilings that bound what BuildGentic itself can be billed,
 * counted across every learner rather than per learner.
 *
 * Per-user limits stop one person looping. Only these stop a
 * thousand people — or a thousand throwaway signups — from each
 * politely staying under their own allowance.
 *
 * Applies to platform traffic alone. A learner spending their
 * own provider credits is not part of BuildGentic's bill.
 */
export interface PlatformBudget {
  dailyRequests: number;
  dailyTokens: number;
  monthlyRequests: number;
  monthlyTokens: number;
}

/*
 * One provider that could answer this request, already holding
 * the key it would use.
 *
 * `model` is the concrete vendor model id — "llama-3.3-70b" and
 * the like. It is the thing the learner must never see, and the
 * reason it lives here rather than on ModelDescriptor: the
 * public catalogue has one entry called "BuildGentic", and which
 * of these actually served a turn is not part of the answer.
 *
 * `entry` is null for the mock, which has no chain entry and no
 * rate window to respect.
 */
export interface ChainCandidate {
  providerId: ProviderId;
  model: string;
  credentials: ProviderCredentials;
  entry: ChainEntryLimits | null;
  /* Merged into the request body when this candidate serves.
     See ChainEntry.thinking. */
  thinking?: Record<string, string | number>;
}

/* The slice of a chain entry ProviderHealth needs. Declared
   structurally so types.ts does not have to import config. */
export interface ChainEntryLimits {
  providerId: ProviderId;
  requestsPerMinute: number;
  tokensPerMinute: number;
  vision: boolean;
}

export interface ResolvedPowerSource {
  kind: PowerSourceKind;
  /* What limits are counted against. See the migration. */
  quotaKey: string;
  limits: QuotaLimits;
  /* Models this power source is allowed to reach. */
  allowedModels: ModelDescriptor[];
  defaultModel: string;

  /*
   * The cascade, in priority order, as it stood when this
   * request arrived.
   *
   * Always walked from index 0 — see resolveChain. A request
   * that ends up on candidates[3] tells you nothing about where
   * the next one starts.
   */
  candidates: ChainCandidate[];

  /*
   * Credentials per provider, resolved once the model — and
   * therefore the provider — is known.
   *
   * A map rather than a single value because BYOK is not one
   * provider: a learner may hold an OpenAI key and an Anthropic
   * key, and which one is used depends on the model they picked.
   *
   * Never serialised, never logged, never leaves the process.
   */
  credentials: Map<ProviderId, ProviderCredentials>;
}

/* =========================================================
   RUNTIME
========================================================= */

/*
 * What the runtime yields to a transport.
 *
 * `start` exists so the UI can show which model actually
 * answered before the first token arrives — the caller may have
 * sent no model at all and taken the default.
 */
export type RuntimeStreamEvent =
  /*
   * Emitted before the first token so the UI can commit to a
   * turn having begun.
   *
   * It used to carry `model`, `provider` and `powerSource`, and
   * carries none of them now. That is the single most important
   * line in this file: `provider` was the leak. Under a cascade
   * it would have named whichever of four vendors happened to be
   * free, on a per-request basis, to a learner who is only ever
   * talking to BuildGentic — and the SSE frame reached the browser,
   * so "we just do not render it" would not have been enough.
   *
   * Which model answered is still recorded on the ai_usage row,
   * server-side, where the operator can see it and nobody else
   * can.
   */
  | { type: "start" }
  /*
   * What the agent looked up before it answered, emitted once,
   * between `start` and the first `delta`.
   *
   * It exists so the Builder can show a learner that asking
   * about photosynthesis pulled the biology pages and nothing
   * else — which is the entire lesson of this capability, and is
   * invisible if the only evidence is a shorter prompt.
   *
   * Owner-facing only. The deployed endpoint does not forward
   * it: what an agent knows, and how sure it was, are facts
   * about somebody else's configuration.
   */
  | {
      type: "retrieval";
      sources: RetrievedSource[];
      /* Present when nothing was retrieved, saying why. */
      reason?: RetrievalReason;
    }
  /*
   * What the agent looked up on the web before it answered,
   * emitted once, between `start` and the first `delta`.
   *
   * It carries the whole of the capability's telemetry —
   * whether a search ran, what was typed into it, how many
   * results came back, which of them the model was given, and
   * how long the provider took — because the single most
   * common question about an agent that cites a link is "did
   * it actually go and look, or did it make that up?".
   *
   * Owner-facing only. The deployed endpoint does not forward
   * it: what somebody's agent searched for is a fact about
   * their configuration.
   */
  | ({ type: "web_search" } & WebSearchTelemetry)
  /*
   * What the agent read out of the files attached to this
   * message, emitted once, between `start` and the first
   * `delta`.
   *
   * It exists for the same reason the other two do: a learner
   * who attaches a spreadsheet and gets a number back has no
   * way to tell whether the agent read the spreadsheet or made
   * the number up. This says how many pages, sheets or rows
   * actually reached the model, and says plainly when a
   * document was longer than the prompt had room for.
   *
   * Owner-facing only. The deployed endpoint does not forward
   * it: how much of a caller's file fitted somebody's prompt
   * budget is a fact about that somebody's configuration.
   */
  | {
      type: "file_analysis";
      files: AnalysedFile[];
      /* Present when nothing was analysed, saying why. */
      reason?: FileAnalysisReason;
    }
  /*
   * What the agent remembered about the person it is talking
   * to, emitted once, between `start` and the first `delta`.
   *
   * It exists because Memory is the one capability whose work
   * is invisible in the answer. A retrieved passage shows up
   * as a citation and a searched page shows up as a link, but
   * an agent that knows somebody is aiming for a 5 in May just
   * writes a slightly better paragraph — and a learner has no
   * way to tell that from the model being lucky. This says, in
   * the agent's own words, what it was carrying when it wrote
   * that paragraph.
   *
   * Owner-facing only. The deployed endpoint does not forward
   * it: what an agent remembers about a caller is a fact about
   * somebody else's storage, and on a deployment whose callers
   * share a scope it would be a fact about other callers.
   */
  | {
      type: "memory";
      memories: RecalledMemory[];
      /* Which store this came out of. The Builder shows it so
         "why does the deployed one not know this?" has an
         answer on screen rather than in the documentation. */
      scope: MemoryScopeKind;
      /* Present when nothing was recalled, saying why. */
      reason?: MemoryReason;
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
      finishReason: FinishReason;
      usage: TokenUsage;
      latencyMs: number;
    }
  /*
   * What the agent decided to remember from this turn, emitted
   * once, AFTER `done`.
   *
   * After, because it is the only event that describes
   * something which had not happened yet when the answer
   * started. The write runs alongside the answer and is
   * usually finished before the last token; when it is not,
   * the runtime waits a bounded moment for it and then gives
   * up on REPORTING it. The memory is still written either
   * way — this event is telemetry, never the mechanism.
   *
   * Owner-facing only, like `memory` above.
   */
  | {
      type: "memory_write";
      written: WrittenMemory[];
      /* Present when nothing was written, saying why. */
      reason?: MemoryWriteReason;
    }
  /*
   * The agent decided to do something, emitted the moment the
   * decision is parsed and BEFORE the tool runs.
   *
   * The only event in this union that can fire more than once
   * per turn, and the only one that can fire between deltas
   * rather than before them. Both follow from what it
   * describes: a loop, not a lookup.
   *
   * Before rather than after, deliberately. A tool call is the
   * one piece of telemetry here that describes something still
   * happening — a five-second sandbox run or a slow API is
   * dead air, and dead air with no explanation reads as a
   * hung page. This is what lets the Test panel say "running
   * code…" while it waits.
   *
   * Owner-facing in full. The deployed endpoint forwards a
   * narrowed version carrying the tool's name and nothing
   * else, because the ARGUMENTS are the owner's configuration
   * — which endpoint, which connection, what the agent chose
   * to send. A published page forwards none of it.
   */
  | {
      type: "tool_call";
      /* 1-based, and the same number the matching result
         carries. A turn's trace is read as a sequence. */
      step: number;
      tool: ActionToolId;
      /* What the model asked for, after validation. Redacted
         of anything a connection contributed — a secret is
         attached by the server on the way out and never
         appears here. */
      args: Record<string, unknown>;
    }
  /*
   * What came back, emitted after the tool has run and before
   * the model that reads it is called.
   *
   * `ok: false` is not an exception. A tool that fails is a
   * normal step — the model is told what went wrong and given
   * the chance to try something else, which is most of what
   * makes this a loop rather than a pipeline.
   */
  | {
      type: "tool_result";
      step: number;
      /*
       * Absent when the agent's action could not be read at
       * all — malformed JSON, or a name that is not a tool.
       *
       * Optional rather than defaulted to one of the two real
       * tools, because a trace that says "ran code" about an
       * action nothing ever ran is a lie told by the one
       * surface that exists to stop the agent telling them.
       */
      tool?: ActionToolId;
      ok: boolean;
      /* Provider or sandbox time only, not the model calls
         around it. What the Test panel reports per step. */
      latencyMs: number;
      /* A short human summary — "exit 0, 214 bytes",
         "HTTP 200, 1.2 KB". Never the payload itself: the
         payload can be large, and it has already been placed
         where it belongs, which is the prompt. */
      summary: string;
      /* Present when `ok` is false. Safe to show a learner. */
      error?: string;
      /* Set when the result was cut to fit the budget, so the
         Test panel can say so rather than letting a learner
         wonder why the agent ignored half an answer. */
      truncated?: boolean;
    }
  /*
   * The loop stopped without the agent finishing what it
   * started, emitted once, immediately before the final
   * answer's deltas.
   *
   * Exists because "ran out of steps" and "decided it was
   * done" produce the same-looking answer, and only one of
   * them is a reason to raise the ceiling or simplify the
   * task. Without this, the difference is invisible.
   */
  | { type: "tool_limit"; step: number; reason: ActionLimitReason }
  /*
   * A file exists now, emitted after the tool result that made
   * it.
   *
   * Its own event rather than a field on `tool_result`, which
   * is how every other capability's owner-facing evidence
   * arrives — `retrieval`, `web_search`, `file_analysis`,
   * `memory`. A `tool_result` carries a one-line summary and
   * deliberately never the payload; a document is neither, it
   * is a thing that now exists somewhere else and has an id.
   *
   * This event is also what makes the honesty structural. The
   * Test panel's download button, the run card's file strip and
   * the email's attachment list are all built from these and
   * from the rows behind them — never from what the answer
   * SAYS. An agent that claims a report it did not make
   * produces an email with no attachment, contradicted by the
   * surface next to it, which is a better guard than any
   * classifier reading prose.
   *
   * Owner-facing only, and here that is structural rather than
   * a policy: the download route requires a Supabase session,
   * so a deployment key holder and a page visitor could not
   * fetch what it points at. Both doors refuse the capability
   * outright rather than emitting an event for a file nobody
   * can collect.
   */
  | ({ type: "document"; step: number } & GeneratedDocument)
  /*
   * A draft email exists now, and a person has to decide about
   * it.
   *
   * The sibling of `document` above, emitted the same way and
   * for the same reason — and doing one more job that no other
   * event on this union does.
   *
   * IT IS THE ONLY EVIDENCE THAT A DRAFT WAS WRITTEN, and the
   * capability's honesty rests on that. The Test panel's draft
   * card, the Email screen's tray and the run card are all built
   * from this event and the row behind it, never from what the
   * answer SAYS. An agent that claims it replied to somebody
   * produces no card at all, contradicted by the empty space
   * under its own sentence; an agent that claims it SENT one
   * produces a card that says Draft, with a Send button still
   * on it.
   *
   * Owner-facing only, and structurally so: every email
   * capability is hard-off on the deployment and page doors, so
   * neither can produce one of these.
   */
  | ({ type: "email_draft"; step: number } & DraftedEmailEvent);

/* =========================================================
   ACTIONS
========================================================= */

/*
 * The tools an agent can be given.
 *
 * A closed union rather than an open string, and the whole
 * capability leans on that. The model names one of these; if
 * what it names is not in this list the call is refused before
 * anything runs. There is no path from model output to an
 * arbitrary function.
 */
export type ActionToolId =
  | "run_code"
  | "http_request"
  /*
   * The first tool in the catalogue whose value is a SIDE
   * EFFECT rather than a result.
   *
   * The other entries exist to put something in front of the
   * model — that is what `actions.resultChars` is for. A
   * document cannot go in a prompt: it is binary, it is large,
   * and the model has no use for it. What comes back is a
   * receipt of about two hundred characters saying what was
   * made and, deliberately, that it cannot be read back.
   *
   * That last part is a prompt decision, not politeness. A
   * model that is not told will spend one of its four steps
   * trying to open what it just wrote.
   */
  | "make_document"
  /*
   * The store: read, write, list, retire.
   *
   * Four ids rather than one with a `verb` argument, because a
   * closed union is the thing that makes model output safe to
   * dispatch on — `parseAction` refuses a name that is not in
   * this list, and a verb inside `args` would move that check
   * from the parser into four separate branches of one tool.
   *
   * `data_list` returns keys, sizes and dates and NEVER values.
   * A listing that carried contents would make one step able to
   * pull the entire store into the prompt, which is what the
   * per-result budget exists to prevent.
   */
  | "data_get"
  | "data_set"
  | "data_list"
  | "data_delete"
  /*
   * The mailbox, and the shape of this group is the whole
   * security argument for the capability.
   *
   * FOUR IDS, AND THE ONE THAT IS ABSENT IS THE POINT. There is
   * no `email_send`. Reading, searching, drafting and
   * organising are things a model may decide to do; delivering
   * a message on somebody's behalf is not, so it has no entry
   * here — and because `parseAction` refuses a name that is not
   * in this union, there is no path from anything a model
   * writes to a message leaving.
   *
   * That is stronger than a confirmation step, which would ask
   * a model to judge whether a person said yes. Sending is a
   * session-authenticated POST from a screen with a button on
   * it. See agents/email/tools.ts and routes/email.ts.
   *
   * There is no `email_delete` either, for a different reason:
   * `gmail.modify` can trash a message perfectly well and
   * BuildGentic does not offer it. An absent tool is a
   * capability that cannot be granted by mistake.
   */
  | "email_search"
  | "email_get"
  | "email_draft"
  | "email_organize";

/*
 * Why a loop ended early.
 *
 * `step_limit` is the ordinary one — the agent used its
 * allowance and was asked to answer with what it had.
 * `budget` means the accumulated tool results no longer fit
 * the prompt, which is a different problem with a different
 * fix.
 */
export type ActionLimitReason = "step_limit" | "budget";

/*
 * Which tools this turn may use.
 *
 * One flag per tool rather than a single "actions" switch,
 * because the two are not the same permission and an owner
 * should not have to grant both to get one. Running code
 * touches nothing outside a sandbox; calling an API spends
 * somebody's credential against somebody else's server. An
 * agent that does arithmetic should not be reachable from the
 * open internet just because it needed a calculator.
 */
export interface ActionCapabilityFlags {
  codeExecution: boolean;
  httpActions: boolean;
  /*
   * Making a file, and keeping records between turns.
   *
   * Two more flags rather than one "advanced" switch, for the
   * reason the first two are separate: they are not the same
   * permission. Producing a report that gets emailed to you is
   * not the grant that accumulates durable records about you,
   * and an owner who wants a weekly PDF should not thereby
   * have given their agent a memory it controls.
   *
   * EVERY FIELD HERE IS NON-OPTIONAL, AND THAT IS THE POINT.
   * Adding a capability makes every door in this codebase fail
   * to compile until it states its answer — the Test panel, the
   * deployment, the published page, the scheduler and both
   * recursive call sites. A capability that could be silently
   * inherited by a path nobody thought about is exactly how a
   * stranger with a forwarded link ends up holding somebody's
   * private records.
   */
  documentGeneration: boolean;
  dataStore: boolean;
  /*
   * The mailbox, in three flags rather than one.
   *
   * Reading somebody's correspondence, writing a reply for them
   * to approve, and rearranging their inbox are three different
   * permissions, and an owner who wants a triage assistant
   * should not thereby have given it the ability to relabel
   * everything. Same argument as the split above; more at stake.
   *
   * THERE IS DELIBERATELY NO `emailSend` FIELD, and its absence
   * is load-bearing rather than an omission. This interface is
   * "which tools this turn may use", and there is no send tool —
   * so a field for it would imply a tool that does not exist and
   * would create, in the type system, the very thing the
   * capability is built to prevent: a boolean that turns a model
   * turn into an outbound email.
   *
   * `email_send` exists as a CapabilityId, is stored on the
   * agent row, and is read by the send route. It never reaches
   * the action loop, because the action loop has nothing to do
   * with it.
   */
  emailRead: boolean;
  emailDraft: boolean;
  emailOrganize: boolean;
}

/*
 * What a generated document can be.
 *
 * A closed union, validated before a renderer is reached, for
 * the same reason ActionToolId is one: there is no path from
 * what a model writes to a code path this file does not name.
 */
export type DocumentFormat = "pdf" | "xlsx" | "docx";

/*
 * One file an agent made, as its owner sees it.
 *
 * Carries no bytes. The owner fetches those from a
 * session-authenticated route with the id, which is the whole
 * difference between this and an attachment: File Analysis
 * keeps the extracted TEXT and drops the document, because an
 * upload has no business being reachable. A generated document
 * is the product of the turn, so it is reachable — by its owner,
 * with a session, until it expires.
 */
export interface GeneratedDocument {
  id: string;
  title: string;
  filename: string;
  format: DocumentFormat;
  /* Of the decoded file, not of the stored base64. */
  bytes: number;
  /* Whichever the format has. Absent means the idea does not
     apply, not that it is unknown. */
  pages?: number;
  rows?: number;
  sheets?: number;
  /*
   * What could not be rendered, in words an owner can read.
   *
   * The PDF writer's Latin-1 ceiling lands here. Present is a
   * warning rather than an error: the file exists and is
   * readable, and some characters in it are placeholders. The
   * Test panel shows this line, because "the agent left out the
   * Japanese heading" and "the Japanese heading could not be
   * drawn" are different problems with different fixes.
   */
  degraded?: string;
}

/*
 * One email an agent drafted, as its owner sees it.
 *
 * The sibling of `GeneratedDocument`, with one difference that
 * runs the other way: a document carries no bytes because the
 * owner fetches those from a route, and this one DOES carry the
 * whole body.
 *
 * That is not an inconsistency. A document is a file somebody
 * downloads; a draft is a paragraph somebody has to READ before
 * they can decide whether to send it, and a card that made them
 * click through to find out what they were approving would be a
 * card that trains them to approve without looking. The
 * dangerous action here is approval, so the thing being
 * approved is on screen.
 *
 * What it carries no version of is a way to send. The id is
 * good for exactly one thing — naming the row that the
 * session-authenticated send route will act on when a person
 * presses the button.
 */
export interface DraftedEmailEvent {
  id: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /* Whether it answers something, which is what decides how the
     card is worded. A new message to somebody deserves a harder
     look than a reply to a thread the owner already knows. */
  isReply: boolean;
}

/* =========================================================
   RETRIEVAL
========================================================= */

/*
 * Why an answer carried no retrieved knowledge.
 *
 *   none_indexed — the agent has knowledge, but none of it is
 *                  indexed yet, so all of it is still being
 *                  inlined exactly as before.
 *   no_match     — indexed, searched, and nothing was close
 *                  enough to the question to be worth sending.
 *   unavailable  — the lookup itself failed. The agent still
 *                  answered; it simply answered without this.
 *
 * Three values rather than one flag because they call for three
 * different reactions from the person reading them, and only
 * one of them is a problem.
 */
export type RetrievalReason = "none_indexed" | "no_match" | "unavailable";

export interface RetrievedSource {
  knowledgeId: string;
  title: string;
  /* Which piece of that entry, and how many there are. */
  ordinal: number;
  chars: number;
  /* Cosine similarity in [0, 1]. Shown to the owner so "why did
     it pick that?" has an answer. */
  similarity: number;
}

/* =========================================================
   FILE ANALYSIS
========================================================= */

/*
 * What kind of file this is, decided by its bytes.
 *
 * Deliberately a short closed list rather than a MIME type. A
 * MIME type is a claim the uploader makes; this is a conclusion
 * the server reached, and every extractor is registered against
 * one of these values. Anything that does not resolve to one is
 * refused before a parser sees it.
 */
export type FileKind = "pdf" | "docx" | "xlsx" | "csv" | "image";

/*
 * Why a turn carried no analysed file.
 *
 *   off          — the capability is switched off, so nothing
 *                  was even looked at.
 *   none         — the message attached no files.
 *   expired      — the attachment is no longer held. Also what
 *                  somebody else's file id looks like, which is
 *                  what it should look like.
 *   no_room      — extracted, and the prompt had no space for
 *                  it. The agent answered without it, and said
 *                  so.
 *   unavailable  — resolving the attachment failed outright.
 */
export type FileAnalysisReason =
  | "off"
  | "none"
  | "expired"
  | "no_room"
  | "unavailable";

/*
 * One file the agent was given, as the owner sees it.
 *
 * Carries no content — the learner has the file — and every
 * count on it describes what actually reached the model rather
 * than what the document contains. `truncated` is the field
 * that earns the type: "the agent did not mention chapter
 * nine" and "chapter nine was never sent" are different
 * problems, and only one of them is fixed by rewording the
 * question.
 */
export interface AnalysedFile {
  id: string;
  name: string;
  kind: FileKind;
  bytes: number;
  /* Characters of extracted text that reached the prompt. Zero
     for an image, which reaches the model as pixels. */
  chars: number;
  /* True when the document was longer than the extraction
     budget and the model was told where it stopped. */
  truncated: boolean;
  /* PDFs: pages read. Spreadsheets: rows across every sheet
     read. Absent where the idea does not apply. */
  pages?: number;
  sheets?: string[];
  rows?: number;
  /* Images: what the model was actually shown. */
  width?: number;
  height?: number;
  /* How long parsing took, in milliseconds. */
  latencyMs: number;
}

/* =========================================================
   MEMORY
========================================================= */

/*
 * What kind of thing a memory is.
 *
 * A closed vocabulary, matching the CHECK constraint in
 * migration 0010, and closed for a reason worth stating: an
 * open one becomes "note" for everything inside a week, and
 * the ordering that decides what travels on a crowded turn
 * stops meaning anything.
 *
 * The five are the ones that actually earn their keep for a
 * tutor, a coach or a planner — who somebody is, how they want
 * to be helped, what they are aiming at, what they are working
 * on now, and anything else durable and specific.
 */
export type MemoryKind =
  | "profile"
  | "preference"
  | "goal"
  | "project"
  | "fact";

/*
 * Which store a turn's memory came out of.
 *
 * `owner` is the learner's own memory with this agent, built
 * in the Builder. `deployment` is a caller's memory with the
 * deployed endpoint. They are different scopes and never mix —
 * see server/src/agents/memory/scope.ts.
 */
export type MemoryScopeKind = "owner" | "deployment";

/*
 * Why a turn carried no remembered context.
 *
 *   off         — the capability is switched off, so nothing
 *                 was looked at.
 *   no_agent    — Memory is on but this is an unsaved draft.
 *                 There is no agent to hang memories off yet,
 *                 which is a state to fix rather than a fault.
 *   none        — this agent has never remembered anything
 *                 about this person. The ordinary state of a
 *                 first conversation.
 *   ranked      — memories were carried, but chosen by recency
 *                 rather than by relevance, because embedding
 *                 was unavailable. Reported because it is a
 *                 degraded answer to "why that one and not the
 *                 other one".
 *   unavailable — reading the store failed outright. The agent
 *                 still answered; it simply answered without
 *                 knowing anything.
 *
 * Five values rather than a flag, for the reason RetrievalReason
 * has three: they call for different reactions and only two of
 * them are a problem.
 */
export type MemoryReason =
  | "off"
  | "no_agent"
  | "none"
  | "ranked"
  | "unavailable";

/*
 * Why a turn wrote nothing down.
 *
 *   off         — the capability is switched off.
 *   no_agent    — an unsaved draft, as above.
 *   trivial     — the turn was too short to contain anything
 *                 durable, so no call was made. "ok, thanks"
 *                 is most turns and this is most outcomes.
 *   nothing_new — a call WAS made and the model concluded
 *                 there was nothing worth keeping. Different
 *                 from `trivial` on purpose: one spent
 *                 nothing, the other spent a call, and the
 *                 ledger should not have to guess which.
 *   full        — the scope is at its cap and eviction was
 *                 refused. Reachable only if eviction fails.
 *   unavailable — the extraction call or the write failed.
 *                 The answer happened anyway.
 */
export type MemoryWriteReason =
  | "off"
  | "no_agent"
  | "trivial"
  | "nothing_new"
  | "full"
  | "unavailable";

/*
 * One memory the agent carried into this turn, as its owner
 * sees it.
 *
 * Carries the content, and that is the difference between this
 * and RetrievedSource, which carries only a title. A retrieved
 * passage is a paragraph the learner already has in their
 * knowledge base and can go and read; a memory is one sentence
 * they never wrote, produced by a machine that decided it was
 * true about them. Showing the title alone would leave the one
 * thing worth checking off screen.
 */
export interface RecalledMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  /* Cosine similarity, present only for memories the semantic
     tier chose. Absent on the always-carried ones, which were
     not chosen by similarity and would be misrepresented by a
     number. */
  similarity?: number;
  updatedAt: string;
}

/*
 * One memory this turn wrote.
 *
 * `replaced` is what makes an update legible: "remembered that
 * you are a senior" and "you were a junior and now you are a
 * senior" are different events, and only the second explains
 * why the count did not go up.
 */
export interface WrittenMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  /* True when this updated an existing memory rather than
     adding one. */
  replaced: boolean;
}
