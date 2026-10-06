import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL;

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Missing VITE_SUPABASE_URL environment variable."
  );
}

if (!supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_ANON_KEY environment variable."
  );
}

/*
 * What a password-reset link brought with it, read before the
 * client exists.
 *
 * The link lands on /reset-password with the outcome in the URL
 * fragment: `#access_token=…&type=recovery` when it worked,
 * `#error=…&error_description=…` when it had expired or was
 * already used. The client below consumes that fragment while
 * it initialises and then clears it, and the PASSWORD_RECOVERY
 * event it fires can arrive before any page has subscribed. So
 * this is read here, synchronously, at the one moment it is
 * guaranteed to still be in the address bar.
 */
function readRecoveryLink(): { arrived: boolean; error: string | null } {
  if (typeof window === "undefined") {
    return { arrived: false, error: null };
  }

  const params = new URLSearchParams(window.location.hash.slice(1));
  const error = params.get("error_description") ?? params.get("error");

  return {
    arrived: params.get("type") === "recovery" || Boolean(error),
    error,
  };
}

export const recoveryLink = readRecoveryLink();

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);