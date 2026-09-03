-- =========================================================
-- NEUROLINK — KNOWLEDGE RETRIEVAL
--
-- Phase 2.5, capability one. Until now an agent's knowledge
-- reached the model the crudest way that works: every entry
-- pasted into the system prompt, in full, on every turn. That
-- capped an agent at roughly two pages and sent a physics
-- document to answer a history question.
--
-- This migration adds the storage retrieval needs — chunks and
-- their embeddings, one index-state row per entry, and one
-- search function — and nothing else. There is still no second
-- AI runtime: embedding goes through the same power source,
-- the same credentials, the same atomic quota gate and the same
-- ai_usage ledger as every other model call NeuroLink makes.
-- The only thing added to that ledger is two new `feature`
-- values, so indexing and retrieval can be told apart from Lab
-- traffic without a parallel table.
--
-- The seams this uses were left here on purpose:
--   agent_knowledge.status = 'indexed'   (0005)
--   agents.capabilities    text[]        (0005)
-- Neither is invented here; both are finally written.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- PGVECTOR
--
-- Enabled here rather than assumed, so a fresh project works
-- from this file alone.
--
-- Which schema it lands in is not knowable in advance. A
-- project that enabled it from the Supabase dashboard has it in
-- `extensions`; one that ran `create extension vector` in the
-- SQL editor has it in `public`; and `if not exists` silently
-- ignores a `with schema` clause when the extension is already
-- there. So every statement below that names the type looks up
-- the real schema first and builds its DDL with format(). The
-- alternative — writing a bare `vector(768)` and hoping the
-- role's search_path contains the right schema — fails on
-- exactly half of all Supabase projects, at run time, with a
-- message about an unknown type.
-- ---------------------------------------------------------

create extension if not exists "vector";

-- ---------------------------------------------------------
-- A UNIQUE KEY TO HANG CHILDREN OFF
--
-- The same composite key agent_knowledge itself carries from
-- agents, for the same reason: it makes "a chunk of somebody
-- else's knowledge entry" unrepresentable rather than merely
-- unreachable, and it means deleting an entry takes its chunks
-- and its index row with it.
--
-- `add constraint if not exists` does not exist in PostgreSQL,
-- hence the lookup.
-- ---------------------------------------------------------

do $mig$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.agent_knowledge'::regclass
       and conname  = 'agent_knowledge_id_user_id_key'
  ) then
    alter table public.agent_knowledge
      add constraint agent_knowledge_id_user_id_key unique (id, user_id);
  end if;
end
$mig$;

-- ---------------------------------------------------------
-- CHUNKS
--
-- One row per piece of one knowledge entry, with the vector
-- that piece embeds to.
--
-- `embedding_model` is on the row, and it is load-bearing
-- rather than decoration. Two embedding models produce numbers
-- of the same width that mean entirely different things, so a
-- query embedded by one model must never be compared against
-- chunks embedded by another — the results would be noise
-- presented as relevance. Since an agent's embedding model
-- follows its power source, switching an agent from NeuroLink's
-- key to its owner's changes the model, and this column is what
-- makes that detectable instead of silently wrong.
--
-- 768 dimensions. Both embedding models NeuroLink can reach are
-- asked for exactly that width — Gemini through
-- `outputDimensionality`, OpenAI through `dimensions` — so one
-- column serves both, and the runtime normalises every vector
-- to unit length before it is stored.
--
-- `content` is duplicated from agent_knowledge on purpose. A
-- chunk is a span of the parent's text plus an overlap, and
-- recomputing which span it was on every search — from a
-- chunker whose parameters may have changed since — would make
-- retrieval depend on code rather than on data.
-- ---------------------------------------------------------

do $mig$
declare
  vec_schema text;
begin
  select n.nspname
    into vec_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'vector';

  if vec_schema is null then
    raise exception
      'pgvector is not installed. Run: create extension "vector";';
  end if;

  execute format($ddl$
    create table if not exists public.agent_knowledge_chunks (
      id              uuid primary key default gen_random_uuid(),
      knowledge_id    uuid not null,
      -- Denormalised from the parent so the search function can
      -- filter on it directly. Retrieval is scoped to one agent
      -- and one owner, and both predicates have to be cheap.
      agent_id        uuid not null,
      user_id         uuid not null references auth.users (id) on delete cascade,

      -- Position within the entry, 0-based. What lets a source
      -- citation say "part 2 of 5" rather than just naming a file.
      ordinal         integer not null,

      content         text not null,
      char_count      integer not null default 0,

      embedding       %I.vector(768) not null,
      embedding_model text not null,

      created_at      timestamptz not null default now(),

      -- Re-indexing an entry replaces its chunks for one model
      -- and leaves any other model's alone, so switching power
      -- source back and forth does not re-embed every time.
      unique (knowledge_id, embedding_model, ordinal),

      foreign key (knowledge_id, user_id)
        references public.agent_knowledge (id, user_id) on delete cascade
    )
  $ddl$, vec_schema);
end
$mig$;

create index if not exists agent_knowledge_chunks_scope_idx
  on public.agent_knowledge_chunks (agent_id, embedding_model);

create index if not exists agent_knowledge_chunks_entry_idx
  on public.agent_knowledge_chunks (knowledge_id, embedding_model, ordinal);

create index if not exists agent_knowledge_chunks_user_idx
  on public.agent_knowledge_chunks (user_id);

-- ---------------------------------------------------------
-- THE VECTOR INDEX
--
-- Wrapped, because it is an optimisation and not a
-- correctness requirement. HNSW arrived in pgvector 0.5 and
-- every current Supabase project has it, but a project pinned
-- to an older build should get a working retrieval system with
-- a sequential scan rather than a migration that will not
-- apply. A learner's knowledge base is measured in hundreds of
-- chunks, where the difference is not perceptible.
-- ---------------------------------------------------------

do $mig$
declare
  vec_schema text;
begin
  if exists (
    select 1 from pg_class where relname = 'agent_knowledge_chunks_vec_idx'
  ) then
    return;
  end if;

  select n.nspname
    into vec_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'vector';

  begin
    execute format(
      'create index agent_knowledge_chunks_vec_idx
         on public.agent_knowledge_chunks
         using hnsw (embedding %I.vector_cosine_ops)',
      vec_schema
    );
  exception
    when others then
      raise notice
        'HNSW index not created (%). Retrieval still works by sequential scan.',
        sqlerrm;
  end;
end
$mig$;

-- ---------------------------------------------------------
-- INDEX STATE
--
-- One row per knowledge entry: what happened the last time
-- NeuroLink tried to index it, and what it was indexed from.
--
-- A separate table rather than columns on agent_knowledge,
-- which is the only real design decision here. agent_knowledge
-- is written by the browser under RLS — a learner's Save is a
-- PostgREST upsert of the whole entry — so server-managed state
-- living on that table would be clobbered by an unrelated typo
-- fix. Keeping the two apart means the browser owns the content
-- and the server owns the index, and neither can overwrite the
-- other's half.
--
-- `content_hash` covers the text, the title, the chunker's
-- parameters and the embedding model. Anything that would
-- change the chunks changes the hash, and a hash that still
-- matches is proof the existing chunks are current — which is
-- what makes re-indexing cheap enough to run on every save.
--
-- `claimed_at` exists for two tabs pressing Save at once.
-- ---------------------------------------------------------

create table if not exists public.agent_knowledge_index (
  knowledge_id    uuid primary key,
  agent_id        uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,

  state           text not null default 'pending'
                  check (state in (
                    'pending',    -- never indexed, or content has moved on
                    'indexing',   -- claimed by a run that is still going
                    'indexed',    -- chunks exist and are current
                    'failed',     -- the attempt errored; see `error`
                    'unsupported' -- no embedding model on this power source
                  )),

  embedding_model text,
  chunk_count     integer not null default 0,
  content_hash    text,

  -- Written for the owner, who is the only person who can act
  -- on it. Never shown to an external caller.
  error           text,

  claimed_at      timestamptz,
  indexed_at      timestamptz,
  updated_at      timestamptz not null default now(),

  foreign key (knowledge_id, user_id)
    references public.agent_knowledge (id, user_id) on delete cascade
);

create index if not exists agent_knowledge_index_agent_idx
  on public.agent_knowledge_index (agent_id);

create index if not exists agent_knowledge_index_user_idx
  on public.agent_knowledge_index (user_id);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-READ on both, and no write policy at all — the same
-- posture agent_deployments takes in 0006, for the same
-- reason. Chunking and embedding are decisions the server
-- makes; a browser insert could claim any vector it liked
-- against any entry, and there is no version of that which
-- should be possible.
--
-- Read is granted because the Builder shows how many pieces an
-- entry became, and because the isolation this schema promises
-- ought to be checkable from a learner's own session rather
-- than only from the service role.
-- ---------------------------------------------------------

do $mig$
declare
  target text;
begin
  foreach target in array array[
    'agent_knowledge_chunks',
    'agent_knowledge_index'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);

    execute format(
      'drop policy if exists %I on public.%I', target || '_owner_all', target
    );
    execute format(
      'drop policy if exists %I on public.%I', target || '_owner_read', target
    );

    execute format(
      'create policy %I on public.%I
         for select
         using (auth.uid() = user_id)',
      target || '_owner_read', target
    );
  end loop;
end
$mig$;

-- ---------------------------------------------------------
-- USAGE VOCABULARY
--
-- Two more features on the ledger that already exists.
--
--   agent_index     — embedding an entry's chunks, on a save
--                     or a re-index.
--   agent_retrieval — embedding one incoming question.
--
-- Neither is nameable by a browser: server/src/ai/validation.ts
-- keeps both out of CLIENT_FEATURES, exactly as it does for
-- agent_public. The point of separating them is that a support
-- question about a bill should be answerable by reading this
-- column, and "the agent answered" and "the agent was indexed"
-- are different spends.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval'
  ));

-- ---------------------------------------------------------
-- SEARCH
--
-- The one query retrieval runs, and the only place a vector
-- comparison happens in this system.
--
-- It is SECURITY DEFINER and takes a user id, so it is granted
-- to service_role alone — the same treatment ai_usage_admit
-- gets in 0004, and for the same reason: a function that
-- bypasses RLS and trusts its argument must not be callable by
-- anyone who could lie about that argument.
--
-- Both `p_user_id` and `p_agent_id` are filtered on, not one or
-- the other. The user id alone would let one of a learner's own
-- agents answer out of another's knowledge; the agent id alone
-- would be a cross-tenant read the moment a caller could guess
-- a uuid. Neither ever comes from a request body: the browser
-- path resolves the agent through AgentStore under the caller's
-- own id, and the deployed path inherits the owner from the
-- deployment row.
--
-- `p_embedding` is text rather than a vector parameter because
-- PostgREST posts JSON, and casting once here is cheaper than
-- teaching every caller a wire format for a 768-element array.
-- ---------------------------------------------------------

drop function if exists public.agent_knowledge_search(
  uuid, uuid, text, text, integer, double precision
);

do $mig$
declare
  vec_schema text;
begin
  select n.nspname
    into vec_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'vector';

  execute format($ddl$
    create or replace function public.agent_knowledge_search(
      p_user_id         uuid,
      p_agent_id        uuid,
      p_embedding       text,
      p_embedding_model text,
      p_limit           integer default 6,
      p_min_similarity  double precision default 0
    )
    returns table (
      chunk_id     uuid,
      knowledge_id uuid,
      title        text,
      ordinal      integer,
      content      text,
      char_count   integer,
      similarity   double precision
    )
    language plpgsql
    security definer
    set search_path = public, %I
    as $fn$
    declare
      q            %I.vector(768);
      max_rows     integer := greatest(1, least(coalesce(p_limit, 6), 50));
      floor_score  double precision := coalesce(p_min_similarity, 0);
    begin
      -- A missing scope is not an error to be reported, it is
      -- simply nothing to search. Returning no rows keeps the
      -- caller on its "no relevant knowledge" path, which is
      -- the path that must always answer normally.
      if p_user_id is null or p_agent_id is null
         or p_embedding is null or p_embedding_model is null then
        return;
      end if;

      q := p_embedding::%I.vector(768);

      return query
      select c.id,
             c.knowledge_id,
             k.title,
             c.ordinal,
             c.content,
             c.char_count,
             -- `<=>` is cosine DISTANCE, in [0, 2]. Every caller
             -- above wants similarity, so the conversion happens
             -- once, here, rather than in three languages.
             (1 - (c.embedding <=> q))::double precision
        from public.agent_knowledge_chunks c
        join public.agent_knowledge k
          on k.id = c.knowledge_id
         and k.user_id = c.user_id
       where c.user_id         = p_user_id
         and c.agent_id        = p_agent_id
         and c.embedding_model = p_embedding_model
         and (1 - (c.embedding <=> q)) >= floor_score
       order by c.embedding <=> q
       limit max_rows;
    end;
    $fn$
  $ddl$, vec_schema, vec_schema, vec_schema);
end
$mig$;

revoke all on function public.agent_knowledge_search(
  uuid, uuid, text, text, integer, double precision
) from public, anon, authenticated;

grant execute on function public.agent_knowledge_search(
  uuid, uuid, text, text, integer, double precision
) to service_role;

-- ---------------------------------------------------------
-- EXISTING AGENTS
--
-- Every agent that already has knowledge gets the capability
-- switched on, so retrieval is what knowledge means from here
-- rather than something each learner has to discover.
--
-- Nothing is deleted, nothing is rewritten, and no entry stops
-- reaching the model. An entry keeps `status = 'inline'` until
-- it has actually been indexed, and both composers keep
-- inlining it until then — so between this migration and the
-- first successful index, every agent behaves exactly as it did
-- yesterday.
-- ---------------------------------------------------------

update public.agents a
   set capabilities = array_append(a.capabilities, 'knowledge_retrieval'),
       updated_at   = now()
 where not ('knowledge_retrieval' = any (a.capabilities))
   and exists (
     select 1
       from public.agent_knowledge k
      where k.agent_id = a.id
   );
