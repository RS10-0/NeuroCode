-- =========================================================
-- BUILDGENTIC — THE AGE GATE AND PARENTAL CONSENT
--
-- WHY. BuildGentic has learners under 13, and the privacy
-- policy has promised since 0020 that their accounts are
-- treated differently. Until now nothing asked anybody's age,
-- so that promise had nothing underneath it. This is the
-- underneath: an age band recorded once per account, and, for
-- an account under 13, a parent's agreement obtained by email
-- before the account does anything at all.
--
-- WHAT IS STORED, AND WHAT IS NOT.
--
--   An age BAND, never a birthdate. 0020 argued this for the
--   page-capture decision and the argument carries over
--   whole: the band is all any decision here needs, and a date
--   of birth would make this table worth stealing for its own
--   sake. The browser turns month and year into a band and
--   sends only the band.
--
--   A parent's email, which COPPA expects us to hold so the
--   parent can be reached — to ask, to confirm, and to be told
--   how to withdraw.
--
--   Hashes of the two tokens a parent's emails carry, never the
--   tokens themselves — the shape agent_deployments and
--   extension_sessions already use. A dump of this table cannot
--   approve or delete anybody's child.
--
-- WHO WRITES IT. The server, with the service role, and nobody
-- else. Both tables are revoked from anon and authenticated.
-- An age band a learner could write from the console would be
-- self-attestation with extra steps, which is the thing 0020's
-- comment on user_account_scope says this table exists to
-- refuse.
--
-- ---------------------------------------------------------
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT NEEDS IT.
--
-- The new server reads age_band on every authenticated request
-- (cached). Against a database without it, every read errors,
-- the gate fails OPEN by design so learners are not locked out,
-- and the age question can never be saved — so the gate is
-- silently absent. The startup banner names 0024 as missing in
-- that case. The old server ignores the new columns and table
-- entirely, so applying this first is safe.
--
-- Safe to re-run: every statement is IF NOT EXISTS, OR REPLACE,
-- or a drop-then-create.
-- =========================================================

-- ---------------------------------------------------------
-- 1. THE ACCOUNT'S AGE BAND AND CONSENT STATE
--
-- On user_account_scope, beside page_context_scope, because it
-- is the same kind of fact — a decision about the account,
-- readable by its owner, writable only by the server — and the
-- age band is now what page_context_scope is derived from.
--
-- Both nullable. A null age_band is an account that has not
-- answered yet, which is every account that existed before
-- this migration, and the app asks them once.
--
-- consent_status:
--   not_required — 13 or over
--   pending      — under 13, waiting for a parent
--   granted      — under 13, a parent agreed
-- There is no 'declined' or 'revoked' here: both delete the
-- account, so no row survives to carry them. The consent row
-- below keeps that history only until the cascade takes it.
-- ---------------------------------------------------------

alter table public.user_account_scope
  add column if not exists age_band text;

alter table public.user_account_scope
  add column if not exists consent_status text;

alter table public.user_account_scope
  drop constraint if exists user_account_scope_age_band_check;

alter table public.user_account_scope
  add constraint user_account_scope_age_band_check
  check (age_band is null or age_band in ('under_13', '13_17', '18_plus'));

alter table public.user_account_scope
  drop constraint if exists user_account_scope_consent_status_check;

alter table public.user_account_scope
  add constraint user_account_scope_consent_status_check
  check (consent_status is null
         or consent_status in ('not_required', 'pending', 'granted'));

comment on column public.user_account_scope.age_band is
  'Age band the learner gave once at sign-up or first sign-in. '
  'Never a birthdate. Null means not yet answered.';

comment on column public.user_account_scope.consent_status is
  'not_required for 13+; pending/granted for under-13 accounts '
  'waiting for, or holding, a parent''s email consent.';

-- ---------------------------------------------------------
-- 2. PARENTAL CONSENTS
--
-- One row per request. A learner who changes the parent's
-- address replaces the pending row rather than adding another
-- — the server deletes the old one first — so at most one
-- request is ever live, and an old email's link stops working
-- the moment it is superseded.
--
-- emails_sent and last_sent_at back the resend limit. Without
-- one, the "parent's email" field is a form anyone with an
-- account can use to send our mail to a stranger as often as
-- they like.
-- ---------------------------------------------------------

create table if not exists public.parental_consents (
  id                  uuid primary key default gen_random_uuid(),

  user_id             uuid not null
                      references auth.users (id) on delete cascade,

  parent_email        text not null,

  consent_token_hash  text not null unique,
  revoke_token_hash   text unique,

  status              text not null default 'pending'
                      check (status in ('pending', 'granted', 'declined', 'revoked')),

  -- Typed by the parent on approval. Their signature, in the
  -- sense the consent record needs one.
  parent_name         text,

  requested_at        timestamptz not null default now(),
  expires_at          timestamptz not null,
  decided_at          timestamptz,

  emails_sent         integer not null default 1,
  last_sent_at        timestamptz not null default now()
);

create index if not exists parental_consents_user_idx
  on public.parental_consents (user_id);

-- The sweep reads exactly this: pending rows past their expiry.
create index if not exists parental_consents_pending_expiry_idx
  on public.parental_consents (expires_at)
  where status = 'pending';

-- ---------------------------------------------------------
-- 3. NOBODY BUT THE SERVER
--
-- RLS on with no policies, and an explicit revoke on top, which
-- is the posture user_account_scope's writes already have. The
-- parent's page reaches this through Express with a token, not
-- through PostgREST, so anon needs nothing here.
-- ---------------------------------------------------------

alter table public.parental_consents enable row level security;

revoke all on public.parental_consents from anon, authenticated;
