/*
 * Asks each cascade provider what it can actually serve.
 *
 * The model ids in server/src/ai/providerChain.ts are defaults
 * chosen from each vendor's published catalogue, and vendors
 * retire ids on their own schedule. A stale one is a 404 on
 * every request that reaches that provider — which the cascade
 * hides, so it shows up as "the fallback is always firing"
 * rather than as an error anybody notices.
 *
 * This is the check. It reads server/.env, calls each
 * provider's /models endpoint with the key it finds, and says
 * whether the configured id is on the list.
 *
 * Nothing here generates a token, so it costs nothing to run.
 *
 *   npx tsx ./scripts/probe-providers.mts
 *
 * Also verifies the embedding endpoint, which does NOT go
 * through the cascade — see the EMBEDDINGS section of
 * server/.env.example.
 */

import { readFileSync } from "node:fs";

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};

  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error(`Could not read ${path}.`);
    process.exit(1);
  }

  return out;
}

const env = readEnv("server/.env");

/*
 * Push server/.env into this process before importing the chain.
 *
 * providerChain.ts reads its keys and model overrides straight
 * from process.env, and it is imported below rather than
 * duplicated — an earlier version of this script kept its own
 * copy of the default model ids and promptly reported two of
 * them as broken after they had already been fixed. A probe that
 * can disagree with the thing it is probing is worse than no
 * probe.
 */
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const { PROVIDER_CHAIN } = await import("../server/src/ai/providerChain");

interface Target {
  name: string;
  keyEnv: string[];
  modelEnv: string;
  /*
   * Undefined when the vendor needs configuration this script
   * cannot assemble — Cloudflare's catalogue lives under an
   * account id, so with that variable unset there is no URL to
   * probe rather than a URL that will fail.
   */
  modelsUrl: string | undefined;
  /* Named when modelsUrl came out undefined, so the line this
     prints says which variable is missing. */
  needsEnv?: string;
  /* Some vendors nest the list differently. */
  pick: (body: unknown) => string[];
}

/* The id the runtime would actually send, straight off the
   chain. Never a second copy. */
function configuredModel(providerId: string): string {
  return (
    PROVIDER_CHAIN.find((entry) => entry.providerId === providerId)?.model ?? ""
  );
}

/*
 * Cloudflare answers with `{result: [{name}]}` rather than the
 * `{data: [{id}]}` every other vendor here uses — its catalogue
 * endpoint is part of the general Cloudflare REST API, not of
 * the OpenAI-compatible surface the completions call uses.
 */
const cloudflareShape = (body: unknown): string[] => {
  const result = (body as { result?: Array<{ name?: string }> })?.result;
  return Array.isArray(result)
    ? result.map((entry) => entry.name ?? "").filter(Boolean)
    : [];
};

const openAiShape = (body: unknown): string[] => {
  const data = (body as { data?: Array<{ id?: string }> })?.data;
  return Array.isArray(data)
    ? data.map((entry) => entry.id ?? "").filter(Boolean)
    : [];
};

const TARGETS: Target[] = [
  {
    name: "groq",
    keyEnv: ["NEUROLINK_GROQ_API_KEY"],
    modelEnv: "NEUROLINK_GROQ_MODEL",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    pick: openAiShape,
  },
  {
    name: "cloudflare",
    keyEnv: ["NEUROLINK_CLOUDFLARE_API_TOKEN"],
    modelEnv: "NEUROLINK_CLOUDFLARE_MODEL",
    /*
     * Filtered to text generation, which is the only task the
     * cascade can pin a model from, and capped high enough to
     * return that whole list in one page.
     *
     * WHAT THIS CANNOT SEE: part of Cloudflare's catalogue is
     * listed but gated behind a paid Workers plan, and asking
     * for one of those returns `403 {"code":5035}` at request
     * time. Presence on this list is necessary and not
     * sufficient — verify-provider-cloudflare.mts is what
     * actually asks the model to answer.
     */
    modelsUrl: env.NEUROLINK_CLOUDFLARE_ACCOUNT_ID
      ? `https://api.cloudflare.com/client/v4/accounts/${env.NEUROLINK_CLOUDFLARE_ACCOUNT_ID}/ai/models/search?task=Text%20Generation&per_page=100`
      : undefined,
    needsEnv: "NEUROLINK_CLOUDFLARE_ACCOUNT_ID",
    pick: cloudflareShape,
  },
  {
    name: "openrouter",
    keyEnv: ["NEUROLINK_OPENROUTER_API_KEY", "NEUROLINK_FREE_API_KEY"],
    modelEnv: "NEUROLINK_OPENROUTER_MODEL",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    pick: openAiShape,
  },
  {
    name: "mistral",
    keyEnv: ["NEUROLINK_MISTRAL_API_KEY"],
    modelEnv: "NEUROLINK_MISTRAL_MODEL",
    modelsUrl: "https://api.mistral.ai/v1/models",
    pick: openAiShape,
  },
];

function keyFor(target: Target): string | undefined {
  for (const name of target.keyEnv) {
    if (env[name]) return env[name];
  }
  return undefined;
}

let problems = 0;

async function probe(target: Target): Promise<void> {
  const key = keyFor(target);
  const wanted = configuredModel(target.name);

  if (!key) {
    console.log(
      `  --   ${target.name.padEnd(11)} no key (${target.keyEnv[0]}) — not in the chain`
    );
    return;
  }

  if (!target.modelsUrl) {
    /*
     * A key with its other required variable missing. Counted as
     * a problem rather than skipped: providerChain.ts holds this
     * provider out of the cascade in exactly this state, so a
     * quiet "--" would describe a working chain when the chain
     * is one variable short of working.
     */
    problems += 1;
    console.log(
      `  FAIL ${target.name.padEnd(11)} key is set but ${target.needsEnv} is not — held out of the chain`
    );
    return;
  }

  let response: Response;

  try {
    response = await fetch(target.modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (error) {
    problems += 1;
    console.log(
      `  FAIL ${target.name.padEnd(11)} unreachable — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  if (!response.ok) {
    problems += 1;
    console.log(
      `  FAIL ${target.name.padEnd(11)} HTTP ${response.status} from /models — key rejected or endpoint moved`
    );
    return;
  }

  const ids = target.pick(await response.json());

  if (ids.includes(wanted)) {
    console.log(`  ok   ${target.name.padEnd(11)} serves "${wanted}"`);
    return;
  }

  problems += 1;

  /* Near misses first — a retirement usually leaves a sibling
     with a very similar name, and that is the replacement. */
  const stem = wanted.split(/[-/]/)[0];
  const near = ids.filter((id) => id.includes(stem)).slice(0, 6);

  console.log(
    `  FAIL ${target.name.padEnd(11)} does NOT serve "${wanted}"`
  );
  console.log(
    `       ${near.length ? `closest: ${near.join(", ")}` : `${ids.length} models available`}`
  );
  console.log(
    `       fix: set ${target.modelEnv} in server/.env, or edit server/src/ai/providerChain.ts`
  );
}

/* ---------------------------------------------------------
   EMBEDDINGS

   Not part of the cascade, and checked separately for exactly
   that reason: chat can fall through four providers, and an
   embedding has nowhere to fall.
   --------------------------------------------------------- */

async function probeEmbeddings(): Promise<void> {
  const key = env.NEUROLINK_GEMINI_API_KEY;

  if (!key) {
    console.log(
      "  --   embeddings  no NEUROLINK_GEMINI_API_KEY — knowledge and memory fall back to the offline hash embedder"
    );
    return;
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: { parts: [{ text: "probe" }] },
          outputDimensionality: 768,
        }),
      }
    );

    if (!response.ok) {
      problems += 1;
      console.log(
        `  FAIL embeddings  HTTP ${response.status} — knowledge retrieval and agent memory will not index`
      );
      return;
    }

    const body = (await response.json()) as {
      embedding?: { values?: number[] };
    };
    const width = body.embedding?.values?.length ?? 0;

    if (width === 768) {
      console.log("  ok   embeddings  768 dimensions, matching the columns");
    } else {
      problems += 1;
      console.log(
        `  FAIL embeddings  returned ${width} dimensions, but agent_knowledge_chunks and agent_memories are vector(768)`
      );
    }
  } catch (error) {
    problems += 1;
    console.log(
      `  FAIL embeddings  unreachable — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/*
 * The candidate replacement: OpenRouter's own embeddings
 * endpoint, asked for text-embedding-3-small truncated to 768.
 *
 * Kept separate from the check above because it answers a
 * different question — not "is the current path healthy" but
 * "can we move off Google yet". The distinction that matters is
 * 402 vs 404:
 *
 *   404 / 400  the endpoint or the model is not served, and the
 *              plan to move embeddings here does not work.
 *   402        it IS served, authenticated fine, and refused
 *              only for want of credit. Nothing is proven about
 *              the vector width until there is credit to spend.
 *   200        the only outcome that settles it. The width
 *              printed here is the number that has to be 768,
 *              because agent_knowledge_chunks and agent_memories
 *              are fixed-width columns and a mismatch fails
 *              every insert.
 */
async function probeOpenRouterEmbeddings(): Promise<void> {
  const key =
    env.NEUROLINK_OPENROUTER_API_KEY || env.NEUROLINK_FREE_API_KEY;

  if (!key) {
    console.log("  --   or-embed    no OpenRouter key to test with");
    return;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: "probe",
        dimensions: 768,
      }),
    });

    if (response.status === 402) {
      console.log(
        "  ??   or-embed    endpoint exists and authenticated, but the account has no credit."
      );
      console.log(
        "       The vector width is UNVERIFIED. Add credit and re-run before moving embeddings here."
      );
      return;
    }

    if (response.status === 404 || response.status === 400) {
      console.log(
        `  FAIL or-embed    HTTP ${response.status} — OpenRouter does not serve this model on /embeddings.`
      );
      console.log(
        "       Embeddings cannot move here. Keep the current provider, or use a direct OpenAI key."
      );
      problems += 1;
      return;
    }

    if (!response.ok) {
      console.log(`  FAIL or-embed    HTTP ${response.status}`);
      problems += 1;
      return;
    }

    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const width = body.data?.[0]?.embedding?.length ?? 0;

    if (width === 768) {
      console.log(
        "  ok   or-embed    768 dimensions confirmed — safe to move embeddings to OpenRouter."
      );
    } else {
      console.log(
        `  FAIL or-embed    returned ${width} dimensions, not 768. Moving here would need a migration and a re-index.`
      );
      problems += 1;
    }
  } catch (error) {
    console.log(
      `  FAIL or-embed    unreachable — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    problems += 1;
  }
}

async function main(): Promise<void> {
  console.log("\nProvider cascade — what each one actually serves\n");

  for (const target of TARGETS) {
    await probe(target);
  }

  console.log("");
  await probeEmbeddings();
  await probeOpenRouterEmbeddings();

  console.log(
    `\n${problems === 0 ? "PASS" : `${problems} problem(s)`} — nothing was generated, so this cost nothing.\n`
  );

  process.exit(problems === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
