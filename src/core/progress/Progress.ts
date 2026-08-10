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

export interface Progress {
  studentId: string;

  completedLessonIds: string[];

  conceptProgress: ConceptProgress[];

  currentLessonId?: string;
}
