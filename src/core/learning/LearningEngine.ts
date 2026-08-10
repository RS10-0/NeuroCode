import type { Curriculum } from "../curriculum/Curriculum";
import type { Lesson } from "../curriculum/Lesson";
import type { Challenge } from "../curriculum/Challenge";
import type { Concept } from "../curriculum/Concept";

export class LearningEngine {
private curriculum: Curriculum;

constructor(curriculum: Curriculum) {
  this.curriculum = curriculum;
}
  getCurriculum(): Curriculum {
    return this.curriculum;
  }

  getLessons(): Lesson[] {
    return this.curriculum.lessons;
  }

  getLesson(lessonId: string): Lesson | undefined {
    return this.curriculum.lessons.find(
      (lesson) => lesson.id === lessonId
    );
  }

  getChallenges(): Challenge[] {
    return this.curriculum.challenges;
  }

  getChallenge(
    challengeId: string
  ): Challenge | undefined {
    return this.curriculum.challenges.find(
      (challenge) => challenge.id === challengeId
    );
  }

  getLessonChallenges(
    lessonId: string
  ): Challenge[] {
    const lesson = this.getLesson(lessonId);

    if (!lesson) {
      return [];
    }

    return lesson.challengeIds
      .map((challengeId) =>
        this.getChallenge(challengeId)
      )
      .filter(
        (challenge): challenge is Challenge =>
          challenge !== undefined
      );
  }

  getConcepts(): Concept[] {
    return this.curriculum.concepts;
  }

  getConcept(
    conceptId: string
  ): Concept | undefined {
    return this.curriculum.concepts.find(
      (concept) => concept.id === conceptId
    );
  }

  getLessonConcepts(
    lessonId: string
  ): Concept[] {
    const lesson = this.getLesson(lessonId);

    if (!lesson) {
      return [];
    }

    return lesson.conceptIds
      .map((conceptId) =>
        this.getConcept(conceptId)
      )
      .filter(
        (concept): concept is Concept =>
          concept !== undefined
      );
  }

  isLessonUnlocked(
    lessonId: string,
    completedLessonIds: string[]
  ): boolean {
    const lesson = this.getLesson(lessonId);

    if (!lesson) {
      return false;
    }

    return lesson.prerequisites.every(
      (prerequisiteId) =>
        completedLessonIds.includes(
          prerequisiteId
        )
    );
  }

  getUnlockedLessons(
    completedLessonIds: string[]
  ): Lesson[] {
    return this.curriculum.lessons.filter(
      (lesson) =>
        this.isLessonUnlocked(
          lesson.id,
          completedLessonIds
        )
    );
  }
}
