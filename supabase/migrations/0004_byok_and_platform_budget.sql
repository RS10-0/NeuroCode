-- =========================================================
-- NEUROLINK — BYOK CREDENTIALS AND A PLATFORM-WIDE BUDGET
--
-- Two gaps in 0003, closed together because they share one
-- admission function.
--
-- 1. Every quota in 0003 was keyed to `free:<userId>`, so limits
--    were per learner and nothing capped the platform. Exposure
--    was accounts x per-account limit, with nothing bounding the
--    first term. This adds daily and monthly ceilings counted
--    across ALL platform traffic.
--
-- 2. Quotas counted requests, not tokens. A 20-token turn and a
--    6,000-token turn were identical against quota but differ by
--    orders of magnitude in cost. Token budgets are now enforced
--    per user and platform-wide.
--
-- Plus `user_ai_keys`, so a learner can spend their own provider
-- credits instead of NeuroLink's.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- POWER SOURCE VOCABULARY
--
-- 0003 called NeuroLink's own key `free`, which described the
-- learner's experience rather than what the row is. `platform`
-- says who pays, which is the question the budget asks.
-- ---------------------------------------------------------

update public.ai_usage
   set power_source_kind = 'platform'
 where power_source_kind = 'free';

alter table public.ai_usage
  drop constraint if exists ai_usage_power_source_kind_check;

alter table public.ai_usage
  add constraint ai_usage_power_source_kind_check
  check (power_source_kind in ('platform', 'byok', 'managed'));

-- Which BYOK credential paid for this request. Null for platform
-- traffic. Deliberately no foreign key: deleting a key must not
-- delete the history of what it spent.
alter table public.ai_usage
  add column if not exists key_id uuid;

-- The platform budget counts only platform rows, so the kind has
-- to lead this index.
create index if not exists ai_usage_platform_window_idx
  on public.ai_usage (power_source_kind, created_at desc);

-- ---------------------------------------------------------
-- BYOK CREDENTIALS
--
-- Secrets at rest, encrypted with AES-256-GCM. The plaintext key
-- exists in one place only: the server's memory, for the
-- duration of one request.
--
-- `key_ciphertext`, `key_iv` and `key_tag` are the three parts
-- GCM needs. `last4` and `fingerprint` are what the browser is
-- allowed to see — enough for a learner to recognise which key
-- they pasted, useless to anyone who steals the row.
-- ---------------------------------------------------------

create table if not exists public.user_ai_keys (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,

  provider_id       text not null,
  label             text,

  key_ciphertext    text not null,
  key_iv            text not null,
  key_tag           text not null,

  -- Safe metadata. Never enough to reconstruct the key.
  last4             text not null,
  fingerprint       text not null,

  status            text not null default 'active'
                    check (status in ('active', 'invalid', 'revoked')),

  last_validated_at timestamptz,
  last_used_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One key per provider per learner. Replacing a key is an
  -- update, not a second row nobody can tell apart.
  unique (user_id, provider_id)
);

create index if not exists user_ai_keys_user_idx
  on public.user_ai_keys (user_id);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY — SERVICE ROLE ONLY
--
-- RLS is enabled and NO policy is created. That is deliberate,
-- and it is stronger than an owner policy: with no policy, the
-- `anon` and `authenticated` roles can do nothing at all with
-- this table — not select, not insert, not update, not delete.
--
-- An owner policy would let a signed-in browser read its own
-- row, and that row contains the ciphertext, the IV and the
-- tag. Everything the browser legitimately needs is served by
-- the API as derived metadata instead.
--
-- The service role bypasses RLS, so the server still works.
-- ---------------------------------------------------------

alter table public.user_ai_keys enable row level security;

drop policy if exists user_ai_keys_owner_all on public.user_ai_keys;
drop policy if exists user_ai_keys_owner_read on public.user_ai_keys;

revoke all on public.user_ai_keys from anon, authenticated;

-- ---------------------------------------------------------
-- ADMISSION
--
-- One function, one round trip, one atomic decision covering
-- six limits. Signature changed from 0003, so the old one is
-- dropped rather than replaced.
--
-- Token budgets are checked against what this request COULD
-- cost — estimated input plus the maximum output allowed — not
-- against what it did cost, because that is not knowable until
-- afterwards. It errs toward refusing, which is the correct
-- direction for a spending limit.
--
-- Platform ceilings are skipped for BYOK: a learner spending
-- their own provider credits must not be blocked because
-- NeuroLink's budget is exhausted. Every other limit still
-- applies to them.
-- ---------------------------------------------------------

drop function if exists public.ai_usage_admit(
  uuid, text, text, text, text, text, integer, integer, integer, uuid
);

drop function if exists public.ai_usage_admit(
  uuid, text, text, text, text, text, uuid, integer,
  integer, integer, integer, integer,
  integer, bigint, integer, bigint, uuid
);

create or replace function public.ai_usage_admit(
  p_user_id                  uuid,
  p_quota_key                text,
  p_power_source_kind        text,
  p_provider_id              text,
  p_model                    text,
  p_feature                  text,
  p_key_id                   uuid,
  -- What this request could cost, in tokens.
  p_estimated_tokens         integer,
  -- Per user.
  p_limit_per_minute         integer,
  p_limit_per_day            integer,
  p_limit_concurrent         integer,
  p_limit_tokens_per_day     integer,
  -- Platform-wide. Ignored unless the kind is 'platform'.
  p_platform_daily_requests  integer,
  p_platform_daily_tokens    bigint,
  p_platform_monthly_requests integer,
  p_platform_monthly_tokens  bigint,
  p_agent_id                 uuid default null
)
returns table (
  admitted                 boolean,
  reason                   text,
  usage_id                 uuid,
  used_minute              integer,
  used_day                 integer,
  in_flight                integer,
  tokens_today             bigint,
  platform_day_requests    integer,
  platform_day_tokens      bigint,
  platform_month_requests  integer,
  platform_month_tokens    bigint,
  retry_after_seconds      integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  oldest_in_minute timestamptz;
  oldest_in_day    timestamptz;
  month_start      timestamptz := date_trunc('month', now() at time zone 'utc');
  safe_estimate    integer := greatest(0, coalesce(p_estimated_tokens, 0));
  new_id           uuid;
begin
  -- Reap rows abandoned by a crash, so they stop holding a
  -- concurrency slot. Same reasoning as 0003.
  update public.ai_usage
     set status      = 'done',
         ok          = false,
         error_code  = 'abandoned',
         finished_at = now()
   where quota_key = p_quota_key
     and status    = 'pending'
     and created_at < now() - interval '10 minutes';

  /* ----- per-user windows ----- */

  select count(*)::integer, min(created_at)
    into used_minute, oldest_in_minute
    from public.ai_usage
   where quota_key = p_quota_key
     and created_at > now() - interval '1 minute';

  select count(*)::integer, min(created_at)
    into used_day, oldest_in_day
    from public.ai_usage
   where quota_key = p_quota_key
     and created_at > now() - interval '24 hours';

  select count(*)::integer
    into in_flight
    from public.ai_usage
   where quota_key = p_quota_key
     and status    = 'pending';

  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
    into tokens_today
    from public.ai_usage
   where quota_key = p_quota_key
     and created_at > now() - interval '24 hours';

  /* ----- platform windows -----
     Rolling 24 hours for the daily figure, because that is an
     abuse control and a calendar reset gives an attacker a
     predictable moment. Calendar month for the monthly figure,
     because that one exists to match a provider invoice. */

  select count(*)::integer,
         coalesce(sum(input_tokens + output_tokens), 0)::bigint
    into platform_day_requests, platform_day_tokens
    from public.ai_usage
   where power_source_kind = 'platform'
     and created_at > now() - interval '24 hours';

  select count(*)::integer,
         coalesce(sum(input_tokens + output_tokens), 0)::bigint
    into platform_month_requests, platform_month_tokens
    from public.ai_usage
   where power_source_kind = 'platform'
     and created_at >= month_start;

  /* ----- platform ceilings (platform traffic only) -----
     Checked first, and monthly before daily, so the learner is
     told the most permanent thing that is true. */

  if p_power_source_kind = 'platform' then
    if p_platform_monthly_requests > 0
       and platform_month_requests >= p_platform_monthly_requests then
      admitted := false;
      reason   := 'platform_monthly_exceeded';
      retry_after_seconds := greatest(
        1,
        ceil(extract(epoch from (
          (month_start + interval '1 month') - now()
        )))::integer
      );
      return next;
      return;
    end if;

    if p_platform_monthly_tokens > 0
       and platform_month_tokens + safe_estimate > p_platform_monthly_tokens then
      admitted := false;
      reason   := 'platform_monthly_exceeded';
      retry_after_seconds := greatest(
        1,
        ceil(extract(epoch from (
          (month_start + interval '1 month') - now()
        )))::integer
      );
      return next;
      return;
    end if;

    if p_platform_daily_requests > 0
       and platform_day_requests >= p_platform_daily_requests then
      admitted := false;
      reason   := 'platform_daily_exceeded';
      retry_after_seconds := 3600;
      return next;
      return;
    end if;

    if p_platform_daily_tokens > 0
       and platform_day_tokens + safe_estimate > p_platform_daily_tokens then
      admitted := false;
      reason   := 'platform_daily_exceeded';
      retry_after_seconds := 3600;
      return next;
      return;
    end if;
  end if;

  /* ----- per-user limits ----- */

  if p_limit_per_day > 0 and used_day >= p_limit_per_day then
    admitted := false;
    reason   := 'quota_exceeded';
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        oldest_in_day + interval '24 hours' - now()
      )))::integer
    );
    return next;
    return;
  end if;

  if p_limit_tokens_per_day > 0
     and tokens_today + safe_estimate > p_limit_tokens_per_day then
    admitted := false;
    reason   := 'token_quota_exceeded';
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        coalesce(oldest_in_day, now()) + interval '24 hours' - now()
      )))::integer
    );
    return next;
    return;
  end if;

  if p_limit_per_minute > 0 and used_minute >= p_limit_per_minute then
    admitted := false;
    reason   := 'rate_limited';
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        oldest_in_minute + interval '1 minute' - now()
      )))::integer
    );
    return next;
    return;
  end if;

  if p_limit_concurrent > 0 and in_flight >= p_limit_concurrent then
    admitted := false;
    reason   := 'too_many_concurrent';
    retry_after_seconds := 2;
    return next;
    return;
  end if;

  insert into public.ai_usage (
    user_id, quota_key, power_source_kind, provider_id,
    model, feature, agent_id, key_id, status
  )
  values (
    p_user_id, p_quota_key, p_power_source_kind, p_provider_id,
    p_model, p_feature, p_agent_id, p_key_id, 'pending'
  )
  returning id into new_id;

  admitted    := true;
  reason      := null;
  usage_id    := new_id;
  used_minute := used_minute + 1;
  used_day    := used_day + 1;
  in_flight   := in_flight + 1;
  retry_after_seconds := 0;

  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- SNAPSHOT
--
-- What the meter reads. Extended with the platform figures so a
-- learner can be told "NeuroLink's budget is spent" rather than
-- being left to guess why their own allowance looks untouched.
-- ---------------------------------------------------------

drop function if exists public.ai_usage_snapshot(text);

create or replace function public.ai_usage_snapshot(
  p_quota_key text
)
returns table (
  used_minute             integer,
  used_day                integer,
  in_flight               integer,
  input_tokens            bigint,
  output_tokens           bigint,
  tokens_today            bigint,
  platform_day_requests   integer,
  platform_day_tokens     bigint,
  platform_month_requests integer,
  platform_month_tokens   bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'utc');
begin
  select count(*)::integer
    into used_minute
    from public.ai_usage au
   where au.quota_key = p_quota_key
     and au.created_at > now() - interval '1 minute';

  select count(*)::integer,
         coalesce(sum(au.input_tokens), 0)::bigint,
         coalesce(sum(au.output_tokens), 0)::bigint
    into used_day, input_tokens, output_tokens
    from public.ai_usage au
   where au.quota_key = p_quota_key
     and au.created_at > now() - interval '24 hours';

  tokens_today := input_tokens + output_tokens;

  select count(*)::integer
    into in_flight
    from public.ai_usage au
   where au.quota_key = p_quota_key
     and au.status    = 'pending';

  select count(*)::integer,
         coalesce(sum(au.input_tokens + au.output_tokens), 0)::bigint
    into platform_day_requests, platform_day_tokens
    from public.ai_usage au
   where au.power_source_kind = 'platform'
     and au.created_at > now() - interval '24 hours';

  select count(*)::integer,
         coalesce(sum(au.input_tokens + au.output_tokens), 0)::bigint
    into platform_month_requests, platform_month_tokens
    from public.ai_usage au
   where au.power_source_kind = 'platform'
     and au.created_at >= month_start;

  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as 0002 and 0003: SECURITY DEFINER functions
-- that take a user id as an argument bypass RLS entirely, so
-- `authenticated` must not be able to call them.
-- ---------------------------------------------------------

revoke all on function public.ai_usage_admit(
  uuid, text, text, text, text, text, uuid, integer,
  integer, integer, integer, integer,
  integer, bigint, integer, bigint, uuid
) from public, anon, authenticated;

revoke all on function public.ai_usage_snapshot(text)
  from public, anon, authenticated;

grant execute on function public.ai_usage_admit(
  uuid, text, text, text, text, text, uuid, integer,
  integer, integer, integer, integer,
  integer, bigint, integer, bigint, uuid
) to service_role;

grant execute on function public.ai_usage_snapshot(text)
  to service_role;
