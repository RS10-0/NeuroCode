import type { Curriculum } from "./Curriculum";
import type {
  AiSorterActivityStep,
  BiasAuditActivityStep,
  CompletionStep,
  ConceptStep,
  DatasetPlaygroundActivityStep,
  DecisionTreeActivityStep,
  EdgeCaseMatrixActivityStep,
  FactCheckerActivityStep,
  IntroStep,
  Lesson,
  ModelTestingActivityStep,
  NextTokenActivityStep,
  ParameterTuningActivityStep,
  PromptRefinementActivityStep,
  PromptWeaverActivityStep,
  QuizStep,
  TokenizerActivityStep,
} from "./Lesson";

/*
 * ============================================================
 * PROMPT ENGINEERING & AI COMMUNICATION
 * ============================================================
 *
 * Six lessons on why instructions change what a model does.
 *
 * Not a list of prompts to copy. A learner who finishes this
 * should be able to look at a disappointing answer and say what
 * about the request produced it — which is the only skill that
 * survives the next model release.
 *
 * Interactive types are assigned by the planner in
 * interactionPlan.ts, not chosen here.
 * scripts/verify-interaction-plan.mts holds this file to that
 * assignment.
 */

/*
 * ============================================================
 * LESSON 1 — WHAT MAKES A GOOD PROMPT?
 * ============================================================
 */

const lesson1Intro: IntroStep = {
  id: "prompt-engineering-01-intro",
  type: "intro",
  title: "Start here",
  subtitle:
    "Six lessons on why the same model gives one person a useful answer and another person mush.",
  content:
    "You have already noticed that asking an AI the same thing two different ways gets you two different qualities of answer. That is not luck and it is not the model having a bad day. This course is about what actually changes between those two requests, so you can produce the good one on purpose.",
  learningObjectives: [
    "Predict how a model will respond to a vague request before you send it.",
    "Explain why a specific request produces a different kind of answer, not just a longer one.",
    "Spot the parts of an answer the model invented to fill a gap you left.",
  ],
  estimatedMinutes: 2,
};

const lesson1Concept1: ConceptStep = {
  id: "prompt-engineering-01-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "A vague request",
        points: [
          "The model guesses who is asking",
          "It guesses what you already know",
          "It guesses how long you want",
          "Every guess is the safest average",
        ],
      },
      right: {
        label: "A specific request",
        points: [
          "You said who is asking",
          "You said what to assume",
          "You said how long",
          "Nothing is left to the average",
        ],
      },
    },
  },
  title: "Vague In, Average Out",
  requiresCompletion: false,
  content:
    "A model answering a vague question is not being unhelpful. It is answering the most likely version of the question, which is the version an average person would have meant. Ask it to tell you about dogs and it writes the encyclopedia opening, because that is what most people asking that sentence turn out to want. The blandness is not a flaw in the model. It is the model correctly handling a request that did not say enough to be handled any other way.",
  examples: [
    {
      id: "vague-request",
      title: "What you sent",
      description: "Nothing here says who is reading or what for.",
      input: "Write about climate change.",
      output: "A five-paragraph general overview, no angle, no audience.",
    },
    {
      id: "specific-request",
      title: "What you meant",
      description: "The same subject, with the gaps closed.",
      input:
        "Explain to a 14-year-old why sea level rise is uneven around the world. Three short paragraphs, no jargon.",
      output: "A focused explanation of one mechanism, pitched to a reader.",
    },
  ],
  misconception:
    "Adding words is not the same as adding specificity. A long rambling request with no audience, no purpose and no format is still a vague request, and it will still get the average answer.",
};

const lesson1Activity1: NextTokenActivityStep = {
  id: "prompt-engineering-01-step-02",
  type: "activity",
  interactiveType: "next_token_game",
  title: "Predict the Continuation",
  requiresCompletion: true,
  instructions:
    "For each prompt, pick the word you think the model is most likely to produce next. You are not guessing what would be best — you are guessing what is most probable given what the prompt actually said.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 2,
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "That is the instinct worth building. A prompt is a bet about what comes next, and you can feel where a vague one is going before you send it.",
    incorrect:
      "Read only what the prompt actually says, not what you hoped it said. The model has nothing else to go on.",
  },
  showProbabilities: true,
  prompts: [
    {
      id: "p1",
      prompt: "Tell me about dogs. Dogs are",
      correctTokenId: "p1-a",
      explanation:
        "With no audience and no angle, the model falls back to the most common opening in everything it has ever read about dogs — the general-encyclopedia register.",
      predictions: [
        {
          id: "p1-a",
          token: " a",
          probability: 0.52,
          isCorrect: true,
          feedback:
            "As in a domesticated mammal. The default definition opening.",
        },
        {
          id: "p1-b",
          token: " expensive",
          probability: 0.04,
          feedback:
            "Possible, but only if the prompt had signalled you cared about cost. It did not.",
        },
        {
          id: "p1-c",
          token: " terrible",
          probability: 0.01,
          feedback:
            "The model has no reason to take a position you did not ask for.",
        },
      ],
    },
    {
      id: "p2",
      prompt:
        "I am a vet explaining to a nervous first-time owner why their puppy is not eating. Puppies usually stop eating because",
      correctTokenId: "p2-b",
      explanation:
        "The prompt named a speaker, a listener, and a worry. The likely continuation moved from definition to reassurance and cause — a different kind of sentence, not just a longer one.",
      predictions: [
        {
          id: "p2-a",
          token: " they",
          probability: 0.19,
          feedback:
            "Plausible grammar, but it skips the reassurance the framing set up.",
        },
        {
          id: "p2-b",
          token: " of",
          probability: 0.44,
          isCorrect: true,
          feedback:
            "As in because of a change in routine — the model goes straight to causes, because the prompt established that a cause is what the listener needs.",
        },
        {
          id: "p2-c",
          token: " dogs",
          probability: 0.02,
          feedback:
            "This is the vague-prompt continuation. The specific framing has moved the model off it.",
        },
      ],
    },
    {
      id: "p3",
      prompt: "Summarise this in one sentence. The report",
      correctTokenId: "p3-c",
      explanation:
        "A format instruction changes the shape of the very next word. One sentence pushes the model straight into the summary rather than into a preamble about what it is about to do.",
      predictions: [
        {
          id: "p3-a",
          token: " is",
          probability: 0.21,
          feedback:
            "Reasonable, but it tends to open a description of the report rather than a summary of it.",
        },
        {
          id: "p3-b",
          token: " that",
          probability: 0.06,
          feedback: "Grammatically awkward as a summary opening.",
        },
        {
          id: "p3-c",
          token: " finds",
          probability: 0.38,
          isCorrect: true,
          feedback:
            "Straight into the finding. The length constraint left no room for a run-up.",
        },
      ],
    },
  ],
};

const lesson1Concept2: ConceptStep = {
  id: "prompt-engineering-01-step-03",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Gaps left open",
        body: "Write a summary of our team meeting.",
      },
      after: {
        label: "Gaps closed",
        body: "Summarise these meeting notes for someone who missed the meeting. Lead with decisions, then owners, then anything still open. Under 120 words.",
      },
      transform: "Name the reader, the priority, and the limit",
    },
  },
  title: "What the Model Does With a Gap",
  requiresCompletion: false,
  content:
    "Every gap you leave gets filled. That is worth sitting with, because it means an unstated assumption does not produce a blank — it produces a confident invention that reads exactly like the parts you did specify. If you do not say who the summary is for, the model picks someone. If you do not say what matters most, it decides. Those decisions are invisible in the output, which is what makes them dangerous.",
  examples: [
    {
      id: "gap-audience",
      title: "Unstated audience",
      description:
        "The model picks a reader, usually a general adult one, and pitches everything at them.",
      input: "Explain how our pricing works.",
      output: "A neutral explainer aimed at nobody in particular.",
    },
    {
      id: "gap-priority",
      title: "Unstated priority",
      description:
        "With no steer on what matters, order comes from the source material rather than from you.",
      input: "Summarise this thread.",
      output: "A summary that leads with whatever was said first.",
    },
  ],
  misconception:
    "A model does not tell you which parts of its answer came from your instructions and which came from its own guesses. Both are written in the same confident voice.",
};

const lesson1Activity2: FactCheckerActivityStep = {
  id: "prompt-engineering-01-step-04",
  type: "activity",
  interactiveType: "fact_checker",
  title: "What Did It Fill In?",
  requiresCompletion: true,
  instructions:
    "A student asked for a short profile of their school and got the text below. Flag every claim the model could not possibly have known — the places where a gap in the request became an invention in the answer.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 3,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "That is the whole skill in miniature. Nothing in the answer is marked as invented, so the only defence is knowing what you actually told it.",
    incorrect:
      "Go back to the request. If the prompt did not contain a fact, and the fact is not general knowledge, the model produced it to fill a gap.",
  },
  minimumFlagsRequired: 3,
  document: {
    id: "school-profile",
    title: "Prompt: Write a short profile of my school, Northgate High.",
    text: "Northgate High School is a public secondary school serving around 1,200 students. Founded in 1963, it is known locally for its strong music programme and its championship-winning debate team. The school moved to its current campus on Willow Road in 1998, and its motto, Learn and Lead, is displayed above the main entrance. Students consistently score above the state average in mathematics.",
  },
  claims: [
    {
      id: "c-name",
      text: "The school is called Northgate High School.",
      status: "true",
      explanation:
        "This one came from you. It is the only fact in the paragraph the model was actually given.",
    },
    {
      id: "c-enrolment",
      text: "It serves around 1,200 students.",
      status: "fabricated",
      explanation:
        "You never said how big the school is. Twelve hundred is a plausible-sounding number for a secondary school, which is exactly why it is so easy to read straight past.",
    },
    {
      id: "c-founded",
      text: "It was founded in 1963.",
      status: "fabricated",
      explanation:
        "Invented. A specific year reads as researched, but nothing in the request could have supplied it.",
    },
    {
      id: "c-music",
      text: "It is known for its music programme and debate team.",
      status: "fabricated",
      explanation:
        "Invented, and invented flatteringly. Models fill gaps with the most typical version of the thing, and the typical school profile mentions a strong programme.",
    },
    {
      id: "c-campus",
      text: "It moved to a campus on Willow Road in 1998.",
      status: "fabricated",
      explanation:
        "A street name and a date, neither of which existed anywhere in your request.",
    },
    {
      id: "c-motto",
      text: "Its motto is Learn and Lead.",
      status: "fabricated",
      explanation:
        "Invented. Note how the specific detail about it being above the entrance makes it feel observed rather than generated.",
    },
    {
      id: "c-scores",
      text: "Students score above the state average in mathematics.",
      status: "unsupported",
      explanation:
        "This might even be true, but nothing in the exchange establishes it. Unverifiable and unasked-for is still a problem.",
    },
  ],
  sources: [
    {
      id: "s-prompt",
      title: "The request you actually sent",
      sourceType: "primary",
      reliability: "high",
      summary:
        "Contains one fact: the name of the school. Everything beyond it was supplied by the model.",
    },
    {
      id: "s-general",
      title: "General knowledge about secondary schools",
      sourceType: "reference",
      reliability: "medium",
      summary:
        "Supports the shape of the claims — schools do have enrolments, mottos and founding years — but supports none of the specific values.",
    },
  ],
};

const lesson1Quiz: QuizStep = {
  id: "prompt-engineering-01-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why does a vague prompt tend to produce a bland answer?",
  options: [
    {
      id: "l1q-a",
      label: "The model works less hard on short prompts.",
      isCorrect: false,
      feedback:
        "Effort is not a thing a model has. The same computation runs either way.",
    },
    {
      id: "l1q-b",
      label:
        "With nothing specified, the most probable continuation is the most average one.",
      isCorrect: true,
      feedback:
        "Exactly. Blandness is the correct answer to a question that did not narrow anything down.",
    },
    {
      id: "l1q-c",
      label: "Short prompts are truncated before the model sees them.",
      isCorrect: false,
      feedback: "Nothing truncates your prompt. It arrives intact.",
    },
    {
      id: "l1q-d",
      label: "The model saves its better answers for paying users.",
      isCorrect: false,
      feedback:
        "Response quality tracks the request, not the account.",
    },
  ],
  explanation:
    "A model produces likely continuations. When a request leaves the audience, purpose and format unstated, the likeliest continuation is the one that would suit the largest number of people who might have sent it — which is another way of saying the one that suits nobody in particular.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson1Completion: CompletionStep = {
  id: "prompt-engineering-01-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "A vague request gets the average answer, and the average answer is correct behaviour.",
    "Every gap you leave is filled by the model, silently and confidently.",
    "Specificity changes the kind of answer you get, not just its length.",
    "Invented detail is written in the same voice as the parts you supplied.",
  ],
  xpReward: 25,
  completionMessage:
    "You can now look at a request and predict roughly what it will produce — before you send it.",
  nextLessonId: "prompt-engineering-02",
};

/*
 * ============================================================
 * LESSON 2 — CONTEXT & SPECIFICITY
 * ============================================================
 */

const lesson2Intro: IntroStep = {
  id: "prompt-engineering-02-intro",
  type: "intro",
  title: "Context & Specificity",
  subtitle: "The same question, asked three ways.",
  content:
    "Last lesson was about gaps. This one is about what fills them well. You are going to take a single request and add context to it in stages, and watch the answer change category rather than just get longer.",
  learningObjectives: [
    "Distinguish context that changes the answer from context that only pads the request.",
    "Predict which kind of answer a given level of context will produce.",
    "Recognise the point where more context stops helping.",
  ],
  estimatedMinutes: 3,
};

const lesson2Concept1: ConceptStep = {
  id: "prompt-engineering-02-step-01",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        {
          id: "bare",
          label: "Bare request",
          caption: "How do I get better at chess?",
        },
        {
          id: "who",
          label: "+ who is asking",
          caption: "I am rated 800 and lose most games in the middlegame.",
        },
        {
          id: "why",
          label: "+ what it is for",
          caption: "I want to beat my brother, who is around 1100.",
        },
        {
          id: "limits",
          label: "+ what is possible",
          caption: "I have twenty minutes a day and no coach.",
        },
      ],
    },
  },
  title: "Three Levels of Context",
  requiresCompletion: false,
  content:
    "Context is not background. Context is the set of facts that make some answers wrong. A bare request has no wrong answers, so it gets the generic one. Say you are rated 800 and half the standard advice becomes inapplicable. Say you have twenty minutes a day and half of what remains becomes impossible. Each fact you add is a filter, and the answer that survives all the filters is the one you actually wanted.",
  examples: [
    {
      id: "level-0",
      title: "No context",
      description: "Nothing rules anything out.",
      input: "How do I get better at chess?",
      output: "Study openings, do tactics puzzles, review your games.",
    },
    {
      id: "level-3",
      title: "Three facts of context",
      description:
        "Rating, opponent, and available time each eliminate whole categories of advice.",
      input:
        "I am rated 800, I lose in the middlegame, and I have twenty minutes a day.",
      output:
        "Skip openings entirely. Twenty minutes of tactics puzzles, because at 800 most games are decided by a hanging piece.",
    },
  ],
  misconception:
    "More context is not automatically better context. A paragraph about how much you love chess adds words without eliminating a single possible answer, so it changes nothing.",
};

const lesson2Activity1: ModelTestingActivityStep = {
  id: "prompt-engineering-02-step-02",
  type: "activity",
  interactiveType: "model_testing",
  title: "Same Question, Three Contexts",
  requiresCompletion: true,
  instructions:
    "Each row is the same underlying question asked with a different amount of context. Predict which category of answer it will produce, then check yourself against what the model actually did.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 4,
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "You are reading the request rather than the topic — which is the difference between guessing and predicting.",
    incorrect:
      "Ask what each added fact rules out. If it rules nothing out, it will not move the answer.",
  },
  minimumTestsRequired: 4,
  showPerCategoryAccuracy: true,
  trainingSummary: {
    trainingItemCount: 6,
    categories: ["generic", "targeted", "actionable"],
    trainingAccuracy: 84,
    knownLimitations: [
      "Context that adds feeling rather than constraint does not change the answer category.",
      "Past a point, extra context competes with itself and the answer gets vaguer again.",
    ],
  },
  testItems: [
    {
      id: "t1",
      input: "How do I get better at chess?",
      expectedCategory: "generic",
      modelPrediction: "generic",
      confidence: 0.93,
      explanation:
        "No constraints, so every standard piece of advice is equally valid and you get all of them.",
    },
    {
      id: "t2",
      input: "How do I get better at chess? I really love the game.",
      expectedCategory: "generic",
      modelPrediction: "generic",
      confidence: 0.81,
      explanation:
        "Enthusiasm is not a constraint. It rules out no advice, so the answer does not move.",
    },
    {
      id: "t3",
      input: "I am rated 800. How do I get better at chess?",
      expectedCategory: "targeted",
      modelPrediction: "targeted",
      confidence: 0.88,
      explanation:
        "A rating eliminates the advice meant for stronger players. The answer narrows to fundamentals.",
    },
    {
      id: "t4",
      input:
        "I am rated 800 and I keep losing in the middlegame. How do I improve?",
      expectedCategory: "targeted",
      modelPrediction: "actionable",
      confidence: 0.62,
      explanation:
        "A genuine near-miss. Naming the failure point pushed it most of the way to a concrete plan, but without a time budget it still hedges across several options.",
    },
    {
      id: "t5",
      input:
        "I am rated 800, I lose in the middlegame, and I have twenty minutes a day. What should I do?",
      expectedCategory: "actionable",
      modelPrediction: "actionable",
      confidence: 0.91,
      explanation:
        "Three constraints leave roughly one sensible answer, so that is the answer you get.",
    },
    {
      id: "t6",
      input:
        "I am rated 800, I lose in the middlegame, I have twenty minutes a day, I prefer aggressive play, I own three books, my brother is 1100, I play mostly on my phone, and I once drew against a 1400. What should I do?",
      expectedCategory: "actionable",
      modelPrediction: "generic",
      confidence: 0.44,
      explanation:
        "The instructive failure. Eight facts do not filter eight times harder — they compete, and the model hedges back toward general advice because no single answer satisfies all of them.",
    },
  ],
};

const lesson2Concept2: ConceptStep = {
  id: "prompt-engineering-02-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "How useful the answer was, by amount of context added",
      bars: [
        { id: "none", label: "No context", value: 22, note: "Generic" },
        { id: "one", label: "One fact", value: 54, note: "Narrowed" },
        { id: "three", label: "Three facts", value: 91, note: "Actionable" },
        {
          id: "eight",
          label: "Eight facts",
          value: 47,
          note: "Hedging again",
        },
      ],
    },
  },
  title: "Where Context Stops Helping",
  requiresCompletion: false,
  content:
    "The curve bends. The first few facts eliminate whole regions of possible answers and the response sharpens fast. Past that, added facts start pulling against each other — you prefer aggressive play but you have twenty minutes, you own books but you are on your phone — and the model has no way to know which one you meant to be decisive. So it hedges, and you are back to a general answer, this time buried in caveats. The fix is not fewer facts. It is saying which fact wins.",
  examples: [
    {
      id: "competing",
      title: "Facts that compete",
      description:
        "Both are true, they point at different answers, and nothing says which matters more.",
      input: "I prefer aggressive openings but I only have twenty minutes.",
      output: "An answer that tries to serve both and commits to neither.",
    },
    {
      id: "ranked",
      title: "Facts, ranked",
      description: "One line of precedence collapses it back to a real answer.",
      input:
        "I prefer aggressive openings but I only have twenty minutes. If they conflict, protect the twenty minutes.",
      output: "A single plan that fits the time budget.",
    },
  ],
  misconception:
    "When an answer comes back hedged and full of it depends, the instinct is to add more detail. Usually the opposite is needed: say which of the details you already gave is the one that decides.",
};

const lesson2Activity2: EdgeCaseMatrixActivityStep = {
  id: "prompt-engineering-02-step-04",
  type: "activity",
  interactiveType: "edge_case_matrix",
  title: "Where Context Runs Out",
  requiresCompletion: true,
  instructions:
    "Four requests, two assistants with different amounts of the surrounding situation. Work out where the thin-context assistant will go wrong, and where extra context stops rescuing it.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 5,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "You are separating what the model cannot know from what it merely was not told. Those need different fixes.",
    incorrect:
      "Check whether the missing piece is knowable at all. Some gaps context can close and some it cannot.",
  },
  allowModelComparison: true,
  cases: [
    {
      id: "e1",
      title: "Reply to this email",
      description:
        "The email is pasted in, but nothing says what your relationship to the sender is.",
      category: "context",
      expectedDifficulty: "medium",
    },
    {
      id: "e2",
      title: "Is this a good price?",
      description:
        "A price is given with no currency, no market and no date.",
      category: "data",
      expectedDifficulty: "high",
    },
    {
      id: "e3",
      title: "Summarise the attached notes",
      description:
        "The notes are complete and self-contained. Nothing outside them is needed.",
      category: "language",
      expectedDifficulty: "low",
    },
    {
      id: "e4",
      title: "Should I take the job?",
      description:
        "A decision that depends on things the asker has not said and may not have articulated.",
      category: "reasoning",
      expectedDifficulty: "high",
    },
  ],
  models: [
    {
      id: "thin",
      label: "Request only",
      description:
        "Gets exactly what was typed and nothing else about the situation.",
      trainingCoverage: 100,
      contextWindow: 2000,
      specialization: "No surrounding situation",
    },
    {
      id: "rich",
      label: "Request plus situation",
      description:
        "Also gets who the asker is, what they are trying to achieve, and what they have already ruled out.",
      trainingCoverage: 100,
      contextWindow: 32000,
      specialization: "Full surrounding situation",
    },
  ],
  expectedObservations: [
    {
      caseId: "e1",
      modelId: "thin",
      expectedBehavior:
        "Picks a register at random — usually over-formal — and may misread a joke as a complaint.",
      expectedRisk: "medium",
    },
    {
      caseId: "e1",
      modelId: "rich",
      expectedBehavior:
        "Matches tone to the relationship and answers the thing actually being asked.",
      expectedRisk: "low",
    },
    {
      caseId: "e2",
      modelId: "thin",
      expectedBehavior:
        "Assumes a currency and a market, then evaluates confidently against the assumption.",
      expectedRisk: "high",
    },
    {
      caseId: "e2",
      modelId: "rich",
      expectedBehavior:
        "Still cannot know today's market, but now says so instead of inventing a benchmark.",
      expectedRisk: "medium",
    },
    {
      caseId: "e3",
      modelId: "thin",
      expectedBehavior:
        "Summarises accurately. Everything needed was in the request.",
      expectedRisk: "low",
    },
    {
      caseId: "e3",
      modelId: "rich",
      expectedBehavior:
        "Same summary. Extra context adds nothing when the task is self-contained.",
      expectedRisk: "low",
    },
    {
      caseId: "e4",
      modelId: "thin",
      expectedBehavior:
        "Produces a generic pros-and-cons list that would fit any job and any person.",
      expectedRisk: "medium",
    },
    {
      caseId: "e4",
      modelId: "rich",
      expectedBehavior:
        "Narrows to the real tension, but cannot supply the values the decision turns on — those are the asker's.",
      expectedRisk: "medium",
    },
  ],
};

const lesson2Quiz: QuizStep = {
  id: "prompt-engineering-02-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "You add six facts to a request and the answer gets vaguer, not sharper. What is the most likely cause?",
  options: [
    {
      id: "l2q-a",
      label: "The prompt exceeded the model's context window.",
      isCorrect: false,
      feedback:
        "Six facts is nowhere near a context limit. Something else is going on.",
    },
    {
      id: "l2q-b",
      label:
        "The facts point toward different answers and nothing says which one decides.",
      isCorrect: true,
      feedback:
        "Right. Competing constraints make the model hedge. The fix is precedence, not more detail.",
    },
    {
      id: "l2q-c",
      label: "Models always perform worse on longer prompts.",
      isCorrect: false,
      feedback:
        "Length itself is not the problem — plenty of long prompts produce sharp answers.",
    },
    {
      id: "l2q-d",
      label: "Facts have to be given in order of importance.",
      isCorrect: false,
      feedback:
        "Order helps a little, but stating which constraint wins helps far more.",
    },
  ],
  explanation:
    "Context works by ruling answers out. Facts that rule out different things leave the model with no single surviving answer, so it retreats to something that partially satisfies everything. Saying which constraint is decisive collapses the ambiguity.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson2Completion: CompletionStep = {
  id: "prompt-engineering-02-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Context works by ruling answers out — a fact that rules nothing out changes nothing.",
    "The first two or three facts do most of the work.",
    "Too many competing facts make a model hedge back toward generic.",
    "When an answer hedges, add precedence rather than detail.",
  ],
  xpReward: 30,
  completionMessage:
    "You can now tell useful context from padding, and spot the point where adding more starts to hurt.",
  nextLessonId: "prompt-engineering-03",
};

/*
 * ============================================================
 * LESSON 3 — CONSTRAINTS & OUTPUT FORMATS
 * ============================================================
 */

const lesson3Intro: IntroStep = {
  id: "prompt-engineering-03-intro",
  type: "intro",
  title: "Constraints & Output Formats",
  subtitle: "Asking for a shape is a design decision, not a formality.",
  content:
    "Asking for a table instead of paragraphs is not a cosmetic preference. It forces the model to commit to a set of comparable fields, which changes what it has to work out before it can write anything. This lesson is about using format as a thinking tool.",
  learningObjectives: [
    "Explain why a format constraint changes the content, not just the presentation.",
    "Understand what a length limit actually costs in tokens.",
    "Choose a format from the shape of the request rather than by habit.",
  ],
  estimatedMinutes: 3,
};

const lesson3Concept1: ConceptStep = {
  id: "prompt-engineering-03-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Asked for prose",
        points: [
          "Can stay vague about gaps",
          "Compares things loosely",
          "Hides which facts are missing",
          "Easy to skim past a weak claim",
        ],
      },
      right: {
        label: "Asked for a table",
        points: [
          "Every cell must be filled",
          "Forces the same fields for each row",
          "Empty cells become visible",
          "A weak claim has nowhere to hide",
        ],
      },
    },
  },
  title: "A Format Is a Constraint on Thinking",
  requiresCompletion: false,
  content:
    "Ask for three options in prose and you can get three paragraphs that never quite compare the same things. Ask for the same three options as a table with columns for cost, time and risk, and the model has to produce nine specific values. It cannot describe the first option's cost and the second option's vibe. The format did not tidy the answer — it changed what counted as a complete one.",
  examples: [
    {
      id: "format-prose",
      title: "Prose",
      description:
        "Comparison by adjective. Sounds thorough, compares nothing consistently.",
      input: "Compare three project management tools.",
      output:
        "Tool A is popular and flexible. Tool B is powerful. Tool C is simple and affordable.",
    },
    {
      id: "format-table",
      title: "Table",
      description:
        "The same request, forced into commensurable fields.",
      input:
        "Compare three project management tools. Table with columns: price per user, setup time, best-suited team size.",
      output:
        "Nine cells, each one a claim you can check or challenge.",
    },
  ],
  misconception:
    "Formatting instructions are often treated as the last thing you add to a prompt. They are frequently the thing that does the most work, because they decide what the model is obliged to figure out.",
};

const lesson3Activity1: TokenizerActivityStep = {
  id: "prompt-engineering-03-step-02",
  type: "activity",
  interactiveType: "tokenizer_playground",
  title: "What a Length Limit Actually Buys",
  requiresCompletion: true,
  instructions:
    "Type a sentence and watch it split into tokens. When you tell a model under 50 words, this is the budget you are setting — and it is not counted in words.",
  completion: {
    type: "required_actions",
    requiredActions: ["tokenize-custom-sentence"],
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "That is why word limits behave oddly. The model is budgeting in these pieces, not in the words you counted.",
    incorrect:
      "Try a sentence with a long or unusual word in it and watch where it breaks.",
  },
  showTokenIds: true,
  allowCustomInput: true,
  maxInputLength: 140,
  starterSentences: [
    "Summarise this in under fifty words.",
    "Be concise.",
    "Write an unambiguously comprehensive overview.",
    "Keep it short and use plain language.",
  ],
  tokenizationRules: [
    {
      id: "common-word",
      description:
        "A common word is usually a single token, including the space before it.",
      example: "short",
      resultingTokens: ["short"],
    },
    {
      id: "long-word",
      description:
        "A long or uncommon word is split into pieces, so it costs several tokens.",
      example: "unambiguously",
      resultingTokens: ["un", "ambig", "uously"],
    },
    {
      id: "punctuation",
      description:
        "Punctuation is usually its own token, which is why lists cost more than they look.",
      example: "short, clear.",
      resultingTokens: ["short", ",", " clear", "."],
    },
    {
      id: "instruction-cost",
      description:
        "Your instructions are tokens too. A long preamble spends part of the same budget as the answer.",
      example: "Be concise.",
      resultingTokens: ["Be", " concise", "."],
    },
  ],
  tokenVocabulary: [
    { token: "short", tokenId: 3245, embeddingPreview: [0.41, -0.12, 0.63] },
    { token: "concise", tokenId: 9182, embeddingPreview: [0.44, -0.09, 0.61] },
    { token: "un", tokenId: 479, embeddingPreview: [-0.22, 0.31, 0.08] },
    { token: "ambig", tokenId: 21451, embeddingPreview: [0.13, 0.52, -0.3] },
    { token: "uously", tokenId: 8834, embeddingPreview: [0.05, 0.27, -0.11] },
    { token: "plain", tokenId: 6621, embeddingPreview: [0.38, 0.02, 0.44] },
  ],
};

const lesson3Concept2: ConceptStep = {
  id: "prompt-engineering-03-step-03",
  type: "concept",
  visual: {
    type: "diagram",
    data: {
      nodes: [
        {
          id: "shape",
          label: "What shape is the answer?",
          caption: "One thing, several things, or a sequence",
        },
        {
          id: "compare",
          label: "Do the things need comparing?",
          caption: "If yes, the fields must match",
        },
        {
          id: "format",
          label: "The format falls out",
          caption: "Table, list, or prose",
        },
      ],
      links: [
        { from: "shape", to: "compare", label: "several" },
        { from: "compare", to: "format", label: "decides" },
      ],
    },
  },
  title: "Choosing a Format on Purpose",
  requiresCompletion: false,
  content:
    "You can derive the right format from the request instead of picking one out of habit. If the answer is one thing explained, prose is right and a table would be silly. If it is several things that need weighing against each other, a table forces the comparison to be real. If it is a sequence where order matters, a numbered list carries information that a paragraph would bury. Tone works the same way: asking for plain language for a nervous beginner is a constraint on vocabulary, and it changes which explanation the model reaches for.",
  examples: [
    {
      id: "shape-one",
      title: "One thing, explained",
      description: "Prose. A table here would fragment a single idea.",
      input: "Why does bread need salt?",
      output: "Two connected paragraphs.",
    },
    {
      id: "shape-sequence",
      title: "A sequence where order matters",
      description:
        "Numbered steps. The numbering is the content, not decoration.",
      input: "How do I set up a new laptop for work?",
      output: "Eight ordered steps, each one doable before the next.",
    },
  ],
  misconception:
    "Bullet points are not automatically clearer. Turning a causal explanation into bullets strips out the because, which is usually the part that was doing the explaining.",
};

const lesson3Activity2: DecisionTreeActivityStep = {
  id: "prompt-engineering-03-step-04",
  type: "activity",
  interactiveType: "decision_tree_builder",
  title: "Pick the Right Format",
  requiresCompletion: true,
  instructions:
    "Build a small rule for choosing an output format. Drag conditions into place, then check them against the real requests below.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "That rule will hold up. Notice it keys off the shape of the answer, not the subject matter.",
    incorrect:
      "Start with how many things the answer contains, then ask whether order or comparison matters.",
  },
  showLivePreview: true,
  allowReordering: true,
  targetCategories: ["Table", "Numbered list", "Prose"],
  dataset: [
    {
      id: "d1",
      name: "Compare three laptops for a student budget",
      attributes: { itemCount: 3, needsComparison: true, orderMatters: false },
      correctCategory: "Table",
    },
    {
      id: "d2",
      name: "Explain why the sky is blue",
      attributes: { itemCount: 1, needsComparison: false, orderMatters: false },
      correctCategory: "Prose",
    },
    {
      id: "d3",
      name: "How to replace a bike inner tube",
      attributes: { itemCount: 7, needsComparison: false, orderMatters: true },
      correctCategory: "Numbered list",
    },
    {
      id: "d4",
      name: "Which of these four plans fits a team of ten",
      attributes: { itemCount: 4, needsComparison: true, orderMatters: false },
      correctCategory: "Table",
    },
    {
      id: "d5",
      name: "What happened in the French Revolution",
      attributes: { itemCount: 1, needsComparison: false, orderMatters: false },
      correctCategory: "Prose",
    },
    {
      id: "d6",
      name: "Steps to submit a passport application",
      attributes: { itemCount: 5, needsComparison: false, orderMatters: true },
      correctCategory: "Numbered list",
    },
  ],
  availableConditions: [
    {
      id: "cond-compare",
      label: "Does the answer need things weighed against each other?",
      attribute: "needsComparison",
      operator: "equals",
      value: true,
    },
    {
      id: "cond-order",
      label: "Does the order of the parts carry meaning?",
      attribute: "orderMatters",
      operator: "equals",
      value: true,
    },
    {
      id: "cond-count",
      label: "Is the answer more than one thing?",
      attribute: "itemCount",
      operator: "greater_than",
      value: 1,
    },
  ],
  solution: {
    rootConditionId: "cond-compare",
    nodes: [
      {
        id: "n-compare",
        label: "Needs comparison?",
        conditionId: "cond-compare",
        yesChildId: "n-table",
        noChildId: "n-order",
      },
      { id: "n-table", label: "Table", result: "Table" },
      {
        id: "n-order",
        label: "Order carries meaning?",
        conditionId: "cond-order",
        yesChildId: "n-list",
        noChildId: "n-prose",
      },
      { id: "n-list", label: "Numbered list", result: "Numbered list" },
      { id: "n-prose", label: "Prose", result: "Prose" },
    ],
    classifications: {
      d1: "Table",
      d2: "Prose",
      d3: "Numbered list",
      d4: "Table",
      d5: "Prose",
      d6: "Numbered list",
    },
  },
};

const lesson3Quiz: QuizStep = {
  id: "prompt-engineering-03-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why does asking for a table often produce a more useful comparison than asking for prose?",
  options: [
    {
      id: "l3q-a",
      label: "Tables are easier for the model to generate.",
      isCorrect: false,
      feedback:
        "Generation difficulty is not the mechanism, and tables are not especially easy.",
    },
    {
      id: "l3q-b",
      label:
        "A table forces the same fields for every item, so gaps and weak claims become visible.",
      isCorrect: true,
      feedback:
        "Exactly. The constraint changes what counts as a complete answer.",
    },
    {
      id: "l3q-c",
      label: "Tables let the model use more tokens.",
      isCorrect: false,
      feedback: "If anything a table is terser. Token budget is not the point.",
    },
    {
      id: "l3q-d",
      label: "Prose responses are not fact-checked by the model.",
      isCorrect: false,
      feedback:
        "Neither format is fact-checked. That is a separate problem entirely.",
    },
  ],
  explanation:
    "Format is a constraint on what the model must resolve before writing. Prose lets a comparison stay impressionistic; a table with fixed columns does not, because every cell is a specific claim that has to be produced.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson3Completion: CompletionStep = {
  id: "prompt-engineering-03-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "A format constraint changes what the model must work out, not just how it looks.",
    "Length limits are budgeted in tokens, which is why word counts behave strangely.",
    "Your instructions spend from the same budget as the answer.",
    "Derive the format from the shape of the answer: comparison, sequence, or single idea.",
  ],
  xpReward: 32,
  completionMessage:
    "You can now use format as a way of forcing a better answer, rather than tidying a bad one.",
  nextLessonId: "prompt-engineering-04",
};

/*
 * ============================================================
 * LESSON 4 — EXAMPLES & FEW-SHOT PROMPTING
 * ============================================================
 */

const lesson4Intro: IntroStep = {
  id: "prompt-engineering-04-intro",
  type: "intro",
  title: "Examples & Few-Shot Prompting",
  subtitle: "Showing beats describing, and one example beats a paragraph.",
  content:
    "There is a category of thing that is very hard to describe and very easy to demonstrate — a tone of voice, a house style, the particular way your team writes bug reports. This lesson is about handing the model an example instead of an adjective.",
  learningObjectives: [
    "Explain why one example can outperform a paragraph of instructions.",
    "Assemble a prompt from parts and see which parts carry the weight.",
    "Audit a set of examples for the pattern you did not mean to teach.",
  ],
  estimatedMinutes: 3,
};

const lesson4Concept1: ConceptStep = {
  id: "prompt-engineering-04-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Described",
        body: "Write in a friendly but professional tone, warm without being casual, clear but not curt.",
      },
      after: {
        label: "Demonstrated",
        body: "Write like this: Thanks for flagging this — I have pushed a fix and it should be live within the hour. Shout if it is still misbehaving.",
      },
      transform: "Replace the adjectives with one real sentence",
    },
  },
  title: "Show, Do Not Describe",
  requiresCompletion: false,
  content:
    "Friendly but professional is four words that mean something slightly different to everybody, including the model. One real sentence in the voice you want carries all of it at once — the sentence length, the contractions, the willingness to use a dash, the sign-off. You did not have to name any of those things, and you would probably not have thought to.",
  examples: [
    {
      id: "adjectives",
      title: "Adjectives",
      description:
        "Each word is doing an enormous amount of undefined work.",
      input: "Make it punchy and engaging but authoritative.",
      output: "Something the model guesses at, usually generic marketing copy.",
    },
    {
      id: "demonstration",
      title: "A demonstration",
      description:
        "The example encodes dozens of decisions you never articulated.",
      input: "Match this: Ship it Friday. If it breaks, we roll back Monday.",
      output: "Short sentences, plain verbs, no hedging.",
    },
  ],
  misconception:
    "Few-shot prompting is often described as giving the model more information. It is closer to giving the model a target — the examples show it what done looks like, which is a different thing from telling it more facts.",
};

const lesson4Activity1: PromptWeaverActivityStep = {
  id: "prompt-engineering-04-step-02",
  type: "activity",
  interactiveType: "prompt_weaver",
  title: "Build It From Blocks",
  requiresCompletion: true,
  instructions:
    "Assemble a prompt from the blocks below. Watch how the preview changes as you add each part — and notice which single block moves the output the most.",
  completion: {
    type: "required_actions",
    requiredActions: ["assemble-prompt"],
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "Notice the example block did more than the three adjective blocks combined. That is the lesson.",
    incorrect:
      "Try swapping a description block for the example block and compare the previews.",
  },
  showOutputPreview: true,
  requiredCategories: ["subject", "context", "format"],
  targetPromptPattern: ["subject", "context", "constraints", "format"],
  promptBlocks: [
    {
      id: "b-subject",
      category: "subject",
      label: "The task",
      text: "Write a release note for a bug fix.",
      qualityValue: 20,
    },
    {
      id: "b-context-team",
      category: "context",
      label: "Who reads it",
      text: "It goes to customers, not to engineers.",
      qualityValue: 20,
    },
    {
      id: "b-context-none",
      category: "context",
      label: "Vague enthusiasm",
      text: "This is an important release for us.",
      qualityValue: 2,
    },
    {
      id: "b-style-adjectives",
      category: "style",
      label: "Described tone",
      text: "Friendly but professional, clear and concise.",
      qualityValue: 8,
    },
    {
      id: "b-style-example",
      category: "style",
      label: "Demonstrated tone",
      text: "Match this voice: Fixed a bug where exports over 50MB would silently fail. Sorry about that — they now complete as expected.",
      qualityValue: 35,
    },
    {
      id: "b-format",
      category: "format",
      label: "Shape",
      text: "Two sentences. No heading, no bullet points.",
      qualityValue: 15,
    },
    {
      id: "b-constraints",
      category: "constraints",
      label: "What to avoid",
      text: "Do not use the words leverage, seamless, or excited.",
      qualityValue: 10,
    },
  ],
  exampleOutputs: [
    {
      label: "Task only",
      output:
        "We are excited to announce that this release includes a number of important bug fixes and improvements.",
      qualityScore: 20,
    },
    {
      label: "Task plus described tone",
      output:
        "We have released a fix for a recent issue. Thank you for your patience as we worked to resolve it.",
      qualityScore: 42,
    },
    {
      label: "Task plus demonstrated tone",
      output:
        "Fixed a bug where scheduled reports would not send if the recipient list was empty. They now send correctly.",
      qualityScore: 88,
    },
  ],
};

const lesson4Concept2: ConceptStep = {
  id: "prompt-engineering-04-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "Output matched the intended style",
      bars: [
        { id: "none", label: "No example", value: 31, note: "Adjectives only" },
        { id: "one", label: "One example", value: 79, note: "Big jump" },
        { id: "three", label: "Three examples", value: 88, note: "Small gain" },
        {
          id: "three-skewed",
          label: "Three similar examples",
          value: 46,
          note: "Learned the wrong pattern",
        },
      ],
    },
  },
  title: "One Good Example, Not Five Similar Ones",
  requiresCompletion: false,
  content:
    "The jump from no example to one example is enormous. The jump from one to three is small. And three examples that happen to resemble each other in some way you did not intend is actively worse than one, because the model will pick up the accidental pattern along with the deliberate one. If all three of your sample bug reports happen to be about the login page, do not be surprised when it writes about the login page.",
  examples: [
    {
      id: "one-good",
      title: "One well-chosen example",
      description:
        "Carries the style, and nothing else the model could mistake for the style.",
      input: "One release note, in the voice you want.",
      output: "Style transferred cleanly.",
    },
    {
      id: "three-similar",
      title: "Three accidentally similar examples",
      description:
        "All short, all about the same feature, all ending in an apology.",
      input: "Three release notes that share a hidden trait.",
      output: "The hidden trait gets copied as if it were the instruction.",
    },
  ],
  misconception:
    "Adding more examples feels like it should monotonically improve things. It only helps if the examples vary in everything except the thing you are trying to teach.",
};

const lesson4Activity2: BiasAuditActivityStep = {
  id: "prompt-engineering-04-step-04",
  type: "activity",
  interactiveType: "bias_audit",
  title: "Audit Your Examples",
  requiresCompletion: true,
  instructions:
    "Three prompts that came back producing something nobody asked for. Read the example sets, work out what pattern the model actually learned, and pick the fix.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "You are reading the example set as data, which is exactly what the model is doing.",
    incorrect:
      "Ask what all the examples have in common that you did not intend to teach.",
  },
  allowMultipleMitigations: true,
  requiredFindings: [
    "examples-share-a-subject",
    "examples-share-a-length",
    "examples-share-an-outcome",
  ],
  cases: [
    {
      id: "case-subject",
      title: "Every summary is about the login page",
      log: "Asked for a bug report summariser. Gave it three examples, all of which happened to be login bugs. It now describes a printing bug as an authentication issue.",
      issueType: "representation",
      severity: "high",
      correctMitigationIds: ["vary-subject", "fewer-examples"],
      explanation:
        "The subject matter was constant across all three examples, so the model treated it as part of the pattern rather than as incidental.",
    },
    {
      id: "case-length",
      title: "Everything comes back at exactly two sentences",
      log: "Asked for customer replies. All four examples happened to be two sentences long. A question needing a detailed walkthrough now gets two sentences.",
      issueType: "measurement",
      severity: "medium",
      correctMitigationIds: ["vary-length", "state-the-rule"],
      explanation:
        "Length was accidental in the examples but read as a rule. Either vary it, or say explicitly that length should follow the question.",
    },
    {
      id: "case-outcome",
      title: "It always agrees with the customer",
      log: "Asked for support responses. Every example was a case where the customer turned out to be right. It now concedes even when the customer has misread the pricing page.",
      issueType: "historical",
      severity: "high",
      correctMitigationIds: ["vary-outcome", "add-counterexample"],
      explanation:
        "The examples all shared an outcome, so the model learned the outcome rather than the reasoning. A single counter-example fixes most of it.",
    },
  ],
  mitigationOptions: [
    {
      id: "vary-subject",
      label: "Vary the subject across examples",
      description:
        "Choose examples that differ in topic so only the style is constant.",
      applicableIssueTypes: ["representation", "historical"],
      effectiveness: 85,
    },
    {
      id: "vary-length",
      label: "Vary the length across examples",
      description:
        "Include a short one and a long one so length reads as situational.",
      applicableIssueTypes: ["measurement", "representation"],
      effectiveness: 78,
    },
    {
      id: "vary-outcome",
      label: "Vary the outcome across examples",
      description:
        "Include cases that resolve differently so the model learns the reasoning.",
      applicableIssueTypes: ["historical", "representation"],
      effectiveness: 88,
    },
    {
      id: "add-counterexample",
      label: "Add one deliberate counter-example",
      description:
        "One example that goes the other way is often worth three that agree.",
      applicableIssueTypes: ["historical", "algorithmic"],
      effectiveness: 82,
    },
    {
      id: "fewer-examples",
      label: "Cut back to a single example",
      description:
        "One clean example beats three that share an accidental trait.",
      applicableIssueTypes: ["representation", "measurement"],
      effectiveness: 70,
    },
    {
      id: "state-the-rule",
      label: "State the rule alongside the examples",
      description:
        "Say what should vary, so the model does not have to infer it.",
      applicableIssueTypes: ["measurement", "unknown"],
      effectiveness: 74,
    },
  ],
};

const lesson4Quiz: QuizStep = {
  id: "prompt-engineering-04-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "You give a model three examples of the output you want, and it copies something you did not intend. What went wrong?",
  options: [
    {
      id: "l4q-a",
      label: "Three examples is too many for any model to handle.",
      isCorrect: false,
      feedback: "Three is a perfectly normal number. The count is not the issue.",
    },
    {
      id: "l4q-b",
      label:
        "The examples shared a trait you did not mean to teach, so it was learned along with the style.",
      isCorrect: true,
      feedback:
        "Right. The model cannot tell your deliberate pattern from your accidental one.",
    },
    {
      id: "l4q-c",
      label: "Examples always override explicit instructions.",
      isCorrect: false,
      feedback:
        "They are influential but not absolute — and here the problem is what the examples contained.",
    },
    {
      id: "l4q-d",
      label: "The examples were too short.",
      isCorrect: false,
      feedback:
        "Length may or may not matter. What matters is what they had in common.",
    },
  ],
  explanation:
    "A model treats an example set as evidence of a pattern. Anything constant across all the examples is a candidate for that pattern, whether you intended it or not. Good example sets vary in everything except the one thing being taught.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson4Completion: CompletionStep = {
  id: "prompt-engineering-04-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "One real example carries more than a paragraph of adjectives.",
    "The jump from zero examples to one is far bigger than one to three.",
    "Anything constant across your examples may be learned as the rule.",
    "Good example sets vary in everything except the thing being taught.",
  ],
  xpReward: 35,
  completionMessage:
    "You can now teach a model a style by showing it one, and spot when your examples taught it the wrong thing.",
  nextLessonId: "prompt-engineering-05",
};

/*
 * ============================================================
 * LESSON 5 — ITERATION & DEBUGGING PROMPTS
 * ============================================================
 */

const lesson5Intro: IntroStep = {
  id: "prompt-engineering-05-intro",
  type: "intro",
  title: "Iteration & Debugging Prompts",
  subtitle: "A bad output is information, not a failure.",
  content:
    "Almost nobody gets the prompt right first time, and the people who are good at this are not the ones who do. They are the ones who read a disappointing answer carefully enough to work out which part of the request produced it. This lesson is about that reading.",
  learningObjectives: [
    "Diagnose which part of a prompt caused a specific disappointing output.",
    "Change one thing at a time so you can attribute the improvement.",
    "Build a small set of test cases instead of judging from one run.",
  ],
  estimatedMinutes: 3,
};

const lesson5Concept1: ConceptStep = {
  id: "prompt-engineering-05-step-01",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        {
          id: "read",
          label: "Read the failure",
          caption: "What exactly is wrong with it?",
        },
        {
          id: "attribute",
          label: "Attribute it",
          caption: "Which missing instruction allowed that?",
        },
        {
          id: "change",
          label: "Change one thing",
          caption: "Only that instruction",
        },
        {
          id: "compare",
          label: "Compare",
          caption: "Did that specific fault go away?",
        },
      ],
    },
  },
  title: "Reading a Bad Answer",
  requiresCompletion: false,
  content:
    "Too long, too generic and not what I wanted are not diagnoses. They are reactions. A diagnosis names the specific fault and the specific gap that allowed it: it assumed I was a beginner, because I never said I was not. It compared on price only, because I never said what else mattered. Once the fault is named that precisely, the fix is usually obvious and usually one sentence.",
  examples: [
    {
      id: "reaction",
      title: "A reaction",
      description: "True, but it does not tell you what to change.",
      input: "This answer is too generic.",
      output: "No clear next move.",
    },
    {
      id: "diagnosis",
      title: "A diagnosis",
      description: "Names the fault and the gap in the same breath.",
      input:
        "It listed every option because I never said which constraint was binding.",
      output: "The fix writes itself: say which constraint is binding.",
    },
  ],
  misconception:
    "Rewriting the whole prompt when one part fails feels productive, but it destroys the information you just paid for. You no longer know which change helped.",
};

const lesson5Activity1: ParameterTuningActivityStep = {
  id: "prompt-engineering-05-step-02",
  type: "activity",
  interactiveType: "parameter_tuning",
  title: "Turn One Dial at a Time",
  requiresCompletion: true,
  instructions:
    "Four things you can adjust in a prompt. Move them and watch the answer quality respond. Each one has a range where it helps and a range where it stops helping.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 12,
  },
  feedback: {
    correct:
      "Notice none of these is turn everything up. Each dial has a place where more stops being better.",
    incorrect:
      "Move one dial at a time and watch which direction the score goes before touching the next.",
  },
  targetAccuracy: 80,
  parameters: [
    {
      id: "context-facts",
      label: "Facts of context",
      description:
        "How many constraining facts about your situation the prompt carries.",
      min: 0,
      max: 10,
      step: 1,
      unit: "facts",
    },
    {
      id: "examples",
      label: "Worked examples",
      description: "How many demonstrations of the output you include.",
      min: 0,
      max: 6,
      step: 1,
      unit: "examples",
    },
    {
      id: "explicit-format",
      label: "Format specificity",
      description:
        "From no format instruction at all to an exact field-by-field spec.",
      min: 0,
      max: 10,
      step: 1,
    },
    {
      id: "preamble",
      label: "Preamble length",
      description:
        "How much throat-clearing sits before the actual request.",
      min: 0,
      max: 10,
      step: 1,
      unit: "sentences",
    },
  ],
  initialValues: {
    "context-facts": 0,
    examples: 0,
    "explicit-format": 0,
    preamble: 4,
  },
  accuracyModel: {
    baselineAccuracy: 28,
    minAccuracy: 10,
    maxAccuracy: 97,
    effects: [
      {
        parameterId: "context-facts",
        optimalRange: [2, 4],
        effectStrength: 26,
        description:
          "Two to four constraining facts do most of the work. Past that they start competing and the answer hedges.",
      },
      {
        parameterId: "examples",
        optimalRange: [1, 2],
        effectStrength: 24,
        description:
          "The first example is worth far more than the rest. Beyond two, accidental shared traits start leaking in.",
      },
      {
        parameterId: "explicit-format",
        optimalRange: [5, 8],
        effectStrength: 20,
        description:
          "Enough to fix the shape, not so much that you have written the answer yourself.",
      },
      {
        parameterId: "preamble",
        optimalRange: [0, 1],
        effectStrength: 14,
        description:
          "Preamble spends tokens and dilutes the instruction. Almost always worth cutting to nothing.",
      },
    ],
  },
  feedbackThresholds: [
    {
      minAccuracy: 0,
      maxAccuracy: 45,
      message:
        "The request still is not constraining anything. Start with context facts.",
    },
    {
      minAccuracy: 45,
      maxAccuracy: 75,
      message:
        "Getting there. Something is either missing or turned up too far — check the preamble.",
    },
    {
      minAccuracy: 75,
      maxAccuracy: 101,
      message:
        "That is the shape of a good prompt: a few facts, one example, a clear format, no preamble.",
    },
  ],
};

const lesson5Concept2: ConceptStep = {
  id: "prompt-engineering-05-step-03",
  type: "concept",
  visual: {
    type: "timeline",
    data: {
      milestones: [
        {
          id: "m1",
          when: "Run 1",
          label: "Baseline",
          caption: "Note exactly what is wrong",
        },
        {
          id: "m2",
          when: "Run 2",
          label: "Add audience",
          caption: "Did the pitch change? Nothing else moved.",
        },
        {
          id: "m3",
          when: "Run 3",
          label: "Add format",
          caption: "Did the shape change? Keep audience fixed.",
        },
        {
          id: "m4",
          when: "Run 4",
          label: "Add example",
          caption: "Did the voice change? Everything else held.",
        },
      ],
    },
  },
  title: "One Change, One Run",
  requiresCompletion: false,
  content:
    "This is the same discipline as any other debugging. If you change four things and the answer improves, you have learned that some subset of four things helped, which is nearly nothing. Change one and you have learned something you can reuse on every future prompt. It feels slower for about ten minutes and then it is permanently faster.",
  examples: [
    {
      id: "shotgun",
      title: "Change everything",
      description: "The answer improves and you have learned nothing.",
      input: "Rewrite the whole prompt from scratch.",
      output: "Better output, no transferable knowledge.",
    },
    {
      id: "controlled",
      title: "Change one thing",
      description: "Slower per run, and the knowledge compounds.",
      input: "Add only the audience line, keep everything else identical.",
      output: "You now know what an audience line is worth.",
    },
  ],
  misconception:
    "Judging a prompt from a single run is unreliable — models vary between runs. Two or three inputs through the same prompt tell you much more than one input through three prompts.",
};

const lesson5Activity2: DatasetPlaygroundActivityStep = {
  id: "prompt-engineering-05-step-04",
  type: "activity",
  interactiveType: "dataset_playground",
  title: "Build a Test Set",
  requiresCompletion: true,
  instructions:
    "Label each output as good, borderline or broken. As you label more of them, your read on whether the prompt actually works gets more reliable — one lucky run tells you almost nothing.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 6,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Six labelled outputs is a real signal. One is an anecdote.",
    incorrect:
      "Judge each output against the request, not against whether it reads nicely.",
  },
  showConfidence: true,
  requiredLabels: 6,
  categories: [
    {
      id: "good",
      label: "Good",
      description: "Answers the request as specified.",
    },
    {
      id: "borderline",
      label: "Borderline",
      description: "Answers it, but drifts on tone, length or focus.",
    },
    {
      id: "broken",
      label: "Broken",
      description: "Ignores a stated constraint outright.",
    },
  ],
  dataset: [
    {
      id: "o1",
      label: "Two sentences, plain language, leads with the fix.",
      correctLabel: "good",
      metadata: { run: 1 },
    },
    {
      id: "o2",
      label: "Six paragraphs with a heading, when two sentences were asked for.",
      correctLabel: "broken",
      metadata: { run: 2 },
    },
    {
      id: "o3",
      label:
        "Two sentences, but opens with We are excited to announce, which was on the banned list.",
      correctLabel: "broken",
      metadata: { run: 3 },
    },
    {
      id: "o4",
      label:
        "Three sentences instead of two, otherwise exactly right in tone and content.",
      correctLabel: "borderline",
      metadata: { run: 4 },
    },
    {
      id: "o5",
      label: "Two sentences, correct tone, but never says what was fixed.",
      correctLabel: "borderline",
      metadata: { run: 5 },
    },
    {
      id: "o6",
      label: "Two sentences, plain, specific about the bug and the resolution.",
      correctLabel: "good",
      metadata: { run: 6 },
    },
    {
      id: "o7",
      label: "A bulleted list, when no bullets was stated explicitly.",
      correctLabel: "broken",
      metadata: { run: 7 },
    },
    {
      id: "o8",
      label: "Two sentences, right voice, right content, slightly stiff.",
      correctLabel: "good",
      metadata: { run: 8 },
    },
  ],
  trainingStages: [
    {
      id: "stage-1",
      label: "One output labelled",
      minimumItems: 1,
      accuracy: 34,
      confidence: 18,
    },
    {
      id: "stage-2",
      label: "Three outputs labelled",
      minimumItems: 3,
      accuracy: 61,
      confidence: 45,
    },
    {
      id: "stage-3",
      label: "Six outputs labelled",
      minimumItems: 6,
      accuracy: 87,
      confidence: 79,
    },
    {
      id: "stage-4",
      label: "All eight labelled",
      minimumItems: 8,
      accuracy: 92,
      confidence: 88,
    },
  ],
};

const lesson5Quiz: QuizStep = {
  id: "prompt-engineering-05-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Your prompt gives a bad answer. You rewrite the whole thing and the next answer is good. What is the problem with that?",
  options: [
    {
      id: "l5q-a",
      label: "Nothing — the output is good, which is what matters.",
      isCorrect: false,
      feedback:
        "For this one request, fine. But you cannot reuse anything you learned, because you did not learn anything.",
    },
    {
      id: "l5q-b",
      label:
        "You do not know which change helped, so nothing transfers to the next prompt.",
      isCorrect: true,
      feedback:
        "Exactly. One change per run is slower once and faster forever after.",
    },
    {
      id: "l5q-c",
      label: "Rewriting prompts uses more tokens.",
      isCorrect: false,
      feedback: "True and irrelevant at this scale.",
    },
    {
      id: "l5q-d",
      label: "The model remembers the earlier bad prompt.",
      isCorrect: false,
      feedback:
        "In a fresh conversation it does not. Memory is not the issue here.",
    },
  ],
  explanation:
    "Debugging a prompt is debugging. Changing several things at once gets you an answer without a reason, and the reason is the part that makes you faster next time.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson5Completion: CompletionStep = {
  id: "prompt-engineering-05-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Name the specific fault and the specific gap that allowed it — that is a diagnosis.",
    "Change one thing per run so you can attribute the improvement.",
    "Every dial has a range where more stops helping, including context and examples.",
    "Judge a prompt on several inputs, not on one lucky run.",
  ],
  xpReward: 38,
  completionMessage:
    "You can now treat a disappointing answer as the most useful thing you have — a precise description of what your prompt left open.",
  nextLessonId: "prompt-engineering-06",
};

/*
 * ============================================================
 * LESSON 6 — PROMPT CHALLENGE: FIX A TERRIBLE PROMPT
 * ============================================================
 */

const lesson6Intro: IntroStep = {
  id: "prompt-engineering-06-intro",
  type: "intro",
  title: "Prompt Challenge",
  subtitle: "One genuinely terrible prompt, and everything you now know.",
  content:
    "The prompt you are about to see is vague, internally contradictory, and missing every piece of context it needs. It is also completely realistic — it is the kind of thing everybody writes when they are in a hurry. Your job is to fix it, and then to judge whether the fix worked.",
  learningObjectives: [
    "Diagnose every distinct fault in a bad prompt.",
    "Rebuild it using context, constraints, format and an example.",
    "Judge whether a rewrite actually fixed the fault or just moved it.",
  ],
  estimatedMinutes: 4,
};

const lesson6Concept1: ConceptStep = {
  id: "prompt-engineering-06-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "The prompt as written",
        body: "Write something short but detailed about our new product for everyone, make it professional but fun, thanks!",
      },
      after: {
        label: "What is actually wrong with it",
        body: "Short but detailed contradicts itself. Everyone is not an audience. Professional but fun is two adjectives doing no work. Our new product is a fact the model does not have.",
      },
      transform: "Name each fault separately before fixing any of them",
    },
  },
  title: "Four Faults, Not One Bad Vibe",
  requiresCompletion: false,
  content:
    "The temptation with a prompt like this is to rewrite it in one go from instinct. Resist it for sixty seconds and name the faults separately, because they need different fixes. A contradiction needs resolving — pick one. A missing audience needs supplying. Undefined adjectives need replacing with a demonstration. A missing fact needs the fact. Four different moves, and if you only make three the answer will still be wrong in a way you will struggle to name.",
  examples: [
    {
      id: "fault-contradiction",
      title: "Contradiction",
      description:
        "Short and detailed pull opposite ways, so the model picks one at random.",
      input: "short but detailed",
      output: "Fix: decide which one wins, and say so.",
    },
    {
      id: "fault-missing-fact",
      title: "Missing fact",
      description:
        "The model has never heard of your product and will invent one.",
      input: "our new product",
      output: "Fix: say what it is and what it does.",
    },
  ],
  misconception:
    "A rewritten prompt that produces a nicer-sounding answer has not necessarily fixed anything. If the audience is still unstated, you got lucky on one run.",
};

const lesson6Activity1: PromptRefinementActivityStep = {
  id: "prompt-engineering-06-step-02",
  type: "activity",
  interactiveType: "prompt_refinement",
  title: "Fix a Terrible Prompt",
  requiresCompletion: true,
  instructions:
    "Here is the prompt and what it produced. Add constraints until the quality score clears 80. Watch which ones move it a lot and which barely register.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "That is a prompt that would work on a Tuesday afternoon when you are tired. Which is the real test.",
    incorrect:
      "You are close. Check whether you have resolved the contradiction — adding detail around it does not remove it.",
    completion:
      "You have just done, deliberately, the thing you have been doing by accident for five lessons.",
  },
  targetQualityScore: 80,
  minimumConstraints: 4,
  originalPrompt:
    "Write something short but detailed about our new product for everyone, make it professional but fun, thanks!",
  flawedOutput:
    "We are thrilled to introduce our exciting new product! Designed with you in mind, it combines cutting-edge innovation with seamless usability to deliver an unparalleled experience. Whether you are a seasoned professional or just getting started, our new product has something for everyone. Packed with powerful features and built on years of expertise, it is set to transform the way you work. We cannot wait for you to try it!",
  refinementTargets: [
    {
      id: "t-contradiction",
      label: "Resolve the contradiction",
      description:
        "Short but detailed cannot both be honoured. Decide which one is binding.",
    },
    {
      id: "t-audience",
      label: "Name a real audience",
      description:
        "Everyone is not an audience. Pick the actual reader.",
    },
    {
      id: "t-facts",
      label: "Supply the missing facts",
      description:
        "The model cannot know what the product is. Right now it is inventing one.",
    },
    {
      id: "t-voice",
      label: "Demonstrate the voice",
      description:
        "Professional but fun is two adjectives. One example sentence replaces both.",
    },
  ],
  availableConstraints: [
    {
      id: "c-length",
      category: "length",
      label: "Pick a length and mean it",
      text: "Exactly 60 words. If detail and length conflict, cut the detail.",
      scoreValue: 18,
    },
    {
      id: "c-audience",
      category: "audience",
      label: "A real reader",
      text: "Written for a small-business owner who has never used a scheduling tool before.",
      scoreValue: 20,
    },
    {
      id: "c-facts",
      category: "context",
      label: "What the product actually is",
      text: "The product is a scheduling app that books client appointments and sends reminders by text.",
      scoreValue: 22,
    },
    {
      id: "c-example",
      category: "tone",
      label: "Demonstrate the voice",
      text: "Match this sentence: No more phone tag — clients pick a slot, you get a text, everyone turns up.",
      scoreValue: 24,
    },
    {
      id: "c-format",
      category: "format",
      label: "Shape",
      text: "One paragraph. No heading, no bullet points, no sign-off.",
      scoreValue: 12,
    },
    {
      id: "c-banned",
      category: "restriction",
      label: "Ban the filler",
      text: "Do not use: thrilled, excited, seamless, cutting-edge, unparalleled, transform.",
      scoreValue: 14,
    },
    {
      id: "c-role",
      category: "role",
      label: "Assign a role",
      text: "You are writing the product page for a company that dislikes marketing language.",
      scoreValue: 10,
    },
    {
      id: "c-vague",
      category: "tone",
      label: "More adjectives",
      text: "Make it engaging, dynamic and impactful.",
      scoreValue: 1,
    },
  ],
  evaluationRubric: [
    {
      id: "r-contradiction",
      label: "Contradiction resolved",
      description:
        "The rewrite picks either short or detailed and states which wins.",
      weight: 25,
    },
    {
      id: "r-audience",
      label: "Audience named",
      description:
        "A specific reader, not everyone or a general audience.",
      weight: 25,
    },
    {
      id: "r-facts",
      label: "Facts supplied",
      description:
        "The model is told what the product is, so it does not invent one.",
      weight: 30,
    },
    {
      id: "r-voice",
      label: "Voice demonstrated",
      description:
        "An example sentence rather than a pile of adjectives.",
      weight: 20,
    },
  ],
  sampleImprovedOutput:
    "Booking clients used to mean three texts and a missed call. Now they pick a slot from your calendar, you get a message, and the reminder goes out the day before. That is the whole product. It takes about ten minutes to set up, works from your phone, and does not require anyone to download anything. If a client needs to move an appointment, they do it themselves.",
};

const lesson6Activity2: AiSorterActivityStep = {
  id: "prompt-engineering-06-step-03",
  type: "activity",
  interactiveType: "ai_sorter",
  title: "Did It Actually Get Fixed?",
  requiresCompletion: true,
  instructions:
    "Six attempted rewrites of the same terrible prompt. Sort each one by whether it genuinely removed a fault or just made the prompt sound more thorough.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "That is the judgement worth having. A longer prompt is not a better prompt.",
    incorrect:
      "Ask which of the four faults each rewrite removes. If it removes none, length did not help.",
  },
  allowRetry: true,
  buckets: [
    {
      id: "fixed",
      label: "Genuinely fixed a fault",
      description: "Removes a specific problem the original had.",
    },
    {
      id: "not-fixed",
      label: "Sounds better, fixes nothing",
      description: "More words, same gaps.",
    },
  ],
  cards: [
    {
      id: "r1",
      title: "Exactly 60 words. If detail and length conflict, cut detail.",
      description: "Replaces short but detailed.",
      correctBucketId: "fixed",
      explanation:
        "Resolves the contradiction outright and says which side wins. That is a real fix.",
    },
    {
      id: "r2",
      title: "Please write a really excellent and comprehensive piece.",
      description: "Added enthusiasm and two more adjectives.",
      correctBucketId: "not-fixed",
      explanation:
        "Excellent and comprehensive are the same kind of undefined word as professional and fun. Nothing was resolved.",
    },
    {
      id: "r3",
      title:
        "For a small-business owner who has never used a scheduling tool.",
      description: "Replaces for everyone.",
      correctBucketId: "fixed",
      explanation:
        "A real audience, which changes the vocabulary, the assumed knowledge and the examples.",
    },
    {
      id: "r4",
      title:
        "It is very important that this is high quality, as it matters a lot to us.",
      description: "Added stakes.",
      correctBucketId: "not-fixed",
      explanation:
        "Importance is not a constraint. It rules out no possible answer, so the output does not move.",
    },
    {
      id: "r5",
      title:
        "The product is a scheduling app that books appointments and texts reminders.",
      description: "Replaces our new product.",
      correctBucketId: "fixed",
      explanation:
        "Supplies the fact the model was previously inventing. This one usually produces the biggest single jump.",
    },
    {
      id: "r6",
      title:
        "Write something short but detailed, and make sure it is thorough yet brief.",
      description: "Restated the requirement more emphatically.",
      correctBucketId: "not-fixed",
      explanation:
        "The contradiction is now stated twice. Repeating an impossible instruction does not make it possible.",
    },
  ],
};

const lesson6Quiz: QuizStep = {
  id: "prompt-engineering-06-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Which single change usually produces the largest improvement to a prompt about something the model has never heard of?",
  options: [
    {
      id: "l6q-a",
      label: "Adding a more emphatic tone instruction.",
      isCorrect: false,
      feedback:
        "Emphasis rules nothing out. The output barely moves.",
    },
    {
      id: "l6q-b",
      label: "Supplying the facts the model does not have.",
      isCorrect: true,
      feedback:
        "Right. Without them it invents, and everything else you fix sits on top of an invention.",
    },
    {
      id: "l6q-c",
      label: "Making the prompt longer.",
      isCorrect: false,
      feedback:
        "Length is not the variable. Plenty of long prompts specify nothing.",
    },
    {
      id: "l6q-d",
      label: "Asking it to double-check its work.",
      isCorrect: false,
      feedback:
        "Sometimes useful, but it cannot check facts it never had.",
    },
  ],
  explanation:
    "Every other improvement — audience, format, voice — shapes how the answer is presented. If the underlying facts are invented, you have improved the presentation of a fiction.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson6Completion: CompletionStep = {
  id: "prompt-engineering-06-completion",
  type: "completion",
  title: "Course Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Name each fault separately — contradiction, missing audience, missing fact, undefined adjective.",
    "Supplying missing facts usually moves the answer more than anything else.",
    "A longer prompt is not a better prompt.",
    "A rewrite that sounds better has not necessarily removed a fault.",
  ],
  xpReward: 75,
  completionMessage:
    "You finished Prompt Engineering & AI Communication. You can now read a bad answer and name the thing in the request that caused it.",
  mission: {
    target: "lab",
    headline: "your mission",
    description:
      "Take the prompt you just rebuilt into the Lab and run it for real. Then run the original terrible version beside it and read both outputs. Everything in this course was building toward being able to tell the difference on purpose.",
    label: "Open the Lab",
  },
};

/*
 * ============================================================
 * LESSON OBJECTS
 * ============================================================
 */

export const promptEngineeringLessons: Lesson[] = [
  {
    id: "prompt-engineering-01",
    courseId: "prompt-engineering",
    courseTitle: "Prompt Engineering & AI Communication",
    number: 1,
    title: "What Makes a Good Prompt?",
    description:
      "Why a vague request gets the average answer, and what a model does with every gap you leave open.",
    track: "Prompt Engineering",
    conceptIds: ["prompt-vague-vs-specific", "prompt-gaps-get-filled"],
    challengeIds: ["predict-the-continuation", "what-did-it-fill-in"],
    prerequisites: [],
    totalXp: 100,
    estimatedMinutes: 22,
    learningObjectives: [
      "Predict how a model will respond to a vague request before sending it.",
      "Explain why specificity changes the kind of answer, not just the length.",
      "Identify the parts of an answer the model invented to fill a gap.",
    ],
    keyTakeaways: [
      "A vague request gets the most average answer, which is correct behaviour.",
      "Every gap you leave is filled silently and confidently.",
      "Invented detail is written in the same voice as everything else.",
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
    id: "prompt-engineering-02",
    courseId: "prompt-engineering",
    courseTitle: "Prompt Engineering & AI Communication",
    number: 2,
    title: "Context & Specificity",
    description:
      "The same question asked three ways, and the point where adding more context starts making the answer worse.",
    track: "Prompt Engineering",
    conceptIds: ["context-rules-answers-out", "context-diminishing-returns"],
    challengeIds: ["three-contexts", "where-context-runs-out"],
    prerequisites: ["prompt-engineering-01"],
    totalXp: 120,
    estimatedMinutes: 24,
    learningObjectives: [
      "Distinguish context that constrains from context that only pads.",
      "Predict which kind of answer a level of context will produce.",
      "Recognise when competing constraints are making a model hedge.",
    ],
    keyTakeaways: [
      "Context works by ruling answers out.",
      "The first two or three facts do most of the work.",
      "When an answer hedges, add precedence rather than detail.",
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
    id: "prompt-engineering-03",
    courseId: "prompt-engineering",
    courseTitle: "Prompt Engineering & AI Communication",
    number: 3,
    title: "Constraints & Output Formats",
    description:
      "Asking for a shape is a design decision. What a length limit really costs, and how to derive a format from the request.",
    track: "Prompt Engineering",
    conceptIds: ["format-as-constraint", "format-from-shape"],
    challengeIds: ["length-limit-tokens", "pick-the-right-format"],
    prerequisites: ["prompt-engineering-02"],
    totalXp: 130,
    estimatedMinutes: 25,
    learningObjectives: [
      "Explain why a format constraint changes content, not just presentation.",
      "Describe what a length limit costs in tokens.",
      "Choose an output format from the shape of the answer.",
    ],
    keyTakeaways: [
      "A format decides what the model must resolve before writing.",
      "Length limits are budgeted in tokens, not words.",
      "Comparison wants a table, sequence wants a list, one idea wants prose.",
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
    id: "prompt-engineering-04",
    courseId: "prompt-engineering",
    courseTitle: "Prompt Engineering & AI Communication",
    number: 4,
    title: "Examples & Few-Shot Prompting",
    description:
      "Showing the model what you want instead of describing it — and auditing your examples for the pattern you did not mean to teach.",
    track: "Prompt Engineering",
    conceptIds: ["show-dont-describe", "example-set-hygiene"],
    challengeIds: ["build-from-blocks", "audit-your-examples"],
    prerequisites: ["prompt-engineering-03"],
    totalXp: 140,
    estimatedMinutes: 26,
    learningObjectives: [
      "Explain why one example can outperform a paragraph of instructions.",
      "Identify which part of an assembled prompt carries the most weight.",
      "Audit an example set for accidental shared traits.",
    ],
    keyTakeaways: [
      "One real example carries more than a paragraph of adjectives.",
      "Zero to one example is a bigger jump than one to three.",
      "Anything constant across your examples may be learned as the rule.",
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
    id: "prompt-engineering-05",
    courseId: "prompt-engineering",
    courseTitle: "Prompt Engineering & AI Communication",
    number: 5,
    title: "Iteration & Debugging Prompts",
    description:
      "What to do when the first answer misses. Diagnosing a fault precisely, and changing one thing at a time.",
    track: "Prompt Engineering",
    conceptIds: ["diagnose-not-react", "one-change-per-run"],
    challengeIds: ["turn-one-dial", "build-a-test-set"],
    prerequisites: ["prompt-engineering-04"],
    totalXp: 150,
    estimatedMinutes: 26,
    learningObjectives: [
      "Diagnose which part of a prompt caused a specific bad output.",
      "Change one variable per run so improvements are attributable.",
      "Judge a prompt across several inputs rather than one.",
    ],
    keyTakeaways: [
      "Name the fault and the gap that allowed it.",
      "One change per run is slower once and faster forever.",
      "Every dial has a point where more stops helping.",
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
    id: "prompt-engineering-06",
    courseId: "prompt-engineering",
    courseTitle: "Prompt Engineering & AI Communication",
    number: 6,
    title: "Prompt Challenge: Fix a Terrible Prompt",
    description:
      "A genuinely bad prompt — vague, contradictory, contextless. Rebuild it, then judge whether the rebuild actually fixed anything.",
    track: "Prompt Engineering",
    conceptIds: ["name-each-fault"],
    challengeIds: ["fix-a-terrible-prompt", "did-it-get-fixed"],
    prerequisites: [
      "prompt-engineering-01",
      "prompt-engineering-02",
      "prompt-engineering-03",
      "prompt-engineering-04",
      "prompt-engineering-05",
    ],
    totalXp: 300,
    estimatedMinutes: 30,
    isCapstone: true,
    learningObjectives: [
      "Diagnose every distinct fault in a bad prompt.",
      "Rebuild a prompt with context, constraints, format and an example.",
      "Tell a genuine fix from a rewrite that only sounds better.",
    ],
    keyTakeaways: [
      "Name each fault separately before fixing any of them.",
      "Missing facts usually matter more than anything else.",
      "A longer prompt is not a better prompt.",
    ],
    steps: [
      lesson6Intro,
      lesson6Concept1,
      lesson6Activity1,
      lesson6Activity2,
      lesson6Quiz,
      lesson6Completion,
    ],
    passingScore: 80,
  },
];

/*
 * ============================================================
 * CURRICULUM
 * ============================================================
 */

export const promptEngineeringCurriculum: Curriculum = {
  id: "prompt-engineering",
  name: "Prompt Engineering & AI Communication",
  description:
    "Why instructions change AI behaviour. Context, constraints, output formats, few-shot examples and the discipline of debugging a prompt — ending on a real rewrite run in the Lab.",
  concepts: [],
  lessons: promptEngineeringLessons,
  challenges: [],
  totalXp: promptEngineeringLessons.reduce(
    (total, lesson) => total + lesson.totalXp,
    0,
  ),
};

export default promptEngineeringLessons;
