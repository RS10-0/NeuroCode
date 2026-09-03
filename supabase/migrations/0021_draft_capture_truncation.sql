-- =========================================================
-- NEUROLINK — WHETHER THE CAPTURE WAS THE WHOLE PAGE
--
-- One column, and it closes a gap between what §2.3.1 of the
-- phase-4 doc requires and what 0020 actually stored.
--
-- 0020 added four columns to agent_email_drafts so that a
-- reply a web page influenced shows what influenced it before
-- anybody sends it: the address, the title, the captured text
-- and the capture mode. The send screen renders all four.
--
-- WHAT IT DID NOT STORE IS WHETHER THE CAPTURE WAS COMPLETE.
--
-- §2.3.1 asks for the captured text "with its character count
-- AND A TRUNCATION MARKER if §3.2's cap was hit". The count
-- was there; the marker had nowhere to come from.
-- pageContext.ts computes `truncated` and tells the MODEL
-- about it — "NOTE: this capture was cut short." goes inside
-- the fence — but the flag was dropped on the way to the
-- draft row, so the one reader who most needs it was the one
-- who never got it.
--
-- WHY THAT MATTERS RATHER THAN BEING A TIDINESS FIX. The
-- screen exists so a learner can look at the draft, look at
-- what shaped it, and notice when the two do not match. A
-- capture that stops at 20,000 characters and says nothing
-- about stopping invites exactly the wrong conclusion: the
-- learner reads to the end, finds nothing alarming, and
-- concludes the page was harmless. §2.3.1 already names this
-- case — "the one time it matters is the one time the payload
-- is at the bottom" — and a silent truncation is how the
-- bottom goes missing.
--
-- NULLABLE, LIKE THE OTHER FOUR, and for the reason 0020 gave
-- for them: "this draft had no page context" and "this draft
-- had a complete capture" are different facts and must not
-- collapse into one false.
--
-- It also has to be nullable for the drafts that already
-- exist. Rows written between 0020 and this migration carry
-- real provenance and an unknown truncation state; the reader
-- treats null as "not truncated" rather than discarding their
-- provenance wholesale, which is the choice that keeps a
-- disclosure on screen for drafts that have one.
--
-- No retention path of its own: this is a column on a row
-- sweep_email_drafts already deletes, so it dies with the
-- draft it describes, in the same statement.
--
-- Safe to re-run.
-- =========================================================

alter table public.agent_email_drafts
  add column if not exists source_page_truncated boolean;

-- ---------------------------------------------------------
-- THE IMPOSSIBLE STATE, refused rather than merely avoided.
--
-- A truncation flag on a draft with no captured text is a row
-- claiming something about a capture that did not happen. It
-- cannot be produced by the application — tools.ts writes all
-- five together or none of them — so this constraint exists
-- for the same reason 0020's context_needs_enabled does: a row
-- written by hand, or by an older build, must not be able to
-- claim it either.
--
-- Stated against source_page_text rather than against all
-- four, because that is the column toSourcePage() treats as
-- load-bearing: no text, no disclosure, whatever else is set.
-- ---------------------------------------------------------

alter table public.agent_email_drafts
  drop constraint if exists agent_email_drafts_truncated_needs_text;

alter table public.agent_email_drafts
  add constraint agent_email_drafts_truncated_needs_text
  check (source_page_truncated is null or source_page_text is not null);

-- ---------------------------------------------------------
-- GRANTS AND RLS are unchanged and deliberately absent.
--
-- agent_email_drafts already carries its policy and its column
-- grants from 0019. A column added to a table whose SELECT
-- grant names no column list is covered by that grant; there
-- is nothing to widen here, and widening anything would be the
-- bug rather than the fix.
-- ---------------------------------------------------------
