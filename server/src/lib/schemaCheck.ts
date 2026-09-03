import { supabase } from "./supabase";
import {
  LATEST_MIGRATION,
  SCHEMA_PROBES,
  UNPROBEABLE,
  type SchemaProbe,
} from "./schemaManifest";

/*
 * Does the database match the code?
 *
 * Asked once, at boot, beside the capability banner — and
 * answered loudly when it does not, because the alternative is
 * what actually happened: 0019 unapplied for days, a server
 * starting cleanly the whole time, and the gap surfacing much
 * later as a migration failing on a table it had every right to
 * expect.
 *
 * READ-ONLY, and it must stay that way. This runs on every boot
 * of every instance; a check that writes is a check that
 * changes what it is measuring.
 *
 * NEVER THROWS, and never stops the server. A missing migration
 * is a serious problem, but refusing to start makes it a worse
 * one — the operator loses the running system AND the screen
 * that would have told them why. It shouts instead. The same
 * posture startScheduler takes for a missing schedules table.
 */

export interface SchemaState {
  missing: SchemaProbe[];
  /* Probes that could not be run at all — a network failure, a
     bad key. Distinguished from `missing` because "the schema
     is wrong" and "I could not tell" call for different
     reactions. */
  unknown: Array<{ probe: SchemaProbe; reason: string }>;
  checked: number;
}

/*
 * A COLUMN probe, never a table one.
 *
 * `select * head:true` against a table that does not exist
 * comes back with no error and a null count, so it reports
 * every table as present. That is not a hypothetical: it is how
 * the first version of this read a database missing two whole
 * migrations as fully applied. `select <column> limit 0`
 * returns PGRST205 for a missing table and PGRST204 for a
 * missing column, which is what makes this answerable at all.
 */
async function probeOne(
  probe: SchemaProbe
): Promise<"present" | "absent" | { error: string }> {
  const { error } = await supabase
    .from(probe.table)
    .select(probe.column)
    .limit(0);

  if (!error) {
    return "present";
  }

  const notThere =
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    error.code === "42P01" ||
    error.code === "42703" ||
    /does not exist|could not find/i.test(error.message);

  return notThere ? "absent" : { error: `${error.code ?? "?"}: ${error.message}` };
}

export async function inspectSchema(): Promise<SchemaState> {
  const missing: SchemaProbe[] = [];
  const unknown: Array<{ probe: SchemaProbe; reason: string }> = [];

  /*
   * Sequential rather than Promise.all. This runs once at boot
   * and there are two dozen probes; firing them together buys
   * a few hundred milliseconds and risks tripping rate limits
   * on a cold project, which would turn a diagnostic into a
   * false alarm.
   */
  for (const probe of SCHEMA_PROBES) {
    const result = await probeOne(probe);

    if (typeof result === "object") {
      unknown.push({ probe, reason: result.error });
      continue;
    }

    const satisfied = probe.absent ? result === "absent" : result === "present";

    if (!satisfied) {
      missing.push(probe);
    }
  }

  return { missing, unknown, checked: SCHEMA_PROBES.length };
}

/*
 * The banner.
 *
 * Returns lines rather than printing them, matching
 * describeAiConfig — so index.ts owns the ordering and this
 * module stays testable without capturing stdout.
 */
export async function describeSchema(): Promise<string[]> {
  let state: SchemaState;

  try {
    state = await inspectSchema();
  } catch (error) {
    return [
      "[schema] COULD NOT CHECK THE DATABASE SCHEMA.",
      `[schema]   ${error instanceof Error ? error.message : String(error)}`,
      "[schema]   The server is starting anyway. If requests fail with",
      "[schema]   'could not find the table', this is why.",
    ];
  }

  const lines: string[] = [];

  if (state.missing.length === 0 && state.unknown.length === 0) {
    lines.push(
      `[schema] up to date through ${LATEST_MIGRATION} (${state.checked} probes)`
    );
  }

  if (state.missing.length > 0) {
    /*
     * Deliberately shouty, and deliberately several lines.
     *
     * The failure this exists to prevent is somebody not
     * noticing. A single grey line among twenty startup
     * messages is a line people stop seeing by the second week,
     * so this takes up room proportional to how much it will
     * cost them to miss it.
     */
    const ids = [...new Set(state.missing.map((probe) => probe.id))].sort();

    lines.push("");
    lines.push(
      "  ============================================================"
    );
    lines.push("   MIGRATIONS ARE MISSING FROM THIS DATABASE");
    lines.push("");
    lines.push(`   Not applied: ${ids.join(", ")}`);
    lines.push("");

    for (const probe of state.missing) {
      lines.push(
        `     ${probe.id}  ${probe.name}` +
          `\n           expected ${probe.table}.${probe.column}` +
          (probe.absent ? " to be GONE" : "")
      );
    }

    lines.push("");
    lines.push("   Apply them in order from supabase/migrations/, lowest");
    lines.push("   number first. Every file is idempotent, so re-running an");
    lines.push("   already-applied one is a no-op.");
    lines.push("");
    lines.push("   The server is still starting. Anything that touches these");
    lines.push("   tables will fail until they exist.");
    lines.push(
      "  ============================================================"
    );
    lines.push("");
  }

  if (state.unknown.length > 0) {
    lines.push("[schema] some probes could not be run:");

    for (const { probe, reason } of state.unknown) {
      lines.push(`[schema]   ${probe.id} ${probe.table}.${probe.column} — ${reason}`);
    }
  }

  /*
   * Named even when everything passes. A reader who knows
   * exactly which three migrations this check cannot see will
   * not later mistake its silence for coverage — and the
   * pointer says where the answer does live.
   */
  lines.push(
    `[schema] not structurally probeable: ${UNPROBEABLE.map((m) => m.id).join(
      ", "
    )} — confirm with scripts/verify-migrations.mts`
  );

  return lines;
}
