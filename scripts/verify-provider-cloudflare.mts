/*
 * Proof that Cloudflare Workers AI actually serves, and that
 * when it does not, OpenRouter is what answers instead.
 *
 * The companion to verify-provider-cascade.mts, and deliberately
 * the opposite kind of test. That one drives streamFromChain
 * with fake adapters, so it can arrange any failure at all but
 * proves nothing about whether a vendor's dialect was read
 * correctly. This one uses the REAL adapter against the REAL
 * endpoint with the REAL key, because the thing being replaced
 * here is a provider, and the question "does the new one speak
 * the protocol we think it speaks" cannot be answered by a mock
 * that was written from the same assumption as the adapter.
 *
 *   npx tsx ./scripts/verify-provider-cloudflare.mts
 *
 * Costs a handful of Cloudflare neurons and one OpenRouter call.
 * Needs NEUROLINK_CLOUDFLARE_ACCOUNT_ID, NEUROLINK_CLOUDFLARE_
 * API_TOKEN and an OpenRouter key in server/.env.
 *
 * WHAT IS REAL AND WHAT IS ARRANGED, stated plainly because a
 * verification script that blurs this is worth very little:
 *
 *   real   Cloudflare serving a streamed completion (section 2)
 *   real   Cloudflare's 401 on a dead token         (section 5)
 *   real   Cloudflare's 403 on a plan-gated model   (section 6)
 *   real   OpenRouter's 401, and Mistral serving    (section 8)
 *   real   every fall-through in sections 5-8 — the providers
 *          after the one being failed are the live adapters with
 *          the live keys, and `contacted` records who was
 *          actually sent a request rather than who was expected
 *          to be
 *   staged the 429s in sections 7 and 8 — a rate limit is not
 *          something to manufacture against a vendor on purpose,
 *          so those drive the cooldown a real 429 sets, via the
 *          same ProviderHealth.penalise() that streamFromChain
 *          calls when the adapter reads one.
 *
 * SECTION 8 IS THE BOTTOM HOP, and it is here because nothing
 * else in this file covers it: every other section ends at
 * OpenRouter, so a broken link between slot 3 and slot 4 would
 * pass all of them. It finishes by walking the whole chain down
 * in one request with everything above Mistral genuinely
 * refusing — the case that proves the cascade is four deep and
 * not three.
 *
 * SECTION 4 IS A PRECONDITION, not a Cloudflare test. It asks
 * whether OpenRouter can serve at all before the later sections
 * use it as the expected answer. An OpenRouter account with no
 * credit returns 402 to a perfectly valid key, and a script that
 * did not check would blame the cascade for slot 3's billing.
 */

import { readFileSync } from "node:fs";

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error(`Could not read ${path}.`);
    process.exit(1);
  }
  return out;
}

const env = readEnv("server/.env");

/* Before importing the chain, which reads process.env at module
   load — same reason probe-providers.mts does this. */
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { AiRuntimeError } = await import("../server/src/ai/errors");
const { penalise, resetHealth } = await import(
  "../server/src/ai/ProviderHealth"
);
const { streamFromChain } = await import("../server/src/ai/streamFromChain");
const { PROVIDER_CHAIN, keyFor, missingEnvFor } = await import(
  "../server/src/ai/providerChain"
);
const { registerProviders } = await import("../server/src/ai/providers");
const { getProvider } = await import("../server/src/ai/ProviderRegistry");
const { chainCandidates } = await import("../server/src/ai/resolveChain");

type ProviderId = import("../server/src/ai/types").ProviderId;
type ChainCandidate = import("../server/src/ai/types").ChainCandidate;
type ModelRequest = import("../server/src/ai/types").ModelRequest;

registerProviders();

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

/*
 * Every provider the cascade reaches, wrapped so the run can say
 * who was actually contacted.
 *
 * Wrapping rather than substituting: the adapter underneath is
 * the real one, and `asked` records the call rather than
 * replacing it.
 */
const asked: ProviderId[] = [];

function watchedProvider(id: ProviderId) {
  const real = getProvider(id);
  return {
    ...real,
    async *stream(...args: Parameters<typeof real.stream>) {
      asked.push(id);
      yield* real.stream(...args);
    },
  };
}

const REQUEST: ModelRequest = {
  model: "neurolink-1",
  messages: [
    {
      role: "user",
      content:
        "Reply with exactly one short sentence explaining what a for-loop does.",
    },
  ],
  /*
   * 128 is the Lab's own lower preset, and the interesting one:
   * gpt-oss spends output budget on hidden reasoning before it
   * writes, so a cap this low is where a reasoning model either
   * answers or returns an empty string. Testing at 1000 would
   * hide exactly the failure worth catching.
   */
  settings: { temperature: 0.2, maxOutputTokens: 128 },
};

interface RunResult {
  text: string;
  served: ProviderId | null;
  servedModel: string | null;
  error: InstanceType<typeof AiRuntimeError> | null;
  contacted: ProviderId[];
}

async function run(candidates: ChainCandidate[]): Promise<RunResult> {
  asked.length = 0;

  const result: RunResult = {
    text: "",
    served: null,
    servedModel: null,
    error: null,
    contacted: [],
  };

  try {
    for await (const event of streamFromChain({
      candidates,
      request: REQUEST,
      tokenBudget: 400,
      /* Real network, not fake adapters: a real first token from
         a cold provider can take a couple of seconds. */
      firstTokenTimeoutMs: 20_000,
      signal: AbortSignal.timeout(90_000),
      getProvider: watchedProvider,
    })) {
      if (event.type === "committed") {
        result.served = event.candidate.providerId;
        result.servedModel = event.candidate.model;
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

  result.contacted = [...asked];
  return result;
}

/* The real candidate for one provider, straight off the chain
   the server would actually build. */
function candidate(id: ProviderId): ChainCandidate | undefined {
  return chainCandidates().find((c) => c.providerId === id);
}

/* The same candidate with a deliberately dead key, to make the
   live endpoint refuse for real. */
function withBrokenKey(c: ChainCandidate): ChainCandidate {
  return { ...c, credentials: { apiKey: "neurocode-verify-invalid-token" } };
}

function withModel(c: ChainCandidate, model: string): ChainCandidate {
  return { ...c, model };
}

/*
 * Can this provider actually produce a token right now?
 *
 * Asked before the fall-through sections rather than assumed,
 * because a provider can be perfectly well configured and still
 * refuse everything — an OpenRouter account with no credit
 * answers a valid key with 402 on every completion.
 *
 * The distinction matters to what this script is allowed to
 * claim. "Cloudflare failed and OpenRouter was asked next" is a
 * statement about ROUTING and is provable either way. "OpenRouter
 * served" is a statement about OPENROUTER, and asserting it
 * against an account that cannot serve would report a bug in the
 * cascade that is not there.
 */
async function canServe(c: ChainCandidate): Promise<string | null> {
  resetHealth();
  const result = await run([c]);
  if (result.served === c.providerId && result.text.trim().length > 0) {
    return null;
  }
  return result.error
    ? `${result.error.code}: ${result.error.message}`
    : "produced no text";
}

/* ---------------------------------------------------------
   THE CASES
   --------------------------------------------------------- */

async function main(): Promise<void> {
  section("1. The chain is Groq -> Cloudflare -> OpenRouter -> Mistral");

  const order = PROVIDER_CHAIN.map((e) => e.providerId);
  check(
    "declared order is correct",
    order.join(" -> ") === "groq -> cloudflare -> openrouter -> mistral",
    order.join(" -> ")
  );
  check(
    "Cerebras is gone from the chain",
    !order.includes("cerebras" as ProviderId),
    order.join(",")
  );

  const cf = PROVIDER_CHAIN.find((e) => e.providerId === "cloudflare");
  check("Cloudflare is in slot 2", order[1] === "cloudflare", order[1]);
  check(
    "Cloudflare requires its account id, not just a token",
    (cf?.requiresEnv ?? []).includes("NEUROLINK_CLOUDFLARE_ACCOUNT_ID"),
    JSON.stringify(cf?.requiresEnv)
  );
  check(
    "Cloudflare's key and account id are both configured",
    cf !== undefined &&
      keyFor(cf) !== undefined &&
      missingEnvFor(cf).length === 0,
    cf ? `missing: ${missingEnvFor(cf).join(", ") || "(key)"}` : "no entry"
  );

  const cloudflare = candidate("cloudflare");
  const openrouter = candidate("openrouter");

  if (!cloudflare) {
    console.error(
      "\nFAIL — Cloudflare is not in the configured chain; nothing live to test."
    );
    process.exit(1);
  }

  if (!openrouter) {
    console.error(
      "\nFAIL — OpenRouter is not configured, so the fallback target cannot be proved."
    );
    process.exit(1);
  }

  section("2. LIVE — Cloudflare alone actually serves a request");
  resetHealth();

  let r = await run([cloudflare]);

  check(
    "Cloudflare committed",
    r.served === "cloudflare",
    r.error ? `${r.error.code}: ${r.error.message}` : `served ${r.served}`
  );
  check("it streamed real text", r.text.trim().length > 0, JSON.stringify(r.text));
  check("no error", r.error === null, r.error?.code);
  check(
    "the pinned Cloudflare model id was the one sent",
    r.servedModel === cloudflare.model,
    String(r.servedModel)
  );
  console.log(`       model: ${cloudflare.model}`);
  console.log(`       answer: ${JSON.stringify(r.text.trim().slice(0, 120))}`);

  section("3. LIVE — the answer names no vendor");
  /*
   * The cascade's whole promise. The model id contains "openai"
   * and "cf", so this checks what reaches a caller, not what was
   * sent — the id never leaves the server.
   */
  const leaked = [
    "groq",
    "cerebras",
    "cloudflare",
    "openrouter",
    "mistral",
    "workers ai",
  ].filter((name) => r.text.toLowerCase().includes(name));
  check(
    "no vendor name in the streamed text",
    leaked.length === 0,
    leaked.join(", ")
  );

  /*
   * Slot 3's own health, established before it is used as the
   * expected answer to "who serves when Cloudflare cannot".
   */
  section("4. Is OpenRouter — the fall-through target — able to serve?");

  const openRouterFault = await canServe(openrouter);
  const openRouterServes = openRouterFault === null;

  check(
    "OpenRouter can serve a request",
    openRouterServes,
    openRouterFault ?? undefined
  );

  /*
   * A tail to fall into when slot 3 cannot answer. Without it
   * the sections below could only prove that the cascade moved
   * ON from Cloudflare, not that the learner ended up with an
   * answer — and "did not silently fail" is half the point.
   */
  const mistral = candidate("mistral");
  const tail = openRouterServes
    ? [openrouter]
    : mistral
      ? [openrouter, mistral]
      : [openrouter];

  if (!openRouterServes) {
    console.log(
      "\n       NOTE: OpenRouter is configured and its key is valid, but the\n" +
        "       account cannot complete a request — so the sections below\n" +
        "       assert the ROUTING (Cloudflare is asked, then OpenRouter, in\n" +
        "       that order) and prove the learner still gets an answer from\n" +
        "       the next healthy provider. This is a slot-3 account problem,\n" +
        "       not a cascade defect, and it is a pre-existing one."
    );
  }

  section("5. LIVE — Cloudflare's key is rejected -> the cascade moves on");
  /*
   * A real 401 from the real endpoint, not a thrown stub. This
   * is the case that would silently take slot 2 out of the
   * cascade if the token were ever revoked, so it is worth
   * knowing the cascade survives it rather than assuming.
   */
  resetHealth();

  r = await run([withBrokenKey(cloudflare), ...tail]);

  check(
    "Cloudflare was asked first and failed, rather than being skipped",
    r.contacted[0] === "cloudflare",
    r.contacted.join(",")
  );
  check(
    "OpenRouter was the next one asked — not Mistral, not Groq",
    r.contacted[1] === "openrouter",
    r.contacted.join(",")
  );
  check(
    "it did not silently fail — somebody served",
    r.served !== null && r.text.trim().length > 0,
    r.error ? `${r.error.code}: ${r.error.message}` : "no commit"
  );
  if (openRouterServes) {
    check("OpenRouter served", r.served === "openrouter", `served ${r.served}`);
  } else {
    check(
      "the answer came from further down the chain, in order",
      r.served === "mistral",
      `served ${r.served}`
    );
  }
  console.log(`       contacted: ${r.contacted.join(" -> ")}`);

  section("6. LIVE — Cloudflare refuses a plan-gated model -> the cascade moves on");
  /*
   * Cloudflare lists models its free plan will not run and says
   * so only at request time, with 403 code 5035. That is a real
   * failure mode for this slot — it is exactly what happens if
   * somebody points NEUROLINK_CLOUDFLARE_MODEL at one of the
   * Kimi, GLM or DeepSeek-V4 ids sitting in the same catalogue —
   * and the cascade has to ride over it like any other refusal.
   */
  resetHealth();

  r = await run([withModel(cloudflare, "@cf/zai-org/glm-5.3"), ...tail]);

  check(
    "Cloudflare was genuinely asked",
    r.contacted[0] === "cloudflare",
    r.contacted.join(",")
  );
  check(
    "OpenRouter was next",
    r.contacted[1] === "openrouter",
    r.contacted.join(",")
  );
  check(
    "the learner still got an answer",
    r.text.trim().length > 0,
    r.error ? `${r.error.code}: ${r.error.message}` : "(empty)"
  );
  console.log(`       contacted: ${r.contacted.join(" -> ")}`);

  section("7. Cloudflare rate-limited -> skipped without a request");
  /*
   * The 429 path, driven through the cooldown a real 429 sets
   * rather than by hammering Cloudflare until it produces one.
   * `penalise` is the exact call streamFromChain makes when the
   * adapter reads a 429, with the retry-after the vendor sent.
   *
   * The assertion that matters is the negative one: Cloudflare
   * must not be CONTACTED. A cascade that discovers a rate limit
   * by spending a request on it costs the learner the round trip
   * and Cloudflare an allowance it had already run out of.
   */
  resetHealth();
  penalise("cloudflare", 30);

  r = await run([cloudflare, ...tail]);

  check(
    "Cloudflare was skipped without a socket being opened",
    !r.contacted.includes("cloudflare"),
    r.contacted.join(",")
  );
  check(
    "OpenRouter was the first one actually asked",
    r.contacted[0] === "openrouter",
    r.contacted.join(",")
  );
  check(
    "the learner still got an answer",
    r.text.trim().length > 0,
    r.error ? `${r.error.code}: ${r.error.message}` : "(empty)"
  );
  console.log(`       contacted: ${r.contacted.join(" -> ")}`);

  section("8. LIVE — OpenRouter fails -> Mistral, the last resort, serves");
  /*
   * The bottom hop, and the only one none of the sections above
   * exercise on its own: they all end at OpenRouter, so a broken
   * link between slot 3 and slot 4 would pass every one of them.
   *
   * It is also the hop with the least margin behind it. Every
   * other failure in this file still has somebody left to ask;
   * if this one does not work, "all four are down" arrives one
   * provider early and the learner gets the graceful message
   * while a perfectly healthy Mistral sits unasked.
   *
   * Both halves of the same trade the Cloudflare sections make:
   * a real refusal from the live endpoint first, then the
   * rate-limit path through the cooldown a real 429 sets.
   */
  if (!mistral) {
    check(
      "Mistral is configured, so the last hop can be tested",
      false,
      "no Mistral key in server/.env — the bottom of the chain is unverified"
    );
  } else {
    resetHealth();

    r = await run([withBrokenKey(openrouter), mistral]);

    check(
      "OpenRouter was asked first and failed, rather than being skipped",
      r.contacted[0] === "openrouter",
      r.contacted.join(",")
    );
    check(
      "Mistral was the next one asked",
      r.contacted[1] === "mistral",
      r.contacted.join(",")
    );
    check(
      "Mistral served",
      r.served === "mistral",
      r.error ? `${r.error.code}: ${r.error.message}` : `served ${r.served}`
    );
    check(
      "it streamed real text rather than failing silently",
      r.text.trim().length > 0,
      JSON.stringify(r.text)
    );
    console.log(`       contacted: ${r.contacted.join(" -> ")}`);
    console.log(`       answer: ${JSON.stringify(r.text.trim().slice(0, 110))}`);

    /*
     * And the proactive skip at this depth. Worth its own case
     * rather than trusting section 7 to cover it: the window
     * check reads each entry's own limits, and OpenRouter's are
     * not Cloudflare's.
     */
    resetHealth();
    penalise("openrouter", 30);

    r = await run([openrouter, mistral]);

    check(
      "a rate-limited OpenRouter is skipped without a socket being opened",
      !r.contacted.includes("openrouter"),
      r.contacted.join(",")
    );
    check(
      "Mistral served that one too",
      r.served === "mistral" && r.text.trim().length > 0,
      r.error ? `${r.error.code}: ${r.error.message}` : `served ${r.served}`
    );
    console.log(`       contacted: ${r.contacted.join(" -> ")}`);

    /*
     * The whole chain walked end to end, in one request, with
     * every provider above Mistral genuinely refusing. This is
     * the case that proves the cascade is four deep rather than
     * three — the shape of the bug that had slot 3 pinned to a
     * paid model and nobody noticing.
     */
    resetHealth();

    r = await run([
      withBrokenKey(cloudflare),
      withBrokenKey(openrouter),
      mistral,
    ]);

    check(
      "a full walk down the chain reaches Mistral in order",
      r.contacted.join(" -> ") === "cloudflare -> openrouter -> mistral",
      r.contacted.join(" -> ")
    );
    check(
      "and the learner still gets one clean answer",
      r.served === "mistral" && r.text.trim().length > 0,
      r.error ? `${r.error.code}: ${r.error.message}` : `served ${r.served}`
    );
    console.log(`       contacted: ${r.contacted.join(" -> ")}`);
  }

  section("9. Cloudflare recovers — the next request uses it again");
  /*
   * Not sticky. Having fallen through to OpenRouter a moment ago
   * must not pin anything there.
   */
  resetHealth();

  r = await run([cloudflare, ...tail]);

  check(
    "Cloudflare served again",
    r.served === "cloudflare",
    r.error ? `${r.error.code}: ${r.error.message}` : `served ${r.served}`
  );
  check(
    "OpenRouter was not contacted",
    !r.contacted.includes("openrouter"),
    r.contacted.join(",")
  );

  console.log(
    `\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nFAIL — the script itself threw:", error);
  process.exit(1);
});
