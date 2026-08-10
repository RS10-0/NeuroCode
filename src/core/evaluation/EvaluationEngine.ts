import type {
  Evaluation,
} from "./Evaluation";

export class EvaluationEngine {
  evaluate(
    code: string,
    expectedAnswer: string,
    conceptIds: string[] = []
  ): Evaluation {
    const normalizedCode = this.normalize(code);
    const normalizedAnswer =
      this.normalize(expectedAnswer);

    // -----------------------------------------
    // EMPTY SUBMISSION
    // -----------------------------------------

    if (!normalizedCode) {
      return {
        status: "error",
        score: 0,
        message:
          "Write some code before submitting.",
        hints: [
          "Start by writing a solution in the editor.",
        ],
        conceptsDemonstrated: [],
        conceptsStruggledWith: conceptIds,
      };
    }

    // -----------------------------------------
    // EXACT MATCH
    // -----------------------------------------

    if (normalizedCode === normalizedAnswer) {
      return {
        status: "correct",
        score: 100,
        message: "Correct! Nice work.",
        hints: [],
        conceptsDemonstrated: conceptIds,
        conceptsStruggledWith: [],
      };
    }

    // -----------------------------------------
    // NORMALIZED CODE MATCH
    // -----------------------------------------

    const codeWithoutWhitespace =
      this.removeWhitespace(normalizedCode);

    const answerWithoutWhitespace =
      this.removeWhitespace(normalizedAnswer);

    if (
      codeWithoutWhitespace ===
      answerWithoutWhitespace
    ) {
      return {
        status: "correct",
        score: 100,
        message: "Correct! Nice work.",
        hints: [],
        conceptsDemonstrated: conceptIds,
        conceptsStruggledWith: [],
      };
    }

    // -----------------------------------------
    // JAVA-SPECIFIC CHECKS
    // -----------------------------------------

    const javaEvaluation =
      this.evaluateJavaPatterns(
        normalizedCode,
        normalizedAnswer,
        conceptIds
      );

    if (javaEvaluation) {
      return javaEvaluation;
    }

    // -----------------------------------------
    // DEFAULT INCORRECT RESULT
    // -----------------------------------------

    return {
      status: "incorrect",
      score: 0,
      message:
        "Your answer doesn't satisfy the challenge yet.",
      hints: [
        "Review the lesson concept.",
        "Check that your code follows the requirements.",
      ],
      conceptsDemonstrated: [],
      conceptsStruggledWith: conceptIds,
    };
  }

  // -----------------------------------------
  // JAVA PATTERN EVALUATION
  // -----------------------------------------

  private evaluateJavaPatterns(
    code: string,
    expectedAnswer: string,
    conceptIds: string[]
  ): Evaluation | null {
    const normalizedCode =
      this.removeComments(code);

    const normalizedExpected =
      this.removeComments(expectedAnswer);

    // -----------------------------------------
    // VARIABLE DECLARATIONS
    // -----------------------------------------

    if (
      normalizedExpected.includes(
        "int score"
      )
    ) {
      const scorePattern =
        /\bint\s+score\s*=\s*100\s*;/i;

      if (scorePattern.test(normalizedCode)) {
        return {
          status: "correct",
          score: 100,
          message:
            "Correct! You created an integer variable named score with the value 100.",
          hints: [],
          conceptsDemonstrated: conceptIds,
          conceptsStruggledWith: [],
        };
      }

      return {
        status: "incorrect",
        score: 0,
        message:
          "You need to create an integer variable named score with the value 100.",
        hints: [
          "Use the int data type.",
          "Name the variable score.",
          "Assign it the value 100.",
        ],
        conceptsDemonstrated: [],
        conceptsStruggledWith: conceptIds,
      };
    }

    // -----------------------------------------
    // DOUBLE DECLARATIONS
    // -----------------------------------------

    if (
      normalizedExpected.includes(
        "double price"
      )
    ) {
      const pricePattern =
        /\bdouble\s+price\s*=\s*19\.99\s*;/i;

      if (pricePattern.test(normalizedCode)) {
        return {
          status: "correct",
          score: 100,
          message:
            "Correct! You created a double variable named price with the value 19.99.",
          hints: [],
          conceptsDemonstrated: conceptIds,
          conceptsStruggledWith: [],
        };
      }

      return {
        status: "incorrect",
        score: 0,
        message:
          "You need to create a double variable named price with the value 19.99.",
        hints: [
          "Use the double data type.",
          "Name the variable price.",
          "Assign it the value 19.99.",
        ],
        conceptsDemonstrated: [],
        conceptsStruggledWith: conceptIds,
      };
    }

    // -----------------------------------------
    // CONDITIONALS
    // -----------------------------------------

    if (
      normalizedExpected.includes(
        "score >= 60"
      )
    ) {
      const conditionPattern =
        /if\s*\(\s*score\s*>=\s*60\s*\)/i;

      const printPattern =
        /system\.out\.println\s*\(\s*"pass"\s*\)/i;

      const hasCondition =
        conditionPattern.test(normalizedCode);

      const hasOutput =
        printPattern.test(normalizedCode);

      if (hasCondition && hasOutput) {
        return {
          status: "correct",
          score: 100,
          message:
            'Correct! Your conditional checks whether score is at least 60 and prints "Pass".',
          hints: [],
          conceptsDemonstrated: conceptIds,
          conceptsStruggledWith: [],
        };
      }

      const hints: string[] = [];

      if (!hasCondition) {
        hints.push(
          "Check that your if condition tests whether score is greater than or equal to 60."
        );
      }

      if (!hasOutput) {
        hints.push(
          'Make sure the condition prints "Pass" when it is true.'
        );
      }

      return {
        status: "incorrect",
        score: 0,
        message:
          "Your conditional does not satisfy all of the challenge requirements yet.",
        hints,
        conceptsDemonstrated: [],
        conceptsStruggledWith: conceptIds,
      };
    }

    return null;
  }

  // -----------------------------------------
  // NORMALIZATION
  // -----------------------------------------

  private normalize(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  private removeWhitespace(
    value: string
  ): string {
    return value.replace(/\s+/g, "");
  }

  private removeComments(
    value: string
  ): string {
    return value
      .replace(
        /\/\*[\s\S]*?\*\//g,
        ""
      )
      .replace(
        /\/\/.*$/gm,
        ""
      )
      .trim();
  }
}