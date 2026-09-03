import "dotenv/config";

import type { ProviderId } from "./types";

/*
 * The provider cascade, in priority order.
 *
 * This array IS the routing policy. Adding a provider, dropping
 * one, or changing who goes first is an edit to this file and
 * nothing else — no route, no runtime branch, no React component
 * and no database column knows these names.
 *
 * Every request walks this list from the top. It is deliberately
 * not sticky: a learner who was served by Mistral a moment ago
 * because Groq was busy goes back to Groq the instant Groq is
 * free again. Pinning a session to whichever provider it last
 * landed on would mean one bad minute for Groq costs somebody
 * the good provider for their whole afternoon.
 *
 * WHAT THE LEARNER SEES: nothing in here. Not the name, not the
 * model, not the fact that a fallback happened. The product has
 * one AI and it is called BuildGentic. See models.ts.
 */

function readString(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    console.warn(
      `[ai] ${name} is not a non-negative number; using ${fallback}.`
    );
    return fallback;
  }

  return Math.floor(value);
}

export interface ChainEntry {
  providerId: ProviderId;
  /*
   * The concrete model id sent to this provider.
   *
   * Never leaves the server. The client asks for "neurolink-1"
   * and gets whichever of these actually answered, unlabelled.
   *
   * Pinned rather than aliased, following the convention
   * models.ts set: an alias survives a retirement but moves
   * under you without warning, and a Lab whose whole subject is
   * "change one thing and see what moved" cannot have the model
   * change underneath the learner.
   */
  model: string;
  /* Which env var holds this provider's key. */
  keyEnv: string;
  /*
   * Older names for the same key, still honoured.
   *
   * NEUROLINK_FREE_API_KEY is what migration-era .env files call
   * the OpenRouter key. Dropping it would have silently taken a
   * working provider out of the chain on every existing install,
   * and "the fallback stopped happening" is close to invisible.
   */
  keyEnvAliases?: string[];
  /*
   * Env vars that must ALSO be set before this entry can serve,
   * beyond its key.
   *
   * Cloudflare is the only one, and it needs this because its
   * endpoint is per account: the account id is part of the URL
   * rather than part of the auth. A token with no account id
   * produces a syntactically valid URL pointing at the string
   * "undefined", and the 400 that comes back reads like a bad
   * request rather than missing configuration — so the entry is
   * held out of the chain entirely instead, exactly as a missing
   * key holds one out.
   */
  requiresEnv?: string[];
  /*
   * The ceilings this provider is known to enforce, used to skip
   * it BEFORE it refuses rather than after.
   *
   * Set from each provider's published free-tier limits and
   * deliberately a little conservative: being wrong low costs
   * one fallback, being wrong high costs a 429 and the latency
   * of discovering it. Zero disables that particular check.
   */
  requestsPerMinute: number;
  tokensPerMinute: number;
  /*
   * Whether THIS provider's chosen model can look at an image.
   *
   * Per entry rather than per product, because the cascade makes
   * it a per-entry fact: swapping one model here for a
   * multimodal one changes what the whole chain can promise. See
   * chainCanSee() in models.ts, which takes the pessimistic AND
   * across every configured entry — any of them might answer,
   * and an agent that describes a photograph it never received
   * is the worst failure File Analysis has.
   */
  vision: boolean;
  /*
   * How to tell THIS provider's model to reason as little as
   * possible, or undefined for a model that does not reason.
   *
   * Load-bearing, not a tuning knob. gpt-oss spends its output
   * budget on hidden reasoning before it writes anything, and at
   * a 128-token cap it spends ALL of it: measured 126 reasoning
   * tokens and an empty answer. The Lab offers 128 and 512 as
   * one-click presets, so this is not a corner case — it is a
   * button.
   *
   * Under the cascade an empty answer is worse than it looks. It
   * is indistinguishable from a provider failing, so the router
   * falls through the whole chain and the learner gets an answer
   * from the last provider standing — which quietly destroys the
   * "watch an answer get cut off" experiment, because nothing
   * gets cut off.
   *
   * Spelled out per entry rather than inferred, for the reason
   * ModelDescriptor.minimalThinking gives: the encoding is not
   * stable across vendors or across a vendor's own generations.
   *
   *   measured, gpt-oss-120b on Groq, max_tokens 128:
   *     no setting          126 reasoning tokens, 0 chars out
   *     reasoning_effort low   7 reasoning tokens, 508 chars out
   */
  thinking?: Record<string, string | number>;
}

/*
 * Groq first. Fastest time-to-first-token of the four by a wide
 * margin, which matters more here than anywhere else — the Lab
 * is a place where somebody changes one number and re-runs, so
 * the round trip is the product.
 *
 * Cloudflare Workers AI second, and its RPM is the low one —
 * though for a different reason than the entry it replaced.
 * Cerebras sat here until its free tier stopped being one: what
 * is on offer now is a one-time $5 trial credit and then
 * pay-as-you-go, which is not something a free cascade can lean
 * on. Cloudflare's allowance is a daily neuron budget rather
 * than a per-minute ceiling, so the low RPM here is pacing a
 * quantity ProviderHealth cannot see. See the entry.
 *
 * OpenRouter third. Slower and brokered, but it reaches many
 * model families on one key, so it is the most likely of the
 * four to still be answering when the other three are not.
 *
 * Mistral last. A genuine last resort rather than a preference:
 * it is here so that "all four are down" stays rare enough that
 * the graceful message is something a learner sees once a year.
 *
 * MODEL IDS: every default below is overridable by env, and each
 * one should be confirmed against the provider's live model list
 * before this ships — see scripts/probe-providers.mts, which
 * prints exactly that. Vendors retire ids on their own schedule
 * and a stale default here is a 404 on every request to that
 * provider.
 */
export const PROVIDER_CHAIN: ChainEntry[] = [
  {
    providerId: "groq",
    model: readString("NEUROLINK_GROQ_MODEL") ?? "openai/gpt-oss-120b",
    keyEnv: "NEUROLINK_GROQ_API_KEY",
    requestsPerMinute: readInt("NEUROLINK_GROQ_RPM", 28),
    tokensPerMinute: readInt("NEUROLINK_GROQ_TPM", 5_500),
    /* gpt-oss is text-only. */
    vision: false,
    thinking: { reasoning_effort: "low" },
  },
  {
    providerId: "cloudflare",
    /*
     * Confirmed live against the account's own catalogue before
     * this was pinned, and confirmed free-plan eligible by
     * actually being asked for a completion — Cloudflare gates
     * part of its catalogue behind a paid Workers plan and says
     * so with `403 {"code":5035}`, which is a runtime fact the
     * model list does not show. gpt-oss-120b served a 200; the
     * Kimi, GLM and DeepSeek-V4 families all returned 5035.
     *
     * Same model family as Groq and OpenRouter run here, which
     * is the point: the cascade's whole promise is that a
     * fallback is invisible, and that is easiest to keep when
     * the fallback answers in the same voice.
     */
    model: readString("NEUROLINK_CLOUDFLARE_MODEL") ?? "@cf/openai/gpt-oss-120b",
    keyEnv: "NEUROLINK_CLOUDFLARE_API_TOKEN",
    requiresEnv: ["NEUROLINK_CLOUDFLARE_ACCOUNT_ID"],
    /*
     * The ceiling that actually bites here is not per minute.
     * Cloudflare's free allowance is a daily one — 10,000
     * neurons — and a gpt-oss-120b answer of a couple of hundred
     * tokens costs somewhere around 6 or 7 of them, so the day's
     * budget is on the order of 1,500 answers. ProviderHealth
     * only knows about minute windows, so it cannot see that
     * ceiling coming.
     *
     * Hence a deliberately low RPM: well under the ~300/min
     * Cloudflare documents for text generation, chosen to pace
     * the daily budget rather than to track the per-minute
     * limit. Slot 2 only sees traffic Groq could not take, so
     * this being conservative costs a fallback to OpenRouter
     * rather than an outage.
     *
     * TPM is 0 — disabled — because Cloudflare does not publish
     * a per-minute token ceiling to be conservative about, and a
     * number invented here would skip a healthy provider for a
     * limit that does not exist.
     */
    requestsPerMinute: readInt("NEUROLINK_CLOUDFLARE_RPM", 60),
    tokensPerMinute: readInt("NEUROLINK_CLOUDFLARE_TPM", 0),
    /* gpt-oss is text-only. */
    vision: false,
    /*
     * Honoured here, and worth having measured rather than
     * assumed — the encoding is not portable and this one
     * happens to match Groq's. At the Lab's 128-token preset,
     * @cf/openai/gpt-oss-120b spent 42 completion tokens with no
     * setting and 35 with `reasoning_effort: "low"`, answering
     * in both cases. Without it the margin at 128 is thin enough
     * to be worth closing.
     */
    thinking: { reasoning_effort: "low" },
  },
  {
    providerId: "openrouter",
    /*
     * A `:free` id, and it has to be one.
     *
     * This entry used to say "openai/gpt-oss-120b", which is a
     * PAID model on OpenRouter — so on a free-tier key every
     * request to slot 3 came back 402 and the cascade silently
     * fell through to Mistral. The chain looked four deep and
     * was three.
     *
     * OPENROUTER'S FREE LIST ROTATES, weekly and without much
     * notice, and this is the entry most exposed to that: the
     * gpt-oss and Llama `:free` slugs that would have matched
     * Groq and Cloudflare's family are gone at the time of
     * writing, and the whole free list is 21 models with no
     * overlap with either. So "keep the fallback in the same
     * voice" is not currently purchasable here, and matching on
     * SCALE is the nearest thing — this is a 120B model, like
     * the gpt-oss-120b above it.
     *
     * The rotation is what probe-providers.mts is for. A dead id
     * here is a 402 or a 404 on every slot-3 request, which the
     * cascade hides by design, so the only thing that catches it
     * is asking the catalogue on purpose.
     *
     * NOT `openrouter/free`, the Free Models Router, which is
     * the obvious answer to a rotating list and was measured
     * before being rejected. It picks a free model at random per
     * request, and across five calls it returned one EMPTY
     * answer and one first token at 16.4 seconds. Both are
     * uniquely bad here: an empty 200 is the one failure
     * streamFromChain cannot tell from a provider being broken,
     * and 16s is several times the first-token patience the
     * cascade allows. A pinned id that occasionally goes stale
     * is a better trade than a router that is occasionally
     * silent.
     *
     *   measured, first token, five calls each:
     *     openrouter/free        1059  856  529  EMPTY  16373 ms
     *     nemotron-3-super:free  1281 1856  525            ms
     */
    model:
      readString("NEUROLINK_OPENROUTER_MODEL") ??
      "nvidia/nemotron-3-super-120b-a12b:free",
    keyEnv: "NEUROLINK_OPENROUTER_API_KEY",
    keyEnvAliases: ["NEUROLINK_FREE_API_KEY"],
    /*
     * The free tier's ceiling is a DAILY request count — 50 on a
     * key that has never topped up, 1,000 after a one-off $10
     * credit purchase — rather than anything per minute. Same
     * shape of problem as Cloudflare's neuron budget: a daily
     * cap is invisible to ProviderHealth, so the RPM here is
     * partly pacing it.
     */
    requestsPerMinute: readInt("NEUROLINK_OPENROUTER_RPM", 18),
    tokensPerMinute: readInt("NEUROLINK_OPENROUTER_TPM", 0),
    vision: false,
    /* Accepted by this model — checked, rather than inherited
       from the entry this replaced. */
    thinking: { reasoning_effort: "low" },
  },
  {
    providerId: "mistral",
    model: readString("NEUROLINK_MISTRAL_MODEL") ?? "mistral-small-latest",
    keyEnv: "NEUROLINK_MISTRAL_API_KEY",
    requestsPerMinute: readInt("NEUROLINK_MISTRAL_RPM", 55),
    tokensPerMinute: readInt("NEUROLINK_MISTRAL_TPM", 0),
    vision: false,
    /* mistral-small does not reason before answering, so there
       is nothing to suppress. */
  },
];

/*
 * Whether this entry's non-key configuration is complete.
 *
 * Separate from keyFor because the two failures read
 * differently in the banner: "no key configured" is the expected
 * state of a fresh clone, while a key present with its account
 * id missing is a half-finished setup worth naming precisely.
 */
export function missingEnvFor(entry: ChainEntry): string[] {
  return (entry.requiresEnv ?? []).filter(
    (name) => readString(name) === undefined
  );
}

/* The key for one entry, or undefined when none is configured. */
export function keyFor(entry: ChainEntry): string | undefined {
  const named = readString(entry.keyEnv);

  if (named) {
    return named;
  }

  for (const alias of entry.keyEnvAliases ?? []) {
    const value = readString(alias);

    if (value) {
      return value;
    }
  }

  return undefined;
}

/*
 * Forces the offline mock even when real keys are configured.
 *
 * The kill switch, and the lever the verify scripts pull. Three
 * of them spawn the server with the provider forced to `mock` so
 * that a test suite exercising retrieval or memory never spends
 * real credit and never depends on a vendor being up.
 *
 * `NEUROLINK_PLATFORM_PROVIDER=mock` is honoured as well as the
 * clearer new name, for the same reason NEUROLINK_FREE_API_KEY
 * is: it is what the existing scripts and .env files say, and a
 * lever that silently stops working is worse than one that was
 * never there. Under BYOK that variable chose between Gemini and
 * OpenRouter; the only one of its old values that still means
 * anything is `mock`, and it still means exactly what it did.
 */
function offlineForced(): boolean {
  return (
    readString("NEUROLINK_AI_OFFLINE") === "1" ||
    readString("NEUROLINK_PLATFORM_PROVIDER")?.toLowerCase() === "mock"
  );
}

/*
 * The entries that could serve a request at all — the ones with
 * a key. Says nothing about whether they are currently busy;
 * that is ProviderHealth's question.
 *
 * Empty is a legitimate answer and the reason a fresh clone
 * still runs: resolveChain falls back to the mock, exactly as
 * the old platform resolver did.
 */
export function configuredChain(): ChainEntry[] {
  if (offlineForced()) {
    return [];
  }

  return PROVIDER_CHAIN.filter(
    (entry) => keyFor(entry) !== undefined && missingEnvFor(entry).length === 0
  );
}

/*
 * What the startup banner prints.
 *
 * Provider names are fine here — this goes to the server console,
 * which is the operator's, not the learner's. Keys never are.
 */
export function describeChain(): string[] {
  const configured = configuredChain();

  if (offlineForced()) {
    return [
      "[ai] provider chain: FORCED OFFLINE — every request is answered by the mock.",
      "[ai] unset NEUROLINK_AI_OFFLINE (or NEUROLINK_PLATFORM_PROVIDER=mock) to go live.",
    ];
  }

  const missing = PROVIDER_CHAIN.filter(
    (entry) => keyFor(entry) === undefined
  ).map((entry) => entry.providerId);

  /*
   * Named separately from "no key", because this one is nearly
   * always a typo rather than a decision: somebody pasted the
   * token and missed the account id, and the provider then sits
   * out of the cascade silently. Saying which variable is
   * missing turns that into a one-line fix.
   *
   * Computed before the empty-chain branch rather than after it,
   * because that branch is exactly where it matters most: a
   * server whose ONLY configured provider is a half-configured
   * Cloudflare would otherwise print "none configured" and say
   * nothing about the one variable standing between it and a
   * working chain.
   */
  const incomplete = PROVIDER_CHAIN.filter(
    (entry) => keyFor(entry) !== undefined && missingEnvFor(entry).length > 0
  ).map(
    (entry) => `${entry.providerId} (needs ${missingEnvFor(entry).join(", ")})`
  );

  if (configured.length === 0) {
    return [
      "[ai] provider chain: none configured — falling back to the offline mock.",
      "[ai] set NEUROLINK_GROQ_API_KEY (and the others) in server/.env to go live.",
      ...(incomplete.length > 0
        ? [`[ai] configured but incomplete: ${incomplete.join(", ")}`]
        : []),
    ];
  }

  const names = configured
    .map((entry, index) => `${index + 1}. ${entry.providerId} (${entry.model})`)
    .join("  ");

  return [
    `[ai] provider chain: ${names}`,
    ...(missing.length > 0
      ? [`[ai] no key configured for: ${missing.join(", ")}`]
      : []),
    ...(incomplete.length > 0
      ? [`[ai] configured but incomplete: ${incomplete.join(", ")}`]
      : []),
  ];
}
