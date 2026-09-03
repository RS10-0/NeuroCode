import type {
  AiChatMessage,
  AiLimits,
  AiModel,
  AiRequestLimits,
} from "../../lib/aiClient";
import { composeSystem, countConversationChars } from "./compose";
import type { AgentDraft, KnowledgeEntry } from "./types";

/*
 * Every rule here mirrors one in server/src/ai/validation.ts.
 *
 * The server is the one that enforces them; this file exists so
 * that a learner finds out at the moment they type rather than
 * after a round trip that costs a quota slot. Where the two
 * could disagree, the server wins — which is why the limits are
 * arguments read from GET /api/ai/models rather than constants
 * copied into the browser.
 *
 * Two kinds of problem, kept apart on purpose:
 *
 *   saving   — is this a coherent agent? A name, a model.
 *   running  — will the runtime accept this request? The system
 *              budget, the conversation size.
 *
 * An agent can be perfectly saveable and not currently runnable,
 * and conflating the two would mean a learner whose knowledge
 * has grown too big loses the ability to save the work that got
 * them there.
 */

export type AgentField =
  | "name"
  | "description"
  | "instructions"
  | "model"
  | "temperature"
  | "maxOutputTokens"
  | "knowledge"
  | "conversation";

export type AgentErrors = Partial<Record<AgentField, string>>;

const MAX_NAME_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 240;

/* =========================================================
   SAVING
========================================================= */

export function validateConfig(
  draft: AgentDraft,
  model: AiModel | undefined,
  requestLimits: AiRequestLimits | undefined
): AgentErrors {
  const errors: AgentErrors = {};

  const name = draft.name.trim();

  if (!name) {
    errors.name = "Give your agent a name.";
  } else if (name.length > MAX_NAME_CHARS) {
    errors.name = `Names are at most ${MAX_NAME_CHARS} characters. This one is ${name.length}.`;
  }

  if (draft.description.trim().length > MAX_DESCRIPTION_CHARS) {
    errors.description = `Descriptions are at most ${MAX_DESCRIPTION_CHARS} characters. This one is ${draft.description.trim().length}.`;
  }

  if (!draft.model) {
    errors.model = "Choose a model.";
  } else if (!model) {
    /*
     * The id is set but is not one BuildGentic offers. Reachable
     * on an agent saved against an older catalogue, which is
     * the only way a draft can now name a model nobody picked.
     */
    errors.model =
      "This agent was built against an AI BuildGentic no longer offers. Re-save it to move it across.";
  }

  if (!Number.isFinite(draft.temperature) || draft.temperature < 0 || draft.temperature > 2) {
    errors.temperature = "Temperature must be between 0 and 2.";
  }

  if (!Number.isInteger(draft.maxOutputTokens) || draft.maxOutputTokens < 1) {
    errors.maxOutputTokens = "Reply length must be a whole number of at least 1.";
  } else if (model && draft.maxOutputTokens > model.maxOutputTokens) {
    errors.maxOutputTokens = `${model.displayName} allows at most ${model.maxOutputTokens.toLocaleString()} tokens on this power source.`;
  }

  if (
    requestLimits &&
    draft.instructions.length > requestLimits.maxSystemChars
  ) {
    errors.instructions = `Instructions are ${draft.instructions.length.toLocaleString()} characters; the limit is ${requestLimits.maxSystemChars.toLocaleString()}.`;
  }

  return errors;
}

/* =========================================================
   RUNNING
========================================================= */

/*
 * Whether this configuration can actually be sent right now.
 *
 * Takes the pending turns as well, because the two limits that
 * bite here are about size, and one of them counts the whole
 * conversation. A test chat that has run for twenty turns can
 * fail on a configuration that was fine on turn one, and saying
 * so before the send is far better than a 400 afterwards.
 */
export function validateRun(
  draft: AgentDraft,
  knowledge: KnowledgeEntry[],
  messages: AiChatMessage[],
  limits: AiLimits | undefined,
  requestLimits: AiRequestLimits | undefined
): AgentErrors {
  const errors: AgentErrors = {};

  if (!requestLimits || !limits) {
    return errors;
  }

  const composed = composeSystem(draft, knowledge, requestLimits.maxSystemChars);

  if (composed.overBy > 0) {
    const over = composed.entries.filter((entry) => !entry.fits);

    errors.knowledge =
      over.length > 0
        ? `Instructions and knowledge come to ${composed.totalChars.toLocaleString()} characters, which is ${composed.overBy.toLocaleString()} over the ${composed.budget.toLocaleString()} the model can be given. ${
            over.length === 1
              ? `"${over[0].title}" does not fit.`
              : `${over.length} entries do not fit, starting with "${over[0].title}".`
          }`
        : `Instructions and knowledge come to ${composed.totalChars.toLocaleString()} characters; the limit is ${composed.budget.toLocaleString()}.`;
  }

  if (messages.length > requestLimits.maxMessages) {
    errors.conversation = `This conversation is ${messages.length} messages; the limit is ${requestLimits.maxMessages}. Clear it to keep testing.`;
  }

  const tooLong = messages.find(
    (message) => message.content.length > requestLimits.maxMessageChars
  );

  if (tooLong) {
    errors.conversation = `One message is ${tooLong.content.length.toLocaleString()} characters; the limit is ${requestLimits.maxMessageChars.toLocaleString()}.`;
  }

  if (limits.maxInputChars > 0) {
    const chars = countConversationChars(composed.text, messages);

    if (chars > limits.maxInputChars) {
      errors.conversation = `This conversation and its instructions come to ${chars.toLocaleString()} characters; the limit is ${limits.maxInputChars.toLocaleString()}. Clear the conversation or shorten the knowledge.`;
    }
  }

  return errors;
}

export function hasErrors(errors: AgentErrors): boolean {
  return Object.values(errors).some(Boolean);
}
