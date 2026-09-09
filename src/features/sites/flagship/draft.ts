/*
 * What can honestly be said about a draft without asking the
 * model anything.
 *
 * The writing desk shows a scorecard beside the draft in both
 * of its modes — a tone meter for the novelist, a thesis
 * scorecard for the student — and the entire value of those
 * panels rests on one property: every number in them is a
 * COUNT OF SOMETHING REALLY IN THE TEXT, computed here, in the
 * browser, from the words the visitor typed.
 *
 * That is a design rule and not an implementation detail. A
 * panel headed "thesis strength: 78%" would be inventing a
 * grade — nothing on this page can grade an argument, the
 * coach's whole method is to explain rather than to score, and
 * a fabricated number under BuildGentic's name on a page a
 * student trusts is the worst thing this file could produce.
 * So there are no scores here. There are counts, ratios and
 * averages, each labelled as what it measures, and the reading
 * of them is left to the coach — which is the thing that can
 * actually read.
 *
 * The heuristics below are deliberately simple and are named
 * as heuristics in the copy that renders them. A passive
 * construction found by a regular expression is a candidate,
 * not a verdict; a word from a fixed sensory list is a word
 * from a fixed sensory list. Saying so is cheaper than being
 * wrong quietly.
 *
 * A LEAF MODULE. Pure functions, no imports, no JSX — so the
 * layout can call it on every keystroke and a test could call
 * it without a browser.
 */

export interface DraftMetrics {
  words: number;
  sentences: number;
  paragraphs: number;
  /* Rounded. Zero when there is nothing to average. */
  averageSentence: number;
  longestSentence: number;
  /* Sentences carrying quoted speech, as a share of all
     sentences. The novelist's dialogue-to-narration balance. */
  dialogueShare: number;
  sensoryWords: number;
  /* "felt", "realised", "seemed" — the verbs that report an
     interior state instead of showing it. */
  tellingVerbs: number;
  adverbs: number;
  /* Candidates, by the heuristic below. */
  passives: number;
  hedges: number;
  /* (Author, 2020), (Author 2020, p. 4) and [1] style. */
  citations: number;
  firstPerson: number;
}

const EMPTY: DraftMetrics = {
  words: 0,
  sentences: 0,
  paragraphs: 0,
  averageSentence: 0,
  longestSentence: 0,
  dialogueShare: 0,
  sensoryWords: 0,
  tellingVerbs: 0,
  adverbs: 0,
  passives: 0,
  hedges: 0,
  citations: 0,
  firstPerson: 0,
};

/*
 * A sample, not a lexicon.
 *
 * Roughly forty words across the five senses. It is enough for
 * the count to move in the right direction when somebody adds
 * a paragraph of description, which is the only thing the
 * meter claims to show, and small enough that a reader of this
 * file can see exactly what is being counted. The label in the
 * panel says "from a fixed list" for that reason.
 */
const SENSORY = [
  "light", "dark", "bright", "shadow", "glow", "dim", "flicker",
  "cold", "warm", "heat", "chill", "damp", "dry", "wet",
  "smell", "scent", "stink", "smoke", "sweet", "sour", "bitter", "salt",
  "taste", "loud", "quiet", "silence", "hum", "echo", "creak", "hiss",
  "rough", "smooth", "sharp", "soft", "dust", "grit", "sticky",
  "rain", "wind", "breath",
];

/* Verbs that report the interior rather than showing it. The
   show-don't-tell meter counts these and nothing else. */
const TELLING = [
  "felt", "feel", "feels", "realised", "realized", "seemed", "seem",
  "seems", "knew", "know", "knows", "wondered", "noticed", "thought",
  "decided", "understood", "sensed",
];

/* Filler and hedging. Cutting these is most of what a
   conciseness pass does, in both modes. */
const HEDGES = [
  "very", "really", "quite", "somewhat", "rather", "fairly", "basically",
  "actually", "literally", "just", "perhaps", "maybe", "arguably",
  "essentially", "kind", "sort", "definitely", "certainly", "clearly",
  "obviously", "simply", "totally", "extremely",
];

const FIRST_PERSON = ["i", "me", "my", "mine", "we", "us", "our", "ours"];

/* Both quote species, because a draft pasted out of a word
   processor carries curly ones and a draft typed here carries
   straight ones. */
const QUOTED = /["“”‘’]/;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-zÀ-ɏ']+/g) ?? [];
}

function countFrom(list: string[], all: string[]): number {
  const set = new Set(list);

  return all.reduce((total, word) => (set.has(word) ? total + 1 : total), 0);
}

export function analyseDraft(text: string): DraftMetrics {
  const trimmed = text.trim();

  if (!trimmed) {
    return EMPTY;
  }

  const all = words(trimmed);

  /* Split on terminal punctuation followed by space or end, so
     "Dr. Who" does not become two sentences quite as often as
     a naive split on "." would make it. */
  const sentences = trimmed
    .split(/[.!?…]+(?:\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean);

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  const lengths = sentences.map((sentence) => words(sentence).length);
  const spoken = sentences.filter((sentence) => QUOTED.test(sentence)).length;

  /*
   * PASSIVE CANDIDATES.
   *
   * A form of "to be" followed by something that looks like a
   * past participle, with an optional adverb between them. It
   * finds "was written", "is being considered" and "were
   * quietly removed"; it also finds "was tired", which is not
   * passive at all, and misses every irregular participle that
   * does not end in -ed or -en. Hence "candidates" everywhere
   * this number is shown.
   */
  const passives =
    trimmed.match(
      /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/gi
    )?.length ?? 0;

  /* (Smith, 2019) · (Smith 2019, p. 12) · [4] */
  const citations =
    trimmed.match(
      /\([A-Z][\w'À-ɏ-]+(?:\s+(?:et al\.?|and|&)\s+[A-Z][\w'-]+)*,?\s+\d{4}[a-z]?(?:,\s*pp?\.\s*\d+(?:[-–]\d+)?)?\)|\[\d+(?:[,–-]\s*\d+)*\]/g
    )?.length ?? 0;

  return {
    words: all.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    averageSentence: lengths.length
      ? Math.round(all.length / lengths.length)
      : 0,
    longestSentence: lengths.length ? Math.max(...lengths) : 0,
    dialogueShare: sentences.length ? spoken / sentences.length : 0,
    sensoryWords: countFrom(SENSORY, all),
    tellingVerbs: countFrom(TELLING, all),
    adverbs: all.filter((word) => word.length > 4 && word.endsWith("ly")).length,
    passives,
    hedges: countFrom(HEDGES, all),
    citations,
    firstPerson: countFrom(FIRST_PERSON, all),
  };
}

/* =========================================================
   METERS

   What the panel actually draws. `fill` is a bar position and
   nothing more — it is never a mark out of ten, and `note`
   never passes judgement. "12 of 84 sentences" is a fact;
   "dialogue is too sparse" would be the coach's job.
========================================================= */

export interface Meter {
  id: string;
  label: string;
  /* Already formatted. The component only prints it. */
  value: string;
  /*
   * 0–1, for the bar. The denominators are stated in each
   * `note` so nobody has to guess what a full bar means, and a
   * full bar is never "good" — a draft that is 100% dialogue
   * and a draft with none are both bars at an extreme.
   */
  fill: number;
  note: string;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/* Per hundred words, which is the only way these compare
   across a paragraph and a chapter. */
const per100 = (count: number, total: number): number =>
  total ? (count / total) * 100 : 0;

export function creativeMeters(m: DraftMetrics): Meter[] {
  const density = per100(m.sensoryWords, m.words);
  const telling = per100(m.tellingVerbs, m.words);

  return [
    {
      id: "pace",
      label: "Pace",
      value: m.averageSentence ? `${m.averageSentence} words / sentence` : "—",
      /* 30 words is a long sentence in narrative prose, so the
         bar reads as "how long-breathed is this", full at 30. */
      fill: clamp(m.averageSentence / 30),
      note: `Longest run: ${m.longestSentence || 0} words. Bar fills at 30.`,
    },
    {
      id: "dialogue",
      label: "Dialogue",
      value: m.sentences
        ? `${Math.round(m.dialogueShare * 100)}% of sentences`
        : "—",
      fill: clamp(m.dialogueShare),
      note: "Sentences carrying quoted speech, against all sentences.",
    },
    {
      id: "sensory",
      label: "Sensory detail",
      value: `${m.sensoryWords} word${m.sensoryWords === 1 ? "" : "s"}`,
      /* Four per hundred words is already a richly textured
         page, so the bar fills there. */
      fill: clamp(density / 4),
      note: "Counted from a fixed list of about forty sense words.",
    },
    {
      id: "telling",
      label: "Told, not shown",
      value: `${m.tellingVerbs} verb${m.tellingVerbs === 1 ? "" : "s"}`,
      fill: clamp(telling / 3),
      note: "felt · realised · seemed · knew · wondered. Not always wrong.",
    },
  ];
}

export function academicMeters(m: DraftMetrics): Meter[] {
  return [
    {
      id: "sentence",
      label: "Sentence length",
      value: m.averageSentence ? `${m.averageSentence} words average` : "—",
      /* 25 is where an academic sentence starts costing the
         reader more than it carries. */
      fill: clamp(m.averageSentence / 25),
      note: `Longest: ${m.longestSentence || 0} words. Bar fills at 25.`,
    },
    {
      id: "passive",
      label: "Passive candidates",
      value: `${m.passives} found`,
      fill: clamp(per100(m.passives, m.words) / 4),
      note: "A regex match, so it over-counts. Check each one.",
    },
    {
      id: "hedges",
      label: "Hedges and filler",
      value: `${m.hedges} word${m.hedges === 1 ? "" : "s"}`,
      fill: clamp(per100(m.hedges, m.words) / 4),
      note: "very · really · basically · arguably · just.",
    },
    {
      id: "citations",
      label: "Citations",
      value: `${m.citations} in text`,
      /* One per hundred words is a densely evidenced essay. */
      fill: clamp(per100(m.citations, m.words) / 1),
      note: "(Author, 2020) and [1] patterns only. Footnotes are invisible here.",
    },
  ];
}

/* =========================================================
   SHOW ME WHERE

   The coach quotes a line and the reader has to find it. This
   is the bridge: pull the quoted fragments out of a reply, and
   return the first one that is really present in the draft.

   Returning null is the normal case rather than a failure —
   plenty of good notes quote nothing — and the control that
   uses this is simply not drawn when there is nothing to point
   at. A button that scrolled somewhere arbitrary would be
   worse than no button.
========================================================= */

/*
 * Long enough that a match means something. Two-word quotes
 * like "the" or "she said" appear everywhere in a draft and
 * would send the reader to the wrong line with total
 * confidence, which is the one outcome worth engineering out.
 */
const MIN_QUOTE = 12;
const MAX_QUOTE = 300;

export function quotedFromReply(reply: string, draft: string): string | null {
  if (!reply || draft.trim().length < MIN_QUOTE) {
    return null;
  }

  const candidates: string[] = [];

  /* Straight quotes, curly quotes, and backticked spans — the
     three ways this agent's replies actually mark a line. */
  const patterns = [
    /“([^“”]{12,300})”/g,
    /"([^"]{12,300})"/g,
    /`([^`]{12,300})`/g,
  ];

  for (const pattern of patterns) {
    for (const match of reply.matchAll(pattern)) {
      if (match[1]) {
        candidates.push(match[1]);
      }
    }
  }

  /* Markdown blockquote lines, which is how a longer excerpt
     comes back. */
  for (const line of reply.split("\n")) {
    const quoted = /^\s*>\s?(.+)$/.exec(line);

    if (quoted?.[1] && quoted[1].trim().length >= MIN_QUOTE) {
      candidates.push(quoted[1].trim());
    }
  }

  for (const raw of candidates) {
    const candidate = raw.trim();

    if (candidate.length < MIN_QUOTE || candidate.length > MAX_QUOTE) {
      continue;
    }

    if (draft.includes(candidate)) {
      return candidate;
    }

    /*
     * One retry without trailing punctuation, because a note
     * that ends its quotation with a full stop the draft does
     * not have is the single most common near-miss.
     */
    const trimmed = candidate.replace(/[.,;:!?…]+$/, "");

    if (trimmed.length >= MIN_QUOTE && draft.includes(trimmed)) {
      return trimmed;
    }
  }

  return null;
}
