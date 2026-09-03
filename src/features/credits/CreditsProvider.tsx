import { useCallback, useEffect, useState, type ReactNode } from "react";

import { claimDailyBonus, fetchCredits, type CreditState } from "../../lib/credits";
import { CreditsContext } from "./creditsStore";

/*
 * The XP balance, shared across the app.
 *
 * In a context rather than a hook-per-page because three
 * different surfaces read it — the nav rail's meter, the Lab's
 * Run button, the Builder's Send button — and they must not
 * disagree. Two copies of this state would mean a run that
 * spends XP updates the meter in one place and not the other,
 * which reads as the number being wrong rather than as the copy
 * being stale.
 *
 * Every mutation is somewhere else. This only ever reads, and
 * `refresh()` is what a page calls after an action that spent
 * something.
 */

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [credits, setCredits] = useState<CreditState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setCredits(await fetchCredits());
    } catch {
      /* The meter goes stale; the product keeps working. The
         server is the authority either way. */
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      /*
       * Claim first, then read, so the balance shown already
       * includes today's bonus rather than jumping a moment
       * later. Both are safe to call on every mount — the grant
       * is idempotent per UTC day in the database.
       */
      await claimDailyBonus().catch(() => ({ granted: 0, balance: 0 }));

      if (!mounted) {
        return;
      }

      await refresh();

      if (mounted) {
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [refresh]);

  /*
   * Optimistic in both of the cases where we do not know.
   *
   * `!credits` is the balance still loading. `!available` is
   * the server having no wallet at all — the migration is not
   * applied, spend_credits fails open, and the learner really
   * can run anything. Reporting "out of XP" for either would
   * disable the product over a number nobody is enforcing.
   */
  const canAfford = useCallback(
    (cost: number) =>
      !credits || !credits.available ? true : credits.balance >= cost,
    [credits]
  );

  return (
    <CreditsContext.Provider value={{ credits, loading, refresh, canAfford }}>
      {children}
    </CreditsContext.Provider>
  );
}

export type { CreditState };
