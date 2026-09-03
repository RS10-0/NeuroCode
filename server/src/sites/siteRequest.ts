import { listKnowledge } from "../agents/AgentStore";
import { composeAgentSystem } from "../agents/composeAgentSystem";
import { memory, siteLimits } from "../ai/config";
import { AiRuntimeError } from "../ai/errors";
import { parseChatBody, type ParsedChatBody } from "../ai/validation";
import type { ResolvedSite } from "./SiteStore";

/*
 * What a visitor is allowed to say.
 *
 * The narrowest request surface in BuildGentic, and deliberately
 * narrower than the deployment endpoint's — which was already
 * narrower than the browser's. The progression is the point: a
 * learner in the Lab describes the whole request, an API caller
 * holding a key describes the conversation, and a stranger who
 * followed a link describes only their own turns.
 *
 * `deploymentRequest.ts` refuses configuration fields by name,
 * so that somebody wiring up an integration is TOLD their
 * "model" field will not work rather than quietly getting a
 * different model. That reasoning does not carry over here,
 * because a visitor is not writing a request — a page is
 * writing it for them, and any extra field in the body is
 * either a bug in our own page or somebody poking at the
 * endpoint by hand. Neither is owed an explanation, and a list
 * of refusable field names is a list of things worth trying.
 * So unknown fields are dropped silently and the body is built
 * from a fixed set of three.
 *
 * The result is that a visitor cannot influence a single thing
 * about how the agent behaves. Not by omission and not by
 * checking: the object handed to the runtime is constructed
 * field by field below, so there is no path for an input to
 * reach it.
 */

export class SiteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteRequestError";
  }
}

export interface SiteChatInput {
  resolved: ResolvedSite;
  body: unknown;
}

export interface SiteChat {
  parsed: ParsedChatBody;
  stream: boolean;
  /*
   * Which visitor is asking, raw, for the route to hash into a
   * scope.
   *
   * Deliberately not on `parsed`: a memory scope is a
   * resolution the route makes from a verified row, and putting
   * a browser-supplied string on the body the runtime reads
   * would make it a claim instead. The route namespaces it
   * under the deployment id, so the worst a forged value
   * achieves is a different drawer inside the same page.
   */
  visitorKey?: string;
}

function readVisitorKey(raw: Record<string, unknown>): string | undefined {
  const value = raw.visitorKey;

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  /*
   * Truncated rather than refused.
   *
   * The page mints this itself and it is always a UUID, so an
   * over-long value did not come from us. Refusing would be an
   * error a visitor cannot act on; truncating gives whoever
   * sent it a stable drawer of their own and moves on. The
   * value is hashed before storage either way.
   */
  return trimmed.slice(0, memory.subjectMaxChars);
}

export async function buildSiteChat(
  input: SiteChatInput
): Promise<SiteChat> {
  const { agent, site, chatLive } = input.resolved;

  if (!chatLive) {
    /*
     * The same 404 the resolver gives for a missing page, and
     * for the same reason: whether a page has its chat switched
     * off, has been demoted to a draft, or never existed is the
     * owner's business. A visitor is told the agent is not
     * answering.
     */
    throw new AiRuntimeError(
      "site_not_found",
      "This agent is not answering at the moment."
    );
  }

  if (
    typeof input.body !== "object" ||
    input.body === null ||
    Array.isArray(input.body)
  ) {
    throw new SiteRequestError("The request body must be a JSON object.");
  }

  const raw = input.body as Record<string, unknown>;

  /*
   * Trimmed here as well as in the browser, and this is the
   * copy that matters — the browser's is a courtesy so a long
   * conversation degrades instead of being refused.
   *
   * Oldest turns go first. Keeping the newest is what makes a
   * conversation still make sense after the trim.
   */
  const messages = Array.isArray(raw.messages)
    ? raw.messages.slice(-siteLimits.maxMessages)
    : raw.messages;

  let parsed: ParsedChatBody;

  try {
    /*
     * Through the runtime's own validator rather than a third
     * copy of its rules, exactly as deploymentRequest.ts does
     * it. Message shape, roles, lengths, the refusal of a
     * system turn buried in the array — all of it stays in
     * lockstep with the other two endpoints because it is
     * literally the same function.
     */
    parsed = parseChatBody({ messages, stream: true });
  } catch (error) {
    if (error instanceof AiRuntimeError && error.code === "invalid_request") {
      throw new SiteRequestError(error.message);
    }

    throw error;
  }

  /*
   * Read live rather than snapshotted when the page was
   * published, so an edit in the Builder reaches the public
   * page immediately — the same rule the deployment endpoint
   * follows, and the reason the tested agent is the deployed
   * agent is the published agent.
   */
  const knowledge = await listKnowledge(input.resolved.ownerId, agent.id);

  /* Throws when the owner's instructions and knowledge no
     longer fit the runtime's system budget. */
  const system = composeAgentSystem(agent, knowledge).text;

  return {
    parsed: {
      ...parsed,
      ...(system ? { system } : {}),
      model: agent.model,
      settings: {
        temperature: agent.temperature,
        maxOutputTokens: agent.maxOutputTokens,
      },
      /* Hardcoded, like `agent_public` next door, and for the
         same reason: a browser naming this feature would be
         claiming to be this file, and this file does not have
         to claim anything. */
      feature: "agent_site",
      agentId: agent.id,
      /*
       * Every capability flag comes off the stored agent row.
       *
       * This is the same construction deploymentRequest.ts
       * uses, and it is what makes "the page runs the agent the
       * student built" true structurally rather than by two
       * implementations agreeing. A visitor cannot switch
       * knowledge search off to get a generic answer, and
       * cannot switch web search on to spend the owner's
       * allowance on queries the owner never authorised.
       */
      knowledgeRetrieval: agent.capabilities.includes("knowledge_retrieval"),
      webSearch: agent.capabilities.includes("web_search"),
      /*
       * The one place a page has a say over a capability, and
       * it can only ever say no.
       *
       * `allowUploads` is the student's switch on their own
       * page; the agent's own capability is the owner's. Both
       * must be on. The asymmetry is deliberate and is
       * explained where the field is declared in schema.ts: an
       * anonymous stranger uploading documents spends the
       * owner's file allowance on material the owner never
       * authorised, so this one defaults to off even when the
       * agent could do it.
       */
      fileAnalysis:
        agent.capabilities.includes("file_analysis") &&
        site.config.chat.allowUploads,
      memory: agent.capabilities.includes("memory"),
      /*
       * ACTIONS ON A PAGE ANYBODY CAN OPEN.
       *
       * The two are split here, and they are the only pair on
       * this list that is, because the question "may a stranger
       * cause this?" has two different answers.
       *
       * Running code is allowed when the agent has it. It is
       * sandboxed with no filesystem, no network and no
       * environment, so the worst a visitor can provoke is
       * arithmetic on the owner's action allowance — which is
       * the same shape as provoking a search, and the ceilings
       * on this door already bound it. Refusing it would make
       * every published page that is any good at data quietly
       * worse than the Test panel it was built in, which is the
       * one outcome a capability may never produce.
       *
       * Calling out to the internet is NOT, whatever the agent's
       * capabilities say, and this is a hard `false` rather than
       * a switch.
       *
       * A page URL goes wherever it is forwarded. An
       * http_actions turn presents the OWNER'S saved
       * credentials to somebody else's service, from
       * BuildGentic's address, and possibly changes something
       * there. Between "a stranger asked my agent a question"
       * and "a stranger caused my API key to be used", there is
       * a line, and it is not one a default should cross.
       *
       * The precedent is `allowUploads` directly above: an
       * agent capability the page must ALSO opt into, defaulting
       * to off for exactly this reason. The difference is that
       * uploads have that switch and this does not yet — so
       * until schema.ts grows one, the answer is no. An owner
       * who wants an agent that acts for strangers can deploy
       * it and put their own front end on it, which is a
       * decision they have to make on purpose.
       */
      codeExecution: agent.capabilities.includes("code_execution"),
      httpActions: false,
      /*
       * FILES AND RECORDS ON A PAGE ANYBODY CAN OPEN.
       *
       * Both hard `false`, and they sit with `httpActions`
       * rather than with `codeExecution` — which is the split
       * this list already makes, on the question "may a
       * stranger cause this?".
       *
       * Running code is allowed because the worst a visitor can
       * provoke is arithmetic in a sealed sandbox. These two
       * are different in the way that matters: they OUTLIVE THE
       * TURN. A file is written to the owner's storage and
       * counts against the owner's retention ceiling, so a
       * shared link becomes a way for strangers to evict the
       * owner's own reports. A record is worse — it is written
       * into the store the owner's agent will read back on its
       * next scheduled run, which would let anybody with the
       * URL put text on the trusted side of somebody else's
       * unattended turn.
       *
       * And the file could not be collected in any case: the
       * download route requires a Supabase session, which a
       * page visitor does not have.
       *
       * The precedent is `allowUploads` above — an agent
       * capability the page must ALSO opt into. If these two
       * ever get such a switch, the record one still should
       * not: see agents/data/scope.ts on why a model-chosen
       * write is a bigger grant than a model-read.
       */
      documentGeneration: false,
      dataStore: false,
      /*
       * THE MAILBOX, ON A PAGE ANYBODY CAN OPEN.
       *
       * Hard `false`, and this is the shortest argument on the
       * whole list. A published page is a URL that goes wherever
       * it is forwarded. There is no reading of "a visitor asked
       * my agent a question" that extends to "a visitor read my
       * inbox", and no switch worth building that would let an
       * owner opt into it by accident.
       *
       * BuildGentic's own Email Agent has no published page at
       * all — see `publishable` in the flagship catalogue — so
       * what this line actually covers is an agent a student
       * built themselves, gave email to, and then published.
       * That is the case that would otherwise arrive as a
       * surprise rather than as a decision.
       */
      emailRead: false,
      emailDraft: false,
      emailOrganize: false,
      stream: true,
    },
    /*
     * Always streaming, unlike the deployment endpoint.
     *
     * That one defaults to a single JSON body because a script
     * wants one thing it can parse and a curl that prints an
     * answer is the point of it. The only client here is a
     * browser rendering a conversation, and a chat that
     * appears all at once after eight seconds reads as broken.
     */
    stream: true,
    ...(readVisitorKey(raw) === undefined
      ? {}
      : { visitorKey: readVisitorKey(raw) }),
  };
}

/* =========================================================
   THE RESPONSE

   What a visitor is told when something goes wrong, which is
   less than an API caller is told, which is less than the
   owner is told.
========================================================= */

export interface SiteErrorBody {
  error: string;
  code: string;
  retryAfterSeconds?: number;
}

/*
 * Every failure, generalised.
 *
 * The rule is the one `toPublicError` follows next door, one
 * step further: an API caller is at least somebody the owner
 * chose to give a key to, and can be told that a quota was
 * exceeded. A visitor is nobody in particular, and "this
 * agent's owner has used their daily allowance" tells a
 * stranger about somebody else's account.
 *
 * So the whole family of quota, budget, provider and internal
 * failures collapses to one sentence. The distinction that
 * survives is only whether waiting will help, because that is
 * the one thing the visitor can act on.
 */
export function toSiteError(error: unknown): {
  status: number;
  body: SiteErrorBody;
} {
  if (error instanceof SiteRequestError) {
    /* The only message passed through verbatim. The caller
       wrote the request, so nothing in the complaint is news —
       and in practice this means our own page has a bug. */
    return {
      status: 400,
      body: { error: error.message, code: "invalid_request" },
    };
  }

  if (error instanceof AiRuntimeError) {
    if (error.code === "site_not_found") {
      return {
        status: 404,
        body: {
          error: "No agent answers at that address.",
          code: "not_found",
        },
      };
    }

    if (error.code === "cancelled") {
      return {
        status: 499,
        body: { error: "Cancelled.", code: "cancelled" },
      };
    }

    if (error.status === 429 || error.status === 503) {
      return {
        status: 429,
        body: {
          error:
            "This agent is busy right now. Give it a moment and try again.",
          code: "busy",
          ...(error.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
      };
    }
  }

  return {
    status: 502,
    body: {
      error: "This agent could not answer just now. Try again shortly.",
      code: "unavailable",
    },
  };
}
