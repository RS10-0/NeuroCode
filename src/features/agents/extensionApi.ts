import { authHeaders } from "../../lib/api";
import { supabase } from "../../lib/supabase";

/*
 * The browser extension, as the web app sees it.
 *
 * Two entirely separate things live behind this file, and it is
 * worth being clear which is which because they authenticate
 * differently.
 *
 * THE PER-AGENT SWITCHES are rows in `agent_extension_settings`,
 * written straight from the browser through RLS — the same way
 * the Builder writes an agent, because they are the learner's
 * own data and RLS is the right guard for it.
 *
 * THE PAIRED BROWSERS go through Express, because minting a
 * token needs the service role and revoking one should be
 * possible from a DIFFERENT browser than the one being revoked
 * — including one whose token has been stolen, which is the
 * case that matters.
 *
 * WHY THE SETTINGS ARE A SEPARATE TABLE rather than two columns
 * on `agents`: migration 0015's policy is
 * `with check (auth.uid() = user_id and is_official = false)`,
 * so a purchased Library agent cannot be written by its owner
 * at all. A column would have made the extension impossible to
 * enable for a flagship somebody paid 100 XP for, and the
 * toggle would have failed silently.
 */

const BASE = "/api/extension";

/* =========================================================
   PER-AGENT SETTINGS
========================================================= */

export interface ExtensionSettings {
  extensionEnabled: boolean;
  extensionPageContext: boolean;
}

export const EXTENSION_SETTINGS_OFF: ExtensionSettings = {
  extensionEnabled: false,
  extensionPageContext: false,
};

async function currentUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in.");
  }

  return session.user.id;
}

/*
 * Returns the OFF state when there is no row.
 *
 * A missing row means not enabled, which is the whole
 * default-off design: absence rather than a stored value. So
 * "no row" is a normal state and never an error.
 */
export async function fetchExtensionSettings(
  agentId: string
): Promise<ExtensionSettings> {
  const { data, error } = await supabase
    .from("agent_extension_settings")
    .select("extension_enabled, extension_page_context")
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load extension settings: ${error.message}`);
  }

  if (!data) {
    return EXTENSION_SETTINGS_OFF;
  }

  const enabled = data.extension_enabled === true;

  return {
    extensionEnabled: enabled,
    /* Page context without the agent enabled is not a state the
       database will hold — 0020 carries a CHECK — so it is not
       one this reader will report either. */
    extensionPageContext: enabled && data.extension_page_context === true,
  };
}

/*
 * An upsert rather than an insert-or-update, because "there is
 * no row yet" and "the row says false" are the same fact to
 * every reader and should be the same write to every caller.
 *
 * Turning the agent off turns page context off with it, here as
 * well as in the CHECK constraint. Two places for one rule,
 * and the database is the one that cannot be talked out of it —
 * this one exists so the UI never sends a write it knows will
 * be refused.
 */
export async function saveExtensionSettings(
  agentId: string,
  settings: ExtensionSettings
): Promise<ExtensionSettings> {
  const enabled = settings.extensionEnabled;

  const next: ExtensionSettings = {
    extensionEnabled: enabled,
    extensionPageContext: enabled && settings.extensionPageContext,
  };

  const { error } = await supabase.from("agent_extension_settings").upsert(
    {
      agent_id: agentId,
      user_id: await currentUserId(),
      extension_enabled: next.extensionEnabled,
      extension_page_context: next.extensionPageContext,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agent_id" }
  );

  if (error) {
    throw new Error(`Unable to save extension settings: ${error.message}`);
  }

  return next;
}

/* =========================================================
   THE ACCOUNT'S SCOPE

   Whether this account may have pages read from it at all.
   Read-only from the browser — there is no write path, by
   design, because a scope the learner can set is not a check.
========================================================= */

export type PageContextScope = "allowed" | "denied" | "unknown";

export async function fetchPageContextScope(): Promise<PageContextScope> {
  const { data, error } = await supabase
    .from("user_account_scope")
    .select("page_context_scope")
    .maybeSingle();

  /*
   * An error or a missing row both read as `unknown`, which
   * denies. Failing closed is the only correct direction here,
   * and it is also the honest one: no row means nobody has
   * established this account's age or consent scope.
   */
  if (error || !data) {
    return "unknown";
  }

  const value = data.page_context_scope;

  return value === "allowed" || value === "denied" ? value : "unknown";
}

/* =========================================================
   PAIRED BROWSERS
========================================================= */

export interface ExtensionSession {
  id: string;
  last4: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export async function listExtensionSessions(): Promise<ExtensionSession[]> {
  const response = await fetch(`${BASE}/sessions`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Unable to load your connected browsers.");
  }

  const body = (await response.json()) as { sessions?: ExtensionSession[] };

  return body.sessions ?? [];
}

export async function revokeExtensionSession(id: string): Promise<void> {
  const response = await fetch(`${BASE}/sessions/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Unable to disconnect that browser.");
  }
}

/*
 * What a successful pairing hands back.
 *
 * THE ID IS HERE SO THE PAGE CAN UNDO ITSELF. A token minted
 * for a handoff that then fails is a row nobody holds the
 * plaintext for — unusable, but still listed as a connected
 * browser, with a Disconnect button for a browser that was
 * never connected. The caller revokes it rather than leaving
 * the learner to reconcile a list against a message telling
 * them nothing happened.
 *
 * The server has always returned the summary alongside the
 * token; this reader simply stopped throwing half of it away.
 */
export interface PairedExtension {
  /* Shown to this page exactly once, handed straight to the
     extension, and never obtainable again. */
  token: string;
  /* The `extension_sessions` row, so it can be revoked. */
  sessionId: string;
}

/*
 * Pairs this browser and returns the token exactly once.
 *
 * The caller hands it straight to the extension and does not
 * store it. Nothing on this platform can produce it a second
 * time, because nothing stores it — only its SHA-256.
 */
export async function pairExtension(
  label: string
): Promise<PairedExtension> {
  const response = await fetch(`${BASE}/session`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ label }),
  });

  if (!response.ok) {
    throw new Error("Unable to connect this browser.");
  }

  const body = (await response.json()) as {
    token?: string;
    session?: { id?: string };
  };

  if (!body.token || !body.session?.id) {
    throw new Error("The server did not return a token.");
  }

  return { token: body.token, sessionId: body.session.id };
}
