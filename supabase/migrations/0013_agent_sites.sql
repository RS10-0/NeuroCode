-- =========================================================
-- NEUROLINK — PUBLISHED AGENT PAGES
--
-- Phase 2.7. A deployed agent gets an address on NeuroLink's
-- own domain — neurolink.com/studybuddy — that anybody can
-- open, read, and talk to without an account.
--
-- One table and one widened constraint. What this migration
-- deliberately does NOT add is, once again, a second runtime: a
-- visitor's question is the same `runChat` call the Lab, the
-- Builder and the deployment endpoint make, on behalf of the
-- agent's owner, with a body composed from stored rows rather
-- than from anything the visitor sent.
--
-- The one genuinely new thing here is the ABSENCE of a
-- credential. Every other path into that runtime authenticates:
-- a Supabase JWT for the browser, a deployment key for the API.
-- A public page cannot, because requiring one would mean
-- requiring an account of every visitor, which is the entire
-- feature. So the protections move: the page is addressed by an
-- unguessable-to-nobody slug that grants nothing, the request
-- body cannot name a single configuration field, the owner's
-- own quota still applies because the owner still pays, and a
-- per-site ceiling stops one shared link from spending an
-- afternoon's allowance before its owner notices.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- SITES
--
-- Keyed on the DEPLOYMENT rather than on the agent, and the
-- choice carries a safety property worth stating.
--
-- A page is a door onto a deployment. Deleting the deployment
-- therefore takes the page with it, by cascade, with no code
-- involved — so "I undeployed my agent" cannot leave a public
-- URL still answering. Keying on the agent instead would have
-- left the page pointing at an endpoint that no longer exists,
-- and the cleanup would have been somebody's job to remember.
--
-- `config` is a jsonb document validated in TypeScript before
-- it ever reaches here, by the same `parseSiteConfig` the
-- editor's form obeys — see src/features/sites/schema.ts. There
-- is deliberately no CHECK constraint mirroring that schema:
-- two definitions of a closed vocabulary is two definitions to
-- keep in step, and the one in TypeScript is the one both the
-- browser and the server already share.
--
-- What the column is guaranteed to hold is TEXT, never markup.
-- Nothing that renders it interpolates HTML.
-- ---------------------------------------------------------

create table if not exists public.agent_sites (
  id            uuid primary key default gen_random_uuid(),

  deployment_id uuid not null
                references public.agent_deployments (id) on delete cascade,
  agent_id      uuid not null,
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- The address. Lowercase, enforced below rather than merely
  -- expected, so a row written by hand in the SQL editor cannot
  -- create a page that the router can reach at one casing and
  -- the store can only find at another.
  slug          text not null,

  config        jsonb not null default '{}'::jsonb,

  -- Unpublishing without deleting. A student who wants their
  -- page down for a week should not have to give up their
  -- address to do it — and should not have to rebuild the page
  -- to put it back.
  published     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One page per deployment. Same reasoning as the one
  -- deployment per agent in 0006: "publish" is one button with
  -- one answer, and a second address for the same agent is a
  -- thing nobody asked for that every screen would then have to
  -- explain.
  unique (deployment_id),

  -- The composite key agent_knowledge and agent_deployments
  -- both carry, for the same reason: it makes "a page for
  -- somebody else's agent" unrepresentable rather than merely
  -- unreachable.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  constraint agent_sites_slug_lowercase
    check (slug = lower(slug)),

  -- The shape rule, in the one place that cannot be bypassed.
  --
  -- src/features/sites/slug.ts is the authority on what a slug
  -- may be, and it knows things this cannot — the reserved word
  -- list, chiefly. This is the floor beneath it: 3 to 32
  -- characters, lowercase alphanumerics and single interior
  -- hyphens, at least one letter. A slug that would break the
  -- router cannot reach the table even if it arrives from
  -- somewhere that skipped the TypeScript.
  constraint agent_sites_slug_shape
    check (
      length(slug) between 3 and 32
      and slug ~ '^[a-z0-9]([a-z0-9]|-[a-z0-9])*$'
      and slug ~ '[a-z]'
    )
);

-- The lookup every published page performs, and the constraint
-- that makes two students unable to hold one address.
create unique index if not exists agent_sites_slug_key
  on public.agent_sites (slug);

create index if not exists agent_sites_user_idx
  on public.agent_sites (user_id, created_at desc);

-- ---------------------------------------------------------
-- USAGE ATTRIBUTION
--
-- 'agent_site' rather than reusing 'agent_public'.
--
-- Both are the owner's spend on somebody else's question, and
-- both resolve through the same deployment row — so they share
-- `deployment_id` and share the deployment's rolling windows.
-- What separates them is who was asking and what it means: an
-- 'agent_public' row is an application the owner wired up on
-- purpose, and an 'agent_site' row is a stranger who followed a
-- link. An owner looking at a bill needs to be able to tell
-- those apart, and a single feature value would have made that
-- permanently impossible.
--
-- 'site_edit' is the second value this migration adds, and it
-- is the opposite side of the same page: an 'agent_site' row is
-- a visitor spending the owner's allowance, and a 'site_edit'
-- row is the OWNER spending their own while building — one
-- small call that turns "make the background darker" into a
-- field change. An owner asking what their page costs them
-- means the first and not the second, which is why they are not
-- one value.
--
-- This is the sixth widening of this constraint. See 0007,
-- 0008, 0009 and 0010 for the previous ones — the pattern is
-- deliberate: one capability, one feature value, one migration
-- line.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis', 'agent_memory',
    'agent_site', 'site_edit'
  ));

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Owner-READ only, the same posture agent_deployments has in
-- 0006 and for the same reason: writing a row here has to
-- validate a slug against a reserved list, resolve a collision,
-- and validate a config document, and a browser insert would do
-- none of those. Writes go through Express with the service
-- role.
--
-- Note what is NOT here: no anon policy. A visitor never reads
-- this table directly. The public page is served by Express,
-- which resolves the slug, checks `published`, checks that the
-- deployment still exists and that the agent is still `ready`,
-- and returns a narrow shape carrying no ids. Granting `anon` a
-- select on this table would have published `user_id`,
-- `agent_id` and `deployment_id` to the world alongside the
-- page — which is exactly the leak the deployment work took
-- care to avoid.
-- ---------------------------------------------------------

alter table public.agent_sites enable row level security;

drop policy if exists agent_sites_owner_all  on public.agent_sites;
drop policy if exists agent_sites_owner_read on public.agent_sites;

create policy agent_sites_owner_read
  on public.agent_sites
  for select
  using (auth.uid() = user_id);

revoke all on public.agent_sites from anon;

-- ---------------------------------------------------------
-- SITE USAGE
--
-- What the Customise screen shows its owner: how much the
-- public page specifically is costing, as distinct from the
-- API traffic that shares its deployment.
--
-- Narrower than agent_deployment_usage on purpose — it filters
-- to feature = 'agent_site', which is the whole reason the
-- previous section bothered to add that value.
-- ---------------------------------------------------------

drop function if exists public.agent_site_usage(uuid);

create or replace function public.agent_site_usage(
  p_deployment_id uuid
)
returns table (
  visits_day      integer,
  requests_day    integer,
  requests_total  integer,
  tokens_day      bigint,
  last_visit_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  select count(*)::integer,
         coalesce(sum(au.input_tokens + au.output_tokens), 0)::bigint
    into requests_day, tokens_day
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.feature       = 'agent_site'
     and au.created_at    > now() - interval '24 hours';

  select count(*)::integer, max(au.created_at)
    into requests_total, last_visit_at
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.feature       = 'agent_site';

  /* Distinct conversations rather than distinct people. The
     memory scope is a per-browser key and is hashed before it
     is stored, so this is as close to "how many visitors" as
     this schema can honestly get — and it is deliberately not
     closer. */
  select count(distinct au.quota_key)::integer
    into visits_day
    from public.ai_usage au
   where au.deployment_id = p_deployment_id
     and au.feature       = 'agent_site'
     and au.created_at    > now() - interval '24 hours';

  return next;
end;
$fn$;

-- ---------------------------------------------------------
-- EXECUTE PRIVILEGES
--
-- Same reasoning as every SECURITY DEFINER function in this
-- schema since 0002: it takes an id as an argument and
-- therefore bypasses RLS by construction, so `authenticated`
-- must not be able to call it.
-- ---------------------------------------------------------

revoke all on function public.agent_site_usage(uuid)
  from public, anon, authenticated;

grant execute on function public.agent_site_usage(uuid)
  to service_role;
