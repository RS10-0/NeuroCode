/*
 * What a published page IS.
 *
 * One JSON document, one schema, and one validator standing in
 * front of the renderer. Everything a student can change about
 * their page is a field in here, and the renderer can display
 * nothing that is not.
 *
 * That sentence is the security model of the whole feature, and
 * it is worth being explicit about why, because the obvious
 * alternative is so much easier to build. If a page were stored
 * as HTML — or as anything a renderer interpolates as markup —
 * then every writer of that HTML becomes a way to put script on
 * BuildGentic's own origin, next to the session cookie of every
 * signed-in learner who happens to visit. Storing a closed
 * document instead means a page cannot contain a tag, because
 * there is nowhere in this file for a tag to live.
 *
 * It is also what makes Phase 2 buildable. A natural-language
 * edit does not generate code; it produces a patch against this
 * document, which goes through `parseSiteConfig` exactly like a
 * form submission does. The model is one more writer of a
 * structure it cannot widen — so "make the background darker"
 * can only ever come out the other side as a different value of
 * `theme.mode`, and a request that has no field to land in has
 * no way to be honoured. Phase 3 is the moment that stops being
 * true, which is precisely why it is a separate phase.
 *
 * Plain TypeScript, no dependencies, imported by both the
 * browser and `server/src` — the same reasoning as slug.ts. The
 * validator that guards the database is literally the function
 * the form obeys.
 */

/* =========================================================
   VERSION

   Stamped on every stored document. Nothing reads it yet
   beyond refusing a number from the future, but a page saved
   today has to still open after the schema grows, and a
   document with no version is a document you cannot migrate
   without guessing what it was.
========================================================= */

export const SITE_CONFIG_VERSION = 1;

/* =========================================================
   CLOSED VOCABULARIES

   Every visual decision is a choice from a list, never a value
   a student types.

   A colour picker would look more generous and would be worse
   in three ways: it lets somebody build white-on-white, it
   lets somebody build a page that looks nothing like BuildGentic
   while sitting on BuildGentic's domain, and — the one that
   matters for Phase 2 — it turns "make it darker" into an
   arithmetic problem over a free value instead of a step along
   a list.
========================================================= */

export const TEMPLATE_IDS = [
  "assistant",
  "study",
  "portfolio",
  "research",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

/*
 * Palettes are hue families, not themes. Light and dark are the
 * `mode` field below, so every palette exists in both and
 * "darker" never costs a student their colour.
 */
export const PALETTE_IDS = [
  "sage",
  "ocean",
  "plum",
  "sand",
  "slate",
  "ember",
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const FONT_PAIRS = ["editorial", "grotesk", "technical"] as const;
export type FontPairId = (typeof FONT_PAIRS)[number];

export const CORNER_STYLES = ["sharp", "soft", "round"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];

export const SECTION_KINDS = [
  "about",
  "features",
  "steps",
  "faq",
  "text",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

/*
 * A small, fixed set of glyphs for feature cards.
 *
 * Names rather than characters, so the renderer maps them to
 * whatever it draws with and a stored page never carries a
 * lucide import or a raw emoji it might not have a font for.
 */
export const SECTION_ICONS = [
  "spark",
  "book",
  "search",
  "chat",
  "file",
  "brain",
  "globe",
  "shield",
  "clock",
  "chart",
  "target",
  "wand",
] as const;

export type SectionIcon = (typeof SECTION_ICONS)[number];

/* =========================================================
   LIMITS

   Exported because the form reads them for its `maxLength`
   attributes and its counters. One definition, so a field that
   accepts 80 characters cannot be a box that offers 120.
========================================================= */

export const LIMITS = {
  headline: 80,
  subtext: 240,
  tagline: 60,
  siteName: 48,
  greeting: 280,
  placeholder: 60,
  prompt: 120,
  prompts: 4,
  sectionTitle: 60,
  sectionBody: 1200,
  itemTitle: 60,
  itemBody: 400,
  question: 140,
  answer: 600,
  items: 8,
  sections: 8,
  footer: 160,
  /* The whole document, serialised. A ceiling on the row rather
     than on any one field, so a page cannot be made enormous by
     being made numerous. */
  totalBytes: 24_000,
} as const;

/* =========================================================
   THE DOCUMENT
========================================================= */

export interface SiteTheme {
  palette: PaletteId;
  mode: ThemeMode;
  font: FontPairId;
  corners: CornerStyle;
}

export interface SiteHero {
  headline: string;
  subtext: string;
  /* Sits under the agent's name. Empty is normal. */
  tagline: string;
  showAvatar: boolean;
}

export interface SiteChat {
  /*
   * A page with the chat switched off is a legitimate page — a
   * portfolio piece describing an agent that is not open to the
   * public yet. It is also the only way a student can publish
   * without their page spending their allowance.
   */
  enabled: boolean;
  /* The agent's opening line. Rendered as an assistant turn
     that was never generated, so it costs nothing. */
  greeting: string;
  placeholder: string;
  /* Buttons that fill the composer. The single most effective
     thing on a page like this: a stranger does not know what to
     ask. */
  suggestedPrompts: string[];
  /*
   * Whether a visitor may attach a file, and OFF by default on
   * purpose even when the agent has file analysis switched on.
   *
   * The asymmetry is deliberate. Everywhere else in BuildGentic a
   * capability flag comes off the stored agent row and the
   * page has no say — see deploymentRequest.ts. This one is a
   * second switch in front of that flag, because a public page
   * means anonymous strangers, and an anonymous stranger
   * uploading documents spends the owner's file allowance on
   * material the owner never authorised. The agent's own
   * capability still has the final word: this can be on and
   * the agent still refuse, never the reverse.
   */
  allowUploads: boolean;
}

export interface FeatureItem {
  id: string;
  icon: SectionIcon;
  title: string;
  body: string;
}

export interface StepItem {
  id: string;
  title: string;
  body: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/*
 * Sections are a discriminated union, and every body is plain
 * text.
 *
 * "Plain text" is load-bearing. The renderer splits on blank
 * lines and emits paragraphs; it never parses markdown and
 * never sets innerHTML. So a body containing a script tag
 * renders as the literal characters of a script tag, which is
 * ugly and harmless, and there is no second code path where it
 * is neither.
 */
export type SiteSection =
  | { id: string; kind: "about"; title: string; body: string }
  | { id: string; kind: "text"; title: string; body: string }
  | { id: string; kind: "features"; title: string; items: FeatureItem[] }
  | { id: string; kind: "steps"; title: string; items: StepItem[] }
  | { id: string; kind: "faq"; title: string; items: FaqItem[] };

export interface SiteConfig {
  version: number;
  template: TemplateId;
  theme: SiteTheme;
  /* What the page calls the agent. Defaults to the agent's own
     name; kept separate so renaming an agent in the Builder
     does not silently retitle a published page. */
  siteName: string;
  hero: SiteHero;
  chat: SiteChat;
  sections: SiteSection[];
  footer: {
    /* "Built with BuildGentic". A student may turn it off; the
       page still says somewhere that it is a student project,
       because a chat box on an unfamiliar domain should. */
    showBadge: boolean;
    note: string;
  };
}

/* =========================================================
   FAILURE

   One error type with a path, because "invalid" on its own is
   useless to a form that has to highlight a field and useless
   to Phase 2, which has to tell a student which part of what
   they asked for could not be done.
========================================================= */

export class SiteConfigError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "SiteConfigError";
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new SiteConfigError(path, message);
}

/* =========================================================
   PRIMITIVES

   Strict readers, used on the write path. Each one refuses
   rather than coerces, because a form submission that is the
   wrong shape is a bug in the form and silently fixing it
   hides that.
========================================================= */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
 * Control characters are stripped rather than refused.
 *
 * Tab, newline and carriage return survive; the rest do not.
 * They arrive from pasted content far more often than from
 * anybody trying anything, and there is no field here where a
 * bell character is what somebody meant. Newlines are then
 * normalised so a body pasted from Windows and one typed on a
 * Mac produce the same paragraphs.
 */
/* The character class here IS control characters — stripping
   them is the point of the function — so the rule has nothing
   useful to say about it. Hoisted to a constant so the
   suppression sits on the line it suppresses and cannot drift
   off it again when the body is reformatted. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function clean(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(CONTROL_CHARS, "");
}

function readString(
  value: unknown,
  path: string,
  max: number,
  { required = false }: { required?: boolean } = {}
): string {
  if (value === undefined || value === null) {
    if (required) {
      fail(path, `${path} is required.`);
    }

    return "";
  }

  if (typeof value !== "string") {
    fail(path, `${path} must be text.`);
  }

  const text = clean(value).trim();

  if (required && !text) {
    fail(path, `${path} cannot be empty.`);
  }

  if (text.length > max) {
    fail(path, `${path} may be at most ${max} characters.`);
  }

  return text;
}

function readBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    fail(path, `${path} must be true or false.`);
  }

  return value;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback: T
): T {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `${path} must be one of: ${allowed.join(", ")}.`);
  }

  return value as T;
}

function readArray(value: unknown, path: string, max: number): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail(path, `${path} must be a list.`);
  }

  if (value.length > max) {
    fail(path, `${path} may hold at most ${max} entries.`);
  }

  return value;
}

/*
 * Ids exist so the editor can reorder and delete without
 * position arithmetic, and so Phase 2 can say "change the
 * second feature" by naming a thing rather than an index.
 *
 * Regenerated rather than trusted: an id is bookkeeping, it is
 * never displayed, and accepting an arbitrary string here would
 * be accepting an arbitrary string into a React `key`.
 */
let idCounter = 0;

export function newSectionId(prefix = "s"): string {
  idCounter += 1;

  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/* =========================================================
   STRICT PARSE — the write path

   Everything that reaches the database goes through here: the
   form, and in Phase 2 the patched document too.
========================================================= */

function parseTheme(value: unknown): SiteTheme {
  const raw = isRecord(value) ? value : {};

  return {
    palette: readEnum(raw.palette, "theme.palette", PALETTE_IDS, "sage"),
    mode: readEnum(raw.mode, "theme.mode", THEME_MODES, "light"),
    font: readEnum(raw.font, "theme.font", FONT_PAIRS, "editorial"),
    corners: readEnum(raw.corners, "theme.corners", CORNER_STYLES, "soft"),
  };
}

function parseHero(value: unknown): SiteHero {
  const raw = isRecord(value) ? value : {};

  return {
    headline: readString(raw.headline, "hero.headline", LIMITS.headline, {
      required: true,
    }),
    subtext: readString(raw.subtext, "hero.subtext", LIMITS.subtext),
    tagline: readString(raw.tagline, "hero.tagline", LIMITS.tagline),
    showAvatar: readBoolean(raw.showAvatar, "hero.showAvatar", true),
  };
}

function parseChat(value: unknown): SiteChat {
  const raw = isRecord(value) ? value : {};

  const prompts = readArray(
    raw.suggestedPrompts,
    "chat.suggestedPrompts",
    LIMITS.prompts
  )
    .map((entry, index) =>
      readString(
        entry,
        `chat.suggestedPrompts[${index}]`,
        LIMITS.prompt
      )
    )
    /* A blank suggestion is a button that does nothing. The
       editor keeps empty rows so a student can type into them;
       the document does not. */
    .filter(Boolean);

  return {
    enabled: readBoolean(raw.enabled, "chat.enabled", true),
    greeting: readString(raw.greeting, "chat.greeting", LIMITS.greeting),
    placeholder: readString(
      raw.placeholder,
      "chat.placeholder",
      LIMITS.placeholder
    ),
    suggestedPrompts: prompts,
    allowUploads: readBoolean(raw.allowUploads, "chat.allowUploads", false),
  };
}

function parseFeatureItem(value: unknown, path: string): FeatureItem {
  const raw = isRecord(value) ? value : {};

  return {
    id: newSectionId("f"),
    icon: readEnum(raw.icon, `${path}.icon`, SECTION_ICONS, "spark"),
    title: readString(raw.title, `${path}.title`, LIMITS.itemTitle, {
      required: true,
    }),
    body: readString(raw.body, `${path}.body`, LIMITS.itemBody),
  };
}

function parseStepItem(value: unknown, path: string): StepItem {
  const raw = isRecord(value) ? value : {};

  return {
    id: newSectionId("t"),
    title: readString(raw.title, `${path}.title`, LIMITS.itemTitle, {
      required: true,
    }),
    body: readString(raw.body, `${path}.body`, LIMITS.itemBody),
  };
}

function parseFaqItem(value: unknown, path: string): FaqItem {
  const raw = isRecord(value) ? value : {};

  return {
    id: newSectionId("q"),
    question: readString(raw.question, `${path}.question`, LIMITS.question, {
      required: true,
    }),
    answer: readString(raw.answer, `${path}.answer`, LIMITS.answer),
  };
}

function parseSection(value: unknown, index: number): SiteSection {
  const path = `sections[${index}]`;
  const raw = isRecord(value) ? value : fail(path, `${path} must be an object.`);

  const kind = readEnum(raw.kind, `${path}.kind`, SECTION_KINDS, "text");
  const title = readString(raw.title, `${path}.title`, LIMITS.sectionTitle);

  if (kind === "features" || kind === "steps" || kind === "faq") {
    const items = readArray(raw.items, `${path}.items`, LIMITS.items);

    if (kind === "features") {
      return {
        id: newSectionId(),
        kind,
        title,
        items: items.map((item, at) =>
          parseFeatureItem(item, `${path}.items[${at}]`)
        ),
      };
    }

    if (kind === "steps") {
      return {
        id: newSectionId(),
        kind,
        title,
        items: items.map((item, at) =>
          parseStepItem(item, `${path}.items[${at}]`)
        ),
      };
    }

    return {
      id: newSectionId(),
      kind,
      title,
      items: items.map((item, at) => parseFaqItem(item, `${path}.items[${at}]`)),
    };
  }

  return {
    id: newSectionId(),
    kind,
    title,
    body: readString(raw.body, `${path}.body`, LIMITS.sectionBody),
  };
}

/*
 * The one door into stored state.
 *
 * Note what it does NOT do: it never copies unknown keys
 * through. The returned object is built field by field from a
 * fixed list, so a document arriving with an extra property
 * loses it here rather than being written to a column that
 * something downstream might one day read.
 */
export function parseSiteConfig(value: unknown): SiteConfig {
  if (!isRecord(value)) {
    fail("config", "A page must be a JSON object.");
  }

  const version =
    typeof value.version === "number" ? value.version : SITE_CONFIG_VERSION;

  if (version > SITE_CONFIG_VERSION) {
    fail(
      "version",
      "This page was saved by a newer version of BuildGentic. Reload before editing it."
    );
  }

  const sections = readArray(value.sections, "sections", LIMITS.sections).map(
    parseSection
  );

  const config: SiteConfig = {
    version: SITE_CONFIG_VERSION,
    template: readEnum(value.template, "template", TEMPLATE_IDS, "assistant"),
    theme: parseTheme(value.theme),
    siteName: readString(value.siteName, "siteName", LIMITS.siteName, {
      required: true,
    }),
    hero: parseHero(value.hero),
    chat: parseChat(value.chat),
    sections,
    footer: {
      showBadge: readBoolean(
        isRecord(value.footer) ? value.footer.showBadge : undefined,
        "footer.showBadge",
        true
      ),
      note: readString(
        isRecord(value.footer) ? value.footer.note : undefined,
        "footer.note",
        LIMITS.footer
      ),
    },
  };

  /*
   * Checked last, on the finished document, because that is the
   * only thing whose size is the size that will be stored. Every
   * field is capped individually above; this catches the case
   * where each one is legal and the sum is not.
   */
  const bytes = JSON.stringify(config).length;

  if (bytes > LIMITS.totalBytes) {
    fail(
      "config",
      "This page has grown too large. Shorten a section or remove one."
    );
  }

  return config;
}

/* =========================================================
   LENIENT READ — the read path

   Same discipline as `rowToAgent` in features/agents/types.ts:
   defensive in one direction only.

   A row can have been written by an older build or edited in
   the SQL console, and a page that will not render is worse
   than a page that renders with a default palette. So reading
   never throws; anything unrecognised falls back.
========================================================= */

export function readSiteConfig(value: unknown, siteName: string): SiteConfig {
  try {
    return parseSiteConfig(value);
  } catch {
    /*
     * Not a silent empty page. A stored document that cannot be
     * parsed still has an agent behind it and still has an
     * address somebody has shared, so it falls back to the
     * default page for that agent — which chats, which is the
     * part that matters — rather than to nothing.
     */
    return defaultSiteConfig({ agentName: siteName });
  }
}

/* =========================================================
   DEFAULTS

   What a student sees the first time, before they have chosen
   anything. It has to be a page they would be willing to
   publish as-is, because many will.
========================================================= */

export interface DefaultsInput {
  agentName: string;
  description?: string;
  template?: TemplateId;
}

export function defaultSiteConfig(input: DefaultsInput): SiteConfig {
  const name = input.agentName.trim().slice(0, LIMITS.siteName) || "My agent";
  const template = input.template ?? "assistant";

  const blurb =
    input.description?.trim().slice(0, LIMITS.subtext) ||
    `${name} is an AI agent built on BuildGentic. Ask it anything below.`;

  return {
    version: SITE_CONFIG_VERSION,
    template,
    theme: TEMPLATE_DEFAULT_THEME[template],
    siteName: name,
    hero: {
      headline: `Meet ${name}`,
      subtext: blurb,
      tagline: "",
      showAvatar: true,
    },
    chat: {
      enabled: true,
      greeting: `Hi — I'm ${name}. What would you like to know?`,
      placeholder: "Ask a question…",
      suggestedPrompts: [],
      allowUploads: false,
    },
    sections: [
      {
        id: newSectionId(),
        kind: "about",
        title: "About",
        body: blurb,
      },
    ],
    footer: { showBadge: true, note: "" },
  };
}

/*
 * Each template opens on the palette it was designed against.
 *
 * A student can change any of it afterwards. The point is that
 * picking "Research project" and getting the sage-on-cream
 * assistant palette would make the templates feel like one
 * layout with the furniture moved, which is exactly the thing
 * these are meant not to be.
 */
export const TEMPLATE_DEFAULT_THEME: Record<TemplateId, SiteTheme> = {
  assistant: {
    palette: "sage",
    mode: "light",
    font: "editorial",
    corners: "soft",
  },
  study: {
    palette: "ocean",
    mode: "light",
    font: "grotesk",
    corners: "round",
  },
  portfolio: {
    palette: "plum",
    mode: "dark",
    font: "editorial",
    corners: "sharp",
  },
  research: {
    palette: "slate",
    mode: "light",
    font: "technical",
    corners: "sharp",
  },
};
