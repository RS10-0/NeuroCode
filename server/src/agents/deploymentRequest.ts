import { memory } from "../ai/config";
import { AiRuntimeError, type AiErrorCode } from "../ai/errors";
import { parseChatBody, type ParsedChatBody } from "../ai/validation";
import { composeAgentSystem } from "./composeAgentSystem";
import type { KnowledgeRecord } from "./AgentStore";
import type { AuthenticatedDeployment } from "./DeploymentStore";

/*
 * What an external caller is allowed to say, and what it is
 * allowed to be told.
 *
 * Both halves are narrower than the browser's, and for the same
 * reason: the caller is not the agent's owner. They may not
 * describe the agent, and they may not be told about it.
 */

/* =========================================================
   THE REQUEST

   A deployed caller controls exactly one thing: the
   conversation. Model, instructions, knowledge, temperature,
   output cap and power source all come off the stored agent.

   That is structural rather than checked. The body built below
   overwrites every configuration field from the row, so there is
   no path by which a request could influence one — a caller
   cannot change what they cannot reach.
========================================================= */

/*
 * Fields that would be a configuration change if they worked.
 *
 * Refused by name rather than ignored. Silently dropping
 * `"model": "gpt-5-mini"` leaves somebody convinced they
 * switched models and reading answers from a different one,
 * which is a worse outcome than an error — and the error is the
 * only place we can say why the API works this way.
 */
const FORBIDDEN_FIELDS = [
  "model",
  "system",
  "temperature",
  "maxOutputTokens",
  "stop",
  "feature",
  "agentId",
  /*
   * Whether the agent searches its own knowledge is part of how
   * its owner built it, exactly like the instructions are. A
   * caller who could switch it off could make an agent answer
   * from the model's general training instead of from the
   * document it was given — which is not a smaller answer, it is
   * a different agent.
   */
  "knowledgeRetrieval",
  /*
   * Whether the agent may go and look something up is part of
   * how its owner built it, and it is the field with the
   * sharpest teeth on this list. A caller who could switch it
   * ON would be spending the owner's search allowance on
   * queries the owner never authorised; a caller who could
   * switch it OFF would get confident answers from training
   * data where the owner had arranged for current ones. Both
   * are somebody else's agent behaving as they did not build
   * it.
   */
  "webSearch",
  /*
   * Whether the agent reads the files attached to a message is
   * part of how its owner built it. A caller who could switch
   * it ON would be spending the owner's file allowance on
   * documents the owner never authorised, and one who could
   * switch it OFF would get an agent that ignored the very
   * attachment the request was about.
   *
   * `attachments` is deliberately NOT on this list. It is one
   * of the two conversational fields beyond `messages` a
   * deployed caller may set, because an attachment is something
   * they are asking about rather than a piece of the agent's
   * configuration — and because the ids they can send only
   * resolve within their own deployment's scope.
   */
  "fileAnalysis",
  /*
   * Whether the agent remembers the person it is talking to is
   * part of how its owner built it, and the teeth here are as
   * sharp as `webSearch`'s in both directions. A caller who
   * could switch it ON would be filling a store the owner pays
   * for, and keeping it, with statements the owner never
   * authorised collecting — which is a data-protection problem
   * and not merely a billing one. A caller who could switch it
   * OFF would get an agent that had forgotten somebody it was
   * built to know.
   *
   * `memoryKey` is deliberately NOT on this list, and is the
   * other permitted conversational field. See below.
   */
  "memory",
  /*
   * Whether the agent may run code is part of how its owner
   * built it. A caller who could switch it ON would be
   * spending the owner's action allowance on programs the
   * owner never authorised — and, more to the point, would be
   * choosing to execute code on somebody else's account
   * because they asked nicely in a chat message.
   */
  "codeExecution",
  /*
   * Whether the agent may call out to the internet is part of
   * how its owner built it, and it is the field with the
   * sharpest teeth on this entire list.
   *
   * A caller who could switch it ON would be using somebody
   * else's saved credentials, against the services those
   * credentials belong to, from BuildGentic's IP address, with
   * the owner paying — and the owner would see it only as an
   * action count on a usage screen. Every other field here
   * changes an answer. This one would let a stranger act as
   * the owner outside BuildGentic entirely.
   */
  "httpActions",
  /*
   * Whether the agent may produce a file, and whether it may
   * read and write its own store.
   *
   * Both are refused by name rather than merely defaulting to
   * false, which is what the two fields below them do. The
   * distinction is the same one this list is built on: a field
   * that is ignored is a field a caller can send and believe
   * they set, and a field that is REFUSED is one they are told
   * about. Every other entry here earns its place that way.
   *
   * Both are also `false` on the deployed path regardless of
   * the agent's capabilities, which is the one place this file
   * departs from "read it off the stored row" — and the reason
   * is structural rather than cautious. A document is reachable
   * only through a session-authenticated route that matches the
   * owner's user id, so a deployment key holder could not fetch
   * what it produced; and a store record is a MODEL-CHOSEN
   * write into the owner's own drawer, which is not a thing a
   * stranger's turn should be able to cause. See
   * agents/data/scope.ts.
   */
  "documentGeneration",
  "dataStore",
  /*
   * The three email flags, refused by name like the two above
   * them and for a reason that is not about cost at all.
   *
   * Every other entry on this list protects the owner's
   * ALLOWANCE, their CONFIGURATION, or their CREDENTIALS. These
   * protect their correspondence. A caller holding a deployment
   * key who could set `emailRead` would be reading the inbox of
   * whoever built the agent — not causing a charge, not
   * changing an answer, but reading their post.
   *
   * They are also hard `false` below, whatever the agent's
   * capabilities say, so refusing them here is about telling a
   * caller rather than about stopping one.
   */
  "emailRead",
  "emailDraft",
  "emailOrganize",
] as const;

/*
 * A problem with what the caller sent, as opposed to a problem
 * with the agent or with BuildGentic.
 *
 * Its own type because it is the one class of failure whose
 * message may be passed through verbatim: the caller wrote the
 * request, so nothing in the complaint can be news to them. Every
 * other failure is generalised on the way out.
 */
export class DeploymentRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentRequestError";
  }
}

export interface DeployedChatInput {
  authenticated: AuthenticatedDeployment;
  knowledge: KnowledgeRecord[];
  body: unknown;
}

export interface DeployedChat {
  parsed: ParsedChatBody;
  stream: boolean;
  /*
   * The caller's own end user, raw, for the route to hash and
   * turn into a scope.
   *
   * Deliberately NOT on `parsed`. A memory scope is a
   * resolution the route makes from a verified deployment row,
   * and putting a caller-supplied string on the body the
   * runtime reads would make it a claim instead. The route
   * namespaces it under the deployment id, so the worst a
   * forged value achieves is a different drawer inside the
   * caller's own deployment.
   */
  memoryKey?: string;
}

/*
 * The one new field a deployed caller may set.
 *
 * It is the `attachments` exception again, for the same stated
 * reason: it says who is asking rather than how the agent is
 * configured. An owner wiring this endpoint into their own
 * product has many end users behind one deployment key, and
 * without this they would all share one memory — so the second
 * person to use their app would be greeted by name as the
 * first.
 *
 * Sending nothing is valid and is the deployment's own shared
 * memory, which is what makes a single-user integration work
 * with no extra thought.
 *
 * The value is hashed before it is stored — see
 * memory/scope.ts — so BuildGentic never keeps the identifier
 * itself. That matters because the obvious thing to send is an
 * email address.
 */
function parseMemoryKey(raw: Record<string, unknown>): string | undefined {
  const value = raw.memoryKey;

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new DeploymentRequestError(
      "memoryKey must be a string when supplied."
    );
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length > memory.subjectMaxChars) {
    throw new DeploymentRequestError(
      `memoryKey may be at most ${memory.subjectMaxChars} characters.`
    );
  }

  return trimmed;
}

export function buildDeployedChat(input: DeployedChatInput): DeployedChat {
  const { agent } = input.authenticated;

  if (
    typeof input.body !== "object" ||
    input.body === null ||
    Array.isArray(input.body)
  ) {
    throw new DeploymentRequestError("The request body must be a JSON object.");
  }

  const raw = input.body as Record<string, unknown>;

  for (const field of FORBIDDEN_FIELDS) {
    if (raw[field] !== undefined) {
      throw new DeploymentRequestError(
        `"${field}" cannot be set on a deployed agent. Its configuration is fixed by whoever built it; this endpoint accepts "messages", "stream", "attachments" and "memoryKey".`
      );
    }
  }

  /*
   * Streaming is opt-in here and opt-out on /api/ai/chat. The
   * browser wants tokens as they arrive; a script wants one JSON
   * body it can parse without an SSE reader, and a curl that
   * prints an answer is the whole point of this endpoint.
   */
  const stream = raw.stream === true;

  const memoryKey = parseMemoryKey(raw);

  /*
   * The conversation goes through the runtime's own validator
   * rather than a second copy of its rules. Message count,
   * message length, the roles allowed, the refusal of a system
   * turn buried in the array, the requirement that the last turn
   * is a user turn — all of it stays in lockstep with the
   * browser endpoint because it is literally the same function.
   */
  let parsed: ParsedChatBody;

  try {
    parsed = parseChatBody({
      messages: raw.messages,
      /*
       * Passed through the runtime's own validator rather than
       * shape-checked here, so a deployed caller's ids are held
       * to exactly the rules a browser's are. Ownership is a
       * separate question and is answered later, by the store,
       * against the deployment's scope.
       */
      attachments: raw.attachments,
      stream,
    });
  } catch (error) {
    if (error instanceof AiRuntimeError && error.code === "invalid_request") {
      throw new DeploymentRequestError(error.message);
    }

    throw error;
  }

  /* Throws when the owner's instructions and knowledge no longer
     fit the runtime's system budget. */
  const system = composeAgentSystem(agent, input.knowledge).text;

  return {
    parsed: {
      ...parsed,
      ...(system ? { system } : {}),
      model: agent.model,
      settings: {
        temperature: agent.temperature,
        maxOutputTokens: agent.maxOutputTokens,
      },
      /*
       * Hardcoded, and the reason CLIENT_FEATURES excludes it.
       * A browser naming `agent_public` would be claiming to be
       * this file; this file does not have to claim anything.
       */
      feature: "agent_public",
      agentId: agent.id,
      /*
       * Off the stored row, which is the only place it can
       * honestly come from when the caller is not the owner —
       * and the same value the Builder's Test panel reads off
       * the draft. That is what makes "the deployed agent
       * retrieves exactly what the tested one retrieves" true by
       * construction rather than by two implementations agreeing.
       */
      knowledgeRetrieval: agent.capabilities.includes("knowledge_retrieval"),
      /*
       * Off the stored row, exactly like the flag above and for
       * the same reason: it is the only place this can honestly
       * come from when the caller is not the owner, and it is
       * the same value the Builder's Test panel reads off the
       * draft. That is what makes "the deployed agent searches
       * exactly when the tested one searches" true by
       * construction rather than by two implementations
       * agreeing.
       */
      webSearch: agent.capabilities.includes("web_search"),
      /*
       * Off the stored row, exactly like the two flags above and
       * for the same reason: it is the only place this can
       * honestly come from when the caller is not the owner, and
       * it is the same value the Builder's Test panel reads off
       * the draft. That is what makes "the deployed agent reads
       * exactly what the tested one reads" true by construction
       * rather than by two implementations agreeing.
       */
      fileAnalysis: agent.capabilities.includes("file_analysis"),
      /*
       * Off the stored row, exactly like the three flags above
       * and for the same reason: it is the only place this can
       * honestly come from when the caller is not the owner,
       * and it is the same value the Builder's Test panel reads
       * off the draft. That is what makes "the deployed agent
       * remembers exactly what the tested one remembers" true
       * by construction rather than by two implementations
       * agreeing.
       *
       * What it remembers ABOUT is a different question, and
       * the answer is deliberately not the owner: the route
       * resolves a deployment-scoped memory from this
       * deployment's row, so a caller cannot read what the
       * owner told this agent while building it, and the owner
       * does not find a stranger's statements in their own Test
       * panel.
       */
      memory: agent.capabilities.includes("memory"),
      /*
       * Both action capabilities, read off the stored row like
       * everything else here, and refused by name above so a
       * caller who sends one is told rather than ignored.
       *
       * A deployed agent DOES get to act. That is the point of
       * deploying one — an integration that can only be
       * answered in prose is a chatbot with an API key. What it
       * does not get is any say in WHETHER it acts: the owner
       * decided that in the Builder, and a request cannot
       * revise it.
       */
      codeExecution: agent.capabilities.includes("code_execution"),
      httpActions: agent.capabilities.includes("http_actions"),
      /*
       * The two that are hard `false` here rather than read off
       * the row, and stated explicitly rather than left to the
       * spread above to default.
       *
       * A field that is correct because of what somebody else's
       * function happens to return is a field that changes
       * meaning the day that function changes. `ActionCapabilityFlags`
       * is non-optional precisely so a new capability makes
       * every door fail to compile until it answers; a spread
       * that silently supplies the answer would give that
       * property away at the one door where it matters most.
       *
       * The reasoning is in the refusal list above: neither
       * caller has a session, so neither could collect a
       * document — and a store write is model-chosen, which is
       * a different thing to hand a stranger than a model-read.
       */
      documentGeneration: false,
      dataStore: false,
      /*
       * THE MAILBOX IS NEVER REACHABLE FROM A DEPLOYMENT, and
       * this is the least arguable `false` on the list.
       *
       * A deployment key is held by an application the owner
       * wrote, which is a good reason to let it act — that is
       * why `codeExecution` and `httpActions` above are read
       * off the row rather than refused. But a key travels:
       * into a repository, into a CI log, into a colleague's
       * terminal. Between "somebody found my key and can ask my
       * agent questions" and "somebody found my key and can
       * read my email", there is a line, and no default crosses
       * it.
       *
       * An owner who wants an application that reads their mail
       * can write one against their own mailbox credentials.
       * That is a decision they make on purpose, holding their
       * own key, rather than one they inherit from a checkbox
       * in a Builder.
       */
      emailRead: false,
      emailDraft: false,
      emailOrganize: false,
      stream,
    },
    stream,
    ...(memoryKey === undefined ? {} : { memoryKey }),
  };
}

/* =========================================================
   THE RESPONSE

   An external caller learns that the agent answered, or that it
   could not. Which of the owner's limits was reached, whose key
   was rejected, and which provider is behind it are all facts
   about somebody else's account.

   None of this loses information. The true code is still written
   to ai_usage.error_code by the unchanged runtime, and the
   Deploy screen shows it to the owner — the person who can
   actually act on it.
========================================================= */

export interface PublicErrorBody {
  error: string;
  code: string;
  retryAfterSeconds?: number;
}

interface PublicMapping {
  status: number;
  code: string;
  message: string;
}

const BUSY: PublicMapping = {
  status: 429,
  code: "rate_limited",
  message:
    "This agent is receiving more requests than it is allowed to answer right now. Wait and try again.",
};

const UNAVAILABLE: PublicMapping = {
  status: 503,
  code: "unavailable",
  message:
    "This agent cannot answer at the moment. Its owner needs to check its configuration.",
};

const UPSTREAM: PublicMapping = {
  status: 502,
  code: "upstream_error",
  message: "The AI provider behind this agent did not return an answer. Try again.",
};

const PUBLIC: Record<AiErrorCode, PublicMapping> = {
  /*
   * Generalised even though the caller sent the conversation.
   * The runtime's own message names the owner's input ceiling,
   * which differs between power sources and would say which one
   * is paying. "Too long" is the actionable half, and it is the
   * half that is theirs.
   */
  invalid_request: {
    status: 400,
    code: "invalid_request",
    message:
      "This request could not be answered. The conversation may be longer than this agent accepts.",
  },

  deployment_unauthenticated: {
    status: 401,
    code: "unauthenticated",
    message: "That deployment key is not valid for this agent.",
  },

  deployment_not_found: {
    status: 404,
    code: "not_found",
    message: "No deployed agent answers at that address.",
  },

  /*
   * Unreachable on this endpoint — a published page's failures
   * are mapped by sites/siteRequest.ts, not here — but the
   * table is exhaustive over AiErrorCode on purpose, so that
   * adding a code anywhere in the runtime forces a decision
   * about what an external caller is told. The decision here is
   * the same 404 its neighbour gives.
   */
  site_not_found: {
    status: 404,
    code: "not_found",
    message: "No deployed agent answers at that address.",
  },

  /*
   * Unreachable here for a stronger reason than `site_not_found`
   * is, and the strength is worth recording rather than assuming.
   *
   * A site failure is merely mapped elsewhere. THIS code cannot
   * arise on this endpoint at all: it is thrown only by
   * extension/SessionStore, which is reached only by a resolver
   * that parses `nlx_` tokens, and this router authenticates
   * with `nld_` ones through a parser that refuses them. Two
   * anchored grammars and two tables stand between the two
   * doors.
   *
   * Mapped anyway, because the table is exhaustive on purpose —
   * and mapped to what its neighbour says rather than to
   * anything mentioning an extension. If a refactor ever did
   * route this here, an external caller should learn that their
   * credential does not work, not that a different kind of
   * credential exists.
   */
  extension_unauthenticated: {
    status: 401,
    code: "unauthenticated",
    message: "That deployment key is not valid for this agent.",
  },

  rate_limited: BUSY,
  quota_exceeded: BUSY,
  token_quota_exceeded: BUSY,
  too_many_concurrent: BUSY,
  deployment_rate_limited: BUSY,
  deployment_quota_exceeded: BUSY,
  deployment_too_many_concurrent: BUSY,

  /* Everything below is the owner's configuration, their
     provider key, or BuildGentic's own budget. All one answer. */
  model_not_allowed: UNAVAILABLE,
  platform_budget_exceeded: UNAVAILABLE,
  /*
   * The owner is out of XP.
   *
   * Flattened to a generic "unavailable" like the rest of this
   * column, and that matters more here than anywhere else: the
   * caller is somebody else's application, and telling it that
   * this endpoint's owner has run out of a personal allowance
   * is a fact about a stranger's account.
   */
  out_of_xp: UNAVAILABLE,
  provider_not_configured: UNAVAILABLE,

  provider_unavailable: UPSTREAM,
  provider_rejected: UPSTREAM,
  provider_malformed_response: UPSTREAM,
  empty_response: UPSTREAM,
  timeout: {
    status: 504,
    code: "timeout",
    message: "This agent took too long to answer. Try again.",
  },

  cancelled: {
    status: 499,
    code: "cancelled",
    message: "The request was cancelled.",
  },

  /* Reachable only if something above this layer went wrong;
     a deployed caller never presents a Supabase token. */
  unauthenticated: {
    status: 401,
    code: "unauthenticated",
    message: "That deployment key is not valid for this agent.",
  },

  internal_error: {
    status: 500,
    code: "internal_error",
    message: "This agent hit an unexpected problem. Try again.",
  },
};

export function toPublicError(error: unknown): {
  status: number;
  body: PublicErrorBody;
} {
  if (error instanceof DeploymentRequestError) {
    /* The caller's own request. Their message, verbatim. */
    return {
      status: 400,
      body: { error: error.message, code: "invalid_request" },
    };
  }

  if (error instanceof AiRuntimeError) {
    const mapping = PUBLIC[error.code] ?? PUBLIC.internal_error;

    return {
      status: mapping.status,
      body: {
        error: mapping.message,
        code: mapping.code,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      },
    };
  }

  return {
    status: 500,
    body: { error: PUBLIC.internal_error.message, code: "internal_error" },
  };
}
