-- =========================================================
-- NEUROLINK — SCHEDULED AGENT RUNS
--
-- The capability that lets an agent do its work with nobody
-- watching: a fixed task, a cadence, and a run that happens
-- whether or not anyone has the Builder open.
--
-- Every capability before this one was provoked by a person.
-- Somebody pressed Run, or called a deployment, or opened a
-- published page — and that person was there to read the answer
-- and notice if it was wrong. This one has no such person, and
-- almost everything below exists because of that absence:
--
--   `outcome` and the `claim_*` columns on the run table are
--   the machine's replacement for a learner looking at the step
--   list and disbelieving an answer.
--
--   The three counters on the schedule table are the machine's
--   replacement for somebody noticing it has failed all week.
--
--   `lease_until` is what stops two API processes running the
--   same schedule, which no interactive path ever needed.
--
-- Three tables, three functions, one widened constraint. What
-- this migration deliberately does NOT add, for the seventh
-- time, is a second runtime. A scheduled run goes through the
-- same `runChat` the Lab calls, takes the same tools through
-- the same sandbox, is admitted by the same SQL gate, and is
-- written to the same ledger. Nothing here mentions a tool,
-- because nothing here needed to.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- USAGE ATTRIBUTION
--
-- 'agent_scheduled' is the turn a schedule provoked: one model
-- call, plus whatever the action loop did inside it. The tool
-- rows those steps write still carry 'agent_action', unchanged
-- — this value names WHO asked, not what ran.
--
-- Its own value rather than reusing 'agent_test', and the
-- distinction is the whole reason it exists. An 'agent_test'
-- row is a learner sitting in the Builder pressing Run. An
-- 'agent_scheduled' row is this server deciding, on a timer,
-- to spend that learner's allowance while they are asleep.
-- Somebody reading the ledger to answer "what is this account
-- spending money on" needs those to be different words.
--
-- Not nameable by a browser. CLIENT_FEATURES in
-- server/src/ai/validation.ts is an allowlist and this value is
-- not on it, exactly as 'agent_public' and 'agent_site' are
-- not — so the only thing that can write one of these rows is
-- the scheduler.
--
-- This is the EIGHTH widening of this constraint. See 0007,
-- 0008, 0009, 0010, 0013 and 0016 for the previous ones.
--
-- It is also, as ever, the statement most likely to be
-- forgotten, and forgetting it costs more here than anywhere
-- before. An un-applied migration under an interactive feature
-- shows a learner an error and they try again. Under this one
-- it fails inside the insert, on a timer, with nobody watching
-- — and since a refused insert is an infra_failure, three ticks
-- later the circuit breaker disables the schedule. The startup
-- banner asserts this value is accepted before the ticker
-- starts, for exactly that reason.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis', 'agent_memory',
    'agent_site', 'site_edit', 'agent_action', 'agent_scheduled'
  ));

-- ---------------------------------------------------------
-- SCHEDULES
--
-- One row per "run this task on this cadence".
--
-- THERE ARE NO CAPABILITY COLUMNS ON THIS TABLE, and their
-- absence is a security decision rather than an omission.
--
-- Whether a scheduled run may execute code or reach the
-- internet is read off the agent row at run time, exactly as
-- agents/deploymentRequest.ts reads it for a deployed caller.
-- If those flags lived here they would be a second copy of the
-- owner's intent, free to disagree with the first — and the
-- disagreement would be discovered by an unattended run
-- spending credentials its owner had switched off in the
-- Builder a month earlier. A column that cannot exist cannot
-- drift.
--
-- The same argument covers the model, the temperature and the
-- instructions. This table holds WHEN and WHAT TO ASK. The
-- agent row holds WHO IS ASKED and WHAT THEY MAY DO.
-- ---------------------------------------------------------

create table if not exists public.agent_schedules (
  id            uuid primary key default gen_random_uuid(),

  agent_id      uuid not null,
  user_id       uuid not null references auth.users (id) on delete cascade,

  label         text not null,

  -- ===================================================
  -- THE TASK
  --
  -- The entire message the model is shown, every run, for as
  -- long as this row lives.
  --
  -- Fixed at the owner's keystrokes and interpolated with
  -- nothing. That is a stronger constraint than it looks, and
  -- it is what keeps the Phase 1 tool posture intact: the
  -- whole action protocol is built on the asymmetry that the
  -- INSTRUCTION is trusted and the TOOL OUTPUT is not — which
  -- is why a tool result arrives nonce-fenced, quoted, and
  -- explicitly labelled as data.
  --
  -- A task assembled from anything a previous run fetched
  -- would invert that asymmetry: a poisoned API response would
  -- become the next run's instruction, on the trusted side of
  -- the fence, on a timer. So there is no templating here, no
  -- chaining, and no column that could carry one.
  -- ===================================================
  task          text not null,

  -- Cadence is a closed vocabulary rather than a cron string,
  -- for the reason ActionToolId is a closed union: it makes the
  -- frequency floor structural instead of validated. There is
  -- no value here that means "every minute", so no code path
  -- has to refuse one. (It also means a fifteen-year-old does
  -- not have to learn `0 */6 * * *` to use this.)
  cadence       text not null,

  -- Read only by the two clock-anchored cadences. An interval
  -- cadence is an offset from its own last run and has nothing
  -- to anchor to a wall clock.
  hour_local    smallint not null default 9,
  weekday_local smallint,
  timezone      text not null default 'UTC',

  -- Off until a preview run has proved the task. See
  -- verified_task_hash below.
  enabled       boolean not null default false,

  -- Advanced by the claim, then corrected precisely by the
  -- runner. Null when disabled: an enabled schedule with no due
  -- time would be invisible to the claim and would simply never
  -- run, which is the kind of silent nothing this whole feature
  -- exists to make impossible. The constraint at the bottom
  -- refuses that state.
  next_run_at   timestamptz,
  last_run_at   timestamptz,

  -- ===================================================
  -- THE LEASE
  --
  -- Held from the moment a tick claims this row until its run
  -- settles. It is what makes "two API processes are ticking
  -- at the same second" a non-event rather than a duplicate
  -- run charged twice.
  --
  -- An EXPIRED lease is reaped, not respected. A process
  -- killed mid-run would otherwise hold its schedule for ever,
  -- and a schedule that never runs again because a container
  -- was recycled is precisely the silent failure the circuit
  -- breaker cannot catch — the breaker counts failed runs, and
  -- a run that never starts is not one.
  --
  -- Same shape and same reasoning as the abandoned-row reaper
  -- at the top of ai_usage_admit in 0003.
  -- ===================================================
  lease_until   timestamptz,

  -- ===================================================
  -- THE COUNTERS
  --
  -- Three, because there are three different things going
  -- wrong and they do not deserve the same response.
  --
  -- `consecutive_failures` counts runs that produced nothing
  -- usable — the provider cascade exhausted, a timeout, a
  -- refused insert, or a run caught claiming work it did not
  -- do. Trips at 3. Three, because the cascade already absorbs
  -- single-vendor trouble inside one request, so a failure
  -- that reaches this column means all four providers were
  -- unavailable at once. One would disable a schedule over an
  -- outage nobody noticed; two can be spanned by a single
  -- deploy window. Three at the cadence floor is eighteen
  -- hours of consistent breakage.
  --
  -- `consecutive_confabulations` counts only the runs that
  -- lied, and trips sooner, at 2. It is stricter because it is
  -- not a transient class of failure: a run that claims to
  -- have used a tool it never used means the task and the
  -- agent's capabilities disagree, which waiting does not fix.
  -- And the harm is the specific one this phase exists to
  -- prevent — a plausible wrong answer delivered on a timer to
  -- somebody who is not checking.
  --
  -- `consecutive_limits` counts runs that ran out of steps and
  -- answered anyway. It NEVER disables anything. That run
  -- produced an answer; the schedule is under-specified, not
  -- broken, and the fix is an edit the owner has to be told
  -- about rather than a switch this server should throw.
  --
  -- All of them are reset by a run that completed, which
  -- includes limit_reached — see agent_schedule_settle for why
  -- that is the right reading rather than a leniency.
  -- ===================================================
  consecutive_failures       smallint not null default 0,
  consecutive_confabulations smallint not null default 0,
  consecutive_limits         smallint not null default 0,
  consecutive_skips          smallint not null default 0,

  disabled_at     timestamptz,
  disabled_reason text,

  -- ===================================================
  -- THE PREVIEW GATE
  --
  -- A hash of the task text that a manual run last carried to
  -- a successful finish. The enable path compares it against
  -- `task` and refuses when they differ.
  --
  -- Which means a schedule cannot be switched on until its
  -- owner has watched it work once, and editing the task
  -- switches the gate back on. That costs one run to discover
  -- a broken instruction, instead of a day of failures
  -- discovered by email — and it is the only moment in this
  -- feature's life when a student is guaranteed to look at
  -- what their agent actually does.
  -- ===================================================
  verified_task_hash text,

  notify_email      boolean not null default true,
  notify_on_success boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The composite key agent_knowledge, agent_deployments,
  -- agent_sites and agent_connections all carry, for the same
  -- reason: it makes "a schedule on somebody else's agent"
  -- unrepresentable rather than merely unreachable.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  constraint agent_schedules_cadence check (
    cadence in ('every_6_hours', 'every_12_hours', 'daily', 'weekly')),

  -- Long enough to be a real instruction, short enough that it
  -- cannot become a smuggled knowledge base.
  constraint agent_schedules_task_length check (
    length(task) between 10 and 2000),

  constraint agent_schedules_label_length check (
    length(label) between 1 and 80),

  constraint agent_schedules_hour check (hour_local between 0 and 23),

  constraint agent_schedules_weekday check (
    cadence <> 'weekly' or weekday_local between 0 and 6),

  constraint agent_schedules_disabled_reason check (
    disabled_reason is null or disabled_reason in (
      'consecutive_failures', 'confabulation', 'agent_unavailable', 'owner')),

  -- See next_run_at above. An enabled schedule that is not due
  -- at any time is a row that silently does nothing.
  constraint agent_schedules_enabled_has_next check (
    not enabled or next_run_at is not null)
);

-- The claim's index. Partial on `enabled` because a disabled
-- schedule is never due, and the table is expected to be mostly
-- disabled rows once the breaker has done its work.
create index if not exists agent_schedules_due_idx
  on public.agent_schedules (next_run_at)
  where enabled;

create index if not exists agent_schedules_owner_idx
  on public.agent_schedules (user_id, created_at);

create index if not exists agent_schedules_agent_idx
  on public.agent_schedules (agent_id, created_at);

-- ---------------------------------------------------------
-- RUNS
--
-- One row per attempt, written when the run starts and
-- completed when it settles.
--
-- Written at the START, with a null outcome, and that is
-- deliberate: a row that appears only on success cannot record
-- a process that died mid-run, which is the failure an
-- unattended system most needs to be able to see. A run row
-- with a null outcome and an expired lease is exactly what the
-- reaper looks for.
--
-- This table is also the whole of the owner-facing evidence. A
-- learner who wants to know whether their agent really fetched
-- that number reads `trace`, and the answer has to be there
-- whether the run succeeded, failed, or was caught inventing
-- it.
-- ---------------------------------------------------------

create table if not exists public.agent_schedule_runs (
  id          uuid primary key default gen_random_uuid(),

  schedule_id uuid not null
              references public.agent_schedules (id) on delete cascade,
  agent_id    uuid not null,
  user_id     uuid not null references auth.users (id) on delete cascade,

  -- 'manual' is the preview run behind the enable gate. It goes
  -- in this table rather than a separate one because it must be
  -- the SAME run in every respect that matters — same path,
  -- same cost, same categorisation, same trace. A preview that
  -- were recorded differently would be evidence about a
  -- different thing than the one being enabled.
  trigger     text not null default 'schedule',

  -- Null while running. See the note above.
  outcome     text,

  -- The specific reason, where there is one: an ai_usage error
  -- code, 'step_limit', 'budget', 'out_of_xp', 'abandoned'.
  detail      text,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  latency_ms  integer,

  output           text,
  output_truncated boolean not null default false,
  finish_reason    text,

  steps         smallint not null default 0,
  tool_calls    smallint not null default 0,
  tool_failures smallint not null default 0,

  -- The tool_call and tool_result events, verbatim, as the
  -- runtime emitted them.
  --
  -- Safe to store as-is because they are already redacted at
  -- the source: a connection's secret is attached by the server
  -- on the way out to the remote host and never appears in the
  -- args the model wrote. That is a Phase 1 property this table
  -- inherits rather than re-establishes — see the note on
  -- `tool_call` in server/src/ai/types.ts.
  trace         jsonb not null default '[]'::jsonb,

  -- ===================================================
  -- THE CONFABULATION VERDICT
  --
  -- Kept as evidence rather than only as a label, because a
  -- flag a student cannot audit is a flag they will learn to
  -- ignore. `claim_phrase` is the exact text that matched, so
  -- the UI can show them the sentence rather than an
  -- accusation.
  --
  -- `no_tools_used` is the weaker signal and is deliberately
  -- NOT an outcome: an agent that answered without a tool has
  -- usually done nothing wrong. It earns a column because a
  -- schedule where it is true every single time is one whose
  -- task probably never needed an agent, and that is worth
  -- being able to say.
  -- ===================================================
  claim_matched boolean not null default false,
  claim_phrase  text,
  no_tools_used boolean not null default false,

  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  xp_spent      smallint not null default 0,

  -- How many due windows were collapsed into this run.
  --
  -- Non-zero means the API was down or asleep. The runs are not
  -- replayed — a backlog burst is how an unattended system
  -- turns an outage into a bill, and nobody wants three
  -- identical 4am digests at once — so this number is the only
  -- record that the gap happened, and the UI says so.
  missed_runs   smallint not null default 0,

  constraint agent_schedule_runs_outcome check (
    outcome is null or outcome in (
      'succeeded', 'limit_reached', 'confabulated',
      'infra_failure', 'skipped')),

  constraint agent_schedule_runs_trigger check (
    trigger in ('schedule', 'manual'))
);

create index if not exists agent_schedule_runs_schedule_idx
  on public.agent_schedule_runs (schedule_id, started_at desc);

create index if not exists agent_schedule_runs_user_idx
  on public.agent_schedule_runs (user_id, started_at desc);

-- The reaper's index: unfinished runs, oldest first.
create index if not exists agent_schedule_runs_open_idx
  on public.agent_schedule_runs (started_at)
  where outcome is null;

-- ---------------------------------------------------------
-- NOTIFICATIONS
--
-- The feed, and the email outbox, in one table.
--
-- One table rather than two because they are one thing seen
-- twice: every notification is a feed entry, and some of them
-- are also an email. Splitting them would mean a row that
-- exists in the feed and a row that exists in the outbox
-- agreeing about what happened, which is a consistency problem
-- nobody needs.
--
-- `email_state` is what makes email OPTIONAL rather than
-- required. With no provider key configured every row sits at
-- 'none', the feed works completely, and a fresh clone still
-- runs — the same property the provider cascade's mock
-- fallback protects.
--
-- Sending is drained by the tick, not by the run. An email
-- provider having a bad minute must not be able to turn a
-- successful run into a failed one.
-- ---------------------------------------------------------

create table if not exists public.agent_notifications (
  id          uuid primary key default gen_random_uuid(),

  user_id     uuid not null references auth.users (id) on delete cascade,

  kind        text not null,

  schedule_id uuid references public.agent_schedules (id) on delete cascade,

  -- Set null rather than cascade: a notification outlives the
  -- run it describes when retention sweeps the run away, and
  -- "your schedule was disabled" is still true after the
  -- evidence has aged out.
  run_id      uuid references public.agent_schedule_runs (id) on delete set null,

  title text not null,
  body  text not null,

  read_at timestamptz,

  email_state    text not null default 'none',
  email_attempts smallint not null default 0,
  email_error    text,
  email_sent_at  timestamptz,

  created_at timestamptz not null default now(),

  constraint agent_notifications_kind check (
    kind in ('run_output', 'run_failed', 'schedule_disabled', 'limit_advisory')),

  constraint agent_notifications_email_state check (
    email_state in ('none', 'pending', 'sent', 'failed'))
);

create index if not exists agent_notifications_user_idx
  on public.agent_notifications (user_id, created_at desc);

-- The unread badge.
create index if not exists agent_notifications_unread_idx
  on public.agent_notifications (user_id)
  where read_at is null;

-- The outbox drain.
create index if not exists agent_notifications_outbox_idx
  on public.agent_notifications (created_at)
  where email_state = 'pending';

-- One disable notice per disable. The reconciliation pass in
-- the tick re-creates a notice that a crashed process failed to
-- write, and this is what stops it writing a second one for a
-- schedule that already has one.
create unique index if not exists agent_notifications_one_disable_idx
  on public.agent_notifications (schedule_id, kind)
  where kind = 'schedule_disabled' and read_at is null;

-- =========================================================
-- CLAIM THE DUE SCHEDULES
--
-- The one function in this file that has to be exactly right,
-- because it is the only thing standing between "two API
-- processes are ticking" and "this learner was charged twice
-- for one digest".
--
-- Everything it does is in one statement, under one lock:
--
--   reap leases that outlived their process
--   -> select the due rows, skipping any another tick holds
--   -> count the windows that were missed
--   -> push next_run_at FORWARD FROM NOW, never from the old
--      value, so an outage collapses into one run
--   -> stamp a lease
--
-- The next_run_at it writes is a provisional floor: a plain
-- interval that guarantees this row cannot fire again
-- immediately. The runner replaces it with the precise value —
-- computed in TypeScript, where a timezone is a solved problem
-- and a DST boundary can be unit-tested. If the runner never
-- gets there, the floor is what remains, and a schedule an hour
-- off its usual minute is a far better failure than one that
-- fires in a loop.
-- =========================================================

create or replace function public.agent_schedule_claim(
  p_limit          integer default 5,
  p_lease_seconds  integer default 900
)
returns table (
  schedule_id   uuid,
  agent_id      uuid,
  user_id       uuid,
  task          text,
  cadence       text,
  hour_local    smallint,
  weekday_local smallint,
  timezone      text,
  missed_runs   smallint,
  due_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  lease_cutoff timestamptz := now();
begin
  -- ---- 1. Reap ------------------------------------------
  --
  -- A process killed mid-run leaves two things behind: a
  -- schedule holding a lease nobody is using, and a run row
  -- that will never be finished. Both are cleared here rather
  -- than by a timer, for the reason FileStore gives for
  -- sweeping on write: the only way they accumulate is by
  -- being created, and this is the thing that creates them.

  update public.agent_schedule_runs r
     set outcome     = 'infra_failure',
         detail      = 'abandoned',
         finished_at = now(),
         latency_ms  = greatest(0, extract(epoch from (now() - r.started_at))::integer * 1000)
   where r.outcome is null
     and r.started_at < now() - make_interval(secs => p_lease_seconds);

  -- The counter still has to move for an abandoned run, or a
  -- server that crashes on every attempt would fail for ever
  -- without ever tripping the breaker. This is the one place
  -- the settle function's job is done somewhere else, and it
  -- is why it is done in the same statement block.
  update public.agent_schedules s
     set consecutive_failures = s.consecutive_failures + 1,
         lease_until          = null,
         updated_at           = now()
   where s.lease_until is not null
     and s.lease_until < lease_cutoff;

  -- ---- 2. Claim -----------------------------------------

  return query
  with due as (
    select s.id
      from public.agent_schedules s
     where s.enabled
       and s.next_run_at is not null
       and s.next_run_at <= now()
       and (s.lease_until is null or s.lease_until < lease_cutoff)
     order by s.next_run_at
     limit greatest(1, p_limit)
       for update skip locked
  ),
  stepped as (
    select
      s.id,
      s.agent_id,
      s.user_id,
      s.task,
      s.cadence,
      s.hour_local,
      s.weekday_local,
      s.timezone,
      s.next_run_at as due_at,
      case s.cadence
        when 'every_6_hours'  then interval '6 hours'
        when 'every_12_hours' then interval '12 hours'
        when 'daily'          then interval '1 day'
        else                       interval '7 days'
      end as step
      from public.agent_schedules s
      join due on due.id = s.id
  )
  update public.agent_schedules s
     set lease_until = now() + make_interval(secs => greatest(60, p_lease_seconds)),
         last_run_at = now(),
         -- FORWARD FROM NOW. Not `next_run_at + step`, which
         -- would queue up every window the outage covered and
         -- fire them back to back the moment the API returned.
         next_run_at = now() + stepped.step,
         updated_at  = now()
    from stepped
   where s.id = stepped.id
  returning
    s.id,
    s.agent_id,
    s.user_id,
    s.task,
    s.cadence,
    s.hour_local,
    s.weekday_local,
    s.timezone,
    -- How many whole windows went by unserved. Zero on a
    -- healthy schedule; the size of the gap after an outage.
    least(
      32767,
      greatest(
        0,
        floor(
          extract(epoch from (now() - stepped.due_at))
          / greatest(1, extract(epoch from stepped.step))
        )
      )
    )::smallint,
    stepped.due_at;
end;
$fn$;

-- =========================================================
-- SETTLE A RUN
--
-- Writes the run's terminal state, moves the counters, and
-- trips the breaker — in one statement, on purpose.
--
-- Doing the counter in Node afterwards would mean a process
-- that died in between produced a schedule which had failed
-- and did not know it. Interactively that is a bug somebody
-- notices; here it is a schedule that fails silently for ever,
-- which is the exact outcome this feature exists to prevent.
--
-- It does NOT write the notification. That is Node's job, from
-- the decision this function returns, for two reasons: the
-- wording of a notice belongs where wording is easy to get
-- right, and a notification is the one piece of this that can
-- be safely reconstructed later — the tick reconciles a
-- disabled schedule that has no disable notice. The durable
-- state is the run row and the counters, and both are here.
-- =========================================================

create or replace function public.agent_schedule_settle(
  p_run_id           uuid,
  p_outcome          text,
  p_detail           text default null,
  p_output           text default null,
  p_output_truncated boolean default false,
  p_finish_reason    text default null,
  p_steps            integer default 0,
  p_tool_calls       integer default 0,
  p_tool_failures    integer default 0,
  p_trace            jsonb default '[]'::jsonb,
  p_claim_matched    boolean default false,
  p_claim_phrase     text default null,
  p_no_tools_used    boolean default false,
  p_input_tokens     integer default 0,
  p_output_tokens    integer default 0,
  p_xp_spent         integer default 0,
  p_latency_ms       integer default 0,
  p_next_run_at      timestamptz default null
)
returns table (
  disabled                   boolean,
  disabled_reason            text,
  consecutive_failures       smallint,
  consecutive_confabulations smallint,
  consecutive_limits         smallint,
  consecutive_skips          smallint,
  notify_email               boolean,
  notify_on_success          boolean,
  schedule_id                uuid,
  schedule_label             text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  sched public.agent_schedules%rowtype;
  s_id  uuid;

  next_failures  smallint;
  next_confabs   smallint;
  next_limits    smallint;
  next_skips     smallint;

  will_disable   boolean := false;
  disable_reason text    := null;
begin
  update public.agent_schedule_runs r
     set outcome          = p_outcome,
         detail           = p_detail,
         output           = p_output,
         output_truncated = coalesce(p_output_truncated, false),
         finish_reason    = p_finish_reason,
         steps            = least(32767, greatest(0, coalesce(p_steps, 0)))::smallint,
         tool_calls       = least(32767, greatest(0, coalesce(p_tool_calls, 0)))::smallint,
         tool_failures    = least(32767, greatest(0, coalesce(p_tool_failures, 0)))::smallint,
         trace            = coalesce(p_trace, '[]'::jsonb),
         claim_matched    = coalesce(p_claim_matched, false),
         claim_phrase     = p_claim_phrase,
         no_tools_used    = coalesce(p_no_tools_used, false),
         input_tokens     = greatest(0, coalesce(p_input_tokens, 0)),
         output_tokens    = greatest(0, coalesce(p_output_tokens, 0)),
         xp_spent         = least(32767, greatest(0, coalesce(p_xp_spent, 0)))::smallint,
         latency_ms       = greatest(0, coalesce(p_latency_ms, 0)),
         finished_at      = now()
   where r.id = p_run_id
     -- Idempotent: settling an already-settled run changes
     -- nothing and must not move a counter twice. The reaper
     -- and a late-returning runner can both reach this row.
     and r.outcome is null
  returning r.schedule_id into s_id;

  if s_id is null then
    return;
  end if;

  select * into sched from public.agent_schedules where id = s_id for update;

  if not found then
    return;
  end if;

  next_failures := sched.consecutive_failures;
  next_confabs  := sched.consecutive_confabulations;
  next_limits   := sched.consecutive_limits;
  next_skips    := sched.consecutive_skips;

  -- ---- The counter rules --------------------------------
  --
  -- `limit_reached` RESETS the failure counters, and that is a
  -- reading rather than a leniency: the provider answered, the
  -- tools ran, and an answer came back. The pipeline worked.
  -- What went wrong is that the task wanted more room than one
  -- turn has, which is a different problem with a different
  -- fix, and it has its own counter two lines down.
  --
  -- `skipped` moves nothing except its own counter. A learner
  -- who spent their XP on lessons has not broken their
  -- schedule, and a system that disabled it for that would be
  -- punishing them for using the rest of the product.

  if p_outcome = 'succeeded' then
    next_failures := 0;
    next_confabs  := 0;
    next_limits   := 0;
    next_skips    := 0;

  elsif p_outcome = 'limit_reached' then
    next_failures := 0;
    next_confabs  := 0;
    next_skips    := 0;
    next_limits   := least(32767, next_limits + 1)::smallint;

  elsif p_outcome = 'confabulated' then
    next_failures := least(32767, next_failures + 1)::smallint;
    next_confabs  := least(32767, next_confabs + 1)::smallint;
    next_skips    := 0;

  elsif p_outcome = 'infra_failure' then
    next_failures := least(32767, next_failures + 1)::smallint;
    next_skips    := 0;

  elsif p_outcome = 'skipped' then
    next_skips := least(32767, next_skips + 1)::smallint;
  end if;

  -- ---- The breaker --------------------------------------
  --
  -- Confabulation is checked FIRST, so a schedule that trips
  -- both thresholds on the same run is disabled for the more
  -- specific reason. "Disabled after 2 runs that claimed work
  -- they did not do" tells an owner what to edit; "disabled
  -- after 3 failures" sends them to look at their provider.

  if next_confabs >= 2 then
    will_disable   := true;
    disable_reason := 'confabulation';
  elsif next_failures >= 3 then
    will_disable   := true;
    disable_reason := 'consecutive_failures';
  end if;

  update public.agent_schedules s
     set consecutive_failures       = next_failures,
         consecutive_confabulations = next_confabs,
         consecutive_limits         = next_limits,
         consecutive_skips          = next_skips,
         enabled         = case when will_disable then false else s.enabled end,
         disabled_at     = case when will_disable then now() else s.disabled_at end,
         disabled_reason = case when will_disable then disable_reason else s.disabled_reason end,
         -- Cleared unconditionally. A settled run is not
         -- holding anything, and a lease left behind would
         -- cost this schedule its next window.
         lease_until     = null,
         -- The runner's precise value, when it got that far.
         -- Null leaves the claim's provisional floor standing.
         next_run_at     = case
                             when will_disable then null
                             when p_next_run_at is not null then p_next_run_at
                             else s.next_run_at
                           end,
         updated_at      = now()
   where s.id = s_id;

  -- The advisory counter is drained once it has been reported,
  -- so a schedule that keeps running out of steps says so every
  -- fifth run rather than every run after the fifth.
  if next_limits >= 5 then
    update public.agent_schedules set consecutive_limits = 0 where id = s_id;
  end if;

  if next_skips >= 3 then
    update public.agent_schedules set consecutive_skips = 0 where id = s_id;
  end if;

  disabled                   := will_disable;
  disabled_reason            := disable_reason;
  consecutive_failures       := next_failures;
  consecutive_confabulations := next_confabs;
  consecutive_limits         := next_limits;
  consecutive_skips          := next_skips;
  notify_email               := sched.notify_email;
  notify_on_success          := sched.notify_on_success;
  schedule_id                := s_id;
  schedule_label             := sched.label;

  return next;
end;
$fn$;

-- =========================================================
-- ENABLE A SCHEDULE
--
-- Atomic because two of its three checks are races.
--
-- The per-user cap is the obvious one: two tabs both counting
-- one enabled schedule and both deciding they may be the second
-- would produce three. The preview gate is the subtler one —
-- between reading "this task was verified" and writing
-- `enabled`, the task can change.
--
-- Refuses with a reason rather than raising, the way
-- ai_usage_admit does, so the route can say which rule was hit
-- instead of turning a policy into a 500.
-- =========================================================

create or replace function public.agent_schedule_enable(
  p_schedule_id uuid,
  p_user_id     uuid,
  p_task_hash   text,
  p_next_run_at timestamptz,
  p_max_enabled integer default 2
)
returns table (
  enabled boolean,
  reason  text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  sched     public.agent_schedules%rowtype;
  in_use    integer;
begin
  select * into sched
    from public.agent_schedules
   where id = p_schedule_id
     and user_id = p_user_id
     for update;

  if not found then
    enabled := false; reason := 'not_found'; return next; return;
  end if;

  if sched.enabled then
    enabled := true; reason := 'already_enabled'; return next; return;
  end if;

  -- The preview gate. `p_task_hash` is the hash of the task the
  -- caller believes it is enabling, computed by the server from
  -- the stored row — not sent by the browser, which would make
  -- this a claim rather than a check.
  if sched.verified_task_hash is null
     or sched.verified_task_hash is distinct from p_task_hash then
    enabled := false; reason := 'not_verified'; return next; return;
  end if;

  -- Aliased, and `other.enabled` qualified, because `enabled`
  -- is also the name of this function's OUT column — plpgsql
  -- resolves an unqualified reference to the variable and the
  -- count would silently be wrong.
  select count(*)::integer into in_use
    from public.agent_schedules other
   where other.user_id = p_user_id
     and other.enabled;

  if in_use >= greatest(1, p_max_enabled) then
    enabled := false; reason := 'too_many'; return next; return;
  end if;

  update public.agent_schedules
     set enabled         = true,
         next_run_at     = p_next_run_at,
         disabled_at     = null,
         disabled_reason = null,
         -- A fresh start. The owner has just proved the task
         -- works; carrying yesterday's failure count forward
         -- would disable them again after one bad run.
         consecutive_failures       = 0,
         consecutive_confabulations = 0,
         consecutive_limits         = 0,
         consecutive_skips          = 0,
         updated_at      = now()
   where id = p_schedule_id;

  enabled := true; reason := 'enabled'; return next;
end;
$fn$;

-- =========================================================
-- RETENTION
--
-- Called by the tick, not by a timer, and not by pg_cron.
--
-- Swept on write for the reason FileStore gives: the only way
-- run rows accumulate is by being created, and the tick is what
-- creates them. A schedule that has stopped running stops
-- growing its own history, so there is nothing left to sweep.
--
-- Two bounds rather than one. The age bound is what an owner
-- expects ("I can see the last month"); the per-schedule count
-- bound is what protects a 6-hourly schedule from carrying 120
-- rows of a month nobody will read.
-- =========================================================

create or replace function public.agent_schedule_sweep(
  p_keep_days integer default 30,
  p_keep_runs integer default 50
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
  delete from public.agent_schedule_runs
   where finished_at is not null
     and finished_at < now() - make_interval(days => greatest(1, p_keep_days));

  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.agent_schedule_runs r
   using (
     select id,
            row_number() over (
              partition by schedule_id order by started_at desc
            ) as rn
       from public.agent_schedule_runs
   ) ranked
   where ranked.id = r.id
     and ranked.rn > greatest(5, p_keep_runs);

  get diagnostics n = row_count;
  removed := removed + n;

  return removed;
end;
$fn$;

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-read on all three. Every write goes through Express
-- with the service role.
--
-- The same posture agent_sites and agent_connections take, and
-- here it has teeth those two did not need. A browser that
-- could write agent_schedules could set
-- `consecutive_failures = 0` and keep a schedule that has been
-- caught lying running for ever — reaching past the one control
-- that exists to stop it. It could also set `enabled = true`
-- without passing the preview gate, or `next_run_at` to a
-- minute from now, repeatedly, which is the frequency floor
-- removed by anyone who can open devtools.
--
-- So: select for the owner, nothing else for anybody. The three
-- functions above are SECURITY DEFINER and take the user id as
-- an argument, which is why they are granted to the service
-- role only — see the grants below.
--
-- No anon policy on any of the three. Nothing a stranger can
-- reach has any business knowing that a student has a schedule,
-- let alone what it says.
-- ---------------------------------------------------------

alter table public.agent_schedules      enable row level security;
alter table public.agent_schedule_runs  enable row level security;
alter table public.agent_notifications  enable row level security;

drop policy if exists agent_schedules_owner_read     on public.agent_schedules;
drop policy if exists agent_schedules_owner_all      on public.agent_schedules;
drop policy if exists agent_schedule_runs_owner_read on public.agent_schedule_runs;
drop policy if exists agent_notifications_owner_read on public.agent_notifications;

create policy agent_schedules_owner_read
  on public.agent_schedules
  for select
  using (auth.uid() = user_id);

create policy agent_schedule_runs_owner_read
  on public.agent_schedule_runs
  for select
  using (auth.uid() = user_id);

create policy agent_notifications_owner_read
  on public.agent_notifications
  for select
  using (auth.uid() = user_id);

revoke all on public.agent_schedules     from anon;
revoke all on public.agent_schedule_runs from anon;
revoke all on public.agent_notifications from anon;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as 0003's: CREATE FUNCTION grants execute to
-- PUBLIC by default, and every one of these is SECURITY DEFINER
-- taking a user id as an argument — so a signed-in browser
-- calling them directly would be choosing whose schedule to
-- claim, settle or enable.
--
-- The Express runtime is the only legitimate caller and it
-- holds the service role, so nothing else needs the grant.
-- ---------------------------------------------------------

revoke all on function public.agent_schedule_claim(integer, integer) from public;
revoke all on function public.agent_schedule_settle(
  uuid, text, text, text, boolean, text, integer, integer, integer,
  jsonb, boolean, text, boolean, integer, integer, integer, integer, timestamptz
) from public;
revoke all on function public.agent_schedule_enable(uuid, uuid, text, timestamptz, integer) from public;
revoke all on function public.agent_schedule_sweep(integer, integer) from public;

grant execute on function public.agent_schedule_claim(integer, integer) to service_role;
grant execute on function public.agent_schedule_settle(
  uuid, text, text, text, boolean, text, integer, integer, integer,
  jsonb, boolean, text, boolean, integer, integer, integer, integer, timestamptz
) to service_role;
grant execute on function public.agent_schedule_enable(uuid, uuid, text, timestamptz, integer) to service_role;
grant execute on function public.agent_schedule_sweep(integer, integer) to service_role;

-- ---------------------------------------------------------
-- DONE
--
-- After applying this, restart the API. The startup banner
-- checks that 'agent_scheduled' is accepted by the widened
-- constraint before the ticker starts, and refuses to start the
-- ticker if it is not — so a half-applied migration produces a
-- clear line in the log rather than a schedule that disables
-- itself three ticks later.
--
-- Two environment variables decide how runs are triggered:
--
--   NEUROLINK_SCHEDULER=internal   in-process ticker (default)
--   NEUROLINK_SCHEDULER=external   only POST /internal/scheduler/tick
--   NEUROLINK_SCHEDULER=off        no scheduled runs at all
--
--   NEUROLINK_SCHEDULER_TOKEN=...  bearer for the tick endpoint
--
-- Email is optional. Without NEUROLINK_RESEND_API_KEY every
-- notification stays in the in-app feed and nothing is sent.
-- ---------------------------------------------------------
