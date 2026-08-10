import type { Concept } from "./Concept";
import type { Lesson } from "./Lesson";
import type { Challenge } from "./Challenge";

export interface Curriculum {
  id: string;
  name: string;
  language: string;

  concepts: Concept[];
  lessons: Lesson[];
  challenges: Challenge[];
}