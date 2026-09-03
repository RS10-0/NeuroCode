/*
 * Read-only audit: does any stored data still say NeuroLink?
 *
 * Reads server/.env the same way verify-schedules-e2e.mts does,
 * so no secret needs to be pasted anywhere. Prints only the
 * non-secret brand settings and row counts.
 *
 *   npx tsx ./scripts/audit-brand-data.mts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/*
 * Duplicate keys matter here. readEnv keeps the LAST assignment,
 * which is also what dotenv does -- so if a key is set twice in
 * the file, this reports the value the server actually uses.
 */
function duplicateKeys(path: string): string[] {
  const seen = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

const serverEnv = readEnv("server/.env");

console.log("=== BRAND ENV (non-secret) ===");
for (const key of [
  "NEUROLINK_MAIL_FROM",
  "NEUROLINK_OPENROUTER_TITLE",
  "NEUROLINK_PUBLIC_SITE_URL",
  "NEUROLINK_PUBLIC_API_URL",
]) {
  console.log(`  ${key} = ${serverEnv[key] ?? "(unset)"}`);
}

const dupes = duplicateKeys("server/.env").filter((k) =>
  k.startsWith("NEUROLINK_") || k.startsWith("SUPABASE")
);
console.log(
  `\n  duplicate keys: ${dupes.length ? dupes.join(", ") + "  <-- last one wins" : "none"}`
);

const admin = createClient(
  serverEnv.SUPABASE_URL,
  serverEnv.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("\n=== agent_sites ===");
const { data: sites, error } = await admin
  .from("agent_sites")
  .select("id, slug, published, updated_at, config");

if (error) {
  console.log(`  query failed: ${error.message}`);
  process.exit(1);
}

const rows = sites ?? [];
const live = rows.filter((r) => r.published);
console.log(`  ${rows.length} row(s) total, ${live.length} published`);

let stale = 0;
for (const row of rows) {
  const json = JSON.stringify(row.config ?? {});
  const hits = (json.match(/NeuroLink/gi) ?? []).length;
  if (hits > 0) stale += 1;
  console.log(
    `  - /${row.slug}  published=${row.published}  neurolink-hits=${hits}`
  );
  if (hits > 0) {
    for (const frag of json.match(/.{0,60}NeuroLink.{0,60}/gi) ?? []) {
      console.log(`      … ${frag}`);
    }
  }
}
console.log(`\n  rows needing backfill: ${stale}`);

/* The other place free text is stored per learner. */
console.log("\n=== agents (name/description spot-check) ===");
const { data: agents, error: agentErr } = await admin
  .from("agents")
  .select("id, name, description");

if (agentErr) {
  console.log(`  query failed: ${agentErr.message}`);
} else {
  const hits = (agents ?? []).filter((a) =>
    /NeuroLink/i.test(`${a.name ?? ""} ${a.description ?? ""}`)
  );
  console.log(`  ${(agents ?? []).length} row(s), ${hits.length} mentioning NeuroLink`);
  for (const a of hits) console.log(`  - ${a.name}: ${a.description}`);
}
