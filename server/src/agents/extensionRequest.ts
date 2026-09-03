import { AiRuntimeError } from "../ai/errors";
import { parseChatBody, type ParsedChatBody } from "../ai/validation";
import { composeAgentSystem } from "./composeAgentSystem";
import type { AgentRecord, KnowledgeRecord } from "./AgentStore";
import { parsePageContext, type CapturedPage } from "./extension/pageContext";
import type { ExtensionSettings } from "./extension/SettingsStore";

/*
 * What a browser extension is allowed to say.
 *
 * THE FOURTH DOOR. The Test panel, the deployment endpoint and
 * the published page are the other three, and the discipline
 * every phase since 1 has held is that a new caller declares
 * its own request shape rather than reusing the nearest
 * existing one.
 *
 * WHY THIS FILE EXISTS AT ALL, which is the decision worth
 * defending because the obvious alternative is one line of
 * routing.
 *
 * The extension behaves like the owner's Test panel. It would
 * therefore have been natural to point it at /api/ai/chat and
 * be done. That is wrong, and the reason is in ai/validation.ts:
 * THE TEST PANEL TAKES ITS CAPABILITY FLAGS FROM THE REQUEST
 * BODY. `httpActions`, `dataStore`, `documentGeneration` and
 * the three email flags all arrive on the wire, and
 * src/features/agents/compose.ts sends them off the on-screen
 * draft. There is no server-side cross-check against
 * `agents.capabilities` on that path at all.
 *
 * That is CORRECT for the Test panel, and validation.ts defends
 * it well: the caller is the account holder, so a forged flag
 * reaches only their own connections, their own drawer, their
 * own mailbox, at the cost of their own allowance. It is also
 * necessary there — the whole point of the Test panel is that
 * toggling a switch and asking again shows the difference,
 * which means running what is on screen rather than what was
 * last saved.
 *
 * Three things break that argument when the caller is an
 * extension.
 *
 * The premise shifts from "the caller is the account holder" to
 * "the caller is holding the account holder's token". Every
 * other self-asserting client is a page we serve, on our
 * origin, under our CSP, whose only input is what the owner
 * typed. This one is a client on disk, on a machine we do not
 * control, whose input includes a hostile web page.
 *
 * The Test panel's REASON for self-assertion does not exist
 * here. Nobody toggles capabilities in a side panel. This is a
 * use surface, not a build surface, and it should run what the
 * agent IS rather than what a client says it is.
 *
 * And the requirement is the opposite one: an extension must
 * not be able to reach a capability that is switched off for
 * that agent everywhere else. Reusing the Test panel's route
 * could not deliver that however carefully the extension were
 * written, because the guarantee would live in the client.
 *
 * So every flag below comes off the stored row, exactly as
 * schedule/scheduledRequest.ts reads them — that file is the
 * closest analogue, because it is also a caller with no browser
 * composing for it.
 */

/*
 * Fields a browser composes for itself on the Test panel and
 * MUST NOT compose here.
 *
 * Refused by name rather than ignored, following
 * deploymentRequest.ts: a field that is ignored is a field a
 * caller can send and believe they set, and a field that is
 * REFUSED is one they are told about. Every entry earns its
 * place that way.
 *
 * Note what this list is NOT. It is not a defence against a
 * hostile extension — the flags are read off the row below
 * regardless of what arrives, so sending one changes nothing
 * whether it is refused or not. It is a contract with the
 * people writing the client, so that a mistake surfaces as a
 * 400 during development rather than as an agent that quietly
 * behaves differently from the one its owner configured.
 */
const REFUSED_FIELDS = [
  /*
   * The system prompt is composed HERE, from the stored row,
   * for the reason routes/ai.ts composes an official agent's
   * server-side: the browser sending it is safe when the
   * browser is our own Builder showing what it sends. An
   * extension is neither.
   */
  "system",
  /*
   * Model and generation settings are part of how the owner
   * built the agent. A client that could change them would be
   * testing something other than the agent its owner saved.
   */
  "model",
  "temperature",
  "maxOutputTokens",
  "stop",
  /*
   * The ledger's only job is to say truthfully what was spent
   * on what. `agent_extension` is set below and cannot be
   * asked for — a caller who could name a feature could label
   * an extension turn as a Lab experiment, or worse as
   * automation.
   */
  "feature",
  /*
   * Every capability flag, refused as a group. Each one is read
   * off `agents.capabilities` below.
   */
  "knowledgeRetrieval",
  "webSearch",
  "fileAnalysis",
  "memory",
  "codeExecution",
  "httpActions",
  "documentGeneration",
  "dataStore",
  "emailRead",
  "emailDraft",
  "emailOrganize",
] as const;

export class ExtensionRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionRequestError";
  }
}

function refuse(message: string): never {
  throw new ExtensionRequestError(message);
}

export interface ExtensionChatInput {
  userId: string;
  agent: AgentRecord;
  knowledge: KnowledgeRecord[];
  settings: ExtensionSettings;
  /*
   * Whether this ACCOUNT may have pages read from it, resolved
   * by extension/AccountScope.ts before this is called.
   *
   * Passed in rather than looked up here, so that this module
   * stays synchronous and testable without a database — the
   * whole capability-boundary suite runs against it with no
   * keys at all, which is what makes step 3 of the build order
   * possible before any extension exists.
   */
  pageContextAllowed: boolean;
  body: unknown;
}

export interface ExtensionChat {
  parsed: ParsedChatBody;
  stream: boolean;
  /*
   * The captured page, if this turn carried one.
   *
   * Deliberately NOT folded into `parsed` as a rendered string
   * here. The runtime needs the structured value — to fit it
   * against the input budget, to refuse the turn if it does not
   * fit, and to hand its provenance to a drafted email — and a
   * pre-rendered block would have thrown all of that away.
   */
  pageContext?: CapturedPage;
}

export function buildExtensionChat(
  input: ExtensionChatInput
): ExtensionChat {
  const { agent } = input;

  if (
    typeof input.body !== "object" ||
    input.body === null ||
    Array.isArray(input.body)
  ) {
    refuse("The request body must be a JSON object.");
  }

  const raw = input.body as Record<string, unknown>;

  for (const field of REFUSED_FIELDS) {
    if (raw[field] !== undefined && raw[field] !== null) {
      refuse(
        `"${field}" cannot be set from the extension. It comes from the agent as its owner saved it.`
      );
    }
  }

  /* ----- page context ----- */

  let pageContext: CapturedPage | undefined;

  if (raw.pageContext !== undefined && raw.pageContext !== null) {
    /*
     * TWO INDEPENDENT PREDICATES, CHECKED IN THIS ORDER, and
     * both refuse by name rather than dropping the field.
     *
     * The per-agent switch is the owner's choice about this
     * agent. The account scope is about the person: whether
     * this account is 13+ with a consent scope that covers
     * having pages read from it. Neither implies the other,
     * and an account that fails the second must not be able to
     * reach capture by enabling the first.
     *
     * The account check is second so that its message is the
     * one a learner sees when both fail — "this agent is not
     * set up for it" is actionable, and it is the wrong thing
     * to say to somebody whose account can never do this.
     */
    if (!input.settings.extensionPageContext) {
      refuse(
        `"pageContext" cannot be sent for this agent. Turn on "Read the page" for it in BuildGentic first.`
      );
    }

    if (!input.pageContextAllowed) {
      refuse(
        `"pageContext" is not available on this account. Reading the page you are on is switched off here.`
      );
    }

    pageContext = parsePageContext(raw.pageContext);
  }

  /* ----- the conversation ----- */

  let parsed: ParsedChatBody;

  try {
    parsed = parseChatBody({
      messages: raw.messages,
      /*
       * Shape-checked by the same validator a browser's are, so
       * an extension's ids are held to exactly the rules the
       * Test panel's are. Ownership is a separate question and
       * was answered before this function ran, by getAgent
       * against the verified user id.
       */
      attachments: raw.attachments,
      stream: raw.stream,
      /* Named so the parser does not default it to "lab". It is
         overwritten below; this only gets it past validation. */
      feature: "agent_test",
    });
  } catch (error) {
    if (error instanceof AiRuntimeError && error.code === "invalid_request") {
      refuse(error.message);
    }

    throw error;
  }

  /* Throws when the owner's instructions and knowledge no
     longer fit the runtime's system budget — the same position
     routes/ai.ts and scheduledRequest.ts are in, and a real
     condition the owner has to be told about. */
  const system = composeAgentSystem(agent, input.knowledge).text;

  const stream = raw.stream !== false;

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
       * An extension naming `agent_extension` would be claiming
       * to be this file; this file does not have to claim
       * anything.
       */
      feature: "agent_extension",
      agentId: agent.id,

      /*
       * EVERY CAPABILITY OFF THE STORED ROW.
       *
       * The consequence worth stating rather than discovering:
       * switching a capability off in the Builder switches it
       * off in the extension immediately, with no extension
       * setting to edit and no second place to remember. That
       * is the same guarantee 0017 gave schedules by refusing
       * to put capability columns on the schedule table — a
       * second copy of the owner's intent is a copy free to
       * disagree with the first.
       */
      knowledgeRetrieval: agent.capabilities.includes("knowledge_retrieval"),
      webSearch: agent.capabilities.includes("web_search"),
      fileAnalysis: agent.capabilities.includes("file_analysis"),
      memory: agent.capabilities.includes("memory"),
      codeExecution: agent.capabilities.includes("code_execution"),
      httpActions: agent.capabilities.includes("http_actions"),

      /*
       * NOT HARD-`false`, unlike the deployment and site doors,
       * and the departure is deliberate enough to defend here.
       *
       * Those doors refuse these five because THE CALLER IS NOT
       * THE OWNER. deploymentRequest.ts says it plainly: a
       * document is reachable only through a
       * session-authenticated route matching the owner's user
       * id, so a key holder could not fetch what it produced; a
       * store record is a model-chosen write into the owner's
       * drawer, which is not a thing a stranger's turn should
       * cause; and email is somebody else's correspondence.
       *
       * Every one of those reasons is about the caller. This
       * caller IS the owner — verified, on their own account,
       * spending their own XP, downloading through their own
       * session. The structural obstacle does not exist, so the
       * extension sits on the Test panel side of that line.
       *
       * The mailbox is the one that deserves a second look, and
       * it got one. An agent with `email_read` on, reachable
       * from a side panel on a shared laptop, is a mailbox one
       * click from any page — but it is ALREADY one click from
       * the Test panel on that same laptop. The extension adds
       * reach, not capability, and reach is what
       * `extension_enabled` exists to control. What it also
       * gets is the provenance requirement: a draft shaped by a
       * captured page shows that page before anybody sends it.
       */
      documentGeneration: agent.capabilities.includes("document_generation"),
      dataStore: agent.capabilities.includes("data_store"),
      emailRead: agent.capabilities.includes("email_read"),
      emailDraft: agent.capabilities.includes("email_draft"),
      emailOrganize: agent.capabilities.includes("email_organize"),

      stream,
    },
    stream,
    ...(pageContext ? { pageContext } : {}),
  };
}
