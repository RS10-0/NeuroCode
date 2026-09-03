-- =========================================================
-- NEUROLINK — AGENT ACTIONS
--
-- The capability that lets an agent DO something between the
-- question and the answer: run code it wrote, call an API, read
-- what came back, and decide what to do next.
--
-- Every capability before this one was a lookup — it ran once,
-- before the model stream began, and appended text to the
-- prompt. This one is a LOOP, and the difference shows up in
-- the ledger: a single turn can now produce several ai_usage
-- rows of the same feature, some for tool executions and some
-- for the continuation calls that read their results.
--
-- One widened constraint and one new table. What this migration
-- deliberately does NOT add, once again, is a second runtime.
-- An action goes through the same `runChat` the Lab calls, is
-- admitted by the same SQL gate, and is written to the same
-- ledger. It is also not a new provider protocol: a tool call
-- is text the model writes and the server recognises, which is
-- why nothing here mentions one.
--
-- What it DOES add that nothing before it has is a place where
-- NeuroLink stores a secret it must be able to read back. See
-- the note on `secret` below — that column is the reason this
-- migration deserves a careful read rather than a quick apply.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- USAGE ATTRIBUTION
--
-- 'agent_action' covers both halves of what acting costs: the
-- tool executions themselves, and the extra model calls that
-- read their output and decide what to do next.
--
-- One value rather than two because they answer one question —
-- what did acting cost — and because they are inseparable in
-- practice: a tool result nothing reads is not a step, and a
-- step with no tool in it is just the answer. The rows are told
-- apart by `model`, exactly as the memory rows added in 0010
-- are: a tool execution carries 'tool:run_code' or
-- 'tool:http_request' where a model id would go, and a
-- continuation step carries the real answering model. A tool
-- row reports zero tokens, honestly — no model ran, so it is
-- the request windows that bound it.
--
-- This is the SEVENTH widening of this constraint. See 0007,
-- 0008, 0009, 0010 and 0013 for the previous ones. The pattern
-- is deliberate: one capability, one feature value, one
-- migration that widens this check.
--
-- It is also the failure this project sees most often, because
-- these files are applied by hand. Ship the TypeScript without
-- this statement and every action request fails inside the
-- insert, with a Postgres message that reads like a database
-- fault rather than a missing migration. QuotaGuard.ts detects
-- exactly that and logs which file to run — but only the
-- operator sees it, and the learner sees a generic error.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis', 'agent_memory',
    'agent_site', 'site_edit', 'agent_action'
  ));

-- ---------------------------------------------------------
-- CONNECTIONS
--
-- A saved credential an agent may present, tied to the one host
-- it may present it to.
--
-- A connection is three things: a name the model can say, a
-- host it is allowed to reach, and a secret it never sees. That
-- separation is the entire security model. The model writes
-- {"connection":"weather"} — it does not write a token, it
-- cannot read one back, and no prompt in this system ever
-- contains one. The server attaches the secret on the way out,
-- after the address has been checked.
--
-- Which means a prompt injection that fully controls what the
-- agent says still cannot exfiltrate a key. The most it can do
-- is spend one, against the host its owner tied it to.
-- ---------------------------------------------------------

create table if not exists public.agent_connections (
  id              uuid primary key default gen_random_uuid(),

  agent_id        uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,

  -- What the model says to select this connection. Lowercase
  -- alphanumerics and underscores, enforced below rather than
  -- merely expected: this string is compared against model
  -- output, and a slug that can contain spaces or punctuation
  -- is a slug the model will spell four different ways.
  slug            text not null,

  label           text not null,

  -- Prompt surface. The model reads this to decide whether this
  -- connection is the right one for what it is trying to do.
  description     text,

  -- Scheme, host and optional path prefix. Every request made
  -- through this connection must resolve to something under it,
  -- which is checked at call time rather than trusted here —
  -- but storing the base is what makes that check possible.
  base_url        text not null,

  auth_kind       text not null default 'none',

  -- Header name for 'header', query parameter name for 'query'.
  -- Null for the other two.
  auth_name       text,

  allowed_methods text[] not null default '{GET}',

  -- ===================================================
  -- THE SECRET
  --
  -- AES-256-GCM, sealed by the server, never by the browser.
  -- The format is v1.<iv>.<tag>.<ciphertext> — see
  -- server/src/ai/crypto.ts.
  --
  -- This is the first recoverable secret NeuroLink has stored
  -- since BYOK was removed in 0011, and the distinction from a
  -- deployment key matters. A deployment key is presented,
  -- compared and thrown away, so 0006 stores only a hash. A
  -- connection secret has to be SENT to somebody else's
  -- server, so it must be readable — which means the key that
  -- opens it lives in the server's environment
  -- (NEUROLINK_SECRET_KEY) and never in this database.
  --
  -- Two consequences an operator should know before applying
  -- this. A database backup restored without the matching
  -- environment key contains connections that cannot be
  -- opened; the rows survive and the secrets do not, which is
  -- the correct failure. And rotating that key invalidates
  -- every row in this column at once — there is no re-wrap
  -- path here, by design, because writing one would mean the
  -- old key and the new key existing in the same process.
  --
  -- Null when auth_kind is 'none', which is a real case: a
  -- public API that needs no credential still benefits from a
  -- connection, because a connection is also a leash.
  -- ===================================================
  secret          text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The composite key agent_knowledge, agent_deployments and
  -- agent_sites all carry, for the same reason: it makes "a
  -- connection on somebody else's agent" unrepresentable
  -- rather than merely unreachable.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  -- One name per agent. The model selects by name, so two rows
  -- answering to the same one is an ambiguity with no correct
  -- resolution.
  unique (agent_id, slug),

  constraint agent_connections_slug_shape
    check (
      length(slug) between 2 and 32
      and slug ~ '^[a-z0-9][a-z0-9_]*$'
    ),

  constraint agent_connections_auth_kind
    check (auth_kind in ('none', 'bearer', 'header', 'query')),

  -- A credential that names no way to send itself is a row that
  -- can only fail at call time. Refused here instead.
  constraint agent_connections_auth_name_present
    check (
      auth_kind not in ('header', 'query')
      or (auth_name is not null and length(auth_name) > 0)
    ),

  -- Belt to the application's braces: only http and https ever
  -- reach the request layer, and a base_url that could not
  -- possibly be requested should not be storable.
  constraint agent_connections_base_url_scheme
    check (base_url ~* '^https?://')
);

create index if not exists agent_connections_agent_idx
  on public.agent_connections (agent_id, created_at);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-READ only, and the read is deliberately narrower than
-- it looks: `secret` is a column on this table, so a policy
-- granting select grants the ciphertext too.
--
-- That is acceptable and worth saying why. The ciphertext is
-- useless without NEUROLINK_SECRET_KEY, which lives in the
-- server's environment and is never sent to a browser — so an
-- owner selecting their own row gets an opaque string, which is
-- exactly what they would get from a hexdump of their own
-- backup. What they must never get is somebody ELSE'S opaque
-- string, and `auth.uid() = user_id` is what ensures that.
--
-- Writes go through Express with the service role, because a
-- browser insert could not seal a secret — it does not have the
-- key, and giving it one would defeat the entire arrangement.
-- That is a stronger reason than the ones agent_sites and
-- agent_deployments give for the same posture: there, a browser
-- write would merely skip validation; here, it could not
-- perform the central operation at all.
--
-- No anon policy, and here that is not a precaution but a
-- prohibition. A published page runs with httpActions hard-off
-- precisely so a stranger cannot cause an owner's credentials
-- to be spent; granting anon a select on this table would hand
-- them the row instead.
-- ---------------------------------------------------------

alter table public.agent_connections enable row level security;

drop policy if exists agent_connections_owner_all  on public.agent_connections;
drop policy if exists agent_connections_owner_read on public.agent_connections;

create policy agent_connections_owner_read
  on public.agent_connections
  for select
  using (auth.uid() = user_id);

revoke all on public.agent_connections from anon;

-- ---------------------------------------------------------
-- DONE
--
-- After applying this, restart the API so the new feature value
-- is used against a constraint that knows it, and set
-- NEUROLINK_SECRET_KEY if agents are to hold credentials:
--
--   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--
-- Without that variable the sandbox and public GET requests
-- both still work; only saved connections are refused, with a
-- message saying so.
-- ---------------------------------------------------------
