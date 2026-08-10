import type {
  Progress,
  ConceptProgress,
  MasteryLevel,
} from "./Progress";

import type { Evaluation } from "../evaluation/Evaluation";

const API_BASE_URL = "http://localhost:3001";

export class ProgressEngine {
  private progress: Progress;

  constructor(studentId: string) {
    this.progress = {
      studentId,
      completedLessonIds: [],
      conceptProgress: [],
    };
  }

  getProgress(): Progress {
    return this.progress;
  }

  getConceptProgress(
    conceptId: string
  ): ConceptProgress | undefined {
    return this.progress.conceptProgress.find(
      (item) => item.conceptId === conceptId
    );
  }

  async loadProgress(): Promise<Progress> {
    const response = await fetch(
      `${API_BASE_URL}/api/progress/${this.progress.studentId}`
    );

    if (!response.ok) {
      throw new Error(
        "Unable to load student progress."
      );
    }

    const progress =
      (await response.json()) as Progress;

    this.progress = progress;

    return this.progress;
  }

  async saveProgress(): Promise<Progress> {
    const response = await fetch(
      `${API_BASE_URL}/api/progress/${this.progress.studentId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.progress),
      }
    );

    if (!response.ok) {
      throw new Error(
        "Unable to save student progress."
      );
    }

    const savedProgress =
      (await response.json()) as Progress;

    this.progress = savedProgress;

    return this.progress;
  }

  async recordEvaluation(
    conceptIds: string[],
    evaluation: Evaluation
  ): Promise<void> {
    for (const conceptId of conceptIds) {
      const existing =
        this.getConceptProgress(conceptId);

      if (existing) {
        existing.attempts += 1;

        if (evaluation.status === "correct") {
          existing.successfulAttempts += 1;
        }

        existing.mastery =
          this.calculateMastery(
            existing.attempts,
            existing.successfulAttempts
          );

        existing.lastAttemptAt =
          new Date().toISOString();
      } else {
        const attempts = 1;

        const successfulAttempts =
          evaluation.status === "correct"
            ? 1
            : 0;

        this.progress.conceptProgress.push({
          conceptId,
          attempts,
          successfulAttempts,
          mastery: this.calculateMastery(
            attempts,
            successfulAttempts
          ),
          lastAttemptAt:
            new Date().toISOString(),
        });
      }
    }

    await this.saveProgress();
  }

  async markLessonCompleted(
    lessonId: string
  ): Promise<void> {
    if (
      !this.progress.completedLessonIds.includes(
        lessonId
      )
    ) {
      this.progress.completedLessonIds.push(
        lessonId
      );
    }

    await this.saveProgress();
  }

  isLessonCompleted(
    lessonId: string
  ): boolean {
    return this.progress.completedLessonIds.includes(
      lessonId
    );
  }

  async setCurrentLesson(
    lessonId: string
  ): Promise<void> {
    this.progress.currentLessonId =
      lessonId;

    await this.saveProgress();
  }

  private calculateMastery(
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
}