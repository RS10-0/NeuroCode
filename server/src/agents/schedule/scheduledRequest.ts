import type { ParsedChatBody } from "../../ai/validation";
import type { AgentRecord, KnowledgeRecord } from "../AgentStore";
import { composeAgentSystem } from "../composeAgentSystem";

/*
 * What a schedule asks its agent.
 *
 * The sibling of deploymentRequest.ts, and deliberately its
 * near-copy: both answer the same awkward question, which is how
 * to build a request when the person whose agent it is, is not
 * here. A deployed caller has an application on the other end; a
 * scheduled run has a timer. Neither can be asked what the agent
 * is allowed to do, so neither is asked — both read it off the
 * stored row.
 *
 * There is no parseChatBody call in this file, and its absence
 * is the point. A deployed request begins as somebody else's
 * JSON and has to be validated into a shape; a scheduled request
 * begins as two rows this server already owns. There is no
 * untrusted input to validate, so there is nothing to reject —
 * and no field a caller could have supplied, because there is no
 * caller.
 */

export interface ScheduledChatInput {
  agent: AgentRecord;
  knowledge: KnowledgeRecord[];
  /* The owner's own typed string, verbatim. See below. */
  task: string;
}

export interface ScheduledChat {
  body: ParsedChatBody;
  /*
   * Whether this run may use any tool at all.
   *
   * Read back out by the runner rather than recomputed, because
   * the confabulation check needs to know whether "it used no
   * tools" means "it chose not to" or "it had none" — and those
   * deserve different treatment.
   */
  toolsAvailable: boolean;
}

export function buildScheduledChat(input: ScheduledChatInput): ScheduledChat {
  const { agent } = input;

  /*
   * Composed here, from the stored row, because there is no
   * browser to compose it.
   *
   * The same position routes/ai.ts is in for an official agent,
   * and it throws for the same reason: an owner's instructions
   * plus their knowledge can outgrow the system budget. A
   * schedule whose agent no longer fits is a real condition the
   * owner has to be told about, so it becomes a failed run
   * rather than a silently shorter prompt.
   */
  const system = composeAgentSystem(agent, input.knowledge).text;

  const codeExecution = agent.capabilities.includes("code_execution");
  const httpActions = agent.capabilities.includes("http_actions");

  /*
   * Any email capability counts as having tools, and so do the
   * two Phase 3 ones.
   *
   * This flag feeds the confabulation check, which needs "it
   * used no tools" to mean "it chose not to" rather than "it
   * had none". An email agent that reported on an inbox without
   * calling a single tool is exactly the run that should be
   * caught, and before this line it would have been waved
   * through as an agent that had nothing to call.
   */
  const emailTools =
    agent.capabilities.includes("email_read") ||
    agent.capabilities.includes("email_draft") ||
    agent.capabilities.includes("email_organize");

  return {
    toolsAvailable:
      codeExecution ||
      httpActions ||
      emailTools ||
      agent.capabilities.includes("document_generation") ||
      agent.capabilities.includes("data_store"),
    body: {
      ...(system ? { system } : {}),
      model: agent.model,
      settings: {
        temperature: agent.temperature,
        maxOutputTokens: agent.maxOutputTokens,
      },

      /*
       * ONE MESSAGE, AND IT IS THE OWNER'S OWN TYPED STRING.
       *
       * No conversation, no previous run's output, no
       * interpolation of anything fetched. That is a stronger
       * constraint than it looks, and it is what keeps the Phase
       * 1 tool posture standing.
       *
       * The whole action protocol rests on an asymmetry: the
       * INSTRUCTION is trusted and the TOOL OUTPUT is not, which
       * is why a result arrives nonce-fenced, quoted, and
       * labelled as data with the owner's rules restated after
       * it. A task assembled from anything a previous run
       * fetched would invert that — a poisoned API response
       * would become the next run's instruction, on the trusted
       * side of the fence, on a timer, with nobody reading it.
       *
       * So a schedule is a repeated single turn and never a
       * growing conversation. There is no column that could hold
       * one.
       */
      messages: [{ role: "user", content: input.task }],

      /*
       * Hardcoded, and the reason CLIENT_FEATURES excludes it. A
       * browser naming `agent_scheduled` would be claiming to be
       * this file; this file does not have to claim anything.
       *
       * It matters more than the equivalent line next door.
       * `agent_public` mislabels who asked; this one would
       * mislabel an interactive request as automation — and
       * automation is the one category allowed to run with
       * nobody watching.
       */
      feature: "agent_scheduled",
      agentId: agent.id,

      /*
       * Every capability off the stored row.
       *
       * The schedule row has no capability columns at all, which
       * is the structural version of this guarantee rather than
       * a convention this file happens to follow. If they lived
       * on the schedule they would be a second copy of the
       * owner's intent, free to disagree with the first — and
       * the disagreement would surface as an unattended run
       * spending credentials its owner switched off in the
       * Builder a month earlier.
       *
       * The consequence worth stating: switching a capability
       * off in the Builder switches it off for the schedule,
       * immediately, with no schedule edit and no second place
       * to remember.
       */
      knowledgeRetrieval: agent.capabilities.includes("knowledge_retrieval"),
      webSearch: agent.capabilities.includes("web_search"),
      codeExecution,
      httpActions,
      /*
       * The two Phase 3 capabilities, off the stored row like
       * everything else here — and this is the path they were
       * built for.
       *
       * A scheduled run is the case where both earn their
       * keep. Producing a file matters most when nobody is
       * watching, because the alternative is a wall of text in
       * an email that a person has to read on a phone; and the
       * store is the only thing on this platform that survives
       * from one run to the next, which is what turns "the
       * same sentence, four times a day, for ever" into
       * something that can notice a change.
       *
       * Both are still one turn, bounded by the same four
       * steps, and neither widens what a schedule may do to
       * anyone but its owner: a document is reachable only by
       * the account that owns the agent, and the store is
       * owner-scoped.
       */
      documentGeneration: agent.capabilities.includes("document_generation"),
      dataStore: agent.capabilities.includes("data_store"),

      /*
       * The mailbox, off the stored row like everything else
       * here — and this is the capability where "off the stored
       * row" deserves defending rather than restating.
       *
       * A scheduled run reads somebody's email while they are
       * asleep. That is the whole point of a morning digest, and
       * it is also a sentence somebody should have to agree to.
       * They do, twice, and neither agreement is a capability
       * column on this table:
       *
       *   The agent has to carry the capability, which its owner
       *   set in the Builder. Switching it off there switches it
       *   off for every schedule immediately, with no schedule
       *   to edit and no second place to remember.
       *
       *   AND THE SCHEDULE HAS TO HAVE BEEN PREVIEWED AND
       *   ENABLED BY HAND. `verified` plus `enableSchedule` is
       *   an existing gate and it already means nothing runs
       *   unattended until its owner has watched it run once and
       *   pressed the switch. So scheduled access to an inbox is
       *   never a default: it is always something a person did
       *   on purpose, having seen what it does first.
       *
       * A capability column here would be a second copy of the
       * owner's intent, free to disagree with the first — the
       * failure this file was written to avoid, and a worse one
       * with an inbox behind it.
       *
       * WHAT AN UNATTENDED RUN STILL CANNOT DO IS SEND. Not
       * because this file withholds it, but because there is no
       * send tool anywhere in the catalogue. A run may read,
       * summarise, and leave a draft in the tray for the
       * morning.
       */
      emailRead: agent.capabilities.includes("email_read"),
      emailDraft: agent.capabilities.includes("email_draft"),
      emailOrganize: agent.capabilities.includes("email_organize"),

      /*
       * Memory is read but never written, and this is the one
       * flag that is NOT simply the stored row's value.
       *
       * Recall is on when the agent has it, because this is the
       * owner's own agent acting on the owner's behalf — unlike
       * a deployment, whose callers get a deployment-scoped
       * store precisely so a stranger cannot read what the owner
       * told it.
       *
       * Writing is suppressed by the runner, which does not pass
       * a write scope. A memory write is an inference about a
       * person drawn from a conversation, and a scheduled run is
       * not a conversation: it is the same sentence, four times
       * a day, for as long as the schedule lives. Everything it
       * could learn it learned on the first run, so leaving
       * writes on would produce a store full of one fact,
       * restated — and crowd out the things the owner actually
       * said in the Builder.
       */
      memory: agent.capabilities.includes("memory"),

      /*
       * File Analysis is off, and there is nothing to turn on.
       *
       * A scheduled run has no attachments: the store holds
       * uploads in memory against a scope for half an hour, and
       * a timer firing at four in the morning has nothing in it.
       * Setting the flag would only mean the runtime looked, and
       * reported that it found nothing, on every run for ever.
       */
      fileAnalysis: false,
      attachments: [],

      /*
       * Not streamed. There is no socket to stream to — the
       * runner consumes the generator in-process, the way
       * respondWhole does, and collects the deltas into the row.
       */
      stream: false,
    },
  };
}
