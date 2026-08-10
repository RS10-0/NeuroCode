export type EvaluationStatus =
  | "correct"
  | "incorrect"
  | "error";

export interface Evaluation {
  status: EvaluationStatus;

  score: number;

  message: string;

  hints: string[];

  conceptsDemonstrated: string[];

  conceptsStruggledWith: string[];
}