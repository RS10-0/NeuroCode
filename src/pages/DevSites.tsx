import { useMemo, useState } from "react";

import { PALETTE_IDS, TEMPLATE_IDS, THEME_MODES } from "../features/sites/schema";
import type { PaletteId, ThemeMode } from "../features/sites/schema";
import { starterConfig, TEMPLATES } from "../features/sites/templates";
import SiteRenderer from "../features/sites/render/SiteRenderer";
import type { PublicSite } from "../features/sites/publicApi";

/*
 * Developer gallery — every published-page template, rendered
 * with the starter content a student actually gets.
 *
 * Mounted only under `import.meta.env.DEV` and outside the auth
 * gate, exactly like the activities gallery: the four layouts
 * and twelve palette/mode combinations can be looked at without
 * a database, a deployment, or a published page. Not part of
 * the product.
 *
 * It renders the REAL SiteRenderer against the REAL starter
 * config, so what is on screen here is what a visitor gets.
 * The chat is in preview mode and does not send.
 */

const FIXTURE = {
  name: "StudyBuddy",
  description:
    "A revision partner for GCSE biology. It knows the syllabus, marks your practice answers, and tells you what you got wrong.",
  avatarEmoji: "📚",
  avatarTone: "accent" as const,
};

export default function DevSites() {
  const [palette, setPalette] = useState<PaletteId | "per-template">(
    "per-template"
  );
  const [mode, setMode] = useState<ThemeMode | "per-template">("per-template");

  const sites: PublicSite[] = useMemo(
    () =>
      TEMPLATE_IDS.map((template) => {
        const config = starterConfig({
          agentName: FIXTURE.name,
          description: FIXTURE.description,
          template,
        });

        return {
          slug: template,
          config: {
            ...config,
            theme: {
              ...config.theme,
              ...(palette === "per-template" ? {} : { palette }),
              ...(mode === "per-template" ? {} : { mode }),
            },
          },
          agent: {
            name: FIXTURE.name,
            avatarEmoji: FIXTURE.avatarEmoji,
            avatarTone: FIXTURE.avatarTone,
          },
          chatLive: false,
        };
      }),
    [palette, mode]
  );

  return (
    <div style={{ padding: 24, display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)" }}>
          Published page templates
        </h1>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            Palette
            <select
              value={palette}
              onChange={(event) =>
                setPalette(event.target.value as PaletteId | "per-template")
              }
            >
              <option value="per-template">Each template's own</option>
              {PALETTE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            Mode
            <select
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as ThemeMode | "per-template")
              }
            >
              <option value="per-template">Each template's own</option>
              {THEME_MODES.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {sites.map((site) => {
        const template = TEMPLATES.find(
          (entry) => entry.id === site.config.template
        );

        return (
          <section key={site.slug} style={{ display: "grid", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>
              {template?.name}{" "}
              <span style={{ opacity: 0.55, fontWeight: 400 }}>
                — chat: {template?.chatPlacement} · {site.config.theme.palette}/
                {site.config.theme.mode}
              </span>
            </h2>

            <div
              id={`preview-${site.slug}`}
              style={{
                height: 620,
                overflow: "auto",
                border: "1px solid #ddd",
                borderRadius: 10,
                /* Containing block for the portfolio dock's
                   position: fixed, same as the editor's
                   viewport does it. */
                transform: "translateZ(0)",
              }}
            >
              <SiteRenderer site={site} preview />
            </div>
          </section>
        );
      })}
    </div>
  );
}
