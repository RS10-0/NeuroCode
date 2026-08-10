import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type {
  User as SupabaseUser,
} from "@supabase/supabase-js";

import { supabase } from "../lib/supabase";

interface User {
  id: string;
  username: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;

  login: (
    email: string,
    password: string
  ) => Promise<void>;

  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;

  logout: () => Promise<void>;
}

const AuthContext =
  createContext<
    AuthContextType | undefined
  >(undefined);

function convertUser(
  authUser: SupabaseUser,
  username?: string
): User {
  return {
    id: authUser.id,
    username:
      username ??
      authUser.user_metadata?.username ??
      "",
    email: authUser.email ?? "",
  };
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] =
    useState<User | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  // -----------------------------------------
  // LOAD PROFILE
  // -----------------------------------------

  async function loadProfile(
    authUser: SupabaseUser
  ): Promise<User> {
    try {
      const {
        data: profile,
        error,
      } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", authUser.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Profile lookup failed:",
          error.message
        );

        return convertUser(authUser);
      }

      return convertUser(
        authUser,
        profile?.username
      );
    } catch (error) {
      console.error(
        "Unexpected profile error:",
        error
      );

      return convertUser(authUser);
    }
  }

  // -----------------------------------------
  // INITIAL SESSION
  // -----------------------------------------

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const {
          data: { session },
          error,
        } =
          await supabase.auth.getSession();

        if (error) {
          console.error(
            "Session error:",
            error.message
          );

          if (mounted) {
            setUser(null);
          }

          return;
        }

        if (!mounted) {
          return;
        }

        if (session?.user) {
          /*
           * IMPORTANT:
           *
           * Do NOT wait for the profiles
           * table here.
           *
           * Supabase Auth already gives us
           * the authenticated user immediately.
           */

          setUser(
            convertUser(
              session.user,
              session.user.user_metadata
                ?.username
            )
          );
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error(
          "Auth initialization failed:",
          error
        );

        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    // -----------------------------------------
    // AUTH STATE CHANGES
    // -----------------------------------------

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (!mounted) {
            return;
          }

          if (!session?.user) {
            setUser(null);
            setIsLoading(false);
            return;
          }

          /*
           * Set the authenticated user immediately.
           * This prevents the UI from waiting on
           * the profiles database query.
           */

          setUser(
            convertUser(
              session.user,
              session.user.user_metadata
                ?.username
            )
          );

          setIsLoading(false);

          /*
           * Load the profile afterward.
           *
           * This is intentionally NOT awaited
           * before showing the authenticated UI.
           */

          const currentUser =
            await loadProfile(
              session.user
            );

          if (!mounted) {
            return;
          }

          setUser(currentUser);
        }
      );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // -----------------------------------------
  // LOGIN
  // -----------------------------------------

  const login = async (
    email: string,
    password: string
  ): Promise<void> => {
    setIsLoading(true);

    try {
      const {
        data,
        error,
      } =
        await supabase.auth.signInWithPassword({
          email: email
            .trim()
            .toLowerCase(),
          password,
        });

      if (error) {
        throw new Error(
          error.message
        );
      }

      if (!data.user) {
        throw new Error(
          "Unable to log in."
        );
      }

      /*
       * Set the Auth user immediately.
       */

      setUser(
        convertUser(
          data.user,
          data.user.user_metadata
            ?.username
        )
      );

      /*
       * Load the profile afterward.
       */

      const currentUser =
        await loadProfile(data.user);

      setUser(currentUser);
    } finally {
      setIsLoading(false);
    }
  };

  // -----------------------------------------
  // REGISTER
  // -----------------------------------------

  const register = async (
    username: string,
    email: string,
    password: string
  ): Promise<void> => {
    setIsLoading(true);

    try {
      const cleanUsername =
        username.trim();

      const cleanEmail =
        email.trim().toLowerCase();

      if (!cleanUsername) {
        throw new Error(
          "Username is required."
        );
      }

      if (!cleanEmail) {
        throw new Error(
          "Email is required."
        );
      }

      if (password.length < 8) {
        throw new Error(
          "Password must be at least 8 characters."
        );
      }

      // ---------------------------------------
      // CREATE SUPABASE AUTH USER
      // ---------------------------------------

      const {
        data,
        error,
      } =
        await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              username: cleanUsername,
            },
          },
        });

      if (error) {
        throw new Error(
          error.message
        );
      }

      if (!data.user) {
        throw new Error(
          "Unable to create account."
        );
      }

      /*
       * If email confirmation is disabled,
       * Supabase gives us a session immediately.
       */

      if (data.session) {
        setUser(
          convertUser(
            data.user,
            cleanUsername
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  // -----------------------------------------
  // LOGOUT
  // -----------------------------------------

  const logout = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const { error } =
        await supabase.auth.signOut();

      if (error) {
        throw new Error(
          error.message
        );
      }

      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  // -----------------------------------------
  // PROVIDER
  // -----------------------------------------

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// -----------------------------------------
// USE AUTH
// -----------------------------------------

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider."
    );
  }

  return context;
}
