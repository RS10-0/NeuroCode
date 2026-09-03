-- =========================================================
-- NEUROLINK — AI USAGE AND SERVER-ENFORCED QUOTAS
--
-- Phase 2.1 (AI runtime). One table and three functions.
--
-- Nothing here touches the course, lesson, XP, onboarding or
-- profile tables: the AI runtime is additive.
--
-- The quota decision lives in SQL rather than in the Node
-- process for two reasons. It has to survive a restart — an
-- in-memory counter resets to zero every time the server
-- reloads, which is exactly the window a refresh loop needs.
-- And admission has to be atomic: counting in one round trip
-- and inserting in another lets N concurrent requests all read
-- the same "0 used" and all proceed.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- AI USAGE
--
-- One row per admitted request, written BEFORE the provider is
-- called and updated once it finishes. A row therefore exists
-- for in-flight work, which is what makes the concurrency limit
-- possible and what stops a burst of parallel requests from
-- each seeing an empty window.
--
-- `quota_key` is what limits are counted against, not the user
-- id — so a future BYOK key can carry its own budget
-- (`byok:<keyId>`) while a platform-key learner is counted as
-- `free:<userId>`.
-- ---------------------------------------------------------

create table if not exists public.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,

  quota_key         text not null,
  power_source_kind text not null
                    check (power_source_kind in ('free', 'byok', 'managed')),

  provider_id       text not null,
  model             text not null,

  -- Which part of the product spent this. Phase 2.1 uses `lab`
  -- and `dev_harness`; the rest are listed now so a later phase
  -- does not need a migration just to add a caller.
  feature           text not null
                    check (feature in (
                      'lab', 'compare', 'agent_test',
                      'agent_public', 'vibe', 'dev_harness'
                    )),

  agent_id          uuid,

  -- 'pending' from admission until the request finishes. Rows
  -- left pending by a crash are reaped by ai_usage_admit.
  status            text not null default 'pending'
                    check (status in ('pending', 'done')),

  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  latency_ms        integer,

  ok                boolean,
  error_code        text,

  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);

-- Every quota window is "rows for this key since T", so the key
-- must lead and the timestamp must be ordered.
create index if not exists ai_usage_quota_window_idx
  on public.ai_usage (quota_key, created_at desc);

create index if not exists ai_usage_user_window_idx
  on public.ai_usage (user_id, created_at desc);

-- In-flight counting reads only pending rows, and there are
-- very few of them at any moment.
create index if not exists ai_usage_in_flight_idx
  on public.ai_usage (quota_key)
  where status = 'pending';

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Deliberately NOT the `for all` owner policy the other tables
-- use. A learner may read their own usage — the meter in the UI
-- is built from it — but must never write it. An INSERT right
-- here would let the browser pad its own history, and a DELETE
-- right would let it erase the very rows a quota is counted
-- from.
--
-- Every write goes through the service role, which bypasses RLS.
-- ---------------------------------------------------------

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_owner_all on public.ai_usage;
drop policy if exists ai_usage_owner_read on public.ai_usage;

create policy ai_usage_owner_read
  on public.ai_usage
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- ADMIT A REQUEST
--
-- The single gate every model call passes through. Counts the
-- three windows and inserts the pending row in one statement,
-- so the count cannot go stale between the check and the write.
--
-- Limits arrive as arguments rather than being stored here on
-- purpose: they are configuration, they differ per power source,
-- and they must be changeable without a migration.
--
-- Returns admitted=false with a reason rather than raising, so
-- the caller can map each case to its own HTTP status instead
-- of pattern-matching an error string.
-- ---------------------------------------------------------

create or replace function public.ai_usage_admit(
  p_user_id           uuid,
  p_quota_key         text,
  p_power_source_kind text,
  p_provider_id       text,
  p_model             text,
  p_feature           text,
  p_limit_per_minute  integer,
  p_limit_per_day     integer,
  p_limit_concurrent  integer,
  p_agent_id          uuid default null
)
returns table (
  admitted            boolean,
  reason              text,
  usage_id            uuid,
  used_minute         integer,
  used_day            integer,
  in_flight           integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  oldest_in_minute timestamptz;
  oldest_in_day    timestamptz;
  new_id           uuid;
begin
  -- Reap abandoned rows first. A process killed mid-stream
  -- leaves a pending row behind, and without this every crash
  -- would permanently consume one of that user's concurrency
  -- slots. Ten minutes is comfortably longer than any request
  -- the runtime's own timeout allows.
  update public.ai_usage
     set status      = 'done',
         ok          = false,
         error_code  = 'abandoned',
         finished_at = now()
   where quota_key = p_quota_key
     and status    = 'pending'
     and created_at < now() - interval '10 minutes';

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

  -- The daily budget is checked before the per-minute burst so
  -- that an exhausted learner is told the honest thing — come
  -- back tomorrow — rather than being asked to wait sixty
  -- seconds for a window that will refuse them again.
  if p_limit_per_day > 0 and used_day >= p_limit_per_day then
    admitted := false;
    reason   := 'quota_exceeded';
    retry_after_seconds := greatest(
      1,
      ceil(
        extract(epoch from (oldest_in_day + interval '24 hours' - now()))
      )::integer
    );
    return next;
    return;
  end if;

  if p_limit_per_minute > 0 and used_minute >= p_limit_per_minute then
    admitted := false;
    reason   := 'rate_limited';
    retry_after_seconds := greatest(
      1,
      ceil(
        extract(epoch from (oldest_in_minute + interval '1 minute' - now()))
      )::integer
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
    model, feature, agent_id, status
  )
  values (
    p_user_id, p_quota_key, p_power_source_kind, p_provider_id,
    p_model, p_feature, p_agent_id, 'pending'
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
-- FINISH A REQUEST
--
-- Called from a `finally`, so it runs for a clean stop, a
-- provider failure, a timeout and a cancelled stream alike.
-- Idempotent: a second call against an already-finished row
-- matches nothing and changes nothing.
-- ---------------------------------------------------------

create or replace function public.ai_usage_finish(
  p_usage_id      uuid,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_latency_ms    integer,
  p_ok            boolean,
  p_error_code    text default null
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
         finished_at   = now()
   where id     = p_usage_id
     and status = 'pending';
end;
$fn$;

-- ---------------------------------------------------------
-- USAGE SNAPSHOT
--
-- What the meter in the UI reads. The counts are exactly what
-- the limits are checked against, so the number a learner sees
-- is the number the gate uses. Token totals cover the rolling
-- day.
-- ---------------------------------------------------------

create or replace function public.ai_usage_snapshot(
  p_quota_key text
)
returns table (
  used_minute   integer,
  used_day      integer,
  in_flight     integer,
  input_tokens  integer,
  output_tokens integer
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  select count(*)::integer
    into used_minute
    from public.ai_usage au
   where au.quota_key = p_quota_key
     and au.created_at > now() - interval '1 minute';

  select count(*)::integer,
         coalesce(sum(au.input_tokens), 0)::integer,
         coalesce(sum(au.output_tokens), 0)::integer
    into used_day, input_tokens, output_tokens
    from public.ai_usage au
   where au.quota_key = p_quota_key
     and au.created_at > now() - interval '24 hours';

  select count(*)::integer
    into in_flight
    from public.ai_usage au
   where au.quota_key = p_quota_key
     and au.status    = 'pending';

  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as award_step_xp in 0002. These are SECURITY
-- DEFINER and take the user id as an argument, so they bypass
-- RLS entirely. Granted to `authenticated`, ai_usage_admit
-- would let any signed-in browser mint usage rows against
-- somebody else's quota key — and ai_usage_finish would let it
-- close its own pending rows to free concurrency slots it has
-- not actually finished using.
--
-- The Express runtime is the only legitimate caller, and it
-- resolves the user id from a verified bearer token first.
--
-- CREATE FUNCTION grants execute to PUBLIC by default, which is
-- why the revokes are not redundant.
-- ---------------------------------------------------------

revoke all on function public.ai_usage_admit(
  uuid, text, text, text, text, text, integer, integer, integer, uuid
) from public, anon, authenticated;

revoke all on function public.ai_usage_finish(
  uuid, integer, integer, integer, boolean, text
) from public, anon, authenticated;

revoke all on function public.ai_usage_snapshot(text)
  from public, anon, authenticated;

grant execute on function public.ai_usage_admit(
  uuid, text, text, text, text, text, integer, integer, integer, uuid
) to service_role;

grant execute on function public.ai_usage_finish(
  uuid, integer, integer, integer, boolean, text
) to service_role;

grant execute on function public.ai_usage_snapshot(text)
  to service_role;
