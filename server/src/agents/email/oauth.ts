import { createHash, randomBytes } from "node:crypto";

import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";
import { canSeal, open, seal } from "../../ai/crypto";
import { emailEnabled } from "../../ai/config";
import { emailProvider } from "./registry";
import { saveAccount, type EmailAccount } from "./AccountStore";
import type { EmailGrant, EmailProviderId } from "./types";

/*
 * The half of OAuth that is not a provider's business.
 *
 * The state, the PKCE pair, the single-use guarantee and the
 * return path all belong here; where to send the browser and
 * what to POST belong to the adapter. That split is what makes
 * Outlook a file rather than a second copy of this one.
 *
 * WHY THERE IS A TABLE FOR A NINETY-SECOND FACT.
 *
 * The obvious implementation of `state` is a signed value the
 * server can verify without storing anything — a JWT, or an
 * HMAC over the user id. It is wrong here for one reason:
 * SINGLE USE. An authorisation code replayed against a state
 * that still verifies is the classic session-fixation shape of
 * this flow, and a stateless token cannot refuse a second
 * presentation without state to remember the first. So the
 * state is a random string that is a primary key, and
 * `consumed_at` is set by a compare-and-set that only one
 * caller can win.
 *
 * WHY PKCE, ON A CONFIDENTIAL CLIENT THAT DOES NOT NEED IT.
 *
 * A server-side web app holds a client secret, so RFC 7636 is
 * not required of it. It is cheap, it is what Google recommends
 * for every client now, and it closes the window where an
 * authorisation code intercepted in transit — a proxy, a
 * mis-set redirect, a browser extension — is worth anything on
 * its own. The verifier never leaves this server, and it is
 * sealed at rest so that a database backup does not contain
 * one.
 */

/* 10 minutes, matching the column default. Restated here so a
   caller reading this file knows without opening the SQL. */
const STATE_TTL_MS = 10 * 60 * 1000;

/*
 * Where the browser may be sent afterwards.
 *
 * An in-app path only, checked against a shape rather than an
 * allowlist of exact routes — the agent id is in it and cannot
 * be enumerated here. What the shape refuses is the whole
 * attack: no scheme, no host, no protocol-relative "//evil",
 * no backslash, nothing that could resolve anywhere but this
 * application. The column carries the same CHECK, so a row
 * written by hand cannot get past it either.
 */
const RETURN_PATH = /^\/[A-Za-z0-9/_-]*$/;

function safeReturnPath(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";

  return RETURN_PATH.test(value) && value.length <= 200 ? value : "/agents";
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export interface BeginInput {
  userId: string;
  provider: EmailProviderId;
  /* Which permissions to ask Google for. `read` is always
     included by the caller; the rest follow what the agent can
     actually do, so a person is never asked to grant send for
     an agent that cannot send. */
  grants: EmailGrant[];
  returnPath?: string;
}

export async function beginAuthorization(
  input: BeginInput
): Promise<{ url: string }> {
  if (!emailEnabled()) {
    throw new AiRuntimeError(
      "invalid_request",
      "This server is not set up to connect email accounts yet."
    );
  }

  if (!canSeal()) {
    /* The same refusal ConnectionStore gives, for the same
       reason: storing a credential this server cannot read back
       is worse than refusing to store one. */
    throw new AiRuntimeError(
      "internal_error",
      "This server is not configured to store secrets, so an email account cannot be connected."
    );
  }

  const provider = emailProvider(input.provider);

  if (!provider) {
    throw new AiRuntimeError(
      "invalid_request",
      "That email provider is not available."
    );
  }

  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const { error } = await supabase.from("user_email_oauth_states").insert({
    state,
    user_id: input.userId,
    provider: input.provider,
    code_verifier: seal(verifier),
    return_path: safeReturnPath(input.returnPath),
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  if (error) {
    console.error(`[email] could not start authorisation: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "Could not start connecting that account."
    );
  }

  return {
    url: provider.authorizeUrl({
      state,
      codeChallenge: challenge,
      grants: input.grants,
    }),
  };
}

export interface CompletedAuthorization {
  userId: string;
  returnPath: string;
  account: EmailAccount;
}

/*
 * The callback half.
 *
 * Throws for everything a person could see and nothing they
 * could act on differently — a state that never existed, one
 * that has been used, and one that has expired all produce the
 * same sentence, because distinguishing them tells whoever is
 * probing which of the three they achieved.
 */
export async function completeAuthorization(input: {
  state: unknown;
  code: unknown;
}): Promise<CompletedAuthorization> {
  const state = typeof input.state === "string" ? input.state : "";
  const code = typeof input.code === "string" ? input.code : "";

  if (!state || !code) {
    throw new AiRuntimeError(
      "invalid_request",
      "That sign-in could not be completed. Start again from the Email screen."
    );
  }

  /*
   * COMPARE-AND-SET, and it is the single-use guarantee.
   *
   * The update matches only a row that is still unconsumed and
   * still fresh, and returns what it changed. Two callbacks
   * racing on the same state — a double-click, a retried
   * request, a replayed code — mean one update matches and the
   * other matches nothing, whatever order they arrive in.
   * Reading the row and then writing it would leave a window
   * between the two where both callers saw `null`.
   */
  const { data, error } = await supabase
    .from("user_email_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("state, user_id, provider, code_verifier, return_path")
    .maybeSingle();

  if (error) {
    console.error(`[email] could not consume oauth state: ${error.message}`);

    throw new AiRuntimeError(
      "internal_error",
      "That sign-in could not be completed."
    );
  }

  if (!data) {
    throw new AiRuntimeError(
      "invalid_request",
      "That sign-in link has already been used or has expired. Start again from the Email screen."
    );
  }

  const row = data as {
    user_id: string;
    provider: string;
    code_verifier: string;
    return_path: string;
  };

  const provider = emailProvider(row.provider);

  if (!provider) {
    throw new AiRuntimeError(
      "invalid_request",
      "That email provider is no longer available."
    );
  }

  const verifier = open(row.code_verifier);
  const tokens = await provider.exchangeCode({ code, codeVerifier: verifier });

  if (!tokens.refreshToken) {
    /*
     * No refresh token means an access token that dies in an
     * hour and a mailbox that stops working over lunch.
     *
     * It happens when a person has authorised this client
     * before and Google decides not to reissue one. The adapter
     * asks for `prompt=consent` precisely to prevent that, so
     * reaching this branch means something changed on Google's
     * side — and the honest response is to refuse the
     * connection rather than store a credential known to be
     * about to break.
     */
    throw new AiRuntimeError(
      "invalid_request",
      "Google did not give BuildGentic permission to keep this connection alive. Remove BuildGentic from your Google account's third-party access and try connecting again."
    );
  }

  const address = await provider.identify(tokens.accessToken);

  const account = await saveAccount({
    userId: row.user_id,
    provider: row.provider as EmailProviderId,
    emailAddress: address,
    tokens,
  });

  return {
    userId: row.user_id,
    returnPath: safeReturnPath(row.return_path),
    account,
  };
}
