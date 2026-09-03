import { AiRuntimeError } from "../errors";
import { readSseData } from "./sse";
import type {
  AiProvider,
  CredentialCheck,
  FinishReason,
  ModelRequest,
  ProviderCredentials,
  ProviderId,
  ProviderStreamEvent,
} from "../types";

/*
 * One adapter, four vendors.
 *
 * Groq, Cloudflare, Mistral and OpenRouter all speak the OpenAI
 * /chat/completions dialect: same request body, same SSE frames,
 * same `choices[0].delta.content`. OpenRouterProvider said as
 * much in its own header — "a second OpenAI-shaped provider
 * later is a base URL and a header away" — and this is that
 * sentence collected into a factory.
 *
 * What differs between them is genuinely small, and every
 * difference is a field on the spec below rather than a branch
 * in the code: where to POST, which cheap endpoint answers "is
 * this key alive", whether the vendor wants `max_tokens` or
 * `max_completion_tokens`, and whether it understands a request
 * for token accounting.
 *
 * The failure mapping at the bottom is the part that earns the
 * shared file. Getting "429 means back off for this long" right
 * once is worth more than getting it four-fifths right in four
 * places, because the cascade above depends on it: a 429 that is
 * misread as a hard failure takes a healthy provider out of
 * rotation for two minutes.
 *
 * NO VENDOR NAME APPEARS IN ANY MESSAGE THIS FILE PRODUCES.
 * Everything here can reach a learner, and the learner is only
 * ever talking to BuildGentic.
 */

export interface OpenAiCompatibleSpec {
  id: ProviderId;
  /* Operator-facing only — logs and the startup banner. Never
     serialised into a response. */
  displayName: string;
  chatUrl: string;
  /*
   * The cheapest authenticated GET this vendor offers, used to
   * check a key without generating anything. Every one of the
   * four publishes a /models listing that serves.
   */
  validateUrl: string;
  /* Attribution or routing headers. Never secrets. */
  extraHeaders?: Record<string, string>;
  /*
   * OpenRouter returns real token counts when asked with
   * `usage: {include: true}`; the others either send them
   * unprompted or reject the field outright.
   */
  requestUsage?: boolean;
  /* Vendors are split on the spelling. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /*
   * Extra statuses that mean "this key is bad" on the
   * `validateUrl` GET specifically — never on the chat call.
   *
   * Exists for Cloudflare, whose account-scoped REST gateway
   * answers a GET carrying a dead token with `400 {"code":9106,
   * "message":"Authentication failed (status: 400)"}` rather
   * than a 401. Measured, both ways:
   *
   *   GET  /accounts/{id}/ai/models/search  bad token -> 400
   *   POST /accounts/{id}/ai/v1/chat/...    bad token -> 401
   *
   * So the chat path needs nothing — describeHttpFailure already
   * reads that 401 correctly. Only the key check does, and
   * without this a revoked token reports as "could not confirm
   * that key right now", which sends an operator looking for a
   * network fault instead of a dead token.
   *
   * Scoped to validateCredentials deliberately. A 400 from the
   * chat endpoint really is a malformed request, and widening
   * this to cover it would relabel every genuine bad-prompt 400
   * as a credentials problem.
   */
  validateAuthFailureStatuses?: number[];
}

export function createOpenAiCompatibleProvider(
  spec: OpenAiCompatibleSpec
): AiProvider {
  const maxTokensField = spec.maxTokensField ?? "max_tokens";

  return {
    id: spec.id,
    displayName: spec.displayName,

    isConfigured(credentials: ProviderCredentials): boolean {
      return Boolean(credentials.apiKey);
    },

    async validateCredentials(
      credentials: ProviderCredentials,
      signal: AbortSignal
    ): Promise<CredentialCheck> {
      if (!credentials.apiKey) {
        return { valid: false, reason: "No API key was provided." };
      }

      try {
        const response = await fetch(spec.validateUrl, {
          method: "GET",
          signal,
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            ...spec.extraHeaders,
          },
        });

        if (response.ok) {
          return { valid: true };
        }

        if (
          response.status === 401 ||
          response.status === 403 ||
          (spec.validateAuthFailureStatuses ?? []).includes(response.status)
        ) {
          return { valid: false, reason: "That key was rejected." };
        }

        return {
          valid: false,
          reason: "The provider could not confirm that key right now.",
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }

        return {
          valid: false,
          reason: "Could not reach the provider to check that key.",
        };
      }
    },

    async *stream(
      request: ModelRequest,
      credentials: ProviderCredentials,
      signal: AbortSignal
    ): AsyncGenerator<ProviderStreamEvent> {
      if (!credentials.apiKey) {
        /*
         * Belt and braces — resolveChain already refuses to hand
         * out an unconfigured provider. Worth keeping: an adapter
         * that sent `Bearer undefined` would produce a 401 that
         * reads like a revoked key rather than a missing one.
         */
        throw new AiRuntimeError(
          "provider_not_configured",
          "AI is not configured on this BuildGentic server yet."
        );
      }

      /*
       * Mapped explicitly rather than spread: in the OpenAI wire
       * format images belong in a content array as `image_url`
       * parts, and a stray `images` key alongside a string
       * `content` is a 400.
       */
      const turns = request.messages.map((message) =>
        message.images?.length
          ? {
              role: message.role,
              content: [
                ...message.images.map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${image.mediaType};base64,${image.dataBase64}`,
                  },
                })),
                { type: "text", text: message.content },
              ],
            }
          : { role: message.role, content: message.content }
      );

      /*
       * The system instruction goes in as a leading message
       * rather than a separate field, which is exactly why the
       * runtime keeps `system` separate — the translation is an
       * adapter's problem, not a caller's.
       */
      const messages = request.system
        ? [{ role: "system", content: request.system }, ...turns]
        : turns;

      let response: Response;

      try {
        response = await fetch(spec.chatUrl, {
          method: "POST",
          signal,
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
            ...spec.extraHeaders,
          },
          body: JSON.stringify({
            model: request.model,
            messages,
            stream: true,
            temperature: request.settings.temperature,
            [maxTokensField]: request.settings.maxOutputTokens,
            ...(request.settings.stop ? { stop: request.settings.stop } : {}),
            ...(spec.requestUsage ? { usage: { include: true } } : {}),
            /*
             * Per-provider extras — today, reasoning suppression.
             * Spread last so a chain entry can override anything
             * above it if a vendor ever needs that.
             */
            ...(request.providerOptions ?? {}),
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }

        /*
         * DNS failure, TLS failure, connection refused. The
         * underlying message can name internal hosts and
         * proxies, so it stays in the log and out of the
         * response.
         */
        throw new AiRuntimeError(
          "provider_unavailable",
          "Could not reach the AI service. Please try again in a moment.",
          {
            internalDetail: `[${spec.id}] ${
              error instanceof Error ? error.message : String(error)
            }`,
          }
        );
      }

      if (!response.ok) {
        throw await describeHttpFailure(response, spec.id);
      }

      if (!response.body) {
        throw new AiRuntimeError(
          "provider_malformed_response",
          "The AI service returned an empty response.",
          {
            internalDetail: `[${spec.id}] No response body on a 2xx streaming reply.`,
          }
        );
      }

      let usage: { inputTokens: number; outputTokens: number } | undefined;
      let finishReason: FinishReason = "stop";

      for await (const data of readSseData(response.body, signal)) {
        if (data === "[DONE]") {
          break;
        }

        let chunk: CompletionChunk;

        try {
          chunk = JSON.parse(data) as CompletionChunk;
        } catch {
          throw new AiRuntimeError(
            "provider_malformed_response",
            "The AI service sent a response BuildGentic could not read.",
            {
              internalDetail: `[${spec.id}] Unparseable SSE payload (${data.length} bytes).`,
            }
          );
        }

        /*
         * A failure reported mid-stream, after a 200, as an
         * `error` member on an otherwise normal chunk. A reader
         * that only checked the HTTP status would treat this as
         * a clean short answer.
         *
         * This is one of the two reasons the cascade commits on
         * first token rather than on the response headers: a 200
         * is not yet an answer.
         */
        if (chunk.error) {
          throw new AiRuntimeError(
            "provider_rejected",
            "The AI service could not complete this request.",
            {
              internalDetail: `[${spec.id}] Mid-stream error: ${
                chunk.error.message ?? "unknown"
              }`,
            }
          );
        }

        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }

        const choice = chunk.choices?.[0];

        if (!choice) {
          /* Usage-only chunks carry no choices. Not an error. */
          continue;
        }

        if (choice.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);
        }

        const text = choice.delta?.content;

        if (typeof text === "string" && text.length > 0) {
          yield { type: "delta", text };
        }
      }

      yield {
        type: "done",
        finishReason,
        ...(usage ? { usage: { ...usage, reported: true } } : {}),
      };
    },
  };
}

/* =========================================================
   WIRE SHAPES
========================================================= */

interface CompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string; code?: number | string };
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "length":
    case "max_tokens":
      return "length";

    case "content_filter":
      return "filtered";

    case "error":
      return "error";

    default:
      /* "stop", "end_turn", "tool_calls" and anything new. */
      return "stop";
  }
}

/* =========================================================
   FAILURE MAPPING

   The provider's own message is deliberately never forwarded.
   It can contain an account id, a request id, the organisation
   name, and in some upstream responses a truncated key.

   It also names the vendor, which is its own reason: a learner
   who reads "your OpenRouter account is out of credit" has just
   been told something the whole cascade exists to keep private.
   Every message below says "the AI service".

   `retryAfterSeconds` on the 429 is load-bearing rather than
   decorative — ProviderHealth uses it to decide how long to
   leave this provider out of the chain.
========================================================= */

async function describeHttpFailure(
  response: Response,
  providerId: ProviderId
): Promise<AiRuntimeError> {
  const detail = `[${providerId}] ${await readErrorDetail(response)}`;
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

  switch (response.status) {
    case 400:
    case 422:
      return new AiRuntimeError(
        "provider_rejected",
        "The AI service rejected this request. Try rewording the prompt.",
        { internalDetail: detail }
      );

    case 401:
    case 403:
      /*
       * BuildGentic's own key was rejected. Not the learner's
       * fault and not something they can fix, so it must not
       * read like a telling-off — but the cascade will also
       * quietly move past it, so most learners never see this
       * at all.
       *
       * A 403 has a second meaning worth knowing about when the
       * log line lands: Cloudflare answers a model its plan does
       * not cover with `403 {"code":5035,"message":"... is not
       * available on the Workers Free plan"}`. Same handling —
       * the key is not usable for this request either way, and
       * the cascade moves on — but the fix is a model id in
       * providerChain.ts rather than a new token, so the hint
       * points there.
       */
      return new AiRuntimeError(
        "provider_not_configured",
        "BuildGentic's AI credentials were rejected. This is a server configuration problem, not something you did.",
        {
          internalDetail:
            response.status === 403
              ? `${detail} — if this names a plan, the model id in providerChain.ts for "${providerId}" needs a plan that account does not have.`
              : detail,
        }
      );

    case 402:
      return new AiRuntimeError(
        "provider_not_configured",
        "BuildGentic's AI service is temporarily out of credit. Please try again later.",
        { internalDetail: detail }
      );

    case 404:
      /*
       * Almost always a retired model id rather than a bad URL.
       * The log line is the one that matters here: the fix is an
       * edit to providerChain.ts, and nobody will guess that
       * from a 404.
       */
      return new AiRuntimeError(
        "provider_rejected",
        "That AI model is not available right now.",
        {
          internalDetail: `${detail} — the model id in providerChain.ts for "${providerId}" may have been retired.`,
        }
      );

    case 408:
      return new AiRuntimeError(
        "timeout",
        "The AI service took too long to respond. Please try again.",
        { internalDetail: detail, retryAfterSeconds: retryAfter }
      );

    case 429:
      return new AiRuntimeError(
        "provider_unavailable",
        "The AI service is busy. Please try again in a moment.",
        { retryAfterSeconds: retryAfter ?? 10, internalDetail: detail }
      );

    default:
      if (response.status >= 500) {
        return new AiRuntimeError(
          "provider_unavailable",
          "The AI service is having problems. Please try again shortly.",
          { internalDetail: detail, retryAfterSeconds: retryAfter }
        );
      }

      return new AiRuntimeError(
        "provider_rejected",
        "The AI service could not complete this request.",
        { internalDetail: detail }
      );
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.text();
    /* Truncated: this goes to the server log, not to a user, and
       a full failed-request body is noise at any length. */
    return `HTTP ${response.status}: ${body.slice(0, 400)}`;
  } catch {
    return `HTTP ${response.status} (body unreadable)`;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);

  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds)
    : undefined;
}
