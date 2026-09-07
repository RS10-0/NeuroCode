import { useEffect, useRef, useState } from "react";
import { Moon, RotateCcw, Sun, SwatchBook } from "lucide-react";

import { PALETTE_IDS, THEME_MODES, type PaletteId, type ThemeMode } from "../schema";
import type { LocalTheme } from "./useLocalTheme";

/*
 * The visitor's own colour control, not the owner's.
 *
 * `DesignControls` — the editor a student uses to set what
 * EVERYONE sees — writes to the stored document, and that is
 * right for a decision that is supposed to be permanent and
 * shared. This is the opposite of that on every axis: it is for
 * whoever is reading right now, it never leaves this browser,
 * and closing the tab is enough to walk it back — the palette
 * that shows up next time is whatever was chosen last, from
 * `useLocalTheme`, or the owner's own default if nothing was.
 *
 * Six swatches and a light/dark toggle, not a colour picker,
 * for the same reason `DesignControls` stops there: every
 * combination is one of the twelve blocks `sites.css` already
 * defines, so there is no such thing as a choice here that
 * renders badly.
 */

const PALETTE_LABELS: Record<PaletteId, string> = {
  sage: "Sage",
  ocean: "Ocean",
  plum: "Plum",
  sand: "Sand",
  slate: "Slate",
  ember: "Ember",
};

export interface QuickThemeProps {
  theme: LocalTheme;
}

export default function QuickTheme({ theme }: QuickThemeProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="quicktheme" ref={rootRef}>
      <button
        type="button"
        className="quicktheme__toggle"
        aria-expanded={open}
        aria-label="Change how this page looks, just for you"
        title="Change how this page looks, just for you"
        onClick={() => setOpen((value) => !value)}
      >
        <SwatchBook size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {open ? (
        <div className="quicktheme__panel" role="group" aria-label="Page colours">
          <p className="quicktheme__hint">
            Only for you — this stays on your device.
          </p>

          <div className="quicktheme__swatches">
            {PALETTE_IDS.map((palette) => (
              <button
                key={palette}
                type="button"
                className={
                  palette === theme.palette
                    ? "quicktheme__swatch quicktheme__swatch--on"
                    : "quicktheme__swatch"
                }
                aria-pressed={palette === theme.palette}
                title={PALETTE_LABELS[palette]}
                onClick={() => theme.setPalette(palette)}
              >
                <span
                  className="site quicktheme__swatchface"
                  data-palette={palette}
                  data-mode={theme.mode}
                  aria-hidden="true"
                >
                  <span className="quicktheme__swatchaccent" />
                </span>
                <span className="sr-only">{PALETTE_LABELS[palette]}</span>
              </button>
            ))}
          </div>

          <div className="quicktheme__modes" role="group" aria-label="Background">
            {THEME_MODES.map((mode) => (
              <ModeButton
                key={mode}
                mode={mode}
                active={mode === theme.mode}
                onClick={() => theme.setMode(mode)}
              />
            ))}
          </div>

          {theme.overridden ? (
            <button
              type="button"
              className="quicktheme__reset"
              onClick={theme.reset}
            >
              <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
              Use the page's own colours
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ModeButton({
  mode,
  active,
  onClick,
}: {
  mode: ThemeMode;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = mode === "light" ? Sun : Moon;

  return (
    <button
      type="button"
      className={
        active ? "quicktheme__mode quicktheme__mode--on" : "quicktheme__mode"
      }
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {mode === "light" ? "Light" : "Dark"}
    </button>
  );
}
