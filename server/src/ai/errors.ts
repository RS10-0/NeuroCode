/*
 * One error type for the whole AI runtime.
 *
 * Two things go wrong when a server hands back "Something went
 * wrong." The user cannot tell a full quota from a broken key,
 * so they retry forever. And the UI cannot either, so it shows
 * the same red box for a problem the learner can fix and one
 * they cannot.
 *
 * So every failure carries a code the client can branch on, a
 * message safe to print, and the HTTP status that goes with it.
 * The provider's own message is kept out of both: it can contain
 * request ids, account identifiers, and occasionally an echo of
 * the key itself.
 */

export type AiErrorCode =
  /* The caller is not signed in, or the token did not verify. */
  | "unauthenticated"
  /* The request body is malformed or out of range. */
  | "invalid_request"
  /* The model id is unknown, or not allowed for this user. */
  | "model_not_allowed"
  /* Too many requests this minute. Retryable soon. */
  | "rate_limited"
  /* Daily request budget spent. Retryable much later. */
  | "quota_exceeded"
  /* Daily TOKEN budget spent. The limit that tracks money. */
  | "token_quota_exceeded"
  /* BuildGentic's own budget is spent, not this learner's. */
  | "platform_budget_exceeded"
  /*
   * The learner has no XP left to spend on this action.
   *
   * Distinct from quota_exceeded, which is a rate limit and
   * refills on a rolling window whatever the learner does. This
   * one is a balance: it refills daily, but it can also be
   * EARNED back by finishing a lesson — so the message has
   * something to offer besides "come back tomorrow", and the
   * client needs to be able to tell the two apart to say so.
   */
  | "out_of_xp"
  /* Too many requests in flight at once for this user. */
  | "too_many_concurrent"
  /*
   * The three below belong to one deployed agent rather than to
   * the learner who owns it. Separate codes because they mean
   * something different: the owner's account is fine, and one
   * endpoint is simply being called harder than it may be.
   */
  | "deployment_rate_limited"
  | "deployment_quota_exceeded"
  | "deployment_too_many_concurrent"
  /* The deployment key was missing, malformed, or revoked. */
  | "deployment_unauthenticated"
  /* No deployment answers at that address. */
  | "deployment_not_found"
  /*
   * The browser extension's token was missing, malformed,
   * unknown, revoked or expired.
   *
   * Its own code rather than reusing `unauthenticated`, and the
   * distinction is the same one `deployment_unauthenticated`
   * earns: the two mean different things to the person reading
   * them and call for different reactions. `unauthenticated`
   * means "sign in". This means "this browser has come
   * unpaired" — the account is perfectly fine, and the fix is a
   * reconnect on a settings screen rather than a login.
   *
   * A shared code would also make the extension's client unable
   * to tell "your session lapsed" from "your pairing lapsed",
   * which are the two states it has to handle differently.
   */
  | "extension_unauthenticated"
  /*
   * No published page answers at that address, or the owner
   * asked about one that is not theirs.
   *
   * Its own code rather than a reuse of deployment_not_found
   * because the two are reached by different callers and mean
   * different things: that one answers an API integration
   * holding a key, this one answers a browser that followed a
   * link. Both are 404, and both are deliberately silent about
   * which of "never existed", "taken down" and "paused" is
   * true — from outside, those are one fact.
   */
  | "site_not_found"
  /* No usable credentials — key missing or power source off. */
  | "provider_not_configured"
  /* The provider is down, unreachable, or rate-limiting us. */
  | "provider_unavailable"
  /* The provider understood and refused. */
  | "provider_rejected"
  /* The provider answered, but not in a shape we can read. */
  | "provider_malformed_response"
  /* The provider produced nothing at all. */
  | "empty_response"
  /* We gave up waiting. */
  | "timeout"
  /* The client hung up, or the caller aborted. */
  | "cancelled"
  /* Anything else. Never carries detail to the client. */
  | "internal_error";

const STATUS: Record<AiErrorCode, number> = {
  unauthenticated: 401,
  invalid_request: 400,
  model_not_allowed: 400,
  rate_limited: 429,
  quota_exceeded: 429,
  token_quota_exceeded: 429,
  /*
   * 503, not 429. A 429 tells the caller to slow down, and this
   * learner slowing down changes nothing — BuildGentic's own budget
   * is what ran out.
   */
  platform_budget_exceeded: 503,
  /* 429, like the other allowance refusals. Not 402: no money
     is involved, and a payment status on a learning tool would
     invite exactly the wrong reading. */
  out_of_xp: 429,
  too_many_concurrent: 429,
  deployment_rate_limited: 429,
  deployment_quota_exceeded: 429,
  deployment_too_many_concurrent: 429,
  /*
   * 401 rather than 403. A deployment key is the whole identity
   * of the caller, so a bad one means "you are nobody here", not
   * "you are somebody without permission".
   */
  deployment_unauthenticated: 401,
  /*
   * 401 rather than 403, for the reason above it: an extension
   * token is the whole identity of the caller, so a bad one
   * means "you are nobody here", not "you are somebody without
   * permission".
   */
  extension_unauthenticated: 401,
  deployment_not_found: 404,
  site_not_found: 404,
  provider_not_configured: 503,
  provider_unavailable: 502,
  provider_rejected: 422,
  provider_malformed_response: 502,
  empty_response: 502,
  timeout: 504,
  cancelled: 499,
  internal_error: 500,
};

export class AiRuntimeError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  /* Seconds, on the three 429s. Drives Retry-After. */
  readonly retryAfterSeconds?: number;

  /*
   * Kept for the server log only. It is never serialised into a
   * response, which is the point: a provider body can name an
   * organisation, a request id, or a truncated key.
   */
  readonly internalDetail?: string;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { retryAfterSeconds?: number; internalDetail?: string } = {}
  ) {
    super(message);
    this.name = "AiRuntimeError";
    this.code = code;
    this.status = STATUS[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.internalDetail = options.internalDetail;
  }
}

/*
 * The wire shape for a failure.
 *
 * `error` stays a plain string because that is what the rest of
 * the BuildGentic API returns and what src/lib/api.ts already
 * reads. `code` is added alongside it, so existing callers keep
 * working and new ones can branch.
 */
export interface AiErrorBody {
  error: string;
  code: AiErrorCode;
  retryAfterSeconds?: number;
}

export function toErrorBody(error: unknown): AiErrorBody {
  if (error instanceof AiRuntimeError) {
    return {
      error: error.message,
      code: error.code,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }

  /*
   * An unexpected throw. The message could be anything — a
   * stack, a connection string — so none of it is passed on.
   */
  return {
    error: "The AI runtime hit an unexpected problem. Please try again.",
    code: "internal_error",
  };
}

export function statusFor(error: unknown): number {
  return error instanceof AiRuntimeError ? error.status : 500;
}

/*
 * Turns anything thrown inside the runtime into an AiRuntimeError.
 *
 * Abort is separated out because it is not a fault: it is a
 * learner pressing stop, or a browser tab closing, and recording
 * it as a provider failure would make the usage table lie.
 */
export function normalizeError(error: unknown): AiRuntimeError {
  if (error instanceof AiRuntimeError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new AiRuntimeError("cancelled", "The request was cancelled.");
  }

  return new AiRuntimeError(
    "internal_error",
    "The AI runtime hit an unexpected problem. Please try again.",
    { internalDetail: error instanceof Error ? error.message : String(error) }
  );
}

/*
 * What gets written to ai_usage.error_code.
 *
 * Same vocabulary as the client sees, so a support question
 * ("it said quota_exceeded") can be answered from the table
 * without a translation step.
 */
export function usageErrorCode(error: unknown): AiErrorCode {
  return normalizeError(error).code;
}
