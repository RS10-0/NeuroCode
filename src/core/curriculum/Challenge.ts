export type Difficulty =
  | "Beginner"
  | "Intermediate"
  | "Advanced";

export interface Challenge {
  id: string;

  title: string;

  prompt: string;

  difficulty: Difficulty;

  conceptIds: string[];

  starterCode: string;

  solution: string;
}