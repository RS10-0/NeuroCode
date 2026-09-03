-- =========================================================
-- NEUROLINK — FLAGSHIP AGENTS
--
-- Phase 2.8. Five professionally written agents a learner
-- unlocks with XP, sitting in an Agent Library beside the
-- Builder and the shelf.
--
-- WHAT IS NOT HERE IS THE POINT: there are no agent rows in
-- this migration. The five agents are not seeded into the
-- database at all.
--
-- Their definitions — names, taglines, capabilities, prices and
-- the long system prompts that are most of what makes them
-- worth 200 XP — live in src/features/agents/flagships.ts, a
-- versioned TypeScript module that the browser and the server
-- both import. The same arrangement SiteStore already uses for
-- the slug rules and xpPlan already uses for the curriculum:
-- one definition, both sides, no drift.
--
-- Three reasons that beat a seed script:
--
--   A system prompt is long-form content. It wants review,
--   diffs and blame, none of which a SQL blob gives you.
--
--   Migrations in this project are pasted into the Supabase SQL
--   editor by hand. A typo in a seeded prompt would mean
--   another manual paste; in TypeScript it is a deploy.
--
--   A purchased agent does not COPY its instructions. The row
--   carries `flagship_id` and the stores resolve the prompt
--   from the catalogue on read, so improving a prompt improves
--   it for everybody who already bought it — which a seeded
--   copy could never do.
--
-- So what this migration adds is the two things the database
-- genuinely has to own: which agents are official, and who has
-- paid for what.
--
-- Depends on 0014 — purchase_flagship debits the accumulating
-- wallet, and under 0011's resetting wallet every price here
-- would have been unaffordable forever.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- OFFICIAL AGENTS
--
-- A purchased flagship is an ORDINARY ROW in `agents`, owned by
-- the learner who bought it, carrying two extra columns.
--
-- That is the whole design, and it is worth saying why it beats
-- the alternative. Five canonical NeuroLink-owned rows plus a
-- grant table would have avoided duplicating a row per learner
-- — but memory scoping, agent_sites' composite foreign key,
-- deployments and every RLS policy in this schema are built on
-- `owner == user`. Each one would have needed a second code
-- path, and a second code path around an ownership check is
-- where cross-tenant reads come from.
--
-- A per-learner row means memory, knowledge, deployments,
-- pages, quota attribution and cascade-delete all keep working
-- exactly as they already do, with no new branches anywhere.
-- ---------------------------------------------------------

alter table public.agents
  -- Official agents are visually and functionally distinct from
  -- anything a learner built. This is the flag every screen
  -- keys off.
  add column if not exists is_official boolean not null default false,
  -- Which flagship this is a copy of. The join key back into
  -- flagships.ts, and what lets the stores swap in the current
  -- system prompt instead of a stale copy.
  add column if not exists flagship_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_flagship_pairing'
  ) then
    -- The two travel together or not at all. Without this, a
    -- row could claim to be official while naming no flagship,
    -- and the prompt resolver would have nothing to resolve.
    alter table public.agents
      add constraint agents_flagship_pairing
      check (
        (not is_official and flagship_id is null)
        or (is_official and flagship_id is not null)
      );
  end if;
end
$$;

-- One copy of each flagship per learner. Buying twice is not a
-- thing that should be representable, and the purchase function
-- below leans on this rather than on checking first.
create unique index if not exists agents_flagship_once_idx
  on public.agents (user_id, flagship_id)
  where flagship_id is not null;

-- ---------------------------------------------------------
-- THE POLICY CHANGE, WHICH IS THE LOAD-BEARING PART
--
-- 0005 gave `agents` the ordinary owner-all policy:
--
--   using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- That was correct while every agent was something the learner
-- typed in themselves. It stops being correct the moment a
-- column decides whether they get a 200 XP system prompt for
-- free, because `with check` is what the browser must satisfy
-- to write a row — and under the old policy a learner could set
-- `is_official = true, flagship_id = 'coding-coach'` on an
-- agent they made in the Builder and have the resolver hand
-- them the prompt they never paid for.
--
-- Adding `and is_official = false` to the WITH CHECK closes it,
-- and does two more jobs at the same time:
--
--   INSERT — a browser can only ever create unofficial agents.
--   Official rows come from the purchase endpoint, which runs
--   with the service role and bypasses RLS.
--
--   UPDATE — a purchased agent cannot be written by its owner
--   at all. "Learners cannot edit marketplace agents" is
--   therefore enforced by the database rather than by hiding
--   buttons, which is the only version of that rule worth
--   having.
--
-- USING is deliberately untouched, and the consequences are
-- both wanted:
--
--   SELECT — learners read their purchased agents normally.
--   DELETE — learners may remove one. The agent_unlocks row
--   survives the delete, so the entitlement is the unlock and
--   not the agent row, and re-adding a deleted flagship costs
--   nothing.
--
-- agent_knowledge is left alone on purpose. Study Tutor's whole
-- onboarding asks the learner to upload their own notes, so a
-- purchased agent's knowledge has to stay writable. It is the
-- CONFIGURATION that is fixed, not the material.
-- ---------------------------------------------------------

drop policy if exists agents_owner_all on public.agents;

create policy agents_owner_all
  on public.agents
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and is_official = false);

-- ---------------------------------------------------------
-- UNLOCKS
--
-- The entitlement, and the receipt.
--
-- Separate from the agent row because they answer different
-- questions and have different lifetimes. The agent row is an
-- instance a learner can delete; this is the fact that they
-- paid, which must outlive it.
--
-- `xp_cost` is recorded rather than looked up later, because
-- prices change and a receipt that reprices itself is not a
-- receipt.
-- ---------------------------------------------------------

create table if not exists public.agent_unlocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,

  -- Matches an id in src/features/agents/flagships.ts. Not a
  -- foreign key, because the catalogue is not a table — see the
  -- header. An id that no longer exists in the catalogue reads
  -- as an unlock for an agent NeuroLink has retired, which is
  -- the honest rendering of that situation.
  flagship_id text not null,
  xp_cost     integer not null,

  unlocked_at timestamptz not null default now(),

  -- Buy once. The purchase function relies on this rather than
  -- on a check-then-insert, which would have a gap in it.
  unique (user_id, flagship_id),

  constraint agent_unlocks_cost_non_negative check (xp_cost >= 0)
);

create index if not exists agent_unlocks_user_idx
  on public.agent_unlocks (user_id, unlocked_at desc);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-READ only, the same posture user_credits, ai_usage and
-- agent_deployments take, and for the same reason: a row here
-- is worth up to 200 XP, so a browser that could write one
-- could mint entitlements. Every write goes through
-- purchase_flagship, called by Express after it has verified a
-- bearer token and read the price from the catalogue rather
-- than from the request.
--
-- The learner may read their own, because the Library has to
-- show what they already own.
-- ---------------------------------------------------------

alter table public.agent_unlocks enable row level security;

drop policy if exists agent_unlocks_owner_all  on public.agent_unlocks;
drop policy if exists agent_unlocks_owner_read on public.agent_unlocks;

create policy agent_unlocks_owner_read
  on public.agent_unlocks
  for select
  using (auth.uid() = user_id);

revoke all on public.agent_unlocks from anon;

-- ---------------------------------------------------------
-- PURCHASE
--
-- Debit and entitle, atomically.
--
-- The row lock is taken FIRST and serialises the whole function
-- per learner, which is what makes the rest of it readable: no
-- branch below has to worry about a second purchase running
-- alongside it. Without the lock, two clicks a millisecond
-- apart both pass the affordability test and both debit, and
-- only one gets the unlock — the learner pays twice for one
-- agent.
--
-- `p_cost` comes from the catalogue on the server, never from a
-- request body. Nothing here validates it because nothing here
-- can: the price of 'writing-coach' is not a fact this database
-- knows. The route is what must not let a caller name their own
-- price, and it does not.
--
-- Already owning it is a SUCCESS, not an error. A learner who
-- double-clicks, or who deleted the agent row and is adding it
-- back, should get their agent — not a failure about a thing
-- they already paid for.
-- ---------------------------------------------------------

/* Dropped first for the reason 0014 documents at length beside
   grant_credits: CREATE OR REPLACE cannot change the row type
   an existing function returns, so a later change to these four
   OUT columns would fail with 42P13 on a re-run. Nothing
   depends on this function existing before this migration. */
drop function if exists public.purchase_flagship(uuid, text, integer);

create or replace function public.purchase_flagship(
  p_user_id     uuid,
  p_flagship_id text,
  p_cost        integer
)
returns table (
  ok            boolean,
  already_owned boolean,
  balance       integer,
  cost          integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  safe_cost integer := greatest(0, coalesce(p_cost, 0));
  wallet    public.user_credits;
begin
  insert into public.user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  /* Serialises every purchase this learner makes. */
  select * into wallet
    from public.user_credits as uc
   where uc.user_id = p_user_id
   for update;

  if exists (
    select 1 from public.agent_unlocks as au
     where au.user_id = p_user_id
       and au.flagship_id = p_flagship_id
  ) then
    ok            := true;
    already_owned := true;
    balance       := wallet.balance;
    cost          := 0;
    return next;
    return;
  end if;

  if wallet.balance < safe_cost then
    ok            := false;
    already_owned := false;
    balance       := wallet.balance;
    cost          := safe_cost;
    return next;
    return;
  end if;

  update public.user_credits as uc
     set balance    = uc.balance - safe_cost,
         updated_at = now()
   where uc.user_id = p_user_id
  returning * into wallet;

  insert into public.agent_unlocks (user_id, flagship_id, xp_cost)
  values (p_user_id, p_flagship_id, safe_cost);

  /* A purchase is a SPEND. lifetime_earned is untouched, so
     buying a 200 XP agent never costs somebody a level they
     earned — the invariant 0014 is built around. */

  ok            := true;
  already_owned := false;
  balance       := wallet.balance;
  cost          := safe_cost;
  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as every SECURITY DEFINER function in this
-- schema since 0002: it takes the target user id as an argument
-- and bypasses RLS by construction. Granted to `authenticated`,
-- it would hand out marketplace agents for a cost the caller
-- chose.
-- ---------------------------------------------------------

revoke all on function public.purchase_flagship(uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.purchase_flagship(uuid, text, integer)
  to service_role;
