-- =========================================================
-- NEUROLINK — PER-STEP PROGRESS AND IDEMPOTENT XP
--
-- The spec requires that a learner never earns XP twice for
-- the same activity. Previously the player awarded the whole
-- lesson's XP on every replay.
--
-- Idempotency is enforced by a unique index, not by client
-- logic: award_step_xp inserts on conflict do nothing, and only
-- increments XP when the insert actually created a row.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- LESSON STEP PROGRESS
-- ---------------------------------------------------------

create table if not exists public.lesson_step_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  lesson_id    text not null,
  step_id      text not null,
  completed    boolean not null default true,
  score        numeric(5, 2),
  attempts     integer not null default 1,
  xp_awarded   integer not null default 0,
  completed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- The idempotency guarantee. Step ids are globally unique
  -- within the curriculum, so (user, step) is the natural key.
  unique (user_id, step_id)
);

create index if not exists lesson_step_progress_user_lesson_idx
  on public.lesson_step_progress (user_id, lesson_id);

alter table public.lesson_step_progress enable row level security;

drop policy if exists lesson_step_progress_owner_all on public.lesson_step_progress;

create policy lesson_step_progress_owner_all
  on public.lesson_step_progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- ONBOARDING
-- ---------------------------------------------------------

create table if not exists public.onboarding (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  completed            boolean not null default false,
  goal                 text,
  experience           text,
  literacy_score       integer,
  literacy_level       text,
  recommended_lesson_id text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.onboarding enable row level security;

drop policy if exists onboarding_owner_all on public.onboarding;

create policy onboarding_owner_all
  on public.onboarding
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- ATOMIC XP INCREMENT
--
-- Replaces a read-then-write in the client, where two awards
-- landing close together could clobber each other.
--
-- Level is derived, not stored independently: 500 XP a level.
-- ---------------------------------------------------------

create or replace function public.increment_xp(
  p_user_id uuid,
  p_amount  integer
)
returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_stats;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'XP amount must be zero or positive.';
  end if;

  insert into public.user_stats (user_id, xp, level)
  values (p_user_id, p_amount, greatest(1, (p_amount / 500) + 1))
  on conflict (user_id) do update
    set xp         = user_stats.xp + excluded.xp,
        level      = greatest(1, ((user_stats.xp + excluded.xp) / 500) + 1),
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------
-- AWARD STEP XP
--
-- The single entry point for granting step XP. Returns whether
-- this call was the one that recorded the step, how much XP it
-- granted (zero on a repeat), and the resulting totals.
-- ---------------------------------------------------------

create or replace function public.award_step_xp(
  p_user_id   uuid,
  p_lesson_id text,
  p_step_id   text,
  p_xp        integer,
  p_score     numeric default null
)
returns table (
  newly_completed boolean,
  awarded         integer,
  total_xp        integer,
  level           integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer := 0;
  inserted      boolean := false;
  stats         public.user_stats;
  safe_xp       integer := greatest(0, coalesce(p_xp, 0));
begin
  insert into public.lesson_step_progress (
    user_id, lesson_id, step_id, completed, score, attempts, xp_awarded
  )
  values (p_user_id, p_lesson_id, p_step_id, true, p_score, 1, safe_xp)
  on conflict (user_id, step_id) do nothing;

  -- row_count is 1 only when the insert actually created a row,
  -- which is exactly the condition for granting XP.
  get diagnostics inserted_rows = row_count;
  inserted := inserted_rows = 1;

  if inserted then
    stats := public.increment_xp(p_user_id, safe_xp);
  else
    -- Repeat visit: record the attempt but grant nothing.
    --
    -- `score` keeps the learner's best. Both sides stay null
    -- when neither run produced one — an unscored activity
    -- must not be recorded as having scored zero.
    update public.lesson_step_progress as lsp
       set attempts   = lsp.attempts + 1,
           score      = case
                          when lsp.score is null then p_score
                          when p_score  is null then lsp.score
                          else greatest(lsp.score, p_score)
                        end,
           updated_at = now()
     where lsp.user_id = p_user_id
       and lsp.step_id = p_step_id;

    select * into stats from public.user_stats where user_id = p_user_id;

    if stats.user_id is null then
      stats := public.increment_xp(p_user_id, 0);
    end if;
  end if;

  newly_completed := inserted;
  awarded         := case when inserted then safe_xp else 0 end;
  total_xp        := stats.xp;
  level           := stats.level;

  return next;
end;
$$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Both functions are SECURITY DEFINER and take the target
-- user id as an argument, so they bypass RLS entirely. Granted
-- to `authenticated` they would be an XP faucet: any signed-in
-- learner could call award_step_xp straight from the browser
-- with the publishable key, passing any p_xp, any p_step_id, or
-- somebody else's p_user_id.
--
-- The Express route is the only legitimate caller, and it
-- resolves the user id from a verified bearer token before
-- calling. So execute belongs to service_role alone.
--
-- CREATE FUNCTION grants execute to PUBLIC by default, which is
-- why the revokes below are not redundant.
-- ---------------------------------------------------------

revoke all on function public.increment_xp(uuid, integer)
  from public, anon, authenticated;

revoke all on function public.award_step_xp(uuid, text, text, integer, numeric)
  from public, anon, authenticated;

grant execute on function public.increment_xp(uuid, integer)
  to service_role;

grant execute on function public.award_step_xp(uuid, text, text, integer, numeric)
  to service_role;
