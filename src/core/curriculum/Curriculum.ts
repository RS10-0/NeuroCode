import type { Concept } from "./Concept";
import type { Lesson } from "./Lesson";
import type { Challenge } from "./Challenge";

export interface Curriculum {
  id: string;

  name: string;

  description: string;

  concepts: Concept[];

  lessons: Lesson[];

  challenges: Challenge[];

  /* Sum of every lesson's XP. Computed at authoring time. */
  totalXp?: number;
}
