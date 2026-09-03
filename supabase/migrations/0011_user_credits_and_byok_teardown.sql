-- =========================================================
-- NEUROLINK — SPENDABLE XP, AND THE END OF BYOK
--
-- Two changes that arrive together because they replace one
-- idea with another.
--
-- What goes: Bring Your Own Key. A learner had to paste a
-- provider API key before the Lab or the Agent Builder would
-- answer them, which made the product's two headline features
-- unusable for anyone without a billing relationship with
-- Google. The key table and the per-agent power_source column
-- both go with it.
--
-- What arrives: a spendable daily allowance. Every learner
-- gets a balance, every AI action costs some of it, and the
-- balance refills every 24 hours. That is what makes it safe
-- to serve everybody from NeuroLink's own provider keys.
--
-- THIS IS NOT user_stats.xp, and the distinction is the whole
-- design. user_stats.xp is a lifetime score that only ever
-- goes up and decides a learner's level. user_credits.balance
-- is a wallet that goes down when you run an experiment and up
-- at midnight. Spending an afternoon in the Lab must never
-- cost somebody a level they earned, so they are two numbers
-- in two tables and neither function touches the other.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- USER CREDITS
--
-- One row per learner, minted on first touch rather than at
-- signup: a table that has to be backfilled for every existing
-- user is a table that is wrong for whoever signed up during
-- the backfill.
--
-- `daily_allowance` is per-row rather than a constant so a
-- single learner can be given more without a deploy — a class
-- account, a workshop, somebody who hit a bug and lost a day's
-- balance to it.
-- ---------------------------------------------------------

create table if not exists public.user_credits (
  user_id         uuid primary key
                  references auth.users (id) on delete cascade,
  balance         integer     not null default 40,
  daily_allowance integer     not null default 40,
  -- When the balance was last reset to the allowance. Read by
  -- spend_credits, which refills lazily, and by the nightly
  -- job. Never advanced by a spend.
  last_refill_at  timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A negative balance is not a state this system has. Every
  -- write path clamps, and this is the proof rather than the
  -- hope.
  constraint user_credits_balance_non_negative check (balance >= 0),
  constraint user_credits_allowance_positive   check (daily_allowance >= 0)
);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-read, and deliberately no write policy at all — the
-- same posture ai_usage, agent_deployments and agent_memories
-- take.
--
-- A learner may watch their own balance, because the meter in
-- the header has to come from somewhere. Nothing they hold can
-- move it. Every write goes through a SECURITY DEFINER
-- function below, called by the Express server after it has
-- verified a bearer token, because a balance the browser can
-- write is not a limit — it is a suggestion.
--
-- This is the specific mistake user_stats made: it carries a
-- `for all` owner policy, so a signed-in browser can still set
-- its own xp with the publishable key. That is survivable for
-- a score. It would not be survivable for a wallet.
-- ---------------------------------------------------------

alter table public.user_credits enable row level security;

drop policy if exists user_credits_owner_all  on public.user_credits;
drop policy if exists user_credits_owner_read on public.user_credits;

create policy user_credits_owner_read
  on public.user_credits
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- IDEMPOTENT GRANTS
--
-- xp_transactions has existed since 0001 and has never been
-- written by anything. This is what it was for.
--
-- The index is partial because only sourced grants need to be
-- unique: a lesson pays once no matter how often it is
-- replayed, and a daily bonus pays once per day. An unsourced
-- adjustment — a manual correction — carries nulls and is
-- allowed to repeat.
-- ---------------------------------------------------------

create unique index if not exists xp_transactions_source_idx
  on public.xp_transactions (user_id, source_type, source_id)
  where source_type is not null and source_id is not null;

-- ---------------------------------------------------------
-- SPEND
--
-- The gate. Called before any provider is contacted, and the
-- reason a learner who is out of XP costs NeuroLink nothing.
--
-- The refill, the affordability test and the debit are ONE
-- statement, for the same reason ai_usage_admit is one
-- statement: read-then-write leaves a gap, and ten concurrent
-- Lab runs all read "40 left" inside it. Here the row lock
-- serialises them and the tenth is refused by the same WHERE
-- clause that let the first through.
--
-- Refilling here as well as in the nightly job is belt and
-- braces on purpose. Cron alone strands everybody on the day a
-- run is missed; lazy alone means a balance only moves when
-- somebody shows up, which is fine but leaves the meter stale
-- for anyone reading it before their first call.
-- ---------------------------------------------------------

create or replace function public.spend_credits(
  p_user_id uuid,
  p_cost    integer
)
returns table (
  ok      boolean,
  balance integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  safe_cost integer := greatest(0, coalesce(p_cost, 0));
  updated   public.user_credits;
  current   integer;
begin
  -- First touch mints the row at the full allowance. A learner
  -- who has never spent anything has no row, and that must not
  -- read as "no balance".
  insert into public.user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.user_credits as uc
     set balance = case
                     when uc.last_refill_at < now() - interval '24 hours'
                       then uc.daily_allowance - safe_cost
                     else uc.balance - safe_cost
                   end,
         last_refill_at = case
                     when uc.last_refill_at < now() - interval '24 hours'
                       then now()
                     else uc.last_refill_at
                   end,
         updated_at = now()
   where uc.user_id = p_user_id
     -- Affordability measured against what the balance WOULD be
     -- after a refill that is due, so somebody arriving the
     -- morning after an empty day is not refused on yesterday's
     -- number.
     and safe_cost <= case
                        when uc.last_refill_at < now() - interval '24 hours'
                          then uc.daily_allowance
                        else uc.balance
                      end
  returning * into updated;

  if updated.user_id is not null then
    ok      := true;
    balance := updated.balance;
    return next;
    return;
  end if;

  -- Refused. Report what they actually have, so the caller can
  -- say "you have 1 left and this costs 2" rather than a bare
  -- no.
  select uc.balance into current
    from public.user_credits as uc
   where uc.user_id = p_user_id;

  ok      := false;
  balance := coalesce(current, 0);
  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- REFUND
--
-- Called when every provider in the cascade failed, so the
-- answer never happened.
--
-- A learner must not pay for an outage. Capped at the
-- allowance so a refund can never leave somebody above their
-- own ceiling, which is what a retry loop plus an uncapped
-- refund would eventually produce.
-- ---------------------------------------------------------

create or replace function public.refund_credits(
  p_user_id uuid,
  p_amount  integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  safe_amount integer := greatest(0, coalesce(p_amount, 0));
  result      integer;
begin
  update public.user_credits as uc
     set balance    = least(uc.daily_allowance, uc.balance + safe_amount),
         updated_at = now()
   where uc.user_id = p_user_id
  returning uc.balance into result;

  return coalesce(result, 0);
end;
$fn$;

-- ---------------------------------------------------------
-- GRANT
--
-- How a learner earns spending money: finishing a lesson, or
-- showing up two days running.
--
-- Idempotent through xp_transactions rather than through
-- anything the caller passes, so a replayed lesson or a
-- double-fired login pays exactly once. The ledger row IS the
-- lock: if the insert conflicts, nothing was earned.
--
-- This does NOT touch user_stats.xp. Lifetime XP is already
-- awarded by award_step_xp when the lesson's completion step
-- settles, and paying it again here would double every
-- lesson's score.
-- ---------------------------------------------------------

create or replace function public.grant_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_reason      text,
  p_source_type text,
  p_source_id   text
)
returns table (
  granted integer,
  balance integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  safe_amount   integer := greatest(0, coalesce(p_amount, 0));
  inserted_rows integer := 0;
  result        integer;
begin
  insert into public.user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.xp_transactions (
    user_id, amount, reason, source_type, source_id
  )
  values (
    p_user_id, safe_amount, p_reason, p_source_type, p_source_id
  )
  /*
   * The WHERE clause is not decoration: xp_transactions_source_idx
   * is a PARTIAL unique index, and Postgres will only infer a
   * partial index for ON CONFLICT if the predicate is repeated
   * here verbatim. Without it this raises "there is no unique or
   * exclusion constraint matching the ON CONFLICT specification"
   * on every grant.
   */
  on conflict (user_id, source_type, source_id)
    where source_type is not null and source_id is not null
  do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows = 1 then
    update public.user_credits as uc
       set balance    = least(uc.daily_allowance, uc.balance + safe_amount),
           updated_at = now()
     where uc.user_id = p_user_id
    returning uc.balance into result;

    granted := safe_amount;
  else
    select uc.balance into result
      from public.user_credits as uc
     where uc.user_id = p_user_id;

    granted := 0;
  end if;

  balance := coalesce(result, 0);
  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- NIGHTLY RESET
--
-- Sets every stale balance back to its allowance. Scheduled
-- below, and also unnecessary — spend_credits refills lazily —
-- which is the point: either mechanism alone has a hole the
-- other covers.
--
-- Only touches rows that are actually due, so running it twice
-- in an hour does not hand anybody a second allowance.
-- ---------------------------------------------------------

create or replace function public.reset_daily_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected integer := 0;
begin
  update public.user_credits as uc
     set balance        = uc.daily_allowance,
         last_refill_at = now(),
         updated_at     = now()
   where uc.last_refill_at < now() - interval '24 hours';

  get diagnostics affected = row_count;

  return affected;
end;
$fn$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- All four are SECURITY DEFINER and take the target user id as
-- an argument, so they bypass RLS completely. Granted to
-- `authenticated`, grant_credits would be a money printer and
-- refund_credits would be a slightly slower one.
--
-- The Express server is the only legitimate caller and it
-- resolves the user id from a verified bearer token first.
--
-- CREATE FUNCTION grants execute to PUBLIC by default, which
-- is why the revokes are not redundant.
-- ---------------------------------------------------------

revoke all on function public.spend_credits(uuid, integer)
  from public, anon, authenticated;

revoke all on function public.refund_credits(uuid, integer)
  from public, anon, authenticated;

revoke all on function public.grant_credits(uuid, integer, text, text, text)
  from public, anon, authenticated;

revoke all on function public.reset_daily_credits()
  from public, anon, authenticated;

grant execute on function public.spend_credits(uuid, integer)
  to service_role;

grant execute on function public.refund_credits(uuid, integer)
  to service_role;

grant execute on function public.grant_credits(uuid, integer, text, text, text)
  to service_role;

grant execute on function public.reset_daily_credits()
  to service_role;

-- ---------------------------------------------------------
-- THE NIGHTLY SCHEDULE
--
-- Guarded, because pg_cron is not enabled on every Supabase
-- project and a migration that cannot be applied is a
-- migration nobody applies. Where it is missing, the lazy
-- refill inside spend_credits carries the whole job on its own
-- and the notice below says so.
-- ---------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'neurolink-reset-daily-credits') then
      perform cron.unschedule('neurolink-reset-daily-credits');
    end if;

    perform cron.schedule(
      'neurolink-reset-daily-credits',
      '7 0 * * *',
      'select public.reset_daily_credits()'
    );
  else
    raise notice 'pg_cron is not enabled; daily credit resets will rely on the lazy refill inside spend_credits. Enable pg_cron and re-run this migration to schedule the nightly job.';
  end if;
end
$cron$;

-- ---------------------------------------------------------
-- RECORDING WHO ACTUALLY ANSWERED
--
-- The quota gate opens a usage row before a single provider has
-- been contacted, so the provider and model it writes are a
-- prediction: the first candidate in the cascade. Usually right,
-- and wrong exactly when the interesting thing happened — when
-- the first choice was busy and something further down the chain
-- served the request.
--
-- Left uncorrected, ai_usage would say Groq answered every call,
-- and the one question an operator actually has of this table —
-- "is the fallback ever firing, and for whom?" — would have no
-- answer in it.
--
-- So the close accepts the truth. Both parameters default to
-- null and null means "leave what admission wrote", which keeps
-- every existing six-argument call working unchanged.
--
-- Dropped first: adding parameters to a function creates an
-- overload rather than replacing it, and two ai_usage_finish
-- functions differing only by trailing defaults is an ambiguous
-- call waiting to happen.
-- ---------------------------------------------------------

drop function if exists public.ai_usage_finish(
  uuid, integer, integer, integer, boolean, text
);

create or replace function public.ai_usage_finish(
  p_usage_id      uuid,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_latency_ms    integer,
  p_ok            boolean,
  p_error_code    text default null,
  p_provider_id   text default null,
  p_model         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.ai_usage
     set status        = 'done',
         input_tokens  = greatest(0, coalesce(p_input_tokens, 0)),
         output_tokens = greatest(0, coalesce(p_output_tokens, 0)),
         latency_ms    = greatest(0, coalesce(p_latency_ms, 0)),
         ok            = coalesce(p_ok, false),
         error_code    = p_error_code,
         provider_id   = coalesce(p_provider_id, provider_id),
         model         = coalesce(p_model, model),
         finished_at   = now()
   where id     = p_usage_id
     and status = 'pending';
end;
$fn$;

revoke all on function public.ai_usage_finish(
  uuid, integer, integer, integer, boolean, text, text, text
) from public, anon, authenticated;

grant execute on function public.ai_usage_finish(
  uuid, integer, integer, integer, boolean, text, text, text
) to service_role;

-- ---------------------------------------------------------
-- BYOK TEARDOWN
--
-- The key table holds AES-256-GCM ciphertext and nothing else
-- depends on it: no foreign key points here, and ai_usage.key_id
-- was deliberately created without one back in 0004.
--
-- agents.power_source goes the same way. Every agent is served
-- by NeuroLink's own provider cascade now, so a column whose
-- only remaining values are 'platform' and a mode that no
-- longer exists is a column that can only mislead.
--
-- Both are destructive and neither is reversible by re-running
-- an earlier migration. Stored keys are not recoverable after
-- this, which is the correct outcome — they are credentials
-- NeuroLink should never have been holding.
-- ---------------------------------------------------------

drop table if exists public.user_ai_keys;

alter table public.agents
  drop column if exists power_source;

-- ai_usage keeps its `power_source_kind` column, its CHECK and
-- its `key_id`, all of which still permit 'byok'.
--
-- Deliberate. Those columns hold history — what actually
-- happened on requests that ran before today — and narrowing
-- the constraint would mean rewriting rows to values that were
-- not true when they were written. Nothing emits 'byok' any
-- more; the resolver has one branch left.
--
-- ai_usage_admit and ai_usage_snapshot are likewise left
-- exactly as 0006 defined them. Their only BYOK-shaped
-- behaviour is skipping the platform budget when the kind is
-- not 'platform', and now that every call is 'platform' that
-- branch is simply never taken — the platform ceiling applies
-- to everything, which is what it should always have done once
-- NeuroLink is paying for every request. Rewriting a
-- concurrency-critical function to delete a branch that
-- already cannot execute would be risk without a benefit.
