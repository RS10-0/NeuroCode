# Deploying BuildGentic

Three services, three different places to configure. This is the whole
picture, then what to do in each one.

```
  learner's browser
        │
        │  www.buildgentic.com      (Vercel — static SPA build)
        │  the apex 308-redirects here, so www is the origin
        │  everything else has to name.
        │
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

### The two `/api` rewrites, and why there are two

`vercel.json` forwards `/api/*` to Render with **two** rules, not one:

```json
{ "source": "/api/:path*",    "destination": "https://api.buildgentic.com/api/:path*" },
{ "source": "/api/:rest(.*)", "destination": "https://api.buildgentic.com/api/:rest" },
{ "source": "/(.*)",          "destination": "/index.html" }
```

The first is the real rule. The second is a safety net, and it is there
because **`:path*` does not match a trailing slash**. A request to
`/api/schedules/` leaves an empty final segment, misses rule 1, and falls
through to the SPA catch-all — where Vercel answers a POST to a static
`index.html` with `405 Method Not Allowed`.

That failure is close to undebuggable from the server side. The request
never leaves Vercel, so there is no route error, no CORS error, and
nothing at all in the Render log. The browser sees a 405 with no
content-type and a fragment of HTML where the JSON error should be. It
cost two separate debugging sessions before anyone looked at the CDN.

`:rest(.*)` matches whatever rule 1 missed, trailing slashes included, and
forwards the path unchanged; Express's default non-strict routing then
treats `/api/schedules/` and `/api/schedules` as the same route. The rule
is deliberately additive — it can only catch requests that were already
going to the wrong place — so the worst case is that it changes nothing.

**If you ever restructure these rules, keep the invariant:** no `/api`
request may reach the `/(.*)` fallback. Check it with a POST to a path
with a trailing slash — a 401 means it reached the API, a 405 means it
did not.

The Chrome extension is the one caller that talks to
`api.buildgentic.com` directly rather than through the Vercel rewrite —
see [Chrome extension](#chrome-extension) below.

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
| `NEUROLINK_ALLOWED_ORIGINS` | `https://www.buildgentic.com,https://buildgentic.com` | CORS — see the two warnings below |
| `NEUROLINK_PUBLIC_API_URL` | `https://api.buildgentic.com` | what a deployed agent's own endpoint reports itself as |
| `NEUROLINK_PUBLIC_SITE_URL` | `https://www.buildgentic.com` | what a published agent page's link actually says, instead of localhost |
| `NEUROLINK_SECRET_KEY` | 32 random bytes as hex — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | seals every credential a learner connects (API keys, Gmail refresh tokens) before it is stored |

> **`NEUROLINK_ALLOWED_ORIGINS` does not fail open.** Read
> `server/src/index.ts`'s CORS setup: when this is unset, the server
> assumes it's a dev machine and only widens the allowlist to
> `localhost`/`127.0.0.1`. Deploy without setting it and *every* request
> from the site gets refused by CORS — not a security hole, but a
> completely broken production site that looks like a network outage.

> **Note the `www.`, and that it is first.** The apex `buildgentic.com`
> answers every path with a 308 redirect to `www.buildgentic.com`, so the
> origin a browser actually presents is the `www` one. An allowlist naming
> only the apex is an allowlist naming the one origin that never appears.
> The apex is kept in the list purely so that this stops being a trap if
> the redirect is ever removed.
>
> This does not currently break the site, and the reason is worth knowing
> before you go looking: `vercel.json` rewrites `/api/*` to the Render
> service **server-side**, so the browser's own request is same-origin and
> reaches the API with no `Origin` header at all — which the CORS handler
> allows outright (`if (!origin || ...)`). The allowlist only governs
> *direct* browser calls to `api.buildgentic.com`. So a wrong value here
> fails silently until the first such call, rather than at deploy.

> **`NEUROLINK_SECRET_KEY` fails quietly, and it fails a whole feature.**
> Nothing checks it at boot: `crypto.ts` reads it the first time something
> is sealed, warns once to the log, and returns null forever after. So the
> site comes up healthy, agents run, and only *connections* are broken —
> the Email Agent reports itself unconfigured (`/email/status` returns
> `configured: false` when either the Gmail client or this key is missing),
> and any connected API key refuses to save. If you set all three Gmail
> variables and the capability still says it is not configured, this is
> why.
>
> Changing it later is not free: it does not re-encrypt what is already
> stored, so every existing connection becomes unreadable and has to be
> reconnected. Generate it once, keep it.

**Optional** — every one of these already has a working fallback in
`server/src/ai/config.ts` (the app runs on an offline Mock AI provider and
DuckDuckGo web search with none of them set), so add only the ones you
actually want live:

- Model providers: `NEUROLINK_GROQ_API_KEY`, `NEUROLINK_CLOUDFLARE_ACCOUNT_ID`
  + `NEUROLINK_CLOUDFLARE_API_TOKEN`, `NEUROLINK_OPENROUTER_API_KEY`,
  `NEUROLINK_MISTRAL_API_KEY`, `NEUROLINK_GEMINI_API_KEY`
- Web search: `NEUROLINK_TAVILY_API_KEY` plus
  `NEUROLINK_WEB_SEARCH_PROVIDER=tavily`. Worth treating as
  near-required rather than optional: the keyless DuckDuckGo default
  bot-challenges often enough that any task needing live information
  quietly answers from training data instead — see the run card's
  "found nothing" state, which exists because of exactly that.
  Tavily's free tier is 1,000 credits a month with no card. Brave
  (`NEUROLINK_BRAVE_SEARCH_KEY`) is equally supported but wants a card
  on file.
- Email (scheduled-run notifications): `NEUROLINK_RESEND_API_KEY`,
  `NEUROLINK_MAIL_FROM`. The from-address must be on a domain verified with
  Resend. There is no default, deliberately — a plausible one would produce
  sends that fail at the provider rather than here.
- Scheduler, **required on any host that sleeps when idle, which the Render
  free instance does**: `NEUROLINK_SCHEDULER=external` plus
  `NEUROLINK_SCHEDULER_TOKEN`, and the same token as a GitHub repository
  secret so `.github/workflows/scheduler-tick.yml` can POST
  `/internal/scheduler/tick`. Left unset the in-process ticker runs, which is
  correct on an always-on instance and silently dead on one that spins down —
  no error, no log line, just schedules that never fire. Confirm which mode is
  live from the startup banner: `[schedule] scheduler: external — no timer
  here`.
- Every rate limit / budget knob in `server/.env.example` has a sane
  default — only touch these if you specifically want different numbers
  than what ships.

**When the Chrome extension is packaged:**

- `NEUROLINK_EXTENSION_ORIGIN=chrome-extension://<id>` — one exact origin,
  never a `chrome-extension://*` wildcard, and checked independently of
  `NEUROLINK_ALLOWED_ORIGINS` (`isAllowedOrigin` in
  `server/src/index.ts`). Putting the extension origin in the allowlist
  instead is a common wrong guess and does not work.

  The id is not something you can pick. It is derived from the
  extension's public key, and for a published item that key belongs to the
  Web Store — which is why `extension/manifest.json` pins a `key` field
  taken from the Store rather than one generated locally. The procedure is
  in `extension/README.md` under "Pinning the extension id"; the short
  version is `npm run pack:extension`, upload the zip as a **draft** item,
  copy the public key off the Package tab, paste it into the manifest, and
  run `node extension/verify-key.js` to print the exact value to set here.
  Set `VITE_EXTENSION_ID` to the same id on Vercel.

**Gmail (the Email Agent):**

Three variables, all three or none — the capability is refused at the
connect route with a message saying so if any is missing, and every other
capability is unaffected:

- `NEUROLINK_GMAIL_CLIENT_ID`
- `NEUROLINK_GMAIL_CLIENT_SECRET`
- `NEUROLINK_GMAIL_REDIRECT_URI=https://api.buildgentic.com/api/agents/email/callback`

Register that redirect URI *character for character* on the OAuth client
in the Google Cloud Console. Google compares it as a literal string, and a
mismatch produces `redirect_uri_mismatch` at the consent screen — before
any of this server's code runs, so nothing here can catch or explain it.
Unset, it defaults to `http://localhost:3001/api/agents/email/callback`,
which fails exactly that way in production. The `agents` segment in the
middle is where `emailRouter` is mounted and is not optional.

The scopes requested are **not a fixed list**: `openid` and `email`
always, plus one Gmail scope per capability the user actually grants
(`gmail.readonly`, `gmail.compose`, `gmail.send`, `gmail.modify` — see
`SCOPE_FOR` in `providers/GmailProvider.ts`). All four are Google
*restricted* scopes, so a project serving users outside itself needs OAuth
verification and an annual third-party security assessment. Testing mode,
with test users added by hand, is what this runs on until then.

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

**As actually deployed, `www` is the canonical host.** The apex resolves to
Vercel and then 308-redirects every path to `www.buildgentic.com`, so
anything that compares an origin — the CORS allowlist, the extension's
`externally_connectable` and `WEB_ORIGIN`, an OAuth redirect URI, the
Supabase Site URL — must name the `www` host. The apex is a redirect, not
an origin anything runs on.

One practical note if a domain ever looks dead from your own machine:
check it against a public resolver (`nslookup buildgentic.com 8.8.8.8`) or
force the address (`curl --resolve buildgentic.com:443:<ip> ...`) before
concluding the DNS is wrong. A local router or ISP resolver can serve the
previous record long after a cutover, and it looks exactly like a failed
change.

## Supabase dashboard

The app currently has no OAuth or magic-link redirect code (auth is plain
email/password), so there is no code depending on this — but set it
anyway so any future email-based flow doesn't quietly point at localhost:

**Authentication → URL Configuration → Site URL**:
`https://www.buildgentic.com`

## Chrome extension

`extension/config.js` and `extension/manifest.json` already point at
production — `https://api.buildgentic.com` and `https://www.buildgentic.com`.
Those two files hold **three** origin strings that must agree character for
character (`WEB_ORIGIN`, `externally_connectable.matches`, and the strict
comparison in `sw.js`), and a mismatch does not error: it produces a
pairing that silently never completes.

What is left is the id, which cannot be chosen — it is derived from the
extension's public key, and for a published item that key is the Web
Store's. Follow "Pinning the extension id" in `extension/README.md`, then:

1. Set `NEUROLINK_EXTENSION_ORIGIN=chrome-extension://<the real id>` on
   Render — one exact origin, never a wildcard.
2. Set `VITE_EXTENSION_ID=<the real id>` on Vercel, so the
   `/extension/connect` pairing page can hand the token over.

`node extension/verify-key.js` prints both values from the key actually in
the manifest, so they are copied from a computed result rather than retyped
from a dashboard.

## Verifying after you deploy

```bash
# The backend answers on its own domain
curl https://api.buildgentic.com/api/health

# The allowlist names the origin the site actually runs on. Echoes the
# origin back when allowed; sends no ACAO header when refused.
curl -sI -H "Origin: https://www.buildgentic.com" \
  https://api.buildgentic.com/api/health | grep -i access-control-allow-origin

# And still refuses one it should not know
curl -sI -H "Origin: https://not-your-site.example" \
  https://api.buildgentic.com/api/health | grep -i access-control-allow-origin
```

- Load `https://www.buildgentic.com/dashboard` (or any deep route)
  directly, not by clicking through from `/` — confirms the SPA rewrite in
  `vercel.json` is serving `index.html` rather than 404ing.
- Publish an agent and confirm its link reads
  `https://www.buildgentic.com/…`, not `localhost` — confirms
  `NEUROLINK_PUBLIC_SITE_URL` took effect.
- Sign up or log in — confirms Supabase auth is reachable and CORS is
  correctly passing the `Authorization` header through.

Note that the first CORS check passing does **not** prove the site works,
and failing does not prove it is broken: app traffic goes through Vercel's
server-side `/api/*` rewrite and never presents an `Origin` at all. The
check is about direct calls to the API.
