import type { Curriculum } from "./Curriculum";

export const javaFundamentals: Curriculum = {
  id: "java-fundamentals",
  name: "Java Fundamentals",
  language: "java",

  concepts: [
    {
      id: "java.variables",
      name: "Variables",
      description:
        "Store and reference values in a program.",
      language: "java",
      prerequisites: [],
    },

    {
      id: "java.data-types",
      name: "Data Types",
      description:
        "Understand the different types of values Java can store.",
      language: "java",
      prerequisites: ["java.variables"],
    },

    {
      id: "java.operators",
      name: "Operators",
      description:
        "Use operators to perform calculations and compare values.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.data-types",
      ],
    },

    {
      id: "java.conditionals",
      name: "Conditionals",
      description:
        "Use conditions to control the flow of a program.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.data-types",
      ],
    },

    {
      id: "java.loops",
      name: "Loops",
      description:
        "Repeat code efficiently using loops.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.conditionals",
      ],
    },

    {
      id: "java.methods",
      name: "Methods",
      description:
        "Create reusable blocks of code that perform specific tasks.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.conditionals",
        "java.loops",
      ],
    },

    {
      id: "java.arrays",
      name: "Arrays",
      description:
        "Store multiple values of the same type in a single structure.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.loops",
      ],
    },

    {
      id: "java.strings",
      name: "Strings",
      description:
        "Work with text and manipulate strings in Java.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.data-types",
      ],
    },

    {
      id: "java.objects",
      name: "Objects",
      description:
        "Understand how objects represent data and behavior in Java.",
      language: "java",
      prerequisites: [
        "java.variables",
        "java.methods",
      ],
    },

    {
      id: "java.classes",
      name: "Classes",
      description:
        "Create classes that define the structure and behavior of objects.",
      language: "java",
      prerequisites: [
        "java.objects",
        "java.methods",
      ],
    },
  ],

  lessons: [
    {
      id: "java.lesson.variables",
      number: 1,
      title: "Variables",
      description:
        "Learn how variables store and reference information.",
      language: "java",
      conceptIds: ["java.variables"],
      challengeIds: ["java.challenge.variables"],
      prerequisites: [],
    },

    {
      id: "java.lesson.data-types",
      number: 2,
      title: "Data Types",
      description:
        "Learn how Java represents different kinds of information.",
      language: "java",
      conceptIds: ["java.data-types"],
      challengeIds: ["java.challenge.data-types"],
      prerequisites: [
        "java.lesson.variables",
      ],
    },

    {
      id: "java.lesson.operators",
      number: 3,
      title: "Operators",
      description:
        "Learn how to perform calculations and comparisons using Java operators.",
      language: "java",
      conceptIds: ["java.operators"],
      challengeIds: ["java.challenge.operators"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.data-types",
      ],
    },

    {
      id: "java.lesson.conditionals",
      number: 4,
      title: "Conditionals",
      description:
        "Learn how programs make decisions using conditions.",
      language: "java",
      conceptIds: ["java.conditionals"],
      challengeIds: ["java.challenge.conditionals"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.data-types",
      ],
    },

    {
      id: "java.lesson.loops",
      number: 5,
      title: "Loops",
      description:
        "Learn how to repeat code using for and while loops.",
      language: "java",
      conceptIds: ["java.loops"],
      challengeIds: ["java.challenge.loops"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.conditionals",
      ],
    },

    {
      id: "java.lesson.methods",
      number: 6,
      title: "Methods",
      description:
        "Learn how to create reusable blocks of code with methods.",
      language: "java",
      conceptIds: ["java.methods"],
      challengeIds: ["java.challenge.methods"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.conditionals",
        "java.lesson.loops",
      ],
    },

    {
      id: "java.lesson.arrays",
      number: 7,
      title: "Arrays",
      description:
        "Learn how to store and access multiple values using arrays.",
      language: "java",
      conceptIds: ["java.arrays"],
      challengeIds: ["java.challenge.arrays"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.loops",
      ],
    },

    {
      id: "java.lesson.strings",
      number: 8,
      title: "Strings",
      description:
        "Learn how to create, access, and manipulate text in Java.",
      language: "java",
      conceptIds: ["java.strings"],
      challengeIds: ["java.challenge.strings"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.data-types",
      ],
    },

    {
      id: "java.lesson.objects",
      number: 9,
      title: "Objects",
      description:
        "Learn how objects combine data and behavior in Java.",
      language: "java",
      conceptIds: ["java.objects"],
      challengeIds: ["java.challenge.objects"],
      prerequisites: [
        "java.lesson.variables",
        "java.lesson.methods",
      ],
    },

    {
      id: "java.lesson.classes",
      number: 10,
      title: "Classes",
      description:
        "Learn how to create classes that define objects in Java.",
      language: "java",
      conceptIds: ["java.classes"],
      challengeIds: ["java.challenge.classes"],
      prerequisites: [
        "java.lesson.objects",
        "java.lesson.methods",
      ],
    },
  ],

  challenges: [
    {
      id: "java.challenge.variables",
      title: "Create a variable",
      prompt:
        "Create an integer variable called score and give it the value 100.",
      difficulty: "Beginner",
      conceptIds: ["java.variables"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Create your variable here

  }
}`,

      solution: "int score = 100;",
    },

    {
      id: "java.challenge.data-types",
      title: "Create a decimal variable",
      prompt:
        "Create a double variable called price and give it the value 19.99.",
      difficulty: "Beginner",
      conceptIds: ["java.data-types"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Create your variable here

  }
}`,

      solution: "double price = 19.99;",
    },

    {
      id: "java.challenge.operators",
      title: "Calculate a total",
      prompt:
        "Create an integer variable called total that stores the result of 25 + 15.",
      difficulty: "Beginner",
      conceptIds: ["java.operators"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Create your variable here

  }
}`,

      solution: "int total = 25 + 15;",
    },

    {
      id: "java.challenge.conditionals",
      title: "Write a conditional",
      prompt:
        'Write an if statement that prints "Pass" when score is greater than or equal to 60.',
      difficulty: "Beginner",
      conceptIds: ["java.conditionals"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    int score = 75;

    // Write your if statement here

  }
}`,

      solution: `if (score >= 60) {
  System.out.println("Pass");
}`,
    },

    {
      id: "java.challenge.loops",
      title: "Write a loop",
      prompt:
        "Write a for loop that prints the numbers 1 through 5.",
      difficulty: "Beginner",
      conceptIds: ["java.loops"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Write your loop here

  }
}`,

      solution: `for (int i = 1; i <= 5; i++) {
  System.out.println(i);
}`,
    },

    {
      id: "java.challenge.methods",
      title: "Create a method",
      prompt:
        "Create a method called greet that prints \"Hello!\".",
      difficulty: "Beginner",
      conceptIds: ["java.methods"],

      starterCode: `public class Main {

  // Create your method here

  public static void main(String[] args) {

  }
}`,

      solution: `static void greet() {
  System.out.println("Hello!");
}`,
    },

    {
      id: "java.challenge.arrays",
      title: "Create an array",
      prompt:
        "Create an integer array called numbers containing 1, 2, and 3.",
      difficulty: "Beginner",
      conceptIds: ["java.arrays"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Create your array here

  }
}`,

      solution: "int[] numbers = {1, 2, 3};",
    },

    {
      id: "java.challenge.strings",
      title: "Create a string",
      prompt:
        'Create a String variable called name with the value "NeuroCode".',
      difficulty: "Beginner",
      conceptIds: ["java.strings"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Create your String here

  }
}`,

      solution: 'String name = "NeuroCode";',
    },

    {
      id: "java.challenge.objects",
      title: "Create an object",
      prompt:
        "Create a String object called message with the value \"Hello\".",
      difficulty: "Beginner",
      conceptIds: ["java.objects"],

      starterCode: `public class Main {
  public static void main(String[] args) {

    // Create your object here

  }
}`,

      solution: 'String message = new String("Hello");',
    },

    {
      id: "java.challenge.classes",
      title: "Create a class",
      prompt:
        "Create a class called Student.",
      difficulty: "Beginner",
      conceptIds: ["java.classes"],

      starterCode: `// Create your class here
`,

      solution: "class Student {}",
    },
  ],
};