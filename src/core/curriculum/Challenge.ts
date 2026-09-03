export type Difficulty =
  | "Beginner"
  | "Intermediate"
  | "Advanced";

export type ChallengeType =
  | "multiple-choice"
  | "prompt-building"
  | "prompt-fixing"
  | "scenario"
  | "free-response";

export interface Challenge {
  id: string;

  title: string;

  prompt: string;

  difficulty: Difficulty;

  type: ChallengeType;

  conceptIds: string[];

  options?: {
    id: string;
    text: string;
  }[];

  correctAnswer?: string;

  sampleAnswer?: string;

  hints?: string[];

  explanation?: string;
}
