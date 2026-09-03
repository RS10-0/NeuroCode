import type { ChainEntryLimits, ProviderId } from "./types";

/*
 * What each provider has been asked for lately, and whether it
 * is currently in the doghouse.
 *
 * This is what makes the cascade PROACTIVE. Without it the only
 * way to discover that a provider is saturated is to send it a
 * request and wait for the 429 — which costs the learner the
 * round trip, and costs the provider a request from an
 * allowance that was already spent. With it, a provider whose
 * window is full is skipped before a socket is opened.
 *
 * Two mechanisms, and they answer different questions:
 *
 *   the window   — "have WE sent this provider more than it
 *                  allows in the last minute?" Counted here
 *                  because we are the only ones who know.
 *   the cooldown — "did it just tell us to go away?" Set from
 *                  an actual 429 or 5xx, honouring Retry-After
 *                  when the provider sends one.
 *
 * IN-PROCESS, ON PURPOSE. This is read on the hot path of every
 * single AI request and must cost nothing — a Postgres round
 * trip here would add latency to the exact thing the cascade
 * exists to make fast. That is correct for a single-process
 * Express server, which is what BuildGentic deploys as.
 *
 * IF THIS EVER RUNS MULTI-INSTANCE, this file is wrong: each
 * process would count only its own share and every provider
 * would look emptier than it is. The fix is to move the window
 * into Postgres alongside ai_usage and accept the round trip.
 * Nothing else would have to change — the interface below is
 * already the whole surface.
 */

const WINDOW_MS = 60_000;

/*
 * How long a provider sits out after refusing, when it did not
 * say. Short enough that a blip does not cost a learner the good
 * provider for long, long enough that we are not hammering
 * something that just asked us not to.
 */
const DEFAULT_COOLDOWN_MS = 20_000;

/* A refusal should never park a provider for longer than this,
   whatever Retry-After claimed. An hour-long header — some
   providers send one — would take a provider out of the chain
   for the rest of the lesson. */
const MAX_COOLDOWN_MS = 120_000;

interface Call {
  at: number;
  tokens: number;
}

interface Health {
  calls: Call[];
  /* Epoch ms. Zero means "not in cooldown". */
  cooldownUntil: number;
  /* Purely for the operator-facing snapshot below. */
  consecutiveFailures: number;
}

const health = new Map<ProviderId, Health>();

function healthFor(providerId: ProviderId): Health {
  let entry = health.get(providerId);

  if (!entry) {
    entry = { calls: [], cooldownUntil: 0, consecutiveFailures: 0 };
    health.set(providerId, entry);
  }

  return entry;
}

/* Drops calls that have aged out. Called on every read, so the
   arrays cannot grow without bound on a busy server. */
function prune(entry: Health, now: number): void {
  const cutoff = now - WINDOW_MS;

  if (entry.calls.length > 0 && entry.calls[0].at <= cutoff) {
    entry.calls = entry.calls.filter((call) => call.at > cutoff);
  }
}

/*
 * Whether this provider should be tried right now.
 *
 * `estimatedTokens` is what the request could cost at most, not
 * what it probably will — a token window has to be checked
 * against the ceiling, for the reason QuotaGuard gives: the
 * outcome is not knowable until the money is already spent.
 */
export function isAvailable(
  entry: ChainEntryLimits,
  estimatedTokens: number,
  now: number = Date.now()
): boolean {
  const state = healthFor(entry.providerId);

  if (state.cooldownUntil > now) {
    return false;
  }

  prune(state, now);

  if (
    entry.requestsPerMinute > 0 &&
    state.calls.length + 1 > entry.requestsPerMinute
  ) {
    return false;
  }

  if (entry.tokensPerMinute > 0) {
    const spent = state.calls.reduce((total, call) => total + call.tokens, 0);

    if (spent + Math.max(0, estimatedTokens) > entry.tokensPerMinute) {
      return false;
    }
  }

  return true;
}

/*
 * Records that we are about to send this provider a request.
 *
 * Called before the attempt rather than after it, because a
 * request in flight has already consumed the provider's rate
 * allowance whether or not it succeeds — and because two
 * concurrent requests must not both see an empty window.
 */
export function reserve(
  providerId: ProviderId,
  estimatedTokens: number,
  now: number = Date.now()
): void {
  const state = healthFor(providerId);

  prune(state, now);
  state.calls.push({ at: now, tokens: Math.max(0, estimatedTokens) });
}

/*
 * Corrects the reservation once the real token count is known.
 *
 * The estimate is generous by design — it assumes the model
 * spends its entire output budget — so leaving it uncorrected
 * would make a provider look far busier than it is and push
 * traffic down the chain for no reason.
 */
export function settle(
  providerId: ProviderId,
  actualTokens: number,
  now: number = Date.now()
): void {
  const state = healthFor(providerId);

  prune(state, now);

  const last = state.calls[state.calls.length - 1];

  if (last) {
    last.tokens = Math.max(0, actualTokens);
  }

  state.consecutiveFailures = 0;
}

/*
 * Puts a provider in the doghouse after it refused us.
 *
 * `retryAfterSeconds` is the provider's own answer when it gave
 * one; it is trusted, but clamped — see MAX_COOLDOWN_MS.
 */
export function penalise(
  providerId: ProviderId,
  retryAfterSeconds?: number,
  now: number = Date.now()
): void {
  const state = healthFor(providerId);

  const requested =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds) * 1000
      : DEFAULT_COOLDOWN_MS;

  state.cooldownUntil = now + Math.min(requested, MAX_COOLDOWN_MS);
  state.consecutiveFailures += 1;
}

/*
 * The operator-facing view. Not reachable from any client route
 * — it names providers, and a learner must never learn one.
 * Exists for the startup banner and the verify scripts.
 */
export interface HealthSnapshot {
  providerId: ProviderId;
  callsInWindow: number;
  tokensInWindow: number;
  cooldownRemainingMs: number;
  consecutiveFailures: number;
}

export function snapshotHealth(
  now: number = Date.now()
): HealthSnapshot[] {
  return [...health.entries()].map(([providerId, state]) => {
    prune(state, now);

    return {
      providerId,
      callsInWindow: state.calls.length,
      tokensInWindow: state.calls.reduce(
        (total, call) => total + call.tokens,
        0
      ),
      cooldownRemainingMs: Math.max(0, state.cooldownUntil - now),
      consecutiveFailures: state.consecutiveFailures,
    };
  });
}

/* Test seam. Nothing in the running server calls this. */
export function resetHealth(): void {
  health.clear();
}
