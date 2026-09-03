import { supabase } from "./supabase";

/* =========================================================
   TYPES
========================================================= */

export type CourseStatus =
  | "in_progress"
  | "completed";

export type LessonStatus =
  | "in_progress"
  | "completed";

export interface CourseProgress {
  id: string;
  user_id: string;

  /*
   * IMPORTANT:
   * The Supabase database column is actually named
   * course_id.
   *
   * Keep the TypeScript property named course_id so
   * the rest of the application can continue using
   * the normal course ID terminology.
   */
  course_id: string;

  status: CourseStatus;

  /* 0-100. How much of the course's lessons are finished. */
  progress_percent: number;

  /* Where to drop the learner back in. */
  current_lesson_id: string | null;

  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface LessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  completed: boolean;
  attempts: number;
  successful_attempts: number;
  mastery: string | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  status: LessonStatus;
}

export interface ConceptProgress {
  id: string;
  user_id: string;
  concept_id: string;
  mastery: string | null;
  attempts: number;
  successful_attempts: number;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserStats {
  id: string;
  user_id: string;
  xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  total_lessons_completed: number;
  total_challenges_completed: number;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  project_type: string;
  environment: "ai" | "programming";
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}


/* =========================================================
   AUTH HELPER
========================================================= */

/*
 * The signed-in user's id.
 *
 * Reads the cached session rather than calling getUser(), which
 * is a round trip to the auth server on every invocation — the
 * course map calls this once per lesson, so getUser() turned one
 * page load into a dozen sequential network calls.
 *
 * The id is only ever used to build a query filter. RLS is what
 * actually enforces ownership, and it derives auth.uid() from
 * the token the client sends, not from anything passed in here.
 */
async function getCurrentUserId(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw new Error(
      `Authentication error: ${error.message}`
    );
  }

  if (!session?.user) {
    throw new Error(
      "You must be logged in to save progress."
    );
  }

  return session.user.id;
}


/* =========================================================
   COURSE PROGRESS
========================================================= */

/**
 * Convert the database row into the application's
 * CourseProgress shape.
 *
 * Database:
 *   course_id
 *
 * Application:
 *   course_id
 */
function normalizeCourseProgress(
  row: Record<string, unknown>
): CourseProgress {
  return {
    id: String(row.id),
    user_id: String(row.user_id),

    course_id: String(
      row.course_id
    ),

    status:
      row.status === "completed"
        ? "completed"
        : "in_progress",

    progress_percent: Number(
      row.progress_percent ?? 0
    ),

    current_lesson_id:
      row.current_lesson_id
        ? String(row.current_lesson_id)
        : null,

    started_at: String(
      row.started_at
    ),

    completed_at:
      row.completed_at
        ? String(row.completed_at)
        : null,

    updated_at: String(
      row.updated_at
    ),
  };
}


/**
 * Get the current user's progress for a course.
 *
 * IMPORTANT:
 * Supabase column is:
 *
 *   course_id
 *
 * NOT:
 *
 *   course_id
 */
export async function getCourseProgress(
  courseId: string
): Promise<CourseProgress | null> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("course_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load course progress: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return normalizeCourseProgress(
    data
  );
}


/*
 * Writes the course row, creating it when absent.
 *
 * One code path for start, resume and complete: every caller
 * ends up needing the same insert-or-update, and splitting it
 * three ways is how `progress_percent` and `current_lesson_id`
 * ended up never being written at all.
 */
async function writeCourseProgress(
  courseId: string,
  patch: {
    status?: CourseStatus;
    progressPercent?: number;
    currentLessonId?: string | null;
    completedAt?: string | null;
  }
): Promise<CourseProgress> {
  const userId =
    await getCurrentUserId();

  const existing =
    await getCourseProgress(
      courseId
    );

  const now =
    new Date().toISOString();

  const fields: Record<
    string,
    unknown
  > = {
    updated_at: now,
  };

  if (
    patch.status !== undefined
  ) {
    fields.status =
      patch.status;
  }

  if (
    patch.progressPercent !==
    undefined
  ) {
    fields.progress_percent =
      Math.min(
        100,
        Math.max(
          0,
          patch.progressPercent
        )
      );
  }

  if (
    patch.currentLessonId !==
    undefined
  ) {
    fields.current_lesson_id =
      patch.currentLessonId;
  }

  if (
    patch.completedAt !==
    undefined
  ) {
    fields.completed_at =
      patch.completedAt;
  }

  if (existing) {
    const {
      data,
      error,
    } = await supabase
      .from("course_progress")
      .update(fields)
      .eq(
        "id",
        existing.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(
        `Failed to update course progress: ${error.message}`
      );
    }

    return normalizeCourseProgress(
      data
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("course_progress")
    .upsert(
      {
        user_id:
          userId,

        course_id:
          courseId,

        status:
          patch.status ??
          "in_progress",

        progress_percent:
          fields.progress_percent ??
          0,

        current_lesson_id:
          patch.currentLessonId ??
          null,

        started_at:
          now,

        completed_at:
          patch.completedAt ??
          null,

        updated_at:
          now,
      },
      {
        onConflict:
          "user_id,course_id",

        ignoreDuplicates:
          true,
      }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to start course: ${error.message}`
    );
  }

  /*
   * Same race as startLesson: the course row is opened from the
   * lesson player's mount effect, which StrictMode runs twice.
   *
   * ignoreDuplicates makes this ON CONFLICT DO NOTHING, so the
   * loser loses quietly instead of taking a 409 — and gets back
   * no row, which is what says it lost.
   *
   * Deliberately not a merging upsert. The row above is a whole
   * row assembled from a partial patch, so merging it would
   * push started_at and a defaulted progress_percent over
   * whatever the winner wrote. The loser instead reads the
   * winner's row and applies its patch to it, so no update is
   * silently dropped.
   */
  if (!data) {
    const raced =
      await getCourseProgress(
        courseId
      );

    if (raced) {
      const {
        data: patched,
        error: patchError,
      } = await supabase
        .from("course_progress")
        .update(fields)
        .eq(
          "id",
          raced.id
        )
        .eq(
          "user_id",
          userId
        )
        .select("*")
        .single();

      if (patchError) {
        throw new Error(
          `Failed to update course progress: ${patchError.message}`
        );
      }

      return normalizeCourseProgress(
        patched
      );
    }

    throw new Error(
      "Failed to start course: the conflicting row could not be read back"
    );
  }

  return normalizeCourseProgress(
    data
  );
}


/**
 * Start or resume a course.
 *
 * A finished course is left alone — reopening lesson one does
 * not un-complete it.
 */
export async function startCourse(
  courseId: string,
  currentLessonId?: string
): Promise<CourseProgress> {
  const existing =
    await getCourseProgress(
      courseId
    );

  if (
    existing &&
    existing.status ===
      "completed"
  ) {
    return existing;
  }

  return writeCourseProgress(
    courseId,
    {
      status:
        "in_progress",

      currentLessonId:
        currentLessonId ??
        undefined,
    }
  );
}


/**
 * Mark a course as completed.
 */
export async function completeCourse(
  courseId: string
): Promise<CourseProgress> {
  return writeCourseProgress(
    courseId,
    {
      status:
        "completed",

      progressPercent:
        100,

      completedAt:
        new Date().toISOString(),
    }
  );
}


/**
 * Bring the course row in line with the lessons actually
 * finished.
 *
 * Called after a lesson completes, so the course map and the
 * course row can never disagree about how far along a learner
 * is. Completing the last lesson completes the course.
 */
export async function syncCourseProgress(
  courseId: string,
  completedLessonCount: number,
  totalLessonCount: number,
  nextLessonId: string | null
): Promise<CourseProgress> {
  const percent =
    totalLessonCount > 0
      ? Math.round(
          (completedLessonCount /
            totalLessonCount) *
            100
        )
      : 0;

  const isComplete =
    totalLessonCount > 0 &&
    completedLessonCount >=
      totalLessonCount;

  return writeCourseProgress(
    courseId,
    {
      status:
        isComplete
          ? "completed"
          : "in_progress",

      progressPercent:
        percent,

      currentLessonId:
        nextLessonId,

      completedAt:
        isComplete
          ? new Date().toISOString()
          : null,
    }
  );
}


/* =========================================================
   LESSON PROGRESS
========================================================= */

/**
 * Get progress for a lesson.
 *
 * Database table:
 *
 *   lesson_progress
 */
export async function getLessonProgress(
  lessonId: string
): Promise<LessonProgress | null> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("lesson_progress")
    .select("*")
    .eq(
      "user_id",
      userId
    )
    .eq(
      "lesson_id",
      lessonId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load lesson progress: ${error.message}`
    );
  }

  return data;
}


/**
 * Every lesson row the learner has, for the ids given.
 *
 * One request instead of one per lesson. Lessons with no row
 * are simply absent from the map, which callers read as
 * "not started".
 */
export async function getLessonProgressMap(
  lessonIds: string[]
): Promise<Record<string, LessonProgress>> {
  if (
    lessonIds.length === 0
  ) {
    return {};
  }

  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("lesson_progress")
    .select("*")
    .eq(
      "user_id",
      userId
    )
    .in(
      "lesson_id",
      lessonIds
    );

  if (error) {
    throw new Error(
      `Failed to load lesson progress: ${error.message}`
    );
  }

  const map: Record<
    string,
    LessonProgress
  > = {};

  (data ?? []).forEach(
    (row: LessonProgress) => {
      map[row.lesson_id] = row;
    }
  );

  return map;
}


/**
 * Start or resume a lesson.
 */
export async function startLesson(
  lessonId: string
): Promise<LessonProgress> {
  const userId =
    await getCurrentUserId();

  const existing =
    await getLessonProgress(
      lessonId
    );

  const now =
    new Date().toISOString();


  /*
   * Never reset completed lessons.
   */
  if (
    existing &&
    existing.status ===
      "completed"
  ) {
    return existing;
  }


  /*
   * Resume existing lesson.
   */
  if (existing) {
    const {
      data,
      error,
    } = await supabase
      .from("lesson_progress")
      .update({
        status:
          "in_progress",

        completed:
          false,

        updated_at:
          now,
      })
      .eq(
        "id",
        existing.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(
        `Failed to resume lesson: ${error.message}`
      );
    }

    return data;
  }


  /*
   * Create new lesson progress.
   */
  const {
    data,
    error,
  } = await supabase
    .from("lesson_progress")
    .upsert(
      {
        user_id:
          userId,

        lesson_id:
          lessonId,

        completed:
          false,

        attempts:
          0,

        successful_attempts:
          0,

        mastery:
          null,

        last_attempt_at:
          null,

        status:
          "in_progress",

        created_at:
          now,

        updated_at:
          now,
      },
      {
        onConflict:
          "user_id,lesson_id",

        ignoreDuplicates:
          true,
      }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to start lesson: ${error.message}`
    );
  }

  /*
   * Two callers can pass the "no row yet" check at once and both
   * try to write — StrictMode remounts the player's effect in
   * development, which does exactly that, and one write always
   * lost with a 409 in the console.
   *
   * ignoreDuplicates makes this ON CONFLICT DO NOTHING, so the
   * loser is turned away silently and gets back no row instead
   * of an error. Deliberately not a merging upsert — the row
   * above is a fresh, zeroed one, so merging it would overwrite
   * a lesson somebody had already completed.
   *
   * The unique index on (user_id, lesson_id) is what makes the
   * recovery safe: whoever lost the race simply reads the row
   * the winner wrote.
   */
  if (!data) {
    const existingRow =
      await getLessonProgress(
        lessonId
      );

    if (existingRow) {
      return existingRow;
    }

    throw new Error(
      "Failed to start lesson: the conflicting row could not be read back"
    );
  }

  return data;
}


/**
 * Mark a lesson as completed.
 *
 * IMPORTANT:
 * The lesson itself is marked complete first.
 *
 * Updating user_stats is treated separately so a
 * stats problem does not make a successful lesson
 * completion look like it failed.
 */
export async function completeLesson(
  lessonId: string
): Promise<LessonProgress> {
  const userId =
    await getCurrentUserId();

  const existing =
    await getLessonProgress(
      lessonId
    );

  const now =
    new Date().toISOString();


  /*
   * Already completed.
   *
   * Do not increment stats again.
   */
  if (
    existing &&
    existing.completed
  ) {
    return existing;
  }


  let completedLesson:
    LessonProgress;


  /*
   * Update existing lesson.
   */
  if (existing) {
    const {
      data,
      error,
    } = await supabase
      .from("lesson_progress")
      .update({
        completed:
          true,

        status:
          "completed",

        last_attempt_at:
          now,

        updated_at:
          now,
      })
      .eq(
        "id",
        existing.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(
        `Failed to complete lesson: ${error.message}`
      );
    }

    completedLesson =
      data;
  }


  /*
   * Create completed lesson.
   */
  else {
    const {
      data,
      error,
    } = await supabase
      .from("lesson_progress")
      .upsert(
        {
          user_id:
            userId,

          lesson_id:
            lessonId,

          completed:
            true,

          attempts:
            0,

          successful_attempts:
            0,

          mastery:
            null,

          last_attempt_at:
            now,

          status:
            "completed",

          created_at:
            now,

          updated_at:
            now,
        },
        {
          onConflict:
            "user_id,lesson_id",

          ignoreDuplicates:
            true,
        }
      )
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to create completed lesson: ${error.message}`
      );
    }


    /*
     * Same race as startLesson, reached when a lesson is
     * finished before any row exists for it. ON CONFLICT DO
     * NOTHING means no row comes back when somebody else got
     * there first.
     *
     * Not a merging upsert: the row above carries a zeroed
     * attempts count and a null mastery, so merging it would
     * wipe the attempt history the winner recorded. Take the
     * winner's row and mark that completed instead.
     */
    if (!data) {
      const raced =
        await getLessonProgress(
          lessonId
        );

      if (!raced) {
        throw new Error(
          "Failed to create completed lesson: the conflicting row could not be read back"
        );
      }


      /*
       * Already finished by the winner — return without
       * touching stats a second time, exactly as the
       * already-completed check above would have.
       */
      if (raced.completed) {
        return raced;
      }

      const {
        data: patched,
        error: patchError,
      } = await supabase
        .from("lesson_progress")
        .update({
          completed:
            true,

          status:
            "completed",

          last_attempt_at:
            now,

          updated_at:
            now,
        })
        .eq(
          "id",
          raced.id
        )
        .eq(
          "user_id",
          userId
        )
        .select("*")
        .single();

      if (patchError) {
        throw new Error(
          `Failed to complete lesson: ${patchError.message}`
        );
      }

      completedLesson =
        patched;
    } else {
      completedLesson =
        data;
    }
  }


  /*
   * Update user statistics.
   *
   * IMPORTANT:
   * Failure here does NOT throw a lesson-completion
   * error because the lesson has already been saved.
   */
  try {
    const stats =
      await getUserStats();

    const {
      error: statsError,
    } = await supabase
      .from("user_stats")
      .update({
        total_lessons_completed:
          stats.total_lessons_completed +
          1,

        updated_at:
          now,
      })
      .eq(
        "user_id",
        userId
      );

    if (statsError) {
      console.error(
        "Lesson completed, but user stats could not be updated:",
        statsError
      );
    }
  } catch (statsError) {
    console.error(
      "Lesson completed, but user stats could not be loaded:",
      statsError
    );
  }


  return completedLesson;
}


/**
 * Record a lesson attempt.
 */
export async function recordLessonAttempt(
  lessonId: string,
  successful: boolean,
  mastery?: string
): Promise<LessonProgress> {
  const userId =
    await getCurrentUserId();

  const existing =
    await getLessonProgress(
      lessonId
    );

  const attempts =
    (existing?.attempts ?? 0) +
    1;

  const successfulAttempts =
    (existing?.successful_attempts ??
      0) +
    (successful
      ? 1
      : 0);

  const now =
    new Date().toISOString();


  /*
   * Update existing lesson.
   */
  if (existing) {
    const {
      data,
      error,
    } = await supabase
      .from("lesson_progress")
      .update({
        attempts,

        successful_attempts:
          successfulAttempts,

        mastery:
          mastery ??
          existing.mastery ??
          null,

        last_attempt_at:
          now,

        updated_at:
          now,
      })
      .eq(
        "id",
        existing.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(
        `Failed to record lesson attempt: ${error.message}`
      );
    }

    return data;
  }


  /*
   * Create lesson progress.
   */
  const {
    data,
    error,
  } = await supabase
    .from("lesson_progress")
    .upsert(
      {
        user_id:
          userId,

        lesson_id:
          lessonId,

        completed:
          false,

        status:
          "in_progress",

        attempts,

        successful_attempts:
          successfulAttempts,

        mastery:
          mastery ??
          null,

        last_attempt_at:
          now,

        created_at:
          now,

        updated_at:
          now,
      },
      {
        onConflict:
          "user_id,lesson_id",

        ignoreDuplicates:
          true,
      }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to record lesson attempt: ${error.message}`
    );
  }


  /*
   * Somebody created the row between the read above and this
   * write. ON CONFLICT DO NOTHING returns no row rather than a
   * 409, and the counts computed above are now stale.
   *
   * A merging upsert would be wrong twice over: it would push a
   * count derived from "no row existed" over the winner's, and
   * it would drag a completed lesson back to in_progress. Count
   * this attempt against the winner's row instead.
   */
  if (!data) {
    const raced =
      await getLessonProgress(
        lessonId
      );

    if (!raced) {
      throw new Error(
        "Failed to record lesson attempt: the conflicting row could not be read back"
      );
    }

    const {
      data: patched,
      error: patchError,
    } = await supabase
      .from("lesson_progress")
      .update({
        attempts:
          (raced.attempts ?? 0) +
          1,

        successful_attempts:
          (raced.successful_attempts ??
            0) +
          (successful
            ? 1
            : 0),

        mastery:
          mastery ??
          raced.mastery ??
          null,

        last_attempt_at:
          now,

        updated_at:
          now,
      })
      .eq(
        "id",
        raced.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (patchError) {
      throw new Error(
        `Failed to record lesson attempt: ${patchError.message}`
      );
    }

    return patched;
  }

  return data;
}


/* =========================================================
   CONCEPT PROGRESS
========================================================= */

export async function getConceptProgress(
  conceptId: string
): Promise<ConceptProgress | null> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("concept_progress")
    .select("*")
    .eq(
      "user_id",
      userId
    )
    .eq(
      "concept_id",
      conceptId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load concept progress: ${error.message}`
    );
  }

  return data;
}


export async function recordConceptAttempt(
  conceptId: string,
  successful: boolean,
  mastery?: string
): Promise<ConceptProgress> {
  const userId =
    await getCurrentUserId();

  const existing =
    await getConceptProgress(
      conceptId
    );

  const attempts =
    (existing?.attempts ?? 0) +
    1;

  const successfulAttempts =
    (existing?.successful_attempts ??
      0) +
    (successful
      ? 1
      : 0);

  const now =
    new Date().toISOString();


  if (existing) {
    const {
      data,
      error,
    } = await supabase
      .from("concept_progress")
      .update({
        attempts,

        successful_attempts:
          successfulAttempts,

        mastery:
          mastery ??
          existing.mastery ??
          null,

        last_attempt_at:
          now,

        updated_at:
          now,
      })
      .eq(
        "id",
        existing.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(
        `Failed to record concept attempt: ${error.message}`
      );
    }

    return data;
  }


  const {
    data,
    error,
  } = await supabase
    .from("concept_progress")
    .upsert(
      {
        user_id:
          userId,

        concept_id:
          conceptId,

        attempts,

        successful_attempts:
          successfulAttempts,

        mastery:
          mastery ??
          null,

        last_attempt_at:
          now,

        created_at:
          now,

        updated_at:
          now,
      },
      {
        onConflict:
          "user_id,concept_id",

        ignoreDuplicates:
          true,
      }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to create concept progress: ${error.message}`
    );
  }


  /*
   * Same race as recordLessonAttempt: the row appeared between
   * the read above and this write, so the counts computed there
   * are stale and ON CONFLICT DO NOTHING hands back no row.
   * Count this attempt against the winner's row rather than
   * merging a stale one over it.
   */
  if (!data) {
    const raced =
      await getConceptProgress(
        conceptId
      );

    if (!raced) {
      throw new Error(
        "Failed to create concept progress: the conflicting row could not be read back"
      );
    }

    const {
      data: patched,
      error: patchError,
    } = await supabase
      .from("concept_progress")
      .update({
        attempts:
          (raced.attempts ?? 0) +
          1,

        successful_attempts:
          (raced.successful_attempts ??
            0) +
          (successful
            ? 1
            : 0),

        mastery:
          mastery ??
          raced.mastery ??
          null,

        last_attempt_at:
          now,

        updated_at:
          now,
      })
      .eq(
        "id",
        raced.id
      )
      .eq(
        "user_id",
        userId
      )
      .select("*")
      .single();

    if (patchError) {
      throw new Error(
        `Failed to record concept attempt: ${patchError.message}`
      );
    }

    return patched;
  }

  return data;
}


/* =========================================================
   USER STATS / XP
========================================================= */

export async function getUserStats(): Promise<UserStats> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("user_stats")
    .select("*")
    .eq(
      "user_id",
      userId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load user stats: ${error.message}`
    );
  }

  if (data) {
    return data;
  }


  const now =
    new Date().toISOString();

  const {
    data: created,
    error: createError,
  } = await supabase
    .from("user_stats")
    .upsert(
      {
        user_id:
          userId,

        xp:
          0,

        level:
          1,

        current_streak:
          0,

        longest_streak:
          0,

        total_lessons_completed:
          0,

        total_challenges_completed:
          0,

        updated_at:
          now,
      },
      {
        onConflict:
          "user_id",

        ignoreDuplicates:
          true,
      }
    )
    .select("*")
    .maybeSingle();

  if (createError) {
    throw new Error(
      `Failed to create user stats: ${createError.message}`
    );
  }

  /*
   * Same race as startLesson, and this one used to reach the
   * screen. Dashboard and the course map both read stats on
   * mount, StrictMode runs each effect twice, and a brand-new
   * learner has no row yet — so two writes collide and the
   * loser threw "Failed to create user stats" straight into the
   * page it was meant to fill.
   *
   * ON CONFLICT DO NOTHING settles it without the 409: the
   * loser gets no row back and reads the winner's instead.
   * Emphatically not a merging upsert — every value above is a
   * starting zero, so merging would reset a learner's XP,
   * level and streaks on any read that lost a race.
   */
  if (!created) {
    const {
      data: raced,
    } = await supabase
      .from("user_stats")
      .select("*")
      .eq(
        "user_id",
        userId
      )
      .maybeSingle();

    if (raced) {
      return raced;
    }

    throw new Error(
      "Failed to create user stats: the conflicting row could not be read back"
    );
  }

  return created;
}


export async function addXP(
  amount: number
): Promise<UserStats> {
  const userId =
    await getCurrentUserId();

  const safeAmount =
    Math.max(
      0,
      Math.floor(amount)
    );

  if (
    safeAmount === 0
  ) {
    return getUserStats();
  }

  const current =
    await getUserStats();

  const newXP =
    current.xp +
    safeAmount;

  const newLevel =
    Math.floor(
      newXP / 500
    ) + 1;

  const now =
    new Date().toISOString();

  const {
    data,
    error,
  } = await supabase
    .from("user_stats")
    .update({
      xp:
        newXP,

      level:
        newLevel,

      updated_at:
        now,
    })
    .eq(
      "user_id",
      userId
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to add XP: ${error.message}`
    );
  }

  return data;
}


export async function updateUserStats(
  updates: {
    xp?: number;
    current_streak?: number;
    longest_streak?: number;
    total_lessons_completed?: number;
    total_challenges_completed?: number;
  }
): Promise<UserStats> {
  const userId =
    await getCurrentUserId();

  const current =
    await getUserStats();

  const newXP =
    updates.xp !== undefined
      ? Math.max(
          0,
          current.xp +
            Math.floor(
              updates.xp
            )
        )
      : current.xp;

  const newLevel =
    Math.floor(
      newXP / 500
    ) + 1;

  const databaseUpdates:
    Record<string, unknown> =
      {
        xp:
          newXP,

        level:
          newLevel,

        updated_at:
          new Date().toISOString(),
      };


  if (
    updates.current_streak !==
    undefined
  ) {
    databaseUpdates.current_streak =
      Math.max(
        0,
        updates.current_streak
      );
  }


  if (
    updates.longest_streak !==
    undefined
  ) {
    databaseUpdates.longest_streak =
      Math.max(
        0,
        updates.longest_streak
      );
  }


  if (
    updates.total_lessons_completed !==
    undefined
  ) {
    databaseUpdates.total_lessons_completed =
      Math.max(
        0,
        updates.total_lessons_completed
      );
  }


  if (
    updates.total_challenges_completed !==
    undefined
  ) {
    databaseUpdates.total_challenges_completed =
      Math.max(
        0,
        updates.total_challenges_completed
      );
  }


  const {
    data,
    error,
  } = await supabase
    .from("user_stats")
    .update(
      databaseUpdates
    )
    .eq(
      "user_id",
      userId
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to update user stats: ${error.message}`
    );
  }

  return data;
}


/* =========================================================
   PROJECTS
========================================================= */

export async function getProjects(): Promise<Project[]> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("projects")
    .select("*")
    .eq(
      "user_id",
      userId
    )
    .order(
      "updated_at",
      {
        ascending:
          false,
      }
    );

  if (error) {
    throw new Error(
      `Failed to load projects: ${error.message}`
    );
  }

  return data ?? [];
}


export async function getProject(
  projectId: string
): Promise<Project | null> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("projects")
    .select("*")
    .eq(
      "id",
      projectId
    )
    .eq(
      "user_id",
      userId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load project: ${error.message}`
    );
  }

  return data;
}


/**
 * Create a project.
 *
 * A plain insert, unlike the progress tables above: projects
 * carries no unique constraint, every call is meant to produce
 * a new row, and two projects sharing a title is allowed. There
 * is no conflict here to resolve.
 */
export async function createProject(
  title: string,
  projectType: string,
  environment:
    | "ai"
    | "programming",
  description = "",
  content: Record<string, unknown> = {}
): Promise<Project> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("projects")
    .insert({
      user_id:
        userId,

      title,

      description,

      project_type:
        projectType,

      environment,

      content,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to create project: ${error.message}`
    );
  }

  return data;
}


export async function updateProject(
  projectId: string,
  updates: {
    title?: string;
    description?: string;
    content?: Record<string, unknown>;
  }
): Promise<Project> {
  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("projects")
    .update({
      ...updates,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      projectId
    )
    .eq(
      "user_id",
      userId
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to update project: ${error.message}`
    );
  }

  return data;
}


export async function deleteProject(
  projectId: string
): Promise<void> {
  const userId =
    await getCurrentUserId();

  const {
    error,
  } = await supabase
    .from("projects")
    .delete()
    .eq(
      "id",
      projectId
    )
    .eq(
      "user_id",
      userId
    );

  if (error) {
    throw new Error(
      `Failed to delete project: ${error.message}`
    );
  }
}
