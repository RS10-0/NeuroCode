# Deploying BuildGentic

Three services, three different places to configure. This is the whole
picture, then what to do in each one.

```
  learner's browser
        │
        │  buildgentic.com          (Vercel — static SPA build)
        │  vercel.json rewrites /api/* to Render, so every
        │  existing fetch("/api/...") call in src/ keeps
        │  working unchanged — the browser never sees a
        │  cross-origin request for the app itself.
        ▼
  api.buildgentic.com                (Render — the Express server)
        │
        ▼
  Supabase                           (unchanged — Postgres, RLS, auth)
```

The Chrome extension is the one caller that talks to
`api.buildgentic.com` directly rather than through the Vercel rewrite —
see [Chrome extension](#chrome-extension-when-you-publish-it) below.

Nothing in this document is done automatically. It is the checklist for
what to click and paste, once, by hand.

## Vercel — the frontend

1. Import this repository as a new Vercel project. `vercel.json` at the
   repo root already sets the build command (`npm run build`), the output
   directory (`dist`), and the two rewrites described above — Vercel picks
   it up with no further configuration.
2. **Environment variables** (Project Settings → Environment Variables),
   for Production (and Preview, if you want previews to work against the
   same Supabase project):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Copy both from the Supabase project's API settings. These are the only
   two the frontend needs — see `.env.example` at the repo root.
3. **Custom domain** (Project Settings → Domains): add `buildgentic.com`.
   Vercel will show you the exact DNS record to create — see
   [DNS](#dns) below.

## Render — the backend

### Option A — Blueprint

`render.yaml` at the repo root describes the service. In the Render
dashboard: **New → Blueprint**, point it at this repository, and Render
reads the file. It sets the root directory (`server`), build command
(`npm install && npm run build`), start command (`npm start`), and the
health check path (`/api/health`). You will still be prompted for the two
secrets it marks `sync: false`.

### Option B — Manual Web Service

If you'd rather not use the Blueprint: **New → Web Service**, point it at
this repo, and set:
- **Root Directory**: `server`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check Path**: `/api/health`

Render sets `PORT` itself; `server/src/index.ts` already reads
`process.env.PORT`, so nothing needs to change for that.

### Environment variables

**Required** — the server won't do anything useful without these:

| Variable | Value | Why |
| --- | --- | --- |
| `SUPABASE_URL` | your Supabase project URL | database + auth |
| `SUPABASE_SECRET_KEY` | the project's **service role** key | bypasses RLS server-side — keep this out of anywhere a browser can read it |
| `NEUROLINK_ALLOWED_ORIGINS` | `https://buildgentic.com` | CORS — see the warning below |
| `NEUROLINK_PUBLIC_API_URL` | `https://api.buildgentic.com` | what a deployed agent's own endpoint reports itself as |
| `NEUROLINK_PUBLIC_SITE_URL` | `https://buildgentic.com` | what a published agent page's link actually says, instead of localhost |

> **`NEUROLINK_ALLOWED_ORIGINS` does not fail open.** Read
> `server/src/index.ts`'s CORS setup: when this is unset, the server
> assumes it's a dev machine and only widens the allowlist to
> `localhost`/`127.0.0.1`. Deploy without setting it and *every* request
> from `buildgentic.com` gets refused by CORS — not a security hole, but
> a completely broken production site that looks like a network outage.

**Optional** — every one of these already has a working fallback in
`server/src/ai/config.ts` (the app runs on an offline Mock AI provider and
DuckDuckGo web search with none of them set), so add only the ones you
actually want live:

- Model providers: `NEUROLINK_GROQ_API_KEY`, `NEUROLINK_CLOUDFLARE_ACCOUNT_ID`
  + `NEUROLINK_CLOUDFLARE_API_TOKEN`, `NEUROLINK_OPENROUTER_API_KEY`,
  `NEUROLINK_MISTRAL_API_KEY`, `NEUROLINK_GEMINI_API_KEY`
- Web search: `NEUROLINK_BRAVE_SEARCH_KEY` or `NEUROLINK_TAVILY_API_KEY`
  (and `NEUROLINK_WEB_SEARCH_PROVIDER` to pick one)
- Email (scheduled-run notifications): `NEUROLINK_RESEND_API_KEY`,
  `NEUROLINK_MAIL_FROM`
- Every rate limit / budget knob in `server/.env.example` has a sane
  default — only touch these if you specifically want different numbers
  than what ships.

**Not yet:**

- `NEUROLINK_EXTENSION_ORIGIN`: leave unset until the Chrome extension has
  a real published id. See [below](#chrome-extension-when-you-publish-it).
- `NEUROLINK_GMAIL_REDIRECT_URI`: **Gmail OAuth is not being enabled for
  this initial deployment — do not set this.** It only matters once the
  Email Agent's Gmail connection is turned on (`NEUROLINK_GMAIL_CLIENT_ID`
  + `NEUROLINK_GMAIL_CLIENT_SECRET` set). Until then it is inert —
  `server/src/ai/config.ts`'s own comment says "with these unset,
  everything on the Email screen works up to the redirect." When you do
  enable it: set `NEUROLINK_GMAIL_REDIRECT_URI` to
  `https://api.buildgentic.com/api/agents/email/callback` on Render, and
  register that *exact* URL (Google compares it character-for-character)
  in the Google Cloud Console's OAuth client — otherwise it silently keeps
  its default of `http://localhost:3001/api/agents/email/callback`, which
  fails the consent screen with `redirect_uri_mismatch` in production.

### Custom domain

Render → your service → Settings → Custom Domain: add
`api.buildgentic.com`. Render will show the exact CNAME target.

## DNS

Add both records at your domain registrar (or DNS provider) once each
platform's dashboard has shown you the target — the exact values (Vercel's
apex A/ALIAS target, Render's per-service `.onrender.com` hostname) are
assigned per-account and shown live in each dashboard, so treat what
follows as *which record*, not the literal value:

| Host | Type | Points at | Where it's shown |
| --- | --- | --- | --- |
| `buildgentic.com` (apex) | A or ALIAS/ANAME | Vercel's provided target | Vercel → Domains, after adding the domain |
| `api` (→ `api.buildgentic.com`) | CNAME | your Render service's `*.onrender.com` host | Render → Custom Domain, after adding the domain |

If your registrar can't do an apex ALIAS/ANAME record, Vercel's domain
screen offers a `www.buildgentic.com` CNAME + redirect setup instead — it
walks you through whichever your DNS provider supports.

## Supabase dashboard

The app currently has no OAuth or magic-link redirect code (auth is plain
email/password), so there is no code depending on this — but set it
anyway so any future email-based flow doesn't quietly point at localhost:

**Authentication → URL Configuration → Site URL**: `https://buildgentic.com`

## Chrome extension, when you publish it

Not part of this deploy — there is no stable extension id yet, so nothing
here is wired up now. `server/src/index.ts` already has the mechanism
ready (`NEUROLINK_EXTENSION_ORIGIN`, checked independently of
`NEUROLINK_ALLOWED_ORIGINS`); when the extension is published:

1. Add the real id to `extension/manifest.json`'s `host_permissions` and
   `externally_connectable` (see the production snippet already sketched
   in `docs/phase-4-browser-extension.md`).
2. Set `NEUROLINK_EXTENSION_ORIGIN=chrome-extension://<the real id>` on
   Render.
3. Set `VITE_EXTENSION_ID=<the real id>` on Vercel, so the
   `/extension/connect` pairing page can hand the token over.

## Verifying after you deploy

```bash
# The backend answers on its own domain
curl https://api.buildgentic.com/api/health

# CORS is actually configured — run from the browser console on
# https://buildgentic.com, should resolve rather than throw
fetch("https://api.buildgentic.com/api/health").then(r => r.json())
```

- Load `https://buildgentic.com/dashboard` (or any deep route) directly,
  not by clicking through from `/` — confirms the SPA rewrite in
  `vercel.json` is serving `index.html` rather than 404ing.
- Publish an agent and confirm its link reads `https://buildgentic.com/…`,
  not `localhost` — confirms `NEUROLINK_PUBLIC_SITE_URL` took effect.
- Sign up or log in — confirms Supabase auth is reachable and CORS is
  correctly passing the `Authorization` header through.
