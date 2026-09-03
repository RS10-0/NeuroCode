-- =========================================================
-- NEUROLINK — FIX grant_credits ON CONFLICT INFERENCE
--
-- 0011 shipped grant_credits with a bug that only shows up
-- when it is actually called:
--
--   there is no unique or exclusion constraint matching the
--   ON CONFLICT specification
--
-- The index it wants is real. xp_transactions_source_idx is a
-- PARTIAL unique index — it covers only rows where source_type
-- and source_id are both non-null, so that unsourced manual
-- adjustments stay repeatable. Postgres will happily use a
-- partial index for ON CONFLICT, but only if the statement
-- repeats the predicate, because otherwise it cannot prove the
-- row being inserted falls inside the index at all.
--
-- 0011 named the columns and omitted the predicate, so every
-- grant raised. This adds the predicate and nothing else.
--
-- Nobody lost XP to this: the failure was on the INSERT, so no
-- ledger row and no balance change happened, and CreditStore
-- logs a grant failure rather than throwing. Lesson completions
-- during the window simply did not pay out — replaying the
-- lesson after this migration will pay, because the ledger has
-- no row to conflict with.
--
-- 0011 has been corrected in place as well, so a fresh apply of
-- that file alone is also right. Applying this one after it is
-- harmless: the function is simply replaced with itself.
--
-- Safe to re-run: every statement is idempotent.
-- =========================================================

create or replace function public.grant_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_reason      text,
  p_source_type text,
  p_source_id   text
)
returns table (
  granted integer,
  balance integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  safe_amount   integer := greatest(0, coalesce(p_amount, 0));
  inserted_rows integer := 0;
  result        integer;
begin
  insert into public.user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.xp_transactions (
    user_id, amount, reason, source_type, source_id
  )
  values (
    p_user_id, safe_amount, p_reason, p_source_type, p_source_id
  )
  -- The WHERE clause is the whole fix. It has to match
  -- xp_transactions_source_idx's predicate exactly, or Postgres
  -- refuses to infer the index.
  on conflict (user_id, source_type, source_id)
    where source_type is not null and source_id is not null
  do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows = 1 then
    update public.user_credits as uc
       set balance    = least(uc.daily_allowance, uc.balance + safe_amount),
           updated_at = now()
     where uc.user_id = p_user_id
    returning uc.balance into result;

    granted := safe_amount;
  else
    select uc.balance into result
      from public.user_credits as uc
     where uc.user_id = p_user_id;

    granted := 0;
  end if;

  balance := coalesce(result, 0);
  return next;
end;
$fn$;

-- CREATE FUNCTION grants execute to PUBLIC by default, and
-- CREATE OR REPLACE resets the grants, so these are not
-- redundant even though 0011 already ran them.

revoke all on function public.grant_credits(uuid, integer, text, text, text)
  from public, anon, authenticated;

grant execute on function public.grant_credits(uuid, integer, text, text, text)
  to service_role;
