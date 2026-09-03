-- =========================================================
-- NEUROLINK — BASELINE
--
-- The five tables below already exist in the hosted project;
-- they were applied by hand through the dashboard and were
-- never captured in the repo. This file documents them so the
-- schema can be recreated from scratch, and so later
-- migrations have something to build on.
--
-- Safe to run against the existing project: every statement is
-- IF NOT EXISTS.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- COURSE PROGRESS
-- ---------------------------------------------------------

create table if not exists public.course_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  course_id    text not null,
  status       text not null default 'in_progress'
               check (status in ('in_progress', 'completed')),
  progress_percent  numeric(5, 2) not null default 0,
  current_lesson_id text,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (user_id, course_id)
);

-- ---------------------------------------------------------
-- LESSON PROGRESS
-- ---------------------------------------------------------

create table if not exists public.lesson_progress (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  lesson_id           text not null,
  completed           boolean not null default false,
  attempts            integer not null default 0,
  successful_attempts integer not null default 0,
  mastery             text not null default 'not_started',
  last_attempt_at     timestamptz,
  status              text not null default 'in_progress'
                      check (status in ('in_progress', 'completed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, lesson_id)
);

-- ---------------------------------------------------------
-- CONCEPT PROGRESS
-- ---------------------------------------------------------

create table if not exists public.concept_progress (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  concept_id          text not null,
  mastery             text not null default 'not_started',
  attempts            integer not null default 0,
  successful_attempts integer not null default 0,
  last_attempt_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, concept_id)
);

-- ---------------------------------------------------------
-- USER STATS
-- ---------------------------------------------------------

create table if not exists public.user_stats (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null unique
                             references auth.users (id) on delete cascade,
  xp                         integer not null default 0,
  level                      integer not null default 1,
  current_streak             integer not null default 0,
  longest_streak             integer not null default 0,
  total_lessons_completed    integer not null default 0,
  total_challenges_completed integer not null default 0,
  updated_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------
-- PROJECTS
-- ---------------------------------------------------------

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  description  text,
  project_type text not null default 'generic',
  environment  text not null default 'ai'
               check (environment in ('ai', 'programming')),
  content      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- PROGRESS (server-side store, one row per user)
-- ---------------------------------------------------------

create table if not exists public.progress (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  completed_lesson_ids text[] not null default '{}',
  concept_progress    jsonb not null default '[]'::jsonb,
  current_lesson_id   text,
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------
-- PROFILES
--
-- One row per auth user, holding the display name chosen at
-- registration. AuthContext reads it after sign-in.
-- ---------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- XP TRANSACTIONS
--
-- An append-only XP ledger. Present in the project but not yet
-- written by the application: award_step_xp is the only path
-- that grants XP today, and it updates user_stats directly.
-- Documented here so the schema file matches the database.
-- ---------------------------------------------------------

create table if not exists public.xp_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  amount      integer not null,
  reason      text,
  source_type text,
  source_id   text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Every table is owner-only. The server uses the service role
-- key, which bypasses RLS; the browser client does not.
-- ---------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'course_progress', 'lesson_progress', 'concept_progress',
    'user_stats', 'projects', 'progress', 'xp_transactions'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);

    execute format(
      'drop policy if exists %I on public.%I',
      target || '_owner_all', target
    );

    execute format(
      'create policy %I on public.%I
         for all
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id)',
      target || '_owner_all', target
    );
  end loop;
end
$$;

-- ---------------------------------------------------------
-- PROFILES RLS
--
-- Keyed on `id` rather than `user_id`, so it cannot ride the
-- loop above.
-- ---------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists profiles_owner_all on public.profiles;

create policy profiles_owner_all
  on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
