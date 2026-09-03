-- =========================================================
-- NEUROLINK — GENERATED DOCUMENTS AND THE AGENT DATA STORE
--
-- Two capabilities that between them let an agent produce
-- something that outlives the turn it was made in: a real file
-- somebody can open, and a small set of records it can read
-- back next week.
--
-- Everything before this migration was about a CONVERSATION.
-- Knowledge, search, files, memory and actions all exist to
-- make one answer better, and every one of them is gone the
-- moment the answer is written. 0017 removed the person from
-- the room; this one removes the moment. A report generated at
-- four in the morning has to still be there at nine, and a
-- habit tracker that forgets between runs is a chat log with
-- extra steps.
--
-- Two tables, three functions. What this migration deliberately
-- does NOT add, for the eighth time, is a second runtime: both
-- capabilities arrive as entries in the existing tool
-- catalogue, go through the same `runTool`, are admitted by the
-- same SQL gate, and are written to the same ledger.
--
-- AND — READ THIS BEFORE LOOKING FOR IT — THERE IS NO
-- ai_usage_feature_check WIDENING IN THIS FILE.
--
-- Every widening from 0007 to 0017 added a new CALLER: a new
-- reason this server spends somebody's allowance. 0007 added
-- indexing, 0016 added acting, 0017 added the scheduler. These
-- two capabilities add TOOLS, and 'agent_action' already covers
-- "the tools an agent runs between the question and the
-- answer" — the rows are told apart by `model`, which carries
-- 'tool:make_document' or 'tool:data_set' where a model id
-- would go, exactly as 'tool:run_code' already does.
--
-- So a document render is the same KIND of row a sandbox run
-- is, and inventing a feature value for it would split one
-- question ("what did acting cost?") across two words. If you
-- are skimming this file for the widening statement because
-- the last eight had one, this paragraph is why it is absent.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- GENERATED DOCUMENTS
--
-- The bytes of a file an agent made, and the only table in
-- this project that holds a file at all.
--
-- 0009 made a deliberate promise about uploads that this table
-- has to be read against: an uploaded file is never stored and
-- never served back, because "a file must not become
-- permanently reachable because somebody knows a URL" has
-- exactly one airtight implementation, which is for there to
-- be no URL.
--
-- A GENERATED document is the other case, and the difference
-- is not a loosening. An upload is somebody's private document
-- held for half an hour to answer one question; a generated
-- document is the PRODUCT of the turn, and a report nobody can
-- open is not a report. What the promise actually protects —
-- no permanent reachability by URL alone — is kept here by
-- four things instead of by having no row:
--
--   the id is a v4 uuid, so nothing enumerates;
--   the route demands a Supabase session and matches user_id,
--     and a stranger's id is indistinguishable from a missing
--     one;
--   the row expires;
--   and there is no signed public URL and no anonymous path.
--
-- WHY `content` IS BASE64 IN A text COLUMN AND NOT bytea.
--
-- bytea over PostgREST comes back in whatever `bytea_output`
-- the session happens to be set to. That makes the wire format
-- depend on a database setting rather than on the code that
-- decodes it, and a storage format that can be reconfigured
-- underneath its decoder is a silent corruption waiting for
-- somebody to change a GUC. Base64 round-trips unchanged, says
-- what its own encoding is, and costs 33% — on a 1 MB ceiling
-- that is 1.37 MB of row, which Postgres TOASTs and compresses.
-- A third is worth paying for an encoding nothing can change
-- out from under the reader.
-- ---------------------------------------------------------

create table if not exists public.agent_documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  agent_id   uuid not null,

  -- Set for a scheduled or a manual run; null for a Test panel
  -- turn, which has no run row to hang off.
  --
  -- This column is also how the mail outbox finds a
  -- notification's attachments: the drain looks documents up by
  -- run_id rather than carrying a document_id on the
  -- notification, so a run that produced two files attaches two
  -- and agent_notifications needs no new column.
  run_id     uuid references public.agent_schedule_runs (id) on delete cascade,

  -- What the agent called it. Shown to the owner; also the
  -- basis of `filename`, after sanitising.
  title      text not null,
  -- Built server-side. A model never chooses a filename: it
  -- would be the one string in this table that reaches a
  -- filesystem, an email header and a Content-Disposition.
  filename   text not null,
  format     text not null,

  -- Of the DECODED file, not of the base64. This is the number
  -- the owner is shown and the number the ceiling is checked
  -- against, and storing the encoded length instead would
  -- overstate every file by a third.
  bytes      integer not null,
  content    text not null,

  -- Whichever of these the format has. A PDF has pages, a
  -- workbook has sheets and rows, a Word document has neither.
  -- Null means "this idea does not apply here", not "unknown".
  pages      smallint,
  row_count  integer,
  sheets     smallint,

  -- What could not be rendered, in words the owner can read.
  -- Null when nothing was lost.
  --
  -- The PDF writer's Latin-1 ceiling lands here: it draws the
  -- standard-14 Helvetica in WinAnsiEncoding, so a paragraph
  -- containing CJK or emoji comes through with visible
  -- placeholders and this column says how many. A title with
  -- ANY unrenderable character is refused outright and never
  -- reaches this table, because a report identified by a row of
  -- boxes is not a degraded report, it is an unusable one.
  degraded   text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- A document belonging to somebody else's agent is
  -- unrepresentable. The composite key 0013, 0016 and 0017 all
  -- carry, for the same reason each of them gives.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  constraint agent_documents_format check (format in ('pdf', 'xlsx', 'docx')),

  -- The ceiling, in the one place that cannot be talked out of
  -- it. The renderer checks it, the config declares it, and
  -- this is the layer that holds when a later build gets the
  -- first two wrong. Same four-layer argument 0010 makes about
  -- memory content length.
  constraint agent_documents_bytes check (bytes > 0 and bytes <= 1048576),

  constraint agent_documents_title check (length(title) between 1 and 200),
  constraint agent_documents_filename check (length(filename) between 1 and 200)
);

create index if not exists agent_documents_owner_idx
  on public.agent_documents (user_id, created_at desc);

create index if not exists agent_documents_agent_idx
  on public.agent_documents (user_id, agent_id, created_at desc);

-- Partial: most documents come from a Test panel turn and have
-- no run, and the drain only ever asks about the ones that do.
create index if not exists agent_documents_run_idx
  on public.agent_documents (run_id)
  where run_id is not null;

create index if not exists agent_documents_expiry_idx
  on public.agent_documents (expires_at);

-- ---------------------------------------------------------
-- THE AGENT DATA STORE
--
-- A small set of records an agent keeps for itself, per agent,
-- across turns and across scheduled runs.
--
-- IT IS NOT MEMORY, and the difference is worth stating here
-- because the two tables look alike and behave oppositely.
--
--   agent_memories holds the machine's INFERENCES about a
--   person. It is written by an extraction call the agent does
--   not control, capped at 400 characters because a memory is
--   a sentence, and it EVICTS the least recently used row when
--   it fills — because forgetting the thing you have not
--   needed in longest is what a person expects from something
--   called memory.
--
--   agent_data holds RECORDS THE OWNER ASKED THE AGENT TO
--   KEEP. It is written by the agent on purpose, through a
--   tool, and it REFUSES when it fills. Quietly dropping the
--   oldest row of a running log is data loss its owner never
--   sees and cannot diagnose, and in a log the oldest row is
--   the one with the most history behind it. A refusal is
--   something a person can act on; an eviction is not.
--
-- The scoping is memory's, copied deliberately rather than
-- reinvented: `User -> Agent -> Records`. A learner's Habit
-- Tracker and their Essay Coach are different agents, and an
-- agent that inherits everything its owner ever stored
-- anywhere is a privacy failure that also answers worse.
--
-- `deployment_id` and `subject` are null and '' in every row
-- this build writes: the capability is refused on the
-- deployment and published-page doors, because a data_set is a
-- MODEL-CHOSEN write and extending those to strangers' turns
-- is a bigger step than extending an inference to them. The
-- columns exist anyway, generating `scope_key` exactly as 0010
-- does, so that opening a deployment drawer later is a value
-- rather than a redesign.
-- ---------------------------------------------------------

create table if not exists public.agent_data (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  agent_id      uuid not null,

  -- Always null in this build. See the note above.
  deployment_id uuid references public.agent_deployments (id) on delete cascade,
  subject       text not null default '',

  -- Generated rather than assembled by the server, so there is
  -- no code path that can write a row into a namespace its own
  -- columns do not describe. MUST STAY IDENTICAL to scopeKeyOf
  -- in server/src/agents/data/scope.ts — a disagreement does
  -- not error, it produces an agent that writes records it can
  -- never read back, which looks exactly like the feature not
  -- working. The verify suite round-trips a written row to
  -- prove they agree.
  scope_key     text generated always as (
                  coalesce(deployment_id::text, user_id::text)
                  || ':' || subject
                ) stored,

  -- THE KEY, AND WHY THE DATABASE POLICES ITS SHAPE.
  --
  -- Lowercase, no spaces, 80 characters, and the same regex
  -- lives in the TypeScript validator. Two layers for one
  -- pattern, and the second one is not redundancy.
  --
  -- Keys are written by a MODEL, and they are the one thing in
  -- this feature that crosses to the trusted side of the
  -- prompt: the action block lists them so an agent does not
  -- have to spend one of its four steps on data_list before
  -- every data_get, exactly as it already lists connection
  -- names. But a connection name was typed by the owner into a
  -- form.
  --
  -- Banning spaces is what makes that safe enough to do. A key
  -- is always ONE UNBROKEN TOKEN, so the worst a hostile key
  -- can look like is `ignore_all_previous_instructions`, which
  -- reads as an identifier rather than as a sentence — and it
  -- arrives quoted, in a labelled list, with the
  -- anti-confabulation rule still last in the block after it.
  --
  -- That is mitigation, not proof, and the honest fallback is
  -- NEUROLINK_DATA_INDEX_KEYS=0, which stops injecting the
  -- index at all and costs one step. This CHECK is the layer
  -- that holds if the validator is ever weakened.
  key           text not null,

  -- Text, not jsonb. A JSON column invites deep nested objects
  -- and then the size cap has to be expressed in a way the
  -- model cannot predict; text has one cap the model can be
  -- TOLD. An agent that wants structure writes JSON into the
  -- string and parses it with run_code, which on a teaching
  -- platform is the lesson rather than a workaround.
  value         text not null,

  -- The agent's own one-line note on what this record is for.
  -- Shown on the owner's Data screen and never sent back to the
  -- model, which already knows.
  label         text,

  revision      integer not null default 1,

  -- A SOFT DELETE, and it is here to keep a doctrine intact
  -- rather than to be clever.
  --
  -- 0010 and MemoryStore both state the rule: a person can
  -- delete a memory, and nothing — no conversation, no
  -- document, no web page, no model output — can. But a habit
  -- tracker in which nothing can ever be removed is broken, so
  -- this feature needs a delete the agent may call.
  --
  -- So model output may RETIRE a record: the row stops
  -- counting against the caps, stops appearing in reads, and is
  -- swept a week later. Only a person DESTROYS one, from the
  -- Data screen, where retired records are listed with a
  -- Restore button until the sweep takes them. The doctrine is
  -- unchanged; what the model got was a verb that is not
  -- destruction.
  deleted_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A record on somebody else's agent is unrepresentable.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  -- A record attached to a deployment of a different agent is
  -- unrepresentable. Dormant in this build; correct the moment
  -- the drawer opens.
  foreign key (deployment_id, agent_id)
    references public.agent_deployments (id, agent_id) on delete cascade,

  constraint agent_data_subject_scope
    check (deployment_id is not null or subject = ''),

  constraint agent_data_key_shape
    check (key ~ '^[a-z0-9][a-z0-9_.:/-]{0,79}$'),

  constraint agent_data_value_size
    check (length(value) between 1 and 2000),

  constraint agent_data_label_size
    check (label is null or length(label) <= 200)
);

-- agent_id FIRST, so one learner's agents cannot collide in
-- each other's namespace even by accident. The same ordering
-- 0010 uses and for the same reason.
create unique index if not exists agent_data_identity
  on public.agent_data (agent_id, scope_key, key);

-- What every read actually filters on. Partial, because a
-- retired record is invisible to all of them.
create index if not exists agent_data_live_idx
  on public.agent_data (user_id, agent_id, scope_key, key)
  where deleted_at is null;

create index if not exists agent_data_retired_idx
  on public.agent_data (deleted_at)
  where deleted_at is not null;

-- =========================================================
-- WRITING A RECORD
--
-- One statement, for the reason agent_schedule_settle is one
-- statement: the cap check and the write must not be
-- separable. Two API processes writing the two-hundredth
-- record simultaneously would each read 199 and each insert,
-- and the store would quietly sit one over its ceiling for
-- ever.
--
-- Returns what happened rather than raising, because "your
-- store is full" is a message the agent has to be able to read
-- and pass on to a person — not an exception that fails a turn.
-- =========================================================

create or replace function public.agent_data_put(
  p_user_id         uuid,
  p_agent_id        uuid,
  p_key             text,
  p_value           text,
  p_label           text default null,
  p_max_records     integer default 200,
  p_max_total_chars integer default 200000,
  p_deployment_id   uuid default null,
  p_subject         text default ''
)
returns table (
  status      text,
  records     integer,
  total_chars integer,
  revision    integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_scope_key   text;
  v_existing    public.agent_data%rowtype;
  v_live        integer;
  v_chars       integer;
  v_incoming    integer;
  v_replaced    integer := 0;
  v_revision    integer;
begin
  -- Computed here rather than taken as an argument, so the one
  -- definition of a namespace is the generated column and this
  -- line, which have to agree with each other and with nothing
  -- else.
  v_scope_key := coalesce(p_deployment_id::text, p_user_id::text)
                 || ':' || coalesce(p_subject, '');

  v_incoming := length(p_key) + length(p_value);

  select * into v_existing
    from public.agent_data
   where agent_id  = p_agent_id
     and scope_key = v_scope_key
     and key       = p_key;

  -- A live row being overwritten does not count twice against
  -- the character ceiling, so its current size comes off the
  -- total before the new size goes on. Without this, editing
  -- one long record repeatedly would walk a store into a
  -- refusal it never actually reached.
  if v_existing.id is not null and v_existing.deleted_at is null then
    v_replaced := length(v_existing.key) + length(v_existing.value);
  end if;

  select count(*)::integer,
         coalesce(sum(length(key) + length(value)), 0)::integer
    into v_live, v_chars
    from public.agent_data
   where agent_id   = p_agent_id
     and scope_key  = v_scope_key
     and deleted_at is null;

  if v_chars - v_replaced + v_incoming > greatest(1000, p_max_total_chars) then
    return query select 'full_chars'::text, v_live, v_chars, 0;
    return;
  end if;

  -- Only a NEW live record can push the count over. Updating an
  -- existing one cannot, and resurrecting a retired one can —
  -- which is why the predicate is about liveness rather than
  -- about the row existing.
  if (v_existing.id is null or v_existing.deleted_at is not null)
     and v_live >= greatest(1, p_max_records) then
    return query select 'full_records'::text, v_live, v_chars, 0;
    return;
  end if;

  if v_existing.id is null then
    insert into public.agent_data (
      user_id, agent_id, deployment_id, subject, key, value, label
    ) values (
      p_user_id, p_agent_id, p_deployment_id, coalesce(p_subject, ''),
      p_key, p_value, p_label
    )
    returning agent_data.revision into v_revision;

    return query
      select 'created'::text,
             v_live + 1,
             v_chars + v_incoming,
             v_revision;
    return;
  end if;

  update public.agent_data
     set value      = p_value,
         label      = coalesce(p_label, label),
         revision   = agent_data.revision + 1,
         deleted_at = null,
         updated_at = now()
   where id = v_existing.id
  returning agent_data.revision into v_revision;

  return query
    select case when v_existing.deleted_at is null
                then 'updated'::text
                else 'restored'::text
           end,
           case when v_existing.deleted_at is null
                then v_live
                else v_live + 1
           end,
           v_chars - v_replaced + v_incoming,
           v_revision;
end;
$fn$;

-- =========================================================
-- KEEPING THE DOCUMENT TABLE SMALL
--
-- Two functions rather than one, because they answer at
-- different moments: `prune` runs on every write and bounds
-- the writer, `sweep` runs hourly off the scheduler tick and
-- bounds everybody.
--
-- THREE BOUNDS, and the count bounds matter more than the age
-- one. A six-hourly schedule producing a 1 MB report makes 28
-- files in a seven-day window; the per-agent count is what
-- stops that, and the expiry is the backstop for an agent that
-- generates rarely. Both counts are passed in rather than
-- baked here, because neither has a correct value and an
-- operator running this for a class of forty has a different
-- answer than one running it for themselves.
-- =========================================================

create or replace function public.agent_documents_prune(
  p_user_id          uuid,
  p_agent_id         uuid,
  p_keep_per_agent   integer default 10,
  p_keep_per_user    integer default 20
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer := 0;
  n       integer;
begin
  delete from public.agent_documents
   where user_id = p_user_id
     and expires_at <= now();

  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.agent_documents d
   using (
     select id,
            row_number() over (order by created_at desc) as rn
       from public.agent_documents
      where user_id  = p_user_id
        and agent_id = p_agent_id
   ) ranked
   where ranked.id = d.id
     and ranked.rn > greatest(1, p_keep_per_agent);

  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.agent_documents d
   using (
     select id,
            row_number() over (order by created_at desc) as rn
       from public.agent_documents
      where user_id = p_user_id
   ) ranked
   where ranked.id = d.id
     and ranked.rn > greatest(1, p_keep_per_user);

  get diagnostics n = row_count;
  removed := removed + n;

  return removed;
end;
$fn$;

-- Expired documents everywhere, and retired data records past
-- their restore window. One function because they run on the
-- same hourly branch of the same tick and neither is worth its
-- own round trip.
create or replace function public.agent_documents_sweep(
  p_retired_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer := 0;
  n       integer;
begin
  delete from public.agent_documents
   where expires_at <= now();

  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.agent_data
   where deleted_at is not null
     and deleted_at < now() - make_interval(days => greatest(1, p_retired_days));

  get diagnostics n = row_count;
  removed := removed + n;

  return removed;
end;
$fn$;

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-read on both. Every write goes through Express with
-- the service role.
--
-- The same posture agent_memories, agent_connections,
-- agent_sites and agent_schedules take, and on agent_data it
-- has the sharpest teeth of any of them. A browser that could
-- write this table could rewrite what its agent believes about
-- the world between one run and the next — and unlike a
-- memory, which is a sentence the agent produced about a
-- person, a record here is something the agent will read back
-- and compute from. The write path is one function, reachable
-- only by the service role, and there is no policy on either
-- table that admits an INSERT or an UPDATE from a session.
--
-- No anon policy on either. A stranger has no business knowing
-- that a learner has files, let alone holding one.
-- ---------------------------------------------------------

alter table public.agent_documents enable row level security;
alter table public.agent_data      enable row level security;

drop policy if exists agent_documents_owner_read on public.agent_documents;
drop policy if exists agent_documents_owner_all  on public.agent_documents;
drop policy if exists agent_data_owner_read      on public.agent_data;
drop policy if exists agent_data_owner_all       on public.agent_data;

create policy agent_documents_owner_read
  on public.agent_documents
  for select
  using (auth.uid() = user_id);

create policy agent_data_owner_read
  on public.agent_data
  for select
  using (auth.uid() = user_id);

revoke all on public.agent_documents from anon;
revoke all on public.agent_data      from anon;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as 0003's and 0017's: CREATE FUNCTION grants
-- execute to PUBLIC by default, and these are security
-- definer, so a signed-in session could otherwise call
-- agent_data_put with any user id it liked and write a record
-- into somebody else's agent. Only Express holds the service
-- role, so nothing else needs the grant.
-- ---------------------------------------------------------

revoke all on function public.agent_data_put(
  uuid, uuid, text, text, text, integer, integer, uuid, text) from public;
revoke all on function public.agent_documents_prune(uuid, uuid, integer, integer) from public;
revoke all on function public.agent_documents_sweep(integer) from public;

grant execute on function public.agent_data_put(
  uuid, uuid, text, text, text, integer, integer, uuid, text) to service_role;
grant execute on function public.agent_documents_prune(uuid, uuid, integer, integer) to service_role;
grant execute on function public.agent_documents_sweep(integer) to service_role;
