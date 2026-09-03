import { dataStore as config } from "../../ai/config";

/*
 * What a record may be called.
 *
 * A leaf module: it imports config and nothing else, and it
 * must stay that way. That is the entire reason it is a
 * separate file rather than living in DataStore.ts where the
 * validator was first written.
 *
 * catalog.ts states the constraint in its own header:
 * ConnectionStore is imported lazily because it reaches the
 * Supabase client, which refuses to load without SUPABASE_URL,
 * and everything else in the catalogue needs no database at
 * all. A static import would mean the sandbox, the tool
 * descriptions and the whole verification suite could not be
 * loaded on a machine without those variables — for the sake of
 * one branch that genuinely does need them.
 *
 * The key validator is on the hot path of every store tool and
 * is pure arithmetic on a string, so it belongs on the side of
 * that line that loads anywhere. DataStore imports it too, so
 * there is one regex rather than two that agree until somebody
 * edits one.
 *
 * WHY THE SHAPE IS THIS NARROW is the interesting part, and it
 * is a security argument rather than a tidiness one.
 *
 * A key is the one thing in this feature that crosses to the
 * TRUSTED side of the prompt. The action block lists the
 * store's keys so an agent does not have to spend one of its
 * four steps on data_list before every data_get — the same
 * thing renderConnections already does for connection names, in
 * the same place, for the same reason. But a connection name
 * was typed by the owner into a form, and a key is written by
 * the model.
 *
 * Banning spaces is what makes that tolerable. A key is always
 * ONE UNBROKEN TOKEN, so the worst a hostile one can look like
 * is `ignore_all_previous_instructions` — an identifier rather
 * than a sentence — and it arrives quoted, in a labelled list,
 * with the anti-confabulation rule still last in the block
 * after it.
 *
 * That is mitigation and not proof, which is why
 * NEUROLINK_DATA_INDEX_KEYS=0 exists. The same CHECK constraint
 * is also in migration 0018, which is the layer that holds if
 * this one is ever weakened.
 */

const KEY_SHAPE = /^[a-z0-9][a-z0-9_.:/-]{0,79}$/;

export function isValidKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= config.maxKeyChars &&
    KEY_SHAPE.test(value)
  );
}

/*
 * Why a key was refused, in words the model can act on.
 *
 * A bare "that key is invalid" costs a step and teaches
 * nothing; naming the rule that was broken — and, where there
 * is an obvious one, suggesting the corrected key — usually
 * gets it right on the retry. The same standard the parser
 * errors in protocol.ts hold themselves to.
 */
export function explainKey(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    return 'Missing `key`. Give the record a name, like "habits/2026-09-01".';
  }

  if (value.length > config.maxKeyChars) {
    return `That name is ${value.length} characters and the limit is ${config.maxKeyChars}.`;
  }

  const suggestion = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.:/-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, config.maxKeyChars);

  if (/\s/.test(value)) {
    return `Names cannot contain spaces.${
      suggestion ? ` Use "${suggestion}".` : ""
    }`;
  }

  if (/[A-Z]/.test(value)) {
    return `Names are lowercase.${suggestion ? ` Use "${suggestion}".` : ""}`;
  }

  return `Names use lowercase letters, digits, and _ . : / - only, and must start with a letter or digit.${
    suggestion ? ` Use "${suggestion}".` : ""
  }`;
}
