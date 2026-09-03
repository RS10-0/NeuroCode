import { supabase } from "../../lib/supabase";
import {
  AGENT_COLUMNS,
  KNOWLEDGE_COLUMNS,
  agentToDraft,
  draftToRow,
  knowledgeToRow,
  newId,
  rowToAgent,
  rowToKnowledge,
  type Agent,
  type AgentDraft,
  type AgentKnowledgeRow,
  type AgentRow,
  type AgentStatus,
  type KnowledgeEntry,
} from "./types";

/*
 * Agents, read and written straight from the browser.
 *
 * Which side of BuildGentic's line this falls on is worth stating,
 * because the project has both. Anything that must not be
 * forgeable — XP, quotas, provider keys — goes through Express
 * with the service role and a SECURITY DEFINER function, because
 * a learner who can write it can cheat it. Anything that is
 * merely the learner's own data goes browser-to-Supabase under
 * RLS, like progress.ts and onboarding.ts.
 *
 * An agent configuration is the second kind. Nothing in a row
 * here grants anything: the runtime re-resolves the model
 * against its own catalogue on every call, re-reads the power
 * source, and re-counts the quota, so a hand-edited row buys a
 * learner exactly nothing they could not have had by typing it
 * into the form.
 *
 * Every query still filters on `user_id` as well as relying on
 * the policy. Under RLS that predicate is redundant; it is here
 * so that this file reads the same as CredentialStore.ts on the
 * server, where the client bypasses RLS and the predicate is the
 * only thing doing the work.
 */

async function currentUserId(): Promise<string> {
  /*
   * getSession, not getUser: the id is only used to build a
   * filter and to stamp `user_id` on a write, and RLS is what
   * actually enforces both. A network round trip per call to
   * re-confirm something the policy checks anyway would be pure
   * latency. progress.ts makes the same call for the same
   * reason.
   */
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in.");
  }

  return session.user.id;
}

function fail(verb: string, message: string): never {
  throw new Error(`Unable to ${verb}: ${message}`);
}

/* =========================================================
   AGENTS
========================================================= */

export async function listAgents(): Promise<Agent[]> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    fail("load your agents", error.message);
  }

  return ((data ?? []) as unknown as AgentRow[]).map(rowToAgent);
}

/*
 * Null for both "no such agent" and "somebody else's agent",
 * deliberately indistinguishable — RLS returns no row either
 * way, and a caller that could tell them apart would be a way to
 * probe for ids that exist.
 */
export async function getAgent(agentId: string): Promise<Agent | null> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    fail("load this agent", error.message);
  }

  return data ? rowToAgent(data as unknown as AgentRow) : null;
}

/*
 * A plain insert rather than an upsert.
 *
 * There is no unique constraint to conflict on — two agents may
 * share a name on purpose — so there is nothing for an upsert to
 * resolve, and the race-safe `ignoreDuplicates` idiom used
 * elsewhere in this project would have no conflict target.
 */
export async function createAgent(draft: AgentDraft): Promise<Agent> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("agents")
    .insert(draftToRow(draft, userId))
    .select(AGENT_COLUMNS)
    .single();

  if (error) {
    fail("save this agent", error.message);
  }

  return rowToAgent(data as unknown as AgentRow);
}

export async function updateAgent(
  agentId: string,
  draft: AgentDraft
): Promise<Agent> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("agents")
    .update(draftToRow(draft, userId))
    .eq("id", agentId)
    .eq("user_id", userId)
    .select(AGENT_COLUMNS)
    .maybeSingle();

  if (error) {
    fail("save this agent", error.message);
  }

  if (!data) {
    throw new Error("That agent no longer exists.");
  }

  return rowToAgent(data as unknown as AgentRow);
}

/*
 * Marks an agent ready to deploy, or takes it back to a draft.
 *
 * A single-column update rather than a full save, because the
 * Deploy screen holds no draft to write and pushing one back
 * would silently overwrite whatever the Builder has open in
 * another tab.
 *
 * This stays a browser write under RLS, like every other agent
 * edit, and putting it behind Express would add API surface
 * without adding safety — a learner may already set this column
 * themselves, and nothing about the row is forgeable-valuable.
 * `ready` is a statement of intent, not a permission. The gate
 * that matters is on the server: POST /api/agents/:id/deployment
 * re-reads the row and refuses a draft.
 */
export async function setAgentStatus(
  agentId: string,
  status: AgentStatus
): Promise<Agent> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("agents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", agentId)
    .eq("user_id", userId)
    .select(AGENT_COLUMNS)
    .maybeSingle();

  if (error) {
    fail("update this agent", error.message);
  }

  if (!data) {
    throw new Error("That agent no longer exists.");
  }

  return rowToAgent(data as unknown as AgentRow);
}

/*
 * Copies an agent and everything it knows.
 *
 * The knowledge rows get fresh ids rather than being reinserted
 * with the originals': they belong to a different agent now, and
 * an id shared between two agents would make the chunk rows
 * retrieval adds later ambiguous about which one they index.
 *
 * The copy is always a draft, whatever the original was. A
 * duplicate has never been tested in its own right, and marking
 * it ready would be inheriting a judgement about a different
 * agent.
 */
export async function duplicateAgent(agentId: string): Promise<Agent> {
  const source = await getAgent(agentId);

  if (!source) {
    throw new Error("That agent no longer exists.");
  }

  const entries = await listKnowledge(agentId);

  const copy = await createAgent({
    ...agentToDraft(source),
    name: `${source.name} (copy)`.slice(0, 80),
    status: "draft",
  });

  if (entries.length > 0) {
    await syncKnowledge(
      copy.id,
      entries.map((entry) => ({ ...entry, id: newId() }))
    );
  }

  return copy;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const userId = await currentUserId();

  /* Knowledge goes with it through the composite foreign key's
     cascade — see supabase/migrations/0005_agents.sql. */
  const { error } = await supabase
    .from("agents")
    .delete()
    .eq("id", agentId)
    .eq("user_id", userId);

  if (error) {
    fail("delete this agent", error.message);
  }
}

/* =========================================================
   KNOWLEDGE
========================================================= */

export async function listKnowledge(
  agentId: string
): Promise<KnowledgeEntry[]> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("agent_knowledge")
    .select(KNOWLEDGE_COLUMNS)
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (error) {
    fail("load this agent's knowledge", error.message);
  }

  return ((data ?? []) as unknown as AgentKnowledgeRow[]).map(rowToKnowledge);
}

/*
 * Brings the stored knowledge in line with what is on screen.
 *
 * A three-way diff rather than delete-everything-then-reinsert,
 * which would have been fewer lines. Two reasons it is worth the
 * extra ten: an entry keeps its id and its `created_at` across
 * an edit, and — the one that actually decides it — the chunk
 * rows that retrieval will hang off a knowledge entry have to
 * reference something stable. Re-minting every id on every save
 * would invalidate an entire index because somebody fixed a
 * typo in an unrelated note.
 */
export async function syncKnowledge(
  agentId: string,
  entries: KnowledgeEntry[]
): Promise<KnowledgeEntry[]> {
  const userId = await currentUserId();

  const existing = await listKnowledge(agentId);
  const keep = new Set(entries.map((entry) => entry.id));

  const removed = existing
    .filter((entry) => !keep.has(entry.id))
    .map((entry) => entry.id);

  if (removed.length > 0) {
    const { error } = await supabase
      .from("agent_knowledge")
      .delete()
      .in("id", removed)
      .eq("user_id", userId);

    if (error) {
      fail("update this agent's knowledge", error.message);
    }
  }

  if (entries.length === 0) {
    return [];
  }

  /*
   * Upserted on the primary key, so a row the browser minted an
   * id for is inserted and one that already existed is updated,
   * in a single statement. `user_id` is stamped from the session
   * on every row; the composite foreign key on (agent_id,
   * user_id) is what stops a row from being attached to an agent
   * somebody else owns.
   */
  const { data, error } = await supabase
    .from("agent_knowledge")
    .upsert(
      entries.map((entry) => knowledgeToRow(entry, agentId, userId)),
      { onConflict: "id" }
    )
    .select(KNOWLEDGE_COLUMNS);

  if (error) {
    fail("save this agent's knowledge", error.message);
  }

  return ((data ?? []) as unknown as AgentKnowledgeRow[])
    .map(rowToKnowledge)
    .sort((a, b) => a.position - b.position);
}
