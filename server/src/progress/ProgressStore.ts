import { supabase } from "../lib/supabase";

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

function rowToProgress(
  row: ProgressRow
): StudentProgress {
  return {
    studentId: row.user_id,
    completedLessonIds:
      row.completed_lesson_ids ?? [],
    conceptProgress:
      row.concept_progress ?? [],
    currentLessonId:
      row.current_lesson_id ?? undefined,
  };
}

function progressToRow(
  progress: StudentProgress
): ProgressRow {
  return {
    user_id: progress.studentId,
    completed_lesson_ids:
      progress.completedLessonIds,
    concept_progress:
      progress.conceptProgress,
    current_lesson_id:
      progress.currentLessonId ?? null,
    updated_at:
      new Date().toISOString(),
  };
}

function createEmptyProgress(
  studentId: string
): StudentProgress {
  return {
    studentId,
    completedLessonIds: [],
    conceptProgress: [],
  };
}

export async function getProgress(
  studentId: string
): Promise<StudentProgress> {
  const { data, error } =
    await supabase
      .from("progress")
      .select("*")
      .eq("user_id", studentId)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load progress: ${error.message}`
    );
  }

  if (!data) {
    return createEmptyProgress(
      studentId
    );
  }

  return rowToProgress(
    data as ProgressRow
  );
}

export async function saveProgress(
  progress: StudentProgress
): Promise<StudentProgress> {
  const row =
    progressToRow(progress);

  const { data, error } =
    await supabase
      .from("progress")
      .upsert(row, {
        onConflict: "user_id",
      })
      .select()
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

export async function recordEvaluation(
  studentId: string,
  lessonId: string,
  conceptIds: string[],
  correct: boolean
): Promise<StudentProgress> {
  const progress =
    await getProgress(studentId);

  const now =
    new Date().toISOString();

  for (const conceptId of conceptIds) {
    const existing =
      progress.conceptProgress.find(
        (item) =>
          item.conceptId === conceptId
      );

    if (existing) {
      existing.attempts += 1;

      if (correct) {
        existing.successfulAttempts += 1;
      }

      existing.mastery =
        calculateMastery(
          existing.attempts,
          existing.successfulAttempts
        );

      existing.lastAttemptAt = now;
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
        lastAttemptAt: now,
      });
    }
  }

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

  progress.currentLessonId =
    lessonId;

  return saveProgress(progress);
}

function calculateMastery(
  attempts: number,
  successfulAttempts: number
): MasteryLevel {
  if (attempts === 0) {
    return "not_started";
  }

  const successRate =
    successfulAttempts / attempts;

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

  if (successRate >= 0.5) {
    return "developing";
  }

  return "learning";
}

export async function setCurrentLesson(
  studentId: string,
  lessonId: string
): Promise<StudentProgress> {
  const progress =
    await getProgress(studentId);

  progress.currentLessonId =
    lessonId;

  return saveProgress(progress);
}