export interface Lesson {
  id: string;

  number: number;

  title: string;

  description: string;

  language: string;

  conceptIds: string[];

  challengeIds: string[];

  prerequisites: string[];
}