import { useState } from "react";

import { PALETTE_IDS, THEME_MODES, type PaletteId, type ThemeMode } from "../schema";

/*
 * A visitor's own tweak to a page they do not own.
 *
 * The owner's palette and mode live in the stored `SiteConfig`
 * and reach here through `config.theme` — changing either is a
 * PATCH to the site editor's endpoint, because it changes what
 * every visitor sees. This is the other case: someone reading
 * the page right now, in their own browser, nudging it toward
 * whatever is easiest on their eyes for this sitting. That has
 * no reason to touch the network at all — it never leaves this
 * browser, so there is nothing to send and nothing to load
 * before it can apply.
 *
 * Same key shape as `visitorKey` in publicApi.ts: the
 * `neurolink.site.` prefix and a per-slug suffix, so a second
 * agent's page does not inherit the first one's colours and a
 * clear of site data forgets this exactly the way it forgets
 * the visitor key.
 */

const STORAGE_PREFIX = "neurolink.site.theme.";

interface StoredOverride {
  palette: PaletteId;
  mode: ThemeMode;
}

function keyFor(slug: string): string {
  return `${STORAGE_PREFIX}${slug}`;
}

function readOverride(slug: string): StoredOverride | null {
  try {
    const raw = window.localStorage.getItem(keyFor(slug));

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const { palette, mode } = parsed as Record<string, unknown>;

    if (
      typeof palette === "string" &&
      typeof mode === "string" &&
      (PALETTE_IDS as readonly string[]).includes(palette) &&
      (THEME_MODES as readonly string[]).includes(mode)
    ) {
      return { palette: palette as PaletteId, mode: mode as ThemeMode };
    }

    return null;
  } catch {
    /* Private mode, or storage disabled. The page still renders
       with the owner's palette — there is simply nothing for a
       visitor to have overridden yet. */
    return null;
  }
}

export interface LocalTheme {
  palette: PaletteId;
  mode: ThemeMode;
  /* Whether what is showing is the visitor's own choice rather
     than the page's default — the reset control only makes
     sense to offer when this is true. */
  overridden: boolean;
  setPalette: (palette: PaletteId) => void;
  setMode: (mode: ThemeMode) => void;
  reset: () => void;
}

/*
 * Resolves to the owner's `base` theme until a visitor changes
 * something, then to whatever they last chose for this slug.
 *
 * Re-reads storage when `slug` changes rather than once at
 * mount, since `SiteRenderer` — and therefore this hook — stays
 * mounted across a client-side navigation between two published
 * pages. Done during render, following the same slug — resets
 * — the React docs give for adjusting state when a prop
 * changes, rather than in an effect: an effect would still be
 * correct, but it would commit the stale slug's palette for one
 * frame before correcting itself.
 */
export function useLocalTheme(
  slug: string,
  base: { palette: PaletteId; mode: ThemeMode }
): LocalTheme {
  const [renderedSlug, setRenderedSlug] = useState(slug);
  const [override, setOverride] = useState<StoredOverride | null>(() =>
    readOverride(slug)
  );

  if (slug !== renderedSlug) {
    setRenderedSlug(slug);
    setOverride(readOverride(slug));
  }

  function write(next: StoredOverride) {
    setOverride(next);

    try {
      window.localStorage.setItem(keyFor(slug), JSON.stringify(next));
    } catch {
      /* Nothing to persist to, so this holds only for the
         current render — no worse than the override not
         existing, and the page is still fully usable. */
    }
  }

  return {
    palette: override?.palette ?? base.palette,
    mode: override?.mode ?? base.mode,
    overridden: override !== null,
    setPalette: (palette) =>
      write({ palette, mode: override?.mode ?? base.mode }),
    setMode: (mode) =>
      write({ palette: override?.palette ?? base.palette, mode }),
    reset: () => {
      setOverride(null);

      try {
        window.localStorage.removeItem(keyFor(slug));
      } catch {
        /* Same as above: the in-memory reset already took
           effect, so the page is correct for this visit even if
           the browser will not remember it for the next one. */
      }
    },
  };
}
