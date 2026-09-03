import { AiRuntimeError, normalizeError } from "./errors";
import {
  isAvailable as isProviderAvailable,
  penalise as penaliseProvider,
  reserve as reserveProvider,
} from "./ProviderHealth";
import { getProvider as registryGetProvider } from "./ProviderRegistry";
import type {
  AiProvider,
  ChainCandidate,
  FinishReason,
  ModelRequest,
  ProviderId,
  TokenUsage,
} from "./types";

/*
 * The cascade.
 *
 * Walks the candidate list from the top, every call, and hands
 * back the first provider that actually produces a token.
 *
 * It lives in its own file rather than inside runChat for two
 * reasons. It is the single piece of behaviour most worth being
 * able to test without a database, a key or a network — see
 * scripts/verify-provider-cascade.mts, which drives it with fake
 * adapters. And it is the thing anybody reading this codebase
 * will come looking for, which is a poor argument for burying it
 * six hundred lines inside the function that calls it.
 *
 * THE COMMIT BOUNDARY is the rule that makes any of this safe.
 *
 *   Before the first token — a provider may be abandoned freely.
 *                            It errored, refused, or said
 *                            nothing; nobody has seen anything,
 *                            so trying the next one is invisible.
 *
 *   After the first token  — the caller has already been handed
 *                            text. A second provider cannot
 *                            finish somebody else's sentence, so
 *                            a failure here is a real failure and
 *                            is thrown.
 *
 * Which is also why a 200 is not enough to commit on. Several of
 * these vendors report errors mid-stream, after the headers, as
 * a member on an otherwise ordinary chunk. The first delta is
 * the only honest signal that an answer is happening.
 *
 * NOT STICKY, and there is deliberately no state here that could
 * make it so. The list arrives in priority order and is always
 * read from index 0; a request that ends up on the last provider
 * tells you nothing about where the next one starts.
 */

export type ChainEvent =
  /*
   * Emitted once, the moment a provider produces its first
   * token. This is the commit — everything after it comes from
   * this provider or from nowhere.
   *
   * Carries the candidate so the caller can record who actually
   * served the request on the usage row. It is never forwarded
   * to a client; that is the whole point of the exercise.
   */
  | { type: "committed"; candidate: ChainCandidate }
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: FinishReason; usage?: TokenUsage };

export interface StreamFromChainOptions {
  /* In priority order. Walked from index 0. */
  candidates: ChainCandidate[];
  /* Model id is substituted per candidate; everything else is
     sent as-is. */
  request: ModelRequest;
  /*
   * What this request could cost at worst — estimated input plus
   * the whole output allowance. The ceiling rather than the
   * likely outcome, because a rate window has to be checked
   * against what a request might spend, not against what it
   * turns out to have spent.
   */
  tokenBudget: number;
  /*
   * How long one provider gets to produce its first token before
   * it is abandoned for the next.
   *
   * Per attempt, not per request. A provider that accepts the
   * connection and then goes quiet costs one patience budget
   * rather than the learner's answer.
   */
  firstTokenTimeoutMs: number;
  /* The request-wide signal: the caller hung up, or the overall
     timeout fired. Distinct from a per-attempt abort. */
  signal: AbortSignal;
  /* Injectable so the verify script can supply fake adapters
     without touching the real registry. */
  getProvider?: (id: ProviderId) => AiProvider;
}

export async function* streamFromChain(
  options: StreamFromChainOptions
): AsyncGenerator<ChainEvent> {
  const getProvider = options.getProvider ?? registryGetProvider;

  let committed = false;
  let lastFailure: AiRuntimeError | null = null;
  /* Every candidate was skipped without being asked, which is a
     different story from every candidate having refused. */
  let everyoneBusy = true;

  for (const candidate of options.candidates) {
    /* The caller hung up, or the request-wide timer fired.
       Neither is this provider's fault and neither is fixed by
       trying the next one. */
    if (options.signal.aborted) {
      break;
    }

    /*
     * The proactive skip, and the reason ProviderHealth exists.
     * A provider whose minute-window is already full is not
     * asked: discovering that by sending it a request costs the
     * learner a round trip and costs the provider a request from
     * an allowance that was already gone.
     */
    if (
      candidate.entry &&
      !isProviderAvailable(candidate.entry, options.tokenBudget)
    ) {
      continue;
    }

    everyoneBusy = false;

    /*
     * A per-attempt deadline, chained to the request-wide one so
     * a caller hanging up still tears this down.
     */
    const attempt = new AbortController();
    const relayAbort = () => attempt.abort();
    options.signal.addEventListener("abort", relayAbort, { once: true });

    let attemptTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => attempt.abort(),
      options.firstTokenTimeoutMs
    );

    const clearAttemptTimer = () => {
      if (attemptTimer !== undefined) {
        clearTimeout(attemptTimer);
        attemptTimer = undefined;
      }
    };

    /*
     * Booked before the attempt rather than after it. A request
     * in flight has already spent the provider's rate allowance
     * whether or not it succeeds, and two concurrent requests
     * must not both see an empty window.
     */
    reserveProvider(candidate.providerId, options.tokenBudget);

    let finishReason: FinishReason = "stop";
    let usage: TokenUsage | undefined;

    try {
      const provider = getProvider(candidate.providerId);

      for await (const event of provider.stream(
        /* The one place the private vendor model id is
           substituted for the public one, and where this
           provider's own controls are attached. */
        {
          ...options.request,
          model: candidate.model,
          ...(candidate.thinking
            ? { providerOptions: candidate.thinking }
            : {}),
        },
        candidate.credentials,
        attempt.signal
      )) {
        if (event.type === "delta") {
          if (!committed) {
            committed = true;
            clearAttemptTimer();
            yield { type: "committed", candidate };
          }

          yield { type: "delta", text: event.text };
          continue;
        }

        finishReason = event.finishReason;
        usage = event.usage;
      }

      if (committed) {
        yield { type: "done", finishReason, ...(usage ? { usage } : {}) };
        return;
      }

      /*
       * A clean 200 that produced no text at all, before any
       * commit. Rare — an over-restrictive stop sequence, a
       * filtered prompt, a model that spent its whole output
       * budget thinking — and worth trying the next provider for
       * rather than showing the learner an empty bubble.
       *
       * Not penalised: the provider is healthy, it just had
       * nothing to say. Taking it out of rotation for that would
       * punish it for the caller's prompt.
       */
      lastFailure = new AiRuntimeError(
        finishReason === "filtered" ? "provider_rejected" : "empty_response",
        finishReason === "filtered"
          ? "The AI declined to answer that prompt."
          : "The AI returned an empty response. Try rewording the prompt."
      );
    } catch (error) {
      /* Past the commit boundary. See the header. */
      if (committed) {
        throw error;
      }

      /* The caller hung up or the whole request timed out. */
      if (options.signal.aborted) {
        throw error;
      }

      const normalised = normalizeError(error);

      lastFailure = normalised;

      /*
       * Sit this provider out for a moment. `retryAfterSeconds`
       * is its own answer where it gave one — ProviderHealth
       * clamps it, because some vendors send an hour.
       */
      penaliseProvider(candidate.providerId, normalised.retryAfterSeconds);
    } finally {
      clearAttemptTimer();
      options.signal.removeEventListener("abort", relayAbort);
    }
  }

  if (options.signal.aborted) {
    /* Let the caller's own cancellation handling say what
       happened; it knows whether this was a timeout or a stop. */
    return;
  }

  /*
   * Nobody answered.
   *
   * Rare by design — four vendors, and the XP ceiling in front of
   * them means BuildGentic is never the source of the load that
   * exhausts them all at once. When it does happen the learner
   * gets one sentence that names no vendor, does not blame them,
   * and does not tell them to come back in five minutes, because
   * by then it will have fixed itself.
   */
  throw everyoneBusy || !lastFailure
    ? new AiRuntimeError(
        "provider_unavailable",
        "BuildGentic's AI is busy right now. Please try again in a moment.",
        { retryAfterSeconds: 15 }
      )
    : lastFailure;
}
