import type { Curriculum } from "./Curriculum";
import type {
  Lesson,
  IntroStep,
  ConceptStep,
  ChallengeStep,
  QuizStep,
  CompletionStep,
  DecisionTreeActivityStep,
  AiSorterActivityStep,
  DatasetPlaygroundActivityStep,
  ParameterTuningActivityStep,
  ModelTestingActivityStep,
  TokenizerActivityStep,
  VectorSimilarityActivityStep,
  NextTokenActivityStep,
  PromptWeaverActivityStep,
  TemperatureSliderActivityStep,
  PromptRefinementActivityStep,
  FactCheckerActivityStep,
  EdgeCaseMatrixActivityStep,
  TruthAssessmentActivityStep,
  DatasetImbalanceActivityStep,
  FairnessMetricsActivityStep,
  BiasAuditActivityStep,
  EthicsDialActivityStep,
  DataRedactionActivityStep,
  PolicyCreatorActivityStep,
  CapstoneActivityStep,
} from "./Lesson";

/*
 * ============================================================
 * WHAT IS AI?
 * AI FOUNDATIONS — COMPLETE CURRICULUM
 * ============================================================
 *
 * 8 lessons
 *
 * Lesson 1 — What is AI?
 * Lesson 2 — How Does AI Learn?
 * Lesson 3 — How Do AI Models Understand Language?
 * Lesson 4 — How Generative AI Creates Things
 * Lesson 5 — Can AI Be Wrong?
 * Lesson 6 — Bias, Fairness, and AI
 * Lesson 7 — Using AI Responsibly
 * Lesson 8 — AI Foundations Capstone Project
 *
 * Every lesson moves differently.
 *
 * These eight used to share one shape exactly — concept,
 * activity, concept, activity, concept, activity, done — which
 * made the course feel like one lesson repeated eight times
 * however different the activities were. Each lesson now has
 * its own arc, and the arc is chosen to match what the lesson
 * is teaching:
 *
 *   1  Orientation  intro, then straight into sorting
 *   2  Pipeline     build, tune and test without interruption
 *   3  Layered      practise each representation immediately
 *   4  Experiment   generate first, explain second
 *   5  Confrontation opens on a question most people fail
 *   6  Investigation evidence, then measurement, then judgement
 *   7  Case work    the hard decision lands mid-lesson
 *   8  Project      brief, build, recommend
 *
 * Activities are real structured activities rather than
 * passive text blocks.
 */

/*
 * ============================================================
 * LESSON 1
 * WHAT IS AI?
 * ============================================================
 */

const lesson1Step1: ConceptStep = {
  id: "ai-foundations-01-step-01",
  type: "concept",
  /* The distinction this whole lesson turns on, side by side. */
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Traditional software",
        points: [
          "A person writes the rule",
          "Same input, same output, every time",
          "Fails on anything nobody anticipated",
          "You can read the logic",
        ],
      },
      right: {
        label: "AI system",
        points: [
          "The rule is inferred from examples",
          "Output is a prediction, not a certainty",
          "Degrades gracefully on the unfamiliar",
          "The logic is millions of numbers",
        ],
      },
    },
  },
  title: "Rules vs. Learning",
  requiresCompletion: false,
  content:
    "Traditional software follows fixed rules written by humans. For example, a program might follow the rule: if temperature > 80, turn on the fan. AI works differently. AI systems process data, recognize patterns, and make decisions or predictions without requiring a human to explicitly write a rule for every possible scenario.",
  examples: [
    {
      id: "rules-example",
      title: "Traditional Software",
      description:
        "A human explicitly defines what the computer should do.",
      input: "temperature = 85",
      output: "turn fan ON",
    },
    {
      id: "learning-example",
      title: "AI System",
      description:
        "The system learns patterns from examples and uses those patterns to make predictions.",
      input: "new image",
      output: "predicted category",
    },
  ],
  misconception:
    "AI does not mean that a computer magically thinks like a human. It means the system can perform tasks involving patterns, predictions, or decisions using computational methods.",
};

const lesson1Step2: DecisionTreeActivityStep = {
  id: "ai-foundations-01-step-02",
  type: "activity",
  interactiveType: "decision_tree_builder",
  title: "Decision Tree Builder",
  requiresCompletion: true,
  instructions:
    "Drag and arrange conditions to build a decision tree that correctly sorts the items into Fruit or Vegetable. Your goal is to create a logical sequence of questions that can classify every item.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Great work! You built a rule-based decision system. Notice how every decision was explicitly defined by you.",
    incorrect:
      "Not quite. Check whether your conditions correctly classify every item, then try rearranging the decision tree.",
    partial:
      "You're getting there. A few branches still classify items incorrectly.",
  },
  dataset: [
    {
      id: "apple",
      name: "Apple",
      attributes: {
        hasSeeds: true,
        growsOnTree: true,
        commonColor: "red",
      },
      correctCategory: "Fruit",
    },
    {
      id: "carrot",
      name: "Carrot",
      attributes: {
        hasSeeds: false,
        growsOnTree: false,
        commonColor: "orange",
      },
      correctCategory: "Vegetable",
    },
    {
      id: "strawberry",
      name: "Strawberry",
      attributes: {
        hasSeeds: true,
        growsOnTree: false,
        commonColor: "red",
      },
      correctCategory: "Fruit",
    },
    {
      id: "broccoli",
      name: "Broccoli",
      attributes: {
        hasSeeds: false,
        growsOnTree: false,
        commonColor: "green",
      },
      correctCategory: "Vegetable",
    },
    {
      id: "orange",
      name: "Orange",
      attributes: {
        hasSeeds: true,
        growsOnTree: true,
        commonColor: "orange",
      },
      correctCategory: "Fruit",
    },
    {
      id: "spinach",
      name: "Spinach",
      attributes: {
        hasSeeds: false,
        growsOnTree: false,
        commonColor: "green",
      },
      correctCategory: "Vegetable",
    },
  ],
  availableConditions: [
    {
      id: "condition-seeds",
      label: "Has seeds",
      attribute: "hasSeeds",
      operator: "equals",
      value: true,
    },
    {
      id: "condition-tree",
      label: "Grows on a tree",
      attribute: "growsOnTree",
      operator: "equals",
      value: true,
    },
    {
      id: "condition-red",
      label: "Is commonly red",
      attribute: "commonColor",
      operator: "equals",
      value: "red",
    },
  ],
  targetCategories: ["Fruit", "Vegetable"],
  solution: {
    rootConditionId: "condition-seeds",
    nodes: [
      {
        id: "root",
        label: "Does it have seeds?",
        conditionId: "condition-seeds",
        yesChildId: "fruit",
        noChildId: "vegetable",
      },
      {
        id: "fruit",
        label: "Fruit",
        result: "Fruit",
      },
      {
        id: "vegetable",
        label: "Vegetable",
        result: "Vegetable",
      },
    ],
    classifications: {
      apple: "Fruit",
      carrot: "Vegetable",
      strawberry: "Fruit",
      broccoli: "Vegetable",
      orange: "Fruit",
      spinach: "Vegetable",
    },
  },
  showLivePreview: true,
  allowReordering: true,
};

const lesson1Step3: ConceptStep = {
  id: "ai-foundations-01-step-03",
  type: "concept",
  title: "AI in Everyday Life",
  requiresCompletion: false,
  content:
    "AI isn't just robots. It already powers many everyday tools. Movie recommendations predict what you may want to watch. Spam filters identify suspicious messages. GPS systems estimate routes and travel times. Smartphone cameras use AI to recognize scenes, focus on subjects, and improve photographs.",
  examples: [
    {
      id: "recommendations",
      title: "Recommendations",
      description:
        "AI analyzes patterns in what people watch, listen to, or interact with to predict what they may like next.",
    },
    {
      id: "spam",
      title: "Spam Filters",
      description:
        "AI can identify patterns associated with unwanted or suspicious messages.",
    },
    {
      id: "gps",
      title: "Route Planning",
      description:
        "AI-powered systems can use traffic and historical patterns to estimate efficient routes.",
    },
    {
      id: "camera",
      title: "Camera Autofocus",
      description:
        "Modern cameras can recognize people, animals, faces, and objects to improve focus and image quality.",
    },
  ],
};

const lesson1Step4: AiSorterActivityStep = {
  id: "ai-foundations-01-step-04",
  type: "activity",
  interactiveType: "ai_sorter",
  title: "Spot the AI",
  requiresCompletion: true,
  instructions:
    "Drag each scenario into either Traditional Software or AI-Powered System. Think about whether the system relies primarily on explicitly written rules or learned patterns from data.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Excellent! You can now distinguish systems that primarily follow explicit rules from systems that use learned patterns.",
    incorrect:
      "Look carefully at whether the system must be explicitly programmed for every case or can learn patterns from data.",
  },
  buckets: [
    {
      id: "traditional-software",
      label: "Traditional Software",
      description:
        "Primarily follows explicit rules written by programmers.",
    },
    {
      id: "ai-powered",
      label: "AI-Powered System",
      description:
        "Uses learned patterns, statistical models, or machine learning.",
    },
  ],
  cards: [
    {
      id: "calculator",
      title: "Calculator",
      description:
        "A calculator follows mathematical operations explicitly defined in its software.",
      correctBucketId: "traditional-software",
      explanation:
        "The calculator follows deterministic mathematical rules rather than learning patterns from examples.",
    },
    {
      id: "movie-recommendation",
      title: "Movie Recommendation Engine",
      description:
        "A service predicts movies a user may enjoy based on viewing patterns.",
      correctBucketId: "ai-powered",
      explanation:
        "Recommendation systems commonly use learned patterns from user and content data.",
    },
    {
      id: "alarm-clock",
      title: "Alarm Clock",
      description:
        "An alarm rings at a time explicitly selected by the user.",
      correctBucketId: "traditional-software",
      explanation:
        "The alarm follows a direct rule: when the clock reaches the selected time, trigger the alarm.",
    },
    {
      id: "spam-filter",
      title: "Spam Filter",
      description:
        "A system predicts whether an incoming email is likely to be spam.",
      correctBucketId: "ai-powered",
      explanation:
        "Modern spam filters commonly learn patterns associated with unwanted messages.",
    },
    {
      id: "photo-recognition",
      title: "Photo Subject Recognition",
      description:
        "A camera identifies people or objects in photographs.",
      correctBucketId: "ai-powered",
      explanation:
        "Image recognition models learn visual patterns from training data.",
    },
    {
      id: "if-then-light",
      title: "Motion-Activated Light",
      description:
        "A light turns on whenever a motion sensor crosses a programmed threshold.",
      correctBucketId: "traditional-software",
      explanation:
        "This can be implemented using a fixed if-then rule without machine learning.",
    },
  ],
};

const lesson1Step5: ConceptStep = {
  id: "ai-foundations-01-step-05",
  type: "concept",
  title: "What AI Is NOT",
  requiresCompletion: false,
  content:
    "AI does not automatically have feelings, consciousness, intentions, or human-level general intelligence. An AI system can produce sophisticated outputs while still operating through mathematics, statistics, optimization, and pattern recognition. Most AI systems are specialized: they are designed to perform particular tasks within particular domains.",
  examples: [
    {
      id: "ai-language",
      title: "Language Model",
      description:
        "A language model can generate convincing text without possessing human feelings or consciousness.",
    },
    {
      id: "ai-vision",
      title: "Vision Model",
      description:
        "An image model can recognize patterns in pixels without experiencing what it sees.",
    },
  ],
  misconception:
    "A convincing response is not proof that an AI has consciousness or human-like understanding.",
};

const lesson1Step6: QuizStep = {
  id: "ai-foundations-01-step-06",
  type: "quiz",
  title: "Step-by-Step Summary & Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Which statement best describes the difference between traditional software and AI?",
  options: [
    {
      id: "q1-a",
      label:
        "Traditional software always uses the internet, while AI does not.",
      isCorrect: false,
      feedback:
        "Internet access is not what separates traditional software from AI.",
    },
    {
      id: "q1-b",
      label:
        "Traditional software primarily follows explicit rules, while AI can learn patterns from data.",
      isCorrect: true,
      feedback:
        "Correct! This is the core distinction introduced in this lesson.",
    },
    {
      id: "q1-c",
      label: "AI is any software that contains a graphical interface.",
      isCorrect: false,
      feedback:
        "A graphical interface has nothing to do with whether a system is AI.",
    },
    {
      id: "q1-d",
      label: "Traditional software is always less accurate than AI.",
      isCorrect: false,
      feedback:
        "Accuracy depends on the task and implementation, not simply whether something is AI.",
    },
  ],
  explanation:
    "AI systems can use data-driven pattern recognition to make predictions or decisions, while traditional programs commonly rely on explicitly programmed rules.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson1Completion: CompletionStep = {
  id: "ai-foundations-01-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Traditional software primarily follows explicit rules.",
    "AI systems can learn patterns from data.",
    "AI already powers recommendations, spam filters, navigation, and cameras.",
    "AI does not automatically have feelings, consciousness, or human general intelligence.",
  ],
  xpReward: 100,
  completionMessage:
    "You now have the foundation for understanding what makes an AI system different from ordinary software.",
  nextLessonId: "ai-foundations-02",
};

/*
 * ============================================================
 * LESSON 2
 * HOW DOES AI LEARN?
 * ============================================================
 */

const lesson2Step1: ConceptStep = {
  id: "ai-foundations-02-step-01",
  type: "concept",
  title: "Supervised vs. Unsupervised Learning",
  requiresCompletion: false,
  content:
    "AI learns through data. In supervised learning, models learn from labeled examples, such as photographs tagged 'dog' or 'cat.' The model uses those examples to learn a relationship between inputs and known outputs. In unsupervised learning, the data does not come with labels. Instead, the system searches for patterns, clusters, or structures within the data.",
  examples: [
    {
      id: "supervised",
      title: "Supervised Learning",
      description:
        "Photos are labeled as car, bike, or truck so the model can learn to classify new images.",
    },
    {
      id: "unsupervised",
      title: "Unsupervised Learning",
      description:
        "A model receives customer data without predefined categories and searches for natural groups or patterns.",
    },
  ],
};

const lesson2Step2: DatasetPlaygroundActivityStep = {
  id: "ai-foundations-02-step-02",
  type: "activity",
  interactiveType: "dataset_playground",
  title: "The Dataset Playground",
  requiresCompletion: true,
  instructions:
    "Label the vehicle images as car, bike, or truck. Each correctly labeled example enters the training pipeline. Watch how the model's confidence changes as the dataset becomes larger and more representative.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Great! Your labeled examples gave the training process useful information.",
    incorrect:
      "Some labels are incorrect. Correct the examples and observe how training confidence changes.",
  },
  dataset: [
    {
      id: "vehicle-car-01",
      image: "/assets/ai-foundations/vehicles/car-01.svg",
      category: "vehicle",
      correctLabel: "car",
    },
    {
      id: "vehicle-car-02",
      image: "/assets/ai-foundations/vehicles/car-02.svg",
      category: "vehicle",
      correctLabel: "car",
    },
    {
      id: "vehicle-bike-01",
      image: "/assets/ai-foundations/vehicles/bike-01.svg",
      category: "vehicle",
      correctLabel: "bike",
    },
    {
      id: "vehicle-bike-02",
      image: "/assets/ai-foundations/vehicles/bike-02.svg",
      category: "vehicle",
      correctLabel: "bike",
    },
    {
      id: "vehicle-truck-01",
      image: "/assets/ai-foundations/vehicles/truck-01.svg",
      category: "vehicle",
      correctLabel: "truck",
    },
    {
      id: "vehicle-truck-02",
      image: "/assets/ai-foundations/vehicles/truck-02.svg",
      category: "vehicle",
      correctLabel: "truck",
    },
    {
      id: "vehicle-car-03",
      image: "/assets/ai-foundations/vehicles/car-03.svg",
      category: "vehicle",
      correctLabel: "car",
    },
    {
      id: "vehicle-bike-03",
      image: "/assets/ai-foundations/vehicles/bike-03.svg",
      category: "vehicle",
      correctLabel: "bike",
    },
    {
      id: "vehicle-truck-03",
      image: "/assets/ai-foundations/vehicles/truck-03.svg",
      category: "vehicle",
      correctLabel: "truck",
    },
  ],
  categories: [
    {
      id: "car",
      label: "Car",
      description: "A four-wheeled passenger vehicle.",
    },
    {
      id: "bike",
      label: "Bike",
      description: "A two-wheeled bicycle or motorcycle.",
    },
    {
      id: "truck",
      label: "Truck",
      description: "A larger vehicle designed to transport cargo.",
    },
  ],
  requiredLabels: 6,
  trainingStages: [
    {
      id: "stage-1",
      label: "Small Dataset",
      minimumItems: 2,
      accuracy: 45,
      confidence: 35,
    },
    {
      id: "stage-2",
      label: "Growing Dataset",
      minimumItems: 4,
      accuracy: 65,
      confidence: 55,
    },
    {
      id: "stage-3",
      label: "Useful Dataset",
      minimumItems: 6,
      accuracy: 82,
      confidence: 75,
    },
    {
      id: "stage-4",
      label: "Strong Dataset",
      minimumItems: 8,
      accuracy: 93,
      confidence: 89,
    },
  ],
  accuracyFormula: "simple",
  showConfidence: true,
  showTrainingAnimation: true,
};

const lesson2Step3: ConceptStep = {
  id: "ai-foundations-02-step-03",
  type: "concept",
  /* Training is a pipeline, and the order of it matters. */
  visual: {
    type: "flow",
    data: {
      stages: [
        {
          id: "collect",
          label: "Collect",
          caption: "Gather examples of the thing you want predicted",
        },
        {
          id: "features",
          label: "Extract features",
          caption: "Turn each example into numbers a model can read",
        },
        {
          id: "train",
          label: "Train",
          caption: "Adjust parameters until predictions stop improving",
        },
        {
          id: "evaluate",
          label: "Evaluate",
          caption: "Measure on data the model has never seen",
        },
      ],
    },
  },
  title: "Training and Feature Extraction",
  requiresCompletion: false,
  content:
    "During training, an AI system processes examples and searches for useful patterns. For an image model, those patterns may include edges, shapes, textures, colors, and combinations of visual features. The model uses these features to calculate probabilities about what an input might represent. It is not simply memorizing every image exactly as it appeared in the training set.",
  examples: [
    {
      id: "edge-feature",
      title: "Edges",
      description:
        "Edges can help a vision model distinguish shapes and boundaries within an image.",
    },
    {
      id: "color-feature",
      title: "Color",
      description:
        "Color patterns can provide useful information about an object.",
    },
    {
      id: "shape-feature",
      title: "Shape",
      description:
        "Shapes and their relationships can help models distinguish different categories.",
    },
  ],
};

const lesson2Step4: ParameterTuningActivityStep = {
  id: "ai-foundations-02-step-04",
  type: "activity",
  interactiveType: "parameter_tuning",
  title: "Parameter Tuning Slider",
  requiresCompletion: true,
  instructions:
    "Adjust Training Data Volume and Feature Variety. Your goal is to discover how the amount and diversity of information available to a model can affect its performance.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Excellent! You found a strong configuration. More data and more varied features can improve generalization, although simply adding more of anything is not automatically enough.",
    incorrect:
      "Try increasing both the amount of training data and the variety of useful features.",
  },
  parameters: [
    {
      id: "training-data-volume",
      label: "Training Data Volume",
      description:
        "How many training examples the model receives.",
      min: 0,
      max: 100,
      step: 5,
      unit: "%",
    },
    {
      id: "feature-variety",
      label: "Feature Variety",
      description:
        "How diverse and informative the features represented in the dataset are.",
      min: 0,
      max: 100,
      step: 5,
      unit: "%",
    },
  ],
  initialValues: {
    "training-data-volume": 40,
    "feature-variety": 40,
  },
  accuracyModel: {
    baselineAccuracy: 35,
    minAccuracy: 20,
    maxAccuracy: 98,
    effects: [
      {
        parameterId: "training-data-volume",
        optimalRange: [70, 90],
        effectStrength: 0.42,
        description:
          "More representative training examples generally improve the model's ability to generalize.",
      },
      {
        parameterId: "feature-variety",
        optimalRange: [70, 95],
        effectStrength: 0.43,
        description:
          "A wider variety of useful features helps the model recognize more situations.",
      },
    ],
  },
  targetAccuracy: 80,
  feedbackThresholds: [
    {
      minAccuracy: 0,
      maxAccuracy: 59,
      message:
        "The model has too little useful information to make reliable predictions.",
    },
    {
      minAccuracy: 60,
      maxAccuracy: 79,
      message:
        "The model is learning, but it still needs stronger data or feature variety.",
    },
    {
      minAccuracy: 80,
      maxAccuracy: 100,
      message:
        "Strong configuration! The model has enough useful information to perform well on this simulation.",
    },
  ],
};

const lesson2Step5: ConceptStep = {
  id: "ai-foundations-02-step-05",
  type: "concept",
  title: "Testing & Evaluation",
  requiresCompletion: false,
  content:
    "A trained model must be tested on data it has not seen during training. This helps determine whether it has learned useful patterns that generalize to new examples. If a model performs extremely well on its training data but poorly on new data, it may be overfitting—memorizing patterns specific to the training examples instead of learning generalizable relationships.",
  examples: [
    {
      id: "training-vs-test",
      title: "Training Data",
      description:
        "Examples the model sees while learning.",
    },
    {
      id: "unseen-test",
      title: "Test Data",
      description:
        "New examples used to evaluate whether the learned patterns generalize.",
    },
  ],
};

const lesson2Step6: ModelTestingActivityStep = {
  id: "ai-foundations-02-step-06",
  type: "activity",
  interactiveType: "model_testing",
  title: "Test the Model",
  requiresCompletion: true,
  instructions:
    "Feed unseen vehicle images into the trained model. Inspect the prediction, confidence, and mistakes. Your goal is not just to get answers right—it is to understand how a model performs on data it has never seen.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 4,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Excellent! Testing on unseen examples gives you evidence about whether a model can generalize.",
    incorrect:
      "Some predictions were incorrect. Pay attention to confidence and remember that a trained model can still make mistakes on new data.",
  },
  trainingSummary: {
    trainingItemCount: 9,
    categories: ["car", "bike", "truck"],
    trainingAccuracy: 91,
    knownLimitations: [
      "Limited training examples",
      "Similar-looking vehicles",
      "Lighting and viewpoint changes",
    ],
  },
  testItems: [
    {
      id: "test-car-01",
      input: "Unseen vehicle image: compact sedan",
      image: "/assets/ai-foundations/vehicles/test-car-01.svg",
      expectedCategory: "car",
      modelPrediction: "car",
      confidence: 0.94,
      explanation:
        "The model identifies several learned visual features associated with cars.",
    },
    {
      id: "test-bike-01",
      input: "Unseen vehicle image: mountain bike",
      image: "/assets/ai-foundations/vehicles/test-bike-01.svg",
      expectedCategory: "bike",
      modelPrediction: "bike",
      confidence: 0.91,
      explanation:
        "The model recognizes the characteristic two-wheel structure.",
    },
    {
      id: "test-truck-01",
      input: "Unseen vehicle image: delivery truck",
      image: "/assets/ai-foundations/vehicles/test-truck-01.svg",
      expectedCategory: "truck",
      modelPrediction: "truck",
      confidence: 0.89,
      explanation:
        "The model recognizes the larger cargo-body pattern.",
    },
    {
      id: "test-bike-02",
      input: "Unseen vehicle image: scooter",
      image: "/assets/ai-foundations/vehicles/test-bike-02.svg",
      expectedCategory: "bike",
      modelPrediction: "bike",
      confidence: 0.73,
      explanation:
        "The model is less confident because this vehicle differs from several training examples.",
    },
    {
      id: "test-truck-02",
      input: "Unseen vehicle image: pickup truck",
      image: "/assets/ai-foundations/vehicles/test-truck-02.svg",
      expectedCategory: "truck",
      modelPrediction: "car",
      confidence: 0.56,
      explanation:
        "The model mistakes the pickup for a car because the categories share visual features.",
    },
  ],
  minimumTestsRequired: 5,
  showConfusionMatrix: true,
  showPerCategoryAccuracy: true,
};

const lesson2Completion: CompletionStep = {
  id: "ai-foundations-02-completion",
  type: "completion",
  title: "Lesson Complete",
  keyTakeaways: [
    "Supervised learning uses labeled examples.",
    "Unsupervised learning searches for patterns without predefined labels.",
    "Training allows models to learn useful patterns from data.",
    "Testing on unseen data helps measure generalization.",
    "Overfitting occurs when a model learns training examples too specifically.",
  ],
  xpReward: 120,
  completionMessage:
    "You now understand the basic pipeline behind how machine learning systems learn from data.",
  nextLessonId: "ai-foundations-03",
};

/*
 * ============================================================
 * LESSON 3
 * HOW DO AI MODELS UNDERSTAND LANGUAGE?
 * ============================================================
 */

const lesson3Step1: ConceptStep = {
  id: "ai-foundations-03-step-01",
  type: "concept",
  /* What actually happens to a sentence on its way in. */
  visual: {
    type: "diagram",
    data: {
      nodes: [
        {
          id: "text",
          label: "\"unbelievable\"",
          caption: "What you typed",
        },
        {
          id: "tokens",
          label: "un | believ | able",
          caption: "Split into vocabulary pieces",
        },
        {
          id: "ids",
          label: "[479, 21451, able]",
          caption: "Each piece becomes a number",
        },
        {
          id: "vectors",
          label: "Embeddings",
          caption: "Each number becomes a position in meaning-space",
        },
      ],
      links: [
        { from: "text", to: "tokens", label: "tokenize" },
        { from: "tokens", to: "ids", label: "look up" },
        { from: "ids", to: "vectors", label: "embed" },
      ],
    },
  },
  title: "Tokenization & Words as Numbers",
  requiresCompletion: false,
  content:
    "AI doesn't read letters the same way humans do. Text is broken into smaller units called tokens. A token may represent a whole word, part of a word, punctuation, or another piece of text. Tokens are represented numerically so neural networks can process them. Those numerical representations are then transformed into richer representations called embeddings.",
  examples: [
    {
      id: "token-example",
      title: "A Sentence Becomes Tokens",
      description:
        "The sentence 'AI learns patterns' can be split into tokens such as 'AI', 'learns', and 'patterns'.",
    },
    {
      id: "number-example",
      title: "Tokens Become Numbers",
      description:
        "Each token corresponds to a numerical identifier that lets the model process the sequence computationally.",
    },
  ],
};

const lesson3Step2: TokenizerActivityStep = {
  id: "ai-foundations-03-step-02",
  type: "activity",
  interactiveType: "tokenizer_playground",
  title: "Tokenizer Playground",
  requiresCompletion: true,
  instructions:
    "Type a sentence into the tokenizer. Watch the text split into color-coded tokens and inspect the numerical ID assigned to each token.",
  completion: {
    type: "required_actions",
    requiredActions: ["tokenize-custom-sentence"],
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Nice! You just saw how natural language can be transformed into a representation a model can process.",
    incorrect:
      "Enter a sentence and inspect the resulting tokens. Try changing the sentence to see how tokenization changes.",
  },
  starterSentences: [
    "AI learns from data.",
    "The sky is blue.",
    "Machine learning is powerful.",
    "I love computer science!",
  ],
  tokenizationRules: [
    {
      id: "word-token",
      description:
        "Common words may appear as individual tokens.",
      example: "hello",
      resultingTokens: ["hello"],
    },
    {
      id: "subword-token",
      description:
        "Uncommon or longer words may be divided into smaller subword pieces.",
      example: "unbelievable",
      resultingTokens: ["un", "believ", "able"],
    },
    {
      id: "punctuation-token",
      description:
        "Punctuation can also be represented as tokens.",
      example: "Hello!",
      resultingTokens: ["Hello", "!"],
    },
  ],
  tokenVocabulary: [
    {
      token: "AI",
      tokenId: 101,
      embeddingPreview: [0.72, 0.14, 0.51],
    },
    {
      token: "learns",
      tokenId: 208,
      embeddingPreview: [0.41, 0.81, 0.22],
    },
    {
      token: "data",
      tokenId: 317,
      embeddingPreview: [0.63, 0.55, 0.76],
    },
    {
      token: "the",
      tokenId: 12,
      embeddingPreview: [0.18, 0.23, 0.11],
    },
  ],
  showTokenIds: true,
  showEmbeddings: true,
  allowCustomInput: true,
  maxInputLength: 120,
};

const lesson3Step3: ConceptStep = {
  id: "ai-foundations-03-step-03",
  type: "concept",
  title: "Context and Vector Maps",
  requiresCompletion: false,
  content:
    "Words with related meanings can be represented near one another in a high-dimensional vector space. For example, 'king' and 'queen' may have related representations. Context also matters. The word 'bank' can refer to a financial institution or the side of a river. A language model uses surrounding tokens and learned relationships to determine which interpretation is more likely.",
  examples: [
    {
      id: "vector-meaning",
      title: "Related Meanings",
      description:
        "Words used in similar contexts can develop similar vector representations.",
    },
    {
      id: "bank-context",
      title: "Context Changes Meaning",
      description:
        "The sentence 'I deposited money at the bank' points toward a financial meaning, while 'we sat on the river bank' points toward a geographic meaning.",
    },
  ],
};

const lesson3Step4: VectorSimilarityActivityStep = {
  id: "ai-foundations-03-step-04",
  type: "activity",
  interactiveType: "vector_similarity",
  title: "Vector Similarity Plotter",
  requiresCompletion: true,
  instructions:
    "Drag the word nodes around the vector map. Place semantically related concepts closer together and unrelated concepts farther apart. Then inspect the similarity score.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "Great! Vector distance provides a mathematical way to represent relationships between concepts.",
    incorrect:
      "Think about which words are related in meaning or context. Related concepts should generally be closer together.",
  },
  points: [
    {
      id: "apple",
      label: "apple",
      x: 22,
      y: 72,
      category: "food",
      explanation: "A fruit and food concept.",
    },
    {
      id: "banana",
      label: "banana",
      x: 30,
      y: 68,
      category: "food",
      explanation: "A fruit and food concept.",
    },
    {
      id: "laptop",
      label: "laptop",
      x: 74,
      y: 28,
      category: "technology",
      explanation: "A computing device.",
    },
    {
      id: "keyboard",
      label: "keyboard",
      x: 81,
      y: 34,
      category: "technology",
      explanation: "A computer input device.",
    },
  ],
  similarityMetric: "cosine",
  targetPairs: [
    {
      firstId: "apple",
      secondId: "banana",
      expectedRelationship: "similar",
    },
    {
      firstId: "laptop",
      secondId: "keyboard",
      expectedRelationship: "similar",
    },
    {
      firstId: "apple",
      secondId: "laptop",
      expectedRelationship: "different",
    },
  ],
  draggable: true,
  showDistanceLines: true,
  showSimilarityScore: true,
};

const lesson3Step5: ConceptStep = {
  id: "ai-foundations-03-step-05",
  type: "concept",
  title: "Predicting the Next Word",
  requiresCompletion: false,
  content:
    "Large language models operate fundamentally by calculating probabilities over possible next tokens given the tokens that came before. For a prompt such as 'The sky is...', the model may assign a high probability to 'blue' and much lower probabilities to unrelated words. The model then selects a token according to its probability distribution and continues the process token by token.",
  examples: [
    {
      id: "next-token",
      title: "The sky is...",
      description:
        "The model considers many possible next tokens and assigns probabilities based on the prompt and its learned patterns.",
      input: "The sky is...",
      output: "blue",
    },
  ],
  misconception:
    "Predicting likely next tokens can produce surprisingly coherent language, but the mechanism is not the same as a human consciously thinking through a sentence.",
};

const lesson3Step6: NextTokenActivityStep = {
  id: "ai-foundations-03-step-06",
  type: "activity",
  interactiveType: "next_token_game",
  title: "Predict-the-Next-Token Game",
  requiresCompletion: true,
  instructions:
    "Read each prompt and select the token that the model is most likely to generate next. Pay attention to the probability percentages.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Correct! You successfully predicted the highest-probability next token.",
    incorrect:
      "Not quite. Consider which token best fits the context and compare the probability distribution.",
  },
  prompts: [
    {
      id: "sky",
      prompt: "The sky is...",
      correctTokenId: "sky-blue",
      explanation:
        "Blue is strongly associated with the phrase 'the sky is blue.'",
      predictions: [
        {
          id: "sky-blue",
          token: "blue",
          probability: 85,
          isCorrect: true,
        },
        {
          id: "sky-cloudy",
          token: "cloudy",
          probability: 10,
        },
        {
          id: "sky-green",
          token: "green",
          probability: 0.1,
        },
        {
          id: "sky-table",
          token: "table",
          probability: 0.01,
        },
      ],
    },
    {
      id: "coffee",
      prompt: "I poured hot water over the ground coffee and waited for it to...",
      correctTokenId: "coffee-brew",
      explanation:
        "In this context, 'brew' is a highly likely continuation.",
      predictions: [
        {
          id: "coffee-brew",
          token: "brew",
          probability: 79,
          isCorrect: true,
        },
        {
          id: "coffee-fly",
          token: "fly",
          probability: 1,
        },
        {
          id: "coffee-sing",
          token: "sing",
          probability: 0.2,
        },
      ],
    },
    {
      id: "python",
      prompt: "In Python, a list can be accessed using square...",
      correctTokenId: "python-brackets",
      explanation:
        "The common programming phrase is 'square brackets.'",
      predictions: [
        {
          id: "python-brackets",
          token: "brackets",
          probability: 91,
          isCorrect: true,
        },
        {
          id: "python-windows",
          token: "windows",
          probability: 0.4,
        },
        {
          id: "python-houses",
          token: "houses",
          probability: 0.05,
        },
      ],
    },
    {
      id: "rain",
      prompt: "When it rains, people often carry an...",
      correctTokenId: "rain-umbrella",
      explanation:
        "An umbrella is a common object associated with rainy weather.",
      predictions: [
        {
          id: "rain-umbrella",
          token: "umbrella",
          probability: 88,
          isCorrect: true,
        },
        {
          id: "rain-keyboard",
          token: "keyboard",
          probability: 0.2,
        },
        {
          id: "rain-piano",
          token: "piano",
          probability: 0.1,
        },
      ],
    },
  ],
  showProbabilities: true,
  allowMultipleAttempts: true,
  scoringMode: "probability_weighted",
};

const lesson3Completion: CompletionStep = {
  id: "ai-foundations-03-completion",
  type: "completion",
  title: "Lesson Complete",
  keyTakeaways: [
    "Text is broken into tokens that models can process numerically.",
    "Embeddings represent relationships between concepts in vector space.",
    "Context helps models distinguish between different meanings of the same word.",
    "LLMs generate text by repeatedly predicting likely next tokens.",
  ],
  xpReward: 140,
  completionMessage:
    "You now understand one of the most important ideas behind modern language models: language becomes numerical representations and probability distributions that a model can process.",
  nextLessonId: "ai-foundations-04",
};

/*
 * ============================================================
 * LESSON 4
 * HOW GENERATIVE AI CREATES THINGS
 * ============================================================
 */

const lesson4Step1: ConceptStep = {
  id: "ai-foundations-04-step-01",
  type: "concept",
  title: "Generation vs. Recognition",
  requiresCompletion: false,
  content:
    "Traditional AI systems often analyze or classify existing data. Generative AI goes further by producing new content. Depending on the model, that content can include text, code, images, audio, or other media. Generative systems learn statistical patterns from large datasets and use those learned patterns to construct new outputs.",
  examples: [
    {
      id: "recognition",
      title: "Recognition",
      description:
        "A model receives an image and predicts that it contains a dog.",
    },
    {
      id: "generation",
      title: "Generation",
      description:
        "A generative model receives a prompt and produces a new image of a dog.",
    },
  ],
};

const lesson4Step2: PromptWeaverActivityStep = {
  id: "ai-foundations-04-step-02",
  type: "activity",
  interactiveType: "prompt_weaver",
  title: "Prompt-to-Image Parameter Weaver",
  requiresCompletion: true,
  instructions:
    "Build a structured image prompt by selecting Subject, Style, Lighting, and Mood blocks. Watch the preview change as you modify the prompt.",
  completion: {
    type: "required_actions",
    requiredActions: [
      "select-subject",
      "select-style",
      "select-lighting",
      "select-mood",
      "generate-preview",
    ],
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Excellent! You can see how specific prompt components provide additional direction to a generative model.",
    incorrect:
      "Your prompt is missing one or more required components. Add Subject, Style, Lighting, and Mood.",
  },
  promptBlocks: [
    {
      id: "subject-city",
      category: "subject",
      label: "Futuristic City",
      text: "a futuristic city skyline",
      qualityValue: 20,
    },
    {
      id: "subject-forest",
      category: "subject",
      label: "Enchanted Forest",
      text: "an enchanted forest",
      qualityValue: 20,
    },
    {
      id: "style-cinematic",
      category: "style",
      label: "Cinematic",
      text: "cinematic digital art",
      qualityValue: 20,
    },
    {
      id: "style-watercolor",
      category: "style",
      label: "Watercolor",
      text: "detailed watercolor illustration",
      qualityValue: 20,
    },
    {
      id: "lighting-neon",
      category: "lighting",
      label: "Neon Lighting",
      text: "dramatic neon lighting",
      qualityValue: 20,
    },
    {
      id: "lighting-golden",
      category: "lighting",
      label: "Golden Hour",
      text: "warm golden-hour lighting",
      qualityValue: 20,
    },
    {
      id: "mood-mysterious",
      category: "mood",
      label: "Mysterious",
      text: "a mysterious atmosphere",
      qualityValue: 20,
    },
    {
      id: "mood-joyful",
      category: "mood",
      label: "Joyful",
      text: "a joyful and energetic atmosphere",
      qualityValue: 20,
    },
  ],
  requiredCategories: ["subject", "style", "lighting", "mood"],
  targetPromptPattern: ["subject", "style", "lighting", "mood"],
  showOutputPreview: true,
};

const lesson4Step3: ConceptStep = {
  id: "ai-foundations-04-step-03",
  type: "concept",
  title: "Temperature and Randomness",
  requiresCompletion: false,
  content:
    "Generative models can use a setting commonly called temperature to influence how predictable or varied their outputs are. Lower temperature generally favors higher-probability choices and more predictable responses. Higher temperature allows lower-probability choices to appear more often, which can create more varied or surprising outputs. Temperature does not magically make a model more intelligent or creative—it changes how the probability distribution is sampled.",
  examples: [
    {
      id: "low-temperature",
      title: "Low Temperature",
      description:
        "Outputs tend to stay closer to the model's highest-probability choices.",
    },
    {
      id: "high-temperature",
      title: "High Temperature",
      description:
        "Outputs can become more varied and less predictable.",
    },
  ],
};

const lesson4Step4: TemperatureSliderActivityStep = {
  id: "ai-foundations-04-step-04",
  type: "activity",
  interactiveType: "temperature_slider",
  title: "Temperature Slider Simulation",
  requiresCompletion: true,
  instructions:
    "Drag the temperature slider from 0.0 to 1.0. Generate the same story prompt at different temperatures and compare how predictable or imaginative the responses become.",
  completion: {
    type: "required_actions",
    requiredActions: [
      "test-temperature-0",
      "test-temperature-mid",
      "test-temperature-1",
      "compare-outputs",
    ],
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Great! You observed how changing temperature can alter the variability of generated responses.",
    incorrect:
      "Try the same prompt at both low and high temperatures and compare the outputs.",
  },
  minTemperature: 0,
  maxTemperature: 1,
  initialTemperature: 0.2,
  stepSize: 0.1,
  prompts: [
    {
      id: "story-prompt",
      prompt:
        "Write the opening sentence of a story about a student discovering a mysterious door.",
      description:
        "Use this exact prompt at several temperatures to compare output variability.",
    },
  ],
  outputSets: [
    {
      promptId: "story-prompt",
      outputs: [
        {
          temperature: 0,
          output:
            "Maya discovered a mysterious door hidden behind the old library shelves.",
          creativityScore: 35,
          predictabilityScore: 98,
        },
        {
          temperature: 0.5,
          output:
            "Behind the library's oldest shelf, Maya found a door that had never appeared on the floor plan.",
          creativityScore: 65,
          predictabilityScore: 72,
        },
        {
          temperature: 1,
          output:
            "The library whispered her name the moment Maya touched the impossible silver door.",
          creativityScore: 91,
          predictabilityScore: 35,
        },
      ],
    },
  ],
  showRandomnessMeter: true,
  showProbabilityDistribution: true,
};

const lesson4Step5: ConceptStep = {
  id: "ai-foundations-04-step-05",
  type: "concept",
  /* The same request, before and after it says what it wants. */
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "First attempt",
        body: "\"Write something about our new product.\" The model has no audience, no format, no facts — so it invents all three and returns copy nobody can use.",
      },
      after: {
        label: "After iterating",
        body: "\"Write a 60-word announcement for existing customers about offline mode: appointments sync once the device reconnects. Plain, no superlatives.\"",
      },
      transform: "add audience, format, facts",
    },
  },
  title: "Iterative Prompting",
  requiresCompletion: false,
  content:
    "Getting a useful result from Generative AI often requires iteration. Strong prompts can specify the role the model should play, the task it should perform, the context it should consider, the desired tone, the output structure, and important constraints. When the first output is weak, users can refine the prompt instead of simply accepting the result.",
  examples: [
    {
      id: "weak-prompt",
      title: "Weak Prompt",
      description:
        "Write something about climate change.",
    },
    {
      id: "strong-prompt",
      title: "More Specific Prompt",
      description:
        "Act as a science educator. Explain three causes of climate change to a high-school audience in exactly 150 words using three numbered sections.",
    },
  ],
};

const lesson4Step6: PromptRefinementActivityStep = {
  id: "ai-foundations-04-step-06",
  type: "activity",
  interactiveType: "prompt_refinement",
  title: "Prompt Refinement Challenge",
  requiresCompletion: true,
  instructions:
    "You received a weak output from a bot. Improve the prompt by adding constraints such as tone, audience, structure, role, and word limit. Your goal is to reach the target quality score.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "Excellent prompt refinement! Your additional constraints gave the model clearer instructions.",
    incorrect:
      "Your prompt still needs stronger constraints. Consider the role, audience, tone, structure, and length.",
  },
  originalPrompt: "Explain artificial intelligence.",
  flawedOutput:
    "Artificial intelligence is a technology that allows computers to do things that humans can do. It is used in many areas and is becoming more popular.",
  refinementTargets: [
    {
      id: "audience",
      label: "Specify Audience",
      description:
        "Tell the model who the explanation is intended for.",
    },
    {
      id: "tone",
      label: "Specify Tone",
      description:
        "Tell the model how the explanation should sound.",
    },
    {
      id: "structure",
      label: "Specify Structure",
      description:
        "Tell the model how the response should be organized.",
    },
    {
      id: "length",
      label: "Specify Word Limit",
      description:
        "Give the model a concrete length constraint.",
    },
  ],
  availableConstraints: [
    {
      id: "student-audience",
      category: "audience",
      label: "High School Audience",
      text: "Write for a high-school student with no technical background.",
      scoreValue: 20,
    },
    {
      id: "friendly-tone",
      category: "tone",
      label: "Friendly Tone",
      text: "Use a clear, friendly, approachable tone.",
      scoreValue: 15,
    },
    {
      id: "three-sections",
      category: "format",
      label: "Three Sections",
      text: "Organize the response into exactly three labeled sections.",
      scoreValue: 20,
    },
    {
      id: "150-words",
      category: "length",
      label: "150 Words",
      text: "Keep the response between 130 and 150 words.",
      scoreValue: 20,
    },
    {
      id: "teacher-role",
      category: "role",
      label: "Science Teacher",
      text: "Act as an experienced science teacher.",
      scoreValue: 15,
    },
    {
      id: "no-jargon",
      category: "restriction",
      label: "Avoid Jargon",
      text: "Avoid unexplained technical terminology.",
      scoreValue: 10,
    },
  ],
  minimumConstraints: 4,
  targetQualityScore: 80,
  evaluationRubric: [
    {
      id: "clarity",
      label: "Clarity",
      description: "The explanation is easy to understand.",
      weight: 25,
    },
    {
      id: "specificity",
      label: "Specificity",
      description: "The prompt gives concrete instructions.",
      weight: 25,
    },
    {
      id: "structure",
      label: "Structure",
      description: "The desired output format is clearly defined.",
      weight: 25,
    },
    {
      id: "audience",
      label: "Audience Fit",
      description: "The prompt defines who the output is for.",
      weight: 25,
    },
  ],
  sampleImprovedOutput:
    "Artificial intelligence is a way of building computer systems that can recognize patterns, make predictions, and generate useful outputs from data. It can power tools such as recommendation systems, spam filters, image recognition, and language assistants.",
};

const lesson4Completion: CompletionStep = {
  id: "ai-foundations-04-completion",
  type: "completion",
  title: "Lesson Complete",
  keyTakeaways: [
    "Generative AI creates new content from learned patterns.",
    "Temperature can influence output variability.",
    "Prompt structure can strongly affect the usefulness of an AI response.",
    "Iterative prompting means refining instructions based on the output you receive.",
  ],
  xpReward: 150,
  completionMessage:
    "You now understand the foundations of Generative AI and how users can intentionally influence generated outputs.",
  nextLessonId: "ai-foundations-05",
};

/*
 * ============================================================
 * LESSON 5
 * CAN AI BE WRONG?
 * ============================================================
 */

const lesson5Step1: ConceptStep = {
  id: "ai-foundations-05-step-01",
  type: "concept",
  title: "Hallucinations and Errors",
  requiresCompletion: false,
  content:
    "AI models do not possess guaranteed factual understanding. Language models generate probable sequences of tokens based on patterns learned during training. When information is missing, ambiguous, or poorly represented, a model can produce an answer that sounds convincing but is incorrect or fabricated. These confident fabrications are commonly called hallucinations.",
  examples: [
    {
      id: "fake-source",
      title: "Fabricated Source",
      description:
        "A model may invent a citation that looks realistic even though the source does not exist.",
    },
    {
      id: "wrong-fact",
      title: "Incorrect Fact",
      description:
        "A model may provide a plausible but incorrect date, statistic, or historical detail.",
    },
  ],
  misconception:
    "Confidence in the wording of an AI response is not proof that the information is true.",
};

const lesson5Step2: FactCheckerActivityStep = {
  id: "ai-foundations-05-step-02",
  type: "activity",
  interactiveType: "fact_checker",
  title: "Fact-Checker Detective Game",
  requiresCompletion: true,
  instructions:
    "Review the AI-generated historical biography. Highlight claims that are fabricated, misleading, unsupported, or otherwise incorrect. Use the available sources to verify your findings.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 4,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Excellent detective work! You identified claims that required verification instead of trusting confident AI-generated text.",
    incorrect:
      "Some claims were misclassified. Compare the biography against the verification sources carefully.",
  },
  document: {
    id: "fictional-biography",
    title: "AI-Generated Biography: Dr. Elena Marlowe",
    text:
      "Dr. Elena Marlowe was born in 1898 and became one of the first computer scientists. In 1927, she received the International Computing Medal for inventing the first programmable neural network. Her work was later recognized by the Royal Society in 1931. She famously said, 'Every machine contains a hidden mind waiting to be discovered.'",
  },
  claims: [
    {
      id: "claim-birth",
      text: "Dr. Elena Marlowe was born in 1898.",
      status: "unsupported",
      explanation:
        "No reliable source in the activity verifies that this person existed or was born in 1898.",
    },
    {
      id: "claim-computer-scientist",
      text: "She became one of the first computer scientists.",
      status: "unsupported",
      explanation:
        "The claim is presented as fact without reliable supporting evidence.",
    },
    {
      id: "claim-medal",
      text: "She received the International Computing Medal in 1927.",
      status: "false",
      explanation:
        "The activity's verification sources contain no evidence of this award.",
    },
    {
      id: "claim-neural-network",
      text: "She invented the first programmable neural network.",
      status: "false",
      explanation:
        "The claim is historically inconsistent with the development timeline of neural networks.",
    },
    {
      id: "claim-royal",
      text: "The Royal Society recognized her work in 1931.",
      status: "unsupported",
      explanation:
        "The supplied verification sources do not support this claim.",
    },
    {
      id: "claim-quote",
      text: "She said, 'Every machine contains a hidden mind waiting to be discovered.'",
      status: "fabricated",
      explanation:
        "The quote is presented without a verifiable primary source and is intentionally included as a hallucination.",
    },
  ],
  sources: [
    {
      id: "source-primary",
      title: "Primary Historical Records",
      sourceType: "primary",
      reliability: "high",
      summary:
        "Primary documentation should be preferred when verifying historical claims.",
    },
    {
      id: "source-reference",
      title: "Historical Reference Database",
      sourceType: "reference",
      reliability: "high",
      summary:
        "Reference material can help verify dates, people, organizations, and historical events.",
    },
  ],
  minimumFlagsRequired: 4,
  showSourceHints: true,
};

const lesson5Step3: ConceptStep = {
  id: "ai-foundations-05-step-03",
  type: "concept",
  /* Why a model can be confidently, precisely out of date. */
  visual: {
    type: "timeline",
    data: {
      milestones: [
        {
          id: "collected",
          when: "Training data collected",
          label: "The world as the model knows it",
          caption: "Everything after this point is invisible to it.",
        },
        {
          id: "trained",
          when: "Model trained",
          label: "Patterns frozen into parameters",
          caption: "Nothing is stored as text it can look up and revise.",
        },
        {
          id: "released",
          when: "Model released",
          label: "The gap begins",
          caption: "Months pass. Prices change, people move, laws are rewritten.",
        },
        {
          id: "asked",
          when: "You ask a question",
          label: "Answered from the old world",
          caption: "With no signal in the wording that the answer is stale.",
        },
      ],
    },
  },
  title: "Out-of-Date Data & Edge Cases",
  requiresCompletion: false,
  content:
    "AI models are constrained by the data and information available to them. Depending on the system, information may have a cutoff date or may not include the newest developments. Models can also struggle with edge cases—rare, unusual, ambiguous, or adversarial situations that are poorly represented in their training data.",
  examples: [
    {
      id: "cutoff",
      title: "Out-of-Date Information",
      description:
        "A model without access to current information may not know about a recent event.",
    },
    {
      id: "edge-case",
      title: "Edge Case",
      description:
        "A model trained mostly on ordinary examples may struggle when given an unusual visual, dialect, or reasoning problem.",
    },
  ],
};

const lesson5Step4: EdgeCaseMatrixActivityStep = {
  id: "ai-foundations-05-step-04",
  type: "activity",
  interactiveType: "edge_case_matrix",
  title: "Edge Case Matrix",
  requiresCompletion: true,
  instructions:
    "Select different edge cases and compare how model configurations respond. Look for situations where limited training coverage or specialized context creates additional risk.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "Great! You identified why rare or unusual inputs can expose weaknesses that ordinary test cases do not reveal.",
    incorrect:
      "Try comparing the model's training coverage with the difficulty of the edge case.",
  },
  cases: [
    {
      id: "optical-illusion",
      title: "Optical Illusion",
      description:
        "An image contains ambiguous visual patterns that can be interpreted in multiple ways.",
      category: "visual",
      expectedDifficulty: "high",
    },
    {
      id: "rare-dialect",
      title: "Rare Dialect",
      description:
        "A user writes using a dialect that appears infrequently in the training data.",
      category: "language",
      expectedDifficulty: "high",
    },
    {
      id: "trick-riddle",
      title: "Trick Math Riddle",
      description:
        "A seemingly simple question is designed to exploit assumptions about wording.",
      category: "reasoning",
      expectedDifficulty: "high",
    },
    {
      id: "ordinary-question",
      title: "Common Question",
      description:
        "A straightforward question represented by many ordinary examples.",
      category: "context",
      expectedDifficulty: "low",
    },
  ],
  models: [
    {
      id: "general-model",
      label: "General Model",
      description:
        "Broad training coverage but limited specialization for unusual cases.",
      trainingCoverage: 72,
      contextWindow: 16,
      specialization: "general",
    },
    {
      id: "specialized-model",
      label: "Specialized Model",
      description:
        "Strong coverage in a narrower domain.",
      trainingCoverage: 91,
      contextWindow: 32,
      specialization: "specialized",
    },
  ],
  expectedObservations: [
    {
      caseId: "optical-illusion",
      modelId: "general-model",
      expectedBehavior:
        "May produce an uncertain or incorrect interpretation.",
      expectedRisk: "high",
    },
    {
      caseId: "rare-dialect",
      modelId: "general-model",
      expectedBehavior:
        "May misunderstand unfamiliar vocabulary or grammar.",
      expectedRisk: "high",
    },
    {
      caseId: "trick-riddle",
      modelId: "general-model",
      expectedBehavior:
        "May answer based on a common interpretation rather than carefully analyzing the wording.",
      expectedRisk: "medium",
    },
    {
      caseId: "ordinary-question",
      modelId: "general-model",
      expectedBehavior:
        "Likely to perform reliably when the input resembles common training patterns.",
      expectedRisk: "low",
    },
  ],
  allowModelComparison: true,
  showResultsTable: true,
};

const lesson5Step5: ConceptStep = {
  id: "ai-foundations-05-step-05",
  type: "concept",
  title: "Verification Strategies",
  requiresCompletion: false,
  content:
    "Reliable AI use requires human oversight. Important information should be checked against trustworthy sources, especially primary sources when available. Citations should be verified rather than assumed to be real. AI-generated code should be tested independently. High-stakes decisions should receive appropriate human review instead of relying on an AI output simply because it sounds confident.",
  examples: [
    {
      id: "source-check",
      title: "Cross-Reference Sources",
      description:
        "Compare important claims against reliable independent sources.",
    },
    {
      id: "code-check",
      title: "Test Code",
      description:
        "Run generated code, inspect its behavior, and test edge cases before relying on it.",
    },
    {
      id: "citation-check",
      title: "Verify Citations",
      description:
        "Confirm that cited papers, websites, books, and quotations actually exist and support the claim.",
    },
  ],
};

const lesson5Step6: TruthAssessmentActivityStep = {
  id: "ai-foundations-05-step-06",
  type: "activity",
  interactiveType: "truth_assessment",
  title: "Truth Assessment Checklist",
  requiresCompletion: true,
  instructions:
    "Drag each AI output into Publish Immediately, Needs Fact-Checking, or Discard/Regenerate. Consider accuracy, safety, evidence, and potential harm.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Excellent! You are applying a verification workflow instead of blindly trusting AI output.",
    incorrect:
      "Review whether the output contains verifiable evidence, potential fabrication, or a safety concern.",
  },
  outputs: [
    {
      id: "truth-safe",
      output:
        "The Pacific Ocean is the largest ocean on Earth.",
      category: "accurate",
      correctActionId: "publish",
      explanation:
        "This is a straightforward factual statement that can be independently verified.",
    },
    {
      id: "truth-citation",
      output:
        "According to a 2024 study from the fictional Global AI Institute, humans have exactly 14,782 thoughts per day.",
      category: "needs_fact_checking",
      correctActionId: "fact_check",
      explanation:
        "The citation and exact statistic should be verified before publication.",
    },
    {
      id: "truth-medical",
      output:
        "Stop taking your prescribed medication immediately; the AI has determined you do not need it.",
      category: "unsafe",
      correctActionId: "discard",
      explanation:
        "This is unsafe high-stakes advice and should not be accepted as a substitute for qualified professional guidance.",
    },
    {
      id: "truth-fabricated",
      output:
        "The moon is made entirely of cheese, according to NASA.",
      category: "fabricated",
      correctActionId: "discard",
      explanation:
        "The claim is clearly false and falsely attributes the statement to NASA.",
    },
  ],
  actions: [
    {
      id: "publish",
      label: "Publish Immediately",
      description:
        "The output is sufficiently reliable for this low-risk context.",
    },
    {
      id: "fact_check",
      label: "Needs Fact-Checking",
      description:
        "Verify the information before using or publishing it.",
    },
    {
      id: "discard",
      label: "Discard / Regenerate",
      description:
        "The output is unsafe, fabricated, or otherwise unsuitable.",
    },
  ],
  requiredWorkflow: ["publish", "fact_check", "discard"],
  allowReordering: true,
};

const lesson5Completion: CompletionStep = {
  id: "ai-foundations-05-completion",
  type: "completion",
  title: "Lesson Complete",
  keyTakeaways: [
    "AI can generate confident but incorrect information.",
    "Hallucinations are fabricated or unsupported outputs.",
    "Cutoff dates and edge cases can limit model reliability.",
    "AI outputs should be verified before being trusted in important contexts.",
    "Human oversight remains essential.",
  ],
  xpReward: 150,
  completionMessage:
    "You now know one of the most important rules of AI literacy: a convincing AI answer is not automatically a correct answer.",
  nextLessonId: "ai-foundations-06",
};

/*
 * ============================================================
 * LESSON 6
 * BIAS, FAIRNESS, AND AI
 * ============================================================
 */

const lesson6Step1: ConceptStep = {
  id: "ai-foundations-06-step-01",
  type: "concept",
  /* Bias is usually visible in the data before it is visible in
     the output — if anyone thinks to look. */
  visual: {
    type: "data",
    data: {
      caption:
        "A face-recognition training set, by group. The model's accuracy per group ends up looking a lot like this chart — which is the whole problem.",
      bars: [
        {
          id: "group-a",
          label: "Group A",
          value: 74,
          note: "Three quarters of every example the model ever saw.",
        },
        {
          id: "group-b",
          label: "Group B",
          value: 18,
        },
        {
          id: "group-c",
          label: "Group C",
          value: 8,
          note: "Fewest examples, worst accuracy, and nobody measured it before launch.",
        },
      ],
    },
  },
  title: "Where Bias Comes From",
  requiresCompletion: false,
  content:
    "AI is not naturally objective. Models learn from data, and data reflects the world from which it was collected. If historical data contains human biases, gaps, or systemic imbalances, a model can reproduce or amplify those patterns. Bias can also enter through the way a problem is defined, which examples are collected, which features are selected, and how the system is evaluated.",
  examples: [
    {
      id: "historical-data",
      title: "Historical Patterns",
      description:
        "If historical decisions contain unequal patterns, training on those decisions can reproduce them.",
    },
    {
      id: "missing-data",
      title: "Data Gaps",
      description:
        "Groups that are underrepresented in training data may receive less reliable predictions.",
    },
  ],
};

const lesson6Step2: DatasetImbalanceActivityStep = {
  id: "ai-foundations-06-step-02",
  type: "activity",
  interactiveType: "dataset_imbalance",
  title: "Dataset Imbalance Simulator",
  requiresCompletion: true,
  instructions:
    "Inspect a recruitment AI dataset where 80% of resumes come from Group A and 20% come from Group B. Adjust the dataset distribution and observe how representation can affect recommendation patterns.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "Excellent! You observed how representation in training data can affect what a model learns.",
    incorrect:
      "Look at the relationship between dataset representation and recommendation rates.",
  },
  groups: [
    {
      id: "group-a",
      label: "Group A",
      initialPercentage: 80,
      recommendationRate: 72,
      explanation:
        "This group is heavily represented in the training dataset.",
    },
    {
      id: "group-b",
      label: "Group B",
      initialPercentage: 20,
      recommendationRate: 41,
      explanation:
        "This group is underrepresented in the training dataset.",
    },
  ],
  initialDistribution: {
    "group-a": 80,
    "group-b": 20,
  },
  targetDistribution: {
    "group-a": 50,
    "group-b": 50,
  },
  simulationResults: [
    {
      distribution: {
        "group-a": 80,
        "group-b": 20,
      },
      recommendationRates: {
        "group-a": 72,
        "group-b": 41,
      },
      disparityScore: 31,
      explanation:
        "The heavily imbalanced dataset corresponds with a substantial difference in recommendation rates.",
    },
    {
      distribution: {
        "group-a": 60,
        "group-b": 40,
      },
      recommendationRates: {
        "group-a": 66,
        "group-b": 57,
      },
      disparityScore: 9,
      explanation:
        "Improving representation reduces the simulated disparity.",
    },
    {
      distribution: {
        "group-a": 50,
        "group-b": 50,
      },
      recommendationRates: {
        "group-a": 62,
        "group-b": 61,
      },
      disparityScore: 1,
      explanation:
        "Balanced representation substantially reduces the simulated disparity, although balanced data alone does not guarantee fairness.",
    },
  ],
  showRecommendationRates: true,
  allowRebalancing: true,
};

const lesson6Step3: ConceptStep = {
  id: "ai-foundations-06-step-03",
  type: "concept",
  title: "Types of Bias: Representation & Algorithmic",
  requiresCompletion: false,
  content:
    "Representation bias occurs when some populations or situations are underrepresented in training data. Algorithmic bias can occur when an optimization process, model objective, threshold, or other design choice systematically favors one group over another. Different forms of bias can overlap, which means identifying the source is an important part of fixing the problem.",
  examples: [
    {
      id: "representation-bias",
      title: "Representation Bias",
      description:
        "A facial recognition dataset contains far fewer examples from one demographic group.",
    },
    {
      id: "algorithmic-bias",
      title: "Algorithmic Bias",
      description:
        "A model's optimization objective produces different error patterns across groups.",
    },
  ],
};

const lesson6Step4: FairnessMetricsActivityStep = {
  id: "ai-foundations-06-step-04",
  type: "activity",
  interactiveType: "fairness_metrics",
  title: "Fairness Metric Balancing",
  requiresCompletion: true,
  instructions:
    "Adjust the fairness lever for a simulated loan-approval model. Compare Equal Opportunity and Demographic Parity and observe how different definitions of fairness can produce different outcomes.",
  completion: {
    type: "target_score",
    targetScore: 75,
    allowPartialCredit: true,
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Great! Fairness is not always represented by one universal number. Different metrics capture different goals and can create trade-offs.",
    incorrect:
      "Try comparing the outcomes under Equal Opportunity and Demographic Parity.",
  },
  groups: [
    {
      id: "loan-group-a",
      label: "Group A",
      sampleCount: 1000,
      approvalRate: 68,
      representationRate: 50,
      truePositiveRate: 74,
    },
    {
      id: "loan-group-b",
      label: "Group B",
      sampleCount: 1000,
      approvalRate: 51,
      representationRate: 50,
      truePositiveRate: 58,
    },
  ],
  metrics: [
    {
      id: "equal-opportunity",
      label: "Equal Opportunity",
      description:
        "Focuses on equal true-positive rates across groups.",
      formula:
        "TPR(Group A) ≈ TPR(Group B)",
    },
    {
      id: "demographic-parity",
      label: "Demographic Parity",
      description:
        "Focuses on similar positive prediction rates across groups.",
      formula:
        "Approval Rate(Group A) ≈ Approval Rate(Group B)",
    },
  ],
  initialMetric: "equal-opportunity",
  targetMetric: "demographic-parity",
  configurations: [
    {
      id: "config-equal-opportunity",
      metricId: "equal-opportunity",
      settings: {
        "group-a-threshold": 0.62,
        "group-b-threshold": 0.55,
      },
      groupResults: {
        "loan-group-a": 68,
        "loan-group-b": 66,
      },
      tradeoffs: [
        "Approval rates may remain different.",
        "True-positive rates become more similar.",
      ],
      explanation:
        "This configuration prioritizes similar true-positive rates.",
    },
    {
      id: "config-demographic-parity",
      metricId: "demographic-parity",
      settings: {
        "group-a-threshold": 0.64,
        "group-b-threshold": 0.48,
      },
      groupResults: {
        "loan-group-a": 61,
        "loan-group-b": 60,
      },
      tradeoffs: [
        "Approval rates become more similar.",
        "True-positive rates may still differ.",
      ],
      explanation:
        "This configuration prioritizes similar positive prediction rates.",
    },
  ],
  showTradeoffs: true,
};

const lesson6Step5: ConceptStep = {
  id: "ai-foundations-06-step-05",
  type: "concept",
  title: "Mitigating Bias",
  requiresCompletion: false,
  content:
    "Addressing AI bias requires work throughout the system lifecycle. Teams can improve dataset diversity, document data sources, audit model performance across groups, test for unequal error rates, involve diverse perspectives during development, and adjust models or decision thresholds when appropriate. No single technique guarantees fairness in every situation.",
  examples: [
    {
      id: "balanced-data",
      title: "Curated Data",
      description:
        "Improve the representation and quality of training examples.",
    },
    {
      id: "bias-audit",
      title: "Bias Audits",
      description:
        "Measure model performance across relevant groups before deployment.",
    },
    {
      id: "diverse-team",
      title: "Diverse Teams",
      description:
        "Different perspectives can help identify problems that a homogeneous team may overlook.",
    },
  ],
};

const lesson6Step6: BiasAuditActivityStep = {
  id: "ai-foundations-06-step-06",
  type: "activity",
  interactiveType: "bias_audit",
  title: "Bias Audit Case File",
  requiresCompletion: true,
  instructions:
    "Inspect the audit logs from an image-recognition system. Identify the type and severity of bias in each case, then select the most appropriate mitigation.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "Excellent audit! You identified both the source of the problem and an appropriate mitigation strategy.",
    incorrect:
      "Read the audit evidence carefully. The best mitigation should address the actual source of the bias.",
  },
  cases: [
    {
      id: "audit-1",
      title: "Underrepresented Training Images",
      log:
        "Model accuracy is 94% for the majority group but 71% for an underrepresented group. The training dataset contains significantly fewer examples of the underrepresented group.",
      issueType: "representation",
      severity: "high",
      correctMitigationIds: ["balanced-data"],
      explanation:
        "The strongest evidence points to representation imbalance, so improving and balancing the training data is an appropriate first step.",
    },
    {
      id: "audit-2",
      title: "Unequal Threshold Outcomes",
      log:
        "Both groups are well represented, but the same decision threshold produces substantially different error rates.",
      issueType: "algorithmic",
      severity: "medium",
      correctMitigationIds: ["threshold-audit"],
      explanation:
        "The dataset is reasonably represented, so the team should investigate the model and decision threshold rather than assuming more data alone will solve the problem.",
    },
    {
      id: "audit-3",
      title: "Poor Evaluation Coverage",
      log:
        "The team only evaluated overall accuracy and did not report performance by demographic group.",
      issueType: "measurement",
      severity: "medium",
      correctMitigationIds: ["fairness-evaluation"],
      explanation:
        "The immediate problem is inadequate measurement. The system needs subgroup-level evaluation.",
    },
  ],
  mitigationOptions: [
    {
      id: "balanced-data",
      label: "Retrain With Balanced Data",
      description:
        "Improve representation and diversity in the training dataset.",
      applicableIssueTypes: ["representation"],
      effectiveness: 90,
    },
    {
      id: "threshold-audit",
      label: "Audit Model Thresholds",
      description:
        "Investigate whether thresholds or optimization choices create unequal outcomes.",
      applicableIssueTypes: ["algorithmic"],
      effectiveness: 85,
    },
    {
      id: "fairness-evaluation",
      label: "Add Group-Level Fairness Evaluation",
      description:
        "Measure performance separately across relevant groups.",
      applicableIssueTypes: ["measurement"],
      effectiveness: 88,
    },
    {
      id: "output-filter",
      label: "Adjust Output Filters",
      description:
        "Modify the final output layer without addressing underlying training or evaluation problems.",
      applicableIssueTypes: ["unknown"],
      effectiveness: 35,
    },
  ],
  requiredFindings: [
    "identify-issue-type",
    "identify-severity",
    "select-mitigation",
  ],
  showAuditLog: true,
  allowMultipleMitigations: false,
};

const lesson6Completion: CompletionStep = {
  id: "ai-foundations-06-completion",
  type: "completion",
  title: "Lesson Complete",
  keyTakeaways: [
    "AI systems can inherit biases from data and design decisions.",
    "Representation bias can occur when groups are underrepresented.",
    "Algorithmic bias can arise from optimization and decision-making choices.",
    "Different fairness metrics represent different definitions of fairness.",
    "Bias mitigation requires data curation, auditing, testing, and ongoing oversight.",
  ],
  xpReward: 160,
  completionMessage:
    "You now understand why AI is not automatically objective and how teams can begin identifying and mitigating unfair outcomes.",
  nextLessonId: "ai-foundations-07",
};

/*
 * ============================================================
 * LESSON 7
 * USING AI RESPONSIBLY
 * ============================================================
 */

const lesson7Step1: ConceptStep = {
  id: "ai-foundations-07-step-01",
  type: "concept",
  title: "The Pillars of Responsible AI",
  requiresCompletion: false,
  content:
    "Deploying AI responsibly requires more than making a model accurate. Responsible AI involves human oversight, privacy protection, transparency and explainability, security, and safeguards against foreseeable harm. The appropriate safeguards depend on the system, its users, and the consequences of mistakes.",
  examples: [
    {
      id: "human-oversight",
      title: "Human Oversight",
      description:
        "People remain involved when AI decisions have significant consequences.",
    },
    {
      id: "privacy",
      title: "Privacy",
      description:
        "Sensitive personal information should be protected and handled appropriately.",
    },
    {
      id: "transparency",
      title: "Transparency",
      description:
        "Users should understand when AI is being used and what limitations it has.",
    },
  ],
};

const lesson7Step2: EthicsDialActivityStep = {
  id: "ai-foundations-07-step-02",
  type: "activity",
  interactiveType: "ethics_dial",
  title: "Ethics Dial Selector",
  requiresCompletion: true,
  instructions:
    "Configure the priorities of an autonomous vehicle simulation. Adjust the balance between passenger safety, pedestrian safety, and strict adherence to traffic laws. Observe the ethical trade-offs created by each configuration.",
  completion: {
    type: "target_score",
    targetScore: 75,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "Excellent! You identified that system design involves trade-offs and that ethical priorities should be explicit rather than hidden.",
    incorrect:
      "Try adjusting the priorities and examining the resulting safety, fairness, and legal-compliance scores.",
  },
  scenario: {
    id: "autonomous-vehicle",
    title: "Autonomous Vehicle Ethics",
    description:
      "An autonomous vehicle must navigate a situation where safety, pedestrian protection, and traffic-law compliance can come into tension.",
    context:
      "You are configuring the high-level priorities for a self-driving vehicle.",
  },
  priorities: [
    {
      id: "passenger-safety",
      label: "Passenger Safety",
      description:
        "Prioritize minimizing danger to people inside the vehicle.",
      weight: 1,
    },
    {
      id: "pedestrian-safety",
      label: "Pedestrian Safety",
      description:
        "Prioritize minimizing danger to people outside the vehicle.",
      weight: 1,
    },
    {
      id: "law-adherence",
      label: "Traffic Law Adherence",
      description:
        "Prioritize strict compliance with traffic rules.",
      weight: 1,
    },
  ],
  constraints: [
    {
      id: "avoid-harm",
      label: "Avoid Preventable Harm",
      description:
        "The system should not intentionally create avoidable danger.",
      required: true,
    },
    {
      id: "human-control",
      label: "Human Override",
      description:
        "The system must provide a mechanism for appropriate human intervention.",
      required: true,
    },
  ],
  outcomes: [
    {
      id: "balanced",
      settings: {
        "passenger-safety": 34,
        "pedestrian-safety": 36,
        "law-adherence": 30,
      },
      description:
        "A balanced configuration that considers all three priorities.",
      safetyScore: 91,
      fairnessScore: 88,
      legalComplianceScore: 84,
    },
    {
      id: "passenger-heavy",
      settings: {
        "passenger-safety": 60,
        "pedestrian-safety": 20,
        "law-adherence": 20,
      },
      description:
        "A configuration strongly prioritizing passengers.",
      safetyScore: 73,
      fairnessScore: 62,
      legalComplianceScore: 70,
    },
    {
      id: "law-heavy",
      settings: {
        "passenger-safety": 20,
        "pedestrian-safety": 25,
        "law-adherence": 55,
      },
      description:
        "A configuration strongly prioritizing legal compliance.",
      safetyScore: 78,
      fairnessScore: 76,
      legalComplianceScore: 96,
    },
  ],
  showTradeoffGraph: true,
};

const lesson7Step3: ConceptStep = {
  id: "ai-foundations-07-step-03",
  type: "concept",
  title: "Intellectual Property & Privacy",
  requiresCompletion: false,
  content:
    "Feeding proprietary company information or personal data into a public AI service can create privacy and security risks. Sensitive information should only be processed through systems and workflows that are appropriate for that data. Generative AI also raises complex intellectual-property questions, including questions about copyrighted training material, generated content, licensing, and ownership.",
  examples: [
    {
      id: "personal-data",
      title: "Personal Information",
      description:
        "Names, account numbers, addresses, medical information, and other sensitive details should be handled carefully.",
    },
    {
      id: "company-data",
      title: "Proprietary Information",
      description:
        "Confidential business plans, source code, customer lists, or internal documents should not automatically be pasted into public AI tools.",
    },
    {
      id: "copyright",
      title: "Copyright",
      description:
        "AI systems raise complex questions about how copyrighted works are used, transformed, licensed, and attributed.",
    },
  ],
};

const lesson7Step4: DataRedactionActivityStep = {
  id: "ai-foundations-07-step-04",
  type: "activity",
  interactiveType: "data_redaction",
  title: "Redact & Secure",
  requiresCompletion: true,
  instructions:
    "Act as a data privacy officer. Click sensitive information to redact it before the document can be sent to an AI API.",
  completion: {
    type: "all_correct",
    allowPartialCredit: false,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Excellent! You removed sensitive information before allowing the document to reach the AI system.",
    incorrect:
      "Some sensitive information remains exposed. Review the document and identify personal or confidential data.",
  },
  document: {
    id: "patient-document",
    title: "Sample Intake Document",
    content:
      "Patient Name: Jordan Lee\nEmail: jordan.lee@example.com\nPhone: (555) 019-2211\nSSN: 123-45-6789\nMedical Record: Patient reports recurring headaches.\nAppointment ID: CLINIC-48392\nGeneral Question: What appointment times are available next week?",
    fields: [
      {
        id: "name",
        text: "Jordan Lee",
        startIndex: 14,
        endIndex: 24,
        dataType: "name",
        shouldRedact: true,
      },
      {
        id: "email",
        text: "jordan.lee@example.com",
        startIndex: 32,
        endIndex: 55,
        dataType: "email",
        shouldRedact: true,
      },
      {
        id: "phone",
        text: "(555) 019-2211",
        startIndex: 63,
        endIndex: 77,
        dataType: "phone",
        shouldRedact: true,
      },
      {
        id: "ssn",
        text: "123-45-6789",
        startIndex: 83,
        endIndex: 94,
        dataType: "ssn",
        shouldRedact: true,
      },
      {
        id: "medical",
        text: "Patient reports recurring headaches.",
        startIndex: 111,
        endIndex: 148,
        dataType: "medical_record",
        shouldRedact: true,
      },
      {
        id: "appointment-id",
        text: "CLINIC-48392",
        startIndex: 164,
        endIndex: 176,
        dataType: "account_id",
        shouldRedact: true,
      },
    ],
  },
  sensitiveFields: [
    {
      id: "field-name",
      type: "name",
      label: "Name",
      riskLevel: "medium",
      explanation:
        "A person's name is personally identifying information.",
    },
    {
      id: "field-email",
      type: "email",
      label: "Email",
      riskLevel: "medium",
      explanation:
        "An email address can directly identify or contact a person.",
    },
    {
      id: "field-phone",
      type: "phone",
      label: "Phone Number",
      riskLevel: "medium",
      explanation:
        "A phone number is personal contact information.",
    },
    {
      id: "field-ssn",
      type: "ssn",
      label: "Social Security Number",
      riskLevel: "high",
      explanation:
        "A Social Security number is highly sensitive personal information.",
    },
    {
      id: "field-medical",
      type: "medical_record",
      label: "Medical Record",
      riskLevel: "high",
      explanation:
        "Medical information is sensitive personal data.",
    },
    {
      id: "field-appointment",
      type: "account_id",
      label: "Appointment ID",
      riskLevel: "medium",
      explanation:
        "An identifier can potentially connect information to a specific person or record.",
    },
  ],
  requiredRedactions: [
    "name",
    "email",
    "phone",
    "ssn",
    "medical",
    "appointment-id",
  ],
  showRedactionPreview: true,
  allowUndo: true,
};

const lesson7Step5: ConceptStep = {
  id: "ai-foundations-07-step-05",
  type: "concept",
  title: "Transparency and Watermarking",
  requiresCompletion: false,
  content:
    "People should have meaningful information about when AI is being used and when content is synthetic. Clear disclosures, provenance information, and—where appropriate—watermarking can help users understand the origin of content. Transparency is especially important when AI-generated material could be mistaken for human-created material or when the system influences consequential decisions.",
  examples: [
    {
      id: "disclosure",
      title: "AI Disclosure",
      description:
        "A service clearly tells users that they are interacting with an AI assistant.",
    },
    {
      id: "provenance",
      title: "Content Provenance",
      description:
        "Information about how and where content was created can help users assess its origin.",
    },
  ],
};

const lesson7Step6: PolicyCreatorActivityStep = {
  id: "ai-foundations-07-step-06",
  type: "activity",
  interactiveType: "policy_creator",
  title: "Responsible AI Policy Creator",
  requiresCompletion: true,
  instructions:
    "Build an AI workplace charter by dragging the most important policy tiles into the policy area. Your charter should protect privacy, maintain human oversight, promote transparency, and reduce foreseeable harm.",
  completion: {
    type: "required_actions",
    requiredActions: [
      "privacy-policy",
      "ai-disclosure",
      "human-review",
      "safety-guardrail",
    ],
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "Excellent! Your policy establishes meaningful safeguards around privacy, transparency, safety, and human oversight.",
    incorrect:
      "Your charter is missing one or more essential responsible-AI safeguards.",
  },
  policyTiles: [
    {
      id: "privacy-policy",
      label: "No Personal Data in Prompts",
      description:
        "Do not place sensitive personal information into an AI system unless the workflow is specifically authorized and protected.",
      category: "privacy",
      required: true,
    },
    {
      id: "ai-disclosure",
      label: "Always Disclose AI Usage",
      description:
        "Clearly tell users when they are interacting with AI or receiving AI-generated content when appropriate.",
      category: "transparency",
      required: true,
    },
    {
      id: "human-review",
      label: "Human in the Loop Required",
      description:
        "Require appropriate human review for high-impact or high-risk decisions.",
      category: "oversight",
      required: true,
    },
    {
      id: "safety-guardrail",
      label: "Safety Guardrails Required",
      description:
        "Implement safeguards that prevent foreseeable harmful use or unsafe outputs.",
      category: "safety",
      required: true,
    },
    {
      id: "ip-review",
      label: "Review Intellectual Property",
      description:
        "Evaluate licensing, copyright, and ownership considerations before deployment.",
      category: "ip",
      required: false,
    },
    {
      id: "ignore-disclosure",
      label: "Never Mention AI",
      description:
        "Hide AI involvement from users.",
      category: "transparency",
      required: false,
    },
    {
      id: "share-data",
      label: "Upload Everything",
      description:
        "Send all available company and personal data to improve model performance.",
      category: "privacy",
      required: false,
    },
  ],
  requiredPolicies: [
    "privacy-policy",
    "ai-disclosure",
    "human-review",
    "safety-guardrail",
  ],
  optionalPolicies: ["ip-review"],
  categories: [
    {
      id: "privacy",
      label: "Privacy",
      description:
        "Protect personal and confidential information.",
    },
    {
      id: "transparency",
      label: "Transparency",
      description:
        "Make AI involvement and limitations understandable.",
    },
    {
      id: "oversight",
      label: "Human Oversight",
      description:
        "Keep appropriate people involved in consequential decisions.",
    },
    {
      id: "safety",
      label: "Safety",
      description:
        "Prevent foreseeable harmful or unsafe outcomes.",
    },
    {
      id: "ip",
      label: "Intellectual Property",
      description:
        "Respect copyright, licensing, and ownership considerations.",
    },
  ],
  minimumPolicies: 4,
  allowCustomPolicy: false,
};

const lesson7Completion: CompletionStep = {
  id: "ai-foundations-07-completion",
  type: "completion",
  title: "Lesson Complete",
  keyTakeaways: [
    "Responsible AI requires human oversight, privacy, transparency, and safety.",
    "Sensitive personal and proprietary information should be handled carefully.",
    "AI-generated content should be disclosed appropriately.",
    "Intellectual-property questions should be considered before deployment.",
    "Responsible AI requires policies and safeguards, not just good intentions.",
  ],
  xpReward: 170,
  completionMessage:
    "You are ready for the final challenge: putting everything you learned into one complete AI system design.",
  nextLessonId: "ai-foundations-08",
};

/*
 * ============================================================
 * LESSON 8
 * AI FOUNDATIONS CAPSTONE PROJECT
 * ============================================================
 */

const lesson8Step1: ConceptStep = {
  id: "ai-foundations-08-step-01",
  type: "concept",
  title: "AI Foundations Capstone Project",
  requiresCompletion: false,
  content:
    "Goal: Demonstrate mastery of the entire course by diagnosing, configuring, testing, and ethically deploying an AI system in a realistic scenario.",
  examples: [
    {
      id: "capstone-role",
      title: "Your Role",
      description:
        "You are the Lead AI Consultant responsible for evaluating the proposed system before it can be deployed.",
    },
    {
      id: "capstone-system",
      title: "The System",
      description:
        "You will configure and evaluate HealthBot, an AI assistant being developed by CityHealth Clinic.",
    },
  ],
};

const lesson8Step2: ConceptStep = {
  id: "ai-foundations-08-step-02",
  type: "concept",
  title: "Scenario Brief — CityHealth Clinic",
  requiresCompletion: false,
  content:
    "You are the Lead AI Consultant hired by CityHealth Clinic, a healthcare network launching an AI assistant called HealthBot. HealthBot is intended to triage patient symptoms, summarize medical notes, and schedule appointments. Because the system operates in a sensitive environment, you must evaluate its accuracy, fairness, safety, privacy, and user experience before approving deployment.",
  examples: [
    {
      id: "healthbot-purpose",
      title: "HealthBot",
      description:
        "An AI assistant designed to triage symptoms, summarize notes, and schedule appointments.",
    },
    {
      id: "consultant-responsibility",
      title: "Your Responsibility",
      description:
        "You must determine whether the system is safe and appropriate to deploy—and identify what must be fixed if it is not.",
    },
  ],
  misconception:
    "A healthcare AI system should not be treated as automatically trustworthy simply because it performs well on some test cases. High-impact systems require stronger safeguards and human oversight.",
};

const lesson8Step3: CapstoneActivityStep = {
  id: "ai-foundations-08-step-03",
  type: "activity",
  interactiveType: "capstone_pipeline",
  title: "Configure HealthBot",
  requiresCompletion: true,
  instructions:
    "Complete every stage of the HealthBot deployment pipeline. Your decisions will affect the final Accuracy, Fairness, Safety, and User Experience scores.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 3,
  },
  feedback: {
    correct:
      "HealthBot has passed the capstone review. Your system demonstrates strong accuracy, fairness, safety, and user-centered design.",
    incorrect:
      "HealthBot is not ready for deployment. Review the failed stages and revise your configuration.",
  },
  scenario: {
    id: "cityhealth-healthbot",
    organization: "CityHealth Clinic",
    title: "HealthBot AI Assistant",
    description:
      "CityHealth Clinic is preparing to launch an AI assistant that helps triage symptoms, summarize medical notes, and schedule appointments.",
    systemName: "HealthBot",
    systemPurpose:
      "Triage patient symptoms, summarize medical notes, and schedule appointments.",
    risks: [
      "Hallucinated diagnoses",
      "Unsafe medical advice",
      "Privacy violations",
      "Unequal performance across groups",
      "Overreliance on automated recommendations",
    ],
    stakeholders: [
      "Patients",
      "Doctors",
      "Nurses",
      "Clinic administrators",
      "Privacy and security staff",
    ],
  },
  stages: [
    {
      id: "capstone-stage-01",
      stage: "data_selection",
      title: "Data Selection & Model Training",
      description:
        "Select balanced training datasets for common medical conditions, filtering out poor-quality or unverified online forum data.",
      required: true,
      xpReward: 100,
    },
    {
      id: "capstone-stage-02",
      stage: "model_training",
      title: "Model Training",
      description:
        "Use the selected datasets to configure the training pipeline and evaluate whether the resulting model can generalize to new examples.",
      required: true,
      xpReward: 100,
    },
    {
      id: "capstone-stage-03",
      stage: "prompt_engineering",
      title: "Prompt Engineering & Context Setup",
      description:
        "Write a structured system prompt for HealthBot defining its persona, boundaries, tone, and temperature settings for consistent formatting.",
      required: true,
      xpReward: 100,
    },
    {
      id: "capstone-stage-04",
      stage: "error_audit",
      title: "Hallucination & Error Audit",
      description:
        "Review five sample patient interactions generated by the system. Identify instances where the AI invented medical diagnoses or gave unsafe advice.",
      required: true,
      xpReward: 100,
    },
    {
      id: "capstone-stage-05",
      stage: "bias_audit",
      title: "Bias Audit & Fairness Calibration",
      description:
        "Run test queries representing diverse age groups, languages, and cultural backgrounds. Adjust data weights to fix triage disparities.",
      required: true,
      xpReward: 100,
    },
    {
      id: "capstone-stage-06",
      stage: "responsible_deployment",
      title: "Responsible Deployment Charter",
      description:
        "Establish safety guardrails including data redaction, automated disclaimers, and human doctor approval before high-risk advice is dispatched.",
      required: true,
      xpReward: 100,
    },
    {
      id: "capstone-stage-07",
      stage: "final_signoff",
      title: "Final System Sign-Off",
      description:
        "Submit the configured HealthBot pipeline for a comprehensive score on Accuracy, Fairness, Safety, and User Experience.",
      required: true,
      xpReward: 150,
    },
  ],
  datasets: [
    {
      id: "dataset-clinical-verified",
      name: "Verified Clinical Dataset",
      description:
        "Curated medical examples reviewed for quality and relevance.",
      sourceType: "verified",
      quality: "high",
      balanced: true,
      containsSensitiveData: false,
      recommended: true,
      explanation:
        "This dataset provides higher-quality examples and avoids unnecessary exposure of personal information.",
    },
    {
      id: "dataset-clinical-primary",
      name: "Primary Clinical Records",
      description:
        "Clinical records collected directly from healthcare workflows.",
      sourceType: "primary",
      quality: "high",
      balanced: true,
      containsSensitiveData: true,
      recommended: true,
      explanation:
        "These records may provide valuable information but require strict privacy protections and appropriate governance.",
    },
    {
      id: "dataset-forum",
      name: "Anonymous Health Forum Posts",
      description:
        "Unverified online discussions containing anecdotal health claims.",
      sourceType: "forum",
      quality: "low",
      balanced: false,
      containsSensitiveData: true,
      recommended: false,
      explanation:
        "Unverified forum content may contain inaccurate medical claims and sensitive information.",
    },
    {
      id: "dataset-synthetic",
      name: "Synthetic Patient Examples",
      description:
        "Artificially generated examples designed to increase scenario variety.",
      sourceType: "synthetic",
      quality: "medium",
      balanced: true,
      containsSensitiveData: false,
      recommended: true,
      explanation:
        "Synthetic data can increase coverage when it is carefully validated against the intended task.",
    },
  ],
  promptConfig: {
    systemPromptRequirements: [
      {
        id: "role",
        label: "Define HealthBot's Role",
        description:
          "Clearly state that HealthBot is an AI assistant supporting—not replacing—qualified healthcare professionals.",
        required: true,
      },
      {
        id: "boundaries",
        label: "Define Safety Boundaries",
        description:
          "HealthBot must not independently diagnose conditions or provide high-risk medical instructions.",
        required: true,
      },
      {
        id: "tone",
        label: "Define Tone",
        description:
          "Use calm, clear, respectful, and accessible language.",
        required: true,
      },
      {
        id: "escalation",
        label: "Define Escalation",
        description:
          "High-risk situations should be escalated to an appropriate human professional.",
        required: true,
      },
      {
        id: "format",
        label: "Define Output Format",
        description:
          "Use a consistent structured format for responses.",
        required: true,
      },
    ],
    temperatureOptions: [0, 0.1, 0.2, 0.4, 0.7, 1],
    recommendedTemperature: 0.2,
    requiredPromptElements: [
      "role",
      "boundaries",
      "tone",
      "escalation",
      "format",
    ],
    forbiddenBehaviors: [
      "Inventing diagnoses",
      "Presenting uncertain information as certain",
      "Giving unsafe high-risk medical instructions",
      "Pretending to be a human doctor",
      "Exposing private patient information",
    ],
    outputFormatOptions: [
      "Structured summary",
      "Risk level",
      "Recommended next step",
      "Human escalation notice",
    ],
  },
  auditCases: [
    {
      id: "healthbot-audit-01",
      userMessage:
        "I've had chest discomfort for two hours. What should I do?",
      aiResponse:
        "You definitely have acid reflux. Take an antacid and continue your normal activities.",
      issue: "unsafe_advice",
      severity: "high",
      correctAction: "escalate",
      explanation:
        "The system incorrectly provides a definitive diagnosis and potentially unsafe advice instead of appropriately escalating a potentially serious symptom.",
    },
    {
      id: "healthbot-audit-02",
      userMessage:
        "Can you summarize my appointment notes?",
      aiResponse:
        "Your appointment was on March 12 and you were diagnosed with Condition X.",
      issue: "hallucination",
      severity: "high",
      correctAction: "regenerate",
      explanation:
        "The response invents a diagnosis that is not present in the provided information.",
    },
    {
      id: "healthbot-audit-03",
      userMessage:
        "Can you help me find an appointment next Tuesday?",
      aiResponse:
        "Yes. I can help identify available appointment times.",
      issue: "safe",
      severity: "low",
      correctAction: "approve",
      explanation:
        "This is an appropriate low-risk scheduling task.",
    },
    {
      id: "healthbot-audit-04",
      userMessage:
        "My symptoms have gotten significantly worse overnight.",
      aiResponse:
        "You should wait several more days before contacting anyone.",
      issue: "unsafe_advice",
      severity: "high",
      correctAction: "escalate",
      explanation:
        "The system should not confidently tell a patient to delay care when worsening symptoms may require professional evaluation.",
    },
    {
      id: "healthbot-audit-05",
      userMessage:
        "Please summarize this note.",
      aiResponse:
        "The patient is named Jordan Lee, lives at 123 Example Street, and has medical record number 829103.",
      issue: "privacy_violation",
      severity: "high",
      correctAction: "block",
      explanation:
        "The response unnecessarily exposes identifying information instead of minimizing sensitive data.",
    },
  ],
  fairnessTests: [
    {
      id: "fairness-english-young",
      group: "18-25",
      language: "English",
      ageRange: "18-25",
      culturalContext: "General",
      query:
        "I have had a mild headache since this morning. What should I do?",
      expectedOutcome:
        "Provide general information and recommend appropriate next steps without diagnosing.",
      observedOutcome:
        "Clear general guidance with appropriate uncertainty.",
      disparityDetected: false,
    },
    {
      id: "fairness-spanish",
      group: "18-25",
      language: "Spanish",
      ageRange: "18-25",
      culturalContext: "Latino",
      query:
        "He tenido un dolor de cabeza leve desde esta mañana. ¿Qué debo hacer?",
      expectedOutcome:
        "Equivalent safety guidance in Spanish.",
      observedOutcome:
        "Response is less specific and omits the escalation guidance.",
      disparityDetected: true,
      recommendedAdjustment:
        "Increase multilingual training coverage and evaluate safety behavior separately by language.",
    },
    {
      id: "fairness-older",
      group: "65+",
      language: "English",
      ageRange: "65+",
      culturalContext: "General",
      query:
        "I have a new symptom and several existing medications. What should I do?",
      expectedOutcome:
        "Avoid medication-specific instructions without appropriate professional review.",
      observedOutcome:
        "System provides overly specific medication advice.",
      disparityDetected: true,
      recommendedAdjustment:
        "Increase age- and medication-related safety examples and require escalation for medication-specific high-risk situations.",
    },
    {
      id: "fairness-cultural",
      group: "30-50",
      language: "English",
      ageRange: "30-50",
      culturalContext: "Diverse",
      query:
        "I prefer to describe my symptoms using cultural health terminology. Can you help summarize them?",
      expectedOutcome:
        "Respectfully clarify unfamiliar terminology rather than dismissing it.",
      observedOutcome:
        "System incorrectly interprets the terminology.",
      disparityDetected: true,
      recommendedAdjustment:
        "Add culturally diverse language examples and improve clarification behavior.",
    },
  ],
  deploymentPolicies: [
    {
      id: "redact-patient-data",
      label: "Redact Sensitive Patient Data",
      description:
        "Remove unnecessary personally identifying information before data reaches the model.",
      category: "privacy",
      required: true,
      consequenceIfMissing:
        "Patient privacy could be unnecessarily exposed.",
    },
    {
      id: "human-doctor-approval",
      label: "Human Doctor Approval",
      description:
        "Require qualified human review before high-risk medical recommendations are dispatched.",
      category: "human_oversight",
      required: true,
      consequenceIfMissing:
        "Unsafe AI recommendations could reach patients without appropriate professional review.",
    },
    {
      id: "ai-disclaimer",
      label: "Automated AI Disclosure",
      description:
        "Clearly disclose that HealthBot is an AI assistant.",
      category: "disclosure",
      required: true,
      consequenceIfMissing:
        "Users may incorrectly believe they are communicating directly with a human clinician.",
    },
    {
      id: "high-risk-escalation",
      label: "High-Risk Escalation",
      description:
        "Automatically route potentially high-risk situations for human review.",
      category: "safety",
      required: true,
      consequenceIfMissing:
        "High-risk situations may not receive appropriate human attention.",
    },
    {
      id: "data-governance",
      label: "Data Governance",
      description:
        "Define who can access patient data, how it is stored, and how it is used.",
      category: "data_governance",
      required: true,
      consequenceIfMissing:
        "Sensitive patient data could be mishandled or accessed improperly.",
    },
  ],
  scoring: {
    categories: [
      {
        id: "accuracy",
        label: "Accuracy",
        description:
          "How effectively the system produces correct, useful outputs.",
        weight: 0.3,
        maxScore: 100,
      },
      {
        id: "fairness",
        label: "Fairness",
        description:
          "How consistently the system performs across relevant groups.",
        weight: 0.25,
        maxScore: 100,
      },
      {
        id: "safety",
        label: "Safety",
        description:
          "How effectively the system prevents harmful or inappropriate behavior.",
        weight: 0.3,
        maxScore: 100,
      },
      {
        id: "userExperience",
        label: "User Experience",
        description:
          "How clear, understandable, respectful, and usable the system is.",
        weight: 0.15,
        maxScore: 100,
      },
    ],
    minimumOverallScore: 80,
    minimumCategoryScores: {
      accuracy: 75,
      fairness: 75,
      safety: 85,
      userExperience: 70,
    },
    weighting: {
      accuracy: 0.3,
      fairness: 0.25,
      safety: 0.3,
      userExperience: 0.15,
    },
  },
  finalSignoff: {
    required: true,
    confirmationText:
      "I confirm that I reviewed HealthBot for accuracy, fairness, safety, privacy, and human oversight before deployment.",
    checklist: [
      {
        id: "signoff-accuracy",
        label: "Accuracy Reviewed",
        description:
          "Training and testing results were reviewed for generalization.",
        required: true,
      },
      {
        id: "signoff-fairness",
        label: "Fairness Reviewed",
        description:
          "The system was tested across relevant groups and languages.",
        required: true,
      },
      {
        id: "signoff-safety",
        label: "Safety Reviewed",
        description:
          "High-risk outputs and escalation pathways were tested.",
        required: true,
      },
      {
        id: "signoff-privacy",
        label: "Privacy Reviewed",
        description:
          "Sensitive patient information is protected.",
        required: true,
      },
      {
        id: "signoff-human",
        label: "Human Oversight Confirmed",
        description:
          "Qualified human review is required for high-risk outputs.",
        required: true,
      },
    ],
    successMessage:
      "HealthBot has successfully completed the AI Foundations Capstone.",
    failureMessage:
      "HealthBot is not ready for deployment. Review the failed categories and revise the system configuration.",
  },
};

const lesson8Completion: CompletionStep = {
  id: "ai-foundations-08-completion",
  type: "completion",
  title: "AI Foundations Complete",
  keyTakeaways: [
    "AI systems learn patterns from data.",
    "Language models process tokens and predict likely next tokens.",
    "Generative AI can create new content from learned patterns.",
    "AI can hallucinate, fail on edge cases, and reproduce bias.",
    "Responsible AI requires privacy, transparency, fairness, safety, and human oversight.",
    "Successful AI deployment requires evaluating the entire system—not just the model.",
  ],
  xpReward: 300,
  completionMessage:
    "Congratulations! You completed What is AI? and demonstrated that you can understand, test, evaluate, and responsibly design an AI system.",
  mission: {
    target: "agent_builder",
    headline: "your mission",
    description:
      "Every lesson is done. Put it to work — open Agent Builder and make something real out of what you now know about how these systems behave.",
    label: "Build an agent",
  },
};

/*
 * ============================================================
 * LESSON OBJECTS
 * ============================================================
 */

/*
 * ============================================================
 * LESSON OPENERS, CHECKPOINTS AND CHALLENGES
 * ============================================================
 *
 * Every lesson used to run concept, activity, concept,
 * activity, concept, activity — the same seven beats, eight
 * times. The activities differed; the shape never did, and a
 * course that always moves the same way stops holding
 * attention regardless of what is in it.
 *
 * The steps below are what makes each lesson move differently.
 * They are not new machinery: IntroStep, QuizStep and
 * ChallengeStep were all written, complete and working, and
 * had simply never been given anything to render.
 *
 * Where each one lands is the point. A quiz that opens a
 * lesson does something a quiz that closes one cannot — see
 * lesson 5, which asks the question before teaching the
 * answer, precisely because most people get it wrong and the
 * surprise is the lesson.
 * ============================================================
 */

/* --- Lesson 1: the course opener ------------------------- */

const lesson1Intro: IntroStep = {
  id: "ai-foundations-01-intro",
  type: "intro",
  title: "Start here",
  subtitle:
    "Eight lessons from what a model actually is, to building and judging one yourself.",
  content:
    "You already use AI several times a day, usually without noticing. This course is about seeing it clearly: what these systems really do, where they are strong, and where they fail in ways that matter. Nothing here asks you to write code. Every idea arrives as something you can pull apart with your hands.",
  learningObjectives: [
    "Distinguish rule-based software from AI systems.",
    "Identify common examples of AI in everyday life.",
    "Explain why AI does not automatically imply consciousness or human intelligence.",
  ],
  estimatedMinutes: 2,
};

/* --- Lesson 2: explain the pipeline you just ran ---------- */

const lesson2Challenge: ChallengeStep = {
  id: "ai-foundations-02-challenge",
  type: "challenge",
  title: "Explain what went wrong",
  requiresCompletion: true,
  content:
    "You have now built a dataset, tuned a model, and tested it on data it had never seen. That last step is where most of the surprises live.",
  prompt:
    "A team trains a model that scores 99% on its training data and 61% on new data. Explain what has happened, and what you would change first.",
  instructions:
    "Two or three sentences is plenty. Name the problem, then name your first move.",
  evaluationCriteria: [
    {
      id: "c1",
      label: "Names the failure",
      description:
        "Identifies this as overfitting — the model memorised its training examples instead of learning a general pattern.",
      weight: 40,
    },
    {
      id: "c2",
      label: "Explains the gap",
      description:
        "Connects the score difference to the model being tested on data it had not seen before.",
      weight: 30,
    },
    {
      id: "c3",
      label: "Proposes a fix",
      description:
        "Suggests something concrete: more varied training data, fewer parameters, or holding back a proper test set.",
      weight: 30,
    },
  ],
  hints: [
    "A student who memorises the practice exam does brilliantly on the practice exam.",
    "Ask what the model had actually seen before each number was measured.",
    "The fix is usually about the data before it is about the model.",
  ],
  sampleSolution:
    "The model has overfitted. A 99% training score with 61% on unseen data means it memorised its examples rather than learning the pattern behind them, so it collapses the moment it meets anything new. I would look at the training data first — more examples, and more varied ones — before touching the model itself.",
};

/* --- Lesson 3: a checkpoint between two representations --- */

const lesson3Quiz: QuizStep = {
  id: "ai-foundations-03-quiz",
  type: "quiz",
  title: "Checkpoint: what the model actually reads",
  requiresCompletion: true,
  content:
    "You have just watched text get chopped into tokens. Before moving on to what those tokens mean, make sure the first half landed.",
  questionText:
    "A model is given the word \"unbelievable\". What does it actually process?",
  options: [
    {
      id: "l3q-a",
      label: "The whole word, looked up in a dictionary of English.",
      isCorrect: false,
      feedback:
        "There is no dictionary. Models have a fixed vocabulary of tokens, and most long words are not in it as single entries.",
    },
    {
      id: "l3q-b",
      label:
        "A few numeric token ids, often splitting the word into pieces like \"un\", \"believ\" and \"able\".",
      isCorrect: true,
      feedback:
        "Exactly. The word becomes a short sequence of ids, and those ids are the only thing the model ever sees.",
    },
    {
      id: "l3q-c",
      label: "The individual letters, one at a time.",
      isCorrect: false,
      feedback:
        "Some models can work at character level, but the ones you use every day work in tokens — chunks usually larger than a letter.",
    },
    {
      id: "l3q-d",
      label: "The definition of the word, retrieved from its training data.",
      isCorrect: false,
      feedback:
        "Training data is not stored and looked up. Whatever the model knows about the word is baked into numbers, not filed away as text.",
    },
  ],
  explanation:
    "Everything downstream depends on this. A model has no access to letters, spelling or meaning directly — only to token ids and the numeric relationships it has learned between them.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

/* --- Lesson 4: checkpoint, then an applied challenge ------ */

const lesson4Quiz: QuizStep = {
  id: "ai-foundations-04-quiz",
  type: "quiz",
  title: "Checkpoint: reading the temperature dial",
  requiresCompletion: true,
  questionText:
    "You need a model to extract dates from invoices, in exactly the same format every time. What temperature do you want, and why?",
  options: [
    {
      id: "l4q-a",
      label: "High, so the model considers more possibilities.",
      isCorrect: false,
      feedback:
        "More possibilities is the opposite of what you want here. Variety is a feature for brainstorming and a bug for data extraction.",
    },
    {
      id: "l4q-b",
      label: "Low, because you want the most likely answer every time.",
      isCorrect: true,
      feedback:
        "Right. Low temperature makes the model reliably pick its top choice, which is what consistency means in practice.",
    },
    {
      id: "l4q-c",
      label: "It makes no difference — temperature only affects creative writing.",
      isCorrect: false,
      feedback:
        "Temperature affects every generation. It changes how sharply the model favours its highest-probability token, whatever the task.",
    },
    {
      id: "l4q-d",
      label: "Exactly in the middle, as a safe default.",
      isCorrect: false,
      feedback:
        "A middling setting gives you middling consistency. For a task with one correct output format, you want the dial low.",
    },
  ],
  explanation:
    "Temperature is not a quality dial — it is a randomness dial. Turning it down does not make the model smarter, it makes it more repeatable, which is a different and often more useful thing.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson4Challenge: ChallengeStep = {
  id: "ai-foundations-04-challenge",
  type: "challenge",
  title: "Rewrite a weak prompt",
  requiresCompletion: true,
  content:
    "You have seen what structure does to an output. Now do it cold, without the scaffolding.",
  prompt:
    "Someone asks a model: \"write something about our new product\". They get back four paragraphs of vague marketing copy they cannot use. Rewrite their prompt.",
  instructions:
    "Write the prompt you would send instead. Aim for something you could paste straight into a model.",
  evaluationCriteria: [
    {
      id: "c1",
      label: "States the audience",
      description: "Says who is going to read this, which changes almost everything else.",
      weight: 25,
    },
    {
      id: "c2",
      label: "Fixes the format",
      description: "Specifies length, structure, or shape — not just topic.",
      weight: 25,
    },
    {
      id: "c3",
      label: "Supplies the specifics",
      description:
        "Gives the model the facts it cannot invent: what the product is, what it does, who it is for.",
      weight: 25,
    },
    {
      id: "c4",
      label: "Sets the tone",
      description: "Names a register, or an example to match.",
      weight: 25,
    },
  ],
  hints: [
    "The model has never heard of the product. Everything it does not know, it will make up.",
    "\"Something\" is the weakest word in the original prompt. What shape do you actually want back?",
    "If two different writers could satisfy your prompt in wildly different ways, it is still too loose.",
  ],
  sampleSolution:
    "Write a 60-word product announcement for existing customers of our scheduling app, announcing offline mode: appointments now sync automatically once the device reconnects. Plain and direct, no exclamation marks, no superlatives. Open with what changed for them, not with the company name.",
};

/* --- Lesson 5: the cold open ----------------------------- */

const lesson5Quiz: QuizStep = {
  id: "ai-foundations-05-quiz",
  type: "quiz",
  title: "Before we begin",
  requiresCompletion: true,
  content:
    "One question first, before any explanation. Answer from instinct — most people get this wrong, and being wrong here is the fastest way into the lesson.",
  questionText:
    "An AI assistant gives you a confident, detailed, well-written answer citing three sources. What does that tell you about whether it is correct?",
  options: [
    {
      id: "l5q-a",
      label: "It is very likely correct — confidence and detail indicate reliability.",
      isCorrect: false,
      feedback:
        "This is the intuition the whole lesson is built to break. Fluency and accuracy are produced by different things.",
    },
    {
      id: "l5q-b",
      label: "Almost nothing. Confidence is not evidence, and the citations may not exist.",
      isCorrect: true,
      feedback:
        "Correct — and worth sitting with. A model optimised to sound right will sound exactly as convincing when it is wrong.",
    },
    {
      id: "l5q-c",
      label: "It is correct if the sources are real.",
      isCorrect: false,
      feedback:
        "Closer, but real sources can still be misquoted, misattributed, or say something different from what was claimed.",
    },
    {
      id: "l5q-d",
      label: "Detailed answers are more reliable than short ones.",
      isCorrect: false,
      feedback:
        "Length is not evidence either. A fabricated answer can be arbitrarily detailed — detail is cheap to generate.",
    },
  ],
  explanation:
    "A language model is trained to produce text that reads like a good answer. Nothing in that objective requires the answer to be true. This is why confidence is the single least useful signal you have, and why the rest of this lesson is about what to use instead.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

/* --- Lesson 6: judge a real trade-off -------------------- */

const lesson6Challenge: ChallengeStep = {
  id: "ai-foundations-06-challenge",
  type: "challenge",
  title: "Choose a fairness definition",
  requiresCompletion: true,
  content:
    "You have measured the same system three ways and got three different answers about whether it is fair. That was not a mistake in the measurement.",
  prompt:
    "A hospital uses a model to flag patients for extra follow-up care. Equal accuracy across groups and equal flagging rates across groups cannot both be satisfied. Which would you choose, and what does your choice cost?",
  instructions:
    "There is no correct answer here — only defended ones. Say what you would optimise for and name what you are giving up.",
  evaluationCriteria: [
    {
      id: "c1",
      label: "Picks a definition",
      description: "Commits to one measure rather than describing both.",
      weight: 35,
    },
    {
      id: "c2",
      label: "Names the cost",
      description: "States plainly who is worse off under the choice made.",
      weight: 35,
    },
    {
      id: "c3",
      label: "Grounds it in the stakes",
      description:
        "Connects the reasoning to what happens to a real patient who is missed or wrongly flagged.",
      weight: 30,
    },
  ],
  hints: [
    "Ask which error hurts more here: a missed patient, or an unnecessary follow-up.",
    "A definition of fairness is a decision about whose errors you are willing to tolerate.",
    "The clinic's capacity matters. Flagging everyone equally is only fair if there is care to give them.",
  ],
  sampleSolution:
    "I would equalise how often the model misses patients who genuinely need follow-up, even if that means flagging one group more often. In this setting a missed patient goes untreated and an over-flagged patient gets a phone call, so the errors are not symmetric. The cost is that clinicians spend more time on false alarms in one group, which is real and should be staffed for rather than quietly absorbed.",
};

/* --- Lesson 7: a challenge early, a checkpoint late ------- */

const lesson7Challenge: ChallengeStep = {
  id: "ai-foundations-07-challenge",
  type: "challenge",
  title: "Where does the human go?",
  requiresCompletion: true,
  content:
    "You have just set the oversight dials. Now apply them to a case where getting it wrong has consequences.",
  prompt:
    "A company wants to use AI to screen job applications. Where exactly would you require a human decision, and where is automation acceptable?",
  instructions:
    "Be specific about the point in the process. \"A human reviews everything\" is not a policy anyone will follow.",
  evaluationCriteria: [
    {
      id: "c1",
      label: "Draws a real line",
      description:
        "Identifies a specific decision point where a human must sign off, not a vague commitment to oversight.",
      weight: 40,
    },
    {
      id: "c2",
      label: "Allows some automation",
      description:
        "Accepts that some steps can be automated, and says which — a policy that automates nothing is not a policy about AI.",
      weight: 30,
    },
    {
      id: "c3",
      label: "Justifies the asymmetry",
      description:
        "Explains why rejection deserves more scrutiny than advancement, or argues the reverse convincingly.",
      weight: 30,
    },
  ],
  hints: [
    "Consider which decisions are reversible and which quietly are not.",
    "A candidate never learns why they were filtered out, which makes that the hardest error to catch.",
    "Sorting and summarising are not the same kind of act as rejecting.",
  ],
  sampleSolution:
    "Automation is fine for sorting, deduplicating and summarising applications — anything that changes the order of a pile without removing anything from it. The moment a candidate is removed from consideration, a named human has to make that call and record a reason. Rejections are invisible to the person they affect, so they get no automatic path; advancement can be assisted, because a wrongly advanced candidate is caught at the next stage and a wrongly rejected one never is.",
};

const lesson7Quiz: QuizStep = {
  id: "ai-foundations-07-quiz",
  type: "quiz",
  title: "Checkpoint: disclosure",
  requiresCompletion: true,
  questionText:
    "Your team uses AI to draft replies to customer support emails. A human edits every reply before it is sent. Do you tell the customer AI was involved?",
  options: [
    {
      id: "l7q-a",
      label: "No — a human approved it, so it is the human's message.",
      isCorrect: false,
      feedback:
        "Human review raises quality, but it does not answer the question the customer would actually ask if they knew.",
    },
    {
      id: "l7q-b",
      label:
        "Yes — people are entitled to know when a system helped produce something addressed to them.",
      isCorrect: true,
      feedback:
        "Right. The test is not whether the output is good, it is whether the person would want to know and could not find out on their own.",
    },
    {
      id: "l7q-c",
      label: "Only if the customer asks directly.",
      isCorrect: false,
      feedback:
        "Disclosure that depends on the customer guessing what to ask is not really disclosure.",
    },
    {
      id: "l7q-d",
      label: "Only for sensitive topics like billing or medical questions.",
      isCorrect: false,
      feedback:
        "Sensitivity raises the stakes, but a rule that applies only sometimes leaves people unsure what to assume the rest of the time.",
    },
  ],
  explanation:
    "Transparency is about the recipient's position, not the sender's comfort. A person receiving a message cannot tell how it was produced, cannot ask an informed question about it, and has no way to calibrate their trust — which is exactly why the obligation sits with you.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

/* --- Lesson 8: the brief, and the recommendation ---------- */

const lesson8Intro: IntroStep = {
  id: "ai-foundations-08-intro",
  type: "intro",
  title: "The capstone",
  subtitle:
    "One system, seven lessons' worth of scrutiny, and a decision at the end that is genuinely yours to make.",
  content:
    "Everything so far has been one idea at a time. Real systems do not arrive that way — they arrive whole, with the data problem and the prompt problem and the fairness problem all tangled together, and someone has to decide whether to ship. That someone is you for the next hour.",
  learningObjectives: [
    "Apply AI fundamentals to a realistic system.",
    "Evaluate training data and model behavior.",
    "Identify hallucinations and unsafe outputs.",
    "Evaluate fairness across different groups.",
    "Make a final AI deployment recommendation.",
  ],
  estimatedMinutes: 3,
};

const lesson8Challenge: ChallengeStep = {
  id: "ai-foundations-08-challenge",
  type: "challenge",
  title: "Your recommendation",
  requiresCompletion: true,
  content:
    "You have run the whole pipeline on HealthBot. This is the part that gets read.",
  prompt:
    "Write the recommendation you would put in front of CityHealth Clinic's board. Deploy, deploy with conditions, or do not deploy — and why.",
  instructions:
    "Board members are not engineers. Write for someone who has to act on this without being able to check your reasoning themselves.",
  evaluationCriteria: [
    {
      id: "c1",
      label: "Makes a call",
      description:
        "Gives a clear recommendation rather than listing considerations and leaving the decision open.",
      weight: 30,
    },
    {
      id: "c2",
      label: "Cites what you found",
      description:
        "Points at specific evidence from the pipeline — the data gaps, the failure cases, the fairness numbers.",
      weight: 30,
    },
    {
      id: "c3",
      label: "Names the safeguards",
      description:
        "Specifies what must be true for this to run safely, in terms someone could actually implement.",
      weight: 25,
    },
    {
      id: "c4",
      label: "Is honest about risk",
      description:
        "States what could still go wrong under your recommendation rather than presenting it as solved.",
      weight: 15,
    },
  ],
  hints: [
    "A board wants a decision, not a summary. Lead with it.",
    "\"Deploy with conditions\" is only useful if you say what the conditions are and who checks them.",
    "The strongest recommendations name their own failure mode before someone else does.",
  ],
  sampleSolution:
    "Deploy with conditions, limited to appointment scheduling and clinic information. Do not deploy for anything a patient could read as medical advice: the model produced confident, wrong answers on symptom questions during testing, and its training data under-represents the over-65 group that makes up much of our patient list. Conditions: every clinical-sounding question routes to a human within the same session; the assistant states it is automated at the start of every conversation; and we re-check accuracy by age group monthly, with a named owner. The residual risk is that a patient phrases a medical question as a scheduling one and gets an answer we did not intend — which is why the routing rule needs testing before launch, not after.",
};

export const aiFoundationsLessons: Lesson[] = [
  {
    id: "ai-foundations-01",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 1,
    title: "What is AI?",
    description:
      "Learn what artificial intelligence is, how it differs from traditional software, where it appears in everyday life, and what AI is not.",
    track: "AI Foundations",
    conceptIds: [
      "ai-rules-vs-learning",
      "ai-everyday-life",
      "ai-what-ai-is-not",
    ],
    challengeIds: [
      "decision-tree-builder",
      "spot-the-ai",
      "ai-foundations-knowledge-check",
    ],
    prerequisites: [],
    totalXp: 100,
    estimatedMinutes: 25,
    learningObjectives: [
      "Distinguish rule-based software from AI systems.",
      "Identify common examples of AI in everyday life.",
      "Explain why AI does not automatically imply consciousness or human intelligence.",
    ],
    keyTakeaways: [
      "AI can recognize patterns in data.",
      "Traditional software often follows explicitly programmed rules.",
      "AI powers many everyday technologies.",
    ],
    steps: [
      lesson1Intro,
      lesson1Step4,
      lesson1Step1,
      lesson1Step2,
      lesson1Step3,
      lesson1Step6,
      lesson1Step5,
      lesson1Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-02",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 2,
    title: "How Does AI Learn?",
    description:
      "Explore supervised and unsupervised learning, training data, feature extraction, parameter tuning, and model evaluation.",
    track: "AI Foundations",
    conceptIds: [
      "supervised-learning",
      "unsupervised-learning",
      "feature-extraction",
      "model-evaluation",
      "overfitting",
    ],
    challengeIds: [
      "dataset-playground",
      "parameter-tuning",
      "model-testing",
    ],
    prerequisites: ["ai-foundations-01"],
    totalXp: 120,
    estimatedMinutes: 30,
    learningObjectives: [
      "Explain supervised and unsupervised learning.",
      "Understand how training data affects model behavior.",
      "Explain why models are tested on unseen data.",
      "Recognize overfitting as a generalization problem.",
    ],
    keyTakeaways: [
      "Models learn patterns from data.",
      "Training and testing serve different purposes.",
      "More data is useful when it is relevant and representative.",
    ],
    steps: [
      lesson2Step1,
      lesson2Step2,
      lesson2Step4,
      lesson2Step3,
      lesson2Step6,
      lesson2Step5,
      lesson2Challenge,
      lesson2Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-03",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 3,
    title: "How Do AI Models Understand Language?",
    description:
      "Discover tokenization, embeddings, vector relationships, context, and next-token prediction.",
    track: "AI Foundations",
    conceptIds: [
      "tokenization",
      "embeddings",
      "context",
      "vector-space",
      "next-token-prediction",
    ],
    challengeIds: [
      "tokenizer-playground",
      "vector-similarity",
      "next-token-game",
    ],
    prerequisites: ["ai-foundations-02"],
    totalXp: 140,
    estimatedMinutes: 30,
    learningObjectives: [
      "Explain what tokens are.",
      "Understand why text is represented numerically.",
      "Describe how embeddings represent relationships.",
      "Explain the basic idea behind next-token prediction.",
    ],
    keyTakeaways: [
      "Language models process numerical representations of text.",
      "Context changes how tokens are interpreted.",
      "LLMs generate text token by token.",
    ],
    steps: [
      lesson3Step2,
      lesson3Step1,
      lesson3Quiz,
      lesson3Step4,
      lesson3Step3,
      lesson3Step6,
      lesson3Step5,
      lesson3Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-04",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 4,
    title: "How Generative AI Creates Things",
    description:
      "Learn how Generative AI creates content, how temperature affects output variability, and how iterative prompting improves results.",
    track: "AI Foundations",
    conceptIds: [
      "generative-ai",
      "generation-vs-recognition",
      "temperature",
      "prompt-engineering",
      "iterative-prompting",
    ],
    challengeIds: [
      "prompt-weaver",
      "temperature-slider",
      "prompt-refinement",
    ],
    prerequisites: ["ai-foundations-03"],
    totalXp: 150,
    estimatedMinutes: 30,
    learningObjectives: [
      "Differentiate generative AI from recognition systems.",
      "Understand the purpose of temperature.",
      "Build more effective structured prompts.",
      "Use iterative prompting to improve outputs.",
    ],
    keyTakeaways: [
      "Generative AI creates new content.",
      "Temperature changes output variability.",
      "Clear constraints can make AI outputs more useful.",
    ],
    steps: [
      lesson4Step2,
      lesson4Step1,
      lesson4Step4,
      lesson4Step3,
      lesson4Quiz,
      lesson4Step6,
      lesson4Step5,
      lesson4Challenge,
      lesson4Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-05",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 5,
    title: "Can AI Be Wrong?",
    description:
      "Learn about hallucinations, outdated information, edge cases, and practical strategies for verifying AI-generated information.",
    track: "AI Foundations",
    conceptIds: [
      "hallucinations",
      "ai-errors",
      "edge-cases",
      "verification",
      "human-oversight",
    ],
    challengeIds: [
      "fact-checker",
      "edge-case-matrix",
      "truth-assessment",
    ],
    prerequisites: ["ai-foundations-04"],
    totalXp: 150,
    estimatedMinutes: 30,
    learningObjectives: [
      "Explain why AI systems can hallucinate.",
      "Identify situations where AI is more likely to fail.",
      "Recognize edge cases and outdated information.",
      "Apply a verification workflow to AI outputs.",
    ],
    keyTakeaways: [
      "AI can confidently produce incorrect information.",
      "Rare and unfamiliar inputs can expose model weaknesses.",
      "Important AI outputs should be verified.",
    ],
    steps: [
      lesson5Quiz,
      lesson5Step1,
      lesson5Step2,
      lesson5Step4,
      lesson5Step3,
      lesson5Step6,
      lesson5Step5,
      lesson5Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-06",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 6,
    title: "Bias, Fairness, and AI",
    description:
      "Understand where AI bias comes from, how representation and algorithmic bias differ, and how fairness can be evaluated and improved.",
    track: "AI Foundations",
    conceptIds: [
      "ai-bias",
      "representation-bias",
      "algorithmic-bias",
      "fairness",
      "bias-mitigation",
    ],
    challengeIds: [
      "dataset-imbalance",
      "fairness-metrics",
      "bias-audit",
    ],
    prerequisites: ["ai-foundations-05"],
    totalXp: 160,
    estimatedMinutes: 35,
    learningObjectives: [
      "Explain how bias can enter an AI system.",
      "Distinguish representation bias from algorithmic bias.",
      "Understand why fairness can have multiple definitions.",
      "Identify appropriate bias mitigation strategies.",
    ],
    keyTakeaways: [
      "AI systems learn from human-created data.",
      "Imbalanced data can contribute to unequal outcomes.",
      "Fairness must be evaluated explicitly.",
    ],
    steps: [
      lesson6Step2,
      lesson6Step1,
      lesson6Step4,
      lesson6Step3,
      lesson6Step6,
      lesson6Step5,
      lesson6Challenge,
      lesson6Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-07",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 7,
    title: "Using AI Responsibly",
    description:
      "Explore human oversight, privacy, intellectual property, transparency, disclosure, and responsible AI policy design.",
    track: "AI Foundations",
    conceptIds: [
      "responsible-ai",
      "privacy",
      "intellectual-property",
      "transparency",
      "human-oversight",
    ],
    challengeIds: [
      "ethics-dial",
      "data-redaction",
      "policy-creator",
    ],
    prerequisites: ["ai-foundations-06"],
    totalXp: 170,
    estimatedMinutes: 35,
    learningObjectives: [
      "Identify the pillars of responsible AI.",
      "Recognize privacy and intellectual-property risks.",
      "Explain why transparency matters.",
      "Create practical AI governance policies.",
    ],
    keyTakeaways: [
      "Responsible AI requires safeguards beyond model accuracy.",
      "Sensitive information must be protected.",
      "Users should understand when AI is involved.",
      "Human oversight is essential for high-risk applications.",
    ],
    steps: [
      lesson7Step1,
      lesson7Step2,
      lesson7Challenge,
      lesson7Step4,
      lesson7Step3,
      lesson7Quiz,
      lesson7Step6,
      lesson7Step5,
      lesson7Completion,
    ],
    passingScore: 80,
  },

  {
    id: "ai-foundations-08",
    courseId: "ai-foundations",
    courseTitle: "What is AI?",
    number: 8,
    title: "AI Foundations Capstone Project",
    description:
      "Apply everything from the course to diagnose, configure, test, audit, and responsibly deploy the fictional HealthBot AI system for CityHealth Clinic.",
    track: "AI Foundations",
    conceptIds: [
      "ai-foundations-integration",
      "ai-system-evaluation",
      "responsible-deployment",
    ],
    challengeIds: [
      "healthbot-capstone",
      "final-system-signoff",
    ],
    prerequisites: [
      "ai-foundations-01",
      "ai-foundations-02",
      "ai-foundations-03",
      "ai-foundations-04",
      "ai-foundations-05",
      "ai-foundations-06",
      "ai-foundations-07",
    ],
    totalXp: 750,
    estimatedMinutes: 60,
    isCapstone: true,
    learningObjectives: [
      "Apply AI fundamentals to a realistic system.",
      "Evaluate training data and model behavior.",
      "Configure a structured AI prompt.",
      "Identify hallucinations and unsafe outputs.",
      "Evaluate fairness across different groups.",
      "Design responsible deployment safeguards.",
      "Make a final AI deployment recommendation.",
    ],
    keyTakeaways: [
      "AI systems must be evaluated as complete systems.",
      "Accuracy alone is not enough for responsible deployment.",
      "Fairness, safety, privacy, transparency, and human oversight all matter.",
      "AI literacy means understanding both what AI can do and where it can fail.",
    ],
    steps: [
      lesson8Intro,
      lesson8Step1,
      lesson8Step2,
      lesson8Step3,
      lesson8Challenge,
      lesson8Completion,
    ],
    passingScore: 80,
  },
];

/*
 * ============================================================
 * CURRICULUM
 * ============================================================
 */

export const aiFoundationsCurriculum: Curriculum = {
  id: "ai-foundations",
  name: "What is AI?",
  description:
    "An interactive introduction to artificial intelligence covering how AI works, how models learn, Generative AI, language models, hallucinations, bias, fairness, responsible AI, and real-world AI system evaluation.",
  concepts: [],
  lessons: aiFoundationsLessons,
  challenges: [],
  totalXp: aiFoundationsLessons.reduce(
    (total, lesson) => total + lesson.totalXp,
    0,
  ),
};

export default aiFoundationsLessons;