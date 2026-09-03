import { Check } from "lucide-react";

import { Field, SegmentedControl } from "../../../components/ui";
import {
  CORNER_STYLES,
  FONT_PAIRS,
  PALETTE_IDS,
  THEME_MODES,
  type CornerStyle,
  type FontPairId,
  type PaletteId,
  type SiteConfig,
  type TemplateId,
  type ThemeMode,
} from "../schema";
import { TEMPLATES } from "../templates";

/*
 * Every visual decision a student can make, and it is a short
 * list on purpose.
 *
 * There is no colour picker here, and its absence is the design
 * rather than an omission. A free colour lets somebody build
 * white-on-white; it lets somebody build a page that looks
 * nothing like anything while sitting on BuildGentic's domain;
 * and — the reason that matters most for what comes next — it
 * turns "make it darker" into arithmetic over an unbounded
 * value instead of a step along a list. Every control below
 * writes one enum into the stored document.
 */

export interface DesignControlsProps {
  config: SiteConfig;
  onTemplate: (template: TemplateId) => void;
  onTheme: (theme: Partial<SiteConfig["theme"]>) => void;
}

const PALETTE_LABELS: Record<PaletteId, string> = {
  sage: "Sage",
  ocean: "Ocean",
  plum: "Plum",
  sand: "Sand",
  slate: "Slate",
  ember: "Ember",
};

const FONT_LABELS: Record<FontPairId, string> = {
  editorial: "Editorial",
  grotesk: "Modern",
  technical: "Technical",
};

const CORNER_LABELS: Record<CornerStyle, string> = {
  sharp: "Sharp",
  soft: "Soft",
  round: "Round",
};

const MODE_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
};

export default function DesignControls({
  config,
  onTemplate,
  onTheme,
}: DesignControlsProps) {
  return (
    <div className="siteedit__stack">
      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Layout</h3>
        <p className="siteedit__grouphint">
          These are four different pages, not four colour schemes. What
          changes most is where the chat sits.
        </p>

        <div className="siteedit__templates">
          {TEMPLATES.map((template) => {
            const active = template.id === config.template;

            return (
              <button
                key={template.id}
                type="button"
                className={`siteedit__template${
                  active ? " siteedit__template--active" : ""
                }`}
                onClick={() => onTemplate(template.id)}
                aria-pressed={active}
              >
                <TemplateSketch id={template.id} />

                <span className="siteedit__templatename">
                  {template.name}
                  {active ? (
                    <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                  ) : null}
                </span>

                <span className="siteedit__templateblurb">
                  {template.blurb}
                </span>
              </button>
            );
          })}
        </div>

        <p className="siteedit__grouphint">
          Switching keeps everything you have written. Only the arrangement
          and the starting colours change.
        </p>
      </section>

      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Colour</h3>

        <div className="siteedit__palettes" role="group" aria-label="Palette">
          {PALETTE_IDS.map((palette) => {
            const active = palette === config.theme.palette;

            return (
              <button
                key={palette}
                type="button"
                className={`siteedit__palette${
                  active ? " siteedit__palette--active" : ""
                }`}
                onClick={() => onTheme({ palette })}
                aria-pressed={active}
                title={PALETTE_LABELS[palette]}
              >
                {/*
                 * The swatch is the real palette, not an
                 * approximation of it: a `.site` wrapper carrying
                 * the same two data attributes the published page
                 * carries, so the three blocks below are literally
                 * the tokens that page will use. A hardcoded hex
                 * here would drift from sites.css the first time
                 * either changed.
                 */}
                <span
                  className="site siteedit__swatch"
                  data-palette={palette}
                  data-mode={config.theme.mode}
                  aria-hidden="true"
                >
                  <span className="siteedit__swatchcanvas" />
                  <span className="siteedit__swatchaccent" />
                  <span className="siteedit__swatchink" />
                </span>

                <span className="siteedit__palettename">
                  {PALETTE_LABELS[palette]}
                </span>
              </button>
            );
          })}
        </div>

        <Field label="Background">
          {() => (
            <SegmentedControl
              label="Background"
              options={THEME_MODES.map((mode) => ({
                value: mode,
                label: MODE_LABELS[mode],
              }))}
              value={config.theme.mode}
              onChange={(mode) => onTheme({ mode })}
            />
          )}
        </Field>
      </section>

      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Type and shape</h3>

        <Field label="Typeface">
          {() => (
            <SegmentedControl
              label="Typeface"
              options={FONT_PAIRS.map((font) => ({
                value: font,
                label: FONT_LABELS[font],
              }))}
              value={config.theme.font}
              onChange={(font) => onTheme({ font })}
            />
          )}
        </Field>

        <Field label="Corners">
          {() => (
            <SegmentedControl
              label="Corners"
              options={CORNER_STYLES.map((corners) => ({
                value: corners,
                label: CORNER_LABELS[corners],
              }))}
              value={config.theme.corners}
              onChange={(corners) => onTheme({ corners })}
            />
          )}
        </Field>
      </section>
    </div>
  );
}

/*
 * A twelve-line drawing of each layout.
 *
 * Worth the markup because the names alone do not distinguish
 * them — "Study Tool" and "AI Assistant" sound like the same
 * thing until you see that one has a sidebar. The accent block
 * in each is the chat, which is the actual difference between
 * the four.
 */
function TemplateSketch({ id }: { id: TemplateId }) {
  return (
    <span className={`siteedit__sketch siteedit__sketch--${id}`} aria-hidden="true">
      {id === "assistant" ? (
        <>
          <i className="siteedit__sk siteedit__sk--bar" />
          <i className="siteedit__sk siteedit__sk--chat" />
          <i className="siteedit__sk siteedit__sk--row" />
        </>
      ) : null}

      {id === "study" ? (
        <>
          <i className="siteedit__sk siteedit__sk--rail" />
          <i className="siteedit__sk siteedit__sk--chat siteedit__sk--tall" />
        </>
      ) : null}

      {id === "portfolio" ? (
        <>
          <i className="siteedit__sk siteedit__sk--hero" />
          <i className="siteedit__sk siteedit__sk--row" />
          <i className="siteedit__sk siteedit__sk--row" />
          <i className="siteedit__sk siteedit__sk--dot" />
        </>
      ) : null}

      {id === "research" ? (
        <>
          <i className="siteedit__sk siteedit__sk--toc" />
          <i className="siteedit__sk siteedit__sk--doc" />
        </>
      ) : null}
    </span>
  );
}
