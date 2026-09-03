import { createContext } from "react";

import type { CreditState } from "../../lib/credits";

/*
 * The context itself, split out from the provider.
 *
 * Same shape as src/auth/authStore.ts and for the same reason:
 * a file that exports both a component and a hook breaks React
 * Fast Refresh, so the context, the provider and the hook live
 * in three files here exactly as they do for auth.
 */

export interface CreditsContextValue {
  credits: CreditState | null;
  loading: boolean;
  /* Re-read after anything that spends or earns. */
  refresh: () => Promise<void>;
  /*
   * Whether the learner can afford an action right now.
   *
   * Optimistic when the balance has not loaded: a meter that
   * has not arrived yet must not disable the product. The
   * server refuses anything genuinely unaffordable.
   */
  canAfford: (cost: number) => boolean;
}

export const CreditsContext = createContext<CreditsContextValue | undefined>(
  undefined
);
