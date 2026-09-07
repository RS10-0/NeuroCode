-- =========================================================
-- NEUROLINK — WHAT THE CONSENT SCREEN WAS ASKED FOR
--
-- One column, and it exists because a real bug took an hour to
-- diagnose that this would have answered in one query.
--
-- A mailbox came back from Google carrying gmail.readonly and
-- nothing else, on an agent whose four email capabilities were
-- all switched on and all correctly stored. Two explanations
-- fit that evidence exactly, and they point in opposite
-- directions:
--
--   BuildGentic asked for one scope, because the connect was
--   started with no agent attached and the route defaults to
--   read — a bug here;
--
--   or BuildGentic asked for four and Google granted one,
--   because the OAuth consent screen in the Cloud Console only
--   has the read scope registered — a configuration problem
--   somewhere else entirely.
--
-- `user_email_accounts.granted_scopes` records the ANSWER.
-- Nothing recorded the QUESTION. The state row is the only
-- thing that exists between the two, and it stored the code
-- verifier and the return path but not the grants — so the
-- diagnosis had to be inferred from return_path, which happens
-- to be derived from the same `agentId` in the UI and happens
-- to give the answer away. That is luck, not instrumentation.
--
-- With this column the same question is a select. Requested
-- versus granted, side by side, on the row that connects them.
--
-- Nullable and defaulted, so rows written by the build running
-- when this is applied are still valid: an older server that
-- does not set it leaves '{}', which reads as "not recorded"
-- rather than as "asked for nothing".
-- =========================================================

alter table public.user_email_oauth_states
  add column if not exists requested_grants text[] not null default '{}';

comment on column public.user_email_oauth_states.requested_grants is
  'The EmailGrant list this authorisation asked Google for (read, draft, send, organize), derived from the agent''s stored capabilities at the moment Connect was pressed. Compare with user_email_accounts.granted_scopes to tell a narrow REQUEST from a narrow GRANT.';
