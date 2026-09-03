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
}

/*
 * Kept out of AuthContext.tsx so that file only exports the
 * provider component — mixing a hook and a component in one
 * module breaks fast refresh.
 */
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);
