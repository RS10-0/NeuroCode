export interface Lesson {
  id: string;
  number: number;
  title: string;
  topic: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";

  objectives: string[];

  concepts: string[];

  prerequisites: string[];

  example: {
    code: string;
    explanation: string;
  };

  challenge: {
    title: string;
    prompt: string;
    starterCode: string;
    solution: string;
  };
}

export const javaLessons: Lesson[] = [
  {
    id: "java-variables",
    number: 1,
    title: "Variables",
    topic: "variables",
    difficulty: "Beginner",

    objectives: [
      "Understand what a variable is",
      "Declare a variable",
      "Assign a value to a variable",
      "Use meaningful variable names",
    ],

    concepts: [
      "variable declaration",
      "assignment",
      "variable naming",
    ],

    prerequisites: [],

    example: {
      code: "int age = 17;",
      explanation:
        "The variable age stores the integer value 17. The keyword int tells Java that this variable stores a whole number.",
    },

    challenge: {
      title: "Create a variable",

      prompt:
        "Create an integer variable called score and give it the value 100.",

      starterCode: "",

      solution: "int score = 100;",
    },
  },

  {
    id: "java-data-types",
    number: 2,
    title: "Data Types",
    topic: "data types",
    difficulty: "Beginner",

    objectives: [
      "Understand why Java uses data types",
      "Recognize common primitive data types",
      "Choose an appropriate data type",
    ],

    concepts: [
      "int",
      "double",
      "boolean",
      "char",
      "String",
    ],

    prerequisites: ["java-variables"],

    example: {
      code: "double price = 19.99;",
      explanation:
        "A double can store numbers that contain decimal values. Here, price stores 19.99.",
    },

    challenge: {
      title: "Create a decimal variable",

      prompt:
        "Create a double variable called price and give it the value 19.99.",

      starterCode: "",

      solution: "double price = 19.99;",
    },
  },

  {
    id: "java-conditionals",
    number: 3,
    title: "Conditionals",
    topic: "conditionals",
    difficulty: "Beginner",

    objectives: [
      "Understand how programs make decisions",
      "Use an if statement",
      "Use comparison operators",
    ],

    concepts: [
      "if statements",
      "conditions",
      "comparison operators",
    ],

    prerequisites: ["java-variables", "java-data-types"],

    example: {
      code: `if (age >= 18) {
    System.out.println("Adult");
}`,
      explanation:
        "The code inside the if statement runs only when the condition is true.",
    },

    challenge: {
      title: "Write a conditional",

      prompt:
        'Write an if statement that prints "Pass" when score is greater than or equal to 60.',

      starterCode: "",

      solution: `if (score >= 60) {
    System.out.println("Pass");
}`,
    },
  },
];