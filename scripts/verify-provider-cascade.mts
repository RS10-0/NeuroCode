/*
 * Proof that the provider cascade routes the way it claims to.
 *
 * Unlike the other verify scripts, this one drives no server and
 * touches no database. The cascade is pure decision logic and
 * the interesting cases are the ones that are miserable to
 * arrange for real — Groq 429ing, Cloudflare saturating, all four
 * dying at once, a provider failing *after* the first token. So
 * it drives streamFromChain directly with fake adapters, which
 * makes every one of those a two-line setup.
 *
 * What it cannot prove is that the real adapters speak their
 * vendors' dialects correctly. That is what scripts/probe-
 * providers.mts is for, and it needs real keys.
 *
 *   npx tsx ./scripts/verify-provider-cascade.mts
 *
 * (tsx, not `node --experimental-strip-types`: this imports the
 * server's own modules, which use extensionless specifiers.)
 */

import { AiRuntimeError } from "../server/src/ai/errors";
import {
  penalise,
  resetHealth,
  snapshotHealth,
} from "../server/src/ai/ProviderHealth";
import { streamFromChain } from "../server/src/ai/streamFromChain";
import type {
  AiProvider,
  ChainCandidate,
  ModelRequest,
  ProviderId,
  ProviderStreamEvent,
} from "../server/src/ai/types";

/* ---------------------------------------------------------
   HARNESS
   --------------------------------------------------------- */

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ---------------------------------------------------------
   FAKE PROVIDERS

   Each one is a script: what it does when asked to stream.
   --------------------------------------------------------- */

type Behaviour =
  | { kind: "answers"; text: string }
  /* Refuses before producing anything — a 429, a 500, a
     connection failure. The cascade may move past this. */
  | { kind: "refuses"; code: string; retryAfterSeconds?: number }
  /* Produces some text and THEN dies. Past the commit boundary,
     so the cascade must not move past this. */
  | { kind: "diesMidStream"; text: string }
  /* A clean 200 carrying no text at all. */
  | { kind: "empty" }
  /* Accepts the connection and says nothing, ever. */
  | { kind: "hangs" };

const behaviours = new Map<ProviderId, Behaviour>();
const asked: ProviderId[] = [];

function fakeProvider(id: ProviderId): AiProvider {
  return {
    id,
    displayName: id,
    isConfigured: () => true,
    validateCredentials: async () => ({ valid: true }),
    async *stream(
      _request: ModelRequest,
      _credentials,
      signal: AbortSignal
    ): AsyncGenerator<ProviderStreamEvent> {
      asked.push(id);

      const behaviour = behaviours.get(id) ?? { kind: "refuses", code: "x" };

      if (behaviour.kind === "refuses") {
        throw new AiRuntimeError("provider_unavailable", "busy", {
          retryAfterSeconds: behaviour.retryAfterSeconds,
          internalDetail: behaviour.code,
        });
      }

      if (behaviour.kind === "hangs") {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }

      if (behaviour.kind === "empty") {
        yield { type: "done", finishReason: "stop" };
        return;
      }

      if (behaviour.kind === "diesMidStream") {
        yield { type: "delta", text: behaviour.text };
        throw new AiRuntimeError("provider_unavailable", "died");
      }

      yield { type: "delta", text: behaviour.text };
      yield {
        type: "done",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, reported: true },
      };
    },
  };
}

const registry = new Map<ProviderId, AiProvider>(
  (["groq", "cloudflare", "openrouter", "mistral"] as ProviderId[]).map((id) => [
    id,
    fakeProvider(id),
  ])
);

const CHAIN: ChainCandidate[] = [
  { providerId: "groq", model: "groq-model", credentials: { apiKey: "k" }, entry: { providerId: "groq", requestsPerMinute: 30, tokensPerMinute: 0, vision: false } },
  { providerId: "cloudflare", model: "cloudflare-model", credentials: { apiKey: "k" }, entry: { providerId: "cloudflare", requestsPerMinute: 2, tokensPerMinute: 0, vision: false } },
  { providerId: "openrouter", model: "openrouter-model", credentials: { apiKey: "k" }, entry: { providerId: "openrouter", requestsPerMinute: 30, tokensPerMinute: 0, vision: false } },
  { providerId: "mistral", model: "mistral-model", credentials: { apiKey: "k" }, entry: { providerId: "mistral", requestsPerMinute: 30, tokensPerMinute: 0, vision: false } },
];

const REQUEST: ModelRequest = {
  model: "neurolink-1",
  messages: [{ role: "user", content: "hello" }],
  settings: { temperature: 0.7, maxOutputTokens: 100 },
};

interface RunResult {
  text: string;
  served: ProviderId | null;
  sentModel: string | null;
  error: AiRuntimeError | null;
  events: string[];
}

async function run(
  firstTokenTimeoutMs = 50,
  signal: AbortSignal = new AbortController().signal
): Promise<RunResult> {
  asked.length = 0;

  const result: RunResult = {
    text: "",
    served: null,
    sentModel: null,
    error: null,
    events: [],
  };

  try {
    for await (const event of streamFromChain({
      candidates: CHAIN,
      request: REQUEST,
      tokenBudget: 200,
      firstTokenTimeoutMs,
      signal,
      getProvider: (id) => {
        const provider = registry.get(id);
        if (!provider) throw new Error(`no fake provider for ${id}`);
        return provider;
      },
    })) {
      result.events.push(event.type);

      if (event.type === "committed") {
        result.served = event.candidate.providerId;
        result.sentModel = event.candidate.model;
      } else if (event.type === "delta") {
        result.text += event.text;
      }
    }
  } catch (error) {
    result.error =
      error instanceof AiRuntimeError
        ? error
        : new AiRuntimeError("internal_error", String(error));
  }

  return result;
}

function reset(): void {
  resetHealth();
  behaviours.clear();
}

/* ---------------------------------------------------------
   THE CASES
   --------------------------------------------------------- */

async function main(): Promise<void> {
  section("1. All four healthy — Groq serves, nobody else is asked");
  reset();
  for (const id of ["groq", "cloudflare", "openrouter", "mistral"] as ProviderId[]) {
    behaviours.set(id, { kind: "answers", text: `from ${id}` });
  }
  let r = await run();
  check("Groq served", r.served === "groq", `served ${r.served}`);
  check("text is Groq's", r.text === "from groq", r.text);
  check("only Groq was contacted", asked.join(",") === "groq", asked.join(","));
  check(
    "the private model id was sent, not the public one",
    r.sentModel === "groq-model",
    String(r.sentModel)
  );

  section("2. Groq 429s — Cloudflare serves, caller sees one clean stream");
  reset();
  behaviours.set("groq", { kind: "refuses", code: "429", retryAfterSeconds: 5 });
  behaviours.set("cloudflare", { kind: "answers", text: "from cloudflare" });
  r = await run();
  check("Cloudflare served", r.served === "cloudflare", `served ${r.served}`);
  check("text is Cloudflare's alone", r.text === "from cloudflare", r.text);
  check(
    "exactly one commit reached the caller",
    r.events.filter((e) => e === "committed").length === 1
  );
  check("no error surfaced", r.error === null, r.error?.code);
  check("Groq was put in cooldown", (snapshotHealth().find((h) => h.providerId === "groq")?.cooldownRemainingMs ?? 0) > 0);

  section("3. Groq and Cloudflare both saturated — OpenRouter serves");
  reset();
  behaviours.set("groq", { kind: "refuses", code: "429" });
  behaviours.set("cloudflare", { kind: "refuses", code: "429" });
  behaviours.set("openrouter", { kind: "answers", text: "from openrouter" });
  r = await run();
  check("OpenRouter served", r.served === "openrouter", `served ${r.served}`);
  check("Mistral was never contacted", !asked.includes("mistral"), asked.join(","));

  section("4. All four down — one graceful message, no vendor named");
  reset();
  for (const id of ["groq", "cloudflare", "openrouter", "mistral"] as ProviderId[]) {
    behaviours.set(id, { kind: "refuses", code: "500" });
  }
  r = await run();
  check("the caller got an error", r.error !== null);
  check("nothing was streamed", r.text === "");
  check("all four were tried", asked.length === 4, asked.join(","));
  const message = r.error?.message ?? "";
  check(
    "the message names no vendor",
    !/groq|cloudflare|openrouter|mistral|gemini|llama|openai|anthropic/i.test(
      message
    ),
    message
  );
  check(
    "the message does not say 'try again in N minutes'",
    !/\d+\s*minute/i.test(message),
    message
  );

  section("5. Groq recovers — the very next request uses Groq again");
  reset();
  behaviours.set("groq", { kind: "refuses", code: "429", retryAfterSeconds: 1 });
  behaviours.set("cloudflare", { kind: "answers", text: "from cloudflare" });
  r = await run();
  check("fell through to Cloudflare", r.served === "cloudflare", `served ${r.served}`);

  /* Groq is healthy again. Nothing about the last request may
     survive into this one — that is the non-stickiness claim. */
  behaviours.set("groq", { kind: "answers", text: "from groq" });
  resetHealth();
  r = await run();
  check(
    "the next request goes back to the top of the chain",
    r.served === "groq",
    `served ${r.served}`
  );
  check("no session was pinned to Cloudflare", r.text === "from groq", r.text);

  section("6. Failure AFTER the first token does not silently restart");
  reset();
  behaviours.set("groq", { kind: "diesMidStream", text: "half an ans" });
  behaviours.set("cloudflare", { kind: "answers", text: "a whole different answer" });
  r = await run();
  check("the error was surfaced, not swallowed", r.error !== null, "no error");
  check(
    "the partial text was not replaced by another provider's",
    r.text === "half an ans",
    r.text
  );
  check(
    "Cloudflare was never asked to finish Groq's sentence",
    !asked.includes("cloudflare"),
    asked.join(",")
  );

  section("7. A provider that hangs is abandoned for the next one");
  reset();
  behaviours.set("groq", { kind: "hangs" });
  behaviours.set("cloudflare", { kind: "answers", text: "from cloudflare" });
  const startedAt = Date.now();
  r = await run(40);
  check("Cloudflare served", r.served === "cloudflare", `served ${r.served}`);
  check(
    "the whole request did not die with the hung provider",
    r.error === null,
    r.error?.code
  );
  check(
    "the wait was one patience budget, not the request timeout",
    Date.now() - startedAt < 2_000,
    `${Date.now() - startedAt}ms`
  );

  section("8. An empty answer falls through rather than showing a blank bubble");
  reset();
  behaviours.set("groq", { kind: "empty" });
  behaviours.set("cloudflare", { kind: "answers", text: "from cloudflare" });
  r = await run();
  check("Cloudflare served", r.served === "cloudflare", `served ${r.served}`);
  check(
    "an empty 200 did not put Groq in cooldown",
    (snapshotHealth().find((h) => h.providerId === "groq")
      ?.cooldownRemainingMs ?? 0) === 0
  );

  section("9. The proactive skip — a full window is not even asked");
  reset();
  behaviours.set("groq", { kind: "answers", text: "from groq" });
  behaviours.set("cloudflare", { kind: "answers", text: "from cloudflare" });
  behaviours.set("openrouter", { kind: "answers", text: "from openrouter" });
  /* Groq is in cooldown, and Cloudflare's window (2/min in the
     fixture) is filled by two prior calls. */
  penalise("groq", 30);
  await run();
  await run();
  asked.length = 0;
  r = await run();
  check(
    "the saturated providers were skipped without a request",
    !asked.includes("groq"),
    asked.join(",")
  );
  check("OpenRouter served", r.served === "openrouter", `served ${r.served}`);

  section("10. No ChainEvent carries a vendor name to the caller");
  reset();
  behaviours.set("groq", { kind: "answers", text: "hello there" });
  r = await run();
  check(
    "the only vendor-bearing event is `committed`, which stops at the runtime",
    r.events.filter((e) => e === "committed").length === 1 &&
      r.events.filter((e) => e === "delta" || e === "done").length ===
        r.events.length - 1
  );

  console.log(
    `\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed\n`
  );

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
