export interface Attempt {
  id: string;

  challengeId: string;

  studentId: string;

  submittedCode:   string;

  submittedAt: string;

  correct: boolean;

  score: number;

  feedback?: string;

  conceptsDemonstrated: string[];

  conceptsStruggledWith: string[];
}