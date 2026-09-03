/*
 * Turning text into bytes a PDF can draw, and knowing how wide
 * they will be.
 *
 * This file is the whole of the PDF writer's honesty problem.
 *
 * The writer uses the standard-14 Helvetica faces, which every
 * PDF reader has built in and which therefore need no embedded
 * font file. The price is their encoding: WinAnsiEncoding, a
 * single-byte character set that is Latin-1 with a handful of
 * typographic characters in the 0x80-0x9F range. It can draw
 * English, the western European languages, and — importantly,
 * because model output is full of them — curly quotes, en and
 * em dashes, the ellipsis and the bullet.
 *
 * It cannot draw CJK, Greek, Cyrillic, Devanagari, Arabic, or
 * emoji. There is no glyph, and no amount of care in the writer
 * changes that; the only fix is embedding a TrueType subset,
 * which is a different and much larger piece of work.
 *
 * SO THE JOB HERE IS TO KNOW EXACTLY WHAT WAS LOST, rather than
 * to lose it quietly. `encode` returns the bytes AND a count of
 * what it could not represent, and the caller decides. A report
 * whose body is 2% placeholders is worth having with a note
 * attached; a report whose TITLE is a row of boxes is not a
 * report. Those two decisions are made in pdf.ts, out of the
 * numbers this file returns.
 *
 * On the widths: they are the Adobe Font Metrics values for
 * Helvetica and Helvetica-Bold, which is what makes line
 * wrapping land where it should instead of overlapping the
 * margin. Accented letters take their base letter's width,
 * which is true of these faces for every accented form — the
 * exceptions are listed explicitly below.
 */

/* =========================================================
   ENCODING

   Unicode in, WinAnsi bytes out.
========================================================= */

/*
 * The 0x80-0x9F range, which is where WinAnsi stops being
 * Latin-1 and starts being useful.
 *
 * Every one of these appears constantly in model output —
 * "don't" written with a curly apostrophe, a dash between
 * clauses, an ellipsis at the end of a truncated quote. Without
 * this table they would all be unrenderable, and an ordinary
 * English paragraph would trip the refusal threshold.
 */
const HIGH: Record<number, number> = {
  0x20ac: 0x80 /* € */,
  0x201a: 0x82 /* ‚ */,
  0x0192: 0x83 /* ƒ */,
  0x201e: 0x84 /* „ */,
  0x2026: 0x85 /* … */,
  0x2020: 0x86 /* † */,
  0x2021: 0x87 /* ‡ */,
  0x02c6: 0x88 /* ˆ */,
  0x2030: 0x89 /* ‰ */,
  0x0160: 0x8a /* Š */,
  0x2039: 0x8b /* ‹ */,
  0x0152: 0x8c /* Œ */,
  0x017d: 0x8e /* Ž */,
  0x2018: 0x91 /* ' */,
  0x2019: 0x92 /* ' */,
  0x201c: 0x93 /* " */,
  0x201d: 0x94 /* " */,
  0x2022: 0x95 /* • */,
  0x2013: 0x96 /* – */,
  0x2014: 0x97 /* — */,
  0x02dc: 0x98 /* ˜ */,
  0x2122: 0x99 /* ™ */,
  0x0161: 0x9a /* š */,
  0x203a: 0x9b /* › */,
  0x0153: 0x9c /* œ */,
  0x017e: 0x9e /* ž */,
  0x0178: 0x9f /* Ÿ */,
};

/*
 * What stands in for a character that cannot be drawn.
 *
 * Visible on purpose. A space would hide the loss, and a bare
 * question mark reads as punctuation the agent wrote — which is
 * worse than either, because it makes a substitution look like
 * a sentence. Brackets say "something was here".
 */
export const PLACEHOLDER = "[?]";

export interface Encoded {
  bytes: Buffer;
  /* Characters that had no glyph and were replaced. */
  lost: number;
  /* Characters considered, ignoring whitespace — the
     denominator the caller's percentage is taken against. */
  total: number;
}

/*
 * One string, encoded.
 *
 * Whitespace is excluded from `total` deliberately. A line of
 * CJK with spaces around it should read as almost entirely
 * unrenderable, and counting the spaces as successes would
 * dilute exactly the signal the threshold is looking for.
 */
export function encode(text: string): Encoded {
  const out: number[] = [];

  let lost = 0;
  let total = 0;

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    /* Newlines and tabs are structure, handled by the writer
       before this is called. Anything still here is content. */
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out.push(0x20);
      continue;
    }

    if (code !== 0x20) {
      total += 1;
    }

    if (code >= 0x20 && code <= 0x7e) {
      out.push(code);
      continue;
    }

    if (code >= 0xa0 && code <= 0xff) {
      out.push(code);
      continue;
    }

    const mapped = HIGH[code];

    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }

    /*
     * A soft hyphen and a zero-width space are not losses —
     * they are invisible characters that were carrying no
     * meaning a reader would miss. Dropping them silently is
     * correct; counting them as lost would push honest text
     * over the threshold.
     */
    if (code === 0xad || code === 0x200b || code === 0xfeff) {
      total -= 1;
      continue;
    }

    lost += 1;

    for (const byte of PLACEHOLDER) {
      out.push(byte.charCodeAt(0));
    }
  }

  return { bytes: Buffer.from(out), lost, total };
}

/* Whether a string can be drawn in full. What the title rule
   uses, where the tolerance is zero rather than a percentage. */
export function fullyRenderable(text: string): boolean {
  return encode(text).lost === 0;
}

/* =========================================================
   METRICS

   Adobe Font Metrics widths, in 1/1000 of the font size, for
   the two faces this writer uses.
========================================================= */

/* prettier-ignore */
const HELVETICA: number[] = [
  /* 32-47  */ 278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  /* 48-63  */ 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  /* 64-79  */ 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  /* 80-95  */ 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  /* 96-111 */ 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  /* 112-126*/ 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/* prettier-ignore */
const HELVETICA_BOLD: number[] = [
  /* 32-47  */ 278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  /* 48-63  */ 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  /* 64-79  */ 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  /* 80-95  */ 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  /* 96-111 */ 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  /* 112-126*/ 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/*
 * Which ASCII letter an upper-range byte takes its width from.
 *
 * Accented forms in these faces are exactly as wide as their
 * base letter — é is e, À is A, ñ is n — so one small table
 * covers the whole of Latin-1 rather than 96 more numbers. The
 * genuine exceptions are listed after it.
 */
/* prettier-ignore */
const BASE_OF: Record<number, string> = {
  0xa0: " ", 0xa1: "!", 0xa2: "c", 0xa3: "$", 0xa4: "$", 0xa5: "Y", 0xa6: "|",
  0xa7: "$", 0xa8: "`", 0xa9: "@", 0xaa: "a", 0xab: "<", 0xac: "+", 0xae: "@",
  0xaf: "`", 0xb0: "o", 0xb1: "+", 0xb2: "o", 0xb3: "o", 0xb4: "`", 0xb5: "u",
  0xb6: "$", 0xb7: ".", 0xb8: ",", 0xb9: "o", 0xba: "o", 0xbb: ">", 0xbf: "?",
  0xc0: "A", 0xc1: "A", 0xc2: "A", 0xc3: "A", 0xc4: "A", 0xc5: "A",
  0xc7: "C", 0xc8: "E", 0xc9: "E", 0xca: "E", 0xcb: "E",
  0xcc: "I", 0xcd: "I", 0xce: "I", 0xcf: "I", 0xd0: "D", 0xd1: "N",
  0xd2: "O", 0xd3: "O", 0xd4: "O", 0xd5: "O", 0xd6: "O", 0xd7: "+", 0xd8: "O",
  0xd9: "U", 0xda: "U", 0xdb: "U", 0xdc: "U", 0xdd: "Y", 0xde: "P",
  0xe0: "a", 0xe1: "a", 0xe2: "a", 0xe3: "a", 0xe4: "a", 0xe5: "a",
  0xe7: "c", 0xe8: "e", 0xe9: "e", 0xea: "e", 0xeb: "e",
  0xec: "i", 0xed: "i", 0xee: "i", 0xef: "i", 0xf0: "o", 0xf1: "n",
  0xf2: "o", 0xf3: "o", 0xf4: "o", 0xf5: "o", 0xf6: "o", 0xf7: "+", 0xf8: "o",
  0xf9: "u", 0xfa: "u", 0xfb: "u", 0xfc: "u", 0xfd: "y", 0xfe: "p", 0xff: "y",
};

/* The forms that are genuinely not their base letter's width.
   Regular and bold, in that order. */
const EXCEPTIONS: Record<number, [number, number]> = {
  0xbc: [834, 834] /* ¼ */,
  0xbd: [834, 834] /* ½ */,
  0xbe: [834, 834] /* ¾ */,
  0xc6: [1000, 1000] /* Æ */,
  0xe6: [889, 889] /* æ */,
  0xdf: [611, 611] /* ß */,
  0x8c: [1000, 1000] /* Œ */,
  0x9c: [944, 944] /* œ */,
  0x80: [556, 556] /* € */,
  0x85: [1000, 1000] /* … */,
  0x89: [1000, 1000] /* ‰ */,
  0x95: [350, 350] /* • */,
  0x96: [556, 556] /* – */,
  0x97: [1000, 1000] /* — */,
  0x99: [1000, 1000] /* ™ */,
  0x91: [222, 278] /* ' */,
  0x92: [222, 278] /* ' */,
  0x93: [333, 500] /* " */,
  0x94: [333, 500] /* " */,
  0x82: [222, 278] /* ‚ */,
  0x84: [333, 500] /* „ */,
  0x86: [556, 556] /* † */,
  0x87: [556, 556] /* ‡ */,
  0x8a: [667, 667] /* Š */,
  0x9a: [500, 556] /* š */,
  0x8b: [333, 333] /* ‹ */,
  0x9b: [333, 333] /* › */,
  0x8e: [611, 611] /* Ž */,
  0x9e: [500, 500] /* ž */,
  0x9f: [667, 667] /* Ÿ */,
  0x83: [556, 556] /* ƒ */,
  0x88: [333, 333] /* ˆ */,
  0x98: [333, 333] /* ˜ */,
};

/* One WinAnsi byte, in 1/1000 em. */
function widthOfByte(byte: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;

  if (byte >= 32 && byte <= 126) {
    return table[byte - 32];
  }

  const exception = EXCEPTIONS[byte];

  if (exception) {
    return bold ? exception[1] : exception[0];
  }

  const base = BASE_OF[byte];

  if (base !== undefined) {
    return table[base.charCodeAt(0) - 32];
  }

  /* An unmapped byte cannot occur — `encode` only emits ones
     this file knows — but a width of zero would silently
     produce overlapping text, so the fallback is the widest
     ordinary letter rather than nothing. */
  return bold ? 611 : 556;
}

/*
 * How wide a string will be drawn, in points.
 *
 * Measured on the ENCODED bytes rather than on the source,
 * which is the only way the placeholder is counted at its real
 * width. A line measured before substitution and drawn after it
 * is a line that overflows by three characters per lost glyph.
 */
export function widthOf(text: string, size: number, bold: boolean): number {
  const { bytes } = encode(text);

  let mille = 0;

  for (const byte of bytes) {
    mille += widthOfByte(byte, bold);
  }

  return (mille * size) / 1000;
}

/* =========================================================
   WRAPPING
========================================================= */

/*
 * Breaks a paragraph into lines that fit a measure.
 *
 * Greedy, on spaces, which is what every word processor does
 * and what a reader expects. A single word longer than the
 * measure — a URL, most often — is broken by character rather
 * than allowed to run off the page, because a PDF has no
 * horizontal scrollbar and the alternative is text that
 * silently leaves the paper.
 */
export function wrap(
  text: string,
  size: number,
  bold: boolean,
  measure: number
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    const words = paragraph.split(/\s+/).filter((word) => word !== "");

    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = "";

    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;

      if (widthOf(candidate, size, bold) <= measure) {
        line = candidate;
        continue;
      }

      /* No `line = ""` here: every path below reassigns it, so
         clearing first would be a write nothing reads. */
      if (line !== "") {
        lines.push(line);
      }

      if (widthOf(word, size, bold) <= measure) {
        line = word;
        continue;
      }

      /* One word wider than the whole measure. Broken by
         character, greedily, into as many lines as it needs. */
      let chunk = "";

      for (const character of word) {
        if (widthOf(chunk + character, size, bold) > measure && chunk !== "") {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }

      line = chunk;
    }

    if (line !== "") {
      lines.push(line);
    }
  }

  return lines;
}
