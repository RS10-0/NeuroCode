/*
 * Every migration this build needs, and how to tell whether it
 * is actually in the database.
 *
 * THE REASON THIS FILE EXISTS is a session that went like this:
 * migration 0019 was never applied, nobody noticed, and 0020
 * failed days later with `relation "public.agent_email_drafts"
 * does not exist` — an error that names the symptom and not the
 * cause. The server had been starting cleanly the whole time,
 * because nothing ever asked whether the schema matched the
 * code.
 *
 * So the server asks now, at boot, and says so loudly when the
 * answer is no. A gap should cost somebody one glance at a
 * startup banner, not an afternoon.
 *
 * HOW A PROBE WORKS, and why it is a COLUMN and never a table.
 *
 * The obvious probe is `select * head:true` against the table.
 * It does not work: PostgREST answers a head-count against a
 * table that does not exist with NO ERROR and a null count, so
 * every table reads as present and the check passes on an empty
 * database. That is not a hypothetical — it is how the first
 * version of this got the answer exactly backwards.
 *
 * `select <column> limit 0` does report PGRST205 / PGRST204,
 * so every probe below names a column.
 *
 * WHAT IS NOT COVERED. Three migrations change no table shape:
 * 0008 and 0009 widen a CHECK constraint, and 0012 replaces a
 * function body. Nothing read-only can see them, and this file
 * says so rather than quietly implying full coverage — see
 * `UNPROBEABLE`. `scripts/verify-migrations.mts` confirms those
 * three behaviourally, which needs writes and therefore cannot
 * happen at boot.
 */

export interface SchemaProbe {
  /* The migration file's number, as it appears on disk. */
  id: string;
  /* Enough of the filename to find it. */
  name: string;
  table: string;
  column: string;
  /*
   * True when the migration's effect is that the column is
   * GONE. 0011 tears down BYOK, so `agents.power_source` being
   * absent is the evidence it ran.
   */
  absent?: boolean;
}

export const SCHEMA_PROBES: SchemaProbe[] = [
  { id: "0001", name: "baseline", table: "profiles", column: "username" },
  { id: "0002", name: "step_progress_and_xp", table: "onboarding", column: "completed" },
  { id: "0003", name: "ai_usage", table: "ai_usage", column: "quota_key" },
  { id: "0004", name: "byok_and_platform_budget", table: "ai_usage", column: "key_id" },
  { id: "0005", name: "agents", table: "agents", column: "system_instructions" },
  { id: "0006", name: "agent_deployments", table: "agent_deployments", column: "public_id" },
  { id: "0007", name: "knowledge_retrieval", table: "agent_knowledge_index", column: "agent_id" },
  { id: "0010", name: "agent_memory", table: "agent_memories", column: "user_id" },
  { id: "0011", name: "user_credits_and_byok_teardown", table: "user_credits", column: "balance" },
  {
    id: "0011",
    name: "byok teardown (agents.power_source dropped)",
    table: "agents",
    column: "power_source",
    absent: true,
  },
  {
    /*
     * The other half of the teardown: 0011 drops the table
     * outright. Worth asserting separately because a database
     * where the column went but the table stayed is a
     * half-applied 0011, and nothing else here would notice.
     *
     * `ai_usage.key_id` deliberately SURVIVES the teardown —
     * 0004 gave it no foreign key so that deleting a key would
     * not delete the history of what it spent — which is why
     * the 0004 probe above is still valid after 0011.
     */
    id: "0011",
    name: "byok teardown (user_ai_keys dropped)",
    table: "user_ai_keys",
    column: "id",
    absent: true,
  },
  { id: "0013", name: "agent_sites", table: "agent_sites", column: "deployment_id" },
  { id: "0014", name: "xp_wallet_v2", table: "user_credits", column: "max_balance" },
  { id: "0015", name: "flagship_agents", table: "agent_unlocks", column: "user_id" },
  { id: "0015", name: "flagship_agents (agents.is_official)", table: "agents", column: "is_official" },
  { id: "0016", name: "agent_actions", table: "agent_connections", column: "agent_id" },
  { id: "0017", name: "agent_schedules", table: "agent_schedules", column: "agent_id" },
  { id: "0018", name: "agent_documents_and_data", table: "agent_documents", column: "user_id" },
  { id: "0018", name: "agent_documents_and_data (agent_data)", table: "agent_data", column: "user_id" },
  { id: "0019", name: "email_agent", table: "user_email_accounts", column: "user_id" },
  { id: "0019", name: "email_agent (drafts)", table: "agent_email_drafts", column: "user_id" },
  { id: "0019", name: "email_agent (oauth states)", table: "user_email_oauth_states", column: "user_id" },
  { id: "0020", name: "browser_extension", table: "agent_extension_settings", column: "extension_enabled" },
  { id: "0020", name: "browser_extension (sessions)", table: "extension_sessions", column: "token_prefix" },
  { id: "0020", name: "browser_extension (account scope)", table: "user_account_scope", column: "page_context_scope" },
  {
    id: "0020",
    name: "browser_extension (draft provenance)",
    table: "agent_email_drafts",
    column: "source_page_url",
  },
  {
    /*
     * Listed separately from 0020's provenance probe rather
     * than replacing it, because a database with the four
     * columns and not the fifth is a real state — every
     * install between 0020 and 0021 — and the banner should
     * name which one is missing rather than reporting the
     * whole of the provenance work as absent.
     */
    id: "0021",
    name: "draft_capture_truncation",
    table: "agent_email_drafts",
    column: "source_page_truncated",
  },
];

/*
 * The three that change no shape, listed so the banner can name
 * them rather than leaving a silent gap between 0007 and 0010.
 *
 * A check that quietly skips what it cannot see is a check that
 * lies by omission, which is the failure mode this whole file
 * was written in response to.
 */
export const UNPROBEABLE: Array<{ id: string; name: string; why: string }> = [
  {
    id: "0008",
    name: "web_search",
    why: "widens ai_usage_feature_check only",
  },
  {
    id: "0009",
    name: "file_analysis",
    why: "widens ai_usage_feature_check only",
  },
  {
    id: "0012",
    name: "fix_grant_credits_conflict",
    why: "replaces the grant_credits body only",
  },
];

/* The newest migration this build expects. Bump it with each
   new file, so "up through the current one" is a fact in the
   code rather than something to remember. */
export const LATEST_MIGRATION = "0021";
