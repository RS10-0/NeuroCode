import { dataStore as config } from "../../ai/config";
import type { ToolContext, ToolOutcome, ToolSpec } from "../actions/catalog";

import { explainKey, isValidKey } from "./keys";
import type { DataScope } from "./scope";

/*
 * The store itself is imported inside each `run`, never at the
 * top of this file.
 *
 * The same reason catalog.ts gives for loading ConnectionStore
 * lazily: DataStore reaches the Supabase client, which refuses
 * to load without SUPABASE_URL, and nothing else in the
 * catalogue needs a database at all. A static import here would
 * mean the sandbox, every tool description and the whole
 * offline verification suite could not be loaded on a machine
 * without those variables — for the sake of four branches that
 * genuinely do need them.
 *
 * The key validator is in keys.ts precisely so it can be
 * imported statically, which keeps the argument checks above
 * the database line.
 */
async function store(): Promise<typeof import("./DataStore")> {
  return import("./DataStore");
}

/*
 * The four store tools.
 *
 * Written terse on purpose. `renderActionContext` emits every
 * enabled tool's description into the system prompt, and with
 * six capabilities on that block is already the largest thing
 * in it after the owner's own instructions — so the shared
 * explanation lives once, on `data_set`, and the other three
 * are two lines each. The verification suite asserts the whole
 * composed block stays inside a budget with everything enabled.
 *
 * Four ids rather than one tool with a `verb` argument, because
 * a closed union is the thing that makes model output safe to
 * dispatch on: `parseAction` refuses a name that is not in
 * `ActionToolId`, and a verb inside `args` would move that
 * check out of the parser and into four branches of one tool.
 */

/* Every tool here needs a saved agent, for the reason Memory
   does: records hang off an agent id and a draft has none. The
   message says which state the learner is in rather than
   reporting a failure they cannot interpret. */
function scopeFor(context: ToolContext): DataScope | null {
  if (!context.agentId) {
    return null;
  }

  return { kind: "owner", userId: context.userId, agentId: context.agentId };
}

function noAgent(summary: string): ToolOutcome {
  return {
    ok: false,
    output: "",
    error:
      "The store is only available to a saved agent. Save this agent first, then try again.",
    summary,
    ms: 0,
  };
}

/* =========================================================
   data_set
========================================================= */

const dataSet: ToolSpec = {
  id: "data_set",
  capability: "dataStore",

  description: () =>
    [
      "data_set — save something you will need in a later conversation.",
      "  Your own notebook: it survives between answers and between scheduled runs. You do not remember previous conversations, but you can read this back.",
      `  args: { "key": "<name>", "value": "<text>", "label": "<optional note on what it is for>" }`,
      '  Names are lowercase with no spaces, and may use _ . : / and -. Group related things under a prefix like "habits/2026-09-01", and data_list can then fetch the whole group.',
      `  A value is text up to ${config.maxValueChars.toLocaleString()} characters; write JSON into it and read it back with run_code if you need structure.`,
      `  You may keep ${config.maxRecords} records. Saving over a name replaces it. If the store is full you are told and nothing is deleted to make room — say so rather than working around it.`,
    ].join("\n"),

  async run(args, context): Promise<ToolOutcome> {
    const startedAt = Date.now();
    const scope = scopeFor(context);

    if (!scope) {
      return noAgent("no agent for the store");
    }

    if (context.turn && context.turn.dataWrites >= config.maxWritesPerTurn) {
      return {
        ok: false,
        output: "",
        error: `You have already saved ${context.turn.dataWrites} records in this answer, which is the limit. Answer with what you have.`,
        summary: "write limit reached",
        ms: 0,
      };
    }

    const key = args.key;

    if (!isValidKey(key)) {
      return {
        ok: false,
        output: "",
        error: explainKey(key),
        summary: "bad record name",
        ms: 0,
      };
    }

    const value =
      typeof args.value === "string"
        ? args.value
        : typeof args.value === "number" || typeof args.value === "boolean"
          ? String(args.value)
          : null;

    if (value === null || value === "") {
      return {
        ok: false,
        output: "",
        error: 'Missing `value`. Give the text to save, like {"key":"habits/2026-09-01","value":"pushups: 30"}.',
        summary: "no value given",
        ms: 0,
      };
    }

    if (value.length > config.maxValueChars) {
      return {
        ok: false,
        output: "",
        error: `That value is ${value.length.toLocaleString()} characters and the limit is ${config.maxValueChars.toLocaleString()}. Save a summary, or split it across two records.`,
        summary: "value too long",
        ms: 0,
      };
    }

    const label =
      typeof args.label === "string" && args.label.trim() !== ""
        ? args.label.trim().slice(0, config.maxLabelChars)
        : undefined;

    const { putRecord } = await store();
    const result = await putRecord(scope, key, value, label);

    /*
     * A full store is a REFUSAL the model reads, not an
     * exception and not an eviction.
     *
     * Memory evicts at its ceiling because a memory is the
     * machine's own inference. These are records somebody asked
     * for, and dropping the oldest row of a log to make space
     * is data loss its owner never sees. So the model is told
     * exactly how full it is and by how much it is over, which
     * is a sentence it can pass on to a person who can act on
     * it.
     */
    if (result.status === "full_records") {
      return {
        ok: false,
        output: "",
        error: `The store is full: ${result.records} of ${config.maxRecords} records. Nothing was deleted to make room. Tell the person their agent's store is full and that they can clear records in the Builder.`,
        summary: `store full (${result.records} records)`,
        ms: Date.now() - startedAt,
      };
    }

    if (result.status === "full_chars") {
      return {
        ok: false,
        output: "",
        error: `The store is full: ${result.chars.toLocaleString()} of ${config.maxTotalChars.toLocaleString()} characters. Nothing was deleted to make room. Tell the person their agent's store is full and that they can clear records in the Builder.`,
        summary: "store full (size)",
        ms: Date.now() - startedAt,
      };
    }

    if (context.turn) {
      context.turn.dataWrites += 1;
    }

    const verb =
      result.status === "created"
        ? "Saved"
        : result.status === "restored"
          ? "Restored and updated"
          : "Updated";

    return {
      ok: true,
      output: `${verb} "${key}". The store now holds ${result.records} of ${config.maxRecords} records.`,
      summary: `${verb.toLowerCase()} ${key}`,
      ms: Date.now() - startedAt,
    };
  },
};

/* =========================================================
   data_get
========================================================= */

const dataGet: ToolSpec = {
  id: "data_get",
  capability: "dataStore",

  description: () =>
    [
      "data_get — read back something you saved.",
      `  args: { "key": "<name>" }`,
      "  If nothing is saved under that name you are told so. That is an answer, not a failure — do not invent what it might have said.",
    ].join("\n"),

  async run(args, context): Promise<ToolOutcome> {
    const startedAt = Date.now();
    const scope = scopeFor(context);

    if (!scope) {
      return noAgent("no agent for the store");
    }

    const key = args.key;

    if (!isValidKey(key)) {
      return {
        ok: false,
        output: "",
        error: explainKey(key),
        summary: "bad record name",
        ms: 0,
      };
    }

    const { getRecord } = await store();
    const record = await getRecord(scope, key);

    /*
     * A miss is a SUCCESSFUL step with a negative answer, not a
     * failed one.
     *
     * The distinction matters more here than anywhere else in
     * the catalogue. A failed step reaches the model through
     * `renderFailure`, which says "you have NO result from it"
     * — correct for a dead endpoint, and wrong for a store that
     * answered clearly. Worse, a failure invites a retry, and
     * an agent that retries a lookup of something that is not
     * there spends its whole step budget proving a negative.
     *
     * So this is `ok: true` with "nothing saved", which is the
     * true statement, arrives through the ordinary quoted
     * result renderer, and lets the agent get on with it.
     */
    if (!record) {
      return {
        ok: true,
        output: `Nothing is saved under "${key}".`,
        summary: `no record: ${key}`,
        ms: Date.now() - startedAt,
      };
    }

    return {
      ok: true,
      output: record.value,
      summary: `read ${key}, ${record.value.length} characters`,
      ms: Date.now() - startedAt,
    };
  },
};

/* =========================================================
   data_list
========================================================= */

const dataList: ToolSpec = {
  id: "data_list",
  capability: "dataStore",

  description: () =>
    [
      "data_list — see what names you have saved, without reading them.",
      `  args: { "prefix": "<optional>" } — with a prefix, only names starting with it, so "habits/" gives that whole group.`,
      "  Returns names and sizes only. Use data_get to read one.",
    ].join("\n"),

  async run(args, context): Promise<ToolOutcome> {
    const startedAt = Date.now();
    const scope = scopeFor(context);

    if (!scope) {
      return noAgent("no agent for the store");
    }

    const prefix =
      typeof args.prefix === "string" && args.prefix.trim() !== ""
        ? args.prefix.trim().slice(0, config.maxKeyChars)
        : undefined;

    const { listRecords } = await store();

    const records = await listRecords(scope, {
      ...(prefix ? { prefix } : {}),
    });

    if (records.length === 0) {
      return {
        ok: true,
        output: prefix
          ? `Nothing is saved under names starting with "${prefix}".`
          : "Nothing is saved yet.",
        summary: "no records",
        ms: Date.now() - startedAt,
      };
    }

    /*
     * Names and sizes, never values.
     *
     * A listing that carried contents would let one step pull
     * the entire store into the prompt, which is exactly what
     * `totalResultChars` exists to prevent — and it would do it
     * with the agent's own accumulated text, which is the
     * material most likely to be long.
     */
    const lines = records.map(
      (record) =>
        `${record.key} — ${record.chars} characters${
          record.label ? ` — ${record.label}` : ""
        }`
    );

    return {
      ok: true,
      output: [
        `${records.length} record${records.length === 1 ? "" : "s"}:`,
        ...lines,
      ].join("\n"),
      summary: `${records.length} record${records.length === 1 ? "" : "s"} listed`,
      ms: Date.now() - startedAt,
    };
  },
};

/* =========================================================
   data_delete
========================================================= */

const dataDelete: ToolSpec = {
  id: "data_delete",
  capability: "dataStore",

  description: () =>
    [
      "data_delete — remove a record you no longer need.",
      `  args: { "key": "<name>" }`,
      "  The person can still restore it from the Builder for a week afterwards, so this is safe to use when something is genuinely finished with.",
    ].join("\n"),

  async run(args, context): Promise<ToolOutcome> {
    const startedAt = Date.now();
    const scope = scopeFor(context);

    if (!scope) {
      return noAgent("no agent for the store");
    }

    const key = args.key;

    if (!isValidKey(key)) {
      return {
        ok: false,
        output: "",
        error: explainKey(key),
        summary: "bad record name",
        ms: 0,
      };
    }

    const { retireRecord } = await store();
    const removed = await retireRecord(scope, key);

    /* A miss is a true answer rather than a failure, for the
       same reason data_get's is. */
    return {
      ok: true,
      output: removed
        ? `Removed "${key}".`
        : `Nothing was saved under "${key}", so nothing was removed.`,
      summary: removed ? `removed ${key}` : `nothing at ${key}`,
      ms: Date.now() - startedAt,
    };
  },
};

export const dataTools: ToolSpec[] = [dataGet, dataSet, dataList, dataDelete];
