import { supabase } from "../../../lib/supabase";
import { AiRuntimeError } from "../../../ai/errors";
import { actions } from "../../../ai/config";
import { canSeal, open, seal, SecretUnavailableError } from "../../../ai/crypto";
import { checkUrl } from "./addresses";

/*
 * The credentials an agent is allowed to present.
 *
 * A connection is three things: a name the model can say, a
 * host it is allowed to reach, and a secret it never sees. That
 * separation is the entire point. The model writes
 * {"connection":"weather"} — it does not write a token, it
 * cannot read one back, and there is no prompt anywhere in this
 * system that contains one. The server attaches the secret on
 * the way out, after the address has been checked.
 *
 * Which means a prompt injection that fully controls what the
 * agent says still cannot exfiltrate a key: the most it can do
 * is spend one, against the host its owner tied it to.
 *
 * Sealed rather than hashed, unlike deployment keys — see
 * ai/crypto.ts on why those are two different problems. A
 * token has to be presented to somebody else's server, so it
 * has to be recoverable.
 *
 * Explicit `.eq("user_id", ...)` on every query, for the reason
 * AgentStore states: this module uses the service-role client,
 * which bypasses RLS, so that predicate is the only thing
 * between one learner and another learner's credentials.
 */

export type ConnectionAuth = "none" | "bearer" | "header" | "query";

export interface ConnectionRecord {
  id: string;
  agentId: string;
  userId: string;
  /* What the model says to select it. Lowercase, no spaces —
     see `normalizeSlug`. */
  slug: string;
  label: string;
  /* What the agent is told this connection is for. Prompt
     surface: the model reads it to decide whether to use it. */
  description: string | null;
  /* Scheme + host (+ port). Every request through this
     connection must be under it. */
  baseUrl: string;
  authKind: ConnectionAuth;
  /* Header name for `header`, query parameter name for
     `query`. Unused for the other two. */
  authName: string | null;
  allowedMethods: string[];
  createdAt: string;
}

/* The record plus the thing that never leaves this module's
   callers. Only the runtime asks for this. */
export interface ResolvedConnection extends ConnectionRecord {
  secret: string | null;
}

const COLUMNS =
  "id, agent_id, user_id, slug, label, description, base_url, auth_kind, auth_name, allowed_methods, created_at";

interface ConnectionRow {
  id: string;
  agent_id: string;
  user_id: string;
  slug: string;
  label: string;
  description: string | null;
  base_url: string;
  auth_kind: string;
  auth_name: string | null;
  allowed_methods: string[] | null;
  created_at: string;
}

const AUTH_KINDS: ConnectionAuth[] = ["none", "bearer", "header", "query"];

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function toConnection(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    slug: row.slug,
    label: row.label,
    description: row.description,
    baseUrl: row.base_url,
    authKind: AUTH_KINDS.includes(row.auth_kind as ConnectionAuth)
      ? (row.auth_kind as ConnectionAuth)
      : "none",
    authName: row.auth_name,
    allowedMethods:
      Array.isArray(row.allowed_methods) && row.allowed_methods.length > 0
        ? row.allowed_methods
        : ["GET"],
    createdAt: row.created_at,
  };
}

/*
 * The name the model uses.
 *
 * Constrained hard because it is compared against model output.
 * A slug that can contain spaces or punctuation is a slug the
 * model will spell four different ways.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export interface ConnectionInput {
  slug: string;
  label: string;
  description?: string | null;
  baseUrl: string;
  authKind: ConnectionAuth;
  authName?: string | null;
  allowedMethods: string[];
  /* Absent on an update that is not changing the secret. */
  secret?: string | null;
}

/*
 * Validation, shared by create and update.
 *
 * The base URL goes through the same `checkUrl` an outbound
 * request does, so a connection pointed at 127.0.0.1 is refused
 * when it is SAVED rather than every time it is used. Same
 * rule, applied earlier, where the person who can fix it is
 * looking at it.
 */
function validate(input: ConnectionInput): ConnectionInput {
  const slug = normalizeSlug(input.slug || input.label || "");

  if (slug.length < 2) {
    throw new AiRuntimeError(
      "invalid_request",
      "Give this connection a name of at least two letters or numbers."
    );
  }

  const label = input.label.trim().slice(0, 60);

  if (label.length === 0) {
    throw new AiRuntimeError("invalid_request", "A connection needs a label.");
  }

  let baseUrl: string;

  try {
    const checked = checkUrl(input.baseUrl.trim());

    /* Stored as origin plus path prefix, without query or
       fragment. A base URL carrying a query string produces
       requests whose parameters silently disappear. */
    baseUrl = `${checked.url.origin}${checked.url.pathname.replace(/\/+$/, "")}`;
  } catch (error) {
    throw new AiRuntimeError(
      "invalid_request",
      error instanceof Error
        ? error.message
        : "That address cannot be used for a connection."
    );
  }

  const authKind = AUTH_KINDS.includes(input.authKind) ? input.authKind : "none";

  if ((authKind === "header" || authKind === "query") && !input.authName?.trim()) {
    throw new AiRuntimeError(
      "invalid_request",
      authKind === "header"
        ? "Name the header the key should be sent in."
        : "Name the query parameter the key should be sent in."
    );
  }

  const allowedMethods = input.allowedMethods
    .map((method) => method.toUpperCase())
    .filter((method) => (METHODS as readonly string[]).includes(method));

  if (allowedMethods.length === 0) {
    throw new AiRuntimeError(
      "invalid_request",
      "Allow this connection at least one method."
    );
  }

  if (authKind !== "none" && input.secret !== undefined && !input.secret) {
    throw new AiRuntimeError(
      "invalid_request",
      "This connection needs a key, or set its authentication to none."
    );
  }

  return {
    ...input,
    slug,
    label,
    description: input.description?.trim().slice(0, 240) || null,
    baseUrl,
    authKind,
    authName: input.authName?.trim().slice(0, 60) || null,
    allowedMethods,
  };
}

export async function listConnections(
  userId: string,
  agentId: string
): Promise<ConnectionRecord[]> {
  const { data, error } = await supabase
    .from("agent_connections")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[actions] listing connections failed: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not load this agent's connections."
    );
  }

  return (data ?? []).map((row) => toConnection(row as ConnectionRow));
}

/*
 * The runtime's read: the connection plus its secret, opened.
 *
 * Returns null rather than throwing for an unknown slug — the
 * model naming a connection that does not exist is an ordinary
 * mistake and belongs in a tool result it can read, not in an
 * exception that ends the turn.
 */
export async function resolveConnection(
  userId: string,
  agentId: string,
  slug: string
): Promise<ResolvedConnection | null> {
  const { data, error } = await supabase
    .from("agent_connections")
    .select(`${COLUMNS}, secret`)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("slug", normalizeSlug(slug))
    .maybeSingle();

  if (error) {
    console.error(`[actions] resolving connection failed: ${error.message}`);
    return null;
  }

  if (!data) {
    return null;
  }

  const row = data as ConnectionRow & { secret: string | null };
  const record = toConnection(row);

  if (!row.secret) {
    return { ...record, secret: null };
  }

  try {
    return { ...record, secret: open(row.secret) };
  } catch (error) {
    /*
     * A stored secret that will not open. The key changed, or
     * the row was edited. Operator-facing; the agent is simply
     * told the connection is unusable.
     */
    console.error(
      `[actions] connection ${record.slug} could not be opened: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );

    return null;
  }
}

export async function createConnection(
  userId: string,
  agentId: string,
  input: ConnectionInput
): Promise<ConnectionRecord> {
  const clean = validate(input);

  if (clean.authKind !== "none" && !canSeal()) {
    throw new AiRuntimeError(
      "internal_error",
      "This server is not configured to store secrets, so a connection with a key cannot be saved."
    );
  }

  const existing = await listConnections(userId, agentId);

  if (existing.length >= actions.http.maxConnections) {
    throw new AiRuntimeError(
      "invalid_request",
      `An agent can have ${actions.http.maxConnections} connections. Remove one first.`
    );
  }

  let sealed: string | null = null;

  if (clean.authKind !== "none" && clean.secret) {
    try {
      sealed = seal(clean.secret);
    } catch (error) {
      throw new AiRuntimeError(
        "internal_error",
        error instanceof SecretUnavailableError
          ? error.message
          : "That key could not be stored."
      );
    }
  }

  const { data, error } = await supabase
    .from("agent_connections")
    .insert({
      agent_id: agentId,
      user_id: userId,
      slug: clean.slug,
      label: clean.label,
      description: clean.description,
      base_url: clean.baseUrl,
      auth_kind: clean.authKind,
      auth_name: clean.authName,
      allowed_methods: clean.allowedMethods,
      secret: sealed,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AiRuntimeError(
        "invalid_request",
        `This agent already has a connection called "${clean.slug}".`
      );
    }

    console.error(`[actions] creating connection failed: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not save that connection."
    );
  }

  return toConnection(data as ConnectionRow);
}

export async function deleteConnection(
  userId: string,
  agentId: string,
  connectionId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_connections")
    .delete()
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("id", connectionId);

  if (error) {
    console.error(`[actions] deleting connection failed: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not remove that connection."
    );
  }
}
