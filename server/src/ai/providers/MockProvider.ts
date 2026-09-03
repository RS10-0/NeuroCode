import { AiRuntimeError } from "../errors";
import { estimateTokens } from "../tokens";
import type {
  AiProvider,
  CredentialCheck,
  EmbeddingRequest,
  EmbeddingResult,
  ModelRequest,
  ProviderCredentials,
  ProviderStreamEvent,
} from "../types";

/*
 * The offline provider.
 *
 * It exists so that BuildGentic works on a fresh clone with an
 * empty .env: the runtime, the routes, the streaming transport
 * and the usage table can all be exercised end to end without a
 * key and without spending anything.
 *
 * Deterministic on purpose — the reply is chosen by hashing the
 * request, so the same prompt gives the same answer every time.
 * A test that asserts on model output is otherwise a test that
 * fails on a Tuesday.
 *
 * It is not a product model and is never offered while a real
 * platform key is configured. See PowerSourceResolver.
 */

/* FNV-1a. Small, stable, and not used for anything security-shaped. */
function hash(text: string): number {
  let value = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }

  return value >>> 0;
}

const REPLIES = [
  "Here is the short version: a language model does not look anything up. It predicts the next piece of text, one piece at a time, from the patterns it saw during training. That is why it can be fluent and wrong in the same sentence — fluency and accuracy come from different places.",

  "Think of the prompt as the whole world the model can see. It has no memory of your last message unless you send it again, no access to your files, and no way to check a fact against reality. Everything it uses to answer is in the text you just handed it.",

  "Two things change the answer more than anything else: what you ask for, and how much freedom you leave. Tighten the instruction and the output narrows. Raise the temperature and the same instruction starts to wander. Change one at a time or you will not know which one moved.",

  "A useful habit: write the prompt, read the answer, then ask what in the prompt made that answer possible. Usually it is one vague word doing too much work. Replace it with something specific and run it again.",
];

/*
 * A small deterministic drift so that changing temperature
 * visibly changes the output, the way it does on a real model.
 * The Lab is going to teach exactly this, and a mock that
 * ignored the setting would teach the opposite.
 */
const TEMPERATURE_TAILS = [
  "",
  " In practice, start strict and loosen only if the answer is too narrow.",
  " Try it three times and watch how much the wording moves.",
];

export const mockProvider: AiProvider = {
  id: "mock",
  displayName: "BuildGentic Mock",

  /* No credentials to be missing. */
  isConfigured() {
    return true;
  },

  /* Nothing to check, and nothing that could fail. Present so the
     mock satisfies the same contract every other adapter does. */
  async validateCredentials(): Promise<CredentialCheck> {
    return { valid: true };
  },

  async *stream(
    request: ModelRequest,
    _credentials: ProviderCredentials,
    signal: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent> {
    const lastUser = request.messages[request.messages.length - 1];

    if (!lastUser) {
      /*
       * Unreachable through the routes — validation guarantees a
       * trailing user turn — but an adapter that assumed it and
       * threw a TypeError would surface as internal_error rather
       * than as the real problem.
       */
      throw new AiRuntimeError(
        "invalid_request",
        "The conversation has no user message to answer."
      );
    }

    const seed = hash(
      `${request.model}|${request.system ?? ""}|${lastUser.content}`
    );

    const reply =
      REPLIES[seed % REPLIES.length] +
      TEMPERATURE_TAILS[
        Math.min(
          TEMPERATURE_TAILS.length - 1,
          Math.floor(request.settings.temperature * 1.5)
        )
      ];

    /* Word by word, so the transport is genuinely streaming. */
    const pieces = reply.match(/\S+\s*/g) ?? [reply];

    let emitted = "";
    let truncated = false;

    for (const piece of pieces) {
      if (signal.aborted) {
        yield { type: "done", finishReason: "cancelled" };
        return;
      }

      if (
        estimateTokens(emitted + piece) > request.settings.maxOutputTokens
      ) {
        truncated = true;
        break;
      }

      emitted += piece;

      /*
       * A real network arrives in gaps. Without one the whole
       * reply lands in a single tick and "does it stream?"
       * becomes untestable.
       */
      await sleep(12, signal);

      yield { type: "delta", text: piece };
    }

    yield {
      type: "done",
      finishReason: truncated ? "length" : "stop",
      usage: {
        inputTokens: estimateTokens(
          (request.system ?? "") +
            request.messages.map((m) => m.content).join("")
        ),
        outputTokens: estimateTokens(emitted),
        /* Estimated, and honest about it. */
        reported: false,
      },
    };
  },

  /* Neither credentials nor a signal are taken: there is no key
     to check and nothing to abort, and naming parameters an
     implementation cannot use is how a mock starts pretending. */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    return {
      vectors: request.texts.map((text) =>
        embedOne(text, request.dimensions)
      ),
      /* No provider to report anything, so the runtime's own
         estimate stands and the usage row says `reported:
         false`. */
    };
  },
};

/* =========================================================
   MOCK EMBEDDINGS

   The offline half of knowledge retrieval, and the reason the
   whole capability can be exercised on a clone with no API key.

   It is a hashing trick over a bag of words: each token lands
   in a couple of dimensions, with a hashed sign so collisions
   cancel rather than accumulate. That is not a language model
   and it understands nothing — but the similarity it produces
   is real lexical similarity, which means a physics question
   genuinely does retrieve the physics chunk and genuinely does
   not retrieve the history one. A mock that returned random
   numbers would make every retrieval test meaningless while
   still passing.

   Deterministic, like everything else in this file: the same
   text always produces the same vector, so a test that asserts
   on ranking is not a test that fails on a Tuesday.
========================================================= */

/*
 * Words carried by every text in every language sample, which
 * therefore separate nothing.
 *
 * Without this list the commonest tokens dominate both vectors
 * and every chunk looks mildly relevant to every question —
 * which is the exact failure the similarity floor exists to
 * prevent, arriving from the other direction.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
  "had", "her", "was", "one", "our", "out", "day", "get", "has", "him",
  "his", "how", "its", "may", "new", "now", "old", "see", "two", "way",
  "who", "boy", "did", "use", "man", "men", "put", "say", "she", "too",
  "with", "that", "this", "from", "they", "will", "what", "when", "your",
  "have", "been", "were", "them", "then", "than", "some", "into", "only",
  "over", "such", "also", "more", "most", "other", "which", "there",
  "their", "these", "those", "would", "could", "should", "about", "after",
  "where", "while", "does", "each", "much", "very", "just", "like",
]);

/*
 * Crude, on purpose. "laws" and "law" should land in the same
 * dimension; a real stemmer would be a dependency and a page of
 * rules for a mock.
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (token.length > suffix.length + 3 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }

  return token;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map(stem);
}

/* FNV-1a again, with a seed so one token can reach several
   dimensions independently. */
function seededHash(text: string, seed: number): number {
  let value = (0x811c9dc5 ^ seed) >>> 0;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }

  return value >>> 0;
}

/*
 * How many distinct terms a single text may contribute.
 *
 * Cosine between a four-word question and a two-hundred-word
 * passage is low for a purely geometric reason: the long text's
 * vector is spread across far more dimensions, so even a
 * perfect topical match scores badly. Capping both sides at the
 * same number of terms — the most frequent ones, which are the
 * topical ones — puts mock similarities on roughly the scale a
 * real embedding model produces, so one similarity floor is
 * meaningful for both.
 */
const MAX_TERMS = 40;

function embedOne(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const counts = new Map<string, number>();

  const tokens = tokenize(text);

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  /* Adjacent pairs, at a lower weight. They are what tell
     "second law" apart from a text that happens to contain both
     words a paragraph apart. */
  for (let index = 1; index < tokens.length; index += 1) {
    const pair = `${tokens[index - 1]} ${tokens[index]}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  const terms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TERMS);

  for (const [term, count] of terms) {
    /* Sub-linear: a word repeated ten times is not ten times
       as much evidence. */
    const weight = (1 + Math.log(count)) * (term.includes(" ") ? 0.6 : 1);

    for (let seed = 0; seed < 2; seed += 1) {
      const hashed = seededHash(term, seed);
      const slot = hashed % dimensions;
      /* A hashed sign, so two terms colliding in one dimension
         cancel as often as they reinforce. */
      const sign = (hashed >>> 16) % 2 === 0 ? 1 : -1;

      vector[slot] += sign * weight;
    }
  }

  return vector;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }

    /* Abort resolves rather than rejects; the loop checks
       `signal.aborted` and ends the stream cleanly. */
    signal.addEventListener("abort", finish, { once: true });
  });
}
