-- =========================================================
-- BUILDGENTIC — SCHEDULES THAT SWITCH THEMSELVES OFF
--
-- One column, and everything else here is the consequence of
-- it.
--
-- WHY. A schedule has no natural end. Somebody sets up a
-- morning digest in September, reads it for a fortnight, stops
-- opening the emails in October, and in March it is still
-- running — still spending XP every morning, on an agent
-- nobody has thought about since autumn. Nothing in the
-- product notices, because nothing is wrong: every run
-- succeeds. The only signal is a balance that will not grow,
-- and a balance that will not grow looks like the product
-- being stingy rather than like a schedule nobody cancelled.
--
-- So a schedule now has a lifetime, and staying on is the
-- deliberate act rather than the default. A week for the
-- frequent cadences, five weeks for the weekly one — measured
-- against the cadence rather than the calendar, because a week
-- is a generous life for something that runs every day and no
-- life at all for something that runs every Monday.
--
-- WHY THE NUMBERS ARE NOT IN HERE. They live in
-- agents/schedule/cadence.ts, beside nextRunAt, and this file
-- is handed the answer. That is the same split the rest of the
-- feature already uses: the fiddly, opinionated half is the
-- half that can be unit-tested with no database, and the
-- database's job is to write it down atomically. The one
-- exception is the backfill below, which has no TypeScript to
-- ask and says so.
--
-- WHAT A LEARNER SEES. A note on the last run saying it is the
-- last, then a notice when it stops. Nothing to fix, no failure
-- to understand, and one button to start another window.
--
-- ---------------------------------------------------------
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT NEEDS IT. Not
-- after, and the asymmetry is worth a paragraph because it is
-- the kind of thing that only bites in production.
--
-- This file REPLACES `agent_schedule_enable` with a version
-- taking a sixth argument. The new server always sends it, so a
-- new server against an old database cannot switch any schedule
-- on at all — PostgREST has no six-argument function to call and
-- every enable returns an error.
--
-- The other order is safe in both directions. `p_expires_at`
-- defaults to null, so the OLD server's five-argument call still
-- resolves and simply enables a schedule that never expires,
-- which is the old behaviour and exactly what an old build
-- should get. The extra `expires_at` column the new claim
-- returns is ignored by a reader that does not know about it.
--
-- So: paste this, then deploy. A few minutes of schedules that
-- do not expire yet costs nothing; the reverse costs every
-- learner the ability to start one.
-- ---------------------------------------------------------
-- =========================================================

-- ---------------------------------------------------------
-- 1. THE COLUMN
--
-- Nullable, and null means "no expiry" rather than "expired".
-- That is what every row written before this migration reads
-- as, what a row written by an older server still running
-- during the deploy reads as, and what a hand-written row in
-- the SQL editor reads as. The dangerous default would be the
-- other one: a null that meant "expired" would switch off
-- every schedule in the product the moment this was applied.
-- ---------------------------------------------------------

alter table public.agent_schedules
  add column if not exists expires_at timestamptz;

comment on column public.agent_schedules.expires_at is
  'When this schedule switches itself off. Set on enable from '
  'cadence.ts; null means it never expires.';

-- ---------------------------------------------------------
-- 2. THE NEW DISABLE REASON
--
-- 'expired' joins the vocabulary, and the ordering of these two
-- statements matters: the constraint has to accept the value
-- before the claim function below can ever write it.
--
-- It is NOT a failure, and everything downstream reads it that
-- way — no red banner, no "test it before switching it back
-- on", no suggestion that anything is broken. A schedule that
-- expired did its job for as long as it was asked to.
-- ---------------------------------------------------------

alter table public.agent_schedules
  drop constraint if exists agent_schedules_disabled_reason;

alter table public.agent_schedules
  add constraint agent_schedules_disabled_reason check (
    disabled_reason is null or disabled_reason in (
      'consecutive_failures', 'confabulation', 'agent_unavailable',
      'owner', 'expired'));

-- ---------------------------------------------------------
-- 3. THE BACKFILL
--
-- Every schedule that is enabled right now gets a full window
-- starting NOW, not starting from when it was created.
--
-- Counting from created_at would be the strictly correct
-- reading of "schedules live a week", and it would switch off
-- every schedule older than a week within sixty seconds of this
-- being pasted — including, in the deployment this was written
-- for, the one whose owner asked for the feature. The first
-- they would know of a lifetime is that their digest had
-- already stopped, with no heads-up run, because the run that
-- was supposed to carry the warning happened last Tuesday.
--
-- A fresh window costs one extra week of runs, once, and buys
-- every existing owner the same warning every new one gets.
--
-- The numbers here are the only copy of EXPIRY_DAYS outside
-- cadence.ts. They are a one-shot statement rather than a
-- function the runtime keeps calling, so they cannot drift into
-- disagreeing with it tomorrow — this runs once and is done.
-- ---------------------------------------------------------

update public.agent_schedules
   set expires_at = now() + case cadence
                              when 'weekly' then interval '35 days'
                              else               interval '7 days'
                            end,
       updated_at = now()
 where enabled
   and expires_at is null;

-- ---------------------------------------------------------
-- 4. ENABLE, WITH A WINDOW
--
-- Replaces the function from 0017. The only changes are the new
-- parameter and the one line that writes it; everything else —
-- the row lock, the preview gate, the per-user cap, the counter
-- reset — is carried over unchanged and is still the reason
-- this is a function rather than two statements in Node.
--
-- The expiry is set in the SAME statement as `enabled`, which
-- is what makes "switched on" and "switched on until" a single
-- fact. Written afterwards from Node they could come apart, and
-- a schedule that was enabled with no expiry would be a
-- schedule that runs for ever — the exact thing this migration
-- exists to stop.
--
-- The parameter is defaulted so that a server still running the
-- previous build during a deploy keeps working: it calls this
-- with five arguments, gets a null expiry, and enables a
-- schedule that does not expire. That is the old behaviour,
-- which is the right thing for an old build to get.
-- ---------------------------------------------------------

-- DROPPED, not replaced, and this is not tidiness.
--
-- `create or replace` matches on the argument list, so a
-- six-argument version does not replace the five-argument one —
-- it sits beside it as an overload. A call with five arguments
-- would then match both (the sixth has a default) and Postgres
-- refuses it as ambiguous, which arrives at the browser as
-- every attempt to switch a schedule on failing at once.
drop function if exists public.agent_schedule_enable(
  uuid, uuid, text, timestamptz, integer);

create or replace function public.agent_schedule_enable(
  p_schedule_id uuid,
  p_user_id     uuid,
  p_task_hash   text,
  p_next_run_at timestamptz,
  p_max_enabled integer default 2,
  p_expires_at  timestamptz default null
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
         -- A fresh window every time, including when this is a
         -- revival of a schedule that just expired. Carrying the
         -- old date forward would switch it off again on the
         -- next tick, which reads to its owner as a button that
         -- does not work.
         expires_at      = p_expires_at,
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

-- ---------------------------------------------------------
-- 5. CLAIM, WHICH IS ALSO WHERE EXPIRY HAPPENS
--
-- Replaces the function from 0017. Two changes, both small, and
-- the first one is the whole feature.
--
-- STEP 0 expires what is due to expire. It lives here rather
-- than in a timer of its own for exactly the reason the reap in
-- step 1 does: the tick is the thing that runs every minute
-- anyway, and a second scheduler to supervise the first is a
-- second thing that can stop running without anybody noticing.
--
-- It also runs BEFORE the claim rather than after it, so a
-- schedule expiring at nine cannot be claimed for a nine
-- o'clock run in the same tick. Ordered the other way, a
-- schedule's last run would sometimes happen after its own
-- expiry — rarely, on a boundary, which is the worst kind of
-- bug to be told about.
--
-- The `due` CTE gets the same condition anyway. Belt and
-- braces, and cheap: without it, a row that expires in the
-- microseconds between the two statements is claimed for a run
-- it should not get.
--
-- No notification is written here. `reconcileDisables` in
-- notify.ts already sweeps for schedules that are disabled with
-- no notice and writes the missing one, which is the mechanism
-- the breaker has always used — so expiry inherits a delivery
-- path that has been carrying disable notices since Phase 2.
-- ---------------------------------------------------------

-- DROPPED for a different reason from the one above: this
-- function's RETURN TYPE changes, because the claim now hands
-- back `expires_at` as well. `create or replace` cannot change
-- a function's OUT columns and says so — "cannot change return
-- type of existing function" — so the drop is what makes this
-- file runnable at all.
drop function if exists public.agent_schedule_claim(integer, integer);

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
  due_at        timestamptz,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  lease_cutoff timestamptz := now();
begin
  -- ---- 0. Expire ----------------------------------------
  --
  -- A schedule past its window switches off here, quietly and
  -- without a run. `enabled` is required in the predicate so a
  -- row that is already off is not touched again — it would
  -- otherwise have its disabled_at rewritten every minute for
  -- ever, and overwrite the real reason it was switched off
  -- with this one.

  update public.agent_schedules s
     set enabled         = false,
         next_run_at     = null,
         lease_until     = null,
         disabled_at     = now(),
         disabled_reason = 'expired',
         updated_at      = now()
   where s.enabled
     and s.expires_at is not null
     and s.expires_at <= now();

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
       and (s.expires_at is null or s.expires_at > now())
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
      s.expires_at,
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
    stepped.due_at,
    -- Returned so the runner can tell, when this run settles,
    -- whether it was the last one — which is what puts the
    -- heads-up in the final notification rather than leaving
    -- the schedule to go quiet without warning.
    stepped.expires_at;
end;
$fn$;

-- ---------------------------------------------------------
-- 6. TELL POSTGREST ABOUT THE NEW SIGNATURES
--
-- Both functions above changed shape, and PostgREST answers RPC
-- calls from a cached view of the schema. Supabase normally
-- reloads that cache on its own through an event trigger, so
-- this is belt and braces rather than a fix — but the failure it
-- prevents is "switching a schedule on does nothing, with no
-- error anywhere", which is a miserable half hour to diagnose
-- and costs one line to rule out.
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
