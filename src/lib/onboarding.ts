import { supabase } from "./supabase";

export interface OnboardingRecord {
  user_id: string;
  completed: boolean;
  goal: string | null;
  experience: string | null;
  literacy_score: number | null;
  literacy_level: string | null;
  recommended_lesson_id: string | null;
  created_at: string;
  updated_at: string;
}

/*
 * Owner-only through RLS, read straight from the browser — the
 * same pattern the rest of the progress layer uses. Nothing here
 * is sensitive enough to need the server as an intermediary.
 */
async function currentUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(`Authentication error: ${error.message}`);
  }

  if (!user) {
    throw new Error("You must be signed in.");
  }

  return user.id;
}

/*
 * Returns null when the learner has not started onboarding.
 *
 * Throws only on unexpected failures — a missing row is a normal
 * state, not an error.
 */
export async function getOnboarding(): Promise<OnboardingRecord | null> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("onboarding")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load onboarding: ${error.message}`);
  }

  return (data as OnboardingRecord | null) ?? null;
}

/*
 * Marks a freshly created account as owing onboarding.
 *
 * The row itself is the signal. A pending row means "this
 * account was created through the sign-up flow and has not
 * finished onboarding"; no row at all means the account
 * predates onboarding entirely and must never be dragged
 * through it. See RequireOnboarding for the other half.
 *
 * Deliberately not derived from localStorage: a marker that
 * lives in the browser would re-trigger onboarding on a second
 * device, and vanish when storage is cleared. This lives with
 * the account.
 *
 * `ignoreDuplicates` makes it safe to call more than once and
 * incapable of un-completing an existing record.
 */
export async function beginOnboarding(): Promise<void> {
  const userId = await currentUserId();

  const { error } = await supabase
    .from("onboarding")
    .upsert(
      { user_id: userId, completed: false },
      { onConflict: "user_id", ignoreDuplicates: true }
    );

  if (error) {
    /*
     * Best effort. Failing here must not block a sign-up that
     * already succeeded — the learner simply lands on the
     * dashboard instead of the tutorial.
     */
    console.error("Could not mark onboarding as pending:", error.message);
  }
}

export async function saveOnboarding(input: {
  goal: string;
  experience: string;
  literacyScore: number;
  literacyLevel: string;
  recommendedLessonId: string;
}): Promise<OnboardingRecord> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("onboarding")
    .upsert(
      {
        user_id: userId,
        completed: true,
        goal: input.goal,
        experience: input.experience,
        literacy_score: input.literacyScore,
        literacy_level: input.literacyLevel,
        recommended_lesson_id: input.recommendedLessonId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Unable to save onboarding: ${error.message}`);
  }

  return data as OnboardingRecord;
}
