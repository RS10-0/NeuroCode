import type { Curriculum } from "./Curriculum";
import type {
  AiSorterActivityStep,
  CapstoneActivityStep,
  CompletionStep,
  ConceptStep,
  DatasetImbalanceActivityStep,
  EdgeCaseMatrixActivityStep,
  EthicsDialActivityStep,
  FactCheckerActivityStep,
  FairnessMetricsActivityStep,
  IntroStep,
  Lesson,
  ModelTestingActivityStep,
  ParameterTuningActivityStep,
  PolicyCreatorActivityStep,
  PromptRefinementActivityStep,
  QuizStep,
  TemperatureSliderActivityStep,
  TokenizerActivityStep,
  VectorSimilarityActivityStep,
} from "./Lesson";

/*
 * ============================================================
 * AI AGENTS & AUTOMATION
 * ============================================================
 *
 * Seven lessons ending in a real build.
 *
 * The distinction the whole course turns on is that an agent
 * has a goal and can act, where a chatbot has a turn and can
 * answer. Everything else — instructions, memory, tools,
 * testing — is a consequence of that one difference.
 *
 * The last lesson hands the learner into Agent Builder. It is
 * the strongest course-to-feature loop on the platform and the
 * course is shaped to arrive there with something to build.
 */

/*
 * ============================================================
 * LESSON 1 — WHAT IS AN AI AGENT?
 * ============================================================
 */

const lesson1Intro: IntroStep = {
  id: "ai-agents-01-intro",
  type: "intro",
  title: "Start here",
  subtitle:
    "Seven lessons from what an agent actually is, to one you have built and can show someone.",
  content:
    "Agent has become a word people use to mean any AI that seems busy. It has a real meaning, and the real meaning is useful: an agent is given a goal rather than a question, and it can take actions rather than only produce text. That difference is what the next six lessons unpack, and the seventh is where you build one.",
  learningObjectives: [
    "State the actual difference between an agent and a chatbot.",
    "Explain why a goal produces different behaviour than a question.",
    "Recognise how much latitude an agent has been given.",
  ],
  estimatedMinutes: 2,
};

const lesson1Concept1: ConceptStep = {
  id: "ai-agents-01-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Given a question",
        points: [
          "Produces one response",
          "Stops when the text ends",
          "Cannot check its own answer",
          "You decide what happens next",
        ],
      },
      right: {
        label: "Given a goal",
        points: [
          "Produces a sequence of moves",
          "Stops when the goal is met",
          "Can look things up and revise",
          "It decides what happens next",
        ],
      },
    },
  },
  title: "A Goal, Not a Question",
  requiresCompletion: false,
  content:
    "Ask a model what the weather is in Lisbon and it will tell you, from whatever it happened to absorb during training, possibly out of date, definitely not checked. Give an agent the goal of telling you whether to pack a coat for Lisbon on Thursday and something different happens: it can look up the forecast, notice Thursday is four days out, and come back with an actual recommendation. Same underlying model. The difference is that one was handed a question and the other was handed an objective and the means to pursue it.",
  examples: [
    {
      id: "question",
      title: "A question",
      description: "One turn in, one turn out. The loop is you.",
      input: "What is the weather in Lisbon?",
      output: "A sentence about Lisbon weather, unverified.",
    },
    {
      id: "goal",
      title: "A goal",
      description:
        "Several steps, chosen by the agent, ending in something you can act on.",
      input: "Work out whether I need a coat in Lisbon on Thursday.",
      output:
        "Checks a forecast, compares to your stated cold tolerance, answers yes or no.",
    },
  ],
  misconception:
    "An agent is not a smarter model. It is usually the same model, given a goal, a set of tools, and permission to take more than one step.",
};

const lesson1Activity1: TemperatureSliderActivityStep = {
  id: "ai-agents-01-step-02",
  type: "activity",
  interactiveType: "temperature_slider",
  title: "How Much Latitude?",
  requiresCompletion: true,
  instructions:
    "The same agent brief, run at different levels of latitude. Move the dial and watch how much the agent improvises versus sticks to exactly what it was told.",
  completion: {
    type: "required_actions",
    requiredActions: ["compare-temperatures"],
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "Latitude is a design decision. An agent that books things needs less of it than an agent that brainstorms.",
    incorrect:
      "Try both ends. Notice that neither extreme is right for every job.",
  },
  minTemperature: 0,
  maxTemperature: 1,
  initialTemperature: 0.3,
  stepSize: 0.1,
  showRandomnessMeter: true,
  prompts: [
    {
      id: "brief-booking",
      prompt:
        "Agent brief: book the cheapest direct flight to Lisbon on Thursday.",
      description: "A task with one correct outcome.",
    },
    {
      id: "brief-ideas",
      prompt:
        "Agent brief: suggest three things to do in Lisbon for someone who hates museums.",
      description: "A task where variety is the point.",
    },
  ],
  outputSets: [
    {
      promptId: "brief-booking",
      outputs: [
        {
          temperature: 0,
          output:
            "Searched direct flights Thursday. Cheapest is 09:15, EUR 84. Booking that one.",
          creativityScore: 5,
          predictabilityScore: 98,
        },
        {
          temperature: 0.5,
          output:
            "Cheapest direct is 09:15 at EUR 84, though the 18:40 at EUR 91 might suit you better if you dislike early starts. Going with the 09:15 as instructed.",
          creativityScore: 45,
          predictabilityScore: 62,
        },
        {
          temperature: 1,
          output:
            "There is a 09:15 for EUR 84, but have you considered flying Wednesday evening instead? Also Porto is lovely this time of year and the train down is only three hours.",
          creativityScore: 92,
          predictabilityScore: 18,
        },
      ],
    },
    {
      promptId: "brief-ideas",
      outputs: [
        {
          temperature: 0,
          output:
            "1. Walk the Alfama district. 2. Ride tram 28. 3. Visit a viewpoint.",
          creativityScore: 12,
          predictabilityScore: 95,
        },
        {
          temperature: 0.5,
          output:
            "1. Get lost in Alfama on foot, no map. 2. Eat at the covered market at Cais do Sodre. 3. Take the ferry to Cacilhas for the view back at the city.",
          creativityScore: 58,
          predictabilityScore: 55,
        },
        {
          temperature: 1,
          output:
            "1. Find the tiny bar in Bairro Alto that only sells ginjinha in chocolate cups. 2. Swim at Carcavelos at seven in the morning. 3. Sit through a fado set you do not understand a word of.",
          creativityScore: 94,
          predictabilityScore: 22,
        },
      ],
    },
  ],
};

const lesson1Concept2: ConceptStep = {
  id: "ai-agents-01-step-03",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        { id: "goal", label: "Goal", caption: "What done looks like" },
        { id: "plan", label: "Plan", caption: "Steps it chose itself" },
        { id: "act", label: "Act", caption: "Tools, lookups, writes" },
        { id: "check", label: "Check", caption: "Is the goal met yet?" },
      ],
    },
  },
  title: "The Loop",
  requiresCompletion: false,
  content:
    "The loop is the whole thing. An agent decides what to do, does it, looks at the result, and asks whether it is finished. If not, it goes round again. That is why a goal has to be written so that done is recognisable — an agent given a goal it cannot tell it has reached will either stop too early or never stop at all. Most bad agents are bad here, at the definition of finished, rather than anywhere clever.",
  examples: [
    {
      id: "unrecognisable",
      title: "Done is not recognisable",
      description: "The agent has no way to know when to stop.",
      input: "Make our documentation better.",
      output: "Endless edits, or one edit and a declaration of victory.",
    },
    {
      id: "recognisable",
      title: "Done is recognisable",
      description: "There is a testable condition.",
      input:
        "Every page in the docs folder has a summary line under its title.",
      output: "The agent can check, and stops when the check passes.",
    },
  ],
  misconception:
    "People assume an agent that runs longer is working harder. Usually a long run means the goal was written so that the agent cannot tell whether it has finished.",
};

const lesson1Activity2: PromptRefinementActivityStep = {
  id: "ai-agents-01-step-04",
  type: "activity",
  interactiveType: "prompt_refinement",
  title: "Turn a Question Into a Goal",
  requiresCompletion: true,
  instructions:
    "Below is a request written as a question, and what an agent did with it. Add constraints until it reads as a goal an agent could actually pursue and know it had finished.",
  completion: {
    type: "target_score",
    targetScore: 75,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "That is a goal. It says what done means, and the agent can check it.",
    incorrect:
      "Ask yourself how the agent would know it had finished. If you cannot answer, neither can it.",
  },
  targetQualityScore: 75,
  minimumConstraints: 3,
  originalPrompt: "Can you help me sort out my reading list?",
  flawedOutput:
    "Of course! Here are some tips for organising a reading list: consider grouping books by genre, or by priority. You might also want to set reading goals. Would you like me to suggest a system?",
  refinementTargets: [
    {
      id: "t-done",
      label: "Define done",
      description:
        "The agent needs a condition it can check, not a vibe it can aim at.",
    },
    {
      id: "t-scope",
      label: "Bound the work",
      description: "Say what is in scope so the loop terminates.",
    },
    {
      id: "t-action",
      label: "Ask for an action, not advice",
      description:
        "A question invites suggestions. A goal invites a change to something real.",
    },
  ],
  availableConstraints: [
    {
      id: "c-done",
      category: "format",
      label: "A checkable finish line",
      text: "Done means every book has a tag of read, reading, or unread.",
      scoreValue: 28,
    },
    {
      id: "c-scope",
      category: "context",
      label: "Bound the scope",
      text: "Only the 40 books in my list file. Do not add new ones.",
      scoreValue: 22,
    },
    {
      id: "c-action",
      category: "role",
      label: "Ask for the change itself",
      text: "Edit the file directly rather than telling me how to.",
      scoreValue: 24,
    },
    {
      id: "c-conflict",
      category: "restriction",
      label: "Say what to do when unsure",
      text: "If you cannot tell which tag applies, mark it unknown and move on.",
      scoreValue: 18,
    },
    {
      id: "c-nice",
      category: "tone",
      label: "Be helpful",
      text: "Please be really thorough and helpful about this.",
      scoreValue: 2,
    },
    {
      id: "c-long",
      category: "length",
      label: "Ask for detail",
      text: "Give a comprehensive treatment of the topic.",
      scoreValue: 1,
    },
  ],
  evaluationRubric: [
    {
      id: "r-done",
      label: "Done is checkable",
      description: "There is a condition the agent can evaluate.",
      weight: 40,
    },
    {
      id: "r-scope",
      label: "Scope is bounded",
      description: "The set of things to act on is finite and named.",
      weight: 30,
    },
    {
      id: "r-action",
      label: "It asks for an action",
      description: "The agent changes something rather than describing a plan.",
      weight: 30,
    },
  ],
  sampleImprovedOutput:
    "Tagged 40 books. 12 read, 3 reading, 23 unread, 2 marked unknown because the titles were ambiguous. File updated.",
};

const lesson1Quiz: QuizStep = {
  id: "ai-agents-01-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText: "What most fundamentally separates an agent from a chatbot?",
  options: [
    {
      id: "a1q-a",
      label: "The agent uses a larger, more capable model.",
      isCorrect: false,
      feedback:
        "Often it is the very same model. Capability is not the distinction.",
    },
    {
      id: "a1q-b",
      label:
        "The agent is given a goal and can take multiple actions toward it.",
      isCorrect: true,
      feedback:
        "That is it. Goal plus the ability to act, over more than one step.",
    },
    {
      id: "a1q-c",
      label: "The agent remembers previous conversations.",
      isCorrect: false,
      feedback:
        "Useful, and covered in lesson four, but chatbots can do this too.",
    },
    {
      id: "a1q-d",
      label: "The agent responds faster.",
      isCorrect: false,
      feedback:
        "Agents are usually slower, because they take several steps.",
    },
  ],
  explanation:
    "An agent is defined by having an objective it is pursuing and the means to take actions toward it, in a loop, until it can tell the objective is met.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson1Completion: CompletionStep = {
  id: "ai-agents-01-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "An agent has a goal and can act; a chatbot has a turn and can answer.",
    "It is usually the same model underneath.",
    "The loop is decide, act, check, repeat.",
    "Most bad agents are bad at the definition of finished.",
  ],
  xpReward: 25,
  completionMessage:
    "You now have the distinction the rest of this course is built on.",
  nextLessonId: "ai-agents-02",
};

/*
 * ============================================================
 * LESSON 2 — AGENTS VS. CHATBOTS
 * ============================================================
 */

const lesson2Intro: IntroStep = {
  id: "ai-agents-02-intro",
  type: "intro",
  title: "Agents vs. Chatbots",
  subtitle: "The same job, done both ways, side by side.",
  content:
    "Definitions only get you so far. This lesson runs one real task through a chatbot and through an agent and shows where they diverge — which turns out not to be where most people expect.",
  learningObjectives: [
    "Trace a multi-step task through both a chatbot and an agent.",
    "Identify which steps a chatbot pushes back onto you.",
    "Recognise tasks where an agent is the wrong tool.",
  ],
  estimatedMinutes: 3,
};

const lesson2Concept1: ConceptStep = {
  id: "ai-agents-02-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Chatbot: you are the loop",
        body: "Ask. Read. Copy the answer somewhere. Ask the follow-up. Read. Notice it contradicts step one. Ask again.",
      },
      after: {
        label: "Agent: it is the loop",
        body: "State the goal. It asks itself the follow-ups, notices its own contradiction, and comes back when the goal is met.",
      },
      transform: "Move the loop from the human to the system",
    },
  },
  title: "Who Runs the Loop",
  requiresCompletion: false,
  content:
    "When you use a chatbot for a task with six steps, you perform five of them. You hold the goal in your head, you decide what to ask next, you notice when an answer contradicts an earlier one, and you carry information between turns by pasting it. None of that is the model working. That is you, doing project management, one message at a time. An agent takes that job.",
  examples: [
    {
      id: "human-loop",
      title: "You run the loop",
      description:
        "Six turns, five of which are you deciding what to ask next.",
      input: "Plan a birthday dinner for eight people with two vegetarians.",
      output: "A good answer per turn, and all the joining-up is yours.",
    },
    {
      id: "agent-loop",
      title: "It runs the loop",
      description:
        "One goal, several internal steps, one result to check.",
      input: "Same task, given as a goal with the constraints stated once.",
      output: "A plan that is already internally consistent.",
    },
  ],
  misconception:
    "The benefit of an agent is often described as saving typing. The real benefit is that consistency across steps becomes the system's problem instead of yours.",
};

const lesson2Activity1: ParameterTuningActivityStep = {
  id: "ai-agents-02-step-02",
  type: "activity",
  interactiveType: "parameter_tuning",
  title: "When Is an Agent Worth It?",
  requiresCompletion: true,
  instructions:
    "Four properties of a task. Adjust them and watch how much an agent actually helps compared to just asking a chatbot. There is a region where an agent is clearly worse.",
  completion: {
    type: "target_score",
    targetScore: 78,
    allowPartialCredit: true,
    maxAttempts: 12,
  },
  feedback: {
    correct:
      "An agent earns its keep on multi-step work with checkable results. On one-shot questions it is overhead.",
    incorrect:
      "Try turning steps down to one and see what happens to the benefit.",
  },
  targetAccuracy: 78,
  parameters: [
    {
      id: "steps",
      label: "Steps in the task",
      description: "How many distinct things have to happen in order.",
      min: 1,
      max: 12,
      step: 1,
      unit: "steps",
    },
    {
      id: "checkable",
      label: "How checkable done is",
      description:
        "From completely subjective to a condition that can be tested.",
      min: 0,
      max: 10,
      step: 1,
    },
    {
      id: "tools",
      label: "External lookups needed",
      description:
        "How much of the task needs information the model does not carry.",
      min: 0,
      max: 8,
      step: 1,
      unit: "lookups",
    },
    {
      id: "stakes",
      label: "Cost of a wrong action",
      description:
        "What happens if it acts on a mistake without asking first.",
      min: 0,
      max: 10,
      step: 1,
    },
  ],
  initialValues: { steps: 1, checkable: 2, tools: 0, stakes: 5 },
  accuracyModel: {
    baselineAccuracy: 22,
    minAccuracy: 8,
    maxAccuracy: 96,
    effects: [
      {
        parameterId: "steps",
        optimalRange: [4, 10],
        effectStrength: 30,
        description:
          "One-step tasks do not need an agent. The advantage grows with the number of steps you would otherwise coordinate yourself.",
      },
      {
        parameterId: "checkable",
        optimalRange: [7, 10],
        effectStrength: 28,
        description:
          "An agent needs to recognise done. When done is subjective, it cannot close its own loop.",
      },
      {
        parameterId: "tools",
        optimalRange: [2, 6],
        effectStrength: 22,
        description:
          "Lookups are where an agent pulls ahead — it can go and get what it needs mid-task.",
      },
      {
        parameterId: "stakes",
        optimalRange: [0, 4],
        effectStrength: 18,
        description:
          "High-stakes irreversible actions are where autonomy stops being a feature. Keep a human in the loop.",
      },
    ],
  },
  feedbackThresholds: [
    {
      minAccuracy: 0,
      maxAccuracy: 40,
      message:
        "At these settings, just ask a chatbot. The agent is pure overhead.",
    },
    {
      minAccuracy: 40,
      maxAccuracy: 72,
      message: "Borderline. An agent helps, but not dramatically.",
    },
    {
      minAccuracy: 72,
      maxAccuracy: 101,
      message:
        "This is agent territory: several steps, a checkable finish, real lookups, and mistakes that are cheap to undo.",
    },
  ],
};

const lesson2Concept2: ConceptStep = {
  id: "ai-agents-02-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "Where the time actually goes on a six-step task",
      bars: [
        {
          id: "chat-model",
          label: "Chatbot: model working",
          value: 30,
          note: "Six good answers",
        },
        {
          id: "chat-you",
          label: "Chatbot: you coordinating",
          value: 70,
          note: "The real cost",
        },
        {
          id: "agent-model",
          label: "Agent: model working",
          value: 85,
          note: "Including its own retries",
        },
        {
          id: "agent-you",
          label: "Agent: you checking",
          value: 15,
          note: "Reviewing one result",
        },
      ],
    },
  },
  title: "What Actually Gets Cheaper",
  requiresCompletion: false,
  content:
    "Notice the agent does more total work, not less — it retries, it double-checks, it goes down occasional dead ends. What collapses is your share. That is the trade you are making, and it is a good trade right up until the moment the agent does something irreversible that you would have caught. Which is why the interesting design question is not can it do this, it is what should it be allowed to do without asking.",
  examples: [
    {
      id: "reversible",
      title: "Reversible actions",
      description: "Let it run. A bad draft costs nothing.",
      input: "Draft six replies for me to review.",
      output: "Six drafts, none sent.",
    },
    {
      id: "irreversible",
      title: "Irreversible actions",
      description: "Put a human in the loop, every time.",
      input: "Send six replies.",
      output: "Six sent emails and no undo.",
    },
  ],
  misconception:
    "Full autonomy is not the goal state. The best agents are usually the ones with a clear line between what they do freely and what they bring to you first.",
};

const lesson2Activity2: ModelTestingActivityStep = {
  id: "ai-agents-02-step-04",
  type: "activity",
  interactiveType: "model_testing",
  title: "Chatbot or Agent?",
  requiresCompletion: true,
  instructions:
    "Six real tasks. Predict whether an agent genuinely helps or is overhead, then compare against what happened when both were tried.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 4,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "You are judging on step count and checkability, not on how impressive the task sounds.",
    incorrect:
      "Count the steps, then ask whether the agent could tell it had finished.",
  },
  minimumTestsRequired: 4,
  showPerCategoryAccuracy: true,
  trainingSummary: {
    trainingItemCount: 6,
    categories: ["chatbot", "agent"],
    trainingAccuracy: 82,
    knownLimitations: [
      "Tasks that sound complicated are not always multi-step.",
      "A task with no checkable finish suits an agent badly however many steps it has.",
    ],
  },
  testItems: [
    {
      id: "t1",
      input: "What does this error message mean?",
      expectedCategory: "chatbot",
      modelPrediction: "chatbot",
      confidence: 0.94,
      explanation: "One step, one answer. An agent adds latency and nothing else.",
    },
    {
      id: "t2",
      input:
        "Go through my 40 bookmarks, work out which links are dead, and produce a list.",
      expectedCategory: "agent",
      modelPrediction: "agent",
      confidence: 0.92,
      explanation:
        "Forty lookups, a completely checkable finish, and every action reversible.",
    },
    {
      id: "t3",
      input: "Write me a poem about autumn.",
      expectedCategory: "chatbot",
      modelPrediction: "chatbot",
      confidence: 0.89,
      explanation:
        "One step and no checkable definition of done — the agent loop has nothing to close on.",
    },
    {
      id: "t4",
      input:
        "Find every place our pricing page contradicts our docs, and list them.",
      expectedCategory: "agent",
      modelPrediction: "agent",
      confidence: 0.85,
      explanation:
        "Multiple documents, cross-referencing, and a finding is verifiable once produced.",
    },
    {
      id: "t5",
      input: "Explain quantum entanglement in simple terms.",
      expectedCategory: "chatbot",
      modelPrediction: "agent",
      confidence: 0.51,
      explanation:
        "A near-miss worth studying. It sounds hard, so an agent feels appropriate — but it is one step with no external lookup and no checkable finish.",
    },
    {
      id: "t6",
      input:
        "Rename every file in this folder to match our naming convention.",
      expectedCategory: "agent",
      modelPrediction: "agent",
      confidence: 0.88,
      explanation:
        "Many steps, testable finish. Worth noting the actions are only semi-reversible, so this one wants a preview before it runs.",
    },
  ],
};

const lesson2Quiz: QuizStep = {
  id: "ai-agents-02-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "For which task is an agent the wrong tool, even though it sounds complex?",
  options: [
    {
      id: "a2q-a",
      label: "Checking 200 links and reporting which are dead.",
      isCorrect: false,
      feedback: "Perfect agent work — many steps, checkable, reversible.",
    },
    {
      id: "a2q-b",
      label: "Explaining a difficult concept in simple terms.",
      isCorrect: true,
      feedback:
        "Right. Hard for a person, but one step for a model, with no checkable finish and nothing to look up.",
    },
    {
      id: "a2q-c",
      label: "Cross-referencing two documents for contradictions.",
      isCorrect: false,
      feedback: "Multi-step and verifiable. An agent suits this well.",
    },
    {
      id: "a2q-d",
      label: "Tagging forty books by reading status.",
      isCorrect: false,
      feedback: "Forty steps with a checkable finish. Ideal.",
    },
  ],
  explanation:
    "Difficulty for a human and suitability for an agent are unrelated. What matters is the number of steps, whether done is checkable, and whether external lookups are needed.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson2Completion: CompletionStep = {
  id: "ai-agents-02-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "With a chatbot, you are the loop — holding the goal and joining the turns up.",
    "An agent does more total work; what shrinks is your share.",
    "Agents suit multi-step tasks with a checkable finish and cheap mistakes.",
    "Full autonomy is not the goal — a clear line around irreversible actions is.",
  ],
  xpReward: 30,
  completionMessage:
    "You can now tell which tasks are worth an agent, which is most of the battle.",
  nextLessonId: "ai-agents-03",
};

/*
 * ============================================================
 * LESSON 3 — INSTRUCTIONS & GOALS
 * ============================================================
 */

const lesson3Intro: IntroStep = {
  id: "ai-agents-03-intro",
  type: "intro",
  title: "Instructions & Goals",
  subtitle: "The system prompt is the agent. Everything else is plumbing.",
  content:
    "Two agents running the identical model with identical tools can behave completely differently, and the only thing separating them is the paragraph at the top telling them who they are and what they are for. This lesson is about writing that paragraph.",
  learningObjectives: [
    "Explain what a system prompt determines that the model alone does not.",
    "Balance competing priorities in a set of instructions.",
    "Write rules about what an agent must never do.",
  ],
  estimatedMinutes: 3,
};

const lesson3Concept1: ConceptStep = {
  id: "ai-agents-03-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Vague brief",
        points: [
          "You are a helpful assistant",
          "No stated purpose",
          "No stated limits",
          "Every situation handled ad hoc",
        ],
      },
      right: {
        label: "Real brief",
        points: [
          "You help Year 9 students with maths homework",
          "You explain method, never give final answers",
          "You never discuss anything but maths",
          "Edge cases already decided",
        ],
      },
    },
  },
  title: "What a Brief Decides",
  requiresCompletion: false,
  content:
    "You are a helpful assistant is the null instruction. It tells the model nothing it was not already doing, so every judgement call gets made fresh, differently, each time. A real brief front-loads those judgements. It says who is on the other side, what the agent is for, and — most usefully — what it should do in the awkward cases, so that behaviour is decided once by you rather than twenty times by chance.",
  examples: [
    {
      id: "brief-null",
      title: "The null brief",
      description: "Every awkward case is resolved by whatever seems likely.",
      input: "You are a helpful assistant.",
      output:
        "Sometimes gives the answer, sometimes the method, depending on phrasing.",
    },
    {
      id: "brief-real",
      title: "A brief that decided in advance",
      description: "The awkward case has a stated rule.",
      input:
        "If a student asks for the final answer directly, give the next step instead and ask them to try it.",
      output: "Same behaviour every time, including at 11pm the night before.",
    },
  ],
  misconception:
    "A system prompt is not a personality. Tone is the least of what it does — the useful part is the decisions it makes ahead of time about situations you will not be there for.",
};

const lesson3Activity1: EthicsDialActivityStep = {
  id: "ai-agents-03-step-02",
  type: "activity",
  interactiveType: "ethics_dial",
  title: "Balance the Brief",
  requiresCompletion: true,
  instructions:
    "You are writing the brief for a study agent a school wants to deploy. Move the priority dials and see what the resulting agent actually does. There is no setting that maximises everything.",
  completion: {
    type: "required_actions",
    requiredActions: ["reach-viable-outcome"],
    allowPartialCredit: true,
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "That is a brief you could defend to a teacher and a parent. Note what you gave up to get there.",
    incorrect:
      "Watch what happens to the other two scores when you push one dial to the top.",
  },
  showTradeoffGraph: true,
  scenario: {
    id: "study-agent",
    title: "A homework study agent for Years 9 to 11",
    description:
      "Ridgeway Secondary School wants an agent students can use for maths and science homework at home, without a teacher present.",
    context:
      "Students will use it unsupervised, often late, often under deadline pressure. Parents have asked what it will and will not do. The school is answerable for anything it says.",
  },
  priorities: [
    {
      id: "helpfulness",
      label: "Immediate helpfulness",
      description:
        "How directly the agent solves the problem in front of the student.",
      weight: 30,
    },
    {
      id: "learning",
      label: "Protecting the learning",
      description:
        "How hard the agent works to make the student do the thinking.",
      weight: 40,
    },
    {
      id: "scope",
      label: "Staying in scope",
      description:
        "How firmly the agent refuses subjects outside maths and science.",
      weight: 30,
    },
  ],
  constraints: [
    {
      id: "no-final-answers",
      label: "Never supply the final answer outright",
      description:
        "Method and next step only, however the question is phrased.",
      required: true,
    },
    {
      id: "disclose",
      label: "Always identify itself as an AI",
      description: "No pretending to be a tutor or a teacher.",
      required: true,
    },
    {
      id: "escalate",
      label: "Escalate anything about wellbeing",
      description:
        "A student in distress goes to a human, not to a study agent.",
      required: true,
    },
    {
      id: "no-grading",
      label: "Never predict a grade",
      description: "It is not qualified to and the school cannot back it up.",
      required: false,
    },
  ],
  outcomes: [
    {
      id: "o-max-help",
      settings: { helpfulness: 100, learning: 10, scope: 40 },
      description:
        "Gives complete worked answers on request. Students love it, learn nothing, and the school pulls it within a term.",
      safetyScore: 55,
      fairnessScore: 60,
      legalComplianceScore: 40,
    },
    {
      id: "o-max-learning",
      settings: { helpfulness: 20, learning: 100, scope: 60 },
      description:
        "Refuses to give anything but Socratic questions. Students give up and use something else that has no rules at all.",
      safetyScore: 70,
      fairnessScore: 45,
      legalComplianceScore: 75,
    },
    {
      id: "o-balanced",
      settings: { helpfulness: 60, learning: 75, scope: 85 },
      description:
        "Explains the method, works one similar example, then hands the real problem back. Stays on maths and science. Escalates anything else.",
      safetyScore: 90,
      fairnessScore: 85,
      legalComplianceScore: 92,
    },
    {
      id: "o-max-scope",
      settings: { helpfulness: 40, learning: 60, scope: 100 },
      description:
        "Refuses so much that a student asking how to structure a physics write-up gets turned away. Safe, and barely used.",
      safetyScore: 88,
      fairnessScore: 55,
      legalComplianceScore: 90,
    },
  ],
};

const lesson3Concept2: ConceptStep = {
  id: "ai-agents-03-step-03",
  type: "concept",
  visual: {
    type: "diagram",
    data: {
      nodes: [
        { id: "who", label: "Who it serves", caption: "The actual reader" },
        { id: "what", label: "What done means", caption: "A checkable finish" },
        { id: "never", label: "What it never does", caption: "The hard limits" },
        { id: "unsure", label: "What to do when unsure", caption: "The fallback" },
      ],
      links: [
        { from: "who", to: "what" },
        { from: "what", to: "never" },
        { from: "never", to: "unsure", label: "the part everyone forgets" },
      ],
    },
  },
  title: "The Four Parts of a Brief",
  requiresCompletion: false,
  content:
    "Most briefs cover the first two and stop. The third — what it must never do — is what keeps an agent out of trouble, and the fourth is what stops it inventing something when it hits a case nobody anticipated. An agent with no stated fallback will improvise one, confidently, and you will find out about it later. Write the fallback. It is usually one sentence and it is the sentence that saves you.",
  examples: [
    {
      id: "no-fallback",
      title: "No fallback stated",
      description: "It improvises, plausibly, and you never find out.",
      input: "A student asks something outside maths entirely.",
      output: "It answers anyway, because helping is what it was told to do.",
    },
    {
      id: "fallback",
      title: "Fallback stated",
      description: "One sentence, and the case is handled forever.",
      input: "Same question.",
      output:
        "That is outside what I can help with — try asking your form tutor.",
    },
  ],
  misconception:
    "Rules about what an agent must not do are often left out for fear of making it unhelpful. In practice they make it more useful, because they let you trust it in situations you cannot supervise.",
};

const lesson3Activity2: PolicyCreatorActivityStep = {
  id: "ai-agents-03-step-04",
  type: "activity",
  interactiveType: "policy_creator",
  title: "Write the Never List",
  requiresCompletion: true,
  instructions:
    "Assemble the rules for the study agent. Some are non-negotiable, some are judgement calls, and one or two are the kind of rule that sounds responsible and does nothing.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "Those are rules an agent can actually follow, which is the only kind worth writing.",
    incorrect:
      "Ask of each one: could the agent tell whether it had broken this rule?",
  },
  minimumPolicies: 5,
  requiredPolicies: [
    "p-disclose",
    "p-no-final-answers",
    "p-escalate",
    "p-scope",
    "p-no-personal-data",
  ],
  categories: [
    {
      id: "cat-transparency",
      label: "Transparency",
      description: "What the student is told about what they are talking to.",
    },
    {
      id: "cat-oversight",
      label: "Oversight",
      description: "When a human has to be involved.",
    },
    {
      id: "cat-safety",
      label: "Safety",
      description: "The lines that do not move.",
    },
    {
      id: "cat-privacy",
      label: "Privacy",
      description: "What the agent should never collect or repeat.",
    },
  ],
  policyTiles: [
    {
      id: "p-disclose",
      label: "Always say it is an AI",
      description:
        "Identify as an AI study agent at the start of every session.",
      category: "transparency",
      required: true,
    },
    {
      id: "p-no-final-answers",
      label: "Never hand over the final answer",
      description:
        "Method and the next step only, regardless of how the request is worded.",
      category: "safety",
      required: true,
    },
    {
      id: "p-escalate",
      label: "Escalate wellbeing concerns to a human",
      description:
        "Stop, give the safeguarding contact, do not attempt to help directly.",
      category: "oversight",
      required: true,
    },
    {
      id: "p-scope",
      label: "Stay inside maths and science",
      description:
        "Decline other subjects and say where to go instead.",
      category: "safety",
      required: true,
    },
    {
      id: "p-no-personal-data",
      label: "Never ask for personal details",
      description:
        "No full names, addresses, schools or contact details, ever.",
      category: "privacy",
      required: true,
    },
    {
      id: "p-log-review",
      label: "Flag repeated identical questions for a teacher",
      description:
        "A student asking the same thing six times is a signal a human should see.",
      category: "oversight",
    },
    {
      id: "p-be-nice",
      label: "Always be helpful and respectful",
      description:
        "Sounds responsible, but the agent cannot tell whether it has broken it. Unenforceable.",
      category: "transparency",
    },
    {
      id: "p-be-accurate",
      label: "Never be wrong",
      description:
        "Not a policy. No system can guarantee this, so it provides no protection at all.",
      category: "safety",
    },
  ],
};

const lesson3Quiz: QuizStep = {
  id: "ai-agents-03-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Which part of an agent brief is most often left out, and most often causes trouble?",
  options: [
    {
      id: "a3q-a",
      label: "The tone of voice.",
      isCorrect: false,
      feedback: "Rarely omitted, and rarely the cause of a real problem.",
    },
    {
      id: "a3q-b",
      label: "What the agent should do when it hits a case nobody anticipated.",
      isCorrect: true,
      feedback:
        "Exactly. With no stated fallback it invents one, confidently, out of sight.",
    },
    {
      id: "a3q-c",
      label: "The name of the agent.",
      isCorrect: false,
      feedback: "Cosmetic.",
    },
    {
      id: "a3q-d",
      label: "The model it runs on.",
      isCorrect: false,
      feedback:
        "Matters for capability, but two agents on the same model still differ entirely by brief.",
    },
  ],
  explanation:
    "Who it serves and what done means are usually covered. What it must never do, and what to do when unsure, are the parts that determine how an agent behaves in exactly the situations you are not there to supervise.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson3Completion: CompletionStep = {
  id: "ai-agents-03-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "You are a helpful assistant is the null instruction — it decides nothing.",
    "A brief front-loads judgement calls you will not be present for.",
    "Four parts: who it serves, what done means, what it never does, what to do when unsure.",
    "A rule the agent cannot tell it has broken is not a rule.",
  ],
  xpReward: 32,
  completionMessage:
    "You can now write a brief that produces the same agent on Tuesday as it did on Monday.",
  nextLessonId: "ai-agents-04",
};

/*
 * ============================================================
 * LESSON 4 — CONTEXT, MEMORY & KNOWLEDGE
 * ============================================================
 */

const lesson4Intro: IntroStep = {
  id: "ai-agents-04-intro",
  type: "intro",
  title: "Context, Memory & Knowledge",
  subtitle: "Three different things that all feel like remembering.",
  content:
    "What an agent knows comes from three completely separate places, and confusing them is the source of most surprises. This lesson separates them: what the model absorbed in training, what is in front of it right now, and what it can go and fetch.",
  learningObjectives: [
    "Distinguish training knowledge, context and retrieved knowledge.",
    "Explain how retrieval finds the right note without keyword matching.",
    "Describe what a context window costs and why it is measured in tokens.",
  ],
  estimatedMinutes: 3,
};

const lesson4Concept1: ConceptStep = {
  id: "ai-agents-04-step-01",
  type: "concept",
  visual: {
    type: "diagram",
    data: {
      nodes: [
        {
          id: "training",
          label: "Training",
          caption: "Absorbed long ago, cannot be updated, has no citations",
        },
        {
          id: "context",
          label: "Context",
          caption: "In front of it right now, exact, and finite",
        },
        {
          id: "knowledge",
          label: "Knowledge base",
          caption: "Fetched on demand, yours, checkable",
        },
      ],
      links: [
        { from: "knowledge", to: "context", label: "retrieved into" },
        { from: "context", to: "training", label: "overrides" },
      ],
    },
  },
  title: "Three Kinds of Knowing",
  requiresCompletion: false,
  content:
    "Training knowledge is everything the model absorbed before it ever met you. It is broad, it is stale, and it cannot tell you where any of it came from. Context is what is in the conversation right now — exact, current, and strictly limited in size. A knowledge base is a set of documents you supply, which the agent searches and pulls the relevant piece of into context. The important consequence is that context beats training: if you paste your actual refund policy, the agent uses yours rather than the average refund policy of the internet.",
  examples: [
    {
      id: "training-knows",
      title: "From training",
      description: "Confident, general, unattributable, possibly out of date.",
      input: "What is a typical refund window?",
      output: "Usually 14 to 30 days. Source: unavailable.",
    },
    {
      id: "context-knows",
      title: "From context",
      description: "Yours, exact, and it will be used in preference.",
      input: "Our refund window is 45 days. What is our refund window?",
      output: "45 days.",
    },
  ],
  misconception:
    "An agent that has read your documents has not learned them. Nothing is added to the model. The document is fetched, dropped into context for that one run, and gone again afterwards.",
};

const lesson4Activity1: VectorSimilarityActivityStep = {
  id: "ai-agents-04-step-02",
  type: "activity",
  interactiveType: "vector_similarity",
  title: "How It Finds the Right Note",
  requiresCompletion: true,
  instructions:
    "Each dot is a note in the agent's knowledge base, placed by meaning rather than by wording. Find the pairs that sit close together and work out why retrieval finds them even when they share no words.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "That is why retrieval works on a question phrased in words the document never used.",
    incorrect:
      "Ignore the wording and look at what each note is about. Distance here is meaning, not spelling.",
  },
  similarityMetric: "cosine",
  points: [
    {
      id: "refund",
      label: "Refund policy",
      x: 20,
      y: 78,
      category: "policy",
      explanation: "A money-back policy note.",
    },
    {
      id: "money-back",
      label: "Money back",
      x: 26,
      y: 84,
      category: "policy",
      explanation:
        "Shares almost no words with the refund note, but sits right beside it — same meaning.",
    },
    {
      id: "shipping",
      label: "Delivery times",
      x: 74,
      y: 71,
      category: "logistics",
      explanation: "About getting things to you, not about money.",
    },
    {
      id: "delivery-late",
      label: "Parcel missing",
      x: 80,
      y: 66,
      category: "logistics",
      explanation: "Neighbouring the shipping note, far from the refund ones.",
    },
    {
      id: "password",
      label: "Password reset",
      x: 48,
      y: 18,
      category: "account",
      explanation:
        "Far from everything else — a different subject entirely.",
    },
    {
      id: "login",
      label: "Cannot sign in",
      x: 54,
      y: 24,
      category: "account",
      explanation:
        "Different words from the password note, same underlying problem.",
    },
  ],
  targetPairs: [
    {
      firstId: "refund",
      secondId: "money-back",
      expectedRelationship: "similar",
    },
    {
      firstId: "shipping",
      secondId: "delivery-late",
      expectedRelationship: "similar",
    },
    { firstId: "password", secondId: "login", expectedRelationship: "similar" },
    { firstId: "refund", secondId: "password", expectedRelationship: "different" },
  ],
};

const lesson4Activity2: TokenizerActivityStep = {
  id: "ai-agents-04-step-03",
  type: "activity",
  interactiveType: "tokenizer_playground",
  title: "The Context Budget",
  requiresCompletion: true,
  instructions:
    "Everything an agent is holding — its brief, the conversation so far, and every document it retrieved — is measured in these pieces. Type something and watch the budget being spent.",
  completion: {
    type: "required_actions",
    requiredActions: ["tokenize-custom-sentence"],
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Now the size limit makes sense. It is not a word count and it is not a memory — it is a fixed budget refilled every run.",
    incorrect:
      "Try a long document-style sentence and watch how fast the count climbs.",
  },
  showTokenIds: true,
  allowCustomInput: true,
  maxInputLength: 140,
  starterSentences: [
    "You are a support agent for a bicycle shop.",
    "Refunds are processed within 45 days of purchase.",
    "The customer asked about a delayed order placed last Tuesday.",
  ],
  tokenizationRules: [
    {
      id: "brief-cost",
      description:
        "The agent brief is spent every single run, before anything else.",
      example: "You are a support agent",
      resultingTokens: ["You", " are", " a", " support", " agent"],
    },
    {
      id: "history-cost",
      description:
        "Conversation history is re-sent each turn, so a long chat costs more every time.",
      example: "Earlier you said",
      resultingTokens: ["Earlier", " you", " said"],
    },
    {
      id: "retrieval-cost",
      description:
        "Each retrieved document lands in the same budget. Fetching five when one would do is expensive.",
      example: "Refunds are processed",
      resultingTokens: ["Ref", "unds", " are", " processed"],
    },
    {
      id: "overflow",
      description:
        "When the budget runs out, the oldest context is dropped — which is why long conversations start forgetting the beginning.",
      example: "forgotten",
      resultingTokens: ["forg", "otten"],
    },
  ],
  tokenVocabulary: [
    { token: "agent", tokenId: 8134, embeddingPreview: [0.61, 0.14, -0.2] },
    { token: "support", tokenId: 2291, embeddingPreview: [0.55, 0.19, -0.11] },
    { token: "Ref", tokenId: 6234, embeddingPreview: [0.12, -0.44, 0.37] },
    { token: "unds", tokenId: 8821, embeddingPreview: [0.09, -0.39, 0.31] },
    { token: "forg", tokenId: 4417, embeddingPreview: [-0.31, 0.22, 0.14] },
    { token: "otten", tokenId: 6690, embeddingPreview: [-0.28, 0.19, 0.09] },
  ],
};

const lesson4Concept2: ConceptStep = {
  id: "ai-agents-04-step-04",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Everything in context",
        body: "Paste all 60 documents into every run. Expensive, slow, and the relevant line gets lost among the rest.",
      },
      after: {
        label: "Retrieve the two that matter",
        body: "Search by meaning, pull the two closest documents into context, leave the other 58 on disk.",
      },
      transform: "Search first, then load",
    },
  },
  title: "Why Retrieval Beats Pasting Everything",
  requiresCompletion: false,
  content:
    "If the context budget were unlimited you would simply paste everything and be done. It is not, and even where it is nearly big enough, burying the one relevant sentence in sixty documents measurably degrades the answer. Retrieval is the compromise: keep everything on disk, search it by meaning at question time, and spend the budget only on what turned out to be relevant. The cost is that if retrieval fetches the wrong document, the agent answers confidently from the wrong document.",
  examples: [
    {
      id: "retrieval-hit",
      title: "Retrieval works",
      description: "The right note is fetched and the answer is grounded.",
      input: "How long do refunds take?",
      output: "45 days, quoting your policy.",
    },
    {
      id: "retrieval-miss",
      title: "Retrieval misses",
      description:
        "The wrong note is fetched, and nothing about the answer signals it.",
      input: "How long do returns take?",
      output: "Confidently quotes the shipping policy instead.",
    },
  ],
  misconception:
    "A retrieval miss does not look like an error. The agent gets a document, uses it properly, and produces a well-formed answer to a question you did not ask.",
};

const lesson4Quiz: QuizStep = {
  id: "ai-agents-04-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "You give an agent a document containing your refund policy. What has happened to the model?",
  options: [
    {
      id: "a4q-a",
      label: "It has learned the policy permanently.",
      isCorrect: false,
      feedback:
        "Nothing was added to the model. The document is fetched per run and then gone.",
    },
    {
      id: "a4q-b",
      label:
        "Nothing — the document is retrieved into context at question time and discarded after.",
      isCorrect: true,
      feedback:
        "Right. That is why it can quote your policy exactly and still know nothing about it in a fresh session without retrieval.",
    },
    {
      id: "a4q-c",
      label: "The model was retrained on the document overnight.",
      isCorrect: false,
      feedback: "Retraining is an enormous undertaking and is not what happens here.",
    },
    {
      id: "a4q-d",
      label: "The document replaced the model's training knowledge.",
      isCorrect: false,
      feedback:
        "It takes precedence within that run, but nothing is replaced.",
    },
  ],
  explanation:
    "Training knowledge, context and a knowledge base are three separate mechanisms. Supplying a document affects only what lands in context for that run — which is enough to change the answer, and not at all the same as the model learning it.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson4Completion: CompletionStep = {
  id: "ai-agents-04-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Training knowledge is broad, stale and unattributable; context is exact, current and finite.",
    "Retrieval finds notes by meaning, so it works on words the document never used.",
    "The context budget is spent by the brief, the history and every retrieved document.",
    "A retrieval miss produces a confident answer to the wrong question.",
  ],
  xpReward: 35,
  completionMessage:
    "You can now say exactly where any given piece of an agent's answer came from.",
  nextLessonId: "ai-agents-05",
};

/*
 * ============================================================
 * LESSON 5 — TOOLS: WEB SEARCH & FILE ANALYSIS
 * ============================================================
 */

const lesson5Intro: IntroStep = {
  id: "ai-agents-05-intro",
  type: "intro",
  title: "Tools: Web Search & File Analysis",
  subtitle: "What changes about an agent when you give it a capability.",
  content:
    "A tool is not a feature you switch on for completeness. Each one changes the class of question the agent can answer honestly, and each one introduces a way it can now be wrong that it could not be before.",
  learningObjectives: [
    "Explain what web search changes about the questions an agent can answer.",
    "Verify claims an agent has attributed to a source.",
    "Predict where a tool helps and where it introduces new failure.",
  ],
  estimatedMinutes: 3,
};

const lesson5Concept1: ConceptStep = {
  id: "ai-agents-05-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "No tools",
        points: [
          "Answers from training only",
          "Cannot know anything recent",
          "Cannot cite a source",
          "Fails silently on current facts",
        ],
      },
      right: {
        label: "With search",
        points: [
          "Can fetch something current",
          "Can attribute a claim",
          "Can notice it found nothing",
          "Can now cite the wrong thing",
        ],
      },
    },
  },
  title: "A Tool Changes the Class of Question",
  requiresCompletion: false,
  content:
    "Without search, every question about the present is answered from memory of the past, and nothing in the answer marks it as such. Add search and a whole category of question becomes honestly answerable — and a new failure appears, because the agent can now find a source that does not actually support the claim it goes on to make. Being able to cite is not the same as citing correctly.",
  examples: [
    {
      id: "no-tool",
      title: "Without search",
      description: "Answers from a snapshot, with no indication it is a snapshot.",
      input: "Who won the election?",
      output: "A confident answer about whichever election was most recent in training.",
    },
    {
      id: "with-tool",
      title: "With search",
      description: "Fetches something, and may fetch the wrong something.",
      input: "Same question.",
      output: "An answer with a link — which you should check actually says that.",
    },
  ],
  misconception:
    "A cited answer feels verified. It is not. The citation tells you what the agent looked at, not that the source supports the sentence attached to it.",
};

const lesson5Activity1: FactCheckerActivityStep = {
  id: "ai-agents-05-step-02",
  type: "activity",
  interactiveType: "fact_checker",
  title: "Check What It Cited",
  requiresCompletion: true,
  instructions:
    "An agent with web search produced this summary and attached sources. Flag every claim the sources do not actually support — including the ones where a real source is attached to a sentence it does not back.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "That is the discipline. A link next to a sentence is a claim about the link, and claims get checked.",
    incorrect:
      "Read the source summary, then read the sentence. Ask whether the first actually establishes the second.",
  },
  minimumFlagsRequired: 3,
  showSourceHints: true,
  document: {
    id: "agent-search-summary",
    title:
      "Agent task: summarise what happened to bike sales in the UK last year.",
    text: "UK bicycle sales fell by 12 percent last year, continuing a decline that began after the pandemic boom. The drop was steepest in the electric bike category, which fell 31 percent. Industry analysts attribute the decline primarily to the cost of living crisis. Independent bike shops were hit hardest, with over 400 closing during the year. The market is expected to recover in the second half of next year as interest rates fall.",
  },
  claims: [
    {
      id: "cl-fell",
      text: "UK bicycle sales fell by 12 percent last year.",
      status: "true",
      explanation:
        "Supported by the trade association report, which is the source attached and does say this.",
      sourceIds: ["src-trade"],
    },
    {
      id: "cl-ebike",
      text: "Electric bike sales fell 31 percent.",
      status: "misleading",
      explanation:
        "The source says e-bike sales fell 31 percent in one quarter, not across the year. The agent dropped the qualifier and the number changed meaning.",
      sourceIds: ["src-trade"],
    },
    {
      id: "cl-cost",
      text: "Analysts attribute the decline primarily to the cost of living crisis.",
      status: "unsupported",
      explanation:
        "The attached article mentions cost of living among four possible factors and does not rank them. Primarily was added by the agent.",
      sourceIds: ["src-news"],
    },
    {
      id: "cl-closures",
      text: "Over 400 independent bike shops closed during the year.",
      status: "fabricated",
      explanation:
        "No source contains this figure. It is the classic shape of a hallucination: a round, specific, plausible number.",
    },
    {
      id: "cl-recovery",
      text: "The market is expected to recover in the second half of next year.",
      status: "unsupported",
      explanation:
        "A forecast with no source attached at all. Note how naturally it reads at the end of a paragraph of sourced claims.",
    },
  ],
  sources: [
    {
      id: "src-trade",
      title: "Bicycle Association annual market report",
      sourceType: "primary",
      reliability: "high",
      summary:
        "Reports a 12 percent annual fall in unit sales. Notes a 31 percent fall in e-bike sales in Q3 specifically.",
    },
    {
      id: "src-news",
      title: "Trade press article on the retail downturn",
      sourceType: "secondary",
      reliability: "medium",
      summary:
        "Lists four contributing factors — cost of living, post-pandemic normalisation, warm weather, and stock overhang — without ranking them.",
    },
  ],
};

const lesson5Concept2: ConceptStep = {
  id: "ai-agents-05-step-03",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        { id: "need", label: "Notice it needs something", caption: "Or fail to" },
        { id: "query", label: "Choose a query", caption: "Where most misses start" },
        { id: "read", label: "Read what came back", caption: "Including the wrong thing" },
        { id: "use", label: "Use it", caption: "Correctly or otherwise" },
      ],
    },
  },
  title: "Four Places a Tool Call Goes Wrong",
  requiresCompletion: false,
  content:
    "Tool failures are usually blamed on the tool, and usually are not the tool's fault. The agent can fail to notice it needed to look anything up, in which case it answers from training and you get no signal at all. It can search for the wrong thing. It can misread what came back. Or it can read correctly and then overstate it, which is the failure in the exercise you just did. Only the third is really about the tool.",
  examples: [
    {
      id: "no-notice",
      title: "Did not notice it needed to look",
      description: "The most invisible failure — nothing indicates a lookup was skipped.",
      input: "What is our current pricing?",
      output: "An answer from training, about somebody else's pricing.",
    },
    {
      id: "overstated",
      title: "Read it right, then overstated it",
      description: "Source says among four factors; answer says primarily.",
      input: "Why did sales fall?",
      output: "A sourced-looking sentence the source does not support.",
    },
  ],
  misconception:
    "Giving an agent more tools does not straightforwardly make it more reliable. Each tool adds a capability and a new way to be confidently wrong.",
};

const lesson5Activity2: EdgeCaseMatrixActivityStep = {
  id: "ai-agents-05-step-04",
  type: "activity",
  interactiveType: "edge_case_matrix",
  title: "Which Tool, Which Task",
  requiresCompletion: true,
  instructions:
    "Four tasks, three agent configurations. Work out where each tool genuinely helps, where it does nothing, and where it introduces a risk that was not there before.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 7,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "You are matching the tool to what the task actually needs rather than switching everything on.",
    incorrect:
      "Ask what information the task requires, and whether the agent already has it.",
  },
  allowModelComparison: true,
  showResultsTable: true,
  cases: [
    {
      id: "tc-current",
      title: "What is the current price of this component?",
      description: "Needs information that changes weekly.",
      category: "data",
      expectedDifficulty: "high",
    },
    {
      id: "tc-summarise",
      title: "Summarise this 40-page PDF I uploaded",
      description: "Everything needed is in the file.",
      category: "language",
      expectedDifficulty: "medium",
    },
    {
      id: "tc-explain",
      title: "Explain how a derailleur works",
      description: "Stable general knowledge, unchanged for decades.",
      category: "reasoning",
      expectedDifficulty: "low",
    },
    {
      id: "tc-compare",
      title: "Does our returns policy contradict what our website says?",
      description: "Needs one internal document and one live page.",
      category: "context",
      expectedDifficulty: "high",
    },
  ],
  models: [
    {
      id: "bare",
      label: "No tools",
      description: "Training knowledge only.",
      trainingCoverage: 70,
      contextWindow: 8000,
    },
    {
      id: "search",
      label: "Web search",
      description: "Can query the live web and read results.",
      trainingCoverage: 70,
      contextWindow: 32000,
      specialization: "Current external information",
    },
    {
      id: "files",
      label: "File analysis",
      description: "Can read documents you have given it.",
      trainingCoverage: 70,
      contextWindow: 128000,
      specialization: "Your own documents",
    },
  ],
  expectedObservations: [
    {
      caseId: "tc-current",
      modelId: "bare",
      expectedBehavior:
        "Answers from a stale snapshot with no indication that it is stale.",
      expectedRisk: "high",
    },
    {
      caseId: "tc-current",
      modelId: "search",
      expectedBehavior: "Fetches a current price and can attribute it.",
      expectedRisk: "low",
    },
    {
      caseId: "tc-current",
      modelId: "files",
      expectedBehavior:
        "No relevant file, so it falls back to training — the tool does not help here.",
      expectedRisk: "high",
    },
    {
      caseId: "tc-summarise",
      modelId: "bare",
      expectedBehavior: "Cannot open the file at all.",
      expectedRisk: "high",
    },
    {
      caseId: "tc-summarise",
      modelId: "search",
      expectedBehavior:
        "Searches the web for the document, may find a different one and summarise that.",
      expectedRisk: "high",
    },
    {
      caseId: "tc-summarise",
      modelId: "files",
      expectedBehavior: "Reads the actual file and summarises it.",
      expectedRisk: "low",
    },
    {
      caseId: "tc-explain",
      modelId: "bare",
      expectedBehavior:
        "Answers well. This is exactly what training knowledge is for.",
      expectedRisk: "low",
    },
    {
      caseId: "tc-explain",
      modelId: "search",
      expectedBehavior:
        "Searches unnecessarily, spends time, and may pull in a worse explanation than it already had.",
      expectedRisk: "medium",
    },
    {
      caseId: "tc-explain",
      modelId: "files",
      expectedBehavior: "No relevant file; falls back to training and is fine.",
      expectedRisk: "low",
    },
    {
      caseId: "tc-compare",
      modelId: "bare",
      expectedBehavior: "Has access to neither document. Invents both.",
      expectedRisk: "high",
    },
    {
      caseId: "tc-compare",
      modelId: "search",
      expectedBehavior:
        "Gets the live page but not the internal policy — half the comparison, presented as whole.",
      expectedRisk: "high",
    },
    {
      caseId: "tc-compare",
      modelId: "files",
      expectedBehavior:
        "Gets the internal policy but not the live page. Also half, and this task genuinely needs both tools.",
      expectedRisk: "medium",
    },
  ],
};

const lesson5Quiz: QuizStep = {
  id: "ai-agents-05-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "An agent answers with a link attached. What does the link actually establish?",
  options: [
    {
      id: "a5q-a",
      label: "That the claim has been verified.",
      isCorrect: false,
      feedback:
        "It establishes nothing of the sort. Verification is still your job.",
    },
    {
      id: "a5q-b",
      label: "That the agent looked at that source — not that the source supports the claim.",
      isCorrect: true,
      feedback:
        "Right. Overstating what a real source says is one of the commonest tool failures.",
    },
    {
      id: "a5q-c",
      label: "That the source is reliable.",
      isCorrect: false,
      feedback:
        "The agent has no strong way to judge that, and did not claim to.",
    },
    {
      id: "a5q-d",
      label: "That the answer is current.",
      isCorrect: false,
      feedback: "The page may itself be years old.",
    },
  ],
  explanation:
    "A citation records what was consulted. Whether the sentence beside it is supported, overstated, or unrelated is a separate question, and one that has to be checked by reading the source.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson5Completion: CompletionStep = {
  id: "ai-agents-05-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Each tool changes the class of question an agent can answer honestly.",
    "Each tool also adds a new way for it to be confidently wrong.",
    "A citation says what was consulted, not that it supports the claim.",
    "The most invisible failure is not noticing a lookup was needed at all.",
  ],
  xpReward: 38,
  completionMessage:
    "You can now choose tools by what the task needs rather than switching everything on.",
  nextLessonId: "ai-agents-06",
};

/*
 * ============================================================
 * LESSON 6 — TESTING & IMPROVING AGENTS
 * ============================================================
 */

const lesson6Intro: IntroStep = {
  id: "ai-agents-06-intro",
  type: "intro",
  title: "Testing & Improving Agents",
  subtitle: "Working is not the same as good.",
  content:
    "An agent that returns a plausible answer to the three questions you happened to try is not a working agent. It is an untested one. This lesson is about building a test set that would actually catch a problem, and noticing when your tests are all the same test.",
  learningObjectives: [
    "Build a test set that covers more than the obvious cases.",
    "Spot when test coverage is skewed toward one kind of user.",
    "Compare agent performance across different groups of users.",
  ],
  estimatedMinutes: 3,
};

const lesson6Concept1: ConceptStep = {
  id: "ai-agents-06-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "How people test agents",
        body: "Ask it three things you already know the answer to. It gets them right. Ship it.",
      },
      after: {
        label: "What a test set looks like",
        body: "Twelve cases: the obvious ones, the awkward phrasings, the out-of-scope ones, the ones with no good answer, and two you expect it to fail.",
      },
      transform: "Test what you are afraid of, not what you are proud of",
    },
  },
  title: "Testing What You Are Afraid Of",
  requiresCompletion: false,
  content:
    "The instinct when testing something you built is to demonstrate that it works. That instinct produces a test set entirely made of cases you already knew it handled. A useful test set is uncomfortable to write, because every case in it is one you suspect might fail — the ambiguous question, the one that touches a policy edge, the one phrased the way a confused person would phrase it rather than the way you would.",
  examples: [
    {
      id: "demo-set",
      title: "A demonstration set",
      description: "Every case passes. You have learned nothing.",
      input: "Three clear questions squarely inside scope.",
      output: "Three good answers, no information.",
    },
    {
      id: "test-set",
      title: "A test set",
      description: "Some cases fail, which is the point.",
      input:
        "An ambiguous question, an out-of-scope one, and one with no good answer.",
      output: "Two failures you can now fix.",
    },
  ],
  misconception:
    "A test set that passes completely on the first run is usually evidence that the tests are too easy, not that the agent is finished.",
};

const lesson6Activity1: DatasetImbalanceActivityStep = {
  id: "ai-agents-06-step-02",
  type: "activity",
  interactiveType: "dataset_imbalance",
  title: "Whose Questions Did You Test?",
  requiresCompletion: true,
  instructions:
    "Here is the test set someone actually used for a support agent, broken down by the kind of user each question came from. Rebalance it and watch what happens to the failure rate they would have caught.",
  completion: {
    type: "required_actions",
    requiredActions: ["rebalance-distribution"],
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "The agent was never worse for those users. It was just never tested on them.",
    incorrect:
      "Move weight toward the groups with the low test counts and watch the caught-failure rate.",
  },
  allowRebalancing: true,
  showRecommendationRates: true,
  groups: [
    {
      id: "expert",
      label: "Precise",
      initialPercentage: 62,
      recommendationRate: 94,
      explanation:
        "Questions phrased the way the builder would phrase them. Heavily over-represented because they are the easiest to think of.",
    },
    {
      id: "vague",
      label: "Vague",
      initialPercentage: 18,
      recommendationRate: 61,
      explanation:
        "How most real users actually write. Under-tested, and where most failures live.",
    },
    {
      id: "nonnative",
      label: "Non-native",
      initialPercentage: 12,
      recommendationRate: 58,
      explanation:
        "Unusual word order and vocabulary. The agent handles these noticeably worse and nobody had checked.",
    },
    {
      id: "edge",
      label: "Policy edges",
      initialPercentage: 8,
      recommendationRate: 42,
      explanation:
        "The cases that cause real trouble, and the least represented in the test set.",
    },
  ],
  initialDistribution: { expert: 62, vague: 18, nonnative: 12, edge: 8 },
  targetDistribution: { expert: 25, vague: 30, nonnative: 20, edge: 25 },
  simulationResults: [
    {
      distribution: { expert: 62, vague: 18, nonnative: 12, edge: 8 },
      recommendationRates: { expert: 94, vague: 61, nonnative: 58, edge: 42 },
      disparityScore: 52,
      explanation:
        "The headline pass rate looks like 82 percent, because most of the test set is the easy group. Three quarters of real failures are invisible.",
    },
    {
      distribution: { expert: 40, vague: 25, nonnative: 20, edge: 15 },
      recommendationRates: { expert: 94, vague: 63, nonnative: 60, edge: 44 },
      disparityScore: 50,
      explanation:
        "Headline rate drops to 73 percent. Nothing about the agent changed — you are just measuring it honestly now.",
    },
    {
      distribution: { expert: 25, vague: 30, nonnative: 20, edge: 25 },
      recommendationRates: { expert: 94, vague: 62, nonnative: 59, edge: 43 },
      disparityScore: 51,
      explanation:
        "Headline rate 64 percent, and now the three weak groups are impossible to miss. This is the test set worth having.",
    },
  ],
};

const lesson6Concept2: ConceptStep = {
  id: "ai-agents-06-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "Same agent, pass rate by user group",
      bars: [
        { id: "g1", label: "Precise questions", value: 94, note: "Well tested" },
        { id: "g2", label: "Vague questions", value: 61, note: "Barely tested" },
        { id: "g3", label: "Non-native phrasing", value: 58, note: "Barely tested" },
        { id: "g4", label: "Policy edges", value: 42, note: "Hardly tested" },
      ],
    },
  },
  title: "One Average Hides Four Answers",
  requiresCompletion: false,
  content:
    "An overall pass rate is a weighted average, and the weights come from your test set rather than from reality. Report a single number and you have hidden the fact that the agent works beautifully for people who write like you and poorly for everybody else. The fix is not a better average. It is refusing to look at the average without also looking at the breakdown.",
  examples: [
    {
      id: "average",
      title: "The average",
      description: "One number, and it is the wrong number.",
      input: "82 percent pass rate.",
      output: "Sounds fine. Conceals a 42 percent group.",
    },
    {
      id: "breakdown",
      title: "The breakdown",
      description: "Four numbers, and now you know what to fix first.",
      input: "94 / 61 / 58 / 42 by group.",
      output: "An obvious priority.",
    },
  ],
  misconception:
    "Improving the average is not the same as improving the agent. You can raise the average by testing the easy group more, which makes the report better and the agent no different.",
};

const lesson6Activity2: FairnessMetricsActivityStep = {
  id: "ai-agents-06-step-04",
  type: "activity",
  interactiveType: "fairness_metrics",
  title: "Read the Breakdown",
  requiresCompletion: true,
  instructions:
    "The same agent measured three different ways. Switch between the metrics and see how the picture of who it serves well changes depending on what you decided to measure.",
  completion: {
    type: "required_actions",
    requiredActions: ["compare-metrics"],
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "No metric is the true one. Choosing which to optimise is a decision you make, not one the data makes for you.",
    incorrect:
      "Switch metrics and watch which group looks worst under each. They disagree.",
  },
  showTradeoffs: true,
  initialMetric: "overall-pass",
  targetMetric: "worst-group",
  groups: [
    {
      id: "precise",
      label: "Precise",
      sampleCount: 124,
      approvalRate: 94,
      representationRate: 62,
      truePositiveRate: 96,
    },
    {
      id: "vague",
      label: "Vague",
      sampleCount: 36,
      approvalRate: 61,
      representationRate: 18,
      truePositiveRate: 64,
    },
    {
      id: "nonnative",
      label: "Non-native",
      sampleCount: 24,
      approvalRate: 58,
      representationRate: 12,
      truePositiveRate: 60,
    },
    {
      id: "edge",
      label: "Edges",
      sampleCount: 16,
      approvalRate: 42,
      representationRate: 8,
      truePositiveRate: 45,
    },
  ],
  metrics: [
    {
      id: "overall-pass",
      label: "Overall pass rate",
      description:
        "One weighted average across every test. The number everyone quotes.",
      formula: "passed / total",
    },
    {
      id: "worst-group",
      label: "Worst group pass rate",
      description:
        "The pass rate of whichever group does worst. Harsh, and much harder to game.",
      formula: "min(pass rate per group)",
    },
    {
      id: "spread",
      label: "Spread between groups",
      description:
        "The gap between best and worst. Measures consistency rather than quality.",
      formula: "max - min",
    },
  ],
  configurations: [
    {
      id: "cfg-overall",
      metricId: "overall-pass",
      settings: { threshold: 80 },
      groupResults: { precise: 94, vague: 61, nonnative: 58, edge: 42 },
      tradeoffs: [
        "Passes at 82 percent overall.",
        "Can be improved by adding more easy tests, which changes nothing real.",
      ],
      explanation:
        "The friendliest metric and the least informative. It rewards a skewed test set.",
    },
    {
      id: "cfg-worst",
      metricId: "worst-group",
      settings: { threshold: 70 },
      groupResults: { precise: 94, vague: 61, nonnative: 58, edge: 42 },
      tradeoffs: [
        "Fails at 42 percent.",
        "Cannot be gamed by adding easy tests.",
        "May over-weight a group with only 16 samples.",
      ],
      explanation:
        "Forces attention onto the worst-served group. The honest default for something people rely on.",
    },
    {
      id: "cfg-spread",
      metricId: "spread",
      settings: { threshold: 20 },
      groupResults: { precise: 94, vague: 61, nonnative: 58, edge: 42 },
      tradeoffs: [
        "A 52-point spread fails badly.",
        "Would also be satisfied by making the good group worse, which helps nobody.",
      ],
      explanation:
        "Useful alongside another metric, dangerous alone — consistency at a low level is still a low level.",
    },
  ],
};

const lesson6Quiz: QuizStep = {
  id: "ai-agents-06-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Your agent's overall pass rate rises from 82 to 88 percent after you add twenty more test cases. What should you check first?",
  options: [
    {
      id: "a6q-a",
      label: "Nothing — the agent improved.",
      isCorrect: false,
      feedback:
        "The agent may not have changed at all. Only the measurement did.",
    },
    {
      id: "a6q-b",
      label:
        "Whether the new cases were mostly easy ones, which would raise the average without changing the agent.",
      isCorrect: true,
      feedback:
        "Exactly. An average is weighted by your test set, so the test set can move it on its own.",
    },
    {
      id: "a6q-c",
      label: "Whether the model version changed.",
      isCorrect: false,
      feedback:
        "Worth knowing, but the composition of the new tests is the more immediate explanation.",
    },
    {
      id: "a6q-d",
      label: "Whether the tests ran in a different order.",
      isCorrect: false,
      feedback: "Order does not affect a pass rate.",
    },
  ],
  explanation:
    "Adding tests changes the weights in the average. A rising overall number with an unchanged per-group breakdown means the test set got easier, not that the agent got better.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson6Completion: CompletionStep = {
  id: "ai-agents-06-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Test what you are afraid of, not what you are proud of.",
    "A test set that passes entirely is usually too easy.",
    "One average hides the groups your agent serves badly.",
    "Improving the average is not the same as improving the agent.",
  ],
  xpReward: 40,
  completionMessage:
    "You can now tell whether an agent is good, rather than whether it is working.",
  nextLessonId: "ai-agents-07",
};

/*
 * ============================================================
 * LESSON 7 — BUILD YOUR FIRST AGENT
 * ============================================================
 */

const lesson7Intro: IntroStep = {
  id: "ai-agents-07-intro",
  type: "intro",
  title: "Build Your First Agent",
  subtitle: "Everything from the last six lessons, on one real build.",
  content:
    "This is the build. You will walk a complete agent from a blank brief through knowledge, instructions, testing and guardrails, making the real decisions at each stage. Then you go and do it again in Agent Builder, with your own idea.",
  learningObjectives: [
    "Take an agent from goal to deployable through every stage.",
    "Choose knowledge sources, write a brief, and set guardrails.",
    "Judge your own agent honestly before releasing it.",
  ],
  estimatedMinutes: 5,
};

const lesson7Concept1: ConceptStep = {
  id: "ai-agents-07-step-01",
  type: "concept",
  visual: {
    type: "timeline",
    data: {
      milestones: [
        {
          id: "s1",
          when: "First",
          label: "Goal",
          caption: "What done looks like, checkably",
        },
        {
          id: "s2",
          when: "Then",
          label: "Knowledge",
          caption: "What it needs that the model lacks",
        },
        {
          id: "s3",
          when: "Then",
          label: "Brief",
          caption: "Who, what, never, and when unsure",
        },
        {
          id: "s4",
          when: "Then",
          label: "Test",
          caption: "The cases you are afraid of",
        },
        {
          id: "s5",
          when: "Last",
          label: "Guardrails",
          caption: "What it may do without asking",
        },
      ],
    },
  },
  title: "The Order Matters",
  requiresCompletion: false,
  content:
    "People build agents in the wrong order almost every time. They start with the brief, because writing the brief feels like building, and then discover halfway through that they never settled what done means. Settle the goal first and everything downstream gets easier — the brief writes itself, the knowledge you need becomes obvious, and the test cases fall out of the goal directly.",
  examples: [
    {
      id: "wrong-order",
      title: "Brief first",
      description: "Two hours of tuning wording against an undefined target.",
      input: "Start by writing You are a helpful...",
      output: "A polished brief for an agent nobody specified.",
    },
    {
      id: "right-order",
      title: "Goal first",
      description: "Ten minutes on the goal saves the two hours.",
      input: "Start by writing Done means...",
      output: "A brief that took fifteen minutes and works.",
    },
  ],
  misconception:
    "Guardrails feel like a final polish step. They are, but only because they depend on the other four — you cannot say what an agent may do unsupervised until you know what it is for.",
};

const lesson7Activity1: CapstoneActivityStep = {
  id: "ai-agents-07-step-02",
  type: "activity",
  interactiveType: "capstone_pipeline",
  title: "Build It, Stage by Stage",
  requiresCompletion: true,
  instructions:
    "A real brief from a real kind of organisation. Work through each stage, making the actual decisions. Your choices are scored at the end on accuracy, fairness, safety and how it feels to use.",
  completion: {
    type: "target_score",
    targetScore: 75,
    allowPartialCredit: true,
    maxAttempts: 3,
  },
  feedback: {
    correct:
      "That is a defensible agent. You made the trade-offs deliberately rather than by default.",
    incorrect:
      "Check the stage that scored lowest — usually the brief or the guardrails.",
    completion:
      "You have now done the whole loop once. The next one is yours.",
  },
  scenario: {
    id: "library-agent",
    organization: "Fairbourne Public Library",
    title: "An agent that helps people find what to read next",
    description:
      "The library wants an agent on its website that suggests books based on what someone has enjoyed before, and tells them whether it is currently on the shelf.",
    systemName: "Shelf",
    systemPurpose:
      "Recommend books from the library catalogue and report availability.",
    risks: [
      "Recommending books the library does not hold.",
      "Inventing availability rather than checking it.",
      "Recommending age-inappropriate material to a child.",
      "Retaining what individuals have been reading.",
    ],
    stakeholders: [
      "Library members, including children",
      "Library staff who will field the complaints",
      "The council, which funds the service",
    ],
  },
  stages: [
    {
      id: "stage-knowledge",
      stage: "data_selection",
      title: "Choose the knowledge",
      description:
        "Decide what Shelf can read. Everything else it will have to invent.",
      required: true,
      xpReward: 40,
    },
    {
      id: "stage-brief",
      stage: "prompt_engineering",
      title: "Write the brief",
      description:
        "Who it serves, what done means, what it never does, and what to do when unsure.",
      required: true,
      xpReward: 50,
    },
    {
      id: "stage-test",
      stage: "error_audit",
      title: "Run the test set",
      description:
        "Six real exchanges. Decide what to do about each one.",
      required: true,
      xpReward: 50,
    },
    {
      id: "stage-guardrails",
      stage: "responsible_deployment",
      title: "Set the guardrails",
      description: "What Shelf may do without a human looking.",
      required: true,
      xpReward: 40,
    },
    {
      id: "stage-signoff",
      stage: "final_signoff",
      title: "Sign it off",
      description: "Say plainly whether you would put your name on this.",
      required: true,
      xpReward: 20,
    },
  ],
  datasets: [
    {
      id: "ds-catalogue",
      name: "The library catalogue",
      description:
        "Every title held, with age rating, shelf location and live availability.",
      sourceType: "verified",
      quality: "high",
      balanced: true,
      containsSensitiveData: false,
      recommended: true,
      explanation:
        "Non-negotiable. Without it Shelf recommends books the library does not have, which is the single worst failure available to it.",
    },
    {
      id: "ds-reviews",
      name: "Staff review notes",
      description:
        "Short recommendations written by librarians over several years.",
      sourceType: "primary",
      quality: "high",
      balanced: false,
      containsSensitiveData: false,
      recommended: true,
      explanation:
        "Genuinely useful and better than generic blurbs. Slightly skewed toward staff taste, which is worth knowing but not disqualifying.",
    },
    {
      id: "ds-borrowing",
      name: "Individual borrowing histories",
      description: "Who borrowed what, by member number.",
      sourceType: "primary",
      quality: "high",
      balanced: true,
      containsSensitiveData: true,
      recommended: false,
      explanation:
        "Would make recommendations better and is exactly the thing a library must not feed into a chatbot. What people read is nobody else's business.",
    },
    {
      id: "ds-forum",
      name: "A scraped book forum",
      description: "Thousands of opinions of unknown provenance.",
      sourceType: "forum",
      quality: "low",
      balanced: false,
      containsSensitiveData: false,
      recommended: false,
      explanation:
        "Large, free, and full of confident nonsense. Volume is not quality.",
    },
  ],
  promptConfig: {
    systemPromptRequirements: [
      {
        id: "req-scope",
        label: "State the scope",
        description:
          "Shelf recommends from this library's catalogue and nothing else.",
        required: true,
      },
      {
        id: "req-availability",
        label: "Never guess availability",
        description:
          "If the catalogue lookup fails, say so rather than estimating.",
        required: true,
      },
      {
        id: "req-age",
        label: "Respect age ratings",
        description:
          "Ask who is reading before recommending anything rated above 12.",
        required: true,
      },
      {
        id: "req-fallback",
        label: "Say what to do when unsure",
        description:
          "Point at a human librarian rather than improvising.",
        required: true,
      },
      {
        id: "req-tone",
        label: "Sound like a librarian, not a shop",
        description: "No urgency, no upselling, no manufactured enthusiasm.",
        required: false,
      },
    ],
    temperatureOptions: [0, 0.3, 0.7, 1],
    recommendedTemperature: 0.7,
    requiredPromptElements: [
      "scope",
      "availability-honesty",
      "age-check",
      "fallback-to-human",
    ],
    forbiddenBehaviors: [
      "Recommending titles not in the catalogue",
      "Stating availability without checking",
      "Asking for a member number or any personal detail",
      "Continuing a conversation about anything other than books",
    ],
    outputFormatOptions: [
      "Three suggestions with one line each",
      "A single suggestion with reasoning",
      "A table of title, author and availability",
    ],
  },
  auditCases: [
    {
      id: "au-1",
      userMessage: "I loved Piranesi. What should I read next?",
      aiResponse:
        "If you liked Piranesi, try The Starless Sea by Erin Morgenstern — it is on the shelf now in Fiction. Also worth a look: Jonathan Strange & Mr Norrell, same author, currently out but due back Friday.",
      issue: "safe",
      severity: "low",
      correctAction: "approve",
      explanation:
        "In scope, checked against the catalogue, honest about availability. This is what good looks like.",
    },
    {
      id: "au-2",
      userMessage: "Got anything like Piranesi but shorter?",
      aiResponse:
        "You might enjoy The Ocean at the End of the Lane by Neil Gaiman. It is a quick read and we have three copies.",
      issue: "hallucination",
      severity: "high",
      correctAction: "regenerate",
      explanation:
        "The book is real and the recommendation is reasonable — but the library holds one copy, not three. It invented the number rather than reading it.",
    },
    {
      id: "au-3",
      userMessage: "My daughter is 8 and loves scary stories.",
      aiResponse:
        "She might like House of Leaves — it is a modern classic of horror.",
      issue: "unsafe_advice",
      severity: "high",
      correctAction: "block",
      explanation:
        "Rated well above 12 and genuinely unsuitable. The age rule exists precisely for this exchange.",
    },
    {
      id: "au-4",
      userMessage: "What has my son been borrowing?",
      aiResponse:
        "I cannot look up borrowing history. A librarian at the desk can help with account questions.",
      issue: "safe",
      severity: "low",
      correctAction: "approve",
      explanation:
        "The correct refusal, and it points at a human instead of stopping dead.",
    },
    {
      id: "au-5",
      userMessage: "Is the new Sally Rooney in?",
      aiResponse:
        "It should be available — those usually are.",
      issue: "missing_context",
      severity: "medium",
      correctAction: "regenerate",
      explanation:
        "Should be and usually are mean it did not check. The brief said never guess availability.",
    },
    {
      id: "au-6",
      userMessage: "Can you help me write my history essay?",
      aiResponse:
        "That is outside what I can help with — I only do book recommendations. The reference desk upstairs might be able to point you at sources though.",
      issue: "safe",
      severity: "low",
      correctAction: "approve",
      explanation:
        "Declines cleanly and still leaves the person better off. This is the fallback working.",
    },
  ],
  fairnessTests: [
    {
      id: "ft-1",
      group: "Adult readers, confident phrasing",
      query: "Looking for literary fiction in translation, ideally Japanese.",
      expectedOutcome: "Three in-catalogue suggestions with availability.",
      observedOutcome: "Three in-catalogue suggestions with availability.",
      disparityDetected: false,
    },
    {
      id: "ft-2",
      group: "Children asking directly",
      ageRange: "8-11",
      query: "i want a funny book",
      expectedOutcome:
        "Age-appropriate suggestions after establishing who is reading.",
      observedOutcome:
        "Suggested age-appropriate titles but did not ask who was reading first.",
      disparityDetected: true,
      recommendedAdjustment:
        "Trigger the age check on informal phrasing too, not only when an adult mentions a child.",
    },
    {
      id: "ft-3",
      group: "Non-native English speakers",
      language: "English as a second language",
      query: "book easy word for learn english, story good",
      expectedOutcome:
        "Graded readers and accessible fiction from the catalogue.",
      observedOutcome:
        "Suggested three literary novels well above the implied reading level.",
      disparityDetected: true,
      recommendedAdjustment:
        "Read the phrasing as a signal about reading level, and confirm rather than assume.",
    },
    {
      id: "ft-4",
      group: "Readers who name no preferences",
      query: "dunno, something good",
      expectedOutcome: "Asks one clarifying question, then suggests.",
      observedOutcome: "Asks one clarifying question, then suggests.",
      disparityDetected: false,
    },
  ],
  deploymentPolicies: [
    {
      id: "dp-disclose",
      label: "Say it is an AI",
      description: "Identify itself on first message, every session.",
      category: "disclosure",
      required: true,
      consequenceIfMissing:
        "People take a recommendation as a librarian's judgement when it is not.",
    },
    {
      id: "dp-no-personal",
      label: "Never request personal details",
      description: "No names, member numbers, addresses or ages beyond a band.",
      category: "privacy",
      required: true,
      consequenceIfMissing:
        "A public web chat starts collecting identifiable data about what children read.",
    },
    {
      id: "dp-no-history",
      label: "No access to borrowing history",
      description: "The agent cannot read individual lending records at all.",
      category: "data_governance",
      required: true,
      consequenceIfMissing:
        "One prompt injection away from disclosing somebody's reading history.",
    },
    {
      id: "dp-human",
      label: "A visible route to a librarian",
      description: "Every refusal ends with where to go instead.",
      category: "human_oversight",
      required: true,
      consequenceIfMissing:
        "Refusals become dead ends and people stop using the service.",
    },
    {
      id: "dp-age",
      label: "Age check before mature titles",
      description: "Establish who is reading before suggesting above rating 12.",
      category: "safety",
      required: true,
      consequenceIfMissing:
        "The House of Leaves exchange happens, in public, on a library website.",
    },
  ],
  scoring: {
    categories: [
      {
        id: "accuracy",
        label: "Accuracy",
        description:
          "Recommends real, held titles and reports availability honestly.",
        weight: 30,
        maxScore: 100,
      },
      {
        id: "fairness",
        label: "Fairness",
        description:
          "Works as well for a child or a learner as for a confident adult.",
        weight: 25,
        maxScore: 100,
      },
      {
        id: "safety",
        label: "Safety",
        description: "Age ratings respected, no personal data collected.",
        weight: 30,
        maxScore: 100,
      },
      {
        id: "userExperience",
        label: "Experience",
        description:
          "Refusals leave people better off; the tone suits a library.",
        weight: 15,
        maxScore: 100,
      },
    ],
    minimumOverallScore: 75,
    minimumCategoryScores: { safety: 80 },
    weighting: { accuracy: 30, fairness: 25, safety: 30, userExperience: 15 },
  },
  finalSignoff: {
    required: true,
    confirmationText:
      "I would be comfortable with this agent running on a public library website, used by children, without me watching it.",
    checklist: [
      {
        id: "sc-catalogue",
        label: "It only recommends titles the library holds",
        description: "Catalogue is connected and availability is read, not guessed.",
        required: true,
      },
      {
        id: "sc-age",
        label: "The age check fires on informal phrasing too",
        description: "Not only when an adult explicitly mentions a child.",
        required: true,
      },
      {
        id: "sc-privacy",
        label: "It collects nothing about individuals",
        description: "No borrowing history, no member numbers, no names.",
        required: true,
      },
      {
        id: "sc-human",
        label: "Every refusal points somewhere useful",
        description: "A person is always the next step.",
        required: true,
      },
      {
        id: "sc-tested",
        label: "It was tested on the awkward cases",
        description:
          "Vague phrasing, non-native phrasing, and out-of-scope requests.",
        required: true,
      },
    ],
    successMessage:
      "Signed off. You built an agent you can defend, which is a higher bar than one that works.",
    failureMessage:
      "Not yet. Go back to whichever checklist item you could not honestly tick — that is the real state of the build.",
  },
};

const lesson7Activity2: AiSorterActivityStep = {
  id: "ai-agents-07-step-03",
  type: "activity",
  interactiveType: "ai_sorter",
  title: "Ready or Not",
  requiresCompletion: true,
  instructions:
    "Six decisions someone made while building an agent. Sort them by whether they are ready to ship or need another pass. You are about to make these decisions yourself.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "That is the judgement you will need in the next ten minutes.",
    incorrect:
      "Ask what happens the first time somebody uses it in a way you did not picture.",
  },
  allowRetry: true,
  buckets: [
    {
      id: "ready",
      label: "Ready to ship",
      description: "Defensible as it stands.",
    },
    {
      id: "another-pass",
      label: "Needs another pass",
      description: "Will cause a problem you can already predict.",
    },
  ],
  cards: [
    {
      id: "s-1",
      title: "Done means every item has a tag, and the agent can check.",
      description: "The goal.",
      correctBucketId: "ready",
      explanation:
        "Checkable finish. The loop can close, which is the whole requirement.",
    },
    {
      id: "s-2",
      title: "Brief says: you are a helpful and friendly assistant.",
      description: "The brief.",
      correctBucketId: "another-pass",
      explanation:
        "The null instruction. It decides nothing, so every awkward case gets decided at random.",
    },
    {
      id: "s-3",
      title: "Tested on twelve cases, four of which it failed.",
      description: "The test set.",
      correctBucketId: "ready",
      explanation:
        "Four failures is a test set doing its job. Now you know what to fix — that is progress, not a problem.",
    },
    {
      id: "s-4",
      title: "Tested on three cases, all of which passed.",
      description: "The test set.",
      correctBucketId: "another-pass",
      explanation:
        "A demonstration, not a test. Three passes tells you nothing you did not already assume.",
    },
    {
      id: "s-5",
      title: "It can send emails on my behalf without confirming.",
      description: "The guardrails.",
      correctBucketId: "another-pass",
      explanation:
        "Irreversible and unsupervised. Drafting is fine; sending needs a human.",
    },
    {
      id: "s-6",
      title: "When it cannot answer, it says so and names a person to ask.",
      description: "The fallback.",
      correctBucketId: "ready",
      explanation:
        "A stated fallback that leaves the user better off. This is the sentence that saves you.",
    },
  ],
};

const lesson7Quiz: QuizStep = {
  id: "ai-agents-07-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "What should you settle first when building an agent?",
  options: [
    {
      id: "a7q-a",
      label: "The system prompt wording.",
      isCorrect: false,
      feedback:
        "It feels like building, but you are tuning against an undefined target.",
    },
    {
      id: "a7q-b",
      label: "What done looks like, in a way the agent can check.",
      isCorrect: true,
      feedback:
        "Right. The brief, the knowledge and the test cases all fall out of the goal.",
    },
    {
      id: "a7q-c",
      label: "Which model to use.",
      isCorrect: false,
      feedback:
        "Rarely the binding constraint, and easy to change later.",
    },
    {
      id: "a7q-d",
      label: "The name and the avatar.",
      isCorrect: false,
      feedback: "Genuinely last.",
    },
  ],
  explanation:
    "Settle the goal first, in checkable terms. Everything downstream — what knowledge it needs, what the brief says, what the tests are — is derived from it, and building in any other order means redoing the work.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson7Completion: CompletionStep = {
  id: "ai-agents-07-completion",
  type: "completion",
  title: "Course Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Settle the goal first — everything else derives from it.",
    "The brief decides the cases you will not be there to supervise.",
    "Test what you are afraid of; a test set that fully passes is too easy.",
    "Guardrails are about what it may do unsupervised, not about capability.",
  ],
  xpReward: 60,
  completionMessage:
    "You finished AI Agents & Automation. You have taken one agent through every stage — now do it with an idea of your own.",
  mission: {
    target: "agent_builder",
    headline: "your mission",
    description:
      "Open Agent Builder and make a real one. Start with what done looks like, then the knowledge it needs, then the brief. Give it a fallback sentence before you give it a name. You have already done this once.",
    label: "Open Agent Builder",
  },
};

/*
 * ============================================================
 * LESSON OBJECTS
 * ============================================================
 */

export const aiAgentsLessons: Lesson[] = [
  {
    id: "ai-agents-01",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 1,
    title: "What Is an AI Agent?",
    description:
      "The real distinction: an agent has a goal and can act, rather than having a turn and an answer.",
    track: "AI Agents",
    conceptIds: ["agent-goal-not-question", "agent-loop"],
    challengeIds: ["how-much-latitude", "question-into-goal"],
    prerequisites: [],
    totalXp: 100,
    estimatedMinutes: 22,
    learningObjectives: [
      "State the actual difference between an agent and a chatbot.",
      "Explain why a goal produces different behaviour than a question.",
      "Recognise how much latitude an agent has been given.",
    ],
    keyTakeaways: [
      "An agent has a goal and can act; a chatbot has a turn and can answer.",
      "It is usually the same model underneath.",
      "Most bad agents are bad at the definition of finished.",
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
    id: "ai-agents-02",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 2,
    title: "Agents vs. Chatbots",
    description:
      "One task run both ways. Who holds the goal, who joins the steps up, and when an agent is the wrong tool.",
    track: "AI Agents",
    conceptIds: ["who-runs-the-loop", "what-gets-cheaper"],
    challengeIds: ["when-is-an-agent-worth-it", "chatbot-or-agent"],
    prerequisites: ["ai-agents-01"],
    totalXp: 120,
    estimatedMinutes: 24,
    learningObjectives: [
      "Trace a multi-step task through both a chatbot and an agent.",
      "Identify which steps a chatbot pushes back onto you.",
      "Recognise tasks where an agent is the wrong tool.",
    ],
    keyTakeaways: [
      "With a chatbot you are the loop.",
      "An agent does more total work; your share shrinks.",
      "Agents suit multi-step tasks with a checkable finish.",
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
    id: "ai-agents-03",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 3,
    title: "Instructions & Goals",
    description:
      "Why the system prompt is the agent. Balancing priorities, and writing rules an agent can actually follow.",
    track: "AI Agents",
    conceptIds: ["what-a-brief-decides", "four-parts-of-a-brief"],
    challengeIds: ["balance-the-brief", "write-the-never-list"],
    prerequisites: ["ai-agents-02"],
    totalXp: 130,
    estimatedMinutes: 25,
    learningObjectives: [
      "Explain what a system prompt determines that the model alone does not.",
      "Balance competing priorities in a set of instructions.",
      "Write enforceable rules about what an agent must never do.",
    ],
    keyTakeaways: [
      "You are a helpful assistant decides nothing.",
      "A brief front-loads judgement calls you will not be present for.",
      "A rule the agent cannot tell it has broken is not a rule.",
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
    id: "ai-agents-04",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 4,
    title: "Context, Memory & Knowledge",
    description:
      "Three separate mechanisms that all feel like remembering, and why confusing them causes surprises.",
    track: "AI Agents",
    conceptIds: ["three-kinds-of-knowing", "retrieval-vs-pasting"],
    challengeIds: ["finding-the-right-note", "the-context-budget"],
    prerequisites: ["ai-agents-03"],
    totalXp: 140,
    estimatedMinutes: 26,
    learningObjectives: [
      "Distinguish training knowledge, context and retrieved knowledge.",
      "Explain how retrieval finds a note without keyword matching.",
      "Describe what the context budget is spent on.",
    ],
    keyTakeaways: [
      "Context beats training within a run, but nothing is learned.",
      "Retrieval works by meaning, not by wording.",
      "A retrieval miss produces a confident answer to the wrong question.",
    ],
    steps: [
      lesson4Intro,
      lesson4Concept1,
      lesson4Activity1,
      lesson4Activity2,
      lesson4Concept2,
      lesson4Quiz,
      lesson4Completion,
    ],
    passingScore: 80,
  },
  {
    id: "ai-agents-05",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 5,
    title: "Tools: Web Search & File Analysis",
    description:
      "What giving an agent a capability actually changes — including the new ways it can now be wrong.",
    track: "AI Agents",
    conceptIds: ["tools-change-the-class", "four-tool-failures"],
    challengeIds: ["check-what-it-cited", "which-tool-which-task"],
    prerequisites: ["ai-agents-04"],
    totalXp: 150,
    estimatedMinutes: 26,
    learningObjectives: [
      "Explain what web search changes about answerable questions.",
      "Verify claims an agent has attributed to a source.",
      "Predict where a tool helps and where it adds risk.",
    ],
    keyTakeaways: [
      "Each tool adds a capability and a new failure mode.",
      "A citation says what was consulted, not that it supports the claim.",
      "The most invisible failure is not noticing a lookup was needed.",
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
    id: "ai-agents-06",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 6,
    title: "Testing & Improving Agents",
    description:
      "How to tell if an agent is actually good rather than merely working, and why one average hides four answers.",
    track: "AI Agents",
    conceptIds: ["test-what-you-fear", "average-hides-groups"],
    challengeIds: ["whose-questions", "read-the-breakdown"],
    prerequisites: ["ai-agents-05"],
    totalXp: 160,
    estimatedMinutes: 27,
    learningObjectives: [
      "Build a test set that covers more than the obvious cases.",
      "Spot skewed test coverage.",
      "Compare agent performance across groups rather than in aggregate.",
    ],
    keyTakeaways: [
      "Test what you are afraid of, not what you are proud of.",
      "A test set that fully passes is usually too easy.",
      "Improving the average is not improving the agent.",
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
    id: "ai-agents-07",
    courseId: "ai-agents",
    courseTitle: "AI Agents & Automation",
    number: 7,
    title: "Build Your First Agent",
    description:
      "The capstone. Take an agent from goal to sign-off through every stage, then build your own in Agent Builder.",
    track: "AI Agents",
    conceptIds: ["build-order"],
    challengeIds: ["build-it-stage-by-stage", "ready-or-not"],
    prerequisites: [
      "ai-agents-01",
      "ai-agents-02",
      "ai-agents-03",
      "ai-agents-04",
      "ai-agents-05",
      "ai-agents-06",
    ],
    totalXp: 300,
    estimatedMinutes: 35,
    isCapstone: true,
    learningObjectives: [
      "Take an agent from goal to deployable through every stage.",
      "Choose knowledge sources, write a brief, and set guardrails.",
      "Judge your own agent honestly before releasing it.",
    ],
    keyTakeaways: [
      "Settle the goal first; everything else derives from it.",
      "Guardrails are about what it may do unsupervised.",
      "Sign-off means you would defend it running without you.",
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

export const aiAgentsCurriculum: Curriculum = {
  id: "ai-agents",
  name: "AI Agents & Automation",
  description:
    "What an agent actually is, how instructions and memory and tools change what it can do, how to tell whether yours is any good — ending with a real build in Agent Builder.",
  concepts: [],
  lessons: aiAgentsLessons,
  challenges: [],
  totalXp: aiAgentsLessons.reduce(
    (total, lesson) => total + lesson.totalXp,
    0,
  ),
};

export default aiAgentsLessons;
