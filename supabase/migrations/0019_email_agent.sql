-- =========================================================
-- NEUROLINK — THE EMAIL AGENT
--
-- The first capability where BuildGentic holds a key to
-- somebody's PRIVATE CORRESPONDENCE, and the schema is shaped
-- around that sentence rather than around what would have been
-- convenient.
--
-- Three tables. Everything else this capability needs already
-- exists: the tools are entries in the catalogue 0016 built,
-- the quota is the one 0016 opened, the store is 0018's, the
-- documents are 0018's, and the schedule is 0017's.
--
-- WHY THIS IS NOT agent_connections.
--
-- 0016 added a saved credential an agent may present, and the
-- obvious move was to make a mailbox one more row in it. It
-- does not fit, for two independent reasons and either alone
-- would be enough.
--
-- A connection holds a STATIC secret. There is no expiry, no
-- refresh token, no exchange and no callback, and OAuth needs
-- all four — a mailbox credential that cannot be refreshed is
-- one that stops working an hour after it is granted.
--
-- And a connection is written through `requireEditableAgent`,
-- which refuses an official agent. The Email Agent IS an
-- official agent. A flagship literally cannot be given a
-- connection, so the table that holds mailboxes cannot be the
-- table that refuses to hold theirs.
--
-- WHY THE ACCOUNT IS SCOPED TO THE USER AND NOT THE AGENT.
--
-- Every other credential in this schema hangs off an agent, and
-- deliberately: agent_connections, agent_knowledge, agent_memories
-- and agent_data are all `User -> Agent -> X`, so one of a
-- learner's agents cannot read another's.
--
-- A mailbox is not like that. It is the PERSON'S, they have
-- one, and asking somebody to authorise Google separately for
-- each agent they build would be asking them to hand out more
-- grants rather than fewer. So this table is `User -> Account`,
-- and the narrowing that agent scoping used to provide is done
-- by the capability flag instead: an agent reaches the mailbox
-- only when its own stored row carries the email capability,
-- and only on a door where the caller IS the owner.
--
-- That is a real widening of an existing boundary and it is
-- stated here rather than discovered later.
--
-- AND — AS IN 0018 — THERE IS NO ai_usage_feature_check
-- WIDENING IN THIS FILE.
--
-- Every widening from 0007 to 0017 added a new CALLER. This
-- migration adds TOOLS, and 'agent_action' already covers "the
-- tools an agent runs between the question and the answer" —
-- told apart by `model`, which carries 'tool:email_search'
-- where a model id would go, exactly as 'tool:run_code' does.
-- If you are skimming for the widening statement because most
-- of these files have one, this paragraph is why it is absent.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- CONNECTED MAILBOXES
--
-- One row per (person, provider, address).
--
-- THE TWO SEALED COLUMNS ARE THE REASON THIS FILE DESERVES A
-- CAREFUL READ.
--
-- Both are AES-256-GCM, sealed by the server, in the
-- v1.<iv>.<tag>.<ciphertext> format server/src/ai/crypto.ts
-- documents. The key that opens them lives in the server's
-- environment (NEUROLINK_SECRET_KEY) and never in this
-- database, which has the two consequences 0016 already
-- recorded: a backup restored without the matching key holds
-- rows whose tokens cannot be opened, and rotating that key
-- invalidates every row here at once. Both are the correct
-- failure. A mailbox whose token cannot be read is a mailbox
-- this server cannot reach, which is exactly what a lost key
-- should mean.
--
-- The refresh token is the long-lived one and the reason this
-- is not simply agent_connections with an extra column. It is
-- exchanged for a fresh access token whenever the stored one
-- has expired, which is the whole of what OAuth adds over a
-- static key.
-- ---------------------------------------------------------

create table if not exists public.user_email_accounts (
  id                uuid primary key default gen_random_uuid(),

  user_id           uuid not null references auth.users (id) on delete cascade,

  -- 'gmail' today. The column exists so that adding Outlook is
  -- a value rather than a migration — the same bet 0010's
  -- scope_key made and 0018 restated.
  provider          text not null,

  -- The address as the PROVIDER reports it, never as anybody
  -- typed it. It is shown to the owner so they can see which
  -- mailbox is connected, and it is what the agent is told it
  -- is reading. A self-declared address would be a claim.
  email_address     text not null,

  -- What Google actually granted, space-separated, as returned
  -- by the token endpoint. Stored rather than assumed because a
  -- user may decline individual scopes on the consent screen:
  -- an account that was asked for four and granted two must
  -- refuse the other two at the tool, with a message that says
  -- so, rather than calling the API and reporting a 403 as a
  -- BuildGentic fault.
  granted_scopes    text not null default '',

  -- ===================================================
  -- THE TOKENS
  -- ===================================================
  refresh_token     text not null,
  access_token      text,

  -- When the sealed access token stops working. Refreshed with
  -- a skew rather than on failure: a token that expires
  -- mid-turn costs the agent a step and the learner an action
  -- from their allowance, and the exchange is cheap.
  expires_at        timestamptz,

  -- Set when the person disconnects, or when Google reports the
  -- grant as revoked. The row is then deleted — this column
  -- exists for the window between deciding and finishing, so a
  -- revoke that fails at Google still stops this server using
  -- the token.
  revoked_at        timestamptz,

  connected_at      timestamptz not null default now(),
  last_used_at      timestamptz,
  updated_at        timestamptz not null default now(),

  -- One row per mailbox per person. Re-authorising the same
  -- address updates the tokens rather than accumulating rows
  -- whose refresh tokens quietly compete.
  unique (user_id, provider, email_address),

  constraint user_email_accounts_provider
    check (provider in ('gmail')),

  constraint user_email_accounts_address_shape
    check (length(email_address) between 3 and 320)
);

create index if not exists user_email_accounts_user_idx
  on public.user_email_accounts (user_id, connected_at);

-- ---------------------------------------------------------
-- DRAFTS
--
-- What the agent WROTE, waiting for a person to decide.
--
-- THIS TABLE IS THE SEND GATE, and it is worth saying plainly
-- what that means, because the alternative was available and
-- was not taken.
--
-- There is no email_send TOOL. The model cannot send. It can
-- write a row here, and that is the end of what a turn can do
-- about outbound mail — the send is an authenticated POST from
-- a browser after a person has read the draft and pressed a
-- button. So a prompt injection that fully controls what the
-- agent says produces a draft somebody still has to approve,
-- and a scheduled run at four in the morning cannot send
-- anything at all, because there is no tool for it to call.
--
-- `status` is what distinguishes DRAFTED from SENT, and every
-- surface reads this column rather than the agent's prose. An
-- agent that claims it sent a reply produces a row that still
-- says 'draft', contradicted by the tray next to its own
-- sentence — the same structural honesty 0018 gave documents.
-- ---------------------------------------------------------

create table if not exists public.agent_email_drafts (
  id                 uuid primary key default gen_random_uuid(),

  user_id            uuid not null references auth.users (id) on delete cascade,
  agent_id           uuid not null,

  -- Which mailbox it would go from. Nulled rather than cascaded
  -- when an account is disconnected, so the record of what was
  -- sent survives the disconnection — and an unsent draft
  -- becomes unsendable, which is correct.
  account_id         uuid references public.user_email_accounts (id) on delete set null,

  -- Set for a scheduled or manual run, null for a Test-panel
  -- turn. Same shape as agent_documents.run_id, and here it is
  -- evidence rather than plumbing: a draft written by an
  -- unattended run is one a person should look at harder.
  run_id             uuid,

  -- Recipients, as the model wrote them, validated for shape
  -- before the row is written and validated again before a send.
  to_addresses        text[] not null default '{}',
  cc_addresses        text[] not null default '{}',
  subject             text not null default '',
  body                text not null default '',

  -- What it is a reply to. Provider-opaque ids: this server
  -- does not parse them and must not construct them.
  reply_to_message_id text,
  thread_id           text,

  status              text not null default 'draft',

  -- Filled by the send, and only by the send. Their presence is
  -- the proof a message left; their absence with status 'sent'
  -- is a bug this schema makes visible rather than plausible.
  provider_message_id text,
  sent_at             timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Drafts expire. An approval queue is not an archive, and a
  -- month-old draft approved by somebody who has forgotten what
  -- it was about is the failure this column prevents.
  expires_at          timestamptz not null default (now() + interval '7 days'),

  -- The composite key agent_knowledge, agent_connections and
  -- agent_documents all carry, for the same reason: it makes
  -- "a draft on somebody else's agent" unrepresentable rather
  -- than merely unreachable.
  foreign key (agent_id, user_id)
    references public.agents (id, user_id) on delete cascade,

  -- 'sending' is a CLAIM, held for the second or two a provider
  -- call takes, and it is what stops a double-click sending the
  -- same reply twice. The compare-and-set that takes it has to
  -- happen BEFORE Gmail is reached: a guard applied afterwards
  -- would refuse only the second WRITE, long after both
  -- messages had left. A claim left behind by a crashed process
  -- is released by the person pressing Send again, which finds
  -- a row it can discard and rewrite rather than a message that
  -- silently went twice.
  constraint agent_email_drafts_status
    check (status in ('draft', 'sending', 'sent', 'discarded')),

  -- A sent row must carry its proof, and an unsent row must not
  -- carry one. Both halves matter: the first makes 'sent' mean
  -- something, the second stops a failed send leaving a row
  -- that looks delivered.
  constraint agent_email_drafts_sent_shape
    check (
      (status = 'sent' and provider_message_id is not null and sent_at is not null)
      or (status <> 'sent' and provider_message_id is null and sent_at is null)
    )
);

create index if not exists agent_email_drafts_agent_idx
  on public.agent_email_drafts (user_id, agent_id, created_at desc);

create index if not exists agent_email_drafts_run_idx
  on public.agent_email_drafts (run_id)
  where run_id is not null;

create index if not exists agent_email_drafts_expiry_idx
  on public.agent_email_drafts (expires_at)
  where status in ('draft', 'sending');

-- ---------------------------------------------------------
-- PENDING AUTHORISATIONS
--
-- The half-finished OAuth flow, for the ninety seconds between
-- sending somebody to Google and Google sending them back.
--
-- It is a table rather than a signed cookie or a JWT for one
-- reason: SINGLE USE. An authorisation code replayed against a
-- state this server would accept twice is the classic OAuth
-- fixation bug, and `consumed_at` is what makes the second
-- attempt fail. A stateless token cannot do that without state
-- to remember it by, which is the thing it was trying to avoid.
--
-- The PKCE verifier is sealed for the same reason the tokens
-- above are: a verifier readable from a database backup is a
-- verifier an attacker can pair with a stolen code.
-- ---------------------------------------------------------

create table if not exists public.user_email_oauth_states (
  -- The `state` parameter itself. Generated by the server from
  -- randomBytes, so it is the primary key rather than a column
  -- an index has to be built on.
  state             text primary key,

  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          text not null,

  -- Sealed. See above.
  code_verifier     text not null,

  -- Where to send the browser afterwards. Validated against a
  -- fixed shape before it is stored — a redirect target read
  -- back out of a database and followed is an open redirect if
  -- nothing checked it going in.
  return_path       text not null default '/agents',

  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '10 minutes'),
  consumed_at       timestamptz,

  constraint user_email_oauth_states_provider
    check (provider in ('gmail')),

  constraint user_email_oauth_states_return_path
    check (return_path ~ '^/[A-Za-z0-9/_-]*$')
);

create index if not exists user_email_oauth_states_expiry_idx
  on public.user_email_oauth_states (expires_at);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- THE ACCOUNTS TABLE GRANTS THE BROWSER NOTHING. NOT EVEN
-- SELECT.
--
-- That is stricter than agent_connections, which grants owner
-- select and defends it on the grounds that the ciphertext is
-- useless without the environment key. That argument is sound
-- and it is not the one being made here.
--
-- The difference is what a row leaks BESIDES its secret. A
-- connection row says "this agent can reach api.weather.com".
-- A row in this table says which mailbox a person has, at which
-- address, with which permissions, last used at which minute —
-- and that is information about the person rather than about
-- their configuration. There is no query a browser needs to run
-- against this table: the Email screen asks Express, which
-- answers with the address and the status and nothing else.
--
-- So: RLS on, no policy, and an explicit revoke. Every read is
-- a service-role read through AccountStore, with an explicit
-- `.eq("user_id", ...)` — which, because the service role
-- bypasses RLS, is the only thing standing between one learner
-- and another learner's mailbox.
--
-- The drafts table DOES grant owner select, because the tray
-- has to render and a draft is the learner's own text about
-- their own correspondence. It grants nothing else: a browser
-- that could update `status` could mark a draft sent without
-- sending it, and a browser that could insert one could put
-- words in an agent's mouth. Both go through Express.
--
-- The states table grants nothing to anybody. It exists for
-- ninety seconds and only the server has business with it.
-- ---------------------------------------------------------

alter table public.user_email_accounts     enable row level security;
alter table public.agent_email_drafts      enable row level security;
alter table public.user_email_oauth_states enable row level security;

drop policy if exists user_email_accounts_owner_read on public.user_email_accounts;
drop policy if exists agent_email_drafts_owner_read  on public.agent_email_drafts;

create policy agent_email_drafts_owner_read
  on public.agent_email_drafts
  for select
  using (auth.uid() = user_id);

revoke all on public.user_email_accounts     from anon, authenticated;
revoke all on public.user_email_oauth_states from anon, authenticated;
revoke all on public.agent_email_drafts      from anon;

grant select on public.agent_email_drafts to authenticated;

-- ---------------------------------------------------------
-- RETENTION
--
-- Called from the scheduler's existing hourly branch, beside
-- the document sweep 0018 added. No second timer.
--
-- Expired drafts are DELETED rather than marked, unlike a
-- retired record in agent_data. The reasoning is the one this
-- whole capability is built on: BuildGentic should hold as
-- little of somebody's correspondence as it can, and a draft
-- nobody approved in a week is the clearest possible case of
-- text with no reason to still exist. A sent draft is kept —
-- it is the receipt.
-- ---------------------------------------------------------

create or replace function public.sweep_email_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.agent_email_drafts
   where status in ('draft', 'sending')
     and expires_at < now();

  get diagnostics removed = row_count;

  delete from public.user_email_oauth_states
   where expires_at < now();

  return removed;
end;
$$;

revoke all on function public.sweep_email_drafts() from anon, authenticated;

-- ---------------------------------------------------------
-- DONE
--
-- After applying this, set the variables the capability needs
-- and restart the API:
--
--   NEUROLINK_SECRET_KEY          (already required by 0016)
--   NEUROLINK_GMAIL_CLIENT_ID
--   NEUROLINK_GMAIL_CLIENT_SECRET
--   NEUROLINK_GMAIL_REDIRECT_URI  (must match the Google console exactly;
--                                 defaults to
--                                 /api/agents/email/callback)
--
-- Without the Gmail variables the capability is refused at the
-- connect route with a message saying so, and every other
-- capability in the product is unaffected.
-- ---------------------------------------------------------
