import { randomBytes } from "node:crypto";

import { supabase } from "../lib/supabase";
import { hashToken, sameSecret } from "../ai/crypto";
import { AiRuntimeError } from "../ai/errors";
import { getAgentById, type AgentRecord } from "./AgentStore";
import { mintDeploymentToken, tokenFromHeader } from "./tokens";

/*
 * Deployments and the keys that reach them.
 *
 * Two rules hold everywhere below, and between them they are the
 * whole security story of this file.
 *
 * A key goes in, and only derived facts come back out. The
 * plaintext token exists for exactly as long as the response
 * that carries it; nothing here can produce it a second time,
 * because nothing here stores it. That is the same rule
 * CredentialStore follows for provider keys, and it is enforced
 * the same way: a SAFE_COLUMNS list that has no way to name the
 * secret.
 *
 * Ownership is an explicit predicate, not a policy. The
 * service-role client bypasses RLS, so `.eq("user_id", userId)`
 * on the owner-facing queries is the only thing standing between
 * one learner and another learner's deployment. The public path
 * has no user id to offer and does not try: it resolves the
 * deployment from a verified key and inherits the owner from the
 * row.
 */

/* Everything the owner may see about a key. The hash and the
   prefix are absent, and there is no column list anywhere in
   this file that includes them outside verification. */
const KEY_COLUMNS =
  "id, deployment_id, last4, label, created_at, last_used_at, revoked_at";

const DEPLOYMENT_COLUMNS = "id, agent_id, user_id, public_id, created_at";

/*
 * The identifier in the public URL. 64 bits of hex: not a
 * secret, so it need not be long, but far past the point where
 * anybody could walk the space looking for endpoints.
 *
 * Lowercase hex rather than base64url so it survives being read
 * aloud, typed from a screenshot, and pasted through a shell
 * without quoting.
 */
function newPublicId(): string {
  return randomBytes(8).toString("hex");
}

export interface DeploymentSummary {
  id: string;
  agentId: string;
  publicId: string;
  createdAt: string;
}

export interface DeploymentKeySummary {
  id: string;
  /* All the browser ever sees of the token. */
  last4: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface DeploymentRow {
  id: string;
  agent_id: string;
  user_id: string;
  public_id: string;
  created_at: string;
}

interface KeyRow {
  id: string;
  deployment_id: string;
  last4: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toDeployment(row: DeploymentRow): DeploymentSummary {
  return {
    id: row.id,
    agentId: row.agent_id,
    publicId: row.public_id,
    createdAt: row.created_at,
  };
}

function toKey(row: KeyRow): DeploymentKeySummary {
  return {
    id: row.id,
    last4: row.last4,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function fail(message: string, detail: string): never {
  throw new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

/* =========================================================
   OWNER-FACING READS
========================================================= */

/*
 * Null for both "not deployed" and "not this learner's agent".
 * The route has already resolved the agent through AgentStore
 * and answered 404 in the second case, so by the time this runs
 * null means the first.
 */
export async function getDeployment(
  userId: string,
  agentId: string
): Promise<DeploymentSummary | null> {
  const { data, error } = await supabase
    .from("agent_deployments")
    .select(DEPLOYMENT_COLUMNS)
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    fail("Unable to load this agent's deployment.", `select failed: ${error.message}`);
  }

  return data ? toDeployment(data as DeploymentRow) : null;
}

/*
 * The key currently able to answer, if any.
 *
 * A deployment with no active key is a real and useful state: the
 * URL still exists, every call is refused, and issuing a new key
 * turns it back on. That is what "pause" is here, which is why
 * there is no separate paused flag to keep in step with it.
 */
export async function getActiveKey(
  userId: string,
  deploymentId: string
): Promise<DeploymentKeySummary | null> {
  const { data, error } = await supabase
    .from("agent_deployment_keys")
    .select(KEY_COLUMNS)
    .eq("deployment_id", deploymentId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    fail("Unable to load this deployment's key.", `select failed: ${error.message}`);
  }

  return data ? toKey(data as KeyRow) : null;
}

/* =========================================================
   OWNER-FACING WRITES
========================================================= */

/*
 * Deploys an agent, and refuses a draft.
 *
 * The status gate lives here rather than only in the route
 * because it is an invariant about the row, not a policy about a
 * request: there must never be a deployment of an agent its
 * owner has not marked ready. A learner can set that column
 * themselves — agents is theirs under RLS — and that is fine.
 * The point of the gate is that deploying is a deliberate act
 * with a name, not that the column is unforgeable.
 */
export async function createDeployment(
  agent: AgentRecord
): Promise<DeploymentSummary> {
  if (agent.status !== "ready") {
    throw new AiRuntimeError(
      "invalid_request",
      "This agent is still a draft. Mark it as ready before deploying it."
    );
  }

  const { data, error } = await supabase
    .from("agent_deployments")
    .insert({
      agent_id: agent.id,
      user_id: agent.userId,
      public_id: newPublicId(),
    })
    .select(DEPLOYMENT_COLUMNS)
    .single();

  if (error) {
    /*
     * unique (agent_id). Two clicks on Deploy, or two tabs. The
     * second one should see the deployment the first made rather
     * than an error about a constraint it did not know existed.
     */
    if (error.code === "23505") {
      const existing = await getDeployment(agent.userId, agent.id);

      if (existing) {
        return existing;
      }
    }

    fail("Unable to deploy this agent.", `insert failed: ${error.message}`);
  }

  return toDeployment(data as DeploymentRow);
}

export interface IssuedKey {
  key: DeploymentKeySummary;
  /* The one and only time this exists. */
  token: string;
}

/*
 * Issues a key, revoking whatever came before it.
 *
 * One active key per deployment, enforced by a partial unique
 * index rather than by this function being careful. Rotation is
 * therefore one action with one outcome — the old key stops
 * working the instant the new one starts — instead of a set of
 * keys the learner has to reason about and eventually forgets to
 * tidy.
 */
export async function issueKey(
  userId: string,
  deploymentId: string,
  label?: string
): Promise<IssuedKey> {
  await revokeActiveKey(userId, deploymentId);

  const minted = mintDeploymentToken();

  const { data, error } = await supabase
    .from("agent_deployment_keys")
    .insert({
      deployment_id: deploymentId,
      user_id: userId,
      token_prefix: minted.prefix,
      token_hash: minted.hash,
      last4: minted.last4,
      label: label ?? null,
    })
    .select(KEY_COLUMNS)
    .single();

  if (error) {
    /* The partial unique index. Two rotations at once, which is
       rare and recoverable by looking again. */
    if (error.code === "23505") {
      throw new AiRuntimeError(
        "invalid_request",
        "Another key was issued for this deployment a moment ago. Reload the page to see it."
      );
    }

    fail("Unable to issue a deployment key.", `insert failed: ${error.message}`);
  }

  return { key: toKey(data as KeyRow), token: minted.token };
}

/* True when a key was actually revoked, so the caller can tell
   "turned off" from "was already off". */
export async function revokeActiveKey(
  userId: string,
  deploymentId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_deployment_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("deployment_id", deploymentId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    fail("Unable to revoke that key.", `update failed: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

/* Keys cascade. ai_usage does not — its rows keep the
   deployment_id of something that no longer exists, which is
   what a spending history is for. */
export async function deleteDeployment(
  userId: string,
  agentId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_deployments")
    .delete()
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    fail("Unable to remove that deployment.", `delete failed: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

/* =========================================================
   USAGE
========================================================= */

export interface DeploymentUsage {
  requestsMinute: number;
  requestsDay: number;
  requestsTotal: number;
  tokensDay: number;
  inFlight: number;
  lastCalledAt: string | null;
  /*
   * The true runtime code of the most recent failure. An
   * external caller is told only that the agent is unavailable,
   * because the real code describes the owner's account; this is
   * where the owner is told what actually happened.
   */
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

export async function deploymentUsage(
  deploymentId: string
): Promise<DeploymentUsage> {
  const { data, error } = await supabase.rpc("agent_deployment_usage", {
    p_deployment_id: deploymentId,
  });

  if (error) {
    fail(
      "Unable to load this deployment's usage.",
      `agent_deployment_usage failed: ${error.message}`
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null;

  const num = (key: string) => Number(row?.[key] ?? 0);
  const text = (key: string) =>
    typeof row?.[key] === "string" ? (row[key] as string) : null;

  return {
    requestsMinute: num("requests_minute"),
    requestsDay: num("requests_day"),
    requestsTotal: num("requests_total"),
    tokensDay: num("tokens_day"),
    inFlight: num("in_flight"),
    lastCalledAt: text("last_called_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: text("last_error_at"),
  };
}

/* =========================================================
   THE PUBLIC PATH

   Everything above answers a learner holding a session. This
   answers a stranger holding a token, and it is the only place
   in BuildGentic where a request with no Supabase JWT resolves to
   a user id.
========================================================= */

export interface AuthenticatedDeployment {
  deployment: DeploymentSummary;
  agent: AgentRecord;
  keyId: string;
  /* Whose quota, whose keys, whose bill. Taken off the
     deployment row, never off the request. */
  ownerId: string;
}

/*
 * One error for every way a credential can be wrong.
 *
 * Missing, malformed, unknown, revoked, or valid but issued for
 * a different deployment all produce this. Telling them apart
 * would tell somebody probing which half of their guess was
 * right, and there is no legitimate caller who needs to know
 * more than that the key they hold does not work here.
 */
function refuseKey(detail: string): never {
  throw new AiRuntimeError(
    "deployment_unauthenticated",
    "That deployment key is not valid for this agent.",
    { internalDetail: detail }
  );
}

export async function authenticateDeployment(
  publicId: string,
  authorization: unknown
): Promise<AuthenticatedDeployment> {
  const { data: deploymentData, error: deploymentError } = await supabase
    .from("agent_deployments")
    .select(DEPLOYMENT_COLUMNS)
    .eq("public_id", publicId)
    .maybeSingle();

  if (deploymentError) {
    fail("Unable to reach that agent.", `select failed: ${deploymentError.message}`);
  }

  if (!deploymentData) {
    throw new AiRuntimeError(
      "deployment_not_found",
      "No deployed agent answers at that address."
    );
  }

  /* The raw row is kept as well as the summary, because the
     owner's id is on it and is deliberately not part of the
     shape anything else here hands out. */
  const deploymentRow = deploymentData as DeploymentRow;
  const deployment = toDeployment(deploymentRow);

  const parsed = tokenFromHeader(authorization);

  if (!parsed) {
    refuseKey("missing or malformed Authorization header");
  }

  const { data: keyData, error: keyError } = await supabase
    .from("agent_deployment_keys")
    .select("id, deployment_id, token_hash, revoked_at")
    .eq("token_prefix", parsed.prefix)
    .maybeSingle();

  if (keyError) {
    fail("Unable to check that key.", `select failed: ${keyError.message}`);
  }

  if (!keyData) {
    refuseKey(`no key with prefix ${parsed.prefix}`);
  }

  const row = keyData as {
    id: string;
    deployment_id: string;
    token_hash: string;
    revoked_at: string | null;
  };

  /*
   * Constant time, even though the stored value is a hash and
   * not the secret. A length-then-bytes comparison on a hash
   * leaks nothing useful in practice, but the cheap habit is the
   * one worth keeping — and `sameSecret` is already here.
   */
  if (!sameSecret(hashToken(parsed.token), row.token_hash)) {
    refuseKey(`hash mismatch for prefix ${parsed.prefix}`);
  }

  if (row.revoked_at) {
    refuseKey(`key ${row.id} was revoked at ${row.revoked_at}`);
  }

  /*
   * A real key, for a different deployment, presented at this
   * URL. Refused, so one deployment's credential can never be
   * replayed against another — including another learner's.
   */
  if (row.deployment_id !== deployment.id) {
    refuseKey(`key ${row.id} belongs to deployment ${row.deployment_id}`);
  }

  /*
   * Resolved by id off the deployment row, so ownership comes
   * from the database rather than from anything the caller said.
   * This is what validation.ts meant by the public endpoint
   * getting ownership for free.
   */
  const agent = await getAgentById(deployment.agentId);

  if (!agent || agent.userId !== deploymentRow.user_id) {
    throw new AiRuntimeError(
      "deployment_not_found",
      "No deployed agent answers at that address.",
      { internalDetail: `deployment ${deployment.id} has no matching agent row` }
    );
  }

  /*
   * Demoted back to a draft while deployed. The endpoint stops
   * answering, because `ready` is the owner saying this is fit
   * to be used and they have withdrawn that.
   *
   * A 404 rather than a 503: from outside, an endpoint that is
   * not currently serving and one that does not exist are the
   * same thing, and the difference is only the owner's business.
   */
  if (agent.status !== "ready") {
    throw new AiRuntimeError(
      "deployment_not_found",
      "No deployed agent answers at that address.",
      { internalDetail: `agent ${agent.id} is a draft; deployment paused` }
    );
  }

  return {
    deployment,
    agent,
    keyId: row.id,
    ownerId: deploymentRow.user_id,
  };
}

/*
 * Last-used, written after the answer rather than before it.
 *
 * Not scoped by user id, and safe for the same reason
 * CredentialStore.markUsed is: the id came from a verified
 * lookup on this request's own path, never from input.
 */
export async function markKeyUsed(keyId: string): Promise<void> {
  const { error } = await supabase
    .from("agent_deployment_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);

  if (error) {
    /* The answer has already been sent. A missing timestamp is
       not worth failing a delivered request over. */
    console.error(`[deploy] could not stamp key ${keyId}: ${error.message}`);
  }
}
