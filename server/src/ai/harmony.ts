/*
 * Control tokens that were never meant to be read by a person.
 *
 * gpt-oss does not speak plain text internally. It speaks
 * "harmony" — a wire format where every message carries a role,
 * a channel and sometimes a recipient, all of them written as
 * special tokens the serving layer is supposed to consume before
 * anything reaches an API client:
 *
 *   <|start|>assistant<|channel|>final<|message|>The answer<|return|>
 *   <|start|>assistant<|channel|>commentary to=functions.get_weather
 *     <|constrain|>json<|message|>{"city":"Oslo"}<|call|>
 *
 * Slots 1 and 2 of the cascade are both gpt-oss-120b, on two
 * different vendors, and sometimes the serving layer does not
 * consume them. The header arrives as ordinary `delta.content`
 * and everything downstream treats it as prose.
 *
 * WHAT THAT COST, because it is not hypothetical and it is not
 * cosmetic. A scheduled digest went out to its owner's inbox
 * reading:
 *
 *   <|start|>assistant<|channel|>commentary to=I'm sorry—I don't
 *   have enough current, dated sources
 *
 * The apology underneath was correct and well-judged. The line
 * above it made the whole email look like something had crashed,
 * on the one surface in this product where nobody can open the
 * app and check — and the word the model was mid-way through
 * writing was eaten by the header it was tangled in.
 *
 * WHY STRIP RATHER THAN FAIL THE ATTEMPT. A leaked header is not
 * a broken answer; it is a correct answer with a wrapper left on.
 * Abandoning the provider would throw away prose that is fine,
 * burn a cascade slot, and — after the commit boundary — be
 * impossible anyway. So this cleans up and says so in the log,
 * which is the only place an operator can act on it.
 *
 * WHERE IT RUNS: streamFromChain, at the single point every
 * provider's text passes through. Not in the adapters, which
 * would be three copies that drift, and not further downstream,
 * which would leave the action scanner reading tool JSON out of a
 * harmony header.
 */

/* =========================================================
   THE VOCABULARY

   Every special token harmony defines, spelled out rather than
   matched loosely as `<\|[^|]*\|>`. The loose version would also
   eat anything a learner wrote that happened to be shaped like
   it, and this filter runs on every answer in the product — a
   lesson about pipes, a table in someone's markdown. A closed
   list can only ever remove things gpt-oss actually emits.
========================================================= */

const MARKER_NAMES = [
  "start",
  "end",
  "message",
  "channel",
  "constrain",
  "return",
  "call",
  "refusal",
  "endoftext",
  "endofprompt",
] as const;

/* The roles a header line can name. */
const ROLE = "(?:assistant|system|developer|user|tool)";

/* The three channels: hidden reasoning, tool traffic, answer. */
const CHANNEL = "(?:final|analysis|commentary)";

/*
 * Who a commentary message is addressed to.
 *
 * Deliberately NOT `\S*`, and this is the one piece of this file
 * where the narrow pattern earns its keep. In the email above the
 * header was truncated — `to=` with nothing after it — so the
 * next characters were the answer itself. A greedy recipient
 * would have swallowed "I'm" and delivered an apology beginning
 * "sorry—I don't have enough".
 *
 * So a recipient has to LOOK like one. Where it does, it goes.
 * Where it does not, only the `to=` goes and the prose behind it
 * survives intact, which is exactly the right failure.
 */
const RECIPIENT = "(?:functions|browser|python|container|assistant|tool)[\\w.\\-]*";

/* Horizontal space only: a newline inside a header would mean
   the header ended and prose began. */
const GAP = "[ \\t]*";

/*
 * A header, whole or truncated.
 *
 * Every piece after the opening token is optional, because the
 * leaks worth catching are the ones that stop half way — a
 * complete header is the easy case. What keeps that from
 * matching empty strings is the anchor: something has to open
 * with `<|start|>` or `<|channel|>` for any of this to apply.
 */
function header(open: "start" | "channel"): string {
  const opening =
    open === "start"
      ? `<\\|start\\|>${GAP}${ROLE}?${GAP}(?:<\\|channel\\|>${GAP}${CHANNEL}?)?`
      : `<\\|channel\\|>${GAP}${CHANNEL}?`;

  return [
    opening,
    /*
     * The recipient is wrapped before it is made optional, and
     * that is not a stylistic bracket. Written `${RECIPIENT}?`
     * the question mark binds to the trailing `[\w.\-]*` inside
     * it — so the namespace became mandatory and the name
     * became lazy, which matched `to=functions` and left
     * `.get_weather` in the answer. The probe caught it; the
     * brackets are what fix it.
     */
    `(?:${GAP}to${GAP}=${GAP}(?:${RECIPIENT})?)?`,
    `(?:${GAP}<\\|constrain\\|>${GAP}\\w+)?`,
    `(?:${GAP}<\\|message\\|>)?`,
  ].join("");
}

/*
 * Two patterns rather than one with an optional `<|start|>`,
 * because a chunk boundary can land between them. A stream that
 * delivers `<|start|>assistant` and then `<|channel|>final` has
 * to have both halves recognised on their own.
 */
const HEADERS = new RegExp(`(?:${header("start")})|(?:${header("channel")})`, "g");

/* Whatever the header patterns did not account for: a closing
   `<|return|>`, a stray `<|end|>`, a token in a shape nobody has
   seen yet. */
const MARKERS = new RegExp(`<\\|(?:${MARKER_NAMES.join("|")})\\|>`, "g");

/*
 * A token cut in half by the end of a chunk.
 *
 * `<|`, `<|sta`, `<|start|` — anything that is still on its way
 * to being one of the names above. The length cap is what stops
 * a lone `<` in ordinary prose from holding up the stream.
 */
const PARTIAL_MARKER = /<\|?[a-z]{0,12}\|?$/;

/* What opens a header. Everything from one of these to the end
   of a chunk is suspect until a `<|message|>` closes it. */
const OPENERS = ["<|start|>", "<|channel|>"] as const;

/*
 * How much text may be held back waiting for a header to finish.
 *
 * A generous bound on the longest header that can legitimately
 * exist — role, channel, a long function name, a constraint —
 * and a hard stop on holding an answer hostage to a `<|message|>`
 * that is never coming. Past it, the buffer is cleaned and
 * released: by then the header patterns have all the text they
 * need to recognise what is there.
 */
const MAX_HEADER = 160;

/* =========================================================
   THE FILTER
========================================================= */

export interface HarmonyFilter {
  /* The visible part of this chunk. May be empty — a chunk that
     was nothing but a header produces nothing to show. */
  push(chunk: string): string;
  /* Whatever was being held back when the stream ended. */
  flush(): string;
  /* Whether anything was ever removed, for the caller's log. */
  leaked(): boolean;
}

export function createHarmonyFilter(): HarmonyFilter {
  let pending = "";
  let removed = false;

  const clean = (text: string): string => {
    const stripped = stripHarmony(text);

    if (stripped !== text) {
      removed = true;
    }

    return stripped;
  };

  return {
    push(chunk: string): string {
      pending += chunk;

      const hold = holdFrom(pending);
      const ready = pending.slice(0, hold);

      pending = pending.slice(hold);

      return clean(ready);
    },

    flush(): string {
      const last = pending;

      pending = "";

      return clean(last);
    },

    leaked(): boolean {
      return removed;
    },
  };
}

/*
 * The index from which text must be held back until more
 * arrives, because it might not be finished.
 *
 * Two things can be incomplete at the end of a chunk, and the
 * first draft of this only handled the obvious one.
 *
 * A TOKEN CUT IN HALF — `…<|sta` — is the obvious one, and the
 * pattern above catches it.
 *
 * A HEADER STILL BEING WRITTEN is the one that actually leaked.
 * `<|start|>a` contains a complete, matchable `<|start|>`
 * followed by a single letter, and that letter is the first
 * character of `assistant`. Strip the token, emit the rest, and
 * the answer opens with "assistantcommentary to=" one character
 * at a time — which is precisely what the probe printed. So the
 * rule is not "does a header match here" but "could a header
 * still be going on here".
 *
 * A header cannot contain a newline, and `<|message|>` ends one.
 * Either of those means whatever follows is prose and may go.
 * Failing both, the text from the opener is held — bounded by
 * MAX_HEADER, so an answer is never held hostage to a token that
 * is not coming.
 */
function holdFrom(text: string): number {
  let at = text.length;

  const partial = PARTIAL_MARKER.exec(text);

  if (partial) {
    at = partial.index;
  }

  let opener = -1;

  for (const token of OPENERS) {
    opener = Math.max(opener, text.lastIndexOf(token));
  }

  if (opener < 0 || opener >= at) {
    return at;
  }

  const tail = text.slice(opener);

  const finished =
    tail.length > MAX_HEADER ||
    tail.includes("<|message|>") ||
    /[\r\n]/.test(tail);

  return finished ? at : opener;
}

/*
 * One pass, for text that is already whole.
 *
 * Exported for the non-streaming callers and for the verify
 * suite, which asserts against the literal string that went out
 * in that email.
 */
export function stripHarmony(text: string): string {
  if (!text.includes("<|")) {
    return text;
  }

  HEADERS.lastIndex = 0;
  MARKERS.lastIndex = 0;

  return text.replace(HEADERS, "").replace(MARKERS, "");
}
