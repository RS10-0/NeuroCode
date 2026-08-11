import type { Progress } from "../../../src/core/progress/Progress";

import {
  getProgress as getStoredProgress,
  saveProgress as saveStoredProgress,
  recordEvaluation as recordStoredEvaluation,
  setCurrentLesson as setStoredCurrentLesson,
} from "./ProgressStore";

export async function getProgress(
  studentId: string
): Promise<Progress> {
  return getStoredProgress(studentId);
}

export async function saveProgress(
  progress: Progress
): Promise<Progress> {
  return saveStoredProgress(progress);
}

export async function recordEvaluation(
  studentId: string,
  lessonId: string,
  conceptIds: string[],
  correct: boolean
): Promise<Progress> {
  return recordStoredEvaluation(
    studentId,
    lessonId,
    conceptIds,
    correct
  );
}

export async function setCurrentLesson(
  studentId: string,
  lessonId: string
): Promise<Progress> {
  return setStoredCurrentLesson(
    studentId,
    lessonId
  );
}