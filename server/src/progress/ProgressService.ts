import type { Progress } from "../../../src/core/progress/Progress";

const progressStore = new Map<string, Progress>();

export function getProgress(studentId: string): Progress {
  const existing = progressStore.get(studentId);

  if (existing) {
    return existing;
  }

  const progress: Progress = {
    studentId,
    completedLessonIds: [],
    conceptProgress: [],
  };

  progressStore.set(studentId, progress);

  return progress;
}

export function saveProgress(progress: Progress): Progress {
  progressStore.set(progress.studentId, progress);

  return progress;
}