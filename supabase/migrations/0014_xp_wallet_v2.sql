-- =========================================================
-- NEUROLINK — THE XP WALLET, SECOND MODEL
--
-- 0011 gave every learner a daily allowance that reset. This
-- replaces it with a balance that ACCUMULATES and is CAPPED.
--
-- The reason is not economics, it is that the old model made a
-- whole category of thing unbuyable. Under 0011 the balance was
-- clamped to `daily_allowance` in three separate places —
-- grant_credits, refund_credits and the refill inside
-- spend_credits — so a balance could never exceed 40 no matter
-- what a learner did. Anything priced above a single day's
-- allowance was therefore not "expensive", it was unreachable,
-- and the marketplace agents arriving in 0015 are priced from
-- 60 to 200. Saving up had to become a thing the wallet could
-- express.
--
-- WHAT CHANGES, in one sentence each:
--
--   The balance carries over. No reset, lazy or nightly.
--   It stops at `max_balance` (300) rather than at the day's
--   grant, so a learner can save for a fortnight and buy
--   something.
--   Logging in GRANTS rather than refills — additive, so the
--   day's earnings land on top of what was already there.
--   A streak pays. Ten consecutive days is worth a bonus, and
--   the counter that decides it lives here rather than in the
--   browser.
--   `lifetime_earned` records everything ever earned and never
--   goes down, including when XP is spent. It is what Level is
--   computed from.
--
-- WHY LEVEL MOVES HERE. user_stats.xp has been the level's
-- source since 0002, on a 500-per-level scale fed by curriculum
-- step XP. That number is a SCORE — it measures how much of the
-- course somebody has done. Level should measure engagement
-- with the whole product, which is what the grant stream
-- already is. So Level now reads `lifetime_earned`, and
-- user_stats.xp goes back to being what it always really was:
-- the curriculum score, shown on course screens.
--
-- The property that makes this safe is that `lifetime_earned`
-- is written ONLY by grant paths and never by spend paths.
-- Spending 200 XP on an agent must not cost somebody a level
-- they earned — that was the entire point of keeping the wallet
-- and the score in two tables in 0011, and it survives here.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- THE NEW COLUMNS
--
-- `daily_allowance` KEEPS ITS NAME AND CHANGES ITS MEANING,
-- which is worth saying loudly because it is the one thing in
-- this migration that could quietly mislead somebody reading
-- the table a year from now.
--
--   Before: the ceiling, and the number the balance was reset
--           to every 24 hours.
--   After:  the DAILY LOGIN GRANT. What arrives when you show
--           up. It is no longer a ceiling of any kind.
--
-- The ceiling is now `max_balance`. Renaming the column would
-- have been clearer still, and was rejected: migrations in this
-- project are applied by hand in the SQL editor, and a rename
-- breaks every deployed build reading the old name in the
-- window between the paste and the deploy. A comment costs
-- nothing and strands nobody.
--
-- Both stay per-row for the reason 0011 gives: a class account,
-- a workshop, or somebody who lost a day to a bug can be given
-- different numbers without a deploy.
-- ---------------------------------------------------------

alter table public.user_credits
  add column if not exists max_balance     integer not null default 300,
  -- Everything ever earned. Only ever increases. The source of
  -- Level, and never touched by a spend or a purchase.
  add column if not exists lifetime_earned integer not null default 0,
  -- Consecutive qualifying logins since the last bonus paid.
  -- NOT the same number as user_stats.current_streak — see
  -- claim_daily_credits for why they are deliberately separate.
  add column if not exists streak_days     integer not null default 0,
  -- The last day a login grant was claimed, as a date rather
  -- than a timestamp: the question this answers is "was
  -- yesterday a login day", and a timestamp would make that a
  -- question about hours.
  add column if not exists last_login_day  date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_credits_max_balance_positive'
  ) then
    alter table public.user_credits
      add constraint user_credits_max_balance_positive check (max_balance >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_credits_lifetime_non_negative'
  ) then
    alter table public.user_credits
      add constraint user_credits_lifetime_non_negative check (lifetime_earned >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_credits_streak_non_negative'
  ) then
    alter table public.user_credits
      add constraint user_credits_streak_non_negative check (streak_days >= 0);
  end if;
end
$$;

-- ---------------------------------------------------------
-- BACKFILL
--
-- Existing rows have a lifetime_earned of 0, which would put
-- every current learner back at Level 1 on the day this lands.
--
-- The ledger is the honest answer: xp_transactions has recorded
-- every grant since 0011, so the sum of a learner's positive
-- transactions IS what they have earned. Learners who predate
-- the ledger get whatever it knows about, which is the most any
-- backfill can truthfully claim.
--
-- Guarded on lifetime_earned = 0 so re-running this migration
-- cannot double anybody's level.
-- ---------------------------------------------------------

update public.user_credits as uc
   set lifetime_earned = coalesce((
         select sum(tx.amount)
           from public.xp_transactions as tx
          where tx.user_id = uc.user_id
            and tx.amount > 0
       ), 0),
       updated_at = now()
 where uc.lifetime_earned = 0;

-- ---------------------------------------------------------
-- LEVEL
--
-- 200 XP a level, from lifetime_earned, floor plus one.
--
-- A function rather than a stored column so it cannot drift
-- from the number it is derived from — there is no update path
-- that could forget to recompute it, because there is nothing
-- to recompute.
--
-- IMMUTABLE so it can be used in an index or a generated column
-- later without another migration to redeclare it.
-- ---------------------------------------------------------

create or replace function public.credit_level(p_lifetime integer)
returns integer
language sql
immutable
as $fn$
  select greatest(1, (greatest(0, coalesce(p_lifetime, 0)) / 200) + 1);
$fn$;

-- ---------------------------------------------------------
-- SPEND
--
-- The gate, minus the refill.
--
-- 0011's version refilled lazily inside this statement, because
-- under a resetting model somebody arriving the morning after
-- an empty day had to be served on today's allowance. There is
-- no reset any more, so there is nothing to refill and the
-- whole branch goes: what is in the wallet is what is in the
-- wallet, until something grants more.
--
-- Still ONE statement, for exactly the reason 0011 documents:
-- read-then-write leaves a gap, and ten concurrent Lab runs all
-- read "40 left" inside it. The row lock serialises them and
-- the eleventh is refused by the same WHERE clause that let the
-- first through.
--
-- Does not touch lifetime_earned. That is the invariant this
-- whole design rests on.
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
  -- First touch mints the row. A learner who has never spent
  -- anything has no row, and that must not read as "no balance".
  insert into public.user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.user_credits as uc
     set balance    = uc.balance - safe_cost,
         updated_at = now()
   where uc.user_id = p_user_id
     and uc.balance >= safe_cost
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
-- answer never happened. A learner must not pay for an outage.
--
-- Capped at `max_balance` now rather than at the day's grant.
-- Same reasoning as 0011, new ceiling: a retry loop plus an
-- uncapped refund would eventually put somebody above the
-- ceiling the rest of the system believes in.
--
-- Deliberately does NOT touch lifetime_earned. A refund undoes
-- a spend, and spends never moved it, so moving it here would
-- pay a learner level progress for a failed request.
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
     set balance    = least(uc.max_balance, uc.balance + safe_amount),
         updated_at = now()
   where uc.user_id = p_user_id
  returning uc.balance into result;

  return coalesce(result, 0);
end;
$fn$;

-- ---------------------------------------------------------
-- GRANT
--
-- How a learner earns. Idempotent through xp_transactions
-- rather than through anything the caller passes, exactly as in
-- 0011: the ledger row IS the lock.
--
-- TWO NUMBERS MOVE, and they move differently. This is the
-- heart of the new model:
--
--   balance         += amount, CLAMPED at max_balance.
--   lifetime_earned += amount, NOT clamped.
--
-- So a learner sitting at the 300 ceiling who finishes a lesson
-- banks no spendable XP — but still gets the full 15 toward
-- their Level. The overflow is lost as currency and kept as
-- progress. That asymmetry is deliberate: the cap exists to
-- stop hoarding, not to punish somebody for playing while
-- they happen to be full.
--
-- Still does not touch user_stats.xp. Lifetime curriculum XP is
-- awarded by award_step_xp when a lesson's completion step
-- settles, and paying it again here would double every lesson's
-- score.
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- THIS ONE HAS TO BE DROPPED FIRST, and the reason is worth
-- stating because it is not obvious and the error is not
-- either.
--
-- grant_credits gains a third OUT column, `lifetime`. Postgres
-- will not let CREATE OR REPLACE change the row type an
-- existing function returns:
--
--   ERROR 42P13: cannot change return type of existing function
--   DETAIL: Row type defined by OUT parameters is different.
--
-- So the 0011/0012 definition — which returns (granted,
-- balance) — must go before the new one can be created.
--
-- Only this function. spend_credits keeps its exact
-- (ok, balance) shape and refund_credits still returns integer,
-- so both are replaced in place. That distinction is
-- deliberate rather than lazy: spend_credits is the gate, and
-- CreditStore.spend fails OPEN when it is missing, so a window
-- where it does not exist is a window where every request is
-- served free. A missing grant_credits only loses a grant, and
-- that path logs rather than throws.
--
-- `if exists` keeps this runnable on a database that never had
-- 0011 applied, and re-runnable on one that has.
-- ---------------------------------------------------------

drop function if exists public.grant_credits(uuid, integer, text, text, text);

create or replace function public.grant_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_reason      text,
  p_source_type text,
  p_source_id   text
)
returns table (
  granted integer,
  balance integer,
  lifetime integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  safe_amount   integer := greatest(0, coalesce(p_amount, 0));
  inserted_rows integer := 0;
  updated       public.user_credits;
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
       set balance         = least(uc.max_balance, uc.balance + safe_amount),
           lifetime_earned = uc.lifetime_earned + safe_amount,
           updated_at      = now()
     where uc.user_id = p_user_id
    returning * into updated;

    granted := safe_amount;
  else
    select * into updated
      from public.user_credits as uc
     where uc.user_id = p_user_id;

    granted := 0;
  end if;

  balance  := coalesce(updated.balance, 0);
  lifetime := coalesce(updated.lifetime_earned, 0);
  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- THE DAILY CLAIM, AND THE STREAK
--
-- Replaces reset_daily_credits(). Additive rather than an
-- overwrite, which is the single most important line in this
-- migration: the old function SET the balance, and running it
-- against an accumulating wallet would delete everything a
-- learner had saved.
--
-- WHY THE STREAK LIVES HERE. user_stats.current_streak has
-- existed since 0001 and is maintained by the browser through
-- src/lib/progress.ts, under a `for all` owner RLS policy — a
-- learner can set it to anything they like. That is survivable
-- for a number on a dashboard. It is not survivable for a
-- number that pays XP, so the streak that decides the bonus is
-- computed here, from `last_login_day`, and the browser cannot
-- reach it.
--
-- The two are therefore DIFFERENT NUMBERS ON PURPOSE:
--
--   user_stats.current_streak  — display. Keeps counting up.
--   user_credits.streak_days   — the bonus counter. Resets to
--                                zero every time a bonus pays.
--
-- A learner sees "17 day streak" while this column reads 7, and
-- that is correct: seven days since the last bonus.
--
-- The date is passed in rather than taken from now(), so the
-- caller decides the timezone. The route passes UTC, so the
-- boundary is the same for everybody and nobody collects twice
-- by flying east.
-- ---------------------------------------------------------

/* New in this migration, so there is nothing to conflict with
   yet. Dropped first anyway so that a LATER change to its
   columns is a re-run of this file rather than a 42P13 — the
   same trap grant_credits just walked into. Safe because
   nothing depended on it existing before now. */
drop function if exists public.claim_daily_credits(uuid, date);

create or replace function public.claim_daily_credits(
  p_user_id uuid,
  p_day     date
)
returns table (
  granted  integer,
  bonus    integer,
  balance  integer,
  lifetime integer,
  streak   integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  inserted_rows integer := 0;
  wallet        public.user_credits;
  next_streak   integer := 0;
  day_grant     integer := 0;
  bonus_grant   integer := 0;
begin
  insert into public.user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  /* The ledger is the lock, exactly as in grant_credits. A
     hundred calls in a minute pay once. */
  insert into public.xp_transactions (
    user_id, amount, reason, source_type, source_id
  )
  select p_user_id, uc.daily_allowance, 'Daily login', 'daily', p_day::text
    from public.user_credits as uc
   where uc.user_id = p_user_id
  on conflict (user_id, source_type, source_id)
    where source_type is not null and source_id is not null
  do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows = 0 then
    /* Already claimed today. Report the standing state so the
       caller can render a meter without a second round trip. */
    select * into wallet
      from public.user_credits as uc
     where uc.user_id = p_user_id;

    granted  := 0;
    bonus    := 0;
    balance  := coalesce(wallet.balance, 0);
    lifetime := coalesce(wallet.lifetime_earned, 0);
    streak   := coalesce(wallet.streak_days, 0);
    return next;
    return;
  end if;

  /* Locks the row for the rest of the function, so two claims
     racing on the same day cannot both compute a streak from
     the same starting value. The ledger insert above already
     decided only one of them gets here. */
  select * into wallet
    from public.user_credits as uc
   where uc.user_id = p_user_id
   for update;

  day_grant := wallet.daily_allowance;

  /* Consecutive means yesterday exactly. A first login, or a
     gap of any size, starts again at one. */
  if wallet.last_login_day = p_day - 1 then
    next_streak := wallet.streak_days + 1;
  else
    next_streak := 1;
  end if;

  /* Ten consecutive days pays, and the counter starts over.
     The learner never sees this column read 10 — it reaches ten
     and is spent in the same statement. */
  if next_streak >= 10 then
    bonus_grant := 20;
    next_streak := 0;

    insert into public.xp_transactions (
      user_id, amount, reason, source_type, source_id
    )
    values (
      p_user_id, bonus_grant, 'Ten day streak', 'streak', p_day::text
    )
    on conflict (user_id, source_type, source_id)
      where source_type is not null and source_id is not null
    do nothing;
  end if;

  update public.user_credits as uc
     set balance         = least(
                             uc.max_balance,
                             uc.balance + day_grant + bonus_grant
                           ),
         lifetime_earned = uc.lifetime_earned + day_grant + bonus_grant,
         streak_days     = next_streak,
         last_login_day  = p_day,
         last_refill_at  = now(),
         updated_at      = now()
   where uc.user_id = p_user_id
  returning * into wallet;

  granted  := day_grant;
  bonus    := bonus_grant;
  balance  := wallet.balance;
  lifetime := wallet.lifetime_earned;
  streak   := wallet.streak_days;
  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- THE OLD RESET GOES
--
-- Unscheduled before it is dropped, because pg_cron holds a
-- reference to the function and a job pointing at a dropped
-- function fails loudly every night.
--
-- This is the one genuinely destructive line in the migration
-- and it is the whole reason the migration exists: left
-- running, reset_daily_credits would set every learner's
-- balance back to 40 at seven minutes past midnight and delete
-- everything they had saved toward a marketplace agent.
-- ---------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (
      select 1 from cron.job where jobname = 'neurolink-reset-daily-credits'
    ) then
      perform cron.unschedule('neurolink-reset-daily-credits');
    end if;
  end if;
end
$cron$;

drop function if exists public.reset_daily_credits();

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as every SECURITY DEFINER function in this
-- schema since 0002: they take the target user id as an
-- argument and therefore bypass RLS by construction. Granted to
-- `authenticated`, grant_credits and claim_daily_credits would
-- both be money printers.
--
-- credit_level is the exception and is granted broadly: it is a
-- pure arithmetic function over a number the caller already
-- had, and it reads nothing.
--
-- CREATE FUNCTION grants execute to PUBLIC by default, which is
-- why the revokes are not redundant.
-- ---------------------------------------------------------

revoke all on function public.spend_credits(uuid, integer)
  from public, anon, authenticated;

revoke all on function public.refund_credits(uuid, integer)
  from public, anon, authenticated;

revoke all on function public.grant_credits(uuid, integer, text, text, text)
  from public, anon, authenticated;

revoke all on function public.claim_daily_credits(uuid, date)
  from public, anon, authenticated;

grant execute on function public.spend_credits(uuid, integer)
  to service_role;

grant execute on function public.refund_credits(uuid, integer)
  to service_role;

grant execute on function public.grant_credits(uuid, integer, text, text, text)
  to service_role;

grant execute on function public.claim_daily_credits(uuid, date)
  to service_role;

grant execute on function public.credit_level(integer)
  to service_role, authenticated;
