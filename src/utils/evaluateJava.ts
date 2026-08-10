export type EvaluationResult = {
  correct: boolean;
  message: string;
  hint?: string;
};

export function evaluateJava(
  code: string,
  expectedSolution: string
): EvaluationResult {
  const normalizedCode = code
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  const normalizedSolution = expectedSolution
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (!normalizedCode) {
    return {
      correct: false,
      message: "You haven't written any code yet.",
      hint: "Start by writing the code described in the challenge.",
    };
  }

  // Exact match
  if (normalizedCode === normalizedSolution) {
    return {
      correct: true,
      message: "Correct! 🎉",
    };
  }

  // Java variable challenge
  if (
    normalizedCode.includes("int score = 100") ||
    normalizedCode.includes("int score=100")
  ) {
    return {
      correct: true,
      message: "Correct! 🎉",
    };
  }

  // Java double challenge
  if (
    normalizedCode.includes("double price = 19.99") ||
    normalizedCode.includes("double price=19.99")
  ) {
    return {
      correct: true,
      message: "Correct! 🎉",
    };
  }

  // Java conditional challenge
  const hasIf = normalizedCode.includes("if");
  const checksScore = normalizedCode.includes("score");
  const checksSixty = normalizedCode.includes(">= 60");
  const printsPass =
    normalizedCode.includes('println("pass")') ||
    normalizedCode.includes('println("pass");');

  if (hasIf && checksScore && checksSixty && printsPass) {
    return {
      correct: true,
      message: "Correct! 🎉",
    };
  }

  return {
    correct: false,
    message: "Not quite yet.",
    hint: "Check the requirements of the challenge and try again.",
  };
}