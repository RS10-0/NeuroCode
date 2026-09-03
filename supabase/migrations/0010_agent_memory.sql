-- =========================================================
-- NEUROLINK — AGENT MEMORY
--
-- Phase 2.5, capability five. The first one since knowledge
-- retrieval that needs storage, and the reason is the same
-- reason 0008 and 0009 did not: durability.
--
-- A web result is fetched for one question and stale by the
-- next. An attached file exists to answer the question it was
-- attached to. Both are correct to keep nowhere. A memory is
-- the opposite of both — the entire value of "you are aiming
-- for a 5 on AP Calculus in May" is that it is still there
-- next week, in a conversation that has not started yet, in a
-- browser that has been closed since.
--
-- So this migration adds one table, one search function, and
-- one word to the usage ledger. There is still no second AI
-- runtime: extracting a memory and embedding one go through
-- the same power source, the same credentials, the same atomic
-- quota gate and the same ai_usage ledger as every other model
-- call NeuroLink makes.
--
-- WHAT THIS TABLE IS NOT is worth saying first, because the
-- obvious wrong implementation is much easier than the right
-- one. This is not a transcript store. Nothing here holds a
-- conversation, a message, or a turn. A row is one short,
-- durable, human-readable fact about the person an agent is
-- talking to, written deliberately by an extraction step that
-- had to decide the fact was worth keeping. A conversation
-- that produces nothing worth keeping produces no rows, which
-- is the common case and is not a failure.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- PGVECTOR
--
-- Same treatment as 0007, and for the same reason spelled out
-- at length there: which schema the extension lives in is not
-- knowable in advance, so every statement below that names the
-- type looks the schema up first and builds its DDL with
-- format().
--
-- Unlike 0007, retrieval here does not DEPEND on it. The
-- embedding column is nullable and the ranked tier of recall
-- never touches a vector, so an agent on a project where
-- embedding is unavailable still remembers — it simply picks
-- what to carry by recency rather than by relevance. See
-- server/src/agents/memory/recall.ts.
-- ---------------------------------------------------------

create extension if not exists "vector";

-- ---------------------------------------------------------
-- A UNIQUE KEY TO HANG DEPLOYMENT-SCOPED MEMORIES OFF
--
-- agent_deployments already carries unique (agent_id) from
-- 0006, which is not the same thing: a composite foreign key
-- needs a unique constraint on exactly the columns it
-- references. This is what makes "a memory attached to a
-- deployment of a DIFFERENT agent" unrepresentable rather than
-- merely unlikely.
--
-- `add constraint if not exists` does not exist in PostgreSQL,
-- hence the lookup — the same dance 0007 does for
-- agent_knowledge.
-- ---------------------------------------------------------

do $mig$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.agent_deployments'::regclass
       and conname  = 'agent_deployments_id_agent_id_key'
  ) then
    alter table public.agent_deployments
      add constraint agent_deployments_id_agent_id_key unique (id, agent_id);
  end if;
end
$mig$;

-- ---------------------------------------------------------
-- MEMORIES
--
-- One row per remembered fact.
--
-- THE OWNERSHIP MODEL IS THE POINT OF THIS TABLE, and it is
-- expressed as constraints rather than as predicates somebody
-- has to remember to write:
--
--   User -> Agent -> Memories.  Never User -> Memories.
--
-- A learner's Math Tutor remembers their weak spots in
-- algebra. Their College Essay Coach knows nothing about it,
-- and must not, because an agent that quietly inherits
-- everything its owner ever told a different agent is not a
-- feature — it is a privacy failure that also produces worse
-- answers. `agent_id` therefore leads the unique key, leads
-- the read index, and appears in the where clause of the
-- search function below.
--
-- SCOPE. A memory belongs to an (agent, subject) pair, where
-- the subject is whoever the agent was talking to:
--
--   deployment_id null  — the owner, testing in the Builder.
--                         Namespaced by their own user id.
--   deployment_id set   — somebody calling the deployed
--                         endpoint. Namespaced by the
--                         deployment, and optionally further
--                         by `subject`, a hash of the
--                         memoryKey that caller supplied.
--
-- The two never mix. An anonymous caller must not be able to
-- read what the owner told the agent privately in the Builder,
-- and the owner must not find a stranger's statements in their
-- own Test panel. That is the same boundary File Analysis
-- draws between an owner's attachments and a deployment's, and
-- it is drawn here the same way: by scope, resolved from a
-- verified deployment row, never read off a request body.
--
-- `user_id` is on EVERY row regardless of scope, and it is
-- always the OWNER. It is what RLS matches on, what the
-- cascade hangs off, and who pays — an anonymous caller has no
-- account to bill, so a deployed agent's remembering spends
-- its owner's allowance exactly as its answering does.
--
-- `scope_key` is generated rather than assembled by the
-- server, so there is no code path that can write a row into a
-- namespace its own columns do not describe.
--
-- `content` is capped at 400 characters BY THE DATABASE, not
-- only by the extractor. A memory is a sentence. Anything
-- longer is a transcript trying to get in, and the CHECK is
-- what makes that structurally impossible rather than a matter
-- of the prompt behaving.
--
-- `embedding` is NULLABLE and that is deliberate. Memory is
-- not allowed to depend on an embedding provider being up.
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
    create table if not exists public.agent_memories (
      id              uuid primary key default gen_random_uuid(),

      agent_id        uuid not null,
      -- Always the OWNER, whatever the scope. Billing anchor,
      -- RLS anchor, cascade anchor.
      user_id         uuid not null references auth.users (id) on delete cascade,

      -- Null for the owner's own scope. Set for a deployed
      -- caller's.
      deployment_id   uuid,

      -- Hash of the caller-supplied memoryKey, salted with the
      -- deployment id. Empty string outside a deployment.
      --
      -- Hashed rather than stored raw so NeuroLink never holds
      -- somebody's end-user identifier: an owner integrating
      -- this endpoint will reach for an email address, and the
      -- isolation works identically on a digest.
      subject         text not null default '',

      -- The namespace this memory can be read back in. Every
      -- read filters on it; nothing but this table computes
      -- it.
      scope_key       text generated always as (
                        coalesce(deployment_id::text, user_id::text)
                        || ':' || subject
                      ) stored,

      -- A closed vocabulary, because an open one becomes
      -- "note" for everything within a week and the ordering
      -- below stops meaning anything.
      kind            text not null default 'fact'
                      check (kind in (
                        'profile',    -- who they are: year, school, role
                        'preference', -- how they want to be helped
                        'goal',       -- what they are working towards
                        'project',    -- what they are working on now
                        'fact'        -- anything else durable and specific
                      )),

      -- One sentence. See the note above on why this cap is in
      -- the database and not only in the prompt.
      content         text not null
                      check (char_length(content) between 1 and 400),

      -- Hash of the normalised content. The dedupe key: saying
      -- the same thing twice in one scope updates a row rather
      -- than growing the table.
      fingerprint     text not null,

      origin          text not null default 'learned'
                      check (origin in ('learned', 'manual')),

      -- 'agent_test' or 'agent_public': which side of the
      -- product was talking when this was learned. Owner-facing
      -- only.
      source_feature  text,

      -- Nullable on purpose. Recall works without it.
      embedding       %I.vector(768),
      embedding_model text,

      -- Reinforcement. A memory that keeps being carried into
      -- prompts is a memory that keeps being useful, and this
      -- is what breaks the tie when the context budget runs
      -- short.
      use_count       integer not null default 0,
      revision        integer not null default 1,

      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now(),
      last_used_at    timestamptz,

      -- A subject only means something inside a deployment.
      constraint agent_memories_subject_scope_check
        check (deployment_id is not null or subject = ''),

      -- The ownership model. agent_id FIRST, so one learner's
      -- agents cannot see each other's memories even by
      -- accident.
      constraint agent_memories_scope_fingerprint_key
        unique (agent_id, scope_key, fingerprint),

      -- A memory of somebody else's agent is unrepresentable.
      foreign key (agent_id, user_id)
        references public.agents (id, user_id) on delete cascade,

      -- A memory attached to a deployment of a different agent
      -- is unrepresentable.
      foreign key (deployment_id, agent_id)
        references public.agent_deployments (id, agent_id) on delete cascade
    )
  $ddl$, vec_schema);
end
$mig$;

-- The ranked read: everything in one scope, newest first. This
-- is the index the common case uses, and the common case does
-- not touch a vector at all.
create index if not exists agent_memories_scope_idx
  on public.agent_memories (agent_id, scope_key, updated_at desc);

create index if not exists agent_memories_user_idx
  on public.agent_memories (user_id);

create index if not exists agent_memories_deployment_idx
  on public.agent_memories (deployment_id)
  where deployment_id is not null;

-- ---------------------------------------------------------
-- THE VECTOR INDEX
--
-- Wrapped exactly as 0007's is, and for the same reason: it is
-- an optimisation, not a correctness requirement, and a
-- project on a pgvector older than 0.5 should get a working
-- feature with a sequential scan rather than a migration that
-- will not apply.
--
-- It matters even less here than it does there. A learner's
-- agent holds tens of memories, not thousands of chunks, and
-- the vector path only runs at all once a scope has outgrown
-- the context budget.
-- ---------------------------------------------------------

do $mig$
declare
  vec_schema text;
begin
  if exists (
    select 1 from pg_class where relname = 'agent_memories_vec_idx'
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
      'create index agent_memories_vec_idx
         on public.agent_memories
         using hnsw (embedding %I.vector_cosine_ops)',
      vec_schema
    );
  exception
    when others then
      raise notice
        'HNSW index not created (%). Memory recall still works by sequential scan.',
        sqlerrm;
  end;
end
$mig$;

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-READ, and no write policy at all — the same posture
-- agent_knowledge_chunks takes in 0007 and agent_deployments
-- takes in 0006.
--
-- The reason is sharper here than anywhere else it has been
-- applied. What an agent remembers is a conclusion the server
-- reached from a conversation, through an extraction step that
-- is allowed to produce facts and is structurally incapable of
-- producing deletions. A browser INSERT policy would hand that
-- authority back to the client — anything running in the page
-- could write itself a memory, and the whole "the model cannot
-- silently make text authoritative" argument would be worth
-- nothing.
--
-- Deleting is a real thing a learner must be able to do, and
-- it does NOT get a policy either: it goes through
-- DELETE /api/agents/:agentId/memory on the server, which
-- resolves the agent under the caller's own id first. That
-- keeps one path for every mutation instead of two.
--
-- Read IS granted, because a learner ought to be able to check
-- the isolation this schema promises from their own session
-- rather than only from the service role.
-- ---------------------------------------------------------

alter table public.agent_memories enable row level security;

drop policy if exists agent_memories_owner_all  on public.agent_memories;
drop policy if exists agent_memories_owner_read on public.agent_memories;

create policy agent_memories_owner_read on public.agent_memories
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- SEARCH
--
-- The one query the semantic tier of recall runs.
--
-- SECURITY DEFINER and takes its scope as arguments, so it is
-- granted to service_role alone — the same treatment
-- agent_knowledge_search gets in 0007 and ai_usage_admit gets
-- in 0004. A function that bypasses RLS and trusts its
-- arguments must not be callable by anyone who could lie about
-- them.
--
-- THREE predicates, not one: user, agent, and scope. Each one
-- alone is a hole. The user id alone would let one of a
-- learner's agents answer out of another's memories, which is
-- the exact thing this feature promises not to do. The agent
-- id alone would be a cross-tenant read the moment a uuid was
-- guessed. The scope key alone would be both. None of the
-- three ever comes off a request body: the browser path
-- resolves the agent through AgentStore under the caller's own
-- id, and the deployed path inherits the owner from the
-- deployment row.
--
-- `p_exclude` is the ids already carried by the always-on
-- tier. Filtering them here rather than in Node keeps the
-- limit meaningful — asking for four more and getting four
-- already-included rows back would silently halve the block.
--
-- Rows with no embedding are invisible to this function and
-- that is correct: they are reachable through the ranked tier,
-- which is the tier that does not need one.
-- ---------------------------------------------------------

drop function if exists public.agent_memory_search(
  uuid, uuid, text, text, text, integer, double precision, uuid[]
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
    create or replace function public.agent_memory_search(
      p_user_id         uuid,
      p_agent_id        uuid,
      p_scope_key       text,
      p_embedding       text,
      p_embedding_model text,
      p_limit           integer default 10,
      p_min_similarity  double precision default 0,
      p_exclude         uuid[] default '{}'
    )
    returns table (
      id           uuid,
      kind         text,
      content      text,
      updated_at   timestamptz,
      use_count    integer,
      similarity   double precision
    )
    language plpgsql
    security definer
    set search_path = public, %I
    as $fn$
    declare
      q            %I.vector(768);
      max_rows     integer := greatest(1, least(coalesce(p_limit, 10), 50));
      floor_score  double precision := coalesce(p_min_similarity, 0);
      skip         uuid[] := coalesce(p_exclude, '{}');
    begin
      -- A missing scope is not an error to be reported, it is
      -- simply nothing to search. Returning no rows keeps the
      -- caller on its ranked-tier path, which is the path that
      -- must always work.
      if p_user_id is null or p_agent_id is null
         or p_scope_key is null or p_embedding is null
         or p_embedding_model is null then
        return;
      end if;

      q := p_embedding::%I.vector(768);

      return query
      select m.id,
             m.kind,
             m.content,
             m.updated_at,
             m.use_count,
             -- `<=>` is cosine DISTANCE, in [0, 2]. Every
             -- caller wants similarity, so the conversion
             -- happens once, here.
             (1 - (m.embedding <=> q))::double precision
        from public.agent_memories m
       where m.user_id         = p_user_id
         and m.agent_id        = p_agent_id
         and m.scope_key       = p_scope_key
         and m.embedding_model = p_embedding_model
         and m.embedding is not null
         and not (m.id = any (skip))
         and (1 - (m.embedding <=> q)) >= floor_score
       order by m.embedding <=> q
       limit max_rows;
    end;
    $fn$
  $ddl$, vec_schema, vec_schema, vec_schema);
end
$mig$;

revoke all on function public.agent_memory_search(
  uuid, uuid, text, text, text, integer, double precision, uuid[]
) from public, anon, authenticated;

grant execute on function public.agent_memory_search(
  uuid, uuid, text, text, text, integer, double precision, uuid[]
) to service_role;

-- ---------------------------------------------------------
-- USAGE VOCABULARY
--
-- One more feature on the ledger that already exists.
--
--   agent_memory — the small model call that reads a
--                  conversation and decides whether anything
--                  in it is worth remembering, and the
--                  embedding of a memory as it is written or
--                  of a question as it is recalled against.
--
-- One name for all of it because they answer one question —
-- what did remembering cost — and because a turn that
-- concluded "nothing worth keeping" is part of that cost even
-- though nothing was stored. Rows are told apart by `model`:
-- the extraction carries the answering model's id, an
-- embedding carries the embedding model's.
--
-- Counted under the quota key `memory:<power source>:<user
-- id>` — its own windows, for the reason spelled out in
-- server/src/ai/config.ts. A memory-backed turn is an answer
-- plus an extraction, and charging both to a learner's Lab
-- allowance would halve what they can do the moment they
-- switch the capability on.
--
-- A deployed agent's remembering is charged to the OWNER, like
-- its answering and its file reading, because an anonymous
-- caller has no allowance to spend.
--
-- Not nameable by a browser: server/src/ai/validation.ts keeps
-- it out of CLIENT_FEATURES, exactly as it does for
-- agent_public, agent_index, agent_retrieval, agent_web_search
-- and agent_file_analysis. This server decides to make the
-- call, so nothing else gets to claim it.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis', 'agent_memory'
  ));

-- ---------------------------------------------------------
-- CAPABILITY VOCABULARY
--
-- `agents.capabilities` is a text[] with no constraint on its
-- contents, so 'memory' needs no migration to be storable —
-- and deliberately so, for the reason 0008 and 0009 give. What
-- an agent is allowed to do is decided by the build that runs
-- it, not by the shape of the table:
-- src/features/agents/capabilities.ts drops any capability
-- this build cannot actually carry out, and
-- server/src/agents/deploymentRequest.ts reads the flag off
-- the stored row rather than off the request.
-- ---------------------------------------------------------
