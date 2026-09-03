-- =========================================================
-- NEUROLINK — THE BROWSER EXTENSION
--
-- Phase 4. A fourth door into an agent: a side panel that
-- works on any site, in which the owner chats with one of
-- their own agents, and that agent can optionally be handed
-- the page in front of them.
--
-- Four tables' worth of change, and every one of them exists
-- to answer a question the three existing doors already
-- answered differently:
--
--   WHO IS CALLING — extension_sessions. Not a Supabase
--   session, because a session in extension storage is the
--   account; not a deployment key, because the caller is the
--   owner rather than a stranger's application.
--
--   WHICH AGENTS ARE REACHABLE — agent_extension_settings.
--   Off by default, per agent, chosen by the owner.
--
--   MAY THIS ACCOUNT BE READ FROM AT ALL — user_account_scope.
--   The one table here that is not about agents.
--
--   WHAT SHAPED THIS DRAFT — four columns on
--   agent_email_drafts, so a reply that a web page influenced
--   shows what influenced it before anybody sends it.
--
-- AND THERE IS A WIDENING IN THIS FILE, unlike 0018.
--
-- 0018 declined to widen ai_usage_feature_check and said why:
-- every widening from 0007 to 0017 added a new CALLER, and
-- document generation and the data store added TOOLS, which
-- 'agent_action' already covered. This one is a new caller by
-- exactly that test — a new reason this server spends
-- somebody's allowance — so 'agent_extension' goes on the
-- constraint, the ninth time that list has grown.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO, for the ninth
-- time: add a second runtime. The extension reaches the same
-- runChat, through the same quota gate, into the same ledger.
-- What it declares is a request shape, not an execution path.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- THE NINTH WIDENING
--
-- 'agent_extension' priced at agent_test parity in
-- server/src/credits/costs.ts, and for the reason 0017 gave
-- agent_scheduled parity: it is the same composed prompt,
-- the same knowledge, the same tools, through the same
-- runChat. The only difference is where the person was
-- standing when they asked.
--
-- Charging less would make the extension the cheap door,
-- which is the one thing a fourth door must not be.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis', 'agent_memory',
    'agent_site', 'site_edit', 'agent_action', 'agent_scheduled',
    'agent_extension'
  ));

-- ---------------------------------------------------------
-- WHICH AGENTS THE EXTENSION MAY SEE
--
-- A TABLE RATHER THAN TWO COLUMNS ON `agents`, AND THE REASON
-- IS MIGRATION 0015.
--
-- The obvious implementation is `extension_enabled` and
-- `extension_page_context` on the agents row. It does not
-- work, and the way it fails is silent until a learner hits
-- it.
--
-- 0015 tightened the agents policy to
--
--   with check (auth.uid() = user_id and is_official = false)
--
-- so that a purchased Library agent cannot be written by its
-- owner AT ALL — which is what makes "learners cannot edit
-- marketplace agents" a database rule rather than a hidden
-- button, and what lets AgentStore resolve an official
-- agent's prompt and capabilities from the catalogue on every
-- read.
--
-- The consequence for a column here: a learner who spent 100
-- XP on Study Tutor could never switch the extension on for
-- it. The UPDATE would be refused by RLS, correctly, for a
-- rule that has nothing to do with extensions.
--
-- Putting the flag in the flagship catalogue instead would
-- make it a platform-wide decision rather than the owner's,
-- which is the opposite of "off by default, the owner turns
-- it on". And a service-role endpoint just for this column
-- would re-open the write path 0015 closed.
--
-- So the setting lives beside the agent rather than on it.
-- The policy below carries no is_official clause because this
-- table holds the OWNER'S choice about their own client, not
-- the agent's definition — and that distinction is the whole
-- reason the table exists.
--
-- A row that does not exist means NOT ENABLED. Default-off is
-- by absence, which is stronger than a column default: there
-- is no value to have been written wrongly.
-- ---------------------------------------------------------

create table if not exists public.agent_extension_settings (
  agent_id               uuid primary key,

  user_id                uuid not null
                         references auth.users (id) on delete cascade,

  -- This agent appears in the side panel's list.
  extension_enabled      boolean not null default false,

  -- This agent may be handed the page. Separate from the
  -- switch above, and the split is the same argument vocab.ts
  -- makes for keeping email_draft apart from email_send: an
  -- owner who wants the smaller grant should not have to make
  -- the larger one.
  --
  -- An agent you want in the side panel for quick questions
  -- while you work is not necessarily an agent you want
  -- reading whatever is on your screen.
  extension_page_context boolean not null default false,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- The impossible state, refused rather than merely avoided
  -- by the UI. Page context without the extension enabled is
  -- a row that says the agent may read pages it can never be
  -- asked about, and a row written by hand or by an older
  -- build must not be able to claim it.
  constraint agent_extension_settings_context_needs_enabled
    check (extension_enabled or not extension_page_context),

  -- The composite key agent_knowledge, agent_connections,
  -- agent_documents and agent_email_drafts all carry, for the
  -- same reason: it makes "extension settings on somebody
  -- else's agent" unrepresentable rather than merely
  -- unreachable.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade
);

-- The panel's list query, and the only query this table has.
-- Partial, because a row with the switch off is a row nothing
-- ever looks for.
create index if not exists agent_extension_settings_enabled_idx
  on public.agent_extension_settings (user_id)
  where extension_enabled;

-- ---------------------------------------------------------
-- WHO IS CALLING
--
-- The credential the extension presents, and the reason it is
-- not a Supabase session.
--
-- A Supabase session in extension storage would carry the
-- REFRESH token, which is the user's primary credential and
-- tradeable for a fresh session indefinitely. It would also
-- be accepted by every route on this server, because
-- getAuthenticatedUser cannot tell one caller from another —
-- so the extension would silently gain the ability to read
-- email, mint deployment keys and list connections. That is
-- not an oversharing problem, it is the door model
-- collapsing.
--
-- So the extension gets its own credential, on the pattern
-- 0006 established for deployment keys and for the same
-- reasons:
--
--   A KEY GOES IN AND ONLY DERIVED FACTS COME BACK OUT. The
--   plaintext exists for exactly as long as the response that
--   carries it. token_hash and token_prefix are absent from
--   every column list outside verification.
--
--   PREFIX IDENTIFIES, HASH AUTHENTICATES. Verifying a
--   presented token is one indexed select rather than a scan
--   that hashes every row.
--
-- What is different from a deployment key, and it is the
-- reason this is a separate table rather than a row in
-- agent_deployment_keys: a deployment key belongs to ONE
-- AGENT and is held by a stranger's application. This belongs
-- to a PERSON and is held by that person's own browser. It
-- names no agent at all — which agents it can reach is the
-- table above, read fresh on every turn, so revoking an
-- agent's eligibility takes effect without touching any
-- token.
-- ---------------------------------------------------------

create table if not exists public.extension_sessions (
  id            uuid primary key default gen_random_uuid(),

  user_id       uuid not null
                references auth.users (id) on delete cascade,

  -- Stored in the clear and uniquely indexed. It identifies a
  -- token; it does not authenticate one.
  token_prefix  text not null unique,

  -- sha256 of the WHOLE token, not just the secret half. It
  -- costs nothing and it means a row whose prefix has been
  -- altered in the database no longer matches the token it was
  -- issued for — so tampering breaks authentication rather
  -- than silently redirecting it.
  token_hash    text not null,

  -- All the UI ever shows of the token.
  last4         text not null,

  -- "Chrome on the school laptop". Written by the pairing page
  -- from the user agent, editable afterwards, and NOT NULL so
  -- that the partial unique index below actually constrains —
  -- nulls are distinct in Postgres, so a nullable label would
  -- make re-pairing accumulate rows instead of replacing them.
  label         text not null default 'This browser',

  created_at    timestamptz not null default now(),

  -- Bumped on every successful call. This is what makes the
  -- lifetime sliding rather than fixed: a token in daily use
  -- never expires, and one on a laptop nobody opened again
  -- stops verifying about a term later.
  last_used_at  timestamptz,

  revoked_at    timestamptz,

  -- 30 days from last use, enforced in SessionStore rather
  -- than by a sweep. A token that has expired but has not been
  -- swept must still fail, so expiry is checked on read — the
  -- same rule agent_documents follows.
  expires_at    timestamptz not null default (now() + interval '30 days')
);

-- Re-pairing a browser replaces rather than accumulates. The
-- application revokes the old row first; this index is what
-- makes that a guarantee instead of a habit.
create unique index if not exists extension_sessions_active_label_idx
  on public.extension_sessions (user_id, label)
  where revoked_at is null;

-- The paired-devices list.
create index if not exists extension_sessions_user_idx
  on public.extension_sessions (user_id, created_at desc);

-- ---------------------------------------------------------
-- MAY THIS ACCOUNT BE READ FROM
--
-- The only table in this migration that is not about agents,
-- and the one that needed a finding before it could be
-- written.
--
-- BuildGentic has users aged 10-13. Every capability shipped
-- so far operates on material a learner BROUGHT here: a
-- prompt they typed, a document they uploaded, an agent they
-- built. Page context is the first that inverts it — the
-- material is whatever a child happened to have open, which
-- for a student is schoolwork, a school portal, a messaging
-- app, a health search.
--
-- THE FINDING: THERE IS NO AGE OR CONSENT FIELD ANYWHERE IN
-- THIS SCHEMA. profiles holds id, username, created_at.
-- onboarding holds goal, experience and literacy. auth.users
-- holds an email and a username in its metadata. Sign-up
-- collects username, email, password. Nothing else.
--
-- AND THE OBVIOUS HOMES ARE WRONG. profiles and onboarding
-- both carry the ordinary owner-all policy —
--
--   using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- so the browser can write them. An `age` column there is a
-- number the learner sets from the console in one call. That
-- is self-attestation with extra steps, and the requirement
-- this table exists to meet is explicitly a real check rather
-- than a switch the user could flip.
--
-- So this follows 0019's shape instead, which is the strictest
-- in the project: owner SELECT and nothing else, plus an
-- explicit revoke. The owner may read their own scope — so the
-- UI can say WHY page context is unavailable rather than
-- showing an inert switch — and no browser can write it. Every
-- write is a service-role write.
--
-- THE COLUMN IS A DECISION, NOT A BIRTHDATE, and that is
-- deliberate three times over:
--
--   A date of birth is materially more sensitive than the
--   yes/no it would be used to compute, and holding one would
--   make this table worth attacking for something other than
--   what it does.
--
--   Age is not the whole question. A 15-year-old on a
--   school-managed account whose consent never mentioned
--   browsing capture is denied, and no arithmetic on a
--   birthday produces that.
--
--   A stored decision carries its own provenance, so "why is
--   this off" has an answer.
--
-- WHAT WRITES THIS TABLE IS NOT DECIDED HERE, deliberately —
-- a sign-up age gate, a roster import, a parental-consent
-- flow. It is an account-model question, not an extension
-- question, and this table is the seam it lands behind.
--
-- THE CONSEQUENCE, STATED SO IT IS NOT DISCOVERED: every
-- existing account has no row, every missing row reads
-- 'unknown', and 'unknown' denies. So page context ships DARK
-- for everybody until something establishes scope. There is no
-- honest backfill — inferring 13+ from an empty column is the
-- self-attestation this table exists to refuse. The extension
-- itself, and agent-only chat, work for everyone on day one.
-- ---------------------------------------------------------

create table if not exists public.user_account_scope (
  user_id            uuid primary key
                     references auth.users (id) on delete cascade,

  -- Tri-state on purpose. 'denied' is a decision that was
  -- made; 'unknown' is the absence of one, and they should not
  -- collapse into a single false — an account nobody has
  -- assessed and an account assessed as under-13 need
  -- different things said to them on screen, and one of them
  -- is fixable.
  --
  -- Both refuse. The default on the column exists only so
  -- that a service-role insert which omits it cannot
  -- accidentally grant.
  page_context_scope text not null default 'unknown'
                     check (page_context_scope in
                            ('allowed', 'denied', 'unknown')),

  -- Where the decision came from. Free text against a
  -- documented vocabulary rather than a CHECK, because the
  -- writers do not exist yet and a constraint naming values
  -- nothing writes is a constraint that will be wrong first.
  --   'signup_age_gate' | 'roster_import'
  --   | 'parental_consent' | 'admin'
  source             text,

  decided_at         timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------
-- WHAT SHAPED THIS DRAFT
--
-- Four columns on the drafts table, and the reason they are
-- on THAT table rather than anywhere else is the reason they
-- exist at all.
--
-- A drafted reply is the one place where page context stops
-- being a private turn and becomes something that leaves the
-- building. Everywhere else the worst a hostile page achieves
-- is a bad answer on the learner's own screen. Here it could
-- shape a message that goes to a person.
--
-- email_send's whole design rests on one sentence in
-- capabilities.ts: every send is you, pressing a button, on a
-- message you have read. Page context quietly weakens that,
-- because a learner reading a draft sees the words and not
-- what produced them — and a draft that reads perfectly
-- reasonably may have been shaped by a paragraph its author
-- wrote specifically to shape it.
--
-- So the send-confirmation view shows the captured text, not
-- merely the URL it came from. "Show the URL" is the cheap
-- version and it is not enough: an injected instruction lives
-- in the TEXT, and a learner told only that example.com was
-- used has been told nothing they can act on.
--
-- THIS IS A DELIBERATE EXCEPTION TO THE NO-RETENTION RULE,
-- and it is the right one. Showing provenance only while the
-- panel stays open would mean the guarantee evaporates in the
-- gap between drafting and sending, which is exactly the gap
-- it exists to cover. A draft is already durable text about
-- the learner's correspondence; attaching what produced it
-- does not change the kind of data held.
--
-- And it needs no retention path of its own. These are
-- columns on a row sweep_email_drafts already deletes, so
-- provenance dies with the draft it describes, in the same
-- statement, and cannot outlive it.
--
-- Nullable rather than defaulted, all four: "this draft had
-- no page context" and "this draft had empty page context"
-- are different facts and must not collapse.
-- ---------------------------------------------------------

alter table public.agent_email_drafts
  -- Origin and path only. The query string is stripped before
  -- this is written, and it is stripped in the capture rather
  -- than here: query strings routinely carry session tokens,
  -- reset nonces, email addresses and search terms, and none
  -- of that should reach a prompt, let alone a stored row.
  add column if not exists source_page_url     text,

  add column if not exists source_page_title   text,

  -- The captured text as it was sent to the model, after the
  -- same flattening the prompt path applies — no control
  -- characters, no bidirectional overrides, bounded length.
  -- Stored flattened rather than raw so that the view which
  -- renders it cannot become a second place where a hostile
  -- page gets to draw.
  add column if not exists source_page_text    text,

  add column if not exists source_capture_mode text;

alter table public.agent_email_drafts
  drop constraint if exists agent_email_drafts_capture_mode_check;

alter table public.agent_email_drafts
  add constraint agent_email_drafts_capture_mode_check
  check (source_capture_mode is null
         or source_capture_mode in ('selection', 'page'));

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Three tables, three different postures, and the differences
-- are the argument rather than an inconsistency.
--
--   agent_extension_settings — OWNER ALL. It is the owner's
--   own choice about their own client, written from the
--   Deploy screen the way an agent is written from the
--   Builder. No is_official clause, which is the entire
--   reason this is a table (see above).
--
--   extension_sessions — OWNER SELECT AND UPDATE-TO-REVOKE.
--   The owner must see their paired browsers and must be able
--   to revoke one. They must NOT be able to insert: a browser
--   that could write this table could mint itself a token.
--   Minting is service-role only.
--
--   user_account_scope — OWNER SELECT ONLY. The strictest,
--   for the reason above: a scope the learner can write is
--   not a check.
--
-- The service role bypasses all of this, which is why every
-- query in the stores behind these tables carries an explicit
-- .eq("user_id", ...). That predicate, not RLS, is what stands
-- between one learner and another's — the rule CredentialStore
-- stated and every store since has followed.
-- ---------------------------------------------------------

alter table public.agent_extension_settings enable row level security;
alter table public.extension_sessions       enable row level security;
alter table public.user_account_scope       enable row level security;

drop policy if exists agent_extension_settings_owner_all
  on public.agent_extension_settings;

create policy agent_extension_settings_owner_all
  on public.agent_extension_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists extension_sessions_owner_read
  on public.extension_sessions;

create policy extension_sessions_owner_read
  on public.extension_sessions
  for select
  using (auth.uid() = user_id);

/*
 * Revoking is an UPDATE the owner must be able to make, and
 * it is the only one. The WITH CHECK cannot express "you may
 * set revoked_at and nothing else" — Postgres policies gate
 * rows, not columns — so the column grant below does that
 * half, and this policy does the row half.
 */
drop policy if exists extension_sessions_owner_revoke
  on public.extension_sessions;

create policy extension_sessions_owner_revoke
  on public.extension_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_account_scope_owner_read
  on public.user_account_scope;

create policy user_account_scope_owner_read
  on public.user_account_scope
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- GRANTS
--
-- The policies above decide WHICH ROWS. These decide WHICH
-- COLUMNS AND WHICH VERBS, and for two of these tables the
-- column half is doing work a policy cannot do.
--
-- anon reaches none of this. Nothing here is a published-page
-- concern, and a visitor who followed a link has no business
-- knowing that an extension exists.
-- ---------------------------------------------------------

revoke all on public.agent_extension_settings from anon, authenticated;
revoke all on public.extension_sessions       from anon, authenticated;
revoke all on public.user_account_scope       from anon, authenticated;

grant select, insert, update, delete
  on public.agent_extension_settings to authenticated;

/*
 * SELECT is deliberately column-scoped, and this is the line
 * that keeps the token secret from its own owner's browser.
 *
 * A policy cannot say "every row of yours, but not these two
 * columns". A grant can. So the browser can list its paired
 * devices — label, last four, when it was used — and cannot
 * read token_hash or token_prefix from any row, including its
 * own. That matches DeploymentStore's SAFE_COLUMNS, enforced
 * one layer lower down where a forgotten column list cannot
 * defeat it.
 *
 * UPDATE is scoped to revoked_at alone, so the one write the
 * owner needs is the only write they have. Nobody can extend
 * their own expiry, relabel a token to collide with another,
 * or swap a hash.
 */
grant select (id, user_id, last4, label, created_at, last_used_at,
              revoked_at, expires_at)
  on public.extension_sessions to authenticated;

grant update (revoked_at)
  on public.extension_sessions to authenticated;

/* Read-only, and every column of it is safe to read: it holds
   a decision about the reader. Insert and update are absent
   rather than restricted, which is the point. */
grant select on public.user_account_scope to authenticated;
