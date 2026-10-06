import { createContext, useContext } from "react";

import type { AgeState, AgeStatus } from "./ageApi";

/*
 * The age gate's shared state, apart from its screens.
 *
 * Its own module so that components/RequireAgeCheck.tsx exports
 * only a component (fast refresh needs that), and so the pages
 * that read the status — Publish, Deploy — import a hook rather
 * than the gate.
 */

export const AgeStatusContext = createContext<AgeStatus | null>(null);

/* What the rest of the app reads to hide what an under-13
   account cannot use. Null outside the gate, or if the lookup
   failed — callers treat null as "nothing to hide", and the
   server refuses anything that should not happen regardless. */
export function useAgeStatus(): AgeStatus | null {
  return useContext(AgeStatusContext);
}

/* One lookup per account per page load, shared by both places
   the gate is mounted, so moving between pages does not re-ask. */
const cached = new Map<string, AgeState>();

export function cachedAgeState(userId: string): AgeState | null {
  return cached.get(userId) ?? null;
}

export function cacheAgeState(userId: string, state: AgeState): void {
  cached.set(userId, state);
}

export function forgetAgeState(): void {
  cached.clear();
}
