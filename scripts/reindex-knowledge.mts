/*
 * Re-embeds every agent's knowledge with the platform's CURRENT
 * embedding model. Run once after a deploy that changes that
 * model — most recently the move from Gemini to Cloudflare.
 *
 * WHY IT IS NEEDED. Chunks carry the key of the model that
 * embedded them, and a search only looks at chunks made by the
 * model doing the searching (two models' vectors cannot be
 * compared). So after a model change every existing chunk is
 * unsearchable, and an agent whose knowledge was indexed answers
 * as if it had none — until something re-indexes it. Nothing
 * does that on its own: the Builder only indexes when its owner
 * saves. This does it for everybody, now.
 *
 * WHAT IT CALLS. The same indexAgent the Builder's save calls,
 * so it embeds through the same quota gate and lands in the same
 * tables. Entries already current for the model are counted and
 * skipped without an embedding call, which makes this safe to
 * run twice. It loops each agent until nothing remains, because
 * one call stops at a per-request chunk budget.
 *
 * NEEDS server/.env pointing at the database to re-index — the
 * production one, to fix production — with the Cloudflare
 * credentials set. It writes to agent_knowledge_* and spends
 * embedding allowance (neurons) on Cloudflare.
 *
 *   npx tsx ./scripts/reindex-knowledge.mts --dry-run   (counts only)
 *   npx tsx ./scripts/reindex-knowledge.mts
 */

import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");

/* Load server/.env before any server module reads process.env,
   which config.ts and the Supabase client both do at import. */
for (const line of readFileSync("server/.env", "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);

  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const { supabase } = await import("../server/src/lib/supabase");
const { getAgentById } = await import("../server/src/agents/AgentStore");
const { indexAgent, knowledgeStatus } = await import(
  "../server/src/agents/knowledge/KnowledgeIndex"
);

console.log(`\nRE-INDEX KNOWLEDGE${dryRun ? " (dry run — nothing will be embedded)" : ""}\n`);

const { data, error } = await supabase
  .from("agent_knowledge")
  .select("agent_id, user_id");

if (error) {
  console.error(`  could not list knowledge: ${error.message}`);
  process.exit(1);
}

/* One run per agent, however many entries it has. */
const agents = new Map<string, string>();

for (const row of (data ?? []) as Array<{ agent_id: string; user_id: string }>) {
  agents.set(row.agent_id, row.user_id);
}

console.log(`  ${agents.size} agent(s) have knowledge\n`);

let embedded = 0;
let failures = 0;
let needed = 0;

for (const [agentId, userId] of agents) {
  const agent = await getAgentById(agentId).catch(() => null);

  if (!agent) {
    console.log(`  skip   ${agentId} — agent no longer exists`);
    continue;
  }

  const label = `${agent.name ?? agentId}`.slice(0, 40).padEnd(40);
  const before = await knowledgeStatus(userId, agent);

  needed += before.pending;

  if (before.pending === 0) {
    console.log(`  ok     ${label} already current`);
    continue;
  }

  if (dryRun) {
    console.log(`  needs  ${label} ${before.pending} entr${before.pending === 1 ? "y" : "ies"} to re-embed`);
    continue;
  }

  try {
    let outcome = await indexAgent(userId, agent);
    let passes = 1;
    let total = outcome.indexed;

    /* Bounded, so an entry that keeps failing cannot loop forever:
       a failure is recorded on the entry and it goes back to being
       sent inline, which is what the Builder does too. */
    while (outcome.remaining > 0 && passes < 25) {
      outcome = await indexAgent(userId, agent);
      total += outcome.indexed;
      passes += 1;
    }

    embedded += total;

    const failed = outcome.entries.filter((entry) => entry.state === "failed").length;
    failures += failed;

    console.log(
      `  done   ${label} ${total} re-embedded${failed ? `, ${failed} FAILED (sent inline instead)` : ""}`
    );
  } catch (err) {
    failures += 1;
    console.log(`  FAIL   ${label} ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\n=== SUMMARY ===");

if (dryRun) {
  console.log(`  ${needed} entr${needed === 1 ? "y needs" : "ies need"} re-embedding. Run again without --dry-run to do it.`);
} else {
  console.log(`  ${embedded} entr${embedded === 1 ? "y" : "ies"} re-embedded, ${failures} failure(s)`);
}

process.exit(failures > 0 ? 1 : 0);
