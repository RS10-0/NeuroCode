import { useContext } from "react";

import { AuthContext } from "./authStore";
import type { AuthContextType } from "./authStore";

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
