import { openRouterReferer, openRouterTitle } from "../config";
import { createOpenAiCompatibleProvider } from "./openAiCompatible";

/*
 * The four adapters the cascade routes between.
 *
 * One file rather than four, because after openAiCompatible.ts
 * absorbed the protocol there is nothing left of an adapter but
 * a base URL and two flags. Four files each holding fifteen
 * lines of configuration would hide that fact rather than
 * honour the one-file-per-provider convention — and the thing
 * the convention actually protects, "a vendor URL is written
 * down in exactly one place", is still true here.
 *
 * Priority lives in providerChain.ts, not here. This file only
 * says how to speak to each one.
 */

/*
 * Groq. Custom inference silicon, and the reason it leads the
 * chain: first token typically lands in well under a second,
 * which is the difference between a Lab that feels like a
 * conversation and one that feels like a form submission.
 */
export const groqProvider = createOpenAiCompatibleProvider({
  id: "groq",
  displayName: "Groq",
  chatUrl: "https://api.groq.com/openai/v1/chat/completions",
  validateUrl: "https://api.groq.com/openai/v1/models",
  /* Groq reports usage in the final chunk without being asked,
     and rejects the `usage` request field OpenRouter wants. */
  requestUsage: false,
});

/*
 * Cloudflare Workers AI. Second, and the replacement for
 * Cerebras — whose free tier stopped being one, becoming a
 * one-off $5 trial credit and then pay-as-you-go.
 *
 * THE URL CARRIES AN ACCOUNT ID, which is the one structural
 * difference from the other three and the reason this is built
 * rather than declared: every other vendor here has a single
 * global endpoint, and Cloudflare's is per account.
 *
 * It is not a secret — it is half of a public REST path and
 * appears in Cloudflare's own dashboard URLs — but it is also
 * not useful without the token, and it stays out of logs for the
 * same reason keys do. providerChain.ts refuses to put this
 * provider in the cascade unless BOTH env vars are set, so the
 * `undefined` below is unreachable from a real request; it
 * exists so importing this module never throws on a clone that
 * has no Cloudflare credentials at all.
 *
 * ON THE ENDPOINT. Cloudflare publishes two ways in, and this
 * takes the second:
 *
 *   /accounts/{id}/ai/run/{model}          native
 *   /accounts/{id}/ai/v1/chat/completions  OpenAI-compatible
 *
 * The native one is what the Workers AI quickstart shows, and it
 * genuinely is a different shape — it takes `{prompt}` or
 * `{messages}` and wraps its reply in a `result` envelope. But
 * both were checked against the live API before this was
 * written, and the compatible endpoint is a real one rather than
 * a thin veneer: it streams `text/event-stream`, emits
 * `choices[0].delta.content`, reports `finish_reason`, and
 * closes with `[DONE]` — the same frames this file's factory
 * already reads for the other three.
 *
 * Measured, @cf/openai/gpt-oss-120b, stream:true:
 *   data: {"choices":[{"delta":{"content":""},...}],"usage":{...}}
 *   data: {"choices":[{"delta":{"content":"A variable"},...}]}
 *   data: {"choices":[{"finish_reason":"stop",...}],"usage":{
 *           "prompt_tokens":82,"completion_tokens":35,...}}
 *   data: [DONE]
 *
 * So the native endpoint would buy a fifth dialect, a second SSE
 * reader and a second copy of the failure mapping, in exchange
 * for nothing. Taking the compatible one keeps Cloudflare inside
 * the shared adapter that the cascade's commit-boundary
 * behaviour is already tested against.
 *
 * Usage arrives unasked, so `requestUsage` stays off. Cloudflare
 * puts a usage object on nearly every chunk carrying that
 * chunk's own delta, and a cumulative total on the last one —
 * which is the value the factory keeps, since it overwrites as
 * it goes and the final frame wins.
 */
const cloudflareAccountId = process.env.NEUROLINK_CLOUDFLARE_ACCOUNT_ID?.trim();

const cloudflareBase = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai`;

export const cloudflareProvider = createOpenAiCompatibleProvider({
  id: "cloudflare",
  displayName: "Cloudflare Workers AI",
  chatUrl: `${cloudflareBase}/v1/chat/completions`,
  /*
   * Not `/ai/v1/models` — that path answers a GET with 405, so
   * it can never confirm anything. The account-scoped catalogue
   * search is the cheap authenticated GET here, capped at one
   * row because the response is otherwise the whole catalogue.
   */
  validateUrl: `${cloudflareBase}/models/search?per_page=1`,
  requestUsage: false,
  /* See the spec field. This GET reports a dead token as 400,
     where the chat endpoint correctly reports 401. */
  validateAuthFailureStatuses: [400],
});

/*
 * OpenRouter. A broker rather than a vendor, so one key reaches
 * many model families — which makes it the most likely of the
 * four to still be answering when the others are not.
 *
 * The two headers are attribution and neither is a secret; they
 * are what OpenRouter shows on its own dashboards.
 */
export const openRouterProvider = createOpenAiCompatibleProvider({
  id: "openrouter",
  displayName: "OpenRouter",
  chatUrl: "https://openrouter.ai/api/v1/chat/completions",
  validateUrl: "https://openrouter.ai/api/v1/key",
  extraHeaders: {
    "HTTP-Referer": openRouterReferer,
    "X-Title": openRouterTitle,
  },
  /* The one vendor here that needs asking for token counts. */
  requestUsage: true,
});

/*
 * Mistral. Last resort, and present so that "every provider is
 * down at once" stays a sentence a learner reads once a year
 * rather than once a term.
 */
export const mistralProvider = createOpenAiCompatibleProvider({
  id: "mistral",
  displayName: "Mistral",
  chatUrl: "https://api.mistral.ai/v1/chat/completions",
  validateUrl: "https://api.mistral.ai/v1/models",
  requestUsage: false,
});
