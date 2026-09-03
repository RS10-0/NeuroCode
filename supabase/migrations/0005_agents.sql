-- =========================================================
-- NEUROLINK — AGENTS
--
-- Phase 2.3. An agent is a saved configuration, not a second
-- runtime: standing instructions, a model, a power source,
-- generation settings, a body of knowledge and a set of
-- capabilities. Every call it makes still goes through the one
-- runtime added in 0003 and extended in 0004, and every call it
-- makes is still counted by the same quota gate.
--
-- Nothing here is a new AI surface. `ai_usage` has carried an
-- `agent_id` column and permitted the `agent_test` /
-- `agent_public` features since 0003, precisely so that this
-- migration would be about agents rather than about plumbing.
--
-- Two tables rather than one. Knowledge is a list whose rows
-- will later be chunked and embedded, and a jsonb blob on the
-- parent would have to be migrated out of the moment retrieval
-- arrives.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- AGENTS
--
-- `model`, `temperature` and `max_output_tokens` are stored but
-- never trusted. The runtime re-resolves the model against its
-- own catalogue on every single call, so a row naming a model
-- that has since been retired produces a clear refusal rather
-- than a request to a provider that should not have been made.
--
-- There is deliberately no `unique (user_id, name)`. Two agents
-- may share a name — duplicating one is a normal thing to do,
-- and a uniqueness rule would turn that into an error dialog
-- for no benefit anybody asked for.
-- ---------------------------------------------------------

create table if not exists public.agents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,

  name                text not null,
  description         text,
  avatar_emoji        text not null default '🤖',
  avatar_tone         text not null default 'accent'
                      check (avatar_tone in ('accent', 'correct', 'caution', 'error')),

  system_instructions text not null default '',

  power_source        text not null default 'platform'
                      check (power_source in ('platform', 'byok')),
  model               text not null,
  temperature         numeric(3, 2) not null default 0.7,
  max_output_tokens   integer not null default 1024,

  -- Which tools this agent may eventually reach. Only 'chat' is
  -- implemented; the column is a list from the start so that
  -- turning one on later is a write, not a migration.
  capabilities        text[] not null default '{chat}',

  status              text not null default 'draft'
                      check (status in ('draft', 'ready')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Redundant beside the primary key, and present only so that
  -- agent_knowledge can carry a composite foreign key. See the
  -- note on that table for what it buys.
  unique (id, user_id)
);

create index if not exists agents_user_idx
  on public.agents (user_id, updated_at desc);

-- ---------------------------------------------------------
-- AGENT KNOWLEDGE
--
-- Material the agent draws on that the model was never trained
-- on. In this phase every row is inlined into the system prompt,
-- which is why `status` exists: when retrieval lands, a row is
-- chunked into an `agent_knowledge_chunks` table, flipped to
-- 'indexed', and the composer stops inlining it because it
-- arrives through retrieval instead. That is the whole extension
-- seam, and it costs one column now.
--
-- `char_count` is denormalised so the budget meter and the agent
-- list never have to load `content` to know how big it is.
--
-- Two things about `user_id`, which is denormalised from the
-- parent on purpose:
--
--   It lets the RLS policy below be the same `auth.uid() =
--   user_id` as every other table in this schema. A policy that
--   reached through `agent_id` would need an `exists (select
--   ...)` subquery evaluated per row, and would be the only
--   policy here shaped differently from all the others.
--
--   The foreign key is composite — (agent_id, user_id) — which
--   is what stops the copy from drifting. Without it, a `with
--   check (auth.uid() = user_id)` policy would happily accept a
--   row pointing at somebody else's agent. Referencing both
--   columns together makes that combination unrepresentable
--   rather than merely unreachable.
-- ---------------------------------------------------------

create table if not exists public.agent_knowledge (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,

  kind        text not null default 'text'
              check (kind in ('text', 'file')),
  title       text not null,
  content     text not null,
  -- The file it came from, for 'file' rows. Null for pasted text.
  source_name text,
  char_count  integer not null default 0,
  position    integer not null default 0,

  status      text not null default 'inline'
              check (status in ('inline', 'indexed', 'error')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade
);

create index if not exists agent_knowledge_agent_idx
  on public.agent_knowledge (agent_id, position);

create index if not exists agent_knowledge_user_idx
  on public.agent_knowledge (user_id);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- The ordinary owner-all policy, the same one seven other tables
-- in this schema use. An agent config is the learner's own data:
-- nothing in it is forgeable-valuable, because the runtime
-- re-validates the model and re-counts the quota on every call
-- regardless of what the row says.
--
-- Contrast user_ai_keys in 0004, which has RLS enabled and no
-- policy at all — key material is the thing the browser must
-- never be able to read, and an agent's system instructions are
-- not.
-- ---------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['agents', 'agent_knowledge']
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists %I on public.%I', target || '_owner_all', target);
    execute format(
      'create policy %I on public.%I
         for all
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id)',
      target || '_owner_all', target
    );
  end loop;
end
$$;
