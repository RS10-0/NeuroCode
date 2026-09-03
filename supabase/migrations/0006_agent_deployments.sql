-- =========================================================
-- NEUROLINK — AGENT DEPLOYMENTS
--
-- Phase 2.4. An agent built in 2.3 becomes reachable from
-- outside NeuroLink: a stable URL, a NeuroLink-issued key, and
-- an external application on the other end of it.
--
-- What this migration deliberately does NOT add is a second
-- runtime. A deployed request is the same `runChat` call the Lab
-- and the Builder make, on behalf of the agent's owner, with a
-- body the server composes from the stored rows rather than one
-- the caller sent. So there is no new provider table, no new
-- credential store, no new quota system — only the two tables
-- below and one more column on ai_usage.
--
-- The seams this uses were left here on purpose:
--   ai_usage.feature = 'agent_public'  (0003)
--   agents.status    = 'ready'         (0005)
-- Neither is invented here; both are finally written.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- DEPLOYMENTS
--
-- There is no `status` column, and that is a decision. A
-- deployment exists or it does not; its key is active or it is
-- revoked. Those two switches already express everything a
-- learner needs — revoking the key IS the pause, because the URL
-- survives, calls are refused, and issuing a new key resumes.
-- A third state with no behaviour of its own would be a column
-- to keep in sync for nothing.
--
-- The configuration is read live on every call rather than
-- snapshotted here. Editing an agent in the Builder therefore
-- changes what the endpoint answers immediately, which is the
-- model a learner already holds — and it keeps the deployed
-- composition byte-for-byte identical to the tested one.
-- ---------------------------------------------------------

create table if not exists public.agent_deployments (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null,
  user_id    uuid not null references auth.users (id) on delete cascade,

  -- The identifier in the public URL. Server-generated and
  -- opaque, so the endpoint never carries a database key and a
  -- deployment can be destroyed and remade without the agent's
  -- own id ever having been published.
  public_id  text not null unique,

  created_at timestamptz not null default now(),

  -- One deployment per agent. "Deploy" is one button with one
  -- answer; a second URL for the same agent is a thing nobody
  -- asked for and every screen would then have to explain.
  unique (agent_id),

  -- The same composite key agent_knowledge carries, for the same
  -- reason: it makes "a deployment of somebody else's agent"
  -- unrepresentable rather than merely unreachable, and it means
  -- deleting an agent takes its deployment with it.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade
);

create index if not exists agent_deployments_user_idx
  on public.agent_deployments (user_id, created_at desc);

-- ---------------------------------------------------------
-- DEPLOYMENT KEYS
--
-- The credential an external caller presents. Stored the way a
-- credential has to be stored: hashed, never recoverable, shown
-- to the learner exactly once at the moment it is minted.
--
-- `token_prefix` is plaintext on purpose. It is the lookup
-- handle, so verifying a presented token is one indexed select
-- rather than a scan that hashes every row. It identifies the
-- key; it does not authenticate it. The 256-bit secret does
-- that, and only its SHA-256 is kept.
--
-- Revocation is a timestamp rather than a delete, so a key's
-- history — what it spent, when it was last used — survives the
-- moment it stops working.
-- ---------------------------------------------------------

create table if not exists public.agent_deployment_keys (
  id            uuid primary key default gen_random_uuid(),
  deployment_id uuid not null
                references public.agent_deployments (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,

  token_prefix  text not null unique,
  token_hash    text not null,
  -- Safe metadata. Never enough to reconstruct the token.
  last4         text not null,
  label         text,

  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- At most one usable key per deployment. Rotation is
-- revoke-then-issue, which is one action for the learner and one
-- row for anything reading this to reason about.
create unique index if not exists agent_deployment_keys_active_idx
  on public.agent_deployment_keys (deployment_id)
  where revoked_at is null;

create index if not exists agent_deployment_keys_deployment_idx
  on public.agent_deployment_keys (deployment_id, created_at desc);

-- ---------------------------------------------------------
-- USAGE ATTRIBUTION
--
-- The last link in the chain. ai_usage has carried user_id,
-- agent_id, power_source_kind, provider_id, model and key_id
-- since 0003/0004; adding deployment_id completes
--
--   user -> agent -> deployment -> power source -> provider -> model
--
-- without a parallel ledger anywhere.
--
-- Deliberately no foreign key, for exactly the reason key_id has
-- none: deleting a deployment must not delete the history of
-- what it spent.
-- ---------------------------------------------------------

alter table public.ai_usage
  add column if not exists deployment_id uuid;

create index if not exists ai_usage_deployment_window_idx
  on public.ai_usage (deployment_id, created_at desc)
  where deployment_id is not null;

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Two different postures, because these are two different kinds
-- of row.
--
-- agent_deployments is owner-READ only. Creating one has to be
-- gated on agents.status = 'ready' and has to mint its own
-- public_id, and a browser insert would do neither — so writes
-- go through Express with the service role. Same shape as
-- ai_usage in 0003, and the same reasoning.
--
-- agent_deployment_keys gets the strongest posture in this
-- schema, copied from user_ai_keys in 0004: RLS on, no policy at
-- all, and privileges revoked outright. An owner policy would
-- let the browser read token hashes, and there is no reason it
-- should ever see one.
-- ---------------------------------------------------------

alter table public.agent_deployments enable row level security;

drop policy if exists agent_deployments_owner_all  on public.agent_deployments;
drop policy if exists agent_deployments_owner_read on public.agent_deployments;

create policy agent_deployments_owner_read
  on public.agent_deployments
  for select
  using (auth.uid() = user_id);

alter table public.agent_deployment_keys enable row level security;

drop policy if exists agent_deployment_keys_owner_all  on public.agent_deployment_keys;
drop policy if exists agent_deployment_keys_owner_read on public.agent_deployment_keys;

revoke all on public.agent_deployment_keys from anon, authenticated;

-- ---------------------------------------------------------
-- ADMISSION, v3
--
-- One more dimension on the gate that already exists, rather
-- than a second gate beside it. The whole reason ai_usage_admit
-- is a single SQL function is that counting in Node and
-- inserting afterwards leaves a window in which ten parallel
-- requests all read "0 used"; a separate deployment check would
-- reintroduce exactly that window, and cost a round trip to do
-- it.
--
-- The deployment limits are ADDITIONAL, not alternative. A
-- deployed call is still counted against its owner's quota key
-- and, when it is platform-powered, still counted against
-- NeuroLink's platform budget -- because the owner is still who
-- pays. What these add is a tighter ceiling on one endpoint, so
-- a runaway integration cannot spend an owner's whole day before
-- they notice, and cannot starve their own Lab and Builder use.
--
-- Checks are ordered by permanence, days before minutes before
-- concurrency, so the caller is always told the longest-lived
-- thing that is true rather than whichever limit happened to be
-- tested first.
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
  p_agent_id                 uuid default null,
  -- Per deployment. All ignored when p_deployment_id is null,
  -- which is every Lab, Builder and dev-harness call.
  p_deployment_id            uuid default null,
  p_deployment_limit_per_minute integer default 0,
  p_deployment_limit_per_day    integer default 0,
  p_deployment_limit_concurrent integer default 0
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
  deployment_minute        integer,
  deployment_day           integer,
  deployment_in_flight     integer,
  retry_after_seconds      integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  oldest_in_minute         timestamptz;
  oldest_in_day            timestamptz;
  oldest_deployment_minute timestamptz;
  oldest_deployment_day    timestamptz;
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

  /* ----- deployment windows -----
     Only read when there is a deployment, so an ordinary Lab
     call pays nothing for a feature it does not use. */

  deployment_minute    := 0;
  deployment_day       := 0;
  deployment_in_flight := 0;

  if p_deployment_id is not null then
    select count(*)::integer, min(created_at)
      into deployment_minute, oldest_deployment_minute
      from public.ai_usage
     where deployment_id = p_deployment_id
       and created_at > now() - interval '1 minute';

    select count(*)::integer, min(created_at)
      into deployment_day, oldest_deployment_day
      from public.ai_usage
     where deployment_id = p_deployment_id
       and created_at > now() - interval '24 hours';

    select count(*)::integer
      into deployment_in_flight
      from public.ai_usage
     where deployment_id = p_deployment_id
       and status        = 'pending';
  end if;

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

  /* ----- per-user day ----- */

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

  /* ----- deployment day ----- */

  if p_deployment_id is not null
     and p_deployment_limit_per_day > 0
     and deployment_day >= p_deployment_limit_per_day then
    admitted := false;
    reason   := 'deployment_daily_exceeded';
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        coalesce(oldest_deployment_day, now()) + interval '24 hours' - now()
      )))::integer
    );
    return next;
    return;
  end if;

  /* ----- per-user rate ----- */

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

  /* ----- deployment rate ----- */

  if p_deployment_id is not null
     and p_deployment_limit_per_minute > 0
     and deployment_minute >= p_deployment_limit_per_minute then
    admitted := false;
    reason   := 'deployment_rate_limited';
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        coalesce(oldest_deployment_minute, now()) + interval '1 minute' - now()
      )))::integer
    );
    return next;
    return;
  end if;

  /* ----- concurrency ----- */

  if p_limit_concurrent > 0 and in_flight >= p_limit_concurrent then
    admitted := false;
    reason   := 'too_many_concurrent';
    retry_after_seconds := 2;
    return next;
    return;
  end if;

  if p_deployment_id is not null
     and p_deployment_limit_concurrent > 0
     and deployment_in_flight >= p_deployment_limit_concurrent then
    admitted := false;
    reason   := 'deployment_too_many_concurrent';
    retry_after_seconds := 2;
    return next;
    return;
  end if;

  insert into public.ai_usage (
    user_id, quota_key, power_source_kind, provider_id,
    model, feature, agent_id, key_id, deployment_id, status
  )
  values (
    p_user_id, p_quota_key, p_power_source_kind, p_provider_id,
    p_model, p_feature, p_agent_id, p_key_id, p_deployment_id, 'pending'
  )
  returning id into new_id;

  admitted    := true;
  reason      := null;
  usage_id    := new_id;
  used_minute := used_minute + 1;
  used_day    := used_day + 1;
  in_flight   := in_flight + 1;

  if p_deployment_id is not null then
    deployment_minute    := deployment_minute + 1;
    deployment_day       := deployment_day + 1;
    deployment_in_flight := deployment_in_flight + 1;
  end if;

  retry_after_seconds := 0;

  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- DEPLOYMENT USAGE
--
-- What the Deploy screen reads: one call instead of the three
-- PostgREST round trips the same figures would otherwise cost.
--
-- The last error code is included on purpose. A deployed caller
-- is told only that the agent is unavailable, because the true
-- code describes the owner's account and the caller is not the
-- owner. This is where the owner gets the real answer.
-- ---------------------------------------------------------

drop function if exists public.agent_deployment_usage(uuid);

create or replace function public.agent_deployment_usage(
  p_deployment_id uuid
)
returns table (
  requests_minute   integer,
  requests_day      integer,
  requests_total    integer,
  tokens_day        bigint,
  in_flight         integer,
  last_called_at    timestamptz,
  last_error_code   text,
  last_error_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  select count(*)::integer
    into requests_minute
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.created_at > now() - interval '1 minute';

  select count(*)::integer,
         coalesce(sum(au.input_tokens + au.output_tokens), 0)::bigint
    into requests_day, tokens_day
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.created_at > now() - interval '24 hours';

  select count(*)::integer, max(au.created_at)
    into requests_total, last_called_at
    from public.ai_usage au
   where au.deployment_id = p_deployment_id;

  select count(*)::integer
    into in_flight
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.status        = 'pending';

  select au.error_code, au.created_at
    into last_error_code, last_error_at
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.error_code is not null
   order by au.created_at desc
   limit 1;

  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as 0002, 0003 and 0004: a SECURITY DEFINER
-- function that takes an id as an argument bypasses RLS by
-- construction, so `authenticated` must not be able to call it.
-- Granted to the service role, which is the only thing that
-- does.
-- ---------------------------------------------------------

revoke all on function public.ai_usage_admit(
  uuid, text, text, text, text, text, uuid, integer,
  integer, integer, integer, integer,
  integer, bigint, integer, bigint,
  uuid, uuid, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.ai_usage_admit(
  uuid, text, text, text, text, text, uuid, integer,
  integer, integer, integer, integer,
  integer, bigint, integer, bigint,
  uuid, uuid, integer, integer, integer
) to service_role;

revoke all on function public.agent_deployment_usage(uuid)
  from public, anon, authenticated;

grant execute on function public.agent_deployment_usage(uuid)
  to service_role;
