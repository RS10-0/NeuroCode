import { useContext } from "react";

import { CreditsContext, type CreditsContextValue } from "./creditsStore";

export function useCredits(): CreditsContextValue {
  const context = useContext(CreditsContext);

  if (!context) {
    throw new Error("useCredits must be used inside CreditsProvider.");
  }

  return context;
}
