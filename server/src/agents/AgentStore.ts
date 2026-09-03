import { supabase } from "../lib/supabase";
import { AiRuntimeError } from "../ai/errors";
import { findFlagship } from "../../../src/features/agents/flagships";
import { flagshipPrompt } from "./flagshipPrompts";

/*
 * The server's read of an agent.
 *
 * Phase 2.3 kept agents entirely browser-side, on the stated
 * grounds that an agent configuration is the learner's own data
 * and RLS is the right guard for it. That is still true for
 * editing. It stops being true the moment a stranger's request
 * has to be answered from one of these rows: the caller is not
 * the owner, holds no Supabase session, and RLS has nothing to
 * match on. So a deployed request reads through here, with the
 * service role.
 *
 * Which means the explicit `.eq("user_id", ...)` on every query
 * below is not belt-and-braces the way it is in
 * src/features/agents/agentStore.ts. The service-role client
 * bypasses RLS, so that predicate is the only thing standing
 * between one learner and another learner's agent — exactly as
 * documented in CredentialStore.
 *
 * Nothing here writes. An agent is edited in the Builder, and a
 * deployment must not be able to change one; keeping this module
 * read-only is the cheapest way to guarantee that, because there
 * is no write to call.
 */

export type AgentStatus = "draft" | "ready";

export interface AgentRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  avatarEmoji: string;
  avatarTone: string;
  systemInstructions: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  capabilities: string[];
  status: AgentStatus;
  /* One of BuildGentic's own agents, bought from the Library
     rather than built in the Builder. */
  isOfficial: boolean;
  /* Which flagship it is a copy of, for an official agent. Null
     for everything a learner made themselves. */
  flagshipId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRecord {
  id: string;
  title: string;
  content: string;
  status: string;
  position: number;
  charCount: number;
}

const AGENT_COLUMNS =
  "id, user_id, name, description, avatar_emoji, avatar_tone, system_instructions, model, temperature, max_output_tokens, capabilities, status, is_official, flagship_id, created_at, updated_at";

/* Only what the composer needs. `content` is the large column
   and the only reason to read this table at all. */
const KNOWLEDGE_COLUMNS = "id, title, content, status, position, char_count";

interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  avatar_emoji: string;
  avatar_tone: string;
  system_instructions: string;
  model: string;
  temperature: number | string;
  max_output_tokens: number;
  capabilities: string[] | null;
  status: string;
  is_official: boolean | null;
  flagship_id: string | null;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRow {
  id: string;
  title: string;
  content: string;
  status: string;
  position: number;
  char_count: number;
}

/*
 * Normalised on the way in, the same way the browser's mapper
 * does it and for the same reason: a row may have been written
 * by an older build or by hand in the SQL editor, and a value
 * outside the CHECK constraint's vocabulary must not become an
 * unhandled branch three files later.
 */
function asStatus(value: unknown): AgentStatus {
  return value === "ready" ? "ready" : "draft";
}

function toAgent(row: AgentRow): AgentRecord {
  /*
   * AN OFFICIAL AGENT'S INSTRUCTIONS COME FROM THE CATALOGUE,
   * NOT FROM THE ROW.
   *
   * This is the line that makes migration 0015's decision not
   * to seed the five agents pay off. The purchase writes a row
   * naming which flagship it is and leaves system_instructions
   * empty; the prompt is resolved here, on every read, from
   * ./flagshipPrompts — which never leaves the server, because
   * the prompt is the thing the learner paid for.
   *
   * So improving Writing Coach's prompt improves it for the
   * learner who bought it last term, on their very next
   * question. A copy taken at purchase time could never do
   * that, and BuildGentic's own quality bar would be frozen at
   * whatever it was on the day each learner clicked buy.
   *
   * A row naming a flagship this build no longer ships falls
   * back to whatever the row itself holds — which is honest
   * rather than helpful, and is exactly what a retired agent
   * should look like. It does not invent a replacement.
   */
  const officialPrompt = flagshipPrompt(row.flagship_id);

  /*
   * AND SO DO ITS CAPABILITIES, for the same reason and one
   * more that the prompt does not have.
   *
   * The reason it shares: a capability list copied at purchase
   * time freezes what BuildGentic's own agent can do at
   * whatever the catalogue said on the day somebody clicked
   * buy. Phase 3 gave all five of them Make Files and Keep
   * Records; without this line, every learner who bought a
   * Writing Coach before that shipped has one that cannot
   * export their draft, and no way to fix it — see below.
   *
   * The reason it does not: THERE IS NO OTHER PATH. A prompt
   * copy could at least have been backfilled. An official
   * agent's row cannot be written by its owner at all —
   * migration 0015's WITH CHECK is `is_official = false`, which
   * is what makes "learners cannot edit marketplace agents" a
   * database rule rather than a hidden button — so the row's
   * `capabilities` column is unreachable from the Builder, from
   * the Library, and from every browser path in the product.
   * Changing it would mean a hand-pasted UPDATE per release,
   * which is a second copy of the catalogue that starts
   * drifting the moment it is written.
   *
   * The stored column stays exactly as the purchase wrote it.
   * It is a record of what was bought, and it is what a row
   * naming a flagship this build has RETIRED falls back to —
   * the same honest degradation the prompt above takes, and for
   * the same reason: a retired agent should look retired rather
   * than be handed an invented replacement.
   *
   * The mirror of this is in the browser's own mapper,
   * src/features/agents/types.ts, which has to agree — it is
   * what decides the flags the Test panel sends.
   */
  const official =
    row.is_official === true ? findFlagship(row.flagship_id) : undefined;

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    avatarEmoji: row.avatar_emoji,
    avatarTone: row.avatar_tone,
    systemInstructions: officialPrompt ?? row.system_instructions ?? "",
    model: row.model,
    temperature: Number(row.temperature),
    maxOutputTokens: Number(row.max_output_tokens),
    capabilities: official
      ? [...official.capabilities]
      : (row.capabilities ?? []),
    status: asStatus(row.status),
    isOfficial: row.is_official === true,
    flagshipId: row.flagship_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/*
 * Null for both "no such agent" and "somebody else's agent",
 * deliberately. The caller turns that into a 404, which is the
 * only thing another learner's id should ever look like.
 */
export async function getAgent(
  userId: string,
  agentId: string
): Promise<AgentRecord | null> {
  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AiRuntimeError("internal_error", "Unable to load that agent.", {
      internalDetail: `agents select failed: ${error.message}`,
    });
  }

  return data ? toAgent(data as AgentRow) : null;
}

/*
 * The agent behind a deployment, resolved without a user id
 * because a deployed caller has none to offer.
 *
 * Safe precisely because the id does not come from the request:
 * it comes off the deployment row, which was itself found by a
 * verified key. Ownership is inherited rather than asserted.
 */
export async function getAgentById(
  agentId: string
): Promise<AgentRecord | null> {
  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("id", agentId)
    .maybeSingle();

  if (error) {
    throw new AiRuntimeError("internal_error", "Unable to load that agent.", {
      internalDetail: `agents select failed: ${error.message}`,
    });
  }

  return data ? toAgent(data as AgentRow) : null;
}

export async function listKnowledge(
  userId: string,
  agentId: string
): Promise<KnowledgeRecord[]> {
  const { data, error } = await supabase
    .from("agent_knowledge")
    .select(KNOWLEDGE_COLUMNS)
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (error) {
    throw new AiRuntimeError(
      "internal_error",
      "Unable to load this agent's knowledge.",
      { internalDetail: `agent_knowledge select failed: ${error.message}` }
    );
  }

  return ((data ?? []) as KnowledgeRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    position: Number(row.position),
    charCount: Number(row.char_count),
  }));
}

/* How many entries an agent has, without loading any of them.
   The Deploy screen shows the count and nothing else. */
export async function countKnowledge(
  userId: string,
  agentId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("agent_knowledge")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("user_id", userId);

  if (error) {
    throw new AiRuntimeError(
      "internal_error",
      "Unable to load this agent's knowledge.",
      { internalDetail: `agent_knowledge count failed: ${error.message}` }
    );
  }

  return count ?? 0;
}
