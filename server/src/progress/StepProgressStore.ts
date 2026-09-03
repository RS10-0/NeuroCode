import { supabase } from "../lib/supabase";

export interface StepProgressRow {
  lesson_id: string;
  step_id: string;
  completed: boolean;
  score: number | null;
  attempts: number;
  xp_awarded: number;
}

export interface AwardResult {
  newlyCompleted: boolean;
  awarded: number;
  totalXp: number;
  level: number;
}

/*
 * Records a completed lesson step and grants its XP exactly once.
 *
 * All the idempotency lives in the award_step_xp function: it
 * inserts on conflict do nothing against a unique (user_id,
 * step_id) index, and only increments XP when that insert
 * actually created a row. Replaying a lesson therefore records
 * the extra attempt but awards nothing.
 */
export async function awardStepXp(
  userId: string,
  lessonId: string,
  stepId: string,
  xp: number,
  score?: number
): Promise<AwardResult> {
  const { data, error } = await supabase.rpc("award_step_xp", {
    p_user_id: userId,
    p_lesson_id: lessonId,
    p_step_id: stepId,
    p_xp: Math.max(0, Math.round(xp)),
    p_score: typeof score === "number" ? score : null,
  });

  if (error) {
    throw new Error(`Unable to record step progress: ${error.message}`);
  }

  /* The function returns a single-row table. */
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Step progress was not recorded.");
  }

  return {
    newlyCompleted: Boolean(row.newly_completed),
    awarded: Number(row.awarded ?? 0),
    totalXp: Number(row.total_xp ?? 0),
    level: Number(row.level ?? 1),
  };
}

/* Every step this user has already completed in a lesson. */
export async function getStepProgress(
  userId: string,
  lessonId: string
): Promise<StepProgressRow[]> {
  const { data, error } = await supabase
    .from("lesson_step_progress")
    .select("lesson_id, step_id, completed, score, attempts, xp_awarded")
    .eq("user_id", userId)
    .eq("lesson_id", lessonId);

  if (error) {
    throw new Error(`Unable to load step progress: ${error.message}`);
  }

  return (data ?? []) as StepProgressRow[];
}

/*
 * How many of these steps the learner has actually completed.
 *
 * One query with `in`, rather than one per step: the caller is
 * asking about every lesson in a course at once, and the answer
 * decides a single bonus.
 *
 * Counts rows rather than returning them — the caller only ever
 * compares the number against the length of what it passed in,
 * and `head: true` means the step ids never travel back.
 */
export async function countCompletedSteps(
  userId: string,
  stepIds: string[]
): Promise<number> {
  if (stepIds.length === 0) {
    return 0;
  }

  const { count, error } = await supabase
    .from("lesson_step_progress")
    .select("step_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true)
    .in("step_id", stepIds);

  if (error) {
    throw new Error(`Unable to read course progress: ${error.message}`);
  }

  return count ?? 0;
}
