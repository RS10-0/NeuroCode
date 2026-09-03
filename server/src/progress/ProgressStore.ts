import { supabase } from "../lib/supabase";

/* =========================================================
   TYPES
========================================================= */

export type MasteryLevel =
  | "not_started"
  | "learning"
  | "developing"
  | "proficient"
  | "mastered";

export interface ConceptProgress {
  conceptId: string;
  mastery: MasteryLevel;
  attempts: number;
  successfulAttempts: number;
  lastAttemptAt?: string;
}

export interface StudentProgress {
  studentId: string;
  completedLessonIds: string[];
  conceptProgress: ConceptProgress[];
  currentLessonId?: string;
}

interface ProgressRow {
  user_id: string;
  completed_lesson_ids: string[];
  concept_progress: ConceptProgress[];
  current_lesson_id: string | null;
  updated_at: string;
}


/* =========================================================
   AUTHENTICATION
========================================================= */

/**
 * Guards a progress operation.
 *
 * INVARIANT: `studentId` is always a Supabase user id that the
 * transport layer has already verified, by calling
 * `supabase.auth.getUser(token)` with the request's bearer
 * token. Callers must never pass a client-supplied id.
 *
 * This previously called `supabase.auth.getUser()` with no
 * argument on the service-role client. That client is created
 * with `persistSession: false` and holds no session, so the
 * call could never resolve a user and every progress route
 * threw before touching the database.
 */
function assertOwnProgress(studentId: string): void {
  if (typeof studentId !== "string" || studentId.length === 0) {
    throw new Error("A verified user id is required to access progress.");
  }
}


/* =========================================================
   NORMALIZATION HELPERS
========================================================= */

/**
 * Safely normalize a mastery value coming from JSONB.
 *
 * This prevents malformed data from crashing the
 * application if the database contains an unexpected value.
 */
function normalizeMastery(
  value: unknown
): MasteryLevel {
  switch (value) {
    case "not_started":
    case "learning":
    case "developing":
    case "proficient":
    case "mastered":
      return value;

    default:
      return "not_started";
  }
}


/**
 * Convert a raw JSONB concept-progress value into
 * the application's ConceptProgress[] type.
 */
function normalizeConceptProgress(
  value: unknown
): ConceptProgress[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (
        item
      ): item is Record<string, unknown> =>
        typeof item === "object" &&
        item !== null
    )
    .map((item) => ({
      conceptId:
        typeof item.conceptId === "string"
          ? item.conceptId
          : "",

      mastery:
        normalizeMastery(
          item.mastery
        ),

      attempts:
        typeof item.attempts === "number"
          ? Math.max(
              0,
              Math.floor(
                item.attempts
              )
            )
          : 0,

      successfulAttempts:
        typeof item.successfulAttempts ===
        "number"
          ? Math.max(
              0,
              Math.floor(
                item.successfulAttempts
              )
            )
          : 0,

      lastAttemptAt:
        typeof item.lastAttemptAt ===
        "string"
          ? item.lastAttemptAt
          : undefined,
    }))
    .filter(
      (item) =>
        item.conceptId.length > 0
    );
}


/**
 * Convert a database row into the application's
 * StudentProgress shape.
 */
function rowToProgress(
  row: ProgressRow
): StudentProgress {
  return {
    studentId:
      row.user_id,

    completedLessonIds:
      Array.isArray(
        row.completed_lesson_ids
      )
        ? row.completed_lesson_ids
        : [],

    conceptProgress:
      normalizeConceptProgress(
        row.concept_progress
      ),

    currentLessonId:
      row.current_lesson_id ??
      undefined,
  };
}


/**
 * Convert the application's StudentProgress shape
 * into the database row shape.
 */
function progressToRow(
  progress: StudentProgress
): ProgressRow {
  return {
    user_id:
      progress.studentId,

    completed_lesson_ids:
      progress.completedLessonIds,

    concept_progress:
      progress.conceptProgress,

    current_lesson_id:
      progress.currentLessonId ??
      null,

    updated_at:
      new Date().toISOString(),
  };
}


/**
 * Create a completely empty progress record
 * for a newly authenticated user.
 */
function createEmptyProgress(
  studentId: string
): StudentProgress {
  return {
    studentId,

    completedLessonIds: [],

    conceptProgress: [],

    currentLessonId:
      undefined,
  };
}


/* =========================================================
   GET PROGRESS
========================================================= */

/**
 * Load the authenticated user's aggregate progress.
 *
 * The progress table has:
 *
 *   user_id
 *   completed_lesson_ids
 *   concept_progress
 *   current_lesson_id
 *   updated_at
 *
 * There should be exactly one row per user.
 */
export async function getProgress(
  studentId: string
): Promise<StudentProgress> {
  assertOwnProgress(
    studentId
  );

  const {
    data,
    error,
  } = await supabase
    .from("progress")
    .select(
      `
        user_id,
        completed_lesson_ids,
        concept_progress,
        current_lesson_id,
        updated_at
      `
    )
    .eq(
      "user_id",
      studentId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load progress: ${error.message}`
    );
  }

  /*
   * No aggregate progress row exists yet.
   *
   * This is normal for a brand-new user.
   */
  if (!data) {
    return createEmptyProgress(
      studentId
    );
  }

  return rowToProgress(
    data as ProgressRow
  );
}


/* =========================================================
   SAVE PROGRESS
========================================================= */

/**
 * Save the authenticated user's aggregate progress.
 *
 * The progress table has one row per user, enforced by
 * the unique user_id constraint.
 *
 * Therefore:
 *
 *   upsert(..., { onConflict: "user_id" })
 *
 * is the correct operation.
 */
export async function saveProgress(
  progress: StudentProgress
): Promise<StudentProgress> {
  assertOwnProgress(
    progress.studentId
  );

  const row =
    progressToRow(progress);

  const {
    data,
    error,
  } = await supabase
    .from("progress")
    .upsert(
      row,
      {
        onConflict:
          "user_id",
      }
    )
    .select(
      `
        user_id,
        completed_lesson_ids,
        concept_progress,
        current_lesson_id,
        updated_at
      `
    )
    .single();

  if (error) {
    throw new Error(
      `Unable to save progress: ${error.message}`
    );
  }

  return rowToProgress(
    data as ProgressRow
  );
}


/* =========================================================
   RECORD EVALUATION
========================================================= */

/**
 * Record the result of a lesson evaluation.
 *
 * This updates:
 *
 * 1. Concept attempts
 * 2. Concept successful attempts
 * 3. Concept mastery
 * 4. Lesson completion when correct
 * 5. Current lesson
 */
export async function recordEvaluation(
  studentId: string,
  lessonId: string,
  conceptIds: string[],
  correct: boolean
): Promise<StudentProgress> {
  assertOwnProgress(
    studentId
  );

  const progress =
    await getProgress(
      studentId
    );

  const now =
    new Date().toISOString();

  /*
   * Update each concept associated with
   * the lesson.
   */
  for (
    const conceptId of conceptIds
  ) {
    const existing =
      progress.conceptProgress.find(
        (item) =>
          item.conceptId ===
          conceptId
      );

    if (existing) {
      existing.attempts += 1;

      if (correct) {
        existing.successfulAttempts +=
          1;
      }

      existing.mastery =
        calculateMastery(
          existing.attempts,
          existing.successfulAttempts
        );

      existing.lastAttemptAt =
        now;
    } else {
      const attempts = 1;

      const successfulAttempts =
        correct ? 1 : 0;

      progress.conceptProgress.push({
        conceptId,

        attempts,

        successfulAttempts,

        mastery:
          calculateMastery(
            attempts,
            successfulAttempts
          ),

        lastAttemptAt:
          now,
      });
    }
  }

  /*
   * Only a correct evaluation completes
   * the lesson.
   */
  if (correct) {
    if (
      !progress.completedLessonIds.includes(
        lessonId
      )
    ) {
      progress.completedLessonIds.push(
        lessonId
      );
    }
  }

  /*
   * Regardless of whether the answer was
   * correct, this is the lesson the student
   * is currently working on.
   */
  progress.currentLessonId =
    lessonId;

  return saveProgress(
    progress
  );
}


/* =========================================================
   MASTERY CALCULATION
========================================================= */

/**
 * Calculate mastery from attempt history.
 *
 * Mastery progression:
 *
 * 0 attempts
 *     -> not_started
 *
 * < 50% success
 *     -> learning
 *
 * >= 50% success
 *     -> developing
 *
 * >= 3 attempts AND >= 75%
 *     -> proficient
 *
 * >= 5 attempts AND >= 90%
 *     -> mastered
 */
function calculateMastery(
  attempts: number,
  successfulAttempts: number
): MasteryLevel {
  if (
    attempts <= 0
  ) {
    return "not_started";
  }

  const successRate =
    successfulAttempts /
    attempts;

  if (
    attempts >= 5 &&
    successRate >= 0.9
  ) {
    return "mastered";
  }

  if (
    attempts >= 3 &&
    successRate >= 0.75
  ) {
    return "proficient";
  }

  if (
    successRate >= 0.5
  ) {
    return "developing";
  }

  return "learning";
}


/* =========================================================
   SET CURRENT LESSON
========================================================= */

/**
 * Set the lesson the student is currently working on.
 *
 * This does NOT mark the lesson complete.
 */
export async function setCurrentLesson(
  studentId: string,
  lessonId: string
): Promise<StudentProgress> {
  assertOwnProgress(
    studentId
  );

  const progress =
    await getProgress(
      studentId
    );

  progress.currentLessonId =
    lessonId;

  return saveProgress(
    progress
  );
}


/* =========================================================
   COMPLETE LESSON
========================================================= */

/**
 * Explicitly mark a lesson as completed.
 *
 * This is useful when lesson completion is handled
 * separately from an individual evaluation.
 */
export async function completeLesson(
  studentId: string,
  lessonId: string
): Promise<StudentProgress> {
  assertOwnProgress(
    studentId
  );

  const progress =
    await getProgress(
      studentId
    );

  if (
    !progress.completedLessonIds.includes(
      lessonId
    )
  ) {
    progress.completedLessonIds.push(
      lessonId
    );
  }

  progress.currentLessonId =
    lessonId;

  return saveProgress(
    progress
  );
}


/* =========================================================
   RESET PROGRESS
========================================================= */

/**
 * Reset the authenticated user's aggregate progress.
 *
 * This only affects the aggregate `progress` table.
 *
 * It does NOT delete:
 *
 * - lesson_progress
 * - course_progress
 * - concept_progress
 * - user_stats
 * - xp_transactions
 *
 * Those are separate systems and should only be reset
 * deliberately through their own stores/services.
 */
export async function resetProgress(
  studentId: string
): Promise<StudentProgress> {
  assertOwnProgress(
    studentId
  );

  return saveProgress(
    createEmptyProgress(
      studentId
    )
  );
}