import type { Curriculum } from "./Curriculum";
import type {
  AiSorterActivityStep,
  BiasAuditActivityStep,
  CapstoneActivityStep,
  CompletionStep,
  ConceptStep,
  DataRedactionActivityStep,
  DatasetPlaygroundActivityStep,
  DecisionTreeActivityStep,
  EdgeCaseMatrixActivityStep,
  FactCheckerActivityStep,
  IntroStep,
  Lesson,
  ModelTestingActivityStep,
  NextTokenActivityStep,
  PromptWeaverActivityStep,
  QuizStep,
  TemperatureSliderActivityStep,
  TruthAssessmentActivityStep,
  VectorSimilarityActivityStep,
} from "./Lesson";

/*
 * ============================================================
 * BUILDING AI-POWERED WEBSITES
 * ============================================================
 *
 * Seven lessons ending in a page that actually exists.
 *
 * This is the course that turns a built thing into a shown
 * thing. The capstone is not a simulation of publishing — it
 * hands the learner into the real publishing flow with their
 * own most recent agent, and the mission is to send the link to
 * one real person.
 *
 * The design vocabulary used throughout is the real one from
 * src/features/sites/schema.ts: four templates, six palettes,
 * light and dark, three font pairs, three corner styles, and
 * five section kinds. Teaching invented options would be worse
 * than teaching none.
 */

/*
 * ============================================================
 * LESSON 1 — FROM AGENT TO PRODUCT
 * ============================================================
 */

const lesson1Intro: IntroStep = {
  id: "ai-websites-01-intro",
  type: "intro",
  title: "Start here",
  subtitle:
    "Seven lessons from a thing you built to a thing you can send someone.",
  content:
    "You have an agent. It works when you use it. That is genuinely not the same as having something you can show a person, and the gap between those two states is smaller than it feels and more specific than you think. This course closes it, and the last lesson closes it for real.",
  learningObjectives: [
    "Say what separates a working agent from something a stranger can use.",
    "Judge whether a project is ready to be seen.",
    "Decide how much personality a public-facing agent should have.",
  ],
  estimatedMinutes: 2,
};

const lesson1Concept1: ConceptStep = {
  id: "ai-websites-01-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "A thing you built",
        points: [
          "You know what to ask it",
          "You know what it is for",
          "You forgive its rough edges",
          "It lives behind a login",
        ],
      },
      right: {
        label: "A thing you can show",
        points: [
          "It says what to ask it",
          "It says what it is for",
          "Rough edges are handled or hidden",
          "It has a link",
        ],
      },
    },
  },
  title: "What Actually Separates Them",
  requiresCompletion: false,
  content:
    "Everything on the left is true because of knowledge stored in your head rather than in the product. That is the whole problem, and it is why showing someone your agent over your shoulder goes well and sending them a link goes badly. The work of this course is moving what is in your head into the page — what it is for, who it is for, what to ask it first — so the thing survives being encountered by someone who has never heard of it.",
  examples: [
    {
      id: "over-shoulder",
      title: "Demonstrated by you",
      description:
        "You supply the framing, the first question, and the excuses.",
      input: "Here, look at this, ask it about photosynthesis.",
      output: "It goes well, and proves nothing.",
    },
    {
      id: "sent-as-link",
      title: "Encountered alone",
      description:
        "The page supplies all of it, or nobody finds out what it does.",
      input: "A link, arriving with no context.",
      output: "Either the page explains itself, or the tab gets closed.",
    },
  ],
  misconception:
    "A portfolio is often thought of as evidence that you did something. It is more useful to think of it as the thing itself, working, without you standing next to it.",
};

const lesson1Activity1: TemperatureSliderActivityStep = {
  id: "ai-websites-01-step-02",
  type: "activity",
  interactiveType: "temperature_slider",
  title: "How Much Personality in Public?",
  requiresCompletion: true,
  instructions:
    "Your page is public, and the first person through the door will not ask the question you designed for. Move the dial and see how the same agent handles a stranger at different levels of latitude.",
  completion: {
    type: "required_actions",
    requiredActions: ["compare-temperatures"],
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "A public agent usually wants less latitude than a private one. Strangers arrive without your context.",
    incorrect:
      "Try the top of the range and imagine a stranger reading that as their first impression.",
  },
  minTemperature: 0,
  maxTemperature: 1,
  initialTemperature: 0.5,
  stepSize: 0.1,
  showRandomnessMeter: true,
  prompts: [
    {
      id: "on-topic",
      prompt: "A visitor asks the question your agent was built for.",
      description: "The case you designed and tested.",
    },
    {
      id: "off-topic",
      prompt: "A visitor asks something completely unrelated.",
      description: "The case that actually happens first.",
    },
  ],
  outputSets: [
    {
      promptId: "on-topic",
      outputs: [
        {
          temperature: 0,
          output:
            "Photosynthesis converts light energy into chemical energy. Here are the three stages.",
          creativityScore: 8,
          predictabilityScore: 96,
        },
        {
          temperature: 0.5,
          output:
            "Good one to start with. Photosynthesis is how a plant turns light into food — three stages, and the second is where most people get stuck. Want me to go through it?",
          creativityScore: 52,
          predictabilityScore: 64,
        },
        {
          temperature: 1,
          output:
            "Ah, the big one! Honestly photosynthesis is a bit of a magic trick when you look at it properly. Have you ever wondered why leaves are green and not black, given black absorbs more light?",
          creativityScore: 91,
          predictabilityScore: 24,
        },
      ],
    },
    {
      promptId: "off-topic",
      outputs: [
        {
          temperature: 0,
          output:
            "I can only help with GCSE biology topics. Try asking about cells, genetics or ecosystems.",
          creativityScore: 6,
          predictabilityScore: 97,
        },
        {
          temperature: 0.5,
          output:
            "That is outside what I know about — I only do GCSE biology. Cells, genetics and ecosystems are where I am useful.",
          creativityScore: 44,
          predictabilityScore: 70,
        },
        {
          temperature: 1,
          output:
            "Not really my area, but I will have a go anyway — I think the answer probably depends on which country you mean, and possibly on the year?",
          creativityScore: 88,
          predictabilityScore: 20,
        },
      ],
    },
  ],
};

const lesson1Concept2: ConceptStep = {
  id: "ai-websites-01-step-03",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        { id: "works", label: "It works", caption: "For you, when you drive it" },
        {
          id: "explains",
          label: "It explains itself",
          caption: "A stranger knows what it is",
        },
        {
          id: "invites",
          label: "It invites a first move",
          caption: "They know what to ask",
        },
        {
          id: "shareable",
          label: "It has a link",
          caption: "Now it is a thing you can send",
        },
      ],
    },
  },
  title: "Four Gates, Not One",
  requiresCompletion: false,
  content:
    "Most half-finished projects are stuck between the first and second gate, and their owners think they are stuck at the fourth. It works but I have not deployed it usually means it works but it does not explain itself, and deploying it in that state produces a link nobody understands. The gates are in order for a reason: a link to something that cannot introduce itself is worse than no link, because now you have had your one chance.",
  examples: [
    {
      id: "gate-two",
      title: "Stuck at gate two",
      description:
        "Works fine. A visitor cannot tell what it is within five seconds.",
      input: "An empty chat box on a blank page.",
      output: "Closed tab.",
    },
    {
      id: "gate-three",
      title: "Through gate three",
      description:
        "Says what it is, and offers a first question so nobody has to invent one.",
      input: "A headline, a line of explanation, three example questions.",
      output: "A visitor who actually tries it.",
    },
  ],
  misconception:
    "Adding features is the usual response to a project that does not feel ready. Almost always the missing thing is not a feature — it is a sentence saying what the thing is.",
};

const lesson1Activity2: DecisionTreeActivityStep = {
  id: "ai-websites-01-step-04",
  type: "activity",
  interactiveType: "decision_tree_builder",
  title: "Is It Ready To Be Seen?",
  requiresCompletion: true,
  instructions:
    "Build the rule you will use on your own project. Then run six real ones through it and see where they land.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Notice the rule never asks whether it has enough features.",
    incorrect:
      "Start with whether a stranger could tell what it is. Everything else is downstream.",
  },
  showLivePreview: true,
  allowReordering: true,
  targetCategories: ["Ready to publish", "Needs a page", "Not a product yet"],
  dataset: [
    {
      id: "p1",
      name: "A revision agent that works, with a headline and three sample questions",
      attributes: { works: true, explainsItself: true, invitesFirstMove: true },
      correctCategory: "Ready to publish",
    },
    {
      id: "p2",
      name: "A working agent behind a blank chat box, no explanation",
      attributes: { works: true, explainsItself: false, invitesFirstMove: false },
      correctCategory: "Needs a page",
    },
    {
      id: "p3",
      name: "An idea for an agent, sketched but not built",
      attributes: { works: false, explainsItself: false, invitesFirstMove: false },
      correctCategory: "Not a product yet",
    },
    {
      id: "p4",
      name: "A working agent with a good headline but nothing suggesting what to ask",
      attributes: { works: true, explainsItself: true, invitesFirstMove: false },
      correctCategory: "Needs a page",
    },
    {
      id: "p5",
      name: "A polished page describing an agent that does not run",
      attributes: { works: false, explainsItself: true, invitesFirstMove: true },
      correctCategory: "Not a product yet",
    },
    {
      id: "p6",
      name: "A working study tool with purpose, examples and an about section",
      attributes: { works: true, explainsItself: true, invitesFirstMove: true },
      correctCategory: "Ready to publish",
    },
  ],
  availableConditions: [
    {
      id: "cond-works",
      label: "Does it actually run?",
      attribute: "works",
      operator: "equals",
      value: true,
    },
    {
      id: "cond-explains",
      label: "Could a stranger tell what it is?",
      attribute: "explainsItself",
      operator: "equals",
      value: true,
    },
    {
      id: "cond-invites",
      label: "Does it suggest a first thing to try?",
      attribute: "invitesFirstMove",
      operator: "equals",
      value: true,
    },
  ],
  solution: {
    rootConditionId: "cond-works",
    nodes: [
      {
        id: "n-works",
        label: "Does it run?",
        conditionId: "cond-works",
        yesChildId: "n-explains",
        noChildId: "n-not-product",
      },
      { id: "n-not-product", label: "Not a product yet", result: "Not a product yet" },
      {
        id: "n-explains",
        label: "Explains itself?",
        conditionId: "cond-explains",
        yesChildId: "n-invites",
        noChildId: "n-needs-page",
      },
      { id: "n-needs-page", label: "Needs a page", result: "Needs a page" },
      {
        id: "n-invites",
        label: "Invites a first move?",
        conditionId: "cond-invites",
        yesChildId: "n-ready",
        noChildId: "n-needs-page-2",
      },
      { id: "n-ready", label: "Ready to publish", result: "Ready to publish" },
      { id: "n-needs-page-2", label: "Needs a page", result: "Needs a page" },
    ],
    classifications: {
      p1: "Ready to publish",
      p2: "Needs a page",
      p3: "Not a product yet",
      p4: "Needs a page",
      p5: "Not a product yet",
      p6: "Ready to publish",
    },
  },
};

const lesson1Quiz: QuizStep = {
  id: "ai-websites-01-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Your agent works perfectly when you use it, but people you send it to do not engage. What is the most likely missing piece?",
  options: [
    {
      id: "w1q-a",
      label: "It needs more features.",
      isCorrect: false,
      feedback:
        "Almost never the answer, and adding them delays finding the real one.",
    },
    {
      id: "w1q-b",
      label:
        "It does not explain what it is or suggest what to ask, so visitors supply neither.",
      isCorrect: true,
      feedback:
        "Right. You were supplying that context in person and did not notice.",
    },
    {
      id: "w1q-c",
      label: "The model is not good enough.",
      isCorrect: false,
      feedback:
        "It worked fine for you on the same model. The difference is the visitor, not the model.",
    },
    {
      id: "w1q-d",
      label: "The link is too long.",
      isCorrect: false,
      feedback: "Not a real barrier.",
    },
  ],
  explanation:
    "When you demonstrate something in person you supply the purpose, the first question and the benefit of the doubt. A link supplies none of those, so the page has to.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson1Completion: CompletionStep = {
  id: "ai-websites-01-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "What makes your agent work for you is knowledge in your head, not in the product.",
    "Four gates: it runs, it explains itself, it invites a first move, it has a link.",
    "Most stuck projects are stuck at explaining themselves, not at deploying.",
    "A public agent usually wants less latitude than a private one.",
  ],
  xpReward: 25,
  completionMessage:
    "You can now say what your project is missing, which is usually a sentence rather than a feature.",
  nextLessonId: "ai-websites-02",
};

/*
 * ============================================================
 * LESSON 2 — WHO IS THIS FOR?
 * ============================================================
 */

const lesson2Intro: IntroStep = {
  id: "ai-websites-02-intro",
  type: "intro",
  title: "Who Is This For?",
  subtitle: "Audience before design, because design cannot answer this.",
  content:
    "The page builder asks you for a headline, a tagline and some sections. Every one of those questions is unanswerable until you have decided who is reading. This lesson does that first, so the writing later takes minutes instead of an afternoon.",
  learningObjectives: [
    "Name a specific audience rather than a general one.",
    "Group real visitors by what they actually need.",
    "Recognise when a page is written for the person who built it.",
  ],
  estimatedMinutes: 3,
};

const lesson2Concept1: ConceptStep = {
  id: "ai-websites-02-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Written for everyone",
        body: "An AI-powered assistant designed to help users with a variety of tasks.",
      },
      after: {
        label: "Written for someone",
        body: "Ask it a GCSE biology question and it will ask you questions back until you can answer it yourself.",
      },
      transform: "Pick one reader and write to them",
    },
  },
  title: "Everyone Is Not an Audience",
  requiresCompletion: false,
  content:
    "The first version is not badly written. It is written for nobody, which is what happens when you refuse to exclude anyone. The second names a subject, a level, and a method, and in doing so tells a Year 11 student this is for them and tells a software engineer it is not. That second part feels like a loss and is the entire benefit — a page that turns the wrong people away is a page the right people recognise.",
  examples: [
    {
      id: "general",
      title: "General",
      description: "Excludes nobody, attracts nobody.",
      input: "Helps you learn more effectively.",
      output: "Read as noise.",
    },
    {
      id: "specific",
      title: "Specific",
      description: "One reader can tell instantly that this is theirs.",
      input: "For Year 11s who understand it in class and forget it by Thursday.",
      output: "Read as recognition.",
    },
  ],
  misconception:
    "Narrowing the audience feels like shrinking the potential audience. In practice it grows it, because a page nobody feels addressed by gets shared by nobody.",
};

const lesson2Activity1: VectorSimilarityActivityStep = {
  id: "ai-websites-02-step-02",
  type: "activity",
  interactiveType: "vector_similarity",
  title: "Who Is Standing Near Whom",
  requiresCompletion: true,
  instructions:
    "Six real visitors, placed by what they actually need rather than by who they are. Find which ones sit together — those are the groups your page can serve with one sentence.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "Groups form around need, not around demographics. That is what you write to.",
    incorrect:
      "Ignore who they are and look at what they turned up wanting.",
  },
  similarityMetric: "cosine",
  points: [
    {
      id: "student-stuck",
      label: "Stuck on a topic",
      x: 22,
      y: 74,
      category: "learner",
      explanation: "Wants to understand something specific, now.",
    },
    {
      id: "student-revising",
      label: "Revising for a mock",
      x: 28,
      y: 80,
      category: "learner",
      explanation:
        "Different year, different topic, same need — sits right beside the first.",
    },
    {
      id: "parent",
      label: "Parent checking",
      x: 76,
      y: 30,
      category: "gatekeeper",
      explanation: "Not going to use it. Deciding whether to allow it.",
    },
    {
      id: "teacher",
      label: "Teacher deciding",
      x: 82,
      y: 36,
      category: "gatekeeper",
      explanation:
        "Wants to know what it will and will not do, exactly like the parent.",
    },
    {
      id: "recruiter",
      label: "Assessing you",
      x: 50,
      y: 14,
      category: "evaluator",
      explanation: "There for you, not for the tool.",
    },
    {
      id: "friend",
      label: "A friend",
      x: 44,
      y: 20,
      category: "evaluator",
      explanation:
        "Also there for you rather than the tool — near the recruiter, far from the learners.",
    },
  ],
  targetPairs: [
    {
      firstId: "student-stuck",
      secondId: "student-revising",
      expectedRelationship: "similar",
    },
    { firstId: "parent", secondId: "teacher", expectedRelationship: "similar" },
    {
      firstId: "recruiter",
      secondId: "friend",
      expectedRelationship: "similar",
    },
    {
      firstId: "student-stuck",
      secondId: "recruiter",
      expectedRelationship: "different",
    },
  ],
};

const lesson2Concept2: ConceptStep = {
  id: "ai-websites-02-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "Who actually opens a link you shared",
      bars: [
        { id: "b1", label: "There for you", value: 55, note: "Friends, evaluators" },
        { id: "b2", label: "Deciding about it", value: 25, note: "Parents, teachers" },
        { id: "b3", label: "Actually need it", value: 20, note: "The target user" },
      ],
    },
  },
  title: "Three Audiences, One Page",
  requiresCompletion: false,
  content:
    "Most of the people who open your link are not your target user, and that is fine as long as the page knows it. The learner needs a way in. The gatekeeper needs to know what it refuses to do. The evaluator needs to see that you made a decision on purpose. One page can serve all three if you order it correctly — lead with what it is and who it is for, and everything else has somewhere to attach.",
  examples: [
    {
      id: "lead-purpose",
      title: "Lead with purpose",
      description: "All three audiences get what they came for in one line.",
      input: "A GCSE biology tutor that never gives you the answer.",
      output:
        "Learner: usable. Gatekeeper: reassured. Evaluator: sees a decision.",
    },
    {
      id: "lead-tech",
      title: "Lead with how it was built",
      description: "Serves only the evaluator, and not especially well.",
      input: "Built with a retrieval-augmented pipeline over a custom corpus.",
      output: "Learner and gatekeeper both leave.",
    },
  ],
  misconception:
    "It is tempting to write the page for the evaluator, because that is who you are nervous about. The evaluator is most impressed by a page that clearly serves the learner.",
};

const lesson2Activity2: DatasetPlaygroundActivityStep = {
  id: "ai-websites-02-step-04",
  type: "activity",
  interactiveType: "dataset_playground",
  title: "Sort the Arrivals",
  requiresCompletion: true,
  instructions:
    "Eight things real visitors did in their first ten seconds. Label each by which audience it came from. The pattern gets clear faster than you expect.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 6,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Once you can name which audience a behaviour comes from, you can tell which one your page is failing.",
    incorrect:
      "Ask what the person was trying to find out, not what they clicked.",
  },
  showConfidence: true,
  requiredLabels: 6,
  categories: [
    {
      id: "learner",
      label: "Learner",
      description: "Here to use the thing.",
    },
    {
      id: "gatekeeper",
      label: "Gatekeeper",
      description: "Deciding whether to allow or recommend it.",
    },
    {
      id: "evaluator",
      label: "Evaluator",
      description: "Here to form a view about you.",
    },
  ],
  dataset: [
    {
      id: "v1",
      label: "Typed a biology question straight into the chat box.",
      correctLabel: "learner",
    },
    {
      id: "v2",
      label: "Read the whole About section before touching anything.",
      correctLabel: "gatekeeper",
    },
    {
      id: "v3",
      label: "Scrolled to the bottom looking for who made this.",
      correctLabel: "evaluator",
    },
    {
      id: "v4",
      label: "Asked it something rude to see what it would do.",
      correctLabel: "evaluator",
    },
    {
      id: "v5",
      label: "Searched the page for the word data.",
      correctLabel: "gatekeeper",
    },
    {
      id: "v6",
      label: "Clicked one of the suggested example questions.",
      correctLabel: "learner",
    },
    {
      id: "v7",
      label: "Asked whether it stores what children type.",
      correctLabel: "gatekeeper",
    },
    {
      id: "v8",
      label: "Asked it a follow-up, then another, for six minutes.",
      correctLabel: "learner",
    },
  ],
  trainingStages: [
    {
      id: "st-1",
      label: "Two labelled",
      minimumItems: 2,
      accuracy: 41,
      confidence: 25,
    },
    {
      id: "st-2",
      label: "Four labelled",
      minimumItems: 4,
      accuracy: 68,
      confidence: 52,
    },
    {
      id: "st-3",
      label: "Six labelled",
      minimumItems: 6,
      accuracy: 86,
      confidence: 77,
    },
    {
      id: "st-4",
      label: "All eight labelled",
      minimumItems: 8,
      accuracy: 93,
      confidence: 89,
    },
  ],
};

const lesson2Quiz: QuizStep = {
  id: "ai-websites-02-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why does narrowing your stated audience usually increase the number of people who engage?",
  options: [
    {
      id: "w2q-a",
      label: "Search engines rank specific pages higher.",
      isCorrect: false,
      feedback: "Possibly true and not the mechanism being taught here.",
    },
    {
      id: "w2q-b",
      label:
        "A page that addresses someone specifically is recognised; a page addressed to everyone is read as noise.",
      isCorrect: true,
      feedback:
        "Right. Turning the wrong people away is how the right people notice.",
    },
    {
      id: "w2q-c",
      label: "Shorter pages perform better.",
      isCorrect: false,
      feedback: "Length is a separate matter.",
    },
    {
      id: "w2q-d",
      label: "It reduces the number of support questions.",
      isCorrect: false,
      feedback: "A side effect at best.",
    },
  ],
  explanation:
    "Recognition is the mechanism. A line that names a subject, a level and a method lets the right reader see themselves in it, and general phrasing gives nobody anything to recognise.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson2Completion: CompletionStep = {
  id: "ai-websites-02-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Everyone is not an audience — a page for nobody in particular is read as noise.",
    "Visitors group by what they need, not by who they are.",
    "Three audiences arrive: learners, gatekeepers and evaluators.",
    "The evaluator is most impressed by a page that clearly serves the learner.",
  ],
  xpReward: 30,
  completionMessage:
    "You know who your page is for, which makes every writing decision that follows much faster.",
  nextLessonId: "ai-websites-03",
};

/*
 * ============================================================
 * LESSON 3 — DESIGN CHOICES THAT MATTER
 * ============================================================
 */

const lesson3Intro: IntroStep = {
  id: "ai-websites-03-intro",
  type: "intro",
  title: "Design Choices That Matter",
  subtitle: "Four templates, six palettes, and one decision that outranks them.",
  content:
    "The builder gives you a closed set of choices on purpose: four templates, six palettes, light or dark, three type pairings, three corner styles, and five kinds of section. This lesson is about which of those choices actually changes how a visitor experiences the page — and the answer is mostly the one nobody thinks about.",
  learningObjectives: [
    "Match a template to what the project actually is.",
    "Explain why section order matters more than palette.",
    "Judge which claims on a page can be supported.",
  ],
  estimatedMinutes: 3,
};

const lesson3Concept1: ConceptStep = {
  id: "ai-websites-03-step-01",
  type: "concept",
  visual: {
    type: "diagram",
    data: {
      nodes: [
        {
          id: "template",
          label: "Template",
          caption: "Assistant, Study Tool, Portfolio, Research Project",
        },
        {
          id: "order",
          label: "Section order",
          caption: "About, features, steps, FAQ, text",
        },
        {
          id: "surface",
          label: "Palette and type",
          caption: "Six hues, light or dark, three pairings",
        },
      ],
      links: [
        { from: "template", to: "order", label: "sets a default" },
        { from: "order", to: "surface", label: "matters more than" },
      ],
    },
  },
  title: "Order Beats Colour",
  requiresCompletion: false,
  content:
    "Palette is the choice people agonise over and it is close to the least consequential thing on the page. Six palettes, all legible in light and dark, none of which will lose you a visitor. What will lose you a visitor is section order, because a page is read from the top and most people stop early. If your About section sits below three feature cards, the person deciding whether this is for them has already left. Put what it is first, always, and let everything else follow.",
  examples: [
    {
      id: "order-bad",
      title: "Features first",
      description:
        "Answers how before anyone has decided they care about what.",
      input: "Three feature cards, then an about section.",
      output: "Gatekeepers and learners both bounce.",
    },
    {
      id: "order-good",
      title: "About first",
      description: "The one question everybody has, answered immediately.",
      input: "About, then steps, then FAQ.",
      output: "Everyone who continues knows why they are continuing.",
    },
  ],
  misconception:
    "Choosing between Study Tool and Assistant feels like a big decision. It sets sensible defaults and nothing more — you can reorder sections afterwards, and reordering is where the real gain is.",
};

const lesson3Activity1: PromptWeaverActivityStep = {
  id: "ai-websites-03-step-02",
  type: "activity",
  interactiveType: "prompt_weaver",
  title: "Assemble the Page",
  requiresCompletion: true,
  instructions:
    "Build a page from real blocks. Every one of these maps to a field the builder actually has. Watch the preview and notice which single block moves it most.",
  completion: {
    type: "required_actions",
    requiredActions: ["assemble-prompt"],
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "The purpose line did more than the palette, the font and the corners put together.",
    incorrect:
      "Swap the vague headline for the specific one and watch the preview.",
  },
  showOutputPreview: true,
  requiredCategories: ["subject", "context", "format"],
  targetPromptPattern: ["subject", "context", "format", "style"],
  promptBlocks: [
    {
      id: "pb-headline-vague",
      category: "subject",
      label: "Vague headline",
      text: "Your AI-Powered Learning Assistant",
      qualityValue: 4,
    },
    {
      id: "pb-headline-specific",
      category: "subject",
      label: "Specific headline",
      text: "GCSE Biology, explained until it sticks",
      qualityValue: 30,
    },
    {
      id: "pb-audience",
      category: "context",
      label: "Who it is for",
      text: "For Year 10 and 11 students revising on their own.",
      qualityValue: 24,
    },
    {
      id: "pb-method",
      category: "context",
      label: "What makes it different",
      text: "It asks you questions back instead of handing over answers.",
      qualityValue: 22,
    },
    {
      id: "pb-order",
      category: "format",
      label: "Section order",
      text: "About first, then Steps, then FAQ.",
      qualityValue: 18,
    },
    {
      id: "pb-examples",
      category: "format",
      label: "Three example questions",
      text: "Suggest: explain osmosis, test me on the heart, why do cells divide.",
      qualityValue: 20,
    },
    {
      id: "pb-palette",
      category: "style",
      label: "Palette and mode",
      text: "Sage, light mode, soft corners, editorial type.",
      qualityValue: 6,
    },
    {
      id: "pb-mood",
      category: "mood",
      label: "Tone",
      text: "Calm and plain. No exclamation marks.",
      qualityValue: 8,
    },
  ],
  exampleOutputs: [
    {
      label: "Vague headline plus palette",
      output:
        "A nicely coloured page that could be advertising anything. Visitors cannot tell what it does.",
      qualityScore: 18,
    },
    {
      label: "Specific headline plus audience",
      output:
        "A visitor knows within two seconds whether this is for them. Half of them stay.",
      qualityScore: 66,
    },
    {
      label: "All of it, in order",
      output:
        "Headline, who it is for, what makes it different, three things to try, then the details. Nobody has to guess anything.",
      qualityScore: 92,
    },
  ],
};

const lesson3Concept2: ConceptStep = {
  id: "ai-websites-03-step-03",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Claims you can support",
        points: [
          "It covers the GCSE biology spec",
          "It will not give you the final answer",
          "It runs in your browser",
          "I built it in three weeks",
        ],
      },
      right: {
        label: "Claims you cannot",
        points: [
          "Trusted by thousands of students",
          "The most accurate revision tool available",
          "Approved by teachers",
          "Never gets anything wrong",
        ],
      },
    },
  },
  title: "What Your Page Is Allowed to Say",
  requiresCompletion: false,
  content:
    "A page is a set of claims, and unsupported ones are the fastest way to lose the gatekeeper you most needed to convince. Trusted by thousands when it launched yesterday is not marketing enthusiasm, it is a false statement on a page with your name on it. The good news is that the true claims are more persuasive anyway: I built this in three weeks because revising alone was miserable is a better sentence than anything in the right-hand column.",
  examples: [
    {
      id: "claim-true",
      title: "True and specific",
      description: "Checkable, modest, and far more convincing.",
      input: "It covers the GCSE biology spec and refuses to do your homework.",
      output: "A teacher reads this and relaxes.",
    },
    {
      id: "claim-false",
      title: "Unsupported",
      description: "One line, and the whole page becomes suspect.",
      input: "Trusted by thousands of students nationwide.",
      output: "A teacher reads this and closes the tab.",
    },
  ],
  misconception:
    "Confidence and overstatement are not the same thing. The most confident possible page is one that states exactly what it does and refuses to pad.",
};

const lesson3Activity2: TruthAssessmentActivityStep = {
  id: "ai-websites-03-step-04",
  type: "activity",
  interactiveType: "truth_assessment",
  title: "Publish, Check, or Cut",
  requiresCompletion: true,
  instructions:
    "Six lines drafted for a real page. For each one decide whether it can go up as written, needs checking first, or has to come out.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "You are treating your own page as a set of claims, which is the only honest way to read it.",
    incorrect:
      "Ask what would happen if somebody asked you to prove that line.",
  },
  actions: [
    {
      id: "publish",
      label: "Publish as written",
      description: "True, supportable, and says something.",
    },
    {
      id: "fact_check",
      label: "Check it first",
      description: "Might be true. You do not currently know.",
    },
    {
      id: "discard",
      label: "Cut it",
      description: "Cannot be supported, or says nothing at all.",
    },
  ],
  outputs: [
    {
      id: "ln-1",
      output: "Ask it a GCSE biology question and it will ask you questions back.",
      category: "accurate",
      correctActionId: "publish",
      explanation:
        "You built it, you know it does this. Specific, true, and it explains the whole product.",
    },
    {
      id: "ln-2",
      output: "Trusted by thousands of students across the country.",
      category: "fabricated",
      correctActionId: "discard",
      explanation:
        "Nobody has used it yet. This is not enthusiasm, it is untrue.",
    },
    {
      id: "ln-3",
      output: "Covers the full AQA GCSE biology specification.",
      category: "needs_fact_checking",
      correctActionId: "fact_check",
      explanation:
        "Might well be true — but full is a strong word and you should check the spec before claiming it.",
    },
    {
      id: "ln-4",
      output: "An innovative solution leveraging cutting-edge AI technology.",
      category: "accurate",
      correctActionId: "discard",
      explanation:
        "Not false, just empty. Cut anything a visitor could not disagree with.",
    },
    {
      id: "ln-5",
      output:
        "It will never give you a final answer, even if you ask directly.",
      category: "needs_fact_checking",
      correctActionId: "fact_check",
      explanation:
        "A good claim and a strong one. Never means you should try to break it a few times first.",
    },
    {
      id: "ln-6",
      output:
        "I built this because revising on my own was miserable and I wanted something that would ask me things back.",
      category: "accurate",
      correctActionId: "publish",
      explanation:
        "True, unfakeable, and more persuasive than any claim about innovation.",
    },
  ],
};

const lesson3Quiz: QuizStep = {
  id: "ai-websites-03-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Which design decision most changes how a visitor experiences your page?",
  options: [
    {
      id: "w3q-a",
      label: "The palette.",
      isCorrect: false,
      feedback:
        "All six are legible in both modes. This is the choice people agonise over and it barely matters.",
    },
    {
      id: "w3q-b",
      label: "Which section comes first.",
      isCorrect: true,
      feedback:
        "Right. Pages are read top-down and most people stop early, so order decides what gets read at all.",
    },
    {
      id: "w3q-c",
      label: "The corner style.",
      isCorrect: false,
      feedback: "Sharp, soft or round — nobody has ever left because of this.",
    },
    {
      id: "w3q-d",
      label: "The font pairing.",
      isCorrect: false,
      feedback:
        "All three pairings are readable. It sets a mood and nothing more.",
    },
  ],
  explanation:
    "Everything below where a reader stops might as well not exist. Section order determines what is above that line, which makes it the highest-leverage choice the builder offers.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson3Completion: CompletionStep = {
  id: "ai-websites-03-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Section order matters more than palette, type or corners.",
    "Lead with what it is — the one question everybody has.",
    "A page is a set of claims, and unsupported ones cost you the gatekeeper.",
    "Cut anything a visitor could not disagree with.",
  ],
  xpReward: 32,
  completionMessage:
    "You can now spend your design time on the choice that actually moves the outcome.",
  nextLessonId: "ai-websites-04",
};

/*
 * ============================================================
 * LESSON 4 — WRITING FOR A PAGE, NOT A CHAT
 * ============================================================
 */

const lesson4Intro: IntroStep = {
  id: "ai-websites-04-intro",
  type: "intro",
  title: "Writing for a Page, Not a Chat",
  subtitle: "Nobody reads a web page. They scan it and then decide.",
  content:
    "Chat writing and page writing are different crafts. In a chat you have someone's attention and can unfold an idea over several turns. On a page you have about four seconds and a reader whose eyes are moving in a rough F shape. This lesson is a practical writing skill, not a design one.",
  learningObjectives: [
    "Write a line that survives being scanned rather than read.",
    "Front-load the informative word in a sentence.",
    "Judge page copy by what a scanner takes away, not what a reader would.",
  ],
  estimatedMinutes: 3,
};

const lesson4Concept1: ConceptStep = {
  id: "ai-websites-04-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Chat writing on a page",
        body: "Welcome! I am really glad you are here. This tool was built to help students who are studying biology at GCSE level to revise more effectively, by using a conversational approach.",
      },
      after: {
        label: "Page writing",
        body: "GCSE biology, explained until it sticks. Ask a question, get questions back.",
      },
      transform: "Cut the run-up, front-load the meaning",
    },
  },
  title: "The First Three Words Do the Work",
  requiresCompletion: false,
  content:
    "A scanning reader takes in the first two or three words of a line and moves on. That is not laziness, it is how everybody reads a page, including you. So the informative words have to come first. Welcome, I am glad, This tool was built to are all run-up — by the time the sentence reaches biology the reader has gone. Put biology in position one and the same reader stops.",
  examples: [
    {
      id: "backloaded",
      title: "Meaning at the end",
      description: "The reader leaves before it arrives.",
      input: "We are excited to introduce a new way to revise for biology.",
      output: "Scanned as: We are excited to...",
    },
    {
      id: "frontloaded",
      title: "Meaning at the front",
      description: "Survives being scanned.",
      input: "Biology revision that asks you questions back.",
      output: "Scanned as: Biology revision that...",
    },
  ],
  misconception:
    "Warmth is usually added at the start of a sentence, which is exactly where it costs the most. Put the meaning first and the warmth after — the sentence stays friendly and starts working.",
};

const lesson4Activity1: NextTokenActivityStep = {
  id: "ai-websites-04-step-02",
  type: "activity",
  interactiveType: "next_token_game",
  title: "What a Scanner Sees Next",
  requiresCompletion: true,
  instructions:
    "Readers predict too. For each opening, pick the word a scanning visitor most expects next — and notice how much of the line they can skip once they have predicted it.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 2,
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "A line a reader can finish in their head is a line they stop reading. Sometimes that is fine; on a headline it is fatal.",
    incorrect:
      "Ask what the most predictable continuation is, not the best one.",
  },
  showProbabilities: true,
  prompts: [
    {
      id: "wp1",
      prompt: "We are excited to",
      correctTokenId: "wp1-a",
      explanation:
        "Completely predictable, which means the reader skips the rest of the line. Four words spent buying nothing.",
      predictions: [
        {
          id: "wp1-a",
          token: " announce",
          probability: 0.61,
          isCorrect: true,
          feedback:
            "Everybody predicted it, including your visitor, who has now stopped reading.",
        },
        {
          id: "wp1-b",
          token: " share",
          probability: 0.22,
          feedback: "Also predictable. Same problem.",
        },
        {
          id: "wp1-c",
          token: " fail",
          probability: 0.01,
          feedback:
            "Unpredictable, and would actually hold attention — which is the point being made.",
        },
      ],
    },
    {
      id: "wp2",
      prompt: "GCSE biology, explained until",
      correctTokenId: "wp2-b",
      explanation:
        "Harder to predict, so the reader has to keep going. That is what a headline is supposed to do.",
      predictions: [
        {
          id: "wp2-a",
          token: " you",
          probability: 0.31,
          feedback: "Plausible, and still requires reading on.",
        },
        {
          id: "wp2-b",
          token: " it",
          probability: 0.36,
          isCorrect: true,
          feedback:
            "As in until it sticks. Slightly surprising, so the eye continues.",
        },
        {
          id: "wp2-c",
          token: " the",
          probability: 0.08,
          feedback: "Awkward continuation.",
        },
      ],
    },
    {
      id: "wp3",
      prompt: "An innovative solution that",
      correctTokenId: "wp3-c",
      explanation:
        "Every continuation here is filler, which is the diagnosis: a phrase whose every likely ending is empty should be cut entirely.",
      predictions: [
        {
          id: "wp3-a",
          token: " leverages",
          probability: 0.24,
          feedback: "Filler.",
        },
        {
          id: "wp3-b",
          token: " empowers",
          probability: 0.19,
          feedback: "Filler.",
        },
        {
          id: "wp3-c",
          token: " helps",
          probability: 0.33,
          isCorrect: true,
          feedback:
            "The most likely and the emptiest. If the top prediction says nothing, the opening says nothing.",
        },
      ],
    },
  ],
};

const lesson4Concept2: ConceptStep = {
  id: "ai-websites-04-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "How much of each element a scanning visitor actually reads",
      bars: [
        { id: "s1", label: "Headline", value: 95, note: "Nearly always" },
        { id: "s2", label: "First line under it", value: 62, note: "Often" },
        { id: "s3", label: "Section headings", value: 48, note: "Sometimes" },
        { id: "s4", label: "Body paragraphs", value: 16, note: "Rarely" },
      ],
    },
  },
  title: "Write for the 95, Not the 16",
  requiresCompletion: false,
  content:
    "Most of the effort goes into body paragraphs that almost nobody reads, and the headline that nearly everybody reads gets written last in thirty seconds. Invert it. If your page had only a headline and one line underneath, would a visitor know what it is and what to do? If yes, everything else is a bonus. If no, no amount of body copy will rescue it. The builder caps a headline at 80 characters and a subtext at 240 for exactly this reason.",
  examples: [
    {
      id: "headline-carry",
      title: "Headline carries it",
      description: "Works even if nothing else is read.",
      input: "GCSE biology, explained until it sticks.",
      output: "A visitor who read nothing else still knows what this is.",
    },
    {
      id: "headline-empty",
      title: "Headline carries nothing",
      description: "The rest of the page has to do impossible work.",
      input: "Welcome to my project.",
      output: "A visitor who read nothing else knows nothing.",
    },
  ],
  misconception:
    "The About section is not where you explain what the thing is. That job belongs to the headline. The About section is where somebody who is already interested finds out more.",
};

const lesson4Activity2: ModelTestingActivityStep = {
  id: "ai-websites-04-step-04",
  type: "activity",
  interactiveType: "model_testing",
  title: "Scan Test",
  requiresCompletion: true,
  instructions:
    "Six real lines of page copy. Predict whether a visitor scanning for four seconds would come away knowing what the thing is, then compare against what testers actually reported.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 4,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "You are judging by what survives a scan rather than by whether the sentence is nice.",
    incorrect:
      "Read only the first three words and ask what you learned.",
  },
  minimumTestsRequired: 4,
  showPerCategoryAccuracy: true,
  trainingSummary: {
    trainingItemCount: 6,
    categories: ["survives", "fails"],
    trainingAccuracy: 86,
    knownLimitations: [
      "A well-written sentence can still fail a scan.",
      "Front-loading matters more than total length.",
    ],
  },
  testItems: [
    {
      id: "sc1",
      input: "GCSE biology, explained until it sticks.",
      expectedCategory: "survives",
      modelPrediction: "survives",
      confidence: 0.93,
      explanation: "Subject in word one. Nothing to skip past.",
    },
    {
      id: "sc2",
      input: "Welcome to my AI project!",
      expectedCategory: "fails",
      modelPrediction: "fails",
      confidence: 0.91,
      explanation:
        "Three words of run-up and no subject at all. The reader learns nothing.",
    },
    {
      id: "sc3",
      input:
        "We are excited to introduce a brand new way of revising for your biology exams.",
      expectedCategory: "fails",
      modelPrediction: "fails",
      confidence: 0.84,
      explanation:
        "The useful word, biology, is the twelfth. Nobody gets there.",
    },
    {
      id: "sc4",
      input: "Ask a question. Get questions back.",
      expectedCategory: "survives",
      modelPrediction: "survives",
      confidence: 0.79,
      explanation:
        "Does not name the subject, but conveys the method instantly — works directly under a headline that does name it.",
    },
    {
      id: "sc5",
      input:
        "A conversational revision assistant built on a large language model.",
      expectedCategory: "fails",
      modelPrediction: "survives",
      confidence: 0.55,
      explanation:
        "An instructive near-miss. It front-loads and sounds informative, but it describes the technology rather than what the visitor gets.",
    },
    {
      id: "sc6",
      input: "Stuck on osmosis? Start here.",
      expectedCategory: "survives",
      modelPrediction: "survives",
      confidence: 0.88,
      explanation:
        "Names a real problem and offers a first move in five words.",
    },
  ],
};

const lesson4Quiz: QuizStep = {
  id: "ai-websites-04-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why does We are excited to introduce a new way to revise for biology fail as a headline?",
  options: [
    {
      id: "w4q-a",
      label: "It is too long.",
      isCorrect: false,
      feedback:
        "Length is secondary — a long line that front-loads can work fine.",
    },
    {
      id: "w4q-b",
      label:
        "The informative word arrives after the reader has already moved on.",
      isCorrect: true,
      feedback:
        "Right. Scanners take the first two or three words. Biology is the twelfth.",
    },
    {
      id: "w4q-c",
      label: "Exclamation is unprofessional.",
      isCorrect: false,
      feedback: "There is no exclamation mark in it.",
    },
    {
      id: "w4q-d",
      label: "It does not mention AI.",
      isCorrect: false,
      feedback:
        "Mentioning AI would not help. Visitors care what it does for them.",
    },
  ],
  explanation:
    "Page reading is scanning, and scanning takes the front of a line. Any sentence whose meaning lives at the end is a sentence most visitors will never reach the meaning of.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson4Completion: CompletionStep = {
  id: "ai-websites-04-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Scanners read the first two or three words, so the meaning goes there.",
    "A phrase whose likeliest continuation is empty should be cut.",
    "Write for the headline that 95 percent read, not the body 16 percent do.",
    "If the headline and one line cannot carry it, more body copy will not.",
  ],
  xpReward: 35,
  completionMessage:
    "You can now write a line that survives being scanned, which is most of what page writing is.",
  nextLessonId: "ai-websites-05",
};

/*
 * ============================================================
 * LESSON 5 — CUSTOMIZING WITH NATURAL LANGUAGE
 * ============================================================
 */

const lesson5Intro: IntroStep = {
  id: "ai-websites-05-intro",
  type: "intro",
  title: "Customizing With Natural Language",
  subtitle: "Say what you want. Understand why some of it cannot happen.",
  content:
    "The builder lets you edit your page by describing the change: make the background darker, add a section explaining how it works. This lesson is hands-on with that editor, and with the more useful half of the skill — knowing which requests it can honour and why the others are refused.",
  learningObjectives: [
    "Phrase a natural-language edit so it lands.",
    "Predict which requests the editor cannot honour.",
    "Explain why a closed set of fields is a safety property, not a limitation.",
  ],
  estimatedMinutes: 3,
};

const lesson5Concept1: ConceptStep = {
  id: "ai-websites-05-step-01",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        {
          id: "say",
          label: "You describe it",
          caption: "make the background darker",
        },
        {
          id: "patch",
          label: "It becomes a patch",
          caption: "theme.mode: light to dark",
        },
        {
          id: "validate",
          label: "The patch is validated",
          caption: "Same check a form submission gets",
        },
        {
          id: "render",
          label: "The page re-renders",
          caption: "From fields, never from markup",
        },
      ],
    },
  },
  title: "What Happens When You Ask",
  requiresCompletion: false,
  content:
    "Your request does not generate code. It produces a change to specific fields in a stored document, and that change goes through exactly the same validator a form submission does. This is why the editor feels oddly literal sometimes: it can only ever move a value to another value the field already allows. Make it darker becomes mode dark. Make it feel more energetic has nowhere to land, so it either does nothing or picks a palette and hopes.",
  examples: [
    {
      id: "lands",
      title: "Lands cleanly",
      description: "There is a field for this, with a value that fits.",
      input: "Make the background darker.",
      output: "theme.mode becomes dark. Palette unchanged.",
    },
    {
      id: "no-field",
      title: "Nowhere to land",
      description:
        "No field expresses this, so the model guesses or declines.",
      input: "Make it feel more like a startup.",
      output: "Unpredictable — usually a palette change you did not want.",
    },
  ],
  misconception:
    "The closed field list looks like a limitation on what you can build. It is the reason a published page cannot contain a script tag — there is nowhere in the document for one to live, so no editor of that document can put one there.",
};

const lesson5Activity1: AiSorterActivityStep = {
  id: "ai-websites-05-step-02",
  type: "activity",
  interactiveType: "ai_sorter",
  title: "Will This Request Land?",
  requiresCompletion: true,
  instructions:
    "Eight things people typed into the natural-language editor. Sort them by whether there is a field for the change they are asking for.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "You are asking whether the request names something the document can hold. That is the whole test.",
    incorrect:
      "Templates, palettes, mode, type, corners, sections and copy are fields. Anything else is not.",
  },
  allowRetry: true,
  buckets: [
    {
      id: "lands",
      label: "There is a field for this",
      description: "Maps to a value the document already allows.",
    },
    {
      id: "no-field",
      label: "Nothing for it to change",
      description: "No field expresses this, so the result is a guess.",
    },
  ],
  cards: [
    {
      id: "nl1",
      title: "Make the background darker",
      description: "A request about mode.",
      correctBucketId: "lands",
      explanation: "theme.mode moves from light to dark. Exact and reversible.",
    },
    {
      id: "nl2",
      title: "Add a section explaining how it works",
      description: "A request about sections.",
      correctBucketId: "lands",
      explanation:
        "A steps or text section gets appended. Section kinds are a known list.",
    },
    {
      id: "nl3",
      title: "Add a video of me explaining it",
      description: "A request for new media.",
      correctBucketId: "no-field",
      explanation:
        "There is no video field. Nothing in the document can hold one, so nothing happens.",
    },
    {
      id: "nl4",
      title: "Use a warmer colour",
      description: "A request about palette.",
      correctBucketId: "lands",
      explanation:
        "Sand or ember. Palettes are a fixed list of six, so warmer has somewhere to go.",
    },
    {
      id: "nl5",
      title: "Move the About section to the top",
      description: "A request about order.",
      correctBucketId: "lands",
      explanation:
        "Sections are an ordered array. This is the highest-value edit on this list.",
    },
    {
      id: "nl6",
      title: "Make the buttons bounce when you hover them",
      description: "A request for behaviour.",
      correctBucketId: "no-field",
      explanation:
        "Animation is not a field. The document describes content and a theme, not behaviour.",
    },
    {
      id: "nl7",
      title: "Rewrite the headline to mention Year 11",
      description: "A request about copy.",
      correctBucketId: "lands",
      explanation:
        "Headline is a text field with an 80-character limit. Straightforward.",
    },
    {
      id: "nl8",
      title: "Make it look like the Apple website",
      description: "A request for a whole visual identity.",
      correctBucketId: "no-field",
      explanation:
        "Not expressible as values of these fields. You will get a palette change and a vague sense of disappointment.",
    },
  ],
};

const lesson5Concept2: ConceptStep = {
  id: "ai-websites-05-step-03",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Vague request",
        body: "Make it better.",
      },
      after: {
        label: "Request that names the field",
        body: "Change the headline to mention Year 11, and move About above Features.",
      },
      transform: "Name the thing and the change",
    },
  },
  title: "How to Phrase It",
  requiresCompletion: false,
  content:
    "The same rules you learned in prompt engineering apply here, sharpened by the fact that the target is a known set of fields. Name the thing you want changed and what you want it changed to. Better still, batch related changes into one request rather than firing off six vague ones, because each round trip is a chance for the model to alter something you were happy with.",
  examples: [
    {
      id: "phrase-good",
      title: "Names field and value",
      description: "Nothing to guess at.",
      input: "Set the palette to sand and switch to dark mode.",
      output: "Two field changes, both exactly as asked.",
    },
    {
      id: "phrase-bad",
      title: "Names a feeling",
      description: "The model picks something and you find out afterwards.",
      input: "Make it feel more serious.",
      output: "Possibly slate, possibly the font, possibly the corners.",
    },
  ],
  misconception:
    "If an edit does something you did not want, the instinct is to describe the feeling more emphatically. Name the field instead — the editor is not failing to understand your mood, it is looking for somewhere to put it.",
};

const lesson5Activity2: EdgeCaseMatrixActivityStep = {
  id: "ai-websites-05-step-04",
  type: "activity",
  interactiveType: "edge_case_matrix",
  title: "Same Request, Different Phrasings",
  requiresCompletion: true,
  instructions:
    "Four changes somebody wanted, asked for three different ways. Work out which phrasings land reliably and which produce something nobody asked for.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 7,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Naming the field beats describing the feeling, every time.",
    incorrect:
      "Ask whether the phrasing tells the editor which field to touch.",
  },
  allowModelComparison: true,
  showResultsTable: true,
  cases: [
    {
      id: "wc-dark",
      title: "Wants a dark page",
      description: "A change to theme mode.",
      category: "visual",
      expectedDifficulty: "low",
    },
    {
      id: "wc-order",
      title: "Wants About read first",
      description: "A change to section order.",
      category: "context",
      expectedDifficulty: "medium",
    },
    {
      id: "wc-copy",
      title: "Wants the headline to name the audience",
      description: "A change to a text field.",
      category: "language",
      expectedDifficulty: "low",
    },
    {
      id: "wc-video",
      title: "Wants a video embedded",
      description: "A change with no field behind it.",
      category: "data",
      expectedDifficulty: "high",
    },
  ],
  models: [
    {
      id: "feeling",
      label: "Describes a feeling",
      description: "Make it more X.",
      trainingCoverage: 100,
      specialization: "Vague",
    },
    {
      id: "names-thing",
      label: "Names the thing",
      description: "Change the headline / the mode / the order.",
      trainingCoverage: 100,
      specialization: "Specific",
    },
    {
      id: "names-both",
      label: "Names thing and value",
      description: "Set mode to dark. Move About above Features.",
      trainingCoverage: 100,
      specialization: "Exact",
    },
  ],
  expectedObservations: [
    {
      caseId: "wc-dark",
      modelId: "feeling",
      expectedBehavior:
        "Make it moodier might switch mode, or might change palette to slate instead.",
      expectedRisk: "medium",
    },
    {
      caseId: "wc-dark",
      modelId: "names-thing",
      expectedBehavior: "Make the background darker lands on mode reliably.",
      expectedRisk: "low",
    },
    {
      caseId: "wc-dark",
      modelId: "names-both",
      expectedBehavior: "Set mode to dark. Exact, every time.",
      expectedRisk: "low",
    },
    {
      caseId: "wc-order",
      modelId: "feeling",
      expectedBehavior:
        "Make it flow better may reorder nothing, or reorder unpredictably.",
      expectedRisk: "high",
    },
    {
      caseId: "wc-order",
      modelId: "names-thing",
      expectedBehavior:
        "Move the About section usually works, though where to is left open.",
      expectedRisk: "medium",
    },
    {
      caseId: "wc-order",
      modelId: "names-both",
      expectedBehavior: "Move About above Features. Unambiguous.",
      expectedRisk: "low",
    },
    {
      caseId: "wc-copy",
      modelId: "feeling",
      expectedBehavior:
        "Make the headline punchier rewrites it into something you may like less.",
      expectedRisk: "medium",
    },
    {
      caseId: "wc-copy",
      modelId: "names-thing",
      expectedBehavior:
        "Rewrite the headline lands on the right field, content still a guess.",
      expectedRisk: "medium",
    },
    {
      caseId: "wc-copy",
      modelId: "names-both",
      expectedBehavior:
        "Rewrite the headline to mention Year 11. Right field, right content.",
      expectedRisk: "low",
    },
    {
      caseId: "wc-video",
      modelId: "feeling",
      expectedBehavior:
        "Make it more engaging changes something unrelated, since no video field exists.",
      expectedRisk: "high",
    },
    {
      caseId: "wc-video",
      modelId: "names-thing",
      expectedBehavior:
        "Add a video has nowhere to land. Best case it declines and says so.",
      expectedRisk: "medium",
    },
    {
      caseId: "wc-video",
      modelId: "names-both",
      expectedBehavior:
        "Naming it exactly does not help — the field does not exist. Precision cannot create capability.",
      expectedRisk: "medium",
    },
  ],
};

const lesson5Quiz: QuizStep = {
  id: "ai-websites-05-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why can a natural-language edit never put a script tag on your published page?",
  options: [
    {
      id: "w5q-a",
      label: "The model is instructed not to.",
      isCorrect: false,
      feedback:
        "Instructions can be talked around. The real protection is structural.",
    },
    {
      id: "w5q-b",
      label:
        "The page is stored as a closed document of known fields, and no field can hold markup.",
      isCorrect: true,
      feedback:
        "Right. The edit becomes a patch to those fields, so there is nowhere for a tag to live.",
    },
    {
      id: "w5q-c",
      label: "Published pages are scanned for scripts before going live.",
      isCorrect: false,
      feedback:
        "Scanning is a weaker guarantee than having nowhere to put one.",
    },
    {
      id: "w5q-d",
      label: "The editor only accepts one sentence at a time.",
      isCorrect: false,
      feedback: "Unrelated to safety.",
    },
  ],
  explanation:
    "The document schema is the security model. A natural-language edit produces a patch that goes through the same validator as a form submission, so the model is one more writer of a structure it cannot widen.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson5Completion: CompletionStep = {
  id: "ai-websites-05-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "An edit becomes a patch to known fields, validated like a form submission.",
    "Name the field and the value; describing a feeling makes the model guess.",
    "Batch related edits — each round trip risks changing something you liked.",
    "The closed field list is why a published page cannot contain a script.",
  ],
  xpReward: 38,
  completionMessage:
    "You can drive the editor deliberately instead of negotiating with it.",
  nextLessonId: "ai-websites-06",
};

/*
 * ============================================================
 * LESSON 6 — TESTING YOUR PAGE LIKE A VISITOR
 * ============================================================
 */

const lesson6Intro: IntroStep = {
  id: "ai-websites-06-intro",
  type: "intro",
  title: "Testing Your Page Like a Visitor",
  subtitle: "The only-makes-sense-to-me trap, and how to catch it.",
  content:
    "You cannot un-know what your project is. That makes you the worst possible judge of whether your page explains it, and it is why almost every first page has a hole in it that its author genuinely cannot see. This lesson is about the techniques that work anyway.",
  learningObjectives: [
    "Find the assumptions your page makes about its reader.",
    "Check whether the chat makes sense with no prior context.",
    "Verify the claims on your own page before a stranger does.",
  ],
  estimatedMinutes: 3,
};

const lesson6Concept1: ConceptStep = {
  id: "ai-websites-06-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "What you see",
        points: [
          "The headline, which you wrote",
          "Obvious what to ask it",
          "The name makes sense",
          "The gap is invisible",
        ],
      },
      right: {
        label: "What they see",
        points: [
          "A phrase referencing something unexplained",
          "An empty box",
          "A word that means nothing",
          "The gap is the whole experience",
        ],
      },
    },
  },
  title: "You Cannot Un-Know It",
  requiresCompletion: false,
  content:
    "This is the curse of knowledge and there is no amount of care that beats it — you will read your own page and supply the missing piece automatically, every time, without noticing you did it. The techniques that work are the ones that remove you: open it on a device you are not logged into, read only the first two lines and stop, and hand it to somebody with no explanation and watch their face rather than asking their opinion.",
  examples: [
    {
      id: "curse",
      title: "The invisible gap",
      description:
        "Perfectly clear to the one person who already knew.",
      input: "Ask Studybuddy anything about the spec.",
      output: "Which spec? Who is Studybuddy? A stranger has two questions already.",
    },
    {
      id: "removed",
      title: "The gap closed",
      description: "Assumes nothing.",
      input: "GCSE biology questions, answered with more questions.",
      output: "No prior knowledge required.",
    },
  ],
  misconception:
    "Asking a friend what do you think produces politeness. Asking them to say out loud what they think this does, before they touch anything, produces information.",
};

const lesson6Activity1: BiasAuditActivityStep = {
  id: "ai-websites-06-step-02",
  type: "activity",
  interactiveType: "bias_audit",
  title: "What Does Your Page Assume?",
  requiresCompletion: true,
  instructions:
    "Three pages, three visitor sessions that went wrong. Work out what each page assumed about its reader, and pick the fix.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Every one of these was invisible to the person who built it. That is the point.",
    incorrect:
      "Ask what the visitor would have needed to already know for that page to work.",
  },
  allowMultipleMitigations: true,
  requiredFindings: [
    "assumes-jargon",
    "assumes-context",
    "assumes-device",
  ],
  cases: [
    {
      id: "bc-jargon",
      title: "Nobody knew what the spec meant",
      log: "Page said: ask it anything about the spec. Six of eight testers asked what spec. Two assumed it was a software specification.",
      issueType: "representation",
      severity: "high",
      correctMitigationIds: ["name-it-fully", "test-with-strangers"],
      explanation:
        "The author says the spec twenty times a week. To everyone else it is an unexplained noun.",
    },
    {
      id: "bc-context",
      title: "The chat made no sense cold",
      log: "The agent opened with: Right, where did we get to? Testers arriving fresh had no idea what conversation it was resuming.",
      issueType: "historical",
      severity: "high",
      correctMitigationIds: ["cold-open", "test-with-strangers"],
      explanation:
        "The agent was tuned against the author's own ongoing sessions and inherited a continuity that a first-time visitor does not have.",
    },
    {
      id: "bc-device",
      title: "It was unusable on a phone",
      log: "Author built and tested on a laptop. Nine of ten visitors opened the link on a phone, where the example questions sat below the fold and went unseen.",
      issueType: "measurement",
      severity: "medium",
      correctMitigationIds: ["check-on-phone", "cold-open"],
      explanation:
        "Not a content problem at all. The page was measured in a setting that almost none of its visitors share.",
    },
  ],
  mitigationOptions: [
    {
      id: "name-it-fully",
      label: "Expand every shorthand once",
      description:
        "Say GCSE biology specification the first time, then the spec afterwards.",
      applicableIssueTypes: ["representation", "unknown"],
      effectiveness: 88,
    },
    {
      id: "cold-open",
      label: "Open the page cold, logged out",
      description:
        "A private window and a fresh session shows you what a stranger gets.",
      applicableIssueTypes: ["historical", "measurement"],
      effectiveness: 85,
    },
    {
      id: "check-on-phone",
      label: "Check it on a phone",
      description:
        "Most links are opened on a phone. Look at what sits above the fold there.",
      applicableIssueTypes: ["measurement", "representation"],
      effectiveness: 82,
    },
    {
      id: "test-with-strangers",
      label: "Watch someone use it without helping",
      description:
        "Ask them to say what they think it does before touching anything, then stay quiet.",
      applicableIssueTypes: ["representation", "historical", "unknown"],
      effectiveness: 92,
    },
  ],
};

const lesson6Concept2: ConceptStep = {
  id: "ai-websites-06-step-03",
  type: "concept",
  visual: {
    type: "timeline",
    data: {
      milestones: [
        {
          id: "t1",
          when: "First",
          label: "Log out",
          caption: "Private window, no session",
        },
        {
          id: "t2",
          when: "Then",
          label: "Read two lines",
          caption: "Stop. What do you know?",
        },
        {
          id: "t3",
          when: "Then",
          label: "Open it on a phone",
          caption: "What is above the fold?",
        },
        {
          id: "t4",
          when: "Then",
          label: "Ask it something stupid",
          caption: "The first visitor will",
        },
        {
          id: "t5",
          when: "Last",
          label: "Watch a stranger",
          caption: "Say nothing at all",
        },
      ],
    },
  },
  title: "A Test You Can Actually Run",
  requiresCompletion: false,
  content:
    "Five steps, about ten minutes, and it will find things. The fourth one matters more than people expect: the first genuine visitor to your page will not ask the question you designed for, they will ask something off-topic or rude to see what happens, and how your agent handles that is their first impression of your judgement rather than of the model's.",
  examples: [
    {
      id: "test-cold",
      title: "The logged-out read",
      description: "Finds assumed context immediately.",
      input: "Private window, read the top two lines, stop.",
      output: "You find out what a stranger actually knows.",
    },
    {
      id: "test-rude",
      title: "The rude question",
      description: "Finds what your guardrails do in public.",
      input: "Ask your own agent something off-topic.",
      output: "Either a clean decline, or a first impression you did not want.",
    },
  ],
  misconception:
    "Testing your own page feels like a formality once you have checked it looks right. Looking right and being understandable by somebody who has never seen it are unrelated properties.",
};

const lesson6Activity2: FactCheckerActivityStep = {
  id: "ai-websites-06-step-04",
  type: "activity",
  interactiveType: "fact_checker",
  title: "Check Your Own Page",
  requiresCompletion: true,
  instructions:
    "A real About section, written by someone about their own project. Flag every claim they could not actually support if a teacher asked.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Notice how the true, modest claims are the persuasive ones and the inflated ones are the liability.",
    incorrect:
      "Ask of each sentence: could you show somebody evidence for this today?",
  },
  minimumFlagsRequired: 3,
  document: {
    id: "about-section",
    title: "About section, drafted for a study tool page",
    text: "Studybuddy is an AI revision tool trusted by hundreds of students. It covers the entire GCSE biology specification and has been shown to improve exam results by up to 20 percent. Built over three weeks using the BuildGentic platform, it never gives you the answer outright — it asks you questions until you get there yourself. Teachers have approved it for classroom use.",
  },
  claims: [
    {
      id: "pc-trusted",
      text: "Trusted by hundreds of students.",
      status: "fabricated",
      explanation:
        "It launched last week. Nobody has used it. This is the sentence that costs you the teacher.",
    },
    {
      id: "pc-entire",
      text: "Covers the entire GCSE biology specification.",
      status: "unsupported",
      explanation:
        "Entire is a strong word and nobody has checked it against the actual spec. Probably fixable — either check it, or say covers the main topics.",
    },
    {
      id: "pc-results",
      text: "Shown to improve exam results by up to 20 percent.",
      status: "fabricated",
      explanation:
        "No study exists. Up to is doing enormous work here, and this is the kind of claim that gets a page taken down.",
    },
    {
      id: "pc-built",
      text: "Built over three weeks using the BuildGentic platform.",
      status: "true",
      explanation:
        "True, checkable, and more interesting to an evaluator than any of the inflated claims.",
    },
    {
      id: "pc-method",
      text: "It never gives you the answer outright.",
      status: "unsupported",
      explanation:
        "This is the design intent and probably holds — but never is absolute, so try to break it a few times before publishing it.",
    },
    {
      id: "pc-teachers",
      text: "Teachers have approved it for classroom use.",
      status: "fabricated",
      explanation:
        "No teacher has seen it. Beyond being untrue, this one implies an endorsement that could get a real person into trouble.",
    },
  ],
  sources: [
    {
      id: "ps-author",
      title: "What the author actually knows",
      sourceType: "primary",
      reliability: "high",
      summary:
        "Supports: built in three weeks, on BuildGentic, designed not to give answers. Supports nothing about usage, results or endorsement.",
    },
    {
      id: "ps-spec",
      title: "The published GCSE biology specification",
      sourceType: "reference",
      reliability: "high",
      summary:
        "Could settle the coverage claim in about twenty minutes. Nobody has opened it.",
    },
  ],
};

const lesson6Quiz: QuizStep = {
  id: "ai-websites-06-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "What is the most reliable way to find out whether your page explains itself?",
  options: [
    {
      id: "w6q-a",
      label: "Read it through carefully several times.",
      isCorrect: false,
      feedback:
        "You will supply the missing piece automatically every time. Care does not beat the curse of knowledge.",
    },
    {
      id: "w6q-b",
      label:
        "Watch someone who knows nothing about it say what they think it does, before they touch anything.",
      isCorrect: true,
      feedback:
        "Right — and stay quiet while they do it. Their confusion is the data.",
    },
    {
      id: "w6q-c",
      label: "Ask a friend whether they like it.",
      isCorrect: false,
      feedback: "Produces politeness, not information.",
    },
    {
      id: "w6q-d",
      label: "Check it renders correctly in both themes.",
      isCorrect: false,
      feedback:
        "Worth doing, and unrelated to whether anybody understands it.",
    },
  ],
  explanation:
    "You cannot un-know what your project is, so every technique that relies on your own judgement is compromised. The ones that work remove you: a logged-out read, a phone, and a stranger you do not help.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson6Completion: CompletionStep = {
  id: "ai-websites-06-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "You cannot un-know your own project, so remove yourself from the test.",
    "Log out, read two lines, check a phone, ask something rude, watch a stranger.",
    "The first real visitor will not ask the question you designed for.",
    "Unsupported claims on your page are a liability, not enthusiasm.",
  ],
  xpReward: 40,
  completionMessage:
    "You can now find the hole in your own page, which almost nobody can do without a method.",
  nextLessonId: "ai-websites-07",
};

/*
 * ============================================================
 * LESSON 7 — PUBLISH & SHARE
 * ============================================================
 */

const lesson7Intro: IntroStep = {
  id: "ai-websites-07-intro",
  type: "intro",
  title: "Publish & Share",
  subtitle: "This one is not a simulation.",
  content:
    "Everything so far has been practice. This lesson ends with you publishing a real page at a real address and sending the link to one real person. Before that, two things: a last check for anything on the page that should not be public, and a full run through the publish decision.",
  learningObjectives: [
    "Remove personal information that should not be on a public page.",
    "Work through the publish decision end to end.",
    "Publish, copy the link, and share it with someone.",
  ],
  estimatedMinutes: 5,
};

const lesson7Concept1: ConceptStep = {
  id: "ai-websites-07-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Written for people who know you",
        body: "Hi, I am Maya Ellison from Northgate High, email me at maya.ellison04@gmail.com if it breaks.",
      },
      after: {
        label: "Written for the public internet",
        body: "Built by Maya, a Year 11 student. Feedback welcome through the form.",
      },
      transform: "Public means indexable, permanent, and read by strangers",
    },
  },
  title: "Public Means Public",
  requiresCompletion: false,
  content:
    "A published page has an address anybody can visit and search engines can index. Most people write their first About section as though the audience were their class group, because that is who they are picturing, and put a full name, a school and an email on a page that will outlive their interest in the project. None of that is needed to make the page work. A first name and what you built is enough, and it reads better anyway.",
  examples: [
    {
      id: "over-shared",
      title: "Too much",
      description:
        "Full name, school and contact details — enough to locate a minor on a weekday.",
      input: "I am Maya Ellison from Northgate High, text me on 07700 900412.",
      output: "Permanent, indexable, and impossible to fully retract.",
    },
    {
      id: "right-amount",
      title: "Enough",
      description: "Establishes who made it and nothing else.",
      input: "Built by Maya, a Year 11 student, over three weeks.",
      output: "Same credit, no exposure.",
    },
  ],
  misconception:
    "Taking something down does not unpublish it. Caches, screenshots and search indexes persist, which is why the check happens before publishing rather than after.",
};

const lesson7Activity1: DataRedactionActivityStep = {
  id: "ai-websites-07-step-02",
  type: "activity",
  interactiveType: "data_redaction",
  title: "Last Check Before It Goes Live",
  requiresCompletion: true,
  instructions:
    "A real About section, about to be published. Redact everything that should not be on a public page — and leave the things that should stay.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Note what you left in. Removing everything would have cost the page its author, which is worth having.",
    incorrect:
      "Ask of each one: does a stranger need this, and could it be used to find her?",
  },
  allowUndo: true,
  showRedactionPreview: true,
  requiredRedactions: [
    "f-fullname",
    "f-school",
    "f-email",
    "f-phone",
    "f-address",
    "f-studentid",
  ],
  document: {
    id: "about-draft",
    title: "About section, unpublished draft",
    content:
      "Hi, I am Maya Ellison and I built this study helper for my GCSE biology class at Northgate High School. If it gets something wrong you can email me at maya.ellison04@gmail.com or text 07700 900412. I live at 14 Willow Road, Fairbourne, so come find me at lunch if you are local. My student number is NGH-2019-4471 if you want to check I am real. I called it Studybuddy, and you can just call me Maya. I built this because revising alone was miserable and I wanted something that would ask me questions back.",
    fields: [
      {
        id: "f-fullname",
        text: "Maya Ellison",
        startIndex: 9,
        endIndex: 21,
        dataType: "name",
        shouldRedact: true,
      },
      {
        id: "f-school",
        text: "Northgate High School",
        startIndex: 81,
        endIndex: 102,
        dataType: "address",
        shouldRedact: true,
      },
      {
        id: "f-email",
        text: "maya.ellison04@gmail.com",
        startIndex: 151,
        endIndex: 175,
        dataType: "email",
        shouldRedact: true,
      },
      {
        id: "f-phone",
        text: "07700 900412",
        startIndex: 184,
        endIndex: 196,
        dataType: "phone",
        shouldRedact: true,
      },
      {
        id: "f-address",
        text: "14 Willow Road, Fairbourne",
        startIndex: 208,
        endIndex: 234,
        dataType: "address",
        shouldRedact: true,
      },
      {
        id: "f-studentid",
        text: "NGH-2019-4471",
        startIndex: 300,
        endIndex: 313,
        dataType: "account_id",
        shouldRedact: true,
      },
      {
        id: "f-agentname",
        text: "Studybuddy",
        startIndex: 358,
        endIndex: 368,
        dataType: "name",
        shouldRedact: false,
      },
      {
        id: "f-firstname",
        text: "Maya",
        startIndex: 395,
        endIndex: 399,
        dataType: "name",
        shouldRedact: false,
      },
    ],
  },
  sensitiveFields: [
    {
      id: "sf-name",
      type: "name",
      label: "Full name",
      riskLevel: "high",
      explanation:
        "A full name plus a school is enough to identify a specific child. A first name alone is fine and keeps the credit.",
    },
    {
      id: "sf-school",
      type: "address",
      label: "School name",
      riskLevel: "high",
      explanation:
        "Names a building she is at every weekday. Combined with a first name it is a location.",
    },
    {
      id: "sf-email",
      type: "email",
      label: "Personal email",
      riskLevel: "high",
      explanation:
        "A personal address on an indexed page collects spam forever and cannot be recalled.",
    },
    {
      id: "sf-phone",
      type: "phone",
      label: "Phone number",
      riskLevel: "high",
      explanation:
        "Never belongs on a public page. There is no version of this that is worth it.",
    },
    {
      id: "sf-address",
      type: "address",
      label: "Home address",
      riskLevel: "high",
      explanation:
        "The clearest case on the page and the one most often written without thinking, because she pictured her classmates reading it.",
    },
    {
      id: "sf-studentid",
      type: "account_id",
      label: "Student number",
      riskLevel: "medium",
      explanation:
        "An institutional identifier that may unlock other systems. It proves nothing to a stranger anyway.",
    },
  ],
};

const lesson7Activity2: CapstoneActivityStep = {
  id: "ai-websites-07-step-03",
  type: "activity",
  interactiveType: "capstone_pipeline",
  title: "The Publish Run",
  requiresCompletion: true,
  instructions:
    "Every decision that stands between a working agent and a page you would send to someone. Work through it once here, then go and do it for real.",
  completion: {
    type: "target_score",
    targetScore: 75,
    allowPartialCredit: true,
    maxAttempts: 3,
  },
  feedback: {
    correct:
      "That is a page you could send to a stranger without a covering explanation. Which is the whole test.",
    incorrect:
      "Look at the lowest-scoring stage. Usually it is the copy or the cold-open check.",
    completion:
      "Now do it with your own. The mission at the end of this lesson is not a metaphor.",
  },
  scenario: {
    id: "publish-run",
    organization: "Your own project",
    title: "Publishing a study agent as a public page",
    description:
      "A working GCSE biology agent needs to become a page that explains itself to a stranger and can be shared.",
    systemName: "Studybuddy",
    systemPurpose:
      "Help Year 10 and 11 students revise biology by asking them questions rather than answering them.",
    risks: [
      "Publishing personal information that cannot be retracted.",
      "A page nobody understands without the author present.",
      "Claims on the page that cannot be supported.",
      "An agent that embarrasses its author on the first off-topic question.",
    ],
    stakeholders: [
      "Students who might actually use it",
      "Parents and teachers deciding whether it is sound",
      "Anyone forming a view of the person who built it",
    ],
  },
  stages: [
    {
      id: "pub-audience",
      stage: "data_selection",
      title: "Fix the audience",
      description: "Decide who this is for before writing a word of it.",
      required: true,
      xpReward: 35,
    },
    {
      id: "pub-copy",
      stage: "prompt_engineering",
      title: "Write the page",
      description:
        "Headline, subtext, section order. The 80 and 240 character limits are real.",
      required: true,
      xpReward: 50,
    },
    {
      id: "pub-test",
      stage: "error_audit",
      title: "Test it cold",
      description:
        "Logged out, on a phone, and asked something it was not built for.",
      required: true,
      xpReward: 50,
    },
    {
      id: "pub-privacy",
      stage: "responsible_deployment",
      title: "Check what is public",
      description: "Everything on this page is permanent and indexable.",
      required: true,
      xpReward: 40,
    },
    {
      id: "pub-signoff",
      stage: "final_signoff",
      title: "Publish it",
      description: "Would you send this link to somebody whose opinion matters?",
      required: true,
      xpReward: 25,
    },
  ],
  datasets: [
    {
      id: "pd-specific",
      name: "One named audience",
      description:
        "Year 10 and 11 students revising biology on their own.",
      sourceType: "verified",
      quality: "high",
      balanced: true,
      containsSensitiveData: false,
      recommended: true,
      explanation:
        "Specific enough that a Year 11 recognises themselves and a software engineer does not. Every writing decision downstream gets easier.",
    },
    {
      id: "pd-everyone",
      name: "Anyone who wants to learn",
      description: "Maximum reach, no exclusions.",
      sourceType: "unknown",
      quality: "low",
      balanced: true,
      containsSensitiveData: false,
      recommended: false,
      explanation:
        "Excludes nobody and is recognised by nobody. This is the default that produces a page read as noise.",
    },
    {
      id: "pd-evaluator",
      name: "People assessing my skills",
      description: "Written to impress an evaluator.",
      sourceType: "secondary",
      quality: "medium",
      balanced: false,
      containsSensitiveData: false,
      recommended: false,
      explanation:
        "Tempting, and self-defeating. The evaluator is most impressed by a page that clearly serves its actual user.",
    },
    {
      id: "pd-classmates",
      name: "My friends and my class",
      description: "The people you are actually picturing.",
      sourceType: "primary",
      quality: "medium",
      balanced: false,
      containsSensitiveData: true,
      recommended: false,
      explanation:
        "The audience everyone writes for by accident, and the reason first drafts contain a school name and a phone number.",
    },
  ],
  promptConfig: {
    systemPromptRequirements: [
      {
        id: "pr-headline",
        label: "A headline that survives a scan",
        description:
          "Subject in the first three words. 80 characters maximum.",
        required: true,
      },
      {
        id: "pr-subtext",
        label: "One line that says what makes it different",
        description: "240 characters maximum, and it should earn all of them.",
        required: true,
      },
      {
        id: "pr-order",
        label: "About section first",
        description:
          "The one question every visitor has, answered above the fold.",
        required: true,
      },
      {
        id: "pr-examples",
        label: "Three things to try",
        description:
          "Nobody should have to invent their own first question.",
        required: true,
      },
      {
        id: "pr-claims",
        label: "Only claims you can support",
        description: "No usage numbers, no results, no endorsements.",
        required: true,
      },
    ],
    temperatureOptions: [0, 0.3, 0.7, 1],
    recommendedTemperature: 0.3,
    requiredPromptElements: [
      "specific-headline",
      "audience-named",
      "about-first",
      "example-questions",
    ],
    forbiddenBehaviors: [
      "Claiming users, results or endorsements that do not exist",
      "Publishing a full name, school, address, phone or email",
      "Leading with how it was built rather than what it does",
      "An empty chat box with no suggested first question",
    ],
    outputFormatOptions: [
      "About, steps, FAQ",
      "About, features, FAQ",
      "About, text, steps, FAQ",
    ],
  },
  auditCases: [
    {
      id: "pa-1",
      userMessage: "A visitor arrives from a shared link, having been told nothing.",
      aiResponse:
        "Page reads: GCSE biology, explained until it sticks. Ask a question and it asks questions back. Three examples underneath.",
      issue: "safe",
      severity: "low",
      correctAction: "approve",
      explanation:
        "Explains itself and offers a first move. This visitor knows what to do.",
    },
    {
      id: "pa-2",
      userMessage: "A visitor opens the link on a phone.",
      aiResponse:
        "Headline and chat box visible. The three example questions sit below the fold and are never seen.",
      issue: "missing_context",
      severity: "medium",
      correctAction: "regenerate",
      explanation:
        "Fine on a laptop, broken where most visitors actually are. Move the examples up.",
    },
    {
      id: "pa-3",
      userMessage: "A visitor asks the agent something completely off-topic.",
      aiResponse:
        "I only do GCSE biology — try me on cells, genetics or ecosystems.",
      issue: "safe",
      severity: "low",
      correctAction: "approve",
      explanation:
        "A clean decline that redirects. This is the first impression you want.",
    },
    {
      id: "pa-4",
      userMessage: "A teacher reads the About section.",
      aiResponse:
        "Page claims it is trusted by hundreds of students and approved by teachers.",
      issue: "hallucination",
      severity: "high",
      correctAction: "block",
      explanation:
        "Both untrue. The endorsement claim implicates real people who never saw it.",
    },
    {
      id: "pa-5",
      userMessage: "A parent looks for what happens to what their child types.",
      aiResponse:
        "Nothing on the page addresses it, and the agent has no answer either.",
      issue: "privacy_violation",
      severity: "medium",
      correctAction: "escalate",
      explanation:
        "The gatekeeper's actual question, unanswered. One FAQ entry fixes it.",
    },
    {
      id: "pa-6",
      userMessage: "A visitor reads the About section as drafted.",
      aiResponse:
        "It contains a full name, a school, an email address and a phone number.",
      issue: "privacy_violation",
      severity: "high",
      correctAction: "block",
      explanation:
        "Publishing this is not reversible. This is the check you just did by hand.",
    },
  ],
  fairnessTests: [
    {
      id: "pf-1",
      group: "Target user, arrives via a shared link",
      ageRange: "14-16",
      query: "Opens the page cold and looks for something to do.",
      expectedOutcome: "Finds an example question and clicks it.",
      observedOutcome: "Finds an example question and clicks it.",
      disparityDetected: false,
    },
    {
      id: "pf-2",
      group: "Phone visitors",
      query: "Opens the link on a phone, as most people do.",
      expectedOutcome: "Sees the headline, the purpose and a first move.",
      observedOutcome:
        "Sees the headline and an empty chat box. Examples are below the fold.",
      disparityDetected: true,
      recommendedAdjustment:
        "Move the example questions above the chat box, and check the fold on a phone rather than a laptop.",
    },
    {
      id: "pf-3",
      group: "Gatekeepers",
      query: "Looks for what it refuses to do and what it stores.",
      expectedOutcome: "Finds both answered in the FAQ.",
      observedOutcome:
        "Finds what it refuses to do. Nothing about data at all.",
      disparityDetected: true,
      recommendedAdjustment:
        "Add one FAQ entry saying plainly what is and is not stored.",
    },
    {
      id: "pf-4",
      group: "Evaluators",
      query: "Looks for who made this and how.",
      expectedOutcome: "Finds an honest, specific account.",
      observedOutcome: "Finds an honest, specific account.",
      disparityDetected: false,
    },
  ],
  deploymentPolicies: [
    {
      id: "pp-noPii",
      label: "No personal information on the page",
      description:
        "First name and year group at most. No school, address, phone or email.",
      category: "privacy",
      required: true,
      consequenceIfMissing:
        "Permanent, indexable, and impossible to fully retract once shared.",
    },
    {
      id: "pp-claims",
      label: "Every claim supportable today",
      description:
        "No usage figures, no results, no endorsements you cannot show.",
      category: "disclosure",
      required: true,
      consequenceIfMissing:
        "One unsupported line makes the whole page read as unreliable.",
    },
    {
      id: "pp-ai",
      label: "Say it is an AI",
      description: "A visitor should never be unsure what they are talking to.",
      category: "disclosure",
      required: true,
      consequenceIfMissing:
        "People weigh its answers as though a person wrote them.",
    },
    {
      id: "pp-data",
      label: "Answer the data question",
      description:
        "One FAQ entry on what is and is not stored, in plain words.",
      category: "data_governance",
      required: true,
      consequenceIfMissing:
        "The gatekeeper leaves without recommending it, and you never find out why.",
    },
    {
      id: "pp-scope",
      label: "The agent declines cleanly out of scope",
      description:
        "Tested with something off-topic before the link goes anywhere.",
      category: "safety",
      required: true,
      consequenceIfMissing:
        "Your first visitor's first impression is your agent improvising badly.",
    },
  ],
  scoring: {
    categories: [
      {
        id: "accuracy",
        label: "Honesty",
        description: "Every claim on the page can be supported today.",
        weight: 30,
        maxScore: 100,
      },
      {
        id: "fairness",
        label: "Reach",
        description:
          "Works on a phone, cold, for a visitor who was told nothing.",
        weight: 25,
        maxScore: 100,
      },
      {
        id: "safety",
        label: "Privacy",
        description: "Nothing published that should not be permanent.",
        weight: 30,
        maxScore: 100,
      },
      {
        id: "userExperience",
        label: "Clarity",
        description:
          "A stranger knows what it is and what to try within seconds.",
        weight: 15,
        maxScore: 100,
      },
    ],
    minimumOverallScore: 75,
    minimumCategoryScores: { safety: 90 },
    weighting: { accuracy: 30, fairness: 25, safety: 30, userExperience: 15 },
  },
  finalSignoff: {
    required: true,
    confirmationText:
      "I would send this link to somebody whose opinion of me matters, with no covering explanation.",
    checklist: [
      {
        id: "pk-privacy",
        label: "No personal details on the page",
        description: "First name and year group at most.",
        required: true,
      },
      {
        id: "pk-claims",
        label: "Every claim is one I could show evidence for today",
        description: "No users, no results, no endorsements.",
        required: true,
      },
      {
        id: "pk-cold",
        label: "It made sense logged out, on a phone",
        description: "Checked in a private window on an actual phone.",
        required: true,
      },
      {
        id: "pk-firstmove",
        label: "A visitor is offered something to try",
        description: "Nobody faces an empty box.",
        required: true,
      },
      {
        id: "pk-offtopic",
        label: "It declines off-topic questions cleanly",
        description: "Tested, not assumed.",
        required: true,
      },
    ],
    successMessage:
      "Published. That link is a real thing that exists whether or not you are in the room, which is what this whole course was for.",
    failureMessage:
      "Not yet — and the item you could not tick is genuinely worth ten more minutes before this goes somewhere permanent.",
  },
};

const lesson7Quiz: QuizStep = {
  id: "ai-websites-07-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why does the privacy check happen before publishing rather than after?",
  options: [
    {
      id: "w7q-a",
      label: "The builder will not let you edit a published page.",
      isCorrect: false,
      feedback: "You can edit it freely. That is not the reason.",
    },
    {
      id: "w7q-b",
      label:
        "Taking a page down does not remove caches, screenshots or search index entries.",
      isCorrect: true,
      feedback:
        "Right. Unpublishing is not undoing, which is why the check has to come first.",
    },
    {
      id: "w7q-c",
      label: "Publishing costs credits.",
      isCorrect: false,
      feedback: "Not the mechanism at issue.",
    },
    {
      id: "w7q-d",
      label: "Personal details break the page renderer.",
      isCorrect: false,
      feedback: "They render perfectly. That is the problem.",
    },
  ],
  explanation:
    "A published page is indexable and copyable the moment it exists. Removing it later removes your copy and nobody else's, so anything you would not want permanent has to come off before the first publish.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson7Completion: CompletionStep = {
  id: "ai-websites-07-completion",
  type: "completion",
  title: "Course Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Public means indexable and permanent — check before publishing, not after.",
    "A first name and what you built is enough credit, and reads better.",
    "The page has to explain itself to somebody who was told nothing.",
    "A link nobody understands wastes your one chance with that person.",
  ],
  xpReward: 60,
  completionMessage:
    "You finished Building AI-Powered Websites. One thing left, and it is the real one.",
  mission: {
    target: "agent_site",
    headline: "your mission",
    description:
      "Publish your page for real. Take your most recently deployed agent through the publishing flow, check the About section for anything that should not be permanent, then copy the link and send it to one person outside BuildGentic. Not a screenshot — the link.",
    label: "Publish my page",
  },
};

/*
 * ============================================================
 * LESSON OBJECTS
 * ============================================================
 */

export const aiWebsitesLessons: Lesson[] = [
  {
    id: "ai-websites-01",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 1,
    title: "From Agent to Product",
    description:
      "Why an agent alone is not the finish line, and the four gates between a thing you built and a thing you can send.",
    track: "AI Websites",
    conceptIds: ["built-vs-shown", "four-gates"],
    challengeIds: ["personality-in-public", "is-it-ready"],
    prerequisites: [],
    totalXp: 100,
    estimatedMinutes: 22,
    learningObjectives: [
      "Say what separates a working agent from something a stranger can use.",
      "Judge whether a project is ready to be seen.",
      "Decide how much latitude a public-facing agent should have.",
    ],
    keyTakeaways: [
      "What makes it work for you is knowledge in your head, not in the product.",
      "Most stuck projects are stuck at explaining themselves.",
      "A public agent usually wants less latitude than a private one.",
    ],
    steps: [
      lesson1Intro,
      lesson1Concept1,
      lesson1Activity1,
      lesson1Concept2,
      lesson1Activity2,
      lesson1Quiz,
      lesson1Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-websites-02",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 2,
    title: "Who Is This For?",
    description:
      "Audience and purpose before design — the decision the builder's structured fields are all downstream of.",
    track: "AI Websites",
    conceptIds: ["everyone-is-not-an-audience", "three-audiences"],
    challengeIds: ["who-is-near-whom", "sort-the-arrivals"],
    prerequisites: ["ai-websites-01"],
    totalXp: 120,
    estimatedMinutes: 24,
    learningObjectives: [
      "Name a specific audience rather than a general one.",
      "Group real visitors by what they actually need.",
      "Recognise a page written for the person who built it.",
    ],
    keyTakeaways: [
      "A page for everyone is read as noise.",
      "Visitors group by need, not by demographic.",
      "Learners, gatekeepers and evaluators all arrive at one page.",
    ],
    steps: [
      lesson2Intro,
      lesson2Concept1,
      lesson2Activity1,
      lesson2Concept2,
      lesson2Activity2,
      lesson2Quiz,
      lesson2Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-websites-03",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 3,
    title: "Design Choices That Matter",
    description:
      "The real templates, palettes and section kinds — and why which section comes first outranks all of them.",
    track: "AI Websites",
    conceptIds: ["order-beats-colour", "supportable-claims"],
    challengeIds: ["assemble-the-page", "publish-check-cut"],
    prerequisites: ["ai-websites-02"],
    totalXp: 130,
    estimatedMinutes: 25,
    learningObjectives: [
      "Match a template to what the project actually is.",
      "Explain why section order matters more than palette.",
      "Judge which claims on a page can be supported.",
    ],
    keyTakeaways: [
      "Section order is the highest-leverage choice the builder offers.",
      "Lead with what it is.",
      "Cut anything a visitor could not disagree with.",
    ],
    steps: [
      lesson3Intro,
      lesson3Concept1,
      lesson3Activity1,
      lesson3Concept2,
      lesson3Activity2,
      lesson3Quiz,
      lesson3Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-websites-04",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 4,
    title: "Writing for a Page, Not a Chat",
    description:
      "Short, scannable copy versus conversational text — a practical writing skill, not a design one.",
    track: "AI Websites",
    conceptIds: ["front-load-the-meaning", "write-for-the-95"],
    challengeIds: ["what-a-scanner-sees", "scan-test"],
    prerequisites: ["ai-websites-03"],
    totalXp: 140,
    estimatedMinutes: 25,
    learningObjectives: [
      "Write a line that survives being scanned.",
      "Front-load the informative word in a sentence.",
      "Judge copy by what a scanner takes away.",
    ],
    keyTakeaways: [
      "Scanners read the first two or three words.",
      "A phrase whose likeliest ending is empty should be cut.",
      "If the headline and one line cannot carry it, body copy will not.",
    ],
    steps: [
      lesson4Intro,
      lesson4Concept1,
      lesson4Activity1,
      lesson4Concept2,
      lesson4Activity2,
      lesson4Quiz,
      lesson4Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-websites-05",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 5,
    title: "Customizing With Natural Language",
    description:
      "Hands-on with the natural-language editor, and why some requests have nowhere to land.",
    track: "AI Websites",
    conceptIds: ["edit-becomes-a-patch", "name-the-field"],
    challengeIds: ["will-this-land", "same-request-different-phrasings"],
    prerequisites: ["ai-websites-04"],
    totalXp: 150,
    estimatedMinutes: 26,
    learningObjectives: [
      "Phrase a natural-language edit so it lands.",
      "Predict which requests the editor cannot honour.",
      "Explain why a closed field set is a safety property.",
    ],
    keyTakeaways: [
      "An edit becomes a validated patch to known fields.",
      "Name the field and the value rather than a feeling.",
      "The closed field list is why a page cannot contain a script.",
    ],
    steps: [
      lesson5Intro,
      lesson5Concept1,
      lesson5Activity1,
      lesson5Concept2,
      lesson5Activity2,
      lesson5Quiz,
      lesson5Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-websites-06",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 6,
    title: "Testing Your Page Like a Visitor",
    description:
      "Opening your own page as a stranger would. Catching the only-makes-sense-to-me trap.",
    track: "AI Websites",
    conceptIds: ["curse-of-knowledge", "a-test-you-can-run"],
    challengeIds: ["what-does-your-page-assume", "check-your-own-page"],
    prerequisites: ["ai-websites-05"],
    totalXp: 160,
    estimatedMinutes: 26,
    learningObjectives: [
      "Find the assumptions your page makes about its reader.",
      "Check whether the chat makes sense with no prior context.",
      "Verify the claims on your own page.",
    ],
    keyTakeaways: [
      "You cannot un-know your project, so remove yourself from the test.",
      "Log out, read two lines, check a phone, ask something rude, watch a stranger.",
      "Unsupported claims are a liability, not enthusiasm.",
    ],
    steps: [
      lesson6Intro,
      lesson6Concept1,
      lesson6Activity1,
      lesson6Concept2,
      lesson6Activity2,
      lesson6Quiz,
      lesson6Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-websites-07",
    courseId: "ai-websites",
    courseTitle: "Building AI-Powered Websites",
    number: 7,
    title: "Publish & Share",
    description:
      "The capstone, and it is literal: check what is public, work the publish decision, then publish the real page and send the real link.",
    track: "AI Websites",
    conceptIds: ["public-means-public"],
    challengeIds: ["last-check", "the-publish-run"],
    prerequisites: [
      "ai-websites-01",
      "ai-websites-02",
      "ai-websites-03",
      "ai-websites-04",
      "ai-websites-05",
      "ai-websites-06",
    ],
    totalXp: 300,
    estimatedMinutes: 35,
    isCapstone: true,
    learningObjectives: [
      "Remove personal information that should not be public.",
      "Work through the publish decision end to end.",
      "Publish, copy the link, and share it with someone real.",
    ],
    keyTakeaways: [
      "Public means indexable and permanent.",
      "A first name and what you built is enough credit.",
      "A link nobody understands wastes your one chance.",
    ],
    steps: [
      lesson7Intro,
      lesson7Concept1,
      lesson7Activity1,
      lesson7Activity2,
      lesson7Quiz,
      lesson7Completion,
    ],
    passingScore: 80,
  },
];

/*
 * ============================================================
 * CURRICULUM
 * ============================================================
 */

export const aiWebsitesCurriculum: Curriculum = {
  id: "ai-websites",
  name: "Building AI-Powered Websites",
  description:
    "Turning an agent into something you can show someone. Audience, design choices, writing for a page, the natural-language editor, testing as a stranger — and a capstone that publishes a real page at a real link.",
  concepts: [],
  lessons: aiWebsitesLessons,
  challenges: [],
  totalXp: aiWebsitesLessons.reduce(
    (total, lesson) => total + lesson.totalXp,
    0,
  ),
};

export default aiWebsitesLessons;
