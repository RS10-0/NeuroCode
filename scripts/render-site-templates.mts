/*
 * Renders the four published-page templates to one standalone
 * HTML file you can open in any browser.
 *
 * A development aid, not part of the product, and it exists for
 * a specific reason: the /dev/sites gallery needs a running Vite
 * server and a browser to look at, and there are situations —
 * a headless machine, a broken preview pane, a screenshot you
 * want to keep — where what you actually want is one file.
 *
 * It renders the REAL SiteRenderer against the REAL starter
 * config through react-dom/server, then inlines the project's
 * own tokens.css and sites.css. So the output is the same
 * markup and the same stylesheet a visitor gets; the only
 * difference is that the fonts come from Google rather than
 * from the bundle, because a standalone file has no bundler.
 *
 * The tsconfig flag is required: esbuild reads the JSX runtime
 * setting from there, and the root tsconfig is a solution file
 * that does not carry it.
 *
 *   npx tsx --tsconfig tsconfig.app.json ./scripts/render-site-templates.mts out.html
 *
 * PALETTE and MODE env vars override the per-template
 * defaults, for looking at one palette across all four.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import SiteRenderer from "../src/features/sites/render/SiteRenderer";
import { starterConfig, TEMPLATES } from "../src/features/sites/templates";
import { TEMPLATE_IDS, type PaletteId, type ThemeMode } from "../src/features/sites/schema";
import type { PublicSite } from "../src/features/sites/publicApi";

const AGENT = {
  name: "StudyBuddy",
  description:
    "A revision partner for GCSE biology. It knows the syllabus, marks your practice answers, and tells you what you got wrong.",
  avatarEmoji: "📚",
  avatarTone: "accent" as const,
};

/* Overrides, so one run can show a palette sweep as well as the
   per-template defaults. */
const palette = process.env.PALETTE as PaletteId | undefined;
const mode = process.env.MODE as ThemeMode | undefined;

function siteFor(template: (typeof TEMPLATE_IDS)[number]): PublicSite {
  const config = starterConfig({
    agentName: AGENT.name,
    description: AGENT.description,
    template,
  });

  return {
    slug: template,
    config: {
      ...config,
      theme: {
        ...config.theme,
        ...(palette ? { palette } : {}),
        ...(mode ? { mode } : {}),
      },
    },
    agent: {
      name: AGENT.name,
      avatarEmoji: AGENT.avatarEmoji,
      avatarTone: AGENT.avatarTone,
    },
    /* The chat renders its offline state, which is what a
       preview shows — and what a static file can honestly
       show, since nothing here can stream. */
    chatLive: false,
  };
}

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const sites = readFileSync("src/styles/sites.css", "utf8");

const blocks = TEMPLATE_IDS.map((id) => {
  const definition = TEMPLATES.find((entry) => entry.id === id);
  const site = siteFor(id);
  const markup = renderToStaticMarkup(
    createElement(SiteRenderer, { site, preview: true })
  );

  return `
    <section class="shot">
      <h2 class="shot__title">
        ${definition?.name}
        <span>chat: ${definition?.chatPlacement} &middot; ${site.config.theme.palette}/${site.config.theme.mode} &middot; ${site.config.theme.font}</span>
      </h2>
      <div class="shot__frame">${markup}</div>
    </section>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuildGentic — published page templates</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap" rel="stylesheet">
<style>
/* The project's own tokens and page stylesheet, inlined. */
${tokens}
${sites}

/* The gallery frame around them. Not part of the feature. */
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #eceae4;
  font-family: var(--font-sans);
  color: #1c1a17;
}
.page { max-width: 1180px; margin: 0 auto; padding: 32px 20px 64px; }
.page > header { margin-bottom: 28px; }
.page > header h1 {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: 30px;
  letter-spacing: -0.02em;
}
.page > header p { margin: 0; color: #5b554b; font-size: 14px; max-width: 70ch; line-height: 1.6; }
.shot { margin-bottom: 36px; }
.shot__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
}
.shot__title span { font-weight: 400; font-size: 12px; color: #7a7469; font-family: var(--font-mono); }
.shot__frame {
  height: 640px;
  overflow: auto;
  border: 1px solid #d6d1c7;
  border-radius: 12px;
  background: #fff;
  /* Containing block for the portfolio dock, exactly as the
     editor's viewport and the gallery both do it. */
  transform: translateZ(0);
}
/* The three fonts are the Google equivalents of the bundled
   variable faces, so the stacks resolve without the bundle. */
:root {
  --font-display: Fraunces, Georgia, serif;
  --font-sans: Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>Published page templates</h1>
    <p>
      The four layouts, rendered from the real components against the
      starter content a student gets. Each frame scrolls. The chat shows
      its offline state, because a static file cannot stream — on a live
      page it answers. The portfolio launcher sits in the corner of its
      own frame.
    </p>
  </header>
${blocks}
</div>
</body>
</html>`;

const out = process.argv[2] ?? "site-templates.html";

writeFileSync(out, html, "utf8");

console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
