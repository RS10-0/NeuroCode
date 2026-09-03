/*
 * Natural language, resolved to field changes.
 *
 * The whole of Phase 2 rests on one decision made in this file:
 * the model does not write a page, and it does not write a
 * `SiteConfig` either. It writes a list of OPERATIONS from the
 * closed vocabulary below, and this file turns those into a new
 * document — which then goes through `parseSiteConfig` exactly
 * like a form submission.
 *
 * Two gates rather than one, and they catch different things.
 * The operation vocabulary bounds WHAT can be asked for: there
 * is no operation meaning "insert this HTML", so no output can
 * mean that however the model is prompted. The schema then
 * bounds WHAT THE RESULT MAY BE: every string capped, every
 * enum closed, the whole document size-limited. A model that
 * ignores its instructions entirely produces something that
 * fails to parse as an operation, and a model that produces
 * valid operations with absurd contents produces a document
 * the schema refuses.
 *
 * The gap this leaves is the honest one, and it is the gap the
 * brief asks about. A request like "put my logo in the corner"
 * or "make the hero a video" has no field to land in. It does
 * not get approximated and it does not get half-done: it comes
 * back as `unsupported`, with a reason, and the student is told
 * that it needs the thing which is not built yet. Widening this
 * vocabulary until such a request lands somewhere is how Phase
 * 2 turns into Phase 3 by accident, so the vocabulary is
 * deliberately shorter than the set of things people will ask
 * for.
 *
 * Sections are addressed by POSITION, one-based, not by id. The
 * model is shown a numbered list and says "3"; it never sees or
 * invents an internal id. That is both safer — an id it made up
 * cannot silently match a real row — and closer to how somebody
 * actually talks about their own page.
 *
 * Plain TypeScript, no dependencies, shared by the browser and
 * the server like the rest of this directory.
 */

import {
  CORNER_STYLES,
  FONT_PAIRS,
  LIMITS,
  newSectionId,
  PALETTE_IDS,
  SECTION_ICONS,
  SECTION_KINDS,
  TEMPLATE_IDS,
  THEME_MODES,
  type SectionIcon,
  type SiteConfig,
  type SiteSection,
} from "./schema";

/* =========================================================
   THE VOCABULARY
========================================================= */

export type SiteEdit =
  | { op: "set_template"; template: SiteConfig["template"] }
  | {
      op: "set_theme";
      palette?: SiteConfig["theme"]["palette"];
      mode?: SiteConfig["theme"]["mode"];
      font?: SiteConfig["theme"]["font"];
      corners?: SiteConfig["theme"]["corners"];
    }
  | { op: "set_name"; siteName: string }
  | {
      op: "set_hero";
      headline?: string;
      subtext?: string;
      tagline?: string;
      showAvatar?: boolean;
    }
  | {
      op: "set_chat";
      enabled?: boolean;
      greeting?: string;
      placeholder?: string;
      suggestedPrompts?: string[];
      allowUploads?: boolean;
    }
  | { op: "set_footer"; showBadge?: boolean; note?: string }
  | {
      op: "add_section";
      kind: SiteSection["kind"];
      title: string;
      body?: string;
      items?: EditItem[];
    }
  | {
      op: "update_section";
      ref: number;
      title?: string;
      body?: string;
      items?: EditItem[];
    }
  | { op: "remove_section"; ref: number }
  | { op: "move_section"; ref: number; direction: "up" | "down" };

/* One shape for all three item-bearing section kinds. Which
   fields matter depends on the kind, and `buildItems` below
   picks them out — the model is told the right names for the
   kind it is working on. */
export interface EditItem {
  icon?: string;
  title?: string;
  body?: string;
  question?: string;
  answer?: string;
}

export interface EditPlan {
  edits: SiteEdit[];
  /*
   * What the request asked for that no field can express.
   *
   * The most important field here. A plan may be entirely
   * unsupported, or partly — "make it darker and add my logo"
   * is one theme change and one thing that cannot be done — and
   * the student has to be told which half happened.
   */
  unsupported: string[];
  /* One sentence, in the student's terms, for the UI to show. */
  summary: string;
}

/* =========================================================
   PARSING WHAT THE MODEL SAID

   Strict, and silent about what it drops. An operation that is
   not in the vocabulary is not an error to report back to the
   model — it is a line that never happened.
========================================================= */

export class EditPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditPlanError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim();

  /* Truncated rather than refused. The model overrunning a
     length by three characters should cost the student the
     three characters, not the whole edit. */
  return text ? text.slice(0, max) : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function ref(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

/* Drops keys whose value did not survive its own reader, so an
   operation never carries `undefined` into the applier. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}

function buildItems(raw: unknown): EditItem[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.slice(0, LIMITS.items).map((entry) => {
    const item = isRecord(entry) ? entry : {};

    return compact({
      icon: enumValue(item.icon, SECTION_ICONS),
      title: str(item.title, LIMITS.itemTitle),
      body: str(item.body, LIMITS.itemBody),
      question: str(item.question, LIMITS.question),
      answer: str(item.answer, LIMITS.answer),
    });
  });
}

function parseEdit(raw: unknown): SiteEdit | null {
  if (!isRecord(raw)) {
    return null;
  }

  switch (raw.op) {
    case "set_template": {
      const template = enumValue(raw.template, TEMPLATE_IDS);

      return template ? { op: "set_template", template } : null;
    }

    case "set_theme": {
      const edit = compact({
        op: "set_theme" as const,
        palette: enumValue(raw.palette, PALETTE_IDS),
        mode: enumValue(raw.mode, THEME_MODES),
        font: enumValue(raw.font, FONT_PAIRS),
        corners: enumValue(raw.corners, CORNER_STYLES),
      });

      /* An operation that changes nothing is noise in the
         summary the student reads. */
      return Object.keys(edit).length > 1 ? edit : null;
    }

    case "set_name": {
      const siteName = str(raw.siteName, LIMITS.siteName);

      return siteName ? { op: "set_name", siteName } : null;
    }

    case "set_hero": {
      const edit = compact({
        op: "set_hero" as const,
        headline: str(raw.headline, LIMITS.headline),
        subtext: str(raw.subtext, LIMITS.subtext),
        tagline: str(raw.tagline, LIMITS.tagline),
        showAvatar: bool(raw.showAvatar),
      });

      return Object.keys(edit).length > 1 ? edit : null;
    }

    case "set_chat": {
      const prompts = Array.isArray(raw.suggestedPrompts)
        ? raw.suggestedPrompts
            .slice(0, LIMITS.prompts)
            .map((entry) => str(entry, LIMITS.prompt))
            .filter((entry): entry is string => Boolean(entry))
        : undefined;

      const edit = compact({
        op: "set_chat" as const,
        enabled: bool(raw.enabled),
        greeting: str(raw.greeting, LIMITS.greeting),
        placeholder: str(raw.placeholder, LIMITS.placeholder),
        suggestedPrompts: prompts,
        allowUploads: bool(raw.allowUploads),
      });

      return Object.keys(edit).length > 1 ? edit : null;
    }

    case "set_footer": {
      const edit = compact({
        op: "set_footer" as const,
        showBadge: bool(raw.showBadge),
        note: str(raw.note, LIMITS.footer),
      });

      return Object.keys(edit).length > 1 ? edit : null;
    }

    case "add_section": {
      const kind = enumValue(raw.kind, SECTION_KINDS);
      const title = str(raw.title, LIMITS.sectionTitle);

      if (!kind) {
        return null;
      }

      return compact({
        op: "add_section" as const,
        kind,
        title: title ?? "",
        body: str(raw.body, LIMITS.sectionBody),
        items: buildItems(raw.items),
      });
    }

    case "update_section": {
      const at = ref(raw.ref);

      if (at === undefined) {
        return null;
      }

      const edit = compact({
        op: "update_section" as const,
        ref: at,
        title: str(raw.title, LIMITS.sectionTitle),
        body: str(raw.body, LIMITS.sectionBody),
        items: buildItems(raw.items),
      });

      return Object.keys(edit).length > 2 ? edit : null;
    }

    case "remove_section": {
      const at = ref(raw.ref);

      return at === undefined ? null : { op: "remove_section", ref: at };
    }

    case "move_section": {
      const at = ref(raw.ref);
      const direction = enumValue(raw.direction, ["up", "down"] as const);

      return at === undefined || !direction
        ? null
        : { op: "move_section", ref: at, direction };
    }

    default:
      /* An operation this vocabulary does not have. Dropped
         rather than reported: the model inventing one is
         exactly the case the closed list exists to absorb. */
      return null;
  }
}

/*
 * The model's whole answer.
 *
 * Everything unrecognised is dropped rather than throwing,
 * because a plan with three good operations and one invented
 * one should apply the three. What DOES throw is a response
 * that is not a plan at all — that is a model failure the
 * student needs told about rather than silently absorbed as
 * "nothing to do".
 */
export function parseEditPlan(raw: unknown): EditPlan {
  if (!isRecord(raw)) {
    throw new EditPlanError("The assistant did not answer in a usable form.");
  }

  const edits = Array.isArray(raw.edits)
    ? raw.edits
        .map(parseEdit)
        .filter((edit): edit is SiteEdit => edit !== null)
        /* A ceiling, so one request cannot rewrite the entire
           page in a single unreviewable step. */
        .slice(0, 12)
    : [];

  const unsupported = Array.isArray(raw.unsupported)
    ? raw.unsupported
        .map((entry) => str(entry, 200))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 4)
    : [];

  return {
    edits,
    unsupported,
    summary: str(raw.summary, 240) ?? "",
  };
}

/* =========================================================
   APPLYING

   Pure: takes a config, returns a new one, mutates nothing.
   The caller runs the result through `parseSiteConfig`, which
   is where anything the operations produced that the schema
   dislikes is refused.
========================================================= */

function applyItems(
  section: SiteSection,
  items: EditItem[]
): SiteSection {
  switch (section.kind) {
    case "features":
      return {
        ...section,
        items: items.map((item, index) => ({
          id: section.items[index]?.id ?? newSectionId("f"),
          icon: (item.icon as SectionIcon | undefined) ??
            section.items[index]?.icon ??
            "spark",
          title: item.title ?? section.items[index]?.title ?? "",
          body: item.body ?? section.items[index]?.body ?? "",
        })),
      };

    case "steps":
      return {
        ...section,
        items: items.map((item, index) => ({
          id: section.items[index]?.id ?? newSectionId("t"),
          title: item.title ?? section.items[index]?.title ?? "",
          body: item.body ?? section.items[index]?.body ?? "",
        })),
      };

    case "faq":
      return {
        ...section,
        items: items.map((item, index) => ({
          id: section.items[index]?.id ?? newSectionId("q"),
          question:
            item.question ?? item.title ?? section.items[index]?.question ?? "",
          answer: item.answer ?? item.body ?? section.items[index]?.answer ?? "",
        })),
      };

    /* A body-bearing section given items. The model was told
       the wrong shape; there is nothing sensible to do with
       them, so they are ignored and the section is unchanged. */
    default:
      return section;
  }
}

function newSection(edit: Extract<SiteEdit, { op: "add_section" }>): SiteSection {
  const base = { id: newSectionId(), title: edit.title };

  switch (edit.kind) {
    case "features":
      return {
        ...base,
        kind: "features",
        items: (edit.items ?? []).map((item) => ({
          id: newSectionId("f"),
          icon: (item.icon as SectionIcon | undefined) ?? "spark",
          title: item.title ?? "",
          body: item.body ?? "",
        })),
      };

    case "steps":
      return {
        ...base,
        kind: "steps",
        items: (edit.items ?? []).map((item) => ({
          id: newSectionId("t"),
          title: item.title ?? "",
          body: item.body ?? "",
        })),
      };

    case "faq":
      return {
        ...base,
        kind: "faq",
        items: (edit.items ?? []).map((item) => ({
          id: newSectionId("q"),
          question: item.question ?? item.title ?? "",
          answer: item.answer ?? item.body ?? "",
        })),
      };

    case "about":
      return { ...base, kind: "about", body: edit.body ?? "" };

    case "text":
    default:
      return { ...base, kind: "text", body: edit.body ?? "" };
  }
}

export function applyEdits(
  config: SiteConfig,
  edits: SiteEdit[]
): SiteConfig {
  let next = config;

  for (const edit of edits) {
    switch (edit.op) {
      case "set_template":
        next = { ...next, template: edit.template };
        break;

      case "set_theme":
        next = {
          ...next,
          theme: {
            ...next.theme,
            ...(edit.palette ? { palette: edit.palette } : {}),
            ...(edit.mode ? { mode: edit.mode } : {}),
            ...(edit.font ? { font: edit.font } : {}),
            ...(edit.corners ? { corners: edit.corners } : {}),
          },
        };
        break;

      case "set_name":
        next = { ...next, siteName: edit.siteName };
        break;

      case "set_hero":
        next = {
          ...next,
          hero: {
            ...next.hero,
            ...(edit.headline !== undefined ? { headline: edit.headline } : {}),
            ...(edit.subtext !== undefined ? { subtext: edit.subtext } : {}),
            ...(edit.tagline !== undefined ? { tagline: edit.tagline } : {}),
            ...(edit.showAvatar !== undefined
              ? { showAvatar: edit.showAvatar }
              : {}),
          },
        };
        break;

      case "set_chat":
        next = {
          ...next,
          chat: {
            ...next.chat,
            ...(edit.enabled !== undefined ? { enabled: edit.enabled } : {}),
            ...(edit.greeting !== undefined ? { greeting: edit.greeting } : {}),
            ...(edit.placeholder !== undefined
              ? { placeholder: edit.placeholder }
              : {}),
            ...(edit.suggestedPrompts !== undefined
              ? { suggestedPrompts: edit.suggestedPrompts }
              : {}),
            ...(edit.allowUploads !== undefined
              ? { allowUploads: edit.allowUploads }
              : {}),
          },
        };
        break;

      case "set_footer":
        next = {
          ...next,
          footer: {
            ...next.footer,
            ...(edit.showBadge !== undefined
              ? { showBadge: edit.showBadge }
              : {}),
            ...(edit.note !== undefined ? { note: edit.note } : {}),
          },
        };
        break;

      case "add_section":
        /* Silently capped rather than refused. The schema would
           refuse the ninth section anyway, and refusing the
           whole plan because one operation overflowed would
           throw away the rest of what the student asked for. */
        if (next.sections.length < LIMITS.sections) {
          next = { ...next, sections: [...next.sections, newSection(edit)] };
        }
        break;

      case "update_section": {
        const index = edit.ref - 1;
        const target = next.sections[index];

        if (!target) {
          break;
        }

        let updated: SiteSection =
          edit.title !== undefined ? { ...target, title: edit.title } : target;

        if (edit.body !== undefined) {
          /* Only the body-bearing kinds have somewhere to put
             it; giving a features section a body is the model
             using the wrong shape and is ignored. */
          if (updated.kind === "about" || updated.kind === "text") {
            updated = { ...updated, body: edit.body };
          }
        }

        if (edit.items !== undefined) {
          updated = applyItems(updated, edit.items);
        }

        next = {
          ...next,
          sections: next.sections.map((section, at) =>
            at === index ? updated : section
          ),
        };
        break;
      }

      case "remove_section": {
        const index = edit.ref - 1;

        if (next.sections[index]) {
          next = {
            ...next,
            sections: next.sections.filter((_, at) => at !== index),
          };
        }
        break;
      }

      case "move_section": {
        const index = edit.ref - 1;
        const target = index + (edit.direction === "up" ? -1 : 1);

        if (next.sections[index] && next.sections[target]) {
          const sections = [...next.sections];

          [sections[index], sections[target]] = [
            sections[target],
            sections[index],
          ];

          next = { ...next, sections };
        }
        break;
      }
    }
  }

  return next;
}

/* =========================================================
   DESCRIBING

   Both directions: the page as the model is shown it, and the
   operations as the student is shown them.
========================================================= */

/*
 * The current page, as a compact outline.
 *
 * Deliberately not the raw JSON. The model does not need ids,
 * does not need the version, and must not be encouraged to
 * think in terms of a document it could hand back wholesale —
 * it is being asked for a small list of changes to a thing it
 * can see, and showing it a numbered outline is what makes
 * "the third section" a phrase with a referent.
 */
export function describeConfig(config: SiteConfig): string {
  const lines: string[] = [
    `Template: ${config.template}`,
    `Theme: palette=${config.theme.palette}, mode=${config.theme.mode}, font=${config.theme.font}, corners=${config.theme.corners}`,
    `Page name: ${config.siteName}`,
    `Headline: ${config.hero.headline}`,
    `Subtext: ${config.hero.subtext || "(empty)"}`,
    `Tagline: ${config.hero.tagline || "(empty)"}`,
    `Avatar shown: ${config.hero.showAvatar}`,
    `Chat: ${config.chat.enabled ? "on" : "off"}, greeting="${config.chat.greeting}", placeholder="${config.chat.placeholder}", uploads=${config.chat.allowUploads}`,
    `Suggested questions: ${
      config.chat.suggestedPrompts.length
        ? config.chat.suggestedPrompts.map((p) => `"${p}"`).join(", ")
        : "(none)"
    }`,
    `Footer: badge=${config.footer.showBadge}, note="${config.footer.note}"`,
    "",
    `Sections (${config.sections.length} of ${LIMITS.sections}):`,
  ];

  config.sections.forEach((section, index) => {
    lines.push(`  ${index + 1}. [${section.kind}] ${section.title || "(untitled)"}`);

    if (section.kind === "about" || section.kind === "text") {
      lines.push(`     body: ${truncate(section.body, 160)}`);
    } else {
      section.items.forEach((item, at) => {
        const label =
          "question" in item
            ? `${item.question} / ${truncate(item.answer, 60)}`
            : `${item.title} / ${truncate(item.body, 60)}`;

        lines.push(`     ${index + 1}.${at + 1} ${label}`);
      });
    }
  });

  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();

  return clean.length > max ? `${clean.slice(0, max)}…` : clean || "(empty)";
}

/*
 * One operation, in the student's words.
 *
 * Written from the operation rather than taken from the model's
 * own summary, so what the student is shown is what actually
 * happened rather than what the model said it would do. A model
 * that claims to have changed the headline and emitted a theme
 * change is caught by reading this list.
 */
export function describeEdit(edit: SiteEdit): string {
  switch (edit.op) {
    case "set_template":
      return `Switched the layout to ${edit.template}`;

    case "set_theme": {
      const parts: string[] = [];

      if (edit.palette) parts.push(`colour to ${edit.palette}`);
      if (edit.mode) parts.push(`background to ${edit.mode}`);
      if (edit.font) parts.push(`typeface to ${edit.font}`);
      if (edit.corners) parts.push(`corners to ${edit.corners}`);

      return `Changed the ${parts.join(", ")}`;
    }

    case "set_name":
      return `Renamed the page to "${edit.siteName}"`;

    case "set_hero": {
      const parts: string[] = [];

      if (edit.headline !== undefined) parts.push("headline");
      if (edit.subtext !== undefined) parts.push("subtext");
      if (edit.tagline !== undefined) parts.push("tagline");
      if (edit.showAvatar !== undefined) {
        parts.push(edit.showAvatar ? "showed the avatar" : "hid the avatar");
      }

      return `Updated the ${parts.join(", ")}`;
    }

    case "set_chat": {
      if (edit.enabled === false) return "Turned the chat off";
      if (edit.enabled === true) return "Turned the chat on";
      if (edit.suggestedPrompts) {
        return `Set ${edit.suggestedPrompts.length} suggested question${
          edit.suggestedPrompts.length === 1 ? "" : "s"
        }`;
      }
      if (edit.allowUploads !== undefined) {
        return edit.allowUploads
          ? "Allowed visitors to attach files"
          : "Stopped visitors attaching files";
      }
      if (edit.greeting !== undefined) return "Rewrote the opening message";

      return "Updated the chat settings";
    }

    case "set_footer":
      return edit.showBadge !== undefined
        ? edit.showBadge
          ? "Showed the BuildGentic badge"
          : "Hid the BuildGentic badge"
        : "Updated the footer note";

    case "add_section":
      return `Added a ${edit.kind} section${edit.title ? `: "${edit.title}"` : ""}`;

    case "update_section":
      return `Updated section ${edit.ref}`;

    case "remove_section":
      return `Removed section ${edit.ref}`;

    case "move_section":
      return `Moved section ${edit.ref} ${edit.direction}`;
  }
}
