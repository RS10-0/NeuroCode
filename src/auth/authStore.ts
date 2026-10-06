import { createContext } from "react";

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;

  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;

  logout: () => Promise<void>;

  /* Emails a reset link. Resolves whether or not the address
     has an account — see AuthContext for why. */
  requestPasswordReset: (email: string) => Promise<void>;

  /* Sets a new password on the signed-in account, which after a
     reset link is the session that link created. */
  updatePassword: (password: string) => Promise<void>;
}

/*
 * Kept out of AuthContext.tsx so that file only exports the
 * provider component — mixing a hook and a component in one
 * module breaks fast refresh.
 */
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);
