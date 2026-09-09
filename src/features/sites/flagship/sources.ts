/*
 * What a page may say about a source without asking anybody.
 *
 * The reading room shows a badge beside every source a student
 * pins, and the whole value of that badge rests on it being
 * TRUE. So it says only what the address itself proves.
 *
 * A domain is a fact. `nhs.uk` really is a government health
 * service; `arxiv.org` really does host preprints that no
 * reviewer has read yet; `en.wikipedia.org` really is an
 * encyclopaedia. Those are checkable claims about where a thing
 * is published, and a student who learns to read them has
 * learned something that transfers.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is score a source. There
 * is no "87% credible", no traffic-light on quality, and no
 * "peer-reviewed" badge — because a domain cannot establish
 * peer review, and a page that claimed otherwise would be
 * teaching the exact habit this agent exists to break. Being
 * on a university domain is not the same as being good, which
 * is why every label below carries the caveat that goes with
 * it rather than leaving the reader to supply one.
 *
 * The judgement is the agent's. It can search, read the thing,
 * and say when it is unsure — none of which a regular
 * expression over a hostname can do. This is the label on the
 * shelf; the agent is the person who read the book.
 *
 * A LEAF MODULE. Pure functions, no imports, no JSX.
 */

export type SourceKind =
  | "government"
  | "university"
  | "journal"
  | "preprint"
  | "encyclopedia"
  | "organisation"
  | "news"
  | "unknown";

export interface SourceBadge {
  kind: SourceKind;
  /* Short, on the chip. */
  label: string;
  /* The caveat, always shown. A label without one would be a
     recommendation, which is not what any of these are. */
  note: string;
}

const BADGES: Record<SourceKind, Omit<SourceBadge, "kind">> = {
  government: {
    label: "Government",
    note: "Reliable on its own figures. Never neutral about which figures it publishes.",
  },
  university: {
    label: "University",
    note: "A university domain. That covers peer-reviewed work and a student's blog equally.",
  },
  journal: {
    label: "Journal index",
    note: "Indexed by a publisher or DOI service. Check whether this particular item was reviewed.",
  },
  preprint: {
    label: "Preprint",
    note: "Posted before peer review. Nobody has checked it yet — say so if you cite it.",
  },
  encyclopedia: {
    label: "Encyclopaedia",
    note: "Good for finding sources, not for being one. Follow its references.",
  },
  organisation: {
    label: "Organisation",
    note: "A .org tells you nothing about quality — anyone may register one. Who funds it?",
  },
  news: {
    label: "News",
    note: "Reporting with editors and corrections. Good for what happened, weaker for why.",
  },
  unknown: {
    label: "Unclassified",
    note: "The address alone says nothing. Ask who wrote it, when, and who paid for it.",
  },
};

/*
 * Suffix matches, longest first, so `.ac.uk` is not swallowed
 * by `.uk` and `data.gov.uk` resolves as government rather than
 * as a generic UK domain.
 */
const SUFFIXES: Array<[string, SourceKind]> = [
  [".gov", "government"],
  [".gov.uk", "government"],
  [".gov.au", "government"],
  [".mil", "government"],
  [".nhs.uk", "government"],
  [".europa.eu", "government"],
  [".edu", "university"],
  [".ac.uk", "university"],
  [".edu.au", "university"],
  [".ac.nz", "university"],
  [".org", "organisation"],
];

/* Exact hosts, checked before suffixes, because these say
   something more specific than their TLD does. */
const HOSTS: Array<[string, SourceKind]> = [
  ["arxiv.org", "preprint"],
  ["biorxiv.org", "preprint"],
  ["medrxiv.org", "preprint"],
  ["ssrn.com", "preprint"],
  ["papers.ssrn.com", "preprint"],
  ["osf.io", "preprint"],
  ["doi.org", "journal"],
  ["pubmed.ncbi.nlm.nih.gov", "journal"],
  ["ncbi.nlm.nih.gov", "journal"],
  ["jstor.org", "journal"],
  ["sciencedirect.com", "journal"],
  ["springer.com", "journal"],
  ["link.springer.com", "journal"],
  ["nature.com", "journal"],
  ["wiley.com", "journal"],
  ["onlinelibrary.wiley.com", "journal"],
  ["tandfonline.com", "journal"],
  ["cambridge.org", "journal"],
  ["oup.com", "journal"],
  ["academic.oup.com", "journal"],
  ["plos.org", "journal"],
  ["journals.plos.org", "journal"],
  ["scholar.google.com", "journal"],
  ["wikipedia.org", "encyclopedia"],
  ["en.wikipedia.org", "encyclopedia"],
  ["britannica.com", "encyclopedia"],
  ["bbc.co.uk", "news"],
  ["bbc.com", "news"],
  ["reuters.com", "news"],
  ["apnews.com", "news"],
  ["theguardian.com", "news"],
  ["nytimes.com", "news"],
  ["ft.com", "news"],
  ["economist.com", "news"],
];

/*
 * The hostname, or null when the text is not a URL.
 *
 * Bare domains typed without a scheme are accepted, because
 * that is how people paste them — but only when they look like
 * a hostname, so a sentence with a full stop in it does not
 * become a source.
 */
export function hostOf(raw: string): string | null {
  const text = raw.trim();

  if (!text || /\s/.test(text)) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `https://${text}`;

  try {
    const { hostname } = new URL(candidate);

    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)
      ? hostname.toLowerCase().replace(/^www\./, "")
      : null;
  } catch {
    return null;
  }
}

/*
 * Undefined when there is no address to read, which is the
 * honest answer for a source pinned as a title. The caller
 * draws no badge at all rather than drawing "Unclassified" —
 * there is a difference between "the address says nothing" and
 * "there is no address", and only the first is worth a chip.
 */
export function badgeFor(raw: string): SourceBadge | undefined {
  const host = hostOf(raw);

  if (!host) {
    return undefined;
  }

  for (const [needle, kind] of HOSTS) {
    if (host === needle || host.endsWith(`.${needle}`)) {
      return { kind, ...BADGES[kind] };
    }
  }

  /*
   * A suffix matches a subdomain OR the domain itself.
   *
   * `endsWith(".gov.uk")` alone is false for `gov.uk`, which is
   * not a hypothetical — it is the address of the UK
   * government, and it was landing as "Unclassified" while
   * `data.gov.uk` classified correctly. Same for `europa.eu`
   * and `nhs.uk`. The bare form is the one a student is most
   * likely to paste, so it has to be the one that works.
   *
   * Longest first, so `.ac.uk` is not swallowed by a shorter
   * entry and the most specific label wins.
   */
  const matched = SUFFIXES.filter(
    ([suffix]) => host.endsWith(suffix) || host === suffix.slice(1)
  ).sort((a, b) => b[0].length - a[0].length)[0];

  const kind: SourceKind = matched ? matched[1] : "unknown";

  return { kind, ...BADGES[kind] };
}
