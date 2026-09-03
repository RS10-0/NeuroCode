import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";

/*
 * Which of a learner's agents the extension may see, and which
 * of those may be handed a page.
 *
 * A TABLE BESIDE `agents` RATHER THAN TWO COLUMNS ON IT, and
 * the reason is migration 0015 rather than taste — it is worth
 * repeating here because this is the file somebody reads when
 * they wonder why the setting is not just a column.
 *
 * 0015 tightened the agents policy to
 *
 *   with check (auth.uid() = user_id and is_official = false)
 *
 * so a purchased Library agent cannot be written by its owner
 * AT ALL. That is what makes "learners cannot edit marketplace
 * agents" a database rule instead of a hidden button, and it is
 * what lets AgentStore resolve an official agent's prompt and
 * capabilities from the catalogue on every read.
 *
 * A column here would therefore have made it impossible to
 * switch the extension on for a Study Tutor somebody paid 100
 * XP for. The UPDATE would be refused by RLS, correctly, for a
 * rule with nothing to do with extensions — and the learner
 * would see a toggle that silently did not stick.
 *
 * So the setting lives beside the agent. It is the OWNER'S
 * choice about their own client, not part of the agent's
 * definition, and the table's policy carries no is_official
 * clause because of that distinction.
 *
 * NOTHING HERE WRITES. The Deploy screen writes this table
 * directly through RLS, the way the Builder writes an agent —
 * it is the learner's own data and RLS is the right guard for
 * it. This module exists so the SERVER can read it while
 * answering, with the service role, on a path where the caller
 * holds no Supabase session. Keeping it read-only is the
 * cheapest way to guarantee an extension turn can never change
 * what it is allowed to do, because there is no write to call.
 */

const COLUMNS =
  "agent_id, user_id, extension_enabled, extension_page_context";

export interface ExtensionSettings {
  agentId: string;
  extensionEnabled: boolean;
  extensionPageContext: boolean;
}

interface SettingsRow {
  agent_id: string;
  user_id: string;
  extension_enabled: boolean | null;
  extension_page_context: boolean | null;
}

/*
 * Normalised on the way in, the way AgentStore normalises a
 * status, and for the same reason: a row may have been written
 * by an older build or by hand, and a null where a boolean
 * belongs must not become an unhandled branch three files
 * later.
 *
 * Null reads as FALSE, which is the direction that fails
 * closed.
 */
function toSettings(row: SettingsRow): ExtensionSettings {
  const enabled = row.extension_enabled === true;

  return {
    agentId: row.agent_id,
    extensionEnabled: enabled,
    /*
     * Page context requires the agent to be enabled at all.
     * The database says so too — 0020 carries a CHECK — so this
     * is the second of two guards rather than the only one.
     * Both are cheap and the failure they prevent is an agent
     * that may read pages it can never be asked about.
     */
    extensionPageContext: enabled && row.extension_page_context === true,
  };
}

function fail(detail: string): never {
  throw new AiRuntimeError(
    "internal_error",
    "Unable to load this agent's extension settings.",
    { internalDetail: detail }
  );
}

/*
 * The settings for one agent, or null when there is no row.
 *
 * NULL MEANS NOT ENABLED, and that is the whole default-off
 * design: absence rather than a column value. There is no
 * setting to have been written wrongly, no migration backfill
 * that could have got it wrong, and no state in which an agent
 * is reachable because a default changed.
 *
 * The user id is a predicate here rather than an assumption.
 * The service-role client bypasses RLS, so `.eq("user_id", …)`
 * is the only thing standing between one learner and another's
 * — the rule every store in this project follows.
 */
export async function getSettings(
  userId: string,
  agentId: string
): Promise<ExtensionSettings | null> {
  const { data, error } = await supabase
    .from("agent_extension_settings")
    .select(COLUMNS)
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    fail(`agent_extension_settings select failed: ${error.message}`);
  }

  return data ? toSettings(data as SettingsRow) : null;
}

/*
 * Every agent id this learner has made extension-eligible.
 *
 * Ids only. The panel's list needs names and avatars too, but
 * those live on `agents` and are read from there by the route —
 * so this function stays one indexed read against one table and
 * the join happens where the ownership predicate already is.
 *
 * Filtered on `extension_enabled` in SQL rather than in Node,
 * which is what makes the partial index in 0020 the index this
 * query uses.
 */
export async function listEnabledAgentIds(
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("agent_extension_settings")
    .select("agent_id")
    .eq("user_id", userId)
    .eq("extension_enabled", true);

  if (error) {
    fail(`agent_extension_settings list failed: ${error.message}`);
  }

  return ((data ?? []) as { agent_id: string }[]).map((row) => row.agent_id);
}
