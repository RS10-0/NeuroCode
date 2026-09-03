import { supabase } from "../lib/supabase";
import { AiRuntimeError } from "../ai/errors";
import { defaultModel } from "../ai/models";
import { flagshipKnowledge } from "./flagshipPrompts";
import type { Flagship } from "../../../src/features/agents/flagships";
import { newSectionId } from "../../../src/features/sites/schema";

/*
 * Building a learner's copy of one of BuildGentic's own agents.
 *
 * A SEPARATE MODULE FROM AgentStore, deliberately. That file
 * opens by promising it never writes — "an agent is edited in
 * the Builder, and a deployment must not be able to change one;
 * keeping this module read-only is the cheapest way to
 * guarantee that, because there is no write to call". Adding an
 * insert to it would spend that guarantee to save a file.
 *
 * Everything here runs with the service role, which is not a
 * convenience but the requirement: migration 0015 tightened the
 * RLS policy on `agents` so that a browser can never write a
 * row with `is_official = true`. The purchase endpoint is
 * therefore the only thing in the system that can create one,
 * and this is the only module it goes through.
 *
 * What is NOT written is as important as what is. The row
 * carries no `system_instructions`: the prompt is resolved from
 * flagshipPrompts.ts on every read, so improving it reaches
 * learners who bought the agent months ago. Writing a copy here
 * would freeze each learner's agent at the prompt that happened
 * to be current on the day they clicked buy.
 */

/*
 * The learner's existing copy of a flagship, if they have one.
 *
 * Purchases are idempotent at the wallet — `agent_unlocks` has
 * a unique key — but the AGENT row is separately deletable, and
 * the two facts come apart on purpose: the unlock is the
 * entitlement and the row is an instance. Somebody who deleted
 * their Writing Coach and asks for it again is re-adding, not
 * re-buying, and this is the query that tells those apart.
 */
export async function findFlagshipAgentId(
  userId: string,
  flagshipId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .eq("flagship_id", flagshipId)
    .maybeSingle();

  if (error) {
    throw new AiRuntimeError(
      "internal_error",
      "Unable to open your Agent Library.",
      { internalDetail: `agents select failed: ${error.message}` }
    );
  }

  return data ? (data as { id: string }).id : null;
}

/*
 * Creates the learner's copy, ready to use.
 *
 * `status: "ready"` rather than "draft", and that is the one
 * field here worth arguing about. Everywhere else in BuildGentic
 * "ready" is a statement of intent a learner makes about their
 * own work after testing it — and deliberately so; see
 * setAgentStatus.
 *
 * A flagship is different in exactly the way that matters:
 * BuildGentic wrote it, BuildGentic tested it, and the learner just
 * paid 200 XP for it. Handing them a draft they must promote
 * before it can be deployed would be asking them to vouch for
 * somebody else's work before they may use what they bought.
 */
export async function createFlagshipAgent(
  userId: string,
  flagship: Flagship
): Promise<string> {
  const model = defaultModel();

  const { data, error } = await supabase
    .from("agents")
    .insert({
      user_id: userId,
      name: flagship.name,
      description: flagship.description,
      avatar_emoji: flagship.avatarEmoji,
      avatar_tone: flagship.avatarTone,

      /* Empty on purpose. See the header. */
      system_instructions: "",

      model: model.id,
      temperature: flagship.temperature,
      max_output_tokens: model.defaultMaxOutputTokens,
      capabilities: flagship.capabilities,
      status: "ready",

      is_official: true,
      flagship_id: flagship.id,
    })
    .select("id")
    .single();

  if (error) {
    throw new AiRuntimeError(
      "internal_error",
      "That agent could not be added to your shelf.",
      { internalDetail: `agents insert failed: ${error.message}` }
    );
  }

  return (data as { id: string }).id;
}

/*
 * Copies the flagship's reference material onto the new agent.
 *
 * Fresh ids per learner rather than a shared one, for the
 * reason `duplicateAgent` gives: the chunk rows retrieval
 * creates hang off a knowledge entry, and an id shared between
 * two agents would make them ambiguous about which they index.
 *
 * `status` is deliberately absent from the payload, so the
 * column takes its default of 'inline'. A freshly seeded entry
 * therefore reaches the model by being pasted into the prompt
 * until the index run catches up, and never through both routes
 * at once — the same reasoning knowledgeToRow documents.
 *
 * Does not throw on failure. A learner who paid for an agent
 * must get the agent; reference material that failed to copy is
 * a degraded agent, not a failed purchase, and the alternative
 * is taking their XP and giving them nothing.
 */
export async function seedFlagshipKnowledge(
  userId: string,
  agentId: string,
  flagshipId: string
): Promise<number> {
  const seeds = flagshipKnowledge(flagshipId);

  if (seeds.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();

  const { error } = await supabase.from("agent_knowledge").insert(
    seeds.map((seed, index) => ({
      agent_id: agentId,
      user_id: userId,
      kind: "text",
      title: seed.title,
      content: seed.content,
      source_name: null,
      char_count: seed.content.length,
      position: index,
      updated_at: now,
    }))
  );

  if (error) {
    console.error(
      `[library] could not seed knowledge for ${flagshipId} on agent ${agentId}: ${error.message}`
    );

    return 0;
  }

  return seeds.length;
}

/*
 * Which published-page layout each flagship gets.
 *
 * A server-side decision because a learner never makes it:
 * migration 0015's policy stops them editing an official
 * agent, and the Customise screen hides its Design pane for
 * one. So the choice is made once, here, per agent, rather
 * than defaulting all five to "assistant" and pretending it
 * was considered.
 *
 * The mapping follows what each page is FOR, which is what
 * src/features/sites/templates.ts says a template is chosen on:
 *
 *   study    — a workspace somebody sits with for half an hour,
 *              prompts and capabilities beside a tall chat.
 *              Study Tutor and Coding Coach are both that.
 *   research — a document with the agent attached, for a page
 *              where method matters. Research Assistant.
 *   assistant — chat front and centre, for an agent people are
 *              meant to start using immediately. The other two.
 */
export function siteTemplateFor(flagshipId: string): string {
  switch (flagshipId) {
    case "study-tutor":
    case "coding-coach":
      return "study";
    case "research-assistant":
      return "research";
    default:
      return "assistant";
  }
}

/*
 * The page's content sections, built from what the agent can
 * actually do.
 *
 * `starterConfig` cannot be used for these, and finding out why
 * is worth recording. It writes PLACEHOLDER prose — "Replace
 * this with something only your agent does", "Say which
 * documents or notes it was given" — which is exactly right for
 * a student who is about to edit it, and exactly wrong here.
 * Nobody can edit a flagship's page, so a placeholder on one is
 * permanent. The first published Writing Coach page carried
 * three of them.
 *
 * So the sections are generated instead, and generated from the
 * CAPABILITY LIST rather than from hand-written copy per agent.
 * That choice buys the property that matters on a page nobody
 * maintains: it cannot go stale. Switch File Analysis off for
 * an agent and the card describing it stops being published,
 * because there is no second place where that fact is written
 * down.
 *
 * The agent-specific half is the description, which the
 * catalogue already carries and which the hero and the About
 * section both use.
 */
export function flagshipSections(flagship: Flagship): unknown[] {
  const cards = flagship.capabilities
    .filter((id) => id !== "chat")
    .map((id) => CAPABILITY_CARDS[id])
    .filter((card): card is CapabilityCard => Boolean(card))
    .map((card) => ({
      id: newSectionId("f"),
      icon: card.icon,
      title: card.title,
      body: card.body,
    }));

  const sections: unknown[] = [
    {
      id: newSectionId(),
      kind: "about",
      title: "About this agent",
      body: flagship.description,
    },
  ];

  if (cards.length > 0) {
    sections.push({
      id: newSectionId(),
      kind: "features",
      title: "What it can do",
      items: cards,
    });
  }

  return sections;
}

interface CapabilityCard {
  icon: string;
  title: string;
  body: string;
}

/*
 * One card per capability, written to be true of every agent
 * that has it.
 *
 * Deliberately not per-agent: the specificity belongs in the
 * description above, and four agents' worth of near-identical
 * copy about File Analysis is four places for it to drift.
 *
 * Icons come from SECTION_ICONS in src/features/sites/schema.ts
 * — names rather than glyphs, so the renderer decides what to
 * draw.
 *
 * MAKE FILES AND KEEP RECORDS HAVE NO CARD, DELIBERATELY, and
 * this is now the one place where a missing entry is a decision
 * rather than an omission. All five flagships have both
 * capabilities since Phase 3, so the filter above drops them
 * silently — which happens to be right, and would stop being
 * right the moment somebody helpfully filled the gap.
 *
 * The sections built here are for the PUBLISHED PAGE, and both
 * capabilities are hard `false` on that door: see the note on
 * documentGeneration in sites/siteRequest.ts, which explains
 * that a file written by a visitor's turn counts against the
 * owner's retention ceiling and could not be downloaded by the
 * visitor anyway, and agents/data/scope.ts on why a
 * model-chosen write is a bigger grant than a model-read.
 *
 * So a card here would be the exact failure this generator was
 * built to prevent, pointed the other way. The header's promise
 * is that a card cannot outlive the capability behind it; this
 * is a capability whose card would never have been true on the
 * surface the card appears on. Both are the same rule — the
 * page says only what the page can do.
 */
const CAPABILITY_CARDS: Record<string, CapabilityCard> = {
  file_analysis: {
    icon: "file",
    title: "Reads what you upload",
    body: "Attach a document and ask about what is in it. The answer comes from the file itself rather than from a guess about it.",
  },
  memory: {
    icon: "brain",
    title: "Remembers you",
    body: "It keeps track of what you are working on and what you have already covered, so you are not starting from scratch every time.",
  },
  web_search: {
    icon: "globe",
    title: "Checks the live web",
    body: "When an answer depends on something current, it looks it up and tells you which pages it used.",
  },
  knowledge_retrieval: {
    icon: "book",
    title: "Knows its material",
    body: "It searches what it has been given for each question and draws on the parts that actually match, rather than everything at once.",
  },
};
