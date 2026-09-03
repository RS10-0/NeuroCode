-- =========================================================
-- NEUROLINK — WEB SEARCH
--
-- Phase 2.5 (Web Search capability). One constraint, widened.
--
-- Web Search adds no table, and that is worth stating rather
-- than apologising for. Knowledge retrieval needed storage
-- because an agent's knowledge is durable: it is chunked once,
-- embedded once, and searched for months. A web result is the
-- opposite — fetched for one question, quoted in one answer,
-- and of no value the moment the page changes. Keeping a copy
-- would mean serving stale results from a cache while claiming
-- to have looked, which is the one thing this capability must
-- never do.
--
-- So the only durable trace a search leaves is the same trace
-- every other call leaves: a row in ai_usage saying what was
-- spent and on what. That ledger needs one more word in its
-- vocabulary.
--
-- Safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- USAGE VOCABULARY
--
-- One more feature on the ledger that already exists.
--
--   agent_web_search — the small model call that decides
--                      whether a question needs the live web,
--                      and the search provider calls that
--                      follow it.
--
-- One name for both halves because they answer one question —
-- what did searching cost — and because a decision that
-- concluded "no search needed" is part of that cost even though
-- no search happened. Rows for the two are told apart by
-- `model`: the decision carries the answering model's id, and a
-- search carries the literal 'web-search' with the search
-- provider in `provider_id`.
--
-- A search row reports zero tokens, honestly: no model ran. It
-- is the request windows that bound searching, counted under
-- the quota key `search:<power source>:<user id>` — its own
-- windows, for the reason spelled out in server/src/ai/config.ts
-- (a search-backed turn is three calls, and charging all three
-- to a learner's Lab allowance would cut what they can do to a
-- third the moment they switch the capability on).
--
-- Not nameable by a browser: server/src/ai/validation.ts keeps
-- it out of CLIENT_FEATURES, exactly as it does for
-- agent_public, agent_index and agent_retrieval. This server
-- decides to make these calls, so nothing else gets to claim
-- them.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search'
  ));

-- ---------------------------------------------------------
-- CAPABILITY VOCABULARY
--
-- `agents.capabilities` is a text[] with no constraint on its
-- contents, so 'web_search' needs no migration to be storable —
-- and deliberately so. What an agent is allowed to do is
-- decided by the build that runs it, not by the shape of the
-- table: src/features/agents/capabilities.ts drops any
-- capability this build cannot actually carry out, and
-- server/src/agents/deploymentRequest.ts reads the flag off the
-- stored row rather than off the request.
--
-- Which means a row written by a newer build, naming a
-- capability an older one has never heard of, degrades to an
-- agent that simply does not do that thing. That is the right
-- failure, and it is why this section is a comment rather than
-- a CHECK constraint.
-- ---------------------------------------------------------
