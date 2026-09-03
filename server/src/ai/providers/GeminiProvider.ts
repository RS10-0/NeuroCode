import { AiRuntimeError } from "../errors";
import { findModel } from "../models";
import { readSseData } from "./sse";
import type {
  AiProvider,
  CredentialCheck,
  EmbeddingRequest,
  EmbeddingResult,
  FinishReason,
  ModelRequest,
  ProviderCredentials,
  ProviderStreamEvent,
} from "../types";

/*
 * Google Gemini — BuildGentic's platform provider.
 *
 * Chosen on cost. BuildGentic pays this bill for every learner, so
 * the per-token price is the deciding factor, and Gemini's free
 * tier bills nothing at all while a project has no billing
 * account attached.
 *
 * The wire format shares nothing with the OpenAI-compatible
 * family: `contents` rather than `messages`, `parts` rather than
 * `content`, `model` rather than `assistant`, system instructions
 * in their own top-level field, and SCREAMING_CASE finish
 * reasons. All of that stops at this file — the runtime above it
 * never sees any of it.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const geminiProvider: AiProvider = {
  id: "gemini",
  displayName: "Google Gemini",

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
      /* Listing models is the cheapest authenticated call Gemini
         offers — no tokens, no generation, no billing. */
      const response = await fetch(`${BASE}/models?pageSize=1`, {
        method: "GET",
        signal,
        headers: authHeaders(credentials.apiKey),
      });

      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return {
          valid: false,
          reason:
            "Google rejected that API key. Check you copied it in full from Google AI Studio.",
        };
      }

      return {
        valid: false,
        reason: "Google could not be reached to check that key. Try again shortly.",
      };
    } catch {
      return {
        valid: false,
        reason: "Google could not be reached to check that key. Try again shortly.",
      };
    }
  },

  async *stream(
    request: ModelRequest,
    credentials: ProviderCredentials,
    signal: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent> {
    if (!credentials.apiKey) {
      throw new AiRuntimeError(
        "provider_not_configured",
        "AI is not configured on this BuildGentic server yet."
      );
    }

    const descriptor = findModel(request.model);

    /*
     * Gemini distinguishes `user` from `model`, not `assistant`,
     * and carries text inside a `parts` array. System text is a
     * separate top-level field — which is exactly why the runtime
     * keeps `system` out of `messages`.
     */
    /*
     * Images go in as `inlineData` parts, ahead of the text.
     *
     * Before rather than after, because Gemini reads parts in
     * order and a question that follows its picture is a
     * question about the picture — the same reason a person
     * looks at a chart before reading the caption.
     */
    const contents = request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        ...(message.images ?? []).map((image) => ({
          inlineData: { mimeType: image.mediaType, data: image.dataBase64 },
        })),
        { text: message.content },
      ],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.settings.temperature,
        maxOutputTokens: request.settings.maxOutputTokens,
        ...(request.settings.stop
          ? { stopSequences: request.settings.stop }
          : {}),
        /*
         * Thinking tokens are billed and never shown. The
         * encoding comes from the catalogue rather than from
         * here, because it differs between Gemini generations
         * and guessing produces a 400 that says only "invalid
         * argument".
         */
        ...(descriptor?.minimalThinking
          ? { thinkingConfig: descriptor.minimalThinking }
          : {}),
      },
    };

    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    let response: Response;

    try {
      /*
       * `alt=sse` asks for Server-Sent Events; without it this
       * endpoint streams a JSON array, which cannot be parsed
       * incrementally without a streaming JSON reader.
       *
       * The key travels in a header, never the query string — a
       * URL ends up in proxy logs, browser history and error
       * reports, and a key in one of those is a key published.
       */
      response = await fetch(
        `${BASE}/models/${encodeURIComponent(
          request.model
        )}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          signal,
          headers: {
            ...authHeaders(credentials.apiKey),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      throw new AiRuntimeError(
        "provider_unavailable",
        "Could not reach the AI provider. Please try again in a moment.",
        {
          internalDetail: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (!response.ok) {
      /* A keyId is set only for BYOK, so its presence tells the
         adapter whose key was just rejected — and therefore who
         can actually do something about it. */
      throw await describeHttpFailure(response, Boolean(credentials.keyId));
    }

    if (!response.body) {
      throw new AiRuntimeError(
        "provider_malformed_response",
        "The AI provider returned an empty response.",
        { internalDetail: "No response body on a 2xx streaming reply." }
      );
    }

    let finishReason: FinishReason = "stop";
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let blockReason: string | undefined;

    for await (const data of readSseData(response.body, signal)) {
      if (data === "[DONE]") {
        break;
      }

      let chunk: GeminiChunk;

      try {
        chunk = JSON.parse(data) as GeminiChunk;
      } catch {
        throw new AiRuntimeError(
          "provider_malformed_response",
          "The AI provider sent a response BuildGentic could not read.",
          { internalDetail: `Unparseable SSE payload (${data.length} bytes).` }
        );
      }

      /* An error can arrive mid-stream, after a 200. */
      if (chunk.error) {
        throw new AiRuntimeError(
          "provider_rejected",
          "The AI provider could not complete this request.",
          {
            internalDetail: `Mid-stream error: ${
              chunk.error.message ?? "unknown"
            }`,
          }
        );
      }

      /*
       * The whole prompt was refused before generation started.
       * Distinct from a candidate being filtered mid-answer, and
       * worth its own message.
       */
      if (chunk.promptFeedback?.blockReason) {
        blockReason = chunk.promptFeedback.blockReason;
      }

      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          /*
           * `candidatesTokenCount` excludes thinking tokens, which
           * are billed. Adding them keeps the usage table honest
           * about what was actually spent.
           */
          outputTokens:
            (chunk.usageMetadata.candidatesTokenCount ?? 0) +
            (chunk.usageMetadata.thoughtsTokenCount ?? 0),
        };
      }

      const candidate = chunk.candidates?.[0];

      if (!candidate) {
        continue;
      }

      if (candidate.finishReason) {
        finishReason = mapFinishReason(candidate.finishReason);
      }

      for (const part of candidate.content?.parts ?? []) {
        /* Thought parts are internal reasoning. They are not the
           answer and must never be streamed to a learner. */
        if (part.thought) {
          continue;
        }

        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "delta", text: part.text };
        }
      }
    }

    if (blockReason) {
      throw new AiRuntimeError(
        "provider_rejected",
        "The AI declined to answer that prompt. Try rewording it.",
        { internalDetail: `promptFeedback.blockReason=${blockReason}` }
      );
    }

    yield {
      type: "done",
      finishReason,
      ...(usage ? { usage: { ...usage, reported: true } } : {}),
    };
  },

  /* -------------------------------------------------------
     EMBEDDINGS

     `:batchEmbedContents` rather than one `:embedContent` per
     chunk. One HTTP call is one quota slot and one usage row,
     so batching is not only faster — it is the difference
     between indexing a document costing one request and
     costing forty.

     `taskType` is the part worth not skipping. Google embeds
     "a passage somebody might search for" and "the thing
     somebody typed into a search box" differently on purpose,
     and telling it which this is measurably improves what
     comes back.
     ------------------------------------------------------- */

  async embed(
    request: EmbeddingRequest,
    credentials: ProviderCredentials,
    signal: AbortSignal
  ): Promise<EmbeddingResult> {
    if (!credentials.apiKey) {
      throw new AiRuntimeError(
        "provider_not_configured",
        "AI is not configured on this BuildGentic server yet."
      );
    }

    const taskType =
      request.purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";

    const body = {
      requests: request.texts.map((text) => ({
        /* Required on every sub-request, fully qualified, even
           though the URL already names the model. */
        model: `models/${request.model}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: request.dimensions,
      })),
    };

    let response: Response;

    try {
      response = await fetch(
        `${BASE}/models/${encodeURIComponent(
          request.model
        )}:batchEmbedContents`,
        {
          method: "POST",
          signal,
          headers: {
            ...authHeaders(credentials.apiKey),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      throw new AiRuntimeError(
        "provider_unavailable",
        "Could not reach the AI provider. Please try again in a moment.",
        {
          internalDetail: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (!response.ok) {
      throw await describeHttpFailure(response, Boolean(credentials.keyId));
    }

    let parsed: { embeddings?: Array<{ values?: number[] }> };

    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      throw new AiRuntimeError(
        "provider_malformed_response",
        "The AI provider sent a response BuildGentic could not read.",
        { internalDetail: "batchEmbedContents body was not JSON." }
      );
    }

    const embeddings = parsed.embeddings ?? [];

    return {
      /*
       * Positional, and the runtime checks the count. Google
       * returns these in request order and provides no index to
       * sort by, so a length mismatch is the only detectable
       * form of the failure that would silently attach each
       * chunk's meaning to its neighbour.
       */
      vectors: embeddings.map((entry) => entry.values ?? []),
    };
  },
};

function authHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey };
}

/* =========================================================
   WIRE SHAPES
========================================================= */

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string; code?: number };
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "MAX_TOKENS":
      return "length";

    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "filtered";

    case "STOP":
      return "stop";

    default:
      /* MALFORMED_FUNCTION_CALL, OTHER, and anything Google adds. */
      return "error";
  }
}

/* =========================================================
   FAILURE MAPPING

   Google's message is never forwarded: it can name the project,
   the API key's display name, and quota identifiers.
========================================================= */

async function describeHttpFailure(
  response: Response,
  isByok: boolean
): Promise<AiRuntimeError> {
  const detail = await readErrorDetail(response);
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

  /* Always BuildGentic's own key now — there is no learner key
     left for this to have been. */
  const badKey = (): AiRuntimeError =>
    new AiRuntimeError(
      "provider_not_configured",
      "BuildGentic's AI credentials were rejected. This is a server configuration problem, not something you did.",
      { internalDetail: detail }
    );

  switch (response.status) {
    case 400:
      /*
       * Gemini answers an invalid API key with 400
       * INVALID_ARGUMENT rather than 401, so the body has to be
       * read to tell "your key is wrong" from "your request is
       * wrong". Getting this backwards would tell a learner to
       * reword a perfectly good prompt.
       */
      if (/api[_ ]?key|API_KEY_INVALID/i.test(detail)) {
        return badKey();
      }

      return new AiRuntimeError(
        "provider_rejected",
        "The AI provider rejected this request. Try rewording the prompt.",
        { internalDetail: detail }
      );

    case 401:
    case 403:
      return badKey();

    case 404:
      return new AiRuntimeError(
        "provider_rejected",
        "That model is not available right now. Try another one.",
        { internalDetail: detail }
      );

    case 429:
      return new AiRuntimeError(
        "provider_unavailable",
        isByok
          ? "Your Google account is rate-limited or its free quota is spent. Please try again shortly."
          : "The AI provider is busy or its free quota is spent. Please try again shortly.",
        { retryAfterSeconds: retryAfter ?? 30, internalDetail: detail }
      );

    default:
      if (response.status >= 500) {
        return new AiRuntimeError(
          "provider_unavailable",
          "The AI provider is having problems. Please try again shortly.",
          { internalDetail: detail }
        );
      }

      return new AiRuntimeError(
        "provider_rejected",
        "The AI provider could not complete this request.",
        { internalDetail: detail }
      );
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.text();
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
