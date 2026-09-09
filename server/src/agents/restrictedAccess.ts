import type { User } from "@supabase/supabase-js";

/*
 * Who may hold an agent that is not for sale.
 *
 * The catalogue says WHETHER an agent is restricted —
 * `restricted: true` in src/features/agents/flagships.ts, which
 * ships in the browser bundle and is not a secret. This file
 * says WHO may bypass that, and it is the half that stays on
 * the server.
 *
 * WHY THE ADDRESSES ARE IN AN ENVIRONMENT VARIABLE AND NOT IN
 * THIS FILE.
 *
 * The repository is public. An address committed here would be
 * in the clone, in the history, and in every fork — findable
 * long after it was changed, and changeable only by a deploy.
 * `NEUROLINK_RESTRICTED_OWNERS` keeps it out of the source,
 * lets it change without a release, and lets a staging
 * environment hold a different value from production.
 *
 * IT FAILS CLOSED, WHICH IS A REAL TRADE AND WORTH KNOWING.
 * Unset means nobody is an owner, so a restricted agent is
 * invisible and unbuyable for everyone — including the person
 * it belongs to. That is the correct direction to fail: the
 * alternative is an unset variable quietly putting a private
 * agent back on sale. The cost is that forgetting to set this
 * on a new environment looks like the agent disappearing, so
 * `restrictedOwnersConfigured` exists for a health check to say
 * so out loud rather than leaving it to be discovered.
 *
 * ENTITLEMENTS ALREADY GRANTED ARE NOT TOUCHED BY ANY OF THIS.
 * Nothing here revokes an `agent_unlocks` row or deletes an
 * agent. It governs what the Library offers and what the unlock
 * endpoint accepts — the front door, not the house. Taking
 * something away from somebody who already has it is a
 * different decision, and it should be made deliberately and
 * with SQL, not as a side effect of a feature flag.
 */

const ENV_KEY = "NEUROLINK_RESTRICTED_OWNERS";

/*
 * Comma-separated, trimmed, lower-cased, blanks dropped.
 *
 * Read on every call rather than captured at module load, so a
 * process restart is not required to pick up a changed value in
 * environments that can rewrite it — and so a test can set it
 * without reaching into module state.
 */
function owners(): Set<string> {
  const raw = process.env[ENV_KEY] ?? "";

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function restrictedOwnersConfigured(): boolean {
  return owners().size > 0;
}

/*
 * True only for a caller whose verified address is on the list.
 *
 * The address comes from the Supabase user resolved from the
 * bearer token, never from anything the client sent alongside
 * it — a header or a body field naming an email would be a
 * request politely asking to be somebody else.
 *
 * `email_confirmed_at` is required as well as the address.
 * Supabase will hand back an unconfirmed address on a freshly
 * signed-up account, and an unconfirmed address is a claim
 * rather than a fact: anybody can type somebody else's email
 * into a sign-up form. Without this check, "only my account"
 * would mean "only my account, or anyone who has typed my
 * address and not yet been asked to prove it".
 */
export function mayHoldRestricted(user: User | null | undefined): boolean {
  if (!user?.email) {
    return false;
  }

  if (!user.email_confirmed_at) {
    return false;
  }

  return owners().has(user.email.trim().toLowerCase());
}
