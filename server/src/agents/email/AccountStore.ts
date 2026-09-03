import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";
import { email as config } from "../../ai/config";
import { open, seal, SecretUnavailableError } from "../../ai/crypto";
import { emailProvider } from "./registry";
import {
  EmailProviderError,
  type EmailGrant,
  type EmailProviderId,
  type EmailTokenSet,
} from "./types";

/*
 * The mailboxes a person has connected, and the only module in
 * this project that can read a mail token.
 *
 * Everything here runs with the service role, which is the
 * requirement rather than a convenience: migration 0019 grants
 * the browser NOTHING on this table, not even select. So the
 * explicit `.eq("user_id", ...)` on every query below is the
 * only thing standing between one learner and another learner's
 * correspondence — the same sentence AgentStore, ConnectionStore
 * and ScheduleStore all open with, and it has never mattered
 * more than it does here.
 *
 * THE ONE FUNCTION EVERY CALLER ACTUALLY WANTS IS
 * `usableAccount`, AND IT IS THE ONLY WAY OUT OF THIS FILE
 * WITH A TOKEN.
 *
 * There is no `getAccessToken(userId)`. A token is handed out
 * only bundled with the account it belongs to, the grants it
 * actually carries, and the refresh that keeps it alive — so
 * there is no shape in which a caller can hold a bare token and
 * forget which mailbox it opens or whether it was allowed to.
 *
 * AND NOTHING HERE RETURNS A TOKEN TO A ROUTE THAT SERIALISES.
 * `EmailAccount` — the shape the browser is told about — has no
 * token field at all. It cannot be leaked by a route forgetting
 * to strip it, because there is nothing to strip.
 */

/* What a caller outside the server may know about a mailbox. */
export interface EmailAccount {
  id: string;
  provider: EmailProviderId;
  emailAddress: string;
  grants: EmailGrant[];
  connectedAt: string;
  lastUsedAt: string | null;
}

/* The same, plus the thing that never leaves this module's
   direct callers. Only the tools and the send route ask. */
export interface UsableAccount extends EmailAccount {
  accessToken: string;
}

const COLUMNS =
  "id, user_id, provider, email_address, granted_scopes, expires_at, revoked_at, connected_at, last_used_at";

interface AccountRow {
  id: string;
  user_id: string;
  provider: string;
  email_address: string;
  granted_scopes: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  connected_at: string;
  last_used_at: string | null;
}

/*
 * Which BuildGentic grants a scope string actually carries.
 *
 * Derived from what Google RETURNED rather than from what was
 * asked for, because a person may untick a permission on the
 * consent screen. An agent that believes it may organise a
 * mailbox it was refused permission to organise produces a 403
 * the learner has to interpret; this produces a sentence the
 * tool can say instead.
 *
 * The scope strings are matched by suffix so this stays a fact
 * about Gmail's naming rather than a second copy of the
 * adapter's table — and an unrecognised scope simply grants
 * nothing, which is the safe direction to fail in.
 */
function grantsFrom(scopeString: string | null): EmailGrant[] {
  const scopes = (scopeString ?? "").split(/\s+/).filter(Boolean);
  const grants = new Set<EmailGrant>();

  for (const scope of scopes) {
    if (scope.endsWith("/gmail.readonly")) grants.add("read");
    if (scope.endsWith("/gmail.compose")) grants.add("draft");
    if (scope.endsWith("/gmail.send")) grants.add("send");

    if (scope.endsWith("/gmail.modify")) {
      /*
       * `gmail.modify` is a superset: it can read, label and
       * send. It is requested for organise, and an account that
       * holds it holds the others whether or not their own
       * scopes came back.
       */
      grants.add("organize");
      grants.add("read");
      grants.add("draft");
      grants.add("send");
    }
  }

  return [...grants];
}

function toAccount(row: AccountRow): EmailAccount {
  return {
    id: row.id,
    provider: row.provider as EmailProviderId,
    emailAddress: row.email_address,
    grants: grantsFrom(row.granted_scopes),
    connectedAt: row.connected_at,
    lastUsedAt: row.last_used_at,
  };
}

/* =========================================================
   READS
========================================================= */

export async function listAccounts(userId: string): Promise<EmailAccount[]> {
  const { data, error } = await supabase
    .from("user_email_accounts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("connected_at", { ascending: true });

  if (error) {
    console.error(`[email] listing accounts failed: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not load your connected email accounts."
    );
  }

  return (data ?? []).map((row) => toAccount(row as AccountRow));
}

/* =========================================================
   WRITES
========================================================= */

export async function saveAccount(input: {
  userId: string;
  provider: EmailProviderId;
  emailAddress: string;
  tokens: EmailTokenSet;
}): Promise<EmailAccount> {
  const { tokens } = input;

  if (!tokens.refreshToken) {
    throw new AiRuntimeError(
      "invalid_request",
      "That connection cannot be saved without permission to keep it alive."
    );
  }

  let sealedRefresh: string;
  let sealedAccess: string;

  try {
    sealedRefresh = seal(tokens.refreshToken);
    sealedAccess = seal(tokens.accessToken);
  } catch (error) {
    throw new AiRuntimeError(
      "internal_error",
      error instanceof SecretUnavailableError
        ? error.message
        : "That connection could not be stored."
    );
  }

  const now = new Date();

  const { data, error } = await supabase
    .from("user_email_accounts")
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        /* Lowercased so re-authorising the same mailbox with a
           differently-cased address updates the row rather than
           creating a rival one under the unique key. */
        email_address: input.emailAddress.trim().toLowerCase(),
        granted_scopes: tokens.scope ?? "",
        refresh_token: sealedRefresh,
        access_token: sealedAccess,
        expires_at: tokens.expiresIn
          ? new Date(now.getTime() + tokens.expiresIn * 1000).toISOString()
          : null,
        /* A reconnect after a disconnect reuses the row and has
           to clear this, or the account is saved already dead. */
        revoked_at: null,
        connected_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,provider,email_address" }
    )
    .select(COLUMNS)
    .single();

  if (error) {
    console.error(`[email] saving account failed: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not save that email account."
    );
  }

  return toAccount(data as AccountRow);
}

/*
 * Disconnecting.
 *
 * Revoked at the provider first, then deleted here — and the
 * delete happens whether or not the revoke worked. A token this
 * server has thrown away is a token this server cannot use,
 * whatever Google still thinks about it, and leaving the row
 * behind because a revoke failed would mean a person who
 * pressed Disconnect still has a mailbox connected.
 */
export async function disconnectAccount(
  userId: string,
  accountId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("user_email_accounts")
    .select("id, provider, refresh_token")
    .eq("user_id", userId)
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    console.error(`[email] loading account to disconnect: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not disconnect that account."
    );
  }

  if (!data) {
    /* Already gone, or somebody else's. Both look the same, and
       both are a no-op rather than an error. */
    return;
  }

  const row = data as { provider: string; refresh_token: string };
  const provider = emailProvider(row.provider);

  if (provider) {
    try {
      await provider.revoke(open(row.refresh_token));
    } catch (error) {
      console.error(
        `[email] revoking at the provider failed, deleting locally anyway: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("user_email_accounts")
    .delete()
    .eq("user_id", userId)
    .eq("id", accountId);

  if (deleteError) {
    console.error(`[email] deleting account failed: ${deleteError.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not disconnect that account."
    );
  }
}

/* =========================================================
   THE ONE THAT HANDS OUT A TOKEN
========================================================= */

/*
 * Why an account could not be used, in the words the caller
 * shows.
 *
 * A `null` with no explanation is what every one of these used
 * to be, and it produced the failure this capability can least
 * afford: an agent told nothing decides the mailbox is empty
 * and says so. "You have not connected an account" and "the
 * connection expired" are different sentences and only one of
 * them is a thing the person can fix in ten seconds.
 */
export type AccountProblem =
  | { kind: "none_connected" }
  | { kind: "expired"; emailAddress: string }
  | { kind: "missing_grant"; emailAddress: string; grant: EmailGrant }
  | { kind: "unavailable" };

export type AccountResult =
  | { ok: true; account: UsableAccount }
  | { ok: false; problem: AccountProblem };

/*
 * The account a turn may use, with a live token.
 *
 * Refreshes with a skew rather than on failure. A token that
 * expires between the check and the call costs the agent one of
 * its four steps and the learner one action from their
 * allowance, and the exchange is a single cheap request — so
 * the trade is not close.
 *
 * `requires` is checked against what Google actually granted,
 * not against what the agent's capabilities say. Those are two
 * different questions: the capability is what its owner allowed,
 * the grant is what the mailbox's owner allowed, and BOTH have
 * to be true. The capability is checked at the tool, before this
 * is reached.
 */
export async function usableAccount(input: {
  userId: string;
  requires: EmailGrant;
}): Promise<AccountResult> {
  const { data, error } = await supabase
    .from("user_email_accounts")
    .select(`${COLUMNS}, refresh_token, access_token`)
    .eq("user_id", input.userId)
    .is("revoked_at", null)
    .order("connected_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[email] resolving account failed: ${error.message}`);
    return { ok: false, problem: { kind: "unavailable" } };
  }

  if (!data) {
    return { ok: false, problem: { kind: "none_connected" } };
  }

  const row = data as AccountRow & {
    refresh_token: string;
    access_token: string | null;
  };

  const account = toAccount(row);

  if (!account.grants.includes(input.requires)) {
    return {
      ok: false,
      problem: {
        kind: "missing_grant",
        emailAddress: account.emailAddress,
        grant: input.requires,
      },
    };
  }

  const provider = emailProvider(row.provider);

  if (!provider) {
    return { ok: false, problem: { kind: "unavailable" } };
  }

  const skewMs = config.refreshSkewSeconds * 1000;
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
  const stillGood =
    row.access_token !== null &&
    Number.isFinite(expiresAt) &&
    expiresAt - skewMs > Date.now();

  if (stillGood) {
    try {
      return {
        ok: true,
        account: { ...account, accessToken: open(row.access_token as string) },
      };
    } catch {
      /* Sealed with a key this process no longer has. Fall
         through to a refresh, which will fail the same way and
         report it once rather than twice. */
    }
  }

  let refreshed: EmailTokenSet;

  try {
    refreshed = await provider.refresh(open(row.refresh_token));
  } catch (error) {
    if (error instanceof SecretUnavailableError) {
      console.error(
        "[email] a stored mail token could not be opened. NEUROLINK_SECRET_KEY has changed since it was written."
      );

      return {
        ok: false,
        problem: { kind: "expired", emailAddress: account.emailAddress },
      };
    }

    if (
      error instanceof EmailProviderError &&
      (error.kind === "unauthorized" || error.kind === "invalid")
    ) {
      /*
       * The grant is gone — revoked from the Google account
       * screen, or expired because the app is in Testing mode,
       * where refresh tokens last seven days.
       *
       * That last one is worth knowing about rather than
       * debugging: an unverified project's tokens expire on a
       * timer no code here controls, and the correct handling
       * is what happens next — mark the row revoked so nothing
       * keeps trying, and tell the person to reconnect.
       */
      await supabase
        .from("user_email_accounts")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", input.userId)
        .eq("id", row.id);

      return {
        ok: false,
        problem: { kind: "expired", emailAddress: account.emailAddress },
      };
    }

    console.error(
      `[email] refreshing a token failed: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );

    return { ok: false, problem: { kind: "unavailable" } };
  }

  const now = new Date();

  /*
   * The new access token is written back, and a rotated refresh
   * token with it when the provider sends one.
   *
   * Google usually does not rotate, but it may, and a refresh
   * token that has been rotated away is one this row must stop
   * carrying — otherwise the account works until the old one is
   * invalidated and then fails in a way nothing here explains.
   */
  const { error: writeError } = await supabase
    .from("user_email_accounts")
    .update({
      access_token: seal(refreshed.accessToken),
      ...(refreshed.refreshToken
        ? { refresh_token: seal(refreshed.refreshToken) }
        : {}),
      ...(refreshed.scope ? { granted_scopes: refreshed.scope } : {}),
      expires_at: refreshed.expiresIn
        ? new Date(now.getTime() + refreshed.expiresIn * 1000).toISOString()
        : null,
      last_used_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("id", row.id);

  if (writeError) {
    /* The token in hand is still good. Losing the write means
       the next turn refreshes again, which is a wasted request
       rather than a failure. */
    console.error(`[email] could not store a refreshed token: ${writeError.message}`);
  }

  return {
    ok: true,
    account: {
      ...account,
      /* Re-derived, because a scope set that came back narrower
         than the stored one has to narrow what this call
         believes it may do. */
      ...(refreshed.scope ? { grants: grantsFrom(refreshed.scope) } : {}),
      accessToken: refreshed.accessToken,
    },
  };
}

/*
 * The sentence a tool says when there is no usable account.
 *
 * Written once, here, rather than four times across the tools,
 * because they must not drift: an agent told two different
 * things about the same condition will report whichever it saw
 * last as the reason.
 */
export function explainProblem(problem: AccountProblem): string {
  switch (problem.kind) {
    case "none_connected":
      return "No email account is connected to this BuildGentic account. Tell the person to open the Email screen and connect one — you cannot do it for them, and you must not guess at what their inbox contains.";

    case "expired":
      return `The connection to ${problem.emailAddress} has expired and BuildGentic can no longer read it. Tell the person to reconnect it on the Email screen. Do not describe any messages: you have not seen any.`;

    case "missing_grant":
      return `${problem.emailAddress} is connected, but without permission to ${
        problem.grant === "read"
          ? "read messages"
          : problem.grant === "draft"
            ? "write drafts"
            : problem.grant === "send"
              ? "send mail"
              : "change labels"
      }. Tell the person to reconnect it and allow that permission.`;

    case "unavailable":
      return "The email service could not be reached just now. Say so plainly and do not describe any messages — you have not seen any.";
  }
}
