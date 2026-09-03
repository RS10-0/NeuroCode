/*
 * Turning whatever a search provider says into something safe
 * to put in a prompt and safe to render in a browser.
 *
 * Everything a provider returns is untrusted input, in a
 * stronger sense than a learner's own pasted knowledge is: the
 * text was written by a stranger, chosen by a ranking algorithm,
 * and reaches the model without anybody at all having read it
 * first. That makes this file part of the security boundary,
 * alongside websearch/context.ts.
 *
 * The division of labour between the two is worth stating.
 * Here: the value is made well-formed — real URL, no markup, no
 * control characters, bounded length. There: the well-formed
 * value is framed so the model treats it as quoted material
 * rather than as instructions. Neither is sufficient alone.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/*
 * HTML entities, decoded once and only once.
 *
 * Once matters. Decoding repeatedly would turn `&amp;lt;` into a
 * literal `<`, which is how an attacker smuggles markup past a
 * filter that ran before the decode.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);

      /* Anything outside the Unicode range, and anything that
         decodes to a control character, is left as written. */
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) {
        return match;
      }

      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }

    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/* Every tag removed, not escaped. A search result's title has no
   business carrying markup into a prompt. */
export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/*
 * Whitespace collapsed and control characters dropped.
 *
 * The control characters are the point rather than the tidiness.
 * A snippet carrying newlines can draw its own fake section
 * headings inside the reference block, and one carrying a
 * bidirectional override can make the URL a person reads
 * disagree with the URL that is actually there.
 */
const CONTROL_AND_BIDI =
  // eslint-disable-next-line no-control-regex -- matching control characters is precisely this expression's job
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function collapse(text: string): string {
  return text.replace(CONTROL_AND_BIDI, " ").replace(/\s+/g, " ").trim();
}

/* Decode, de-tag, collapse, and cut to a hard ceiling. The one
   function providers should reach for. */
export function cleanText(raw: string, maxChars: number): string {
  const text = collapse(decodeEntities(stripTags(raw)));

  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }

  const cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");

  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/*
 * A URL, or nothing.
 *
 * http and https only. Rejecting everything else is what stops
 * `javascript:` and `data:` from reaching a prompt that tells
 * the model to cite links, and from reaching an anchor in the
 * Test panel — where the browser would happily run one.
 *
 * The length cap is not cosmetic either: a 20 kB tracking URL
 * would eat the whole context budget on its own.
 */
const MAX_URL_CHARS = 500;

export function safeUrl(raw: string): string | null {
  const trimmed = collapse(decodeEntities(raw));

  if (!trimmed || trimmed.length > MAX_URL_CHARS) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  /* A hostname is what makes it a citable source. */
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return null;
  }

  return parsed.toString();
}

/*
 * The bit of a URL a person recognises.
 *
 * Shown in the Test panel, where there is no room for a full
 * URL and where the domain is the part that says whether a
 * source is worth trusting.
 */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
