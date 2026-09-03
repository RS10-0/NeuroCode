import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";

import {
  Button,
  Field,
  IconButton,
  Input,
  Textarea,
} from "../../../components/ui";
import { SectionIconGlyph } from "../render/parts";
import {
  LIMITS,
  newSectionId,
  SECTION_ICONS,
  type SectionIcon,
  type SiteConfig,
  type SiteSection,
} from "../schema";

/*
 * Everything a student writes.
 *
 * Every input is capped by the same LIMITS object the validator
 * reads, so a box that accepts eighty characters cannot be a
 * field that stores sixty. That is why the counters are real
 * rather than decorative: they are counting against the number
 * the server will actually enforce.
 *
 * All text, no markup, anywhere. There is no rich-text control
 * here and there will not be one — see the note at the top of
 * schema.ts for what that buys and why it is not negotiable
 * while these pages live on BuildGentic's own origin.
 */

export interface ContentControlsProps {
  config: SiteConfig;
  onPatch: (change: Partial<SiteConfig>) => void;
}

/* A counter that only appears once it is worth reading. Showing
   "3 / 80" under an empty box is noise. */
function Counter({ value, max }: { value: string; max: number }) {
  const used = value.length;

  if (used < max * 0.7) {
    return null;
  }

  return (
    <span
      className={`siteedit__count${used >= max ? " siteedit__count--full" : ""}`}
    >
      {used} / {max}
    </span>
  );
}

export default function ContentControls({
  config,
  onPatch,
}: ContentControlsProps) {
  const setHero = (change: Partial<SiteConfig["hero"]>) =>
    onPatch({ hero: { ...config.hero, ...change } });

  const setChat = (change: Partial<SiteConfig["chat"]>) =>
    onPatch({ chat: { ...config.chat, ...change } });

  const setSections = (sections: SiteSection[]) => onPatch({ sections });

  const replaceSection = (index: number, section: SiteSection) =>
    setSections(config.sections.map((s, i) => (i === index ? section : s)));

  const moveSection = (index: number, delta: number) => {
    const target = index + delta;

    if (target < 0 || target >= config.sections.length) {
      return;
    }

    const next = [...config.sections];

    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
  };

  const addSection = (kind: SiteSection["kind"]) => {
    if (config.sections.length >= LIMITS.sections) {
      return;
    }

    setSections([...config.sections, blankSection(kind)]);
  };

  return (
    <div className="siteedit__stack">
      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Header</h3>

        <Field label="Page name" hint="What the browser tab says.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={config.siteName}
              maxLength={LIMITS.siteName}
              onChange={(event) => onPatch({ siteName: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Headline"
          hint={<Counter value={config.hero.headline} max={LIMITS.headline} />}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={config.hero.headline}
              maxLength={LIMITS.headline}
              onChange={(event) => setHero({ headline: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Subtext"
          hint={
            <>
              One or two sentences under the headline.{" "}
              <Counter value={config.hero.subtext} max={LIMITS.subtext} />
            </>
          }
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={config.hero.subtext}
              maxLength={LIMITS.subtext}
              onChange={(event) => setHero({ subtext: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Tagline"
          hint="A short label above the headline. Optional."
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={config.hero.tagline}
              maxLength={LIMITS.tagline}
              placeholder="Study companion"
              onChange={(event) => setHero({ tagline: event.target.value })}
            />
          )}
        </Field>

        <Toggle
          label="Show the agent's avatar"
          checked={config.hero.showAvatar}
          onChange={(showAvatar) => setHero({ showAvatar })}
        />
      </section>

      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Chat</h3>

        <Toggle
          label="Let visitors chat with this agent"
          hint="Turn this off to publish the page without the conversation. Nothing on it will spend your allowance."
          checked={config.chat.enabled}
          onChange={(enabled) => setChat({ enabled })}
        />

        {config.chat.enabled ? (
          <>
            <Field
              label="Opening message"
              hint={
                <>
                  Shown before anybody types. It costs nothing — the agent
                  does not generate it.{" "}
                  <Counter value={config.chat.greeting} max={LIMITS.greeting} />
                </>
              }
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={config.chat.greeting}
                  maxLength={LIMITS.greeting}
                  onChange={(event) => setChat({ greeting: event.target.value })}
                />
              )}
            </Field>

            <Field label="Placeholder">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={config.chat.placeholder}
                  maxLength={LIMITS.placeholder}
                  placeholder="Ask a question…"
                  onChange={(event) =>
                    setChat({ placeholder: event.target.value })
                  }
                />
              )}
            </Field>

            <PromptList
              prompts={config.chat.suggestedPrompts}
              onChange={(suggestedPrompts) => setChat({ suggestedPrompts })}
            />

            <Toggle
              label="Let visitors attach files"
              hint="Off by default. Anyone with the link could upload documents, and reading them spends your allowance."
              checked={config.chat.allowUploads}
              onChange={(allowUploads) => setChat({ allowUploads })}
            />
          </>
        ) : null}
      </section>

      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Sections</h3>
        <p className="siteedit__grouphint">
          {config.sections.length} of {LIMITS.sections} used.
        </p>

        {config.sections.map((section, index) => (
          <SectionEditor
            key={section.id}
            section={section}
            index={index}
            total={config.sections.length}
            onChange={(next) => replaceSection(index, next)}
            onMove={(delta) => moveSection(index, delta)}
            onRemove={() =>
              setSections(config.sections.filter((_, i) => i !== index))
            }
          />
        ))}

        {config.sections.length < LIMITS.sections ? (
          <div className="siteedit__add">
            {(["about", "features", "steps", "faq", "text"] as const).map(
              (kind) => (
                <Button
                  key={kind}
                  size="sm"
                  icon={<Plus size={14} strokeWidth={2} />}
                  onClick={() => addSection(kind)}
                >
                  {SECTION_LABELS[kind]}
                </Button>
              )
            )}
          </div>
        ) : (
          <p className="siteedit__grouphint">
            That is every section this page can hold. Remove one to add
            another.
          </p>
        )}
      </section>

      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Footer</h3>

        <Toggle
          label={'Show "Built with BuildGentic"'}
          hint="With this off, the page still says it is AI-generated and student-built — a chat box on an unfamiliar page should say what it is."
          checked={config.footer.showBadge}
          onChange={(showBadge) =>
            onPatch({ footer: { ...config.footer, showBadge } })
          }
        />

        <Field label="Footer note" hint="Optional. A credit, a class, a date.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={config.footer.note}
              maxLength={LIMITS.footer}
              onChange={(event) =>
                onPatch({ footer: { ...config.footer, note: event.target.value } })
              }
            />
          )}
        </Field>
      </section>
    </div>
  );
}

/* =========================================================
   PIECES
========================================================= */

const SECTION_LABELS: Record<SiteSection["kind"], string> = {
  about: "About",
  features: "Features",
  steps: "Steps",
  faq: "FAQ",
  text: "Text block",
};

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="siteedit__toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="siteedit__togglelabel">{label}</span>
        {hint ? <span className="siteedit__togglehint">{hint}</span> : null}
      </span>
    </label>
  );
}

function PromptList({
  prompts,
  onChange,
}: {
  prompts: string[];
  onChange: (prompts: string[]) => void;
}) {
  /*
   * Rendered one row longer than the stored list, so there is
   * always an empty box to type into. The blank is dropped by
   * the validator rather than stored, which is why the schema
   * filters empties — the editor's convenience must not become
   * a button on the page that does nothing.
   */
  const rows = prompts.length < LIMITS.prompts ? [...prompts, ""] : prompts;

  return (
    <Field
      label="Suggested questions"
      hint="Buttons a visitor can press instead of thinking of something. The most useful thing on a page a stranger has just opened."
    >
      {({ id, describedBy }) => (
        <div
          className="siteedit__prompts"
          id={id}
          role="group"
          aria-describedby={describedBy}
        >
          {rows.map((prompt, index) => (
            <Input
              key={index}
              value={prompt}
              maxLength={LIMITS.prompt}
              placeholder={index === 0 ? "What can you help me with?" : "Add another…"}
              aria-label={`Suggested question ${index + 1}`}
              onChange={(event) => {
                const next = [...rows];

                next[index] = event.target.value;
                onChange(next.filter((value, at) => value.trim() || at < prompts.length));
              }}
            />
          ))}
        </div>
      )}
    </Field>
  );
}

function SectionEditor({
  section,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  section: SiteSection;
  index: number;
  total: number;
  onChange: (section: SiteSection) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="siteedit__section">
      <header className="siteedit__sectionhead">
        <GripVertical
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className="siteedit__sectiongrip"
        />
        <span className="siteedit__sectionkind">
          {SECTION_LABELS[section.kind]}
        </span>

        <div className="siteedit__sectionactions">
          <IconButton
            label={`Move ${SECTION_LABELS[section.kind]} up`}
            size="sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            icon={<ChevronUp size={15} strokeWidth={2} />}
          />

          <IconButton
            label={`Move ${SECTION_LABELS[section.kind]} down`}
            size="sm"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            icon={<ChevronDown size={15} strokeWidth={2} />}
          />

          <IconButton
            label={`Remove ${SECTION_LABELS[section.kind]}`}
            size="sm"
            onClick={onRemove}
            icon={<Trash2 size={15} strokeWidth={2} />}
          />
        </div>
      </header>

      <Field label="Heading">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={section.title}
            maxLength={LIMITS.sectionTitle}
            onChange={(event) =>
              onChange({ ...section, title: event.target.value })
            }
          />
        )}
      </Field>

      {section.kind === "about" || section.kind === "text" ? (
        <Field
          label="Text"
          hint={
            <>
              Leave a blank line between paragraphs.{" "}
              <Counter value={section.body} max={LIMITS.sectionBody} />
            </>
          }
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={5}
              value={section.body}
              maxLength={LIMITS.sectionBody}
              onChange={(event) =>
                onChange({ ...section, body: event.target.value })
              }
            />
          )}
        </Field>
      ) : null}

      {section.kind === "features" ? (
        <ItemList
          items={section.items}
          max={LIMITS.items}
          onChange={(items) => onChange({ ...section, items })}
          blank={() => ({
            id: newSectionId("f"),
            icon: "spark" as SectionIcon,
            title: "",
            body: "",
          })}
          render={(item, set) => (
            <>
              <Field label="Icon">
                {({ id }) => (
                  <div className="siteedit__icons" id={id}>
                    {SECTION_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        className={`siteedit__icon${
                          item.icon === icon ? " siteedit__icon--active" : ""
                        }`}
                        aria-pressed={item.icon === icon}
                        aria-label={icon}
                        onClick={() => set({ ...item, icon })}
                      >
                        <SectionIconGlyph icon={icon} />
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Title">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={item.title}
                    maxLength={LIMITS.itemTitle}
                    onChange={(event) =>
                      set({ ...item, title: event.target.value })
                    }
                  />
                )}
              </Field>

              <Field label="Text">
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={2}
                    value={item.body}
                    maxLength={LIMITS.itemBody}
                    onChange={(event) =>
                      set({ ...item, body: event.target.value })
                    }
                  />
                )}
              </Field>
            </>
          )}
        />
      ) : null}

      {section.kind === "steps" ? (
        <ItemList
          items={section.items}
          max={LIMITS.items}
          onChange={(items) => onChange({ ...section, items })}
          blank={() => ({ id: newSectionId("t"), title: "", body: "" })}
          render={(item, set) => (
            <>
              <Field label="Step">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={item.title}
                    maxLength={LIMITS.itemTitle}
                    onChange={(event) =>
                      set({ ...item, title: event.target.value })
                    }
                  />
                )}
              </Field>

              <Field label="Detail">
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={2}
                    value={item.body}
                    maxLength={LIMITS.itemBody}
                    onChange={(event) =>
                      set({ ...item, body: event.target.value })
                    }
                  />
                )}
              </Field>
            </>
          )}
        />
      ) : null}

      {section.kind === "faq" ? (
        <ItemList
          items={section.items}
          max={LIMITS.items}
          onChange={(items) => onChange({ ...section, items })}
          blank={() => ({ id: newSectionId("q"), question: "", answer: "" })}
          render={(item, set) => (
            <>
              <Field label="Question">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={item.question}
                    maxLength={LIMITS.question}
                    onChange={(event) =>
                      set({ ...item, question: event.target.value })
                    }
                  />
                )}
              </Field>

              <Field label="Answer">
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    rows={3}
                    value={item.answer}
                    maxLength={LIMITS.answer}
                    onChange={(event) =>
                      set({ ...item, answer: event.target.value })
                    }
                  />
                )}
              </Field>
            </>
          )}
        />
      ) : null}
    </div>
  );
}

/* One list editor for all three item-bearing section kinds. The
   fields differ; adding, removing and reordering do not. */
function ItemList<T extends { id: string }>({
  items,
  max,
  onChange,
  blank,
  render,
}: {
  items: T[];
  max: number;
  onChange: (items: T[]) => void;
  blank: () => T;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div className="siteedit__items">
      {items.map((item, index) => (
        <div className="siteedit__item" key={item.id}>
          <div className="siteedit__itemhead">
            <span className="siteedit__itemnum">{index + 1}</span>

            <IconButton
              label={`Remove item ${index + 1}`}
              size="sm"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              icon={<Trash2 size={14} strokeWidth={2} />}
            />
          </div>

          {render(item, (next) =>
            onChange(items.map((entry, i) => (i === index ? next : entry)))
          )}
        </div>
      ))}

      {items.length < max ? (
        <Button
          size="sm"
          icon={<Plus size={14} strokeWidth={2} />}
          onClick={() => onChange([...items, blank()])}
        >
          Add
        </Button>
      ) : null}
    </div>
  );
}

function blankSection(kind: SiteSection["kind"]): SiteSection {
  switch (kind) {
    case "features":
      return {
        id: newSectionId(),
        kind,
        title: "What it can do",
        items: [{ id: newSectionId("f"), icon: "spark", title: "", body: "" }],
      };

    case "steps":
      return {
        id: newSectionId(),
        kind,
        title: "How to use it",
        items: [{ id: newSectionId("t"), title: "", body: "" }],
      };

    case "faq":
      return {
        id: newSectionId(),
        kind,
        title: "Questions",
        items: [{ id: newSectionId("q"), question: "", answer: "" }],
      };

    case "about":
      return { id: newSectionId(), kind, title: "About", body: "" };

    case "text":
    default:
      return { id: newSectionId(), kind: "text", title: "", body: "" };
  }
}
