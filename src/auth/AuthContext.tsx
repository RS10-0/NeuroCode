import { useEffect, useState, type ReactNode } from "react";

import type {
  User as SupabaseUser,
} from "@supabase/supabase-js";

import { supabase } from "../lib/supabase";
import { beginOnboarding } from "../lib/onboarding";
import { AuthContext } from "./authStore";
import type { User } from "./authStore";

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
  // INITIAL AUTHENTICATION
  // -----------------------------------------

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (!mounted) {
          return;
        }

        if (error) {
          console.error(
            "Session initialization failed:",
            error.message
          );

          setUser(null);
          return;
        }

        if (session?.user) {
          // Set the authenticated user immediately.
          setUser(
            convertUser(
              session.user,
              session.user.user_metadata?.username
            )
          );

          // Load profile in the background.
          loadProfile(session.user).then(
            (profileUser) => {
              if (mounted) {
                setUser(profileUser);
              }
            }
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
    };

    initializeAuth();

    // -----------------------------------------
    // LISTEN FOR AUTH CHANGES
    // -----------------------------------------

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (!mounted) {
            return;
          }

          if (!session?.user) {
            setUser(null);
            setIsLoading(false);
            return;
          }

          // Immediately update the UI.
          setUser(
            convertUser(
              session.user,
              session.user.user_metadata?.username
            )
          );

          setIsLoading(false);

          // Profile lookup happens afterward.
          loadProfile(session.user).then(
            (profileUser) => {
              if (mounted) {
                setUser(profileUser);
              }
            }
          );
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
          email: email.trim().toLowerCase(),
          password,
        });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.user) {
        throw new Error(
          "Unable to log in."
        );
      }

      /*
       * IMPORTANT:
       *
       * Do NOT wait for the profiles query
       * before finishing login.
       *
       * Supabase authentication has already
       * succeeded at this point.
       */

      setUser(
        convertUser(
          data.user,
          data.user.user_metadata?.username
        )
      );
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
        throw new Error(error.message);
      }

      if (!data.user) {
        throw new Error(
          "Unable to create account."
        );
      }

      if (data.session) {
        setUser(
          convertUser(
            data.user,
            cleanUsername
          )
        );

        /*
         * Mark the brand-new account as owing onboarding.
         *
         * This is the only place that knows an account was just
         * created, so it is the only honest place to record it.
         * RequireOnboarding reads the row back; a returning
         * learner never has a pending one.
         *
         * Needs the session to exist — the write goes through
         * RLS as the new user. If e-mail confirmation is ever
         * turned on there is no session here, no marker, and the
         * learner lands on the dashboard rather than being
         * bounced to a tutorial they cannot save.
         */
        await beginOnboarding();
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
        throw new Error(error.message);
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
