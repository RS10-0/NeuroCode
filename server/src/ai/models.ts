import { configuredChain } from "./providerChain";
import type { ModelDescriptor } from "./types";

/*
 * The model catalogue — which is now a catalogue of one.
 *
 * There used to be seven entries here, each naming a vendor and
 * a version, because a learner picked one. Under the cascade
 * nobody picks: the router chooses a provider per request, from
 * the top of the chain, every time. A picker offering "Gemini
 * 3.5 Flash Lite" would be offering something the router is free
 * to ignore a second later, and a telemetry strip naming the
 * winner would be telling the learner the one thing the whole
 * design keeps private.
 *
 * So the product has one AI, it is called BuildGentic, and this is
 * its entry. The concrete model ids live in providerChain.ts,
 * server-side, and never appear in a response.
 *
 * This is still the allowlist. A client-supplied model id that
 * is not in this array never reaches a provider — there is now
 * exactly one id it can be.
 */

export const PUBLIC_MODEL_ID = "neurolink-1";

/*
 * Sized to the smallest member of the chain rather than the
 * largest, and that is the only defensible choice: any of the
 * four may answer, so a limit only three of them honour is not
 * a limit. Both numbers are conservative for the same reason.
 *
 * The context window is what the Lab's token estimator draws its
 * "you have used 3% of the window" bar against, so being wrong
 * high here would let a learner build a prompt that one provider
 * accepts and the next refuses — the exact non-determinism the
 * cascade is supposed to hide.
 */
const CONTEXT_WINDOW = 128_000;
const MAX_OUTPUT_TOKENS = 8_192;

/*
 * Whether BuildGentic can be shown a picture.
 *
 * Derived rather than declared, and derived pessimistically: it
 * is true only when EVERY configured provider can see images.
 * Routing is not sticky, so a learner who attaches a photograph
 * has no idea which of the four will answer — and "the agent
 * describes an image it never received" is the single worst
 * failure File Analysis can have, because it is silent.
 *
 * With the text-only defaults in providerChain.ts this is false,
 * and that is the honest outcome: PDFs, documents and
 * spreadsheets all still work, because that extraction is local.
 * An image gets a sentence saying it cannot be looked at.
 */
function chainCanSee(): boolean {
  const configured = configuredChain();

  return configured.length > 0 && configured.every((entry) => entry.vision);
}

function publicModel(): ModelDescriptor {
  return {
    id: PUBLIC_MODEL_ID,
    displayName: "BuildGentic",
    blurb: "BuildGentic's AI. Fast, and free to use with your daily XP.",
    contextWindow: CONTEXT_WINDOW,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 1024,
    vision: chainCanSee(),
  };
}

/*
 * Every model a learner can name. One, always — including on a
 * clone with no keys at all, where the mock answers to the same
 * id rather than introducing a second one. "Which model am I on"
 * is not a question this product asks anybody to hold.
 */
export function allModels(): ModelDescriptor[] {
  return [publicModel()];
}

/*
 * Null for anything not in the catalogue — the only honest
 * answer for an id the server has never heard of, and the reason
 * an unknown model is a 400 rather than a provider error the
 * learner cannot act on.
 */
export function findModel(id: unknown): ModelDescriptor | null {
  return id === PUBLIC_MODEL_ID ? publicModel() : null;
}

/* The model used when the caller names none, which is now every
   caller — nothing in the UI sends a model id any more. */
export function defaultModel(): ModelDescriptor {
  return publicModel();
}
