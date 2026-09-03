-- =========================================================
-- NEUROLINK — FILE ANALYSIS
--
-- Phase 2.5, capability three. One constraint, widened.
--
-- File Analysis adds no table, and that is worth stating
-- rather than apologising for — it is the same argument
-- 0008 makes about a web search, reached from a different
-- direction.
--
-- Knowledge retrieval needed storage because an agent's
-- knowledge is durable: chunked once, embedded once, searched
-- for months. An attached file is the opposite. It exists to
-- answer the question it was attached to, it is read once, and
-- the thing worth keeping for the next thirty minutes is not
-- the file but the TEXT that came out of it. Keeping the file
-- would mean a storage bucket, its policies, its lifecycle
-- rules, its own ownership model and its own way of leaking —
-- permanent infrastructure for temporary data, in a feature
-- whose stated requirement is that a file must not become
-- permanently reachable because somebody knows a URL.
--
-- So an upload lives in the server process for a few minutes,
-- keyed by an opaque id, scoped to whoever created it, reachable
-- through no URL at all. See server/src/files/FileStore.ts,
-- which also records what that costs: a restart drops held
-- attachments, and a second instance behind a load balancer
-- cannot see the first one's. The failure is "attach it again",
-- and that module is the seam Supabase Storage lands behind if
-- NeuroLink ever runs more than one instance.
--
-- Which leaves the only durable trace a file leaves being the
-- same trace every other piece of work leaves: a row in
-- ai_usage saying what was spent and on what. That ledger needs
-- one more word in its vocabulary.
--
-- Safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- USAGE VOCABULARY
--
-- One more feature on the ledger that already exists.
--
--   agent_file_analysis — reading an uploaded file and turning
--                         it into text the model can be given.
--
-- No model runs, and the row says so by reporting zero tokens,
-- exactly as a 'web-search' row does. What it records is that
-- this server spent CPU, memory and wall-clock time on
-- somebody's behalf — a real cost with no token column, and
-- therefore one only the request counters can bound.
--
-- Rows carry the literal 'file-analysis' in `model` and the
-- format in `provider_id`: 'pdf', 'docx', 'xlsx', 'csv' or
-- 'image'. That makes "which formats do learners actually
-- attach" answerable from the ledger, and it keeps the ledger
-- from reading as if the agent answered twice.
--
-- Counted under the quota key `file:<power source>:<user id>` —
-- its own windows, for the reason spelled out in
-- server/src/ai/config.ts: a turn that analyses a file is an
-- upload plus an answer, and charging both to a learner's Lab
-- allowance would halve what they can do the moment they attach
-- something.
--
-- A deployed agent's uploads are charged to the OWNER, like its
-- answers, because an anonymous caller has no allowance to
-- spend. See server/src/routes/deployments.ts.
--
-- Not nameable by a browser: server/src/ai/validation.ts keeps
-- it out of CLIENT_FEATURES, exactly as it does for
-- agent_public, agent_index, agent_retrieval and
-- agent_web_search. This server decides to do the work, so
-- nothing else gets to claim it.
-- ---------------------------------------------------------

alter table public.ai_usage
  drop constraint if exists ai_usage_feature_check;

alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in (
    'lab', 'compare', 'agent_test', 'agent_public',
    'vibe', 'dev_harness', 'agent_index', 'agent_retrieval',
    'agent_web_search', 'agent_file_analysis'
  ));

-- ---------------------------------------------------------
-- CAPABILITY VOCABULARY
--
-- `agents.capabilities` is a text[] with no constraint on its
-- contents, so 'file_analysis' needs no migration to be
-- storable — and deliberately so, for the reason 0008 gives.
-- What an agent is allowed to do is decided by the build that
-- runs it, not by the shape of the table:
-- src/features/agents/capabilities.ts drops any capability this
-- build cannot actually carry out, and
-- server/src/agents/deploymentRequest.ts reads the flag off the
-- stored row rather than off the request.
--
-- Which means a row written by a newer build, naming a
-- capability an older one has never heard of, degrades to an
-- agent that simply does not do that thing. That is the right
-- failure, and it is why this section is a comment rather than
-- a CHECK constraint.
-- ---------------------------------------------------------
