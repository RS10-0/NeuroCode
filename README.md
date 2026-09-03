# BuildGentic

A learning platform for people starting from zero with AI. It takes a
learner from not knowing what a model is, through to publishing an AI agent
at a real URL that other people can use.

The loop the product is built around: **learn → experiment → build → test →
iterate → deploy → share.**

- **Courses** — five interactive courses. Lessons are activities rather than
  slides: tokenisers you can type into, temperature dials, bias audits,
  dataset playgrounds.
- **AI Lab** — a prompt playground that explains *why* two prompts produced
  different answers, with the parameters, token counts and cost exposed.
- **Agent Builder** — give an agent a purpose, instructions, knowledge,
  memory and tools. Test it, break it, fix it.
- **Agent Library** — five professionally written agents unlocked with XP.
- **Published pages** — a deployed agent gets an address (`/your-slug`) and
  a designed page that strangers can talk to.
- **Scheduled runs** — point an agent at a task and a cadence; results land
  in an in-app feed and optionally by email.

## The five courses

| Course | Focus |
| --- | --- |
| What is AI? | How AI works, how models learn, hallucinations, bias, evaluation |
| Prompt Engineering & AI Communication | Context, constraints, output formats, few-shot, debugging a prompt |
| AI Agents & Automation | Instructions, memory and tools; judging whether an agent is any good |
| Building AI-Powered Websites | Audience, design, writing for a page, publishing a real link |
| AI Ethics & Responsibility | Trust, bias, privacy and academic integrity, through scenarios |

## The five prebuilt agents

Unlocked with XP earned from lessons. Their prompts and settings live in
`src/features/agents/flagships.ts` and are resolved from the catalogue on
read — improving a prompt improves it for everybody who already owns it.

| Agent | Cost | Capabilities |
| --- | --- | --- |
| Career Explorer | 60 XP | chat, web search, memory, knowledge |
| Writing Coach | 90 XP | chat, web search, memory, knowledge, file analysis |
| Study Tutor | 100 XP | chat, memory, knowledge, file analysis |
| Research Assistant | 160 XP | chat, web search, memory, knowledge, file analysis |
| Coding Coach | 200 XP | chat, memory, knowledge, file analysis |

## Stack

- **Frontend** — React 19, TypeScript, Vite 8, React Router 7
- **Backend** — Express 5 on Node 24, TypeScript
- **Data & auth** — Supabase (Postgres, Row Level Security, Supabase Auth)
- **Models** — a provider cascade rather than one vendor. Every request
  walks the list from the top and falls through on failure or rate limit:
  Groq → Cloudflare → OpenRouter → Mistral, plus Gemini, and an offline
  Mock provider so the app runs with no keys at all.
- **Web search** — Brave, Tavily or DuckDuckGo, with a Mock provider
- **Email** — Resend, for scheduled-run notifications

The routing policy is `server/src/ai/providerChain.ts` and nothing else —
no route, React component or database column knows the provider names.

## Running it locally

Requires **Node 24** and **npm 11**.

### 1. Install

```bash
npm install && npm --prefix server install
```

### 2. Environment

Two env files, and neither is optional.

```bash
cp .env.example .env.local && cp server/.env.example server/.env
```

- `.env.local` — frontend. Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. Vite inlines `VITE_*` into the browser bundle,
  so **never** put a model provider key here.
- `server/.env` — backend. Supabase URL and secret key, provider keys, and
  the `NEUROLINK_*` tuning variables. Every limit in the app has one, and
  `server/.env.example` documents what each does.

> The `NEUROLINK_*` prefix is a legacy identifier kept deliberately. See
> [Branding](#branding) below.

### 3. Database

Migrations in `supabase/migrations/` are applied **by hand**: paste each
file into the Supabase SQL editor in numeric order. There is no CLI link in
this project. Every migration is written to be safe to re-run.

### 4. Run

Two processes:

```bash
npm run dev
```

```bash
npm --prefix server run dev
```

The frontend serves on Vite's port and proxies `/api` to the Express server
on `3001`. Override the target with `VITE_API_TARGET` to run a second copy
of the stack alongside the first.

## Scripts

**Frontend**

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Types only |

**Server**

| Command | What it does |
| --- | --- |
| `npm --prefix server run dev` | tsx watch |
| `npm --prefix server run build` | Typecheck, then bundle to `dist/index.mjs` with esbuild |
| `npm --prefix server start` | Run the built bundle |
| `npm --prefix server run typecheck` | Types only |

## Verification

There is no unit-test framework. Correctness is proved by suites in
`scripts/`, each a runnable script that prints what it checked:

```bash
npx tsx ./scripts/verify-sites.mts
```

Some run entirely offline; others need the server, the database, or a live
model. Each script's header comment says which, and several take `--pure`
to run only the half that needs nothing.

```bash
npx tsx ./scripts/audit-brand-data.mts
```

`audit-brand-data.mts` checks whether any stored row still carries the old
brand name. It reads `server/.env` itself and prints no secrets.

## Branding

The product is **BuildGentic** (buildgentic.com), renamed from NeuroLink.
Casing marks the boundary, and it is load-bearing:

- `BuildGentic` — the brand, in UI copy and prose.
- `NEUROLINK_*` — environment variable names. Unchanged, because renaming
  them breaks every deployment until all ~180 are re-set.
- `neurolink` (lowercase) — identifiers that are persisted or protocol:
  model ids (`neurolink-1`), provider ids, browser storage keys, the
  `<<neurolink:…>>` prompt fences, and the deployment-token prefix.

`supabase/migrations/**` is left alone entirely — those files are already
applied, so their contents are historical record.

When rebranding again, replace case-sensitively and treat lowercase
`neurolink` as load-bearing until proven otherwise.

## Deploying

The frontend deploys to Vercel (`vercel.json`) and the backend to Render
(`render.yaml`), with Supabase unchanged as the database and auth layer.
Neither config file carries a secret — every credential is entered by hand
in that platform's dashboard. See
[`docs/deployment.md`](docs/deployment.md) for the full checklist: exactly
which environment variables go where, the DNS records for
`buildgentic.com` and `api.buildgentic.com`, and what to verify once it's
live.
