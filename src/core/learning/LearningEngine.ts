import type { Curriculum } from "../curriculum/Curriculum";
import type { Lesson } from "../curriculum/Lesson";
import type { Challenge } from "../curriculum/Challenge";
import type { Concept } from "../curriculum/Concept";

export class LearningEngine {
  private curriculum: Curriculum;

  constructor(curriculum: Curriculum) {
    this.curriculum = curriculum;
  }

  /*
   * -------------------------------------------------------
   * CURRICULUM
   * -------------------------------------------------------
   */

  getCurriculum(): Curriculum {
    return this.curriculum;
  }

  /*
   * -------------------------------------------------------
   * LESSONS
   * -------------------------------------------------------
   */

  getLessons(): Lesson[] {
    return this.curriculum.lessons;
  }

  getLesson(
    lessonId: string
  ): Lesson | undefined {
    return this.curriculum.lessons.find(
      (lesson) => lesson.id === lessonId
    );
  }

  getLessonsForCourse(
    courseId: string
  ): Lesson[] {
    return this.curriculum.lessons.filter(
      (lesson) =>
        lesson.courseId === courseId
    );
  }

  getLessonCount(
    courseId?: string
  ): number {
    if (!courseId) {
      return this.curriculum.lessons.length;
    }

    return this.getLessonsForCourse(
      courseId
    ).length;
  }

  /*
   * -------------------------------------------------------
   * CHALLENGES
   * -------------------------------------------------------
   */

  getChallenges(): Challenge[] {
    return this.curriculum.challenges;
  }

  getChallenge(
    challengeId: string
  ): Challenge | undefined {
    return this.curriculum.challenges.find(
      (challenge) =>
        challenge.id === challengeId
    );
  }

  getLessonChallenges(
    lessonId: string
  ): Challenge[] {
    const lesson =
      this.getLesson(lessonId);

    if (!lesson) {
      return [];
    }

    return lesson.challengeIds
      .map((challengeId) =>
        this.getChallenge(challengeId)
      )
      .filter(
        (
          challenge
        ): challenge is Challenge =>
          challenge !== undefined
      );
  }

  /*
   * -------------------------------------------------------
   * CONCEPTS
   * -------------------------------------------------------
   */

  getConcepts(): Concept[] {
    return this.curriculum.concepts;
  }

  getConcept(
    conceptId: string
  ): Concept | undefined {
    return this.curriculum.concepts.find(
      (concept) =>
        concept.id === conceptId
    );
  }

  getLessonConcepts(
    lessonId: string
  ): Concept[] {
    const lesson =
      this.getLesson(lessonId);

    if (!lesson) {
      return [];
    }

    return lesson.conceptIds
      .map((conceptId) =>
        this.getConcept(conceptId)
      )
      .filter(
        (
          concept
        ): concept is Concept =>
          concept !== undefined
      );
  }

  /*
   * -------------------------------------------------------
   * LESSON PROGRESSION / UNLOCKING
   * -------------------------------------------------------
   */

  isLessonUnlocked(
    lessonId: string,
    completedLessonIds: string[]
  ): boolean {
    const lesson =
      this.getLesson(lessonId);

    if (!lesson) {
      return false;
    }

    /*
     * A lesson with no prerequisites is
     * available immediately.
     */

    if (
      lesson.prerequisites.length === 0
    ) {
      return true;
    }

    /*
     * Every prerequisite lesson must
     * be completed before this lesson
     * becomes available.
     */

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

  getLockedLessons(
    completedLessonIds: string[]
  ): Lesson[] {
    return this.curriculum.lessons.filter(
      (lesson) =>
        !this.isLessonUnlocked(
          lesson.id,
          completedLessonIds
        )
    );
  }

  /*
   * -------------------------------------------------------
   * LESSON COMPLETION
   * -------------------------------------------------------
   */

  isLessonCompleted(
    lessonId: string,
    completedLessonIds: string[]
  ): boolean {
    return completedLessonIds.includes(
      lessonId
    );
  }

  /*
   * -------------------------------------------------------
   * COURSE PROGRESS
   * -------------------------------------------------------
   */

  getCourseProgress(
    courseId: string,
    completedLessonIds: string[]
  ): number {
    const lessons =
      this.getLessonsForCourse(courseId);

    if (lessons.length === 0) {
      return 0;
    }

    const completedCount =
      lessons.filter((lesson) =>
        completedLessonIds.includes(
          lesson.id
        )
      ).length;

    return Math.round(
      (completedCount /
        lessons.length) *
        100
    );
  }

  getCompletedLessons(
    courseId: string,
    completedLessonIds: string[]
  ): Lesson[] {
    return this.getLessonsForCourse(
      courseId
    ).filter((lesson) =>
      completedLessonIds.includes(
        lesson.id
      )
    );
  }

  getNextLesson(
    courseId: string,
    completedLessonIds: string[]
  ): Lesson | undefined {
    return this.getLessonsForCourse(
      courseId
    ).find(
      (lesson) =>
        !completedLessonIds.includes(
          lesson.id
        ) &&
        this.isLessonUnlocked(
          lesson.id,
          completedLessonIds
        )
    );
  }
}
