import type { Curriculum } from "./Curriculum";
import type {
  CompletionStep,
  ConceptStep,
  DataRedactionActivityStep,
  DatasetImbalanceActivityStep,
  DatasetPlaygroundActivityStep,
  DecisionTreeActivityStep,
  EthicsDialActivityStep,
  FairnessMetricsActivityStep,
  IntroStep,
  Lesson,
  ParameterTuningActivityStep,
  PolicyCreatorActivityStep,
  PromptRefinementActivityStep,
  PromptWeaverActivityStep,
  QuizStep,
  TemperatureSliderActivityStep,
  TruthAssessmentActivityStep,
} from "./Lesson";

/*
 * ============================================================
 * AI ETHICS & RESPONSIBILITY
 * ============================================================
 *
 * Six lessons that should feel like a discussion.
 *
 * Placed last in the suggested order on purpose: scenario
 * reasoning about whether to trust a citation lands very
 * differently for somebody who has built and shipped an agent
 * than for somebody being told about one.
 *
 * This course has no feature mission. Its output is judgement,
 * not a build, and the capstone is a set of scenarios with no
 * single forced answer — the completion step deliberately
 * carries no mission field.
 */

/*
 * ============================================================
 * LESSON 1 — CAN YOU TRUST AI?
 * ============================================================
 */

const lesson1Intro: IntroStep = {
  id: "ai-ethics-01-intro",
  type: "intro",
  title: "Start here",
  subtitle:
    "Six lessons about judgement, ending in scenarios with no single right answer.",
  content:
    "This course is not a list of rules about AI. It is practice at the judgement calls you will actually face — whether to trust an answer, what to type into a chatbot, where the line sits on schoolwork. You have built things by now. That makes these questions concrete rather than theoretical.",
  learningObjectives: [
    "Separate what AI is reliably good at from what it is unreliably good at.",
    "Explain why confidence in an answer says nothing about its correctness.",
    "Calibrate how much to trust a response by the kind of question it answers.",
  ],
  estimatedMinutes: 2,
};

const lesson1Concept1: ConceptStep = {
  id: "ai-ethics-01-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Reliably good at",
        points: [
          "Rewriting something you gave it",
          "Explaining a well-covered idea",
          "Producing structure from mess",
          "Suggesting things to consider",
        ],
      },
      right: {
        label: "Unreliably good at",
        points: [
          "Specific facts, dates and numbers",
          "Anything recent",
          "Citations and page references",
          "Arithmetic it did in its head",
        ],
      },
    },
  },
  title: "Two Different Kinds of Question",
  requiresCompletion: false,
  content:
    "Trust is not a single dial you turn up or down for AI in general. The same model in the same session is close to reliable on one kind of question and close to a coin flip on another, and the boundary is learnable. Anything where the material is in front of it — summarise this, rewrite this, find the tension between these two paragraphs — is solid ground. Anything requiring a specific retrieved fact is where it will produce something plausible and wrong, at exactly the same confidence.",
  examples: [
    {
      id: "solid",
      title: "Solid ground",
      description: "The material is present; the work is transformation.",
      input: "Here are my notes. What am I contradicting myself about?",
      output: "Usually a genuinely useful answer.",
    },
    {
      id: "thin",
      title: "Thin ice",
      description: "The answer must come from memory of a specific fact.",
      input: "Which page of the report says that?",
      output: "A confident page number that may be invented.",
    },
  ],
  misconception:
    "Do not trust AI is as useless as trust it completely. Both replace a judgement you can actually make with a blanket rule that will be wrong half the time.",
};

const lesson1Activity1: PromptRefinementActivityStep = {
  id: "ai-ethics-01-step-02",
  type: "activity",
  interactiveType: "prompt_refinement",
  title: "Move It Onto Solid Ground",
  requiresCompletion: true,
  instructions:
    "Below is a question on thin ice and the confident wrong answer it produced. Add constraints until the same underlying need is being met by a question the model can actually answer well.",
  completion: {
    type: "target_score",
    targetScore: 75,
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "You did not make the model more trustworthy. You moved the question to where it already was.",
    incorrect:
      "Ask what the model would have to remember to answer this, and whether you could supply it instead.",
  },
  targetQualityScore: 75,
  minimumConstraints: 3,
  originalPrompt:
    "What are the three main causes of the 1926 General Strike, with page references from Taylor?",
  flawedOutput:
    "The three main causes were the decline of the coal industry (Taylor, p. 187), the return to the gold standard in 1925 (Taylor, p. 192), and the failure of the Samuel Commission (Taylor, p. 204). Taylor argues these combined to make industrial confrontation inevitable.",
  refinementTargets: [
    {
      id: "et-supply",
      label: "Supply the material",
      description:
        "The model cannot see your book. Give it the text and the question becomes answerable.",
    },
    {
      id: "et-citations",
      label: "Stop asking for page numbers",
      description:
        "Page references from memory are invented almost every time.",
    },
    {
      id: "et-transform",
      label: "Ask for transformation, not recall",
      description:
        "Move the work to summarising, comparing or structuring what you provided.",
    },
  ],
  availableConstraints: [
    {
      id: "ec-paste",
      category: "context",
      label: "Paste the actual pages",
      text: "Here are the four pages from Taylor covering the strike. Work only from this text.",
      scoreValue: 32,
    },
    {
      id: "ec-nocite",
      category: "restriction",
      label: "Ban invented references",
      text: "Do not give page numbers unless they appear in the text I pasted.",
      scoreValue: 24,
    },
    {
      id: "ec-transform",
      category: "role",
      label: "Ask it to organise, not recall",
      text: "Group the causes this passage gives into themes, quoting the phrase each comes from.",
      scoreValue: 26,
    },
    {
      id: "ec-flag",
      category: "format",
      label: "Ask it to flag its own gaps",
      text: "If the passage does not support a point, say so instead of filling it in.",
      scoreValue: 18,
    },
    {
      id: "ec-confident",
      category: "tone",
      label: "Ask for confidence",
      text: "Be confident and authoritative in your answer.",
      scoreValue: 1,
    },
    {
      id: "ec-accurate",
      category: "restriction",
      label: "Tell it to be accurate",
      text: "Make sure everything you say is completely accurate.",
      scoreValue: 2,
    },
  ],
  evaluationRubric: [
    {
      id: "er-material",
      label: "Material supplied",
      description: "The model is given the text rather than asked to recall it.",
      weight: 40,
    },
    {
      id: "er-nocite",
      label: "No invented references",
      description: "Page numbers are constrained to what was provided.",
      weight: 30,
    },
    {
      id: "er-transform",
      label: "Task is transformation",
      description:
        "The work asked for is organising or comparing, not remembering.",
      weight: 30,
    },
  ],
  sampleImprovedOutput:
    "From the passage you gave me, three causes are named. Coal industry decline — the passage calls it a long decline in profitability. The gold standard return, described as raising export prices. The Samuel Commission, whose recommendations the passage says both sides rejected. The passage does not rank these, so I have not either.",
};

const lesson1Concept2: ConceptStep = {
  id: "ai-ethics-01-step-03",
  type: "concept",
  visual: {
    type: "data",
    data: {
      caption: "Stated confidence against actual correctness, same session",
      bars: [
        {
          id: "c1",
          label: "Summarising given text",
          value: 94,
          note: "Confident and right",
        },
        {
          id: "c2",
          label: "Well-known general facts",
          value: 88,
          note: "Confident and mostly right",
        },
        {
          id: "c3",
          label: "Specific dates and figures",
          value: 51,
          note: "Equally confident",
        },
        {
          id: "c4",
          label: "Page references",
          value: 18,
          note: "Equally confident",
        },
      ],
    },
  },
  title: "Confidence Is Flat",
  requiresCompletion: false,
  content:
    "This is the single most useful thing in the course. Correctness varies enormously across those four bars. Confidence does not vary at all — the page reference that is wrong four times in five arrives in the same steady voice as the summary that is right. Human confidence is a genuine signal, wobbly when we are unsure, and we read AI confidence the same way out of habit. There is nothing behind it.",
  examples: [
    {
      id: "flat-right",
      title: "Confident and right",
      description: "Reads exactly like the next one.",
      input: "Summarise these three paragraphs.",
      output: "An accurate summary, stated plainly.",
    },
    {
      id: "flat-wrong",
      title: "Confident and wrong",
      description: "Reads exactly like the last one.",
      input: "What page is that on?",
      output: "Page 187, stated just as plainly.",
    },
  ],
  misconception:
    "Hedging language is not a reliability signal either. A model saying I think or it may be is producing likely phrasing, not reporting an internal uncertainty measurement.",
};

const lesson1Activity2: TemperatureSliderActivityStep = {
  id: "ai-ethics-01-step-04",
  type: "activity",
  interactiveType: "temperature_slider",
  title: "Same Certainty, Different Answers",
  requiresCompletion: true,
  instructions:
    "One factual question, asked repeatedly at different settings. Watch the answer change while the certainty in the voice does not move at all.",
  completion: {
    type: "required_actions",
    requiredActions: ["compare-temperatures"],
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "Four different answers, four identical levels of confidence. That is the thing to remember.",
    incorrect:
      "Read the tone rather than the content. Does any version sound less sure than the others?",
  },
  minTemperature: 0,
  maxTemperature: 1,
  initialTemperature: 0.4,
  stepSize: 0.1,
  showRandomnessMeter: true,
  prompts: [
    {
      id: "fact-q",
      prompt: "Which page of Taylor covers the Samuel Commission?",
      description: "A specific retrieved fact. Thin ice.",
    },
    {
      id: "transform-q",
      prompt: "Summarise the passage I just pasted in two sentences.",
      description: "Transformation of supplied material. Solid ground.",
    },
  ],
  outputSets: [
    {
      promptId: "fact-q",
      outputs: [
        {
          temperature: 0,
          output: "The Samuel Commission is covered on page 204.",
          creativityScore: 4,
          predictabilityScore: 92,
        },
        {
          temperature: 0.5,
          output:
            "That is discussed on page 198, in the chapter on the run-up to the strike.",
          creativityScore: 48,
          predictabilityScore: 55,
        },
        {
          temperature: 1,
          output:
            "You will find the Samuel Commission around page 211, though Taylor returns to it briefly later as well.",
          creativityScore: 90,
          predictabilityScore: 21,
        },
      ],
    },
    {
      promptId: "transform-q",
      outputs: [
        {
          temperature: 0,
          output:
            "The passage argues the strike followed coal industry decline and the gold standard return. It presents the Samuel Commission as a failed attempt to resolve it.",
          creativityScore: 6,
          predictabilityScore: 95,
        },
        {
          temperature: 0.5,
          output:
            "Taylor traces the strike to a declining coal industry made worse by the return to gold. The Samuel Commission, in his account, was the last off-ramp and both sides refused it.",
          creativityScore: 46,
          predictabilityScore: 68,
        },
        {
          temperature: 1,
          output:
            "The picture here is of an industry already sinking, pushed under by a currency decision, with the Samuel Commission as the rejected lifeline.",
          creativityScore: 84,
          predictabilityScore: 44,
        },
      ],
    },
  ],
};

const lesson1Quiz: QuizStep = {
  id: "ai-ethics-01-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "An AI gives you a page reference in the same confident tone as everything else it said. What does that tone tell you?",
  options: [
    {
      id: "e1q-a",
      label: "That it is reasonably sure about the reference.",
      isCorrect: false,
      feedback:
        "There is no sureness behind the tone. It sounds the same when wrong.",
    },
    {
      id: "e1q-b",
      label: "Nothing — confidence is flat regardless of correctness.",
      isCorrect: true,
      feedback:
        "Right. This is the habit worth breaking: we read AI confidence like human confidence, and it is not the same signal.",
    },
    {
      id: "e1q-c",
      label: "That the reference came from a real source.",
      isCorrect: false,
      feedback:
        "Page numbers from memory are among the least reliable things a model produces.",
    },
    {
      id: "e1q-d",
      label: "That the rest of the answer is probably right too.",
      isCorrect: false,
      feedback:
        "Different parts of one answer sit on completely different ground.",
    },
  ],
  explanation:
    "Correctness varies enormously by question type. Confidence does not vary with it. A model is not reporting an internal uncertainty measurement — it is producing the phrasing that typically follows a question like yours.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson1Completion: CompletionStep = {
  id: "ai-ethics-01-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Trust is per-question, not per-model.",
    "Transformation of supplied material is solid ground; retrieved specifics are not.",
    "Confidence stays flat while correctness swings wildly.",
    "Hedging language is not an uncertainty measurement either.",
  ],
  xpReward: 25,
  completionMessage:
    "You can now tell which half of an answer to check, which beats trusting or distrusting all of it.",
  nextLessonId: "ai-ethics-02",
};

/*
 * ============================================================
 * LESSON 2 — HALLUCINATIONS & VERIFICATION
 * ============================================================
 */

const lesson2Intro: IntroStep = {
  id: "ai-ethics-02-intro",
  type: "intro",
  title: "Hallucinations & Verification",
  subtitle: "A confident wrong answer, and what checking actually involves.",
  content:
    "Everybody has heard that AI makes things up. Far fewer people have actually looked closely at one doing it, or worked out how long verification really takes. This lesson does both, because the honest answer to should I check this depends on knowing what checking costs.",
  learningObjectives: [
    "Recognise the shape of a fabricated detail.",
    "Sort real answers by whether they need verifying.",
    "Assemble a verification approach proportionate to the stakes.",
  ],
  estimatedMinutes: 3,
};

const lesson2Concept1: ConceptStep = {
  id: "ai-ethics-02-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "What a hallucination is not",
        body: "A garbled sentence, an obvious error, a refusal, or a wild claim you would spot immediately.",
      },
      after: {
        label: "What it actually is",
        body: "A specific, plausible, well-formed detail that fits perfectly into a paragraph of true ones. Usually a number, a name, a date or a reference.",
      },
      transform: "Look for plausibility, not for weirdness",
    },
  },
  title: "The Shape of a Made-Up Thing",
  requiresCompletion: false,
  content:
    "Fabrications are not the strange parts of an answer. They are the most ordinary-looking parts, because the model is producing whatever is most likely to appear in that position — and a plausible-sounding statistic is exactly what usually appears there. That is why they survive a read-through. You are scanning for something that looks wrong, and a good fabrication looks more right than the sentences around it.",
  examples: [
    {
      id: "shape-round",
      title: "A round, specific number",
      description:
        "Over 400 shops closed. Specific enough to sound sourced, round enough to be invented.",
      input: "How many closed?",
      output: "A figure that exists nowhere.",
    },
    {
      id: "shape-realish",
      title: "A real thing, slightly wrong",
      description:
        "The harder case: a genuine source, cited for a claim it does not make.",
      input: "Which report says that?",
      output: "A real report, misattributed.",
    },
  ],
  misconception:
    "Asking the model whether it is sure does not work. It will produce whatever typically follows that question, which is usually either a confident yes or an apology, and neither is evidence.",
};

const lesson2Activity1: DatasetPlaygroundActivityStep = {
  id: "ai-ethics-02-step-02",
  type: "activity",
  interactiveType: "dataset_playground",
  title: "Does This Need Checking?",
  requiresCompletion: true,
  instructions:
    "Eight statements from real AI answers. Label each by how much verification it actually needs. Your accuracy at spotting the risky ones climbs quickly once you stop looking for weirdness.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 6,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Notice the pattern — specifics need checking, transformations of your own material mostly do not.",
    incorrect:
      "Ask where this claim would have to have come from. If the answer is memory of a specific fact, it needs checking.",
  },
  showConfidence: true,
  requiredLabels: 6,
  categories: [
    {
      id: "check-now",
      label: "Check before using",
      description: "A specific retrieved claim that could be invented.",
    },
    {
      id: "check-if-matters",
      label: "Check if it matters",
      description: "Probably fine, worth confirming if something depends on it.",
    },
    {
      id: "no-check",
      label: "No check needed",
      description: "Transformation of material you supplied.",
    },
  ],
  dataset: [
    {
      id: "h1",
      label: "A summary of three paragraphs you pasted in.",
      correctLabel: "no-check",
    },
    {
      id: "h2",
      label: "The study found a 23 percent reduction.",
      correctLabel: "check-now",
    },
    {
      id: "h3",
      label: "Photosynthesis converts light energy into chemical energy.",
      correctLabel: "no-check",
    },
    {
      id: "h4",
      label: "This was established in the 1997 Harrison case.",
      correctLabel: "check-now",
    },
    {
      id: "h5",
      label: "Your second and fourth points contradict each other.",
      correctLabel: "no-check",
    },
    {
      id: "h6",
      label: "Most historians consider this the turning point.",
      correctLabel: "check-if-matters",
    },
    {
      id: "h7",
      label: "The library closes at 6pm on Saturdays.",
      correctLabel: "check-now",
    },
    {
      id: "h8",
      label: "One common way to structure this argument is chronologically.",
      correctLabel: "check-if-matters",
    },
  ],
  trainingStages: [
    {
      id: "hs-1",
      label: "Two labelled",
      minimumItems: 2,
      accuracy: 44,
      confidence: 28,
    },
    {
      id: "hs-2",
      label: "Four labelled",
      minimumItems: 4,
      accuracy: 71,
      confidence: 55,
    },
    {
      id: "hs-3",
      label: "Six labelled",
      minimumItems: 6,
      accuracy: 88,
      confidence: 80,
    },
    {
      id: "hs-4",
      label: "All eight labelled",
      minimumItems: 8,
      accuracy: 94,
      confidence: 90,
    },
  ],
};

const lesson2Concept2: ConceptStep = {
  id: "ai-ethics-02-step-03",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        {
          id: "stakes",
          label: "What happens if it is wrong?",
          caption: "This sets the effort",
        },
        {
          id: "isolate",
          label: "Which sentence is the risk?",
          caption: "Usually one or two, not the whole answer",
        },
        {
          id: "primary",
          label: "Go to the actual source",
          caption: "Not to another AI",
        },
        {
          id: "decide",
          label: "Use it, fix it, or drop it",
          caption: "A decision, not a feeling",
        },
      ],
    },
  },
  title: "Checking, Proportionately",
  requiresCompletion: false,
  content:
    "Verify everything is advice nobody follows, which makes it worse than advice calibrated to stakes. Start with what happens if this is wrong. A wrong fact in a message to a friend costs nothing; a wrong citation in coursework is an academic misconduct meeting. Then isolate — you almost never need to check a whole answer, just the two sentences carrying specific claims. Then go to the source itself rather than asking a second AI, which produces agreement rather than evidence.",
  examples: [
    {
      id: "low-stakes",
      title: "Low stakes",
      description: "Proportionate effort is none.",
      input: "A recipe suggestion for tonight.",
      output: "Just cook it.",
    },
    {
      id: "high-stakes",
      title: "High stakes",
      description: "Proportionate effort is the actual source.",
      input: "A citation going into submitted coursework.",
      output: "Open the paper. Find the page. Read the sentence.",
    },
  ],
  misconception:
    "Asking a second AI to check the first is the most common verification method and one of the weakest. Two systems trained on overlapping data agreeing is not independent confirmation.",
};

const lesson2Activity2: PromptWeaverActivityStep = {
  id: "ai-ethics-02-step-04",
  type: "activity",
  interactiveType: "prompt_weaver",
  title: "Build a Verification Habit",
  requiresCompletion: true,
  instructions:
    "Assemble an approach for checking an AI answer that is going into something that matters. Watch which blocks actually reduce your risk and which just feel responsible.",
  completion: {
    type: "required_actions",
    requiredActions: ["assemble-prompt"],
    allowPartialCredit: true,
    maxAttempts: 6,
  },
  feedback: {
    correct:
      "Going to the primary source did more than every other block combined. It usually does.",
    incorrect:
      "Try swapping the ask-it-again block for the open-the-source block.",
  },
  showOutputPreview: true,
  requiredCategories: ["subject", "context", "constraints"],
  targetPromptPattern: ["subject", "context", "constraints", "format"],
  promptBlocks: [
    {
      id: "vb-stakes",
      category: "context",
      label: "Establish the stakes",
      text: "This is going into submitted coursework, so a wrong citation is misconduct.",
      qualityValue: 20,
    },
    {
      id: "vb-isolate",
      category: "subject",
      label: "Isolate the risky claims",
      text: "Two sentences carry specific claims. Everything else is my own material rearranged.",
      qualityValue: 22,
    },
    {
      id: "vb-primary",
      category: "constraints",
      label: "Open the actual source",
      text: "Find the cited paper, locate the page, read the sentence it is attributed to.",
      qualityValue: 34,
    },
    {
      id: "vb-secondai",
      category: "constraints",
      label: "Ask a second AI",
      text: "Paste the answer into a different chatbot and ask if it is correct.",
      qualityValue: 4,
    },
    {
      id: "vb-askagain",
      category: "constraints",
      label: "Ask it if it is sure",
      text: "Reply with: are you certain about that citation?",
      qualityValue: 2,
    },
    {
      id: "vb-record",
      category: "format",
      label: "Record what you checked",
      text: "Note which claims you verified and which you did not.",
      qualityValue: 16,
    },
    {
      id: "vb-drop",
      category: "constraints",
      label: "Drop what you cannot verify",
      text: "If a claim cannot be confirmed in five minutes, cut it rather than hedging it.",
      qualityValue: 18,
    },
  ],
  exampleOutputs: [
    {
      label: "Ask it if it is sure",
      output:
        "It says yes, it is certain. You have learned nothing and now feel better, which is worse than before.",
      qualityScore: 8,
    },
    {
      label: "Ask a second AI",
      output:
        "The second model agrees. Both were trained on overlapping data, so this is a coincidence you have mistaken for evidence.",
      qualityScore: 22,
    },
    {
      label: "Isolate, then open the source",
      output:
        "Two claims identified. One checks out on page 187. The other is attributed to a paper that says something different — caught, and cut.",
      qualityScore: 94,
    },
  ],
};

const lesson2Quiz: QuizStep = {
  id: "ai-ethics-02-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Why is pasting an AI answer into a second AI a weak way to verify it?",
  options: [
    {
      id: "e2q-a",
      label: "The second model cannot read text it did not generate.",
      isCorrect: false,
      feedback: "It can read it perfectly well. That is not the problem.",
    },
    {
      id: "e2q-b",
      label:
        "Two systems trained on overlapping data agreeing is not independent confirmation.",
      isCorrect: true,
      feedback:
        "Right. Agreement between them is much likelier than either being right about a specific obscure fact.",
    },
    {
      id: "e2q-c",
      label: "It takes longer than checking the source.",
      isCorrect: false,
      feedback: "It is usually faster, which is exactly why people do it.",
    },
    {
      id: "e2q-d",
      label: "Models are instructed to agree with each other.",
      isCorrect: false,
      feedback: "No such instruction exists.",
    },
  ],
  explanation:
    "Verification requires an independent source. Two language models are not independent of each other in the way that matters — they learned from much of the same material, so they tend to be wrong in the same directions.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson2Completion: CompletionStep = {
  id: "ai-ethics-02-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Fabrications look more ordinary than the sentences around them.",
    "Asking the model if it is sure produces phrasing, not evidence.",
    "Calibrate checking to stakes, and isolate the one or two risky sentences.",
    "A second AI agreeing is not independent confirmation.",
  ],
  xpReward: 30,
  completionMessage:
    "You have a verification habit that is proportionate, which means you might actually use it.",
  nextLessonId: "ai-ethics-03",
};

/*
 * ============================================================
 * LESSON 3 — BIAS IN AI
 * ============================================================
 */

const lesson3Intro: IntroStep = {
  id: "ai-ethics-03-intro",
  type: "intro",
  title: "Bias in AI",
  subtitle: "Where it comes from, shown rather than lectured about.",
  content:
    "Bias in AI is usually discussed in the abstract, which makes it sound like a moral failing somebody could have chosen to avoid. It is more useful and more uncomfortable to look at exactly how ordinary decisions produce it, because the decisions all look reasonable at the time.",
  learningObjectives: [
    "Trace bias back to specific choices about data and measurement.",
    "See how an imbalanced training set produces uneven outcomes.",
    "Understand why fairness has several definitions that conflict.",
  ],
  estimatedMinutes: 3,
};

const lesson3Concept1: ConceptStep = {
  id: "ai-ethics-03-step-01",
  type: "concept",
  visual: {
    type: "diagram",
    data: {
      nodes: [
        {
          id: "world",
          label: "The world",
          caption: "Already uneven",
        },
        {
          id: "data",
          label: "What got recorded",
          caption: "Unevenly, for practical reasons",
        },
        {
          id: "choice",
          label: "What we chose to measure",
          caption: "A proxy for what we meant",
        },
        {
          id: "model",
          label: "The model",
          caption: "Learns all three at once",
        },
      ],
      links: [
        { from: "world", to: "data", label: "sampled" },
        { from: "data", to: "choice", label: "labelled" },
        { from: "choice", to: "model", label: "learned" },
      ],
    },
  },
  title: "Three Places It Enters",
  requiresCompletion: false,
  content:
    "Bias enters at three points and the middle one causes most of the arguments. Historical: the world the data came from was already uneven, so a model that predicts it accurately reproduces it. Representation: some groups are in the data more than others, usually for boring logistical reasons. Measurement: we could not measure what we cared about, so we measured something correlated with it — and the gap between the proxy and the real thing is where the damage lives.",
  examples: [
    {
      id: "bias-representation",
      title: "Representation",
      description:
        "Nobody decided to under-sample. It was just harder to collect.",
      input: "A voice dataset recorded mostly in one country.",
      output: "Higher error rates for everyone else, discovered later.",
    },
    {
      id: "bias-measurement",
      title: "Measurement",
      description:
        "The proxy is easy to count and is not the thing you meant.",
      input:
        "Predicting good employee using length of previous tenure.",
      output:
        "Anybody who took time out is penalised for something unrelated to their work.",
    },
  ],
  misconception:
    "A model can be perfectly accurate and still unfair. If it accurately predicts an unjust pattern, accuracy is what makes it harmful rather than what excuses it.",
};

const lesson3Activity1: FairnessMetricsActivityStep = {
  id: "ai-ethics-03-step-02",
  type: "activity",
  interactiveType: "fairness_metrics",
  title: "Fair By Which Definition?",
  requiresCompletion: true,
  instructions:
    "One lending model, four groups, three definitions of fair. Switch between them and watch the model become fair and unfair without a single number changing.",
  completion: {
    type: "required_actions",
    requiredActions: ["compare-metrics"],
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "They genuinely cannot all be satisfied at once. Choosing between them is a value judgement wearing a statistical costume.",
    incorrect:
      "Switch definitions and look at which group is treated worst under each. They disagree.",
  },
  showTradeoffs: true,
  initialMetric: "equal-rate",
  targetMetric: "equal-error",
  groups: [
    {
      id: "gr-a",
      label: "Group A",
      sampleCount: 4200,
      approvalRate: 71,
      representationRate: 58,
      truePositiveRate: 88,
    },
    {
      id: "gr-b",
      label: "Group B",
      sampleCount: 1800,
      approvalRate: 52,
      representationRate: 25,
      truePositiveRate: 86,
    },
    {
      id: "gr-c",
      label: "Group C",
      sampleCount: 900,
      approvalRate: 49,
      representationRate: 12,
      truePositiveRate: 71,
    },
    {
      id: "gr-d",
      label: "Group D",
      sampleCount: 360,
      approvalRate: 44,
      representationRate: 5,
      truePositiveRate: 63,
    },
  ],
  metrics: [
    {
      id: "equal-rate",
      label: "Equal approval rates",
      description:
        "Every group approved at the same rate. Intuitive, and ignores whether applications differ.",
      formula: "approval rate equal across groups",
    },
    {
      id: "equal-error",
      label: "Equal error rates",
      description:
        "Being wrong about you is equally likely whichever group you are in.",
      formula: "true positive rate equal across groups",
    },
    {
      id: "equal-treatment",
      label: "Identical treatment",
      description:
        "The same inputs always produce the same decision, group ignored entirely.",
      formula: "same input, same output",
    },
  ],
  configurations: [
    {
      id: "cf-rate",
      metricId: "equal-rate",
      settings: { target: 71 },
      groupResults: { "gr-a": 71, "gr-b": 52, "gr-c": 49, "gr-d": 44 },
      tradeoffs: [
        "Currently fails: a 27-point spread in approval.",
        "Fixing it means approving applications the model rates as weaker.",
        "Improves outcomes for C and D immediately.",
      ],
      explanation:
        "The definition most people reach for first. It equalises outcomes and says nothing about whether individual decisions were sound.",
    },
    {
      id: "cf-error",
      metricId: "equal-error",
      settings: { target: 88 },
      groupResults: { "gr-a": 88, "gr-b": 86, "gr-c": 71, "gr-d": 63 },
      tradeoffs: [
        "A and B are served well; C and D are misjudged far more often.",
        "The gap tracks sample size almost exactly.",
        "Fixing it needs more data, not a different threshold.",
      ],
      explanation:
        "Asks a different question: not who gets approved, but who the model is wrong about. Here it exposes that D is being guessed at.",
    },
    {
      id: "cf-treatment",
      metricId: "equal-treatment",
      settings: { target: 100 },
      groupResults: { "gr-a": 100, "gr-b": 100, "gr-c": 100, "gr-d": 100 },
      tradeoffs: [
        "Passes perfectly by construction.",
        "Passes even when the inputs themselves encode past unfairness.",
        "The most defensible-sounding and the easiest to satisfy without changing anything.",
      ],
      explanation:
        "Treating everyone identically is fair only if the inputs are fair. When they carry history, identical treatment carries it forward unchanged.",
    },
  ],
};

const lesson3Concept2: ConceptStep = {
  id: "ai-ethics-03-step-03",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "The claim",
        body: "We removed the sensitive field from the data, so the model cannot be biased on it.",
      },
      after: {
        label: "What happens",
        body: "The model reconstructs it from postcode, school, name and purchase history, and now nobody can measure what it is doing.",
      },
      transform: "Removing the label does not remove the signal",
    },
  },
  title: "Why Deleting the Column Fails",
  requiresCompletion: false,
  content:
    "The intuitive fix is to delete the sensitive attribute, and it is worse than doing nothing. Everything else in the data correlates with it — where you live, where you studied, what you buy — so the model reconstructs a proxy without being asked to. What deletion actually removes is your ability to measure whether that is happening. You have kept the bias and thrown away the instrument.",
  examples: [
    {
      id: "proxy",
      title: "The proxy reappears",
      description: "Postcode alone reconstructs most of what was deleted.",
      input: "Remove the field, keep the address.",
      output: "Same outcomes, no way to audit them.",
    },
    {
      id: "measure",
      title: "Keep it to measure it",
      description:
        "Hold the attribute for auditing while excluding it from the decision.",
      input: "Exclude from the model, retain for evaluation.",
      output: "You can now see the disparity you are trying to fix.",
    },
  ],
  misconception:
    "Fairness cannot be delegated to a preprocessing step. It is a property of the whole system in its actual setting, which is why it has to be measured after deployment and not certified before it.",
};

const lesson3Activity2: DatasetImbalanceActivityStep = {
  id: "ai-ethics-03-step-04",
  type: "activity",
  interactiveType: "dataset_imbalance",
  title: "Rebalance and Watch",
  requiresCompletion: true,
  instructions:
    "A speech recognition training set, grouped by accent. Change the balance and watch the error rates move. Notice what happens to the group that was over-represented.",
  completion: {
    type: "required_actions",
    requiredActions: ["rebalance-distribution"],
    allowPartialCredit: true,
    maxAttempts: 8,
  },
  feedback: {
    correct:
      "The gain for the under-represented groups is much larger than the loss for the over-represented one. That asymmetry is the argument.",
    incorrect:
      "Move weight away from the largest group and watch what the smallest one does.",
  },
  allowRebalancing: true,
  showRecommendationRates: true,
  groups: [
    {
      id: "acc-1",
      label: "Southern",
      initialPercentage: 61,
      recommendationRate: 96,
      explanation:
        "Over-represented because it was the easiest to collect near the lab. Nobody chose this as a policy.",
    },
    {
      id: "acc-2",
      label: "Northern",
      initialPercentage: 22,
      recommendationRate: 89,
      explanation: "Well enough covered to work, noticeably worse than the top group.",
    },
    {
      id: "acc-3",
      label: "Scottish",
      initialPercentage: 11,
      recommendationRate: 74,
      explanation:
        "Thin coverage. Users in this group report having to repeat themselves constantly.",
    },
    {
      id: "acc-4",
      label: "Second-language",
      initialPercentage: 6,
      recommendationRate: 58,
      explanation:
        "Barely represented, and the most varied group in the set — the two problems compound.",
    },
  ],
  initialDistribution: { "acc-1": 61, "acc-2": 22, "acc-3": 11, "acc-4": 6 },
  targetDistribution: { "acc-1": 30, "acc-2": 25, "acc-3": 23, "acc-4": 22 },
  simulationResults: [
    {
      distribution: { "acc-1": 61, "acc-2": 22, "acc-3": 11, "acc-4": 6 },
      recommendationRates: { "acc-1": 96, "acc-2": 89, "acc-3": 74, "acc-4": 58 },
      disparityScore: 38,
      explanation:
        "Headline accuracy 91 percent, which is what goes in the announcement. A 38-point spread, which does not.",
    },
    {
      distribution: { "acc-1": 45, "acc-2": 24, "acc-3": 17, "acc-4": 14 },
      recommendationRates: { "acc-1": 95, "acc-2": 90, "acc-3": 82, "acc-4": 71 },
      disparityScore: 24,
      explanation:
        "The top group lost one point. The bottom group gained thirteen. This is the trade in its clearest form.",
    },
    {
      distribution: { "acc-1": 30, "acc-2": 25, "acc-3": 23, "acc-4": 22 },
      recommendationRates: { "acc-1": 93, "acc-2": 91, "acc-3": 88, "acc-4": 84 },
      disparityScore: 9,
      explanation:
        "Headline accuracy 89 percent — lower than where you started, and a far better system for almost everyone using it.",
    },
  ],
};

const lesson3Quiz: QuizStep = {
  id: "ai-ethics-03-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "A team deletes the sensitive attribute from their training data. What is the most likely result?",
  options: [
    {
      id: "e3q-a",
      label: "The model becomes unbiased.",
      isCorrect: false,
      feedback:
        "The signal survives in everything correlated with it.",
    },
    {
      id: "e3q-b",
      label:
        "The model reconstructs it from correlated fields, and nobody can measure the disparity any more.",
      isCorrect: true,
      feedback:
        "Right — the bias is kept and the instrument for detecting it is thrown away.",
    },
    {
      id: "e3q-c",
      label: "The model becomes much less accurate overall.",
      isCorrect: false,
      feedback:
        "Accuracy usually barely moves, which is part of why the approach seems to work.",
    },
    {
      id: "e3q-d",
      label: "The model refuses to make predictions for those groups.",
      isCorrect: false,
      feedback: "It has no way to know which groups those are, by construction.",
    },
  ],
  explanation:
    "Postcode, school, name and purchase history between them reconstruct most sensitive attributes. Deleting the column removes your ability to audit the outcome without removing the pattern producing it.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson3Completion: CompletionStep = {
  id: "ai-ethics-03-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Bias enters through history, representation and measurement choices.",
    "A perfectly accurate model can be harmful precisely because it is accurate.",
    "Fair has several definitions that cannot all hold at once.",
    "Deleting the sensitive column keeps the bias and removes the measurement.",
  ],
  xpReward: 32,
  completionMessage:
    "You can now point at where bias entered a specific system rather than describing it in general.",
  nextLessonId: "ai-ethics-04",
};

/*
 * ============================================================
 * LESSON 4 — PRIVACY & PERSONAL DATA
 * ============================================================
 */

const lesson4Intro: IntroStep = {
  id: "ai-ethics-04-intro",
  type: "intro",
  title: "Privacy & Personal Data",
  subtitle: "What happens to what you type, and what to type instead.",
  content:
    "This lesson is practical rather than philosophical. What actually happens to a message you send a chatbot, what is safe to include, and what to do about the fact that the most useful requests are usually the ones carrying the most personal detail.",
  learningObjectives: [
    "Describe what typically happens to text you send an AI service.",
    "Redact a real message without destroying its usefulness.",
    "Write a personal rule for what you will and will not share.",
  ],
  estimatedMinutes: 3,
};

const lesson4Concept1: ConceptStep = {
  id: "ai-ethics-04-step-01",
  type: "concept",
  visual: {
    type: "flow",
    data: {
      stages: [
        { id: "type", label: "You type it", caption: "Feels private" },
        { id: "send", label: "It leaves your device", caption: "To a company" },
        { id: "store", label: "It is stored", caption: "For a period you did not set" },
        {
          id: "maybe",
          label: "It may train future models",
          caption: "Depending on a setting you probably did not check",
        },
      ],
    },
  },
  title: "Where It Actually Goes",
  requiresCompletion: false,
  content:
    "A chat window looks like a private note and behaves like a message to a company. The text leaves your device, is stored for some retention period, is readable by staff under some circumstances, and on consumer tiers is often eligible to train future models unless you turned that off. None of that is scandalous — it is how most online services work — but it does mean the reasonable question is not is this safe, it is would I mind if this were kept.",
  examples: [
    {
      id: "feels",
      title: "How it feels",
      description: "Like a search box, or a notes app.",
      input: "Typing a worry at eleven at night.",
      output: "A sense of privacy the interface did not earn.",
    },
    {
      id: "is",
      title: "What it is",
      description: "A message, stored, to a company.",
      input: "The same text.",
      output: "Retained, possibly reviewed, possibly trained on.",
    },
  ],
  misconception:
    "Deleting a conversation removes it from your history. It does not necessarily remove it from backups, from logs, or from a model that has already been trained on it.",
};

const lesson4Activity1: DataRedactionActivityStep = {
  id: "ai-ethics-04-step-02",
  type: "activity",
  interactiveType: "data_redaction",
  title: "Redact Without Ruining It",
  requiresCompletion: true,
  instructions:
    "A real message somebody was about to send a chatbot. Redact what should not be shared — and leave what the request genuinely needs, because a message stripped of everything is a message that gets no help.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "Notice the request still works. Redaction is about identifiers, not about detail.",
    incorrect:
      "Ask whether each item identifies a person or merely describes a situation.",
  },
  allowUndo: true,
  showRedactionPreview: true,
  requiredRedactions: [
    "g-name",
    "g-nhs",
    "g-condition",
    "g-card",
    "g-address",
  ],
  document: {
    id: "chatbot-message",
    title: "Message about to be sent to a public chatbot",
    content:
      "Hi, I need help writing an appeal letter. My name is Daniel Okafor and my NHS number is 943 476 5919. I was off school from March because of my depression diagnosis, which is why I missed the deadline. My mum's card ending 4417 was declined so we could not pay the 240 pound deposit. We live at 8 Marsh Lane, Kesgrave. Can you write something to my head of year? Everyone just calls me Daniel.",
    fields: [
      {
        id: "g-name",
        text: "Daniel Okafor",
        startIndex: 53,
        endIndex: 66,
        dataType: "name",
        shouldRedact: true,
      },
      {
        id: "g-nhs",
        text: "943 476 5919",
        startIndex: 88,
        endIndex: 100,
        dataType: "medical_record",
        shouldRedact: true,
      },
      {
        id: "g-condition",
        text: "depression diagnosis",
        startIndex: 144,
        endIndex: 164,
        dataType: "medical_record",
        shouldRedact: true,
      },
      {
        id: "g-card",
        text: "card ending 4417",
        startIndex: 211,
        endIndex: 227,
        dataType: "financial",
        shouldRedact: true,
      },
      {
        id: "g-amount",
        text: "240 pound",
        startIndex: 265,
        endIndex: 274,
        dataType: "financial",
        shouldRedact: false,
      },
      {
        id: "g-address",
        text: "8 Marsh Lane, Kesgrave",
        startIndex: 295,
        endIndex: 317,
        dataType: "address",
        shouldRedact: true,
      },
      {
        id: "g-firstname",
        text: "Daniel",
        startIndex: 386,
        endIndex: 392,
        dataType: "name",
        shouldRedact: false,
      },
    ],
  },
  sensitiveFields: [
    {
      id: "gf-name",
      type: "name",
      label: "Full name",
      riskLevel: "high",
      explanation:
        "Attaches everything else in the message to a specific person. A first name is enough for the letter to be written.",
    },
    {
      id: "gf-nhs",
      type: "medical_record",
      label: "NHS number",
      riskLevel: "high",
      explanation:
        "A national health identifier. Nothing about writing an appeal letter needs it.",
    },
    {
      id: "gf-condition",
      type: "medical_record",
      label: "Named diagnosis",
      riskLevel: "high",
      explanation:
        "The hardest call on this page. The letter needs the fact of a medical absence; it does not need the diagnosis named. Health information about you deserves the highest bar.",
    },
    {
      id: "gf-card",
      type: "financial",
      label: "Card details",
      riskLevel: "high",
      explanation:
        "Even partial card numbers should never be typed into a chat window.",
    },
    {
      id: "gf-address",
      type: "address",
      label: "Home address",
      riskLevel: "high",
      explanation:
        "Locates the family. The appeal letter works exactly as well without it.",
    },
    {
      id: "gf-amount",
      type: "financial",
      label: "An amount of money",
      riskLevel: "low",
      explanation:
        "A figure with no account attached identifies nobody, and the letter needs it to make sense. Redacting this would be reflex rather than judgement.",
    },
  ],
};

const lesson4Concept2: ConceptStep = {
  id: "ai-ethics-04-step-03",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Fine to share",
        points: [
          "The shape of a situation",
          "Text you wrote yourself",
          "Public information",
          "Amounts, dates, general facts",
        ],
      },
      right: {
        label: "Keep out",
        points: [
          "Identifiers: full name, address, IDs",
          "Anything about your health",
          "Card or account numbers",
          "Other people's information",
        ],
      },
    },
  },
  title: "A Rule You Can Actually Follow",
  requiresCompletion: false,
  content:
    "The right-hand column has an item people consistently forget: other people's information. You can make a decision about your own privacy. You cannot make one on behalf of the friend whose situation you are describing, or the teacher whose email you are pasting in for help with a reply. That is the case worth building a habit around, because it is the one where the person affected never finds out it happened.",
  examples: [
    {
      id: "yours",
      title: "Your own call",
      description: "You get to weigh this however you like.",
      input: "Describing your own situation without identifiers.",
      output: "A decision you are entitled to make.",
    },
    {
      id: "theirs",
      title: "Not your call",
      description: "A decision about somebody who is not in the room.",
      input: "Pasting a friend's message to ask how to reply.",
      output: "Their words, stored by a company, without their knowledge.",
    },
  ],
  misconception:
    "It is only a chatbot is doing the work in most oversharing. The same person would not email that information to a company they had never heard of, and the interface is the only difference.",
};

const lesson4Activity2: PolicyCreatorActivityStep = {
  id: "ai-ethics-04-step-04",
  type: "activity",
  interactiveType: "policy_creator",
  title: "Write Your Own Rule",
  requiresCompletion: true,
  instructions:
    "Build the rule you will actually use. Some of these are load-bearing, some are reasonable, and one or two sound responsible while being impossible to follow.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "A rule you can follow at eleven at night while stressed is worth five you cannot.",
    incorrect:
      "Ask of each: would you actually do this every time, including when you were in a hurry?",
  },
  minimumPolicies: 4,
  requiredPolicies: [
    "gp-no-ids",
    "gp-no-health",
    "gp-no-others",
    "gp-shape-not-specifics",
  ],
  categories: [
    {
      id: "gc-privacy",
      label: "What stays out",
      description: "Information that should never be in the box.",
    },
    {
      id: "gc-oversight",
      label: "Other people",
      description: "Decisions that are not yours to make.",
    },
    {
      id: "gc-transparency",
      label: "Knowing the setting",
      description: "What the service does with what you send.",
    },
  ],
  policyTiles: [
    {
      id: "gp-no-ids",
      label: "No identifiers",
      description:
        "No full name, address, phone, email, student or account numbers.",
      category: "privacy",
      required: true,
    },
    {
      id: "gp-no-health",
      label: "Nothing about my health",
      description:
        "Describe the effect if the request needs it, never the diagnosis.",
      category: "privacy",
      required: true,
    },
    {
      id: "gp-no-others",
      label: "Nothing identifying about anyone else",
      description:
        "Other people did not agree to this and will never know it happened.",
      category: "oversight",
      required: true,
    },
    {
      id: "gp-shape-not-specifics",
      label: "Share the shape, not the specifics",
      description:
        "A situation described generically gets the same quality of help.",
      category: "privacy",
      required: true,
    },
    {
      id: "gp-check-setting",
      label: "Check the training setting once",
      description:
        "Find out whether your conversations train future models, and decide deliberately.",
      category: "transparency",
    },
    {
      id: "gp-never-personal",
      label: "Never discuss anything personal at all",
      description:
        "Sounds strict and gets abandoned the first time you actually need help. A rule you will break is worse than one you will keep.",
      category: "privacy",
    },
    {
      id: "gp-read-terms",
      label: "Read the full terms before every session",
      description:
        "Nobody does this, including the people who recommend it. Unfollowable.",
      category: "transparency",
    },
  ],
};

const lesson4Quiz: QuizStep = {
  id: "ai-ethics-04-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Which of these is the case people most often overlook when deciding what to type into a chatbot?",
  options: [
    {
      id: "e4q-a",
      label: "Their own full name.",
      isCorrect: false,
      feedback: "Widely known to be worth avoiding, even if people slip.",
    },
    {
      id: "e4q-b",
      label: "Information about somebody else who has not agreed to it.",
      isCorrect: true,
      feedback:
        "Right. You can weigh your own privacy. Weighing someone else's on their behalf is a different act, and they never find out.",
    },
    {
      id: "e4q-c",
      label: "Card numbers.",
      isCorrect: false,
      feedback: "Almost everybody already knows not to.",
    },
    {
      id: "e4q-d",
      label: "The date.",
      isCorrect: false,
      feedback: "Identifies nobody.",
    },
  ],
  explanation:
    "Pasting a friend's message or a teacher's email to get help replying sends their words to a company they never chose, and the person affected has no way of knowing. It is the commonest and least-discussed case.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson4Completion: CompletionStep = {
  id: "ai-ethics-04-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "A chat window feels private and behaves like a message to a company.",
    "Redaction is about identifiers, not about removing all detail.",
    "Other people's information is the case people most often overlook.",
    "A rule you will follow while stressed beats a stricter one you will not.",
  ],
  xpReward: 35,
  completionMessage:
    "You have a rule you can actually keep, which is the only kind that protects anybody.",
  nextLessonId: "ai-ethics-05",
};

/*
 * ============================================================
 * LESSON 5 — AI, SCHOOL & ACADEMIC INTEGRITY
 * ============================================================
 */

const lesson5Intro: IntroStep = {
  id: "ai-ethics-05-intro",
  type: "intro",
  title: "AI, School & Academic Integrity",
  subtitle: "The honest version of this conversation.",
  content:
    "Most versions of this discussion are a list of prohibitions written by people who are not the ones sitting the exam. This one starts somewhere else: the line between AI helped me think and AI did it for me is real, it matters for you rather than for the rules, and it is not always where the school handbook puts it.",
  learningObjectives: [
    "Locate the line between assistance and substitution, and say why it is there.",
    "Reason about cases the rules do not cleanly cover.",
    "Explain why the line matters to you rather than only as a rule.",
  ],
  estimatedMinutes: 3,
};

const lesson5Concept1: ConceptStep = {
  id: "ai-ethics-05-step-01",
  type: "concept",
  visual: {
    type: "comparison",
    data: {
      left: {
        label: "Helped me think",
        points: [
          "Explained something until I understood it",
          "Asked me questions about my argument",
          "Found the weak point in my draft",
          "I could reproduce the reasoning tomorrow",
        ],
      },
      right: {
        label: "Did it for me",
        points: [
          "Produced the argument I submitted",
          "Wrote sentences I could not have written",
          "Supplied conclusions I cannot defend",
          "I could not reproduce any of it",
        ],
      },
    },
  },
  title: "Where the Line Actually Is",
  requiresCompletion: false,
  content:
    "The test that holds up is not how much AI touched the work. It is whether you could reproduce the thinking without it. An AI that explained a concept four times until it clicked has left you with something you own. An AI that wrote a paragraph you could not have written has left you with a paragraph and nothing else — and the reason that matters is not that you might get caught, it is that you will sit an exam in a room where it is not available, and the gap will be exactly the size of what you outsourced.",
  examples: [
    {
      id: "own-it",
      title: "You own the result",
      description: "Tomorrow, unaided, you could do it again.",
      input: "Explain this until I get it, then test me on it.",
      output: "Understanding that persists.",
    },
    {
      id: "borrowed",
      title: "You are holding a result",
      description: "Tomorrow, unaided, you could not.",
      input: "Write me a paragraph arguing that.",
      output: "A paragraph, and a gap where the reasoning should be.",
    },
  ],
  misconception:
    "Getting away with it is the wrong frame in both directions. It suggests the only cost is detection, when the actual cost is arriving at an exam having practised nothing.",
};

const lesson5Activity1: EthicsDialActivityStep = {
  id: "ai-ethics-05-step-02",
  type: "activity",
  interactiveType: "ethics_dial",
  title: "Where Would You Put the Line?",
  requiresCompletion: true,
  instructions:
    "A school is writing its AI policy and has asked students. Move the dials and see what each policy actually produces — including what happens to the students it was meant to help.",
  completion: {
    type: "required_actions",
    requiredActions: ["reach-viable-outcome"],
    allowPartialCredit: true,
    maxAttempts: 10,
  },
  feedback: {
    correct:
      "Notice that the strictest policy is not the one that produces the most learning.",
    incorrect:
      "Push a dial to its maximum and read what happens to students who were already struggling.",
  },
  showTradeoffGraph: true,
  scenario: {
    id: "school-policy",
    title: "A school AI policy, written with students in the room",
    description:
      "Every student has access to AI at home. The school has to decide what it permits, what it forbids, and what it expects to be declared.",
    context:
      "Enforcement is limited: detection tools are unreliable and produce false accusations, which fall hardest on students who write unusually. Whatever the policy says, most of the compliance will be voluntary.",
  },
  priorities: [
    {
      id: "integrity",
      label: "Protecting assessment",
      description:
        "How confident anyone can be that submitted work reflects the student.",
      weight: 35,
    },
    {
      id: "learning",
      label: "Protecting learning",
      description:
        "Whether students end up able to do the thing unaided.",
      weight: 40,
    },
    {
      id: "access",
      label: "Fairness of access",
      description:
        "Whether the policy works for students without support at home.",
      weight: 25,
    },
  ],
  constraints: [
    {
      id: "declare",
      label: "Declared use is never punished",
      description:
        "Honesty has to be survivable or nobody will be honest.",
      required: true,
    },
    {
      id: "no-detectors",
      label: "No decisions based on detector output alone",
      description:
        "They are unreliable and the false positives land on the wrong students.",
      required: true,
    },
    {
      id: "in-person",
      label: "Some assessment happens unaided, in the room",
      description:
        "The only reliable check, and it does not require accusing anybody.",
      required: true,
    },
    {
      id: "teach-it",
      label: "The school teaches how to use it well",
      description:
        "A ban with no instruction leaves everyone to work it out alone.",
      required: false,
    },
  ],
  outcomes: [
    {
      id: "oe-ban",
      settings: { integrity: 100, learning: 30, access: 20 },
      description:
        "Total ban. Use continues, undeclared, and nobody can ask a teacher for help using it well. The students who most needed guidance get none.",
      safetyScore: 45,
      fairnessScore: 35,
      legalComplianceScore: 70,
    },
    {
      id: "oe-free",
      settings: { integrity: 20, learning: 35, access: 90 },
      description:
        "Anything goes, no declaration. Coursework stops meaning anything and the gap only appears in the exam hall, too late to fix.",
      safetyScore: 40,
      fairnessScore: 60,
      legalComplianceScore: 30,
    },
    {
      id: "oe-balanced",
      settings: { integrity: 70, learning: 85, access: 75 },
      description:
        "Use it, declare it, and some assessment happens unaided in the room. Declaration is never punished, so declarations actually happen.",
      safetyScore: 88,
      fairnessScore: 86,
      legalComplianceScore: 90,
    },
    {
      id: "oe-detect",
      settings: { integrity: 90, learning: 50, access: 30 },
      description:
        "Heavy reliance on detection software. Produces false accusations against students who write unusually, and the students who use AI carefully are never caught anyway.",
      safetyScore: 40,
      fairnessScore: 25,
      legalComplianceScore: 55,
    },
  ],
};

const lesson5Concept2: ConceptStep = {
  id: "ai-ethics-05-step-03",
  type: "concept",
  visual: {
    type: "timeline",
    data: {
      milestones: [
        {
          id: "q1",
          when: "Ask",
          label: "Could I reproduce this?",
          caption: "Tomorrow, unaided",
        },
        {
          id: "q2",
          when: "Then",
          label: "Whose argument is it?",
          caption: "Mine, or one I received",
        },
        {
          id: "q3",
          when: "Then",
          label: "Would I say how I did it?",
          caption: "To the person marking it",
        },
        {
          id: "q4",
          when: "Then",
          label: "Declare it",
          caption: "Where declaration is allowed",
        },
      ],
    },
  },
  title: "Three Questions, Asked Honestly",
  requiresCompletion: false,
  content:
    "The third question does most of the work. If you would not be comfortable telling your teacher exactly how the work was produced, you already know the answer, and you knew it before you asked. That discomfort is not guilt about breaking a rule — it is a fairly accurate detector for having submitted something as yours that was not.",
  examples: [
    {
      id: "comfortable",
      title: "Comfortable saying it",
      description: "Usually means the line was not crossed.",
      input: "It quizzed me until I could explain it, then I wrote this.",
      output: "Nothing to hide, because nothing was substituted.",
    },
    {
      id: "uncomfortable",
      title: "Uncomfortable saying it",
      description: "The discomfort is the finding.",
      input: "It wrote the middle section and I changed some words.",
      output: "You knew before you finished the sentence.",
    },
  ],
  misconception:
    "Rewriting AI output in your own words is often treated as the fix. If the argument, structure and conclusions are still the model's, paraphrasing changes who typed it and nothing else.",
};

const lesson5Activity2: DecisionTreeActivityStep = {
  id: "ai-ethics-05-step-04",
  type: "activity",
  interactiveType: "decision_tree_builder",
  title: "Build the Test",
  requiresCompletion: true,
  instructions:
    "Turn the three questions into a rule, then run six real situations through it. Some of these are genuinely arguable — the point is that your rule gives you a consistent answer.",
  completion: {
    type: "all_correct",
    allowPartialCredit: true,
    maxAttempts: 5,
  },
  feedback: {
    correct:
      "A rule that gives you the same answer whether or not you are behind on the deadline is a rule worth having.",
    incorrect:
      "Start with whether the argument is yours, then whether you could reproduce it.",
  },
  showLivePreview: true,
  allowReordering: true,
  targetCategories: ["Fine", "Declare it", "Over the line"],
  dataset: [
    {
      id: "ai1",
      name: "Asked it to explain osmosis four times until it clicked, then wrote my own answer",
      attributes: { ownArgument: true, couldReproduce: true, wouldTellTeacher: true },
      correctCategory: "Fine",
    },
    {
      id: "ai2",
      name: "Asked it to write the conclusion, then changed a few words",
      attributes: { ownArgument: false, couldReproduce: false, wouldTellTeacher: false },
      correctCategory: "Over the line",
    },
    {
      id: "ai3",
      name: "Used it to find the weak point in my own argument, then fixed it myself",
      attributes: { ownArgument: true, couldReproduce: true, wouldTellTeacher: true },
      correctCategory: "Fine",
    },
    {
      id: "ai4",
      name: "Had it suggest a structure, then wrote everything myself within that structure",
      attributes: { ownArgument: true, couldReproduce: true, wouldTellTeacher: false },
      correctCategory: "Declare it",
    },
    {
      id: "ai5",
      name: "Had it generate three arguments, picked one, and defended it in my own words",
      attributes: { ownArgument: false, couldReproduce: true, wouldTellTeacher: false },
      correctCategory: "Declare it",
    },
    {
      id: "ai6",
      name: "Submitted its draft with light edits and cited nothing",
      attributes: { ownArgument: false, couldReproduce: false, wouldTellTeacher: false },
      correctCategory: "Over the line",
    },
  ],
  availableConditions: [
    {
      id: "cond-own",
      label: "Is the argument mine?",
      attribute: "ownArgument",
      operator: "equals",
      value: true,
    },
    {
      id: "cond-repro",
      label: "Could I reproduce it unaided tomorrow?",
      attribute: "couldReproduce",
      operator: "equals",
      value: true,
    },
    {
      id: "cond-tell",
      label: "Would I happily tell my teacher exactly how I did it?",
      attribute: "wouldTellTeacher",
      operator: "equals",
      value: true,
    },
  ],
  solution: {
    rootConditionId: "cond-repro",
    nodes: [
      {
        id: "n-repro",
        label: "Could reproduce it?",
        conditionId: "cond-repro",
        yesChildId: "n-own",
        noChildId: "n-over",
      },
      { id: "n-over", label: "Over the line", result: "Over the line" },
      {
        id: "n-own",
        label: "Argument is mine?",
        conditionId: "cond-own",
        yesChildId: "n-tell",
        noChildId: "n-declare",
      },
      { id: "n-declare", label: "Declare it", result: "Declare it" },
      {
        id: "n-tell",
        label: "Would say how?",
        conditionId: "cond-tell",
        yesChildId: "n-fine",
        noChildId: "n-declare-2",
      },
      { id: "n-fine", label: "Fine", result: "Fine" },
      { id: "n-declare-2", label: "Declare it", result: "Declare it" },
    ],
    classifications: {
      ai1: "Fine",
      ai2: "Over the line",
      ai3: "Fine",
      ai4: "Declare it",
      ai5: "Declare it",
      ai6: "Over the line",
    },
  },
};

const lesson5Quiz: QuizStep = {
  id: "ai-ethics-05-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "Which test most reliably separates AI helped me think from AI did it for me?",
  options: [
    {
      id: "e5q-a",
      label: "How many words of the final text the AI generated.",
      isCorrect: false,
      feedback:
        "A word count misses the case where it supplied the argument and you typed every word.",
    },
    {
      id: "e5q-b",
      label: "Whether you could reproduce the thinking unaided tomorrow.",
      isCorrect: true,
      feedback:
        "Right. It captures both what you learned and what you can defend, and it does not depend on who typed what.",
    },
    {
      id: "e5q-c",
      label: "Whether a detector flags it.",
      isCorrect: false,
      feedback:
        "Detectors are unreliable in both directions and measure nothing about your understanding.",
    },
    {
      id: "e5q-d",
      label: "Whether you rewrote the output in your own words.",
      isCorrect: false,
      feedback:
        "Paraphrasing changes who typed it. If the argument is still the model's, nothing else changed.",
    },
  ],
  explanation:
    "The reproduction test tracks the thing that actually matters — whether you can do it in a room where AI is not available — and it does not depend on word counts or unreliable detection.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson5Completion: CompletionStep = {
  id: "ai-ethics-05-completion",
  type: "completion",
  title: "Lesson Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "The test is whether you could reproduce the thinking unaided, not how many words it wrote.",
    "Would I tell my teacher exactly how I did this is a reliable detector.",
    "Paraphrasing AI output changes who typed it and nothing else.",
    "The strictest policy is not the one that produces the most learning.",
  ],
  xpReward: 38,
  completionMessage:
    "You have a line you can defend, arrived at rather than handed to you.",
  nextLessonId: "ai-ethics-06",
};

/*
 * ============================================================
 * LESSON 6 — ETHICAL AI CHALLENGE
 * ============================================================
 */

const lesson6Intro: IntroStep = {
  id: "ai-ethics-06-intro",
  type: "intro",
  title: "Ethical AI Challenge",
  subtitle: "Real scenarios, no single correct answer, reasoning that counts.",
  content:
    "This capstone is scenarios rather than questions. Several have no answer everyone would agree on, and that is deliberate — what is being tested is whether you can name what is actually at stake and act consistently with it, not whether you can find the response somebody wanted.",
  learningObjectives: [
    "Reason through situations the rules do not cleanly cover.",
    "Decide and act rather than describing considerations.",
    "Calibrate how much verification a situation actually deserves.",
  ],
  estimatedMinutes: 5,
};

const lesson6Concept1: ConceptStep = {
  id: "ai-ethics-06-step-01",
  type: "concept",
  visual: {
    type: "before_after",
    data: {
      before: {
        label: "Not an answer",
        body: "It depends on the situation and there are considerations on both sides.",
      },
      after: {
        label: "An answer",
        body: "I would open the paper first, because a fabricated citation in submitted work is a misconduct meeting and checking takes four minutes.",
      },
      transform: "Name the stake, then decide",
    },
  },
  title: "Reasoning Means Deciding",
  requiresCompletion: false,
  content:
    "There is a way of discussing ethics that consists entirely of noticing that things are complicated. It is comfortable and it is not reasoning. Reasoning names what is at stake, weighs it against the cost of acting, and arrives somewhere. You are allowed to be wrong, and you are allowed to disagree with the model answers in what follows. What does not count is refusing to land.",
  examples: [
    {
      id: "no-land",
      title: "Refusing to land",
      description: "Every consideration named, no decision made.",
      input: "There are arguments on both sides here.",
      output: "Nothing you could act on tomorrow.",
    },
    {
      id: "land",
      title: "Landing",
      description: "A decision, with the reason attached.",
      input: "I would check it, because the cost of being wrong is high.",
      output: "Something you could actually do.",
    },
  ],
  misconception:
    "Saying it depends is sometimes exactly right. It becomes evasion when you cannot say what it depends on, or what you would do in the case in front of you.",
};

const lesson6Activity1: TruthAssessmentActivityStep = {
  id: "ai-ethics-06-step-02",
  type: "activity",
  interactiveType: "truth_assessment",
  title: "What Do You Actually Do Next?",
  requiresCompletion: true,
  instructions:
    "Six real situations. For each one, decide what you would actually do — use it as it stands, check it first, or drop it. Some are genuinely arguable. Decide anyway.",
  completion: {
    type: "minimum_correct",
    minimumCorrect: 4,
    allowPartialCredit: true,
    maxAttempts: 4,
  },
  feedback: {
    correct:
      "You are weighing the cost of being wrong against the cost of checking, which is the whole skill.",
    incorrect:
      "Ask what happens if this is wrong, then ask how long checking would take. The answer usually falls out.",
  },
  actions: [
    {
      id: "publish",
      label: "Use it as it stands",
      description: "The stakes do not justify the cost of checking.",
    },
    {
      id: "fact_check",
      label: "Check it first",
      description: "Verify before anything depends on it.",
    },
    {
      id: "discard",
      label: "Drop it",
      description: "Cannot be verified, or should not have been asked.",
    },
  ],
  outputs: [
    {
      id: "sc-citations",
      output:
        "An AI gives you three citations for a paper. Two look familiar. One is a journal you have never heard of.",
      category: "needs_fact_checking",
      correctActionId: "fact_check",
      explanation:
        "The canonical case. Fabricated citations are among the most common failures and among the most serious consequences. All three need opening — including the two that look familiar, because a real journal attached to a paper that does not exist is the harder version.",
    },
    {
      id: "sc-recipe",
      output:
        "It suggests adding a teaspoon of baking soda to your pancake batter.",
      category: "accurate",
      correctActionId: "publish",
      explanation:
        "Well-covered general knowledge, and being wrong costs you one bad pancake. Verifying everything is a rule nobody keeps; this is where the exception lives.",
    },
    {
      id: "sc-medical",
      output:
        "It tells you a dose of a medication that sounds different from what is on the packet.",
      category: "unsafe",
      correctActionId: "discard",
      explanation:
        "Not a checking situation. Drop it and read the packet or ask a pharmacist — the source is right there and the downside is unbounded.",
    },
    {
      id: "sc-friend",
      output:
        "A friend sends you their part of a group project. It reads nothing like them and mentions a study you cannot find.",
      category: "needs_fact_checking",
      correctActionId: "fact_check",
      explanation:
        "Arguable, and the reasoning matters more than the answer. Your name is going on it, so the study needs checking before submission regardless of how the conversation with your friend goes.",
    },
    {
      id: "sc-summary",
      output:
        "It summarises a long article you pasted in, and the summary matches what you remember reading.",
      category: "accurate",
      correctActionId: "publish",
      explanation:
        "Transformation of material you supplied, and you have already spot-checked it against your own reading. Solid ground.",
    },
    {
      id: "sc-stat",
      output:
        "For a class presentation, it gives you a striking statistic with no source attached.",
      category: "fabricated",
      correctActionId: "discard",
      explanation:
        "A round unsourced number in front of an audience is the classic shape of a fabrication. Either find a real source and cite that, or drop the point — presenting it unsourced puts your name behind it.",
    },
  ],
};

const lesson6Activity2: ParameterTuningActivityStep = {
  id: "ai-ethics-06-step-03",
  type: "activity",
  interactiveType: "parameter_tuning",
  title: "How Much Checking Is Enough?",
  requiresCompletion: true,
  instructions:
    "Verification has a cost and so does being wrong. Move the dials for a specific piece of work and find the point where more checking stops being worth it — there is one, in both directions.",
  completion: {
    type: "target_score",
    targetScore: 80,
    allowPartialCredit: true,
    maxAttempts: 12,
  },
  feedback: {
    correct:
      "Neither zero checking nor checking everything scores well. Proportion is the whole answer.",
    incorrect:
      "Try turning checking to maximum and watch what happens to whether the work gets finished.",
  },
  targetAccuracy: 80,
  parameters: [
    {
      id: "stakes",
      label: "Cost of being wrong",
      description:
        "From a bad pancake to an academic misconduct meeting.",
      min: 0,
      max: 10,
      step: 1,
    },
    {
      id: "claims-checked",
      label: "Share of specific claims checked",
      description:
        "How many of the retrievable facts you actually go and confirm.",
      min: 0,
      max: 10,
      step: 1,
    },
    {
      id: "source-quality",
      label: "How primary your sources are",
      description:
        "From asking another chatbot to opening the original document.",
      min: 0,
      max: 10,
      step: 1,
    },
    {
      id: "time-spent",
      label: "Time spent verifying",
      description:
        "Real minutes, which come out of the time you had for the work itself.",
      min: 0,
      max: 10,
      step: 1,
      unit: "units",
    },
  ],
  initialValues: {
    stakes: 8,
    "claims-checked": 0,
    "source-quality": 2,
    "time-spent": 0,
  },
  accuracyModel: {
    baselineAccuracy: 25,
    minAccuracy: 10,
    maxAccuracy: 96,
    effects: [
      {
        parameterId: "claims-checked",
        optimalRange: [6, 9],
        effectStrength: 28,
        description:
          "Checking the specific retrievable claims is where nearly all the protection comes from. Checking every sentence adds almost nothing.",
      },
      {
        parameterId: "source-quality",
        optimalRange: [7, 10],
        effectStrength: 30,
        description:
          "Going to the primary source is worth more than any amount of asking another model.",
      },
      {
        parameterId: "time-spent",
        optimalRange: [3, 6],
        effectStrength: 20,
        description:
          "Some time is essential. Past a point you are re-reading things you already confirmed and running out of time for the work.",
      },
      {
        parameterId: "stakes",
        optimalRange: [0, 10],
        effectStrength: 12,
        description:
          "Stakes do not change what is true — they change how much checking is proportionate. High stakes with no checking is the failure case.",
      },
    ],
  },
  feedbackThresholds: [
    {
      minAccuracy: 0,
      maxAccuracy: 45,
      message:
        "High stakes and nothing checked. This is the combination that produces the misconduct meeting.",
    },
    {
      minAccuracy: 45,
      maxAccuracy: 75,
      message:
        "Some checking, but the sources are weak. Where are you actually confirming this?",
    },
    {
      minAccuracy: 75,
      maxAccuracy: 101,
      message:
        "Proportionate: the specific claims checked, against real sources, in time you could actually spare.",
    },
  ],
};

const lesson6Quiz: QuizStep = {
  id: "ai-ethics-06-quiz",
  type: "quiz",
  title: "Knowledge Check",
  requiresCompletion: true,
  questionText:
    "An AI gives you three citations for a paper. What do you actually do next?",
  options: [
    {
      id: "e6q-a",
      label: "Use the two that look familiar and drop the unfamiliar one.",
      isCorrect: false,
      feedback:
        "Familiarity is not verification, and the harder failure is a real journal attached to a paper that does not exist.",
    },
    {
      id: "e6q-b",
      label: "Open all three and confirm each says what it is cited for.",
      isCorrect: true,
      feedback:
        "Right. High stakes, low cost to check, and the failure mode is specifically designed to look plausible.",
    },
    {
      id: "e6q-c",
      label: "Ask the AI whether the citations are real.",
      isCorrect: false,
      feedback:
        "It will produce whatever typically follows that question. Not evidence.",
    },
    {
      id: "e6q-d",
      label: "Cite them and add a note that they came from an AI.",
      isCorrect: false,
      feedback:
        "Declaring where they came from does not make a fabricated reference acceptable in a bibliography.",
    },
  ],
  explanation:
    "Citations are the highest-risk output there is: fabrications are common, they look exactly like real references, and the consequence of one landing in submitted work is severe. Checking takes minutes, which makes this one of the clearest cost-benefit calls in the course.",
  allowRetry: true,
  showExplanationAfterAnswer: true,
};

const lesson6Completion: CompletionStep = {
  id: "ai-ethics-06-completion",
  type: "completion",
  title: "Course Complete",
  requiresCompletion: false,
  keyTakeaways: [
    "Reasoning means landing somewhere, not listing considerations.",
    "Match verification effort to the cost of being wrong.",
    "Citations are the highest-risk output and the cheapest to check.",
    "Trust is a judgement you make per question, not a setting you choose once.",
  ],
  xpReward: 60,
  completionMessage:
    "You finished AI Ethics & Responsibility. There is no mission at the end of this one — the output of this course is judgement, and you will use it every time you open a chat window.",
};

/*
 * ============================================================
 * LESSON OBJECTS
 * ============================================================
 */

export const aiEthicsLessons: Lesson[] = [
  {
    id: "ai-ethics-01",
    courseId: "ai-ethics",
    courseTitle: "AI Ethics & Responsibility",
    number: 1,
    title: "Can You Trust AI?",
    description:
      "What AI is reliably good at and what it is not — and why confidence in an answer says nothing about its correctness.",
    track: "AI Ethics",
    conceptIds: ["two-kinds-of-question", "confidence-is-flat"],
    challengeIds: ["onto-solid-ground", "same-certainty"],
    prerequisites: [],
    totalXp: 100,
    estimatedMinutes: 22,
    learningObjectives: [
      "Separate what AI is reliably good at from what it is not.",
      "Explain why confidence says nothing about correctness.",
      "Calibrate trust by the kind of question being asked.",
    ],
    keyTakeaways: [
      "Trust is per-question, not per-model.",
      "Transformation of supplied material is solid ground.",
      "Confidence stays flat while correctness swings.",
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
    id: "ai-ethics-02",
    courseId: "ai-ethics",
    courseTitle: "AI Ethics & Responsibility",
    number: 2,
    title: "Hallucinations & Verification",
    description:
      "A real example of a confident wrong answer, and how to check something proportionately instead of taking it on faith.",
    track: "AI Ethics",
    conceptIds: ["shape-of-a-fabrication", "check-proportionately"],
    challengeIds: ["does-this-need-checking", "verification-habit"],
    prerequisites: ["ai-ethics-01"],
    totalXp: 120,
    estimatedMinutes: 24,
    learningObjectives: [
      "Recognise the shape of a fabricated detail.",
      "Sort answers by whether they need verifying.",
      "Build a verification approach proportionate to the stakes.",
    ],
    keyTakeaways: [
      "Fabrications look more ordinary than the text around them.",
      "Asking the model if it is sure produces phrasing, not evidence.",
      "A second AI agreeing is not independent confirmation.",
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
    id: "ai-ethics-03",
    courseId: "ai-ethics",
    courseTitle: "AI Ethics & Responsibility",
    number: 3,
    title: "Bias in AI",
    description:
      "Where bias comes from — training data and design choices — shown through concrete examples rather than described in the abstract.",
    track: "AI Ethics",
    conceptIds: ["three-places-bias-enters", "deleting-the-column-fails"],
    challengeIds: ["fair-by-which-definition", "rebalance-and-watch"],
    prerequisites: ["ai-ethics-02"],
    totalXp: 130,
    estimatedMinutes: 25,
    learningObjectives: [
      "Trace bias to specific choices about data and measurement.",
      "See how an imbalanced training set produces uneven outcomes.",
      "Understand why definitions of fairness conflict.",
    ],
    keyTakeaways: [
      "Bias enters through history, representation and measurement.",
      "Fair has several definitions that cannot all hold at once.",
      "Deleting the sensitive column removes the measurement, not the bias.",
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
    id: "ai-ethics-04",
    courseId: "ai-ethics",
    courseTitle: "AI Ethics & Responsibility",
    number: 4,
    title: "Privacy & Personal Data",
    description:
      "What happens to what you type into an AI, what is safe to share, and the case almost everybody overlooks.",
    track: "AI Ethics",
    conceptIds: ["where-it-actually-goes", "a-rule-you-can-follow"],
    challengeIds: ["redact-without-ruining", "write-your-own-rule"],
    prerequisites: ["ai-ethics-03"],
    totalXp: 140,
    estimatedMinutes: 25,
    learningObjectives: [
      "Describe what happens to text you send an AI service.",
      "Redact a message without destroying its usefulness.",
      "Write a personal rule you will actually keep.",
    ],
    keyTakeaways: [
      "A chat window feels private and behaves like a message to a company.",
      "Redaction is about identifiers, not about removing all detail.",
      "Other people's information is the overlooked case.",
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
    id: "ai-ethics-05",
    courseId: "ai-ethics",
    courseTitle: "AI Ethics & Responsibility",
    number: 5,
    title: "AI, School & Academic Integrity",
    description:
      "The honest version: where the line sits between AI helped me think and AI did it for me, and why it matters for you rather than as a rule.",
    track: "AI Ethics",
    conceptIds: ["where-the-line-is", "three-questions"],
    challengeIds: ["where-would-you-put-the-line", "build-the-test"],
    prerequisites: ["ai-ethics-04"],
    totalXp: 150,
    estimatedMinutes: 26,
    learningObjectives: [
      "Locate the line between assistance and substitution.",
      "Reason about cases the rules do not cleanly cover.",
      "Explain why the line matters to you, not only as a rule.",
    ],
    keyTakeaways: [
      "The test is whether you could reproduce the thinking unaided.",
      "Would I tell my teacher exactly how I did this is a reliable detector.",
      "Paraphrasing changes who typed it and nothing else.",
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
    id: "ai-ethics-06",
    courseId: "ai-ethics",
    courseTitle: "AI Ethics & Responsibility",
    number: 6,
    title: "Ethical AI Challenge",
    description:
      "The capstone: real scenarios with no single forced answer, rewarding reasoning rather than a lookup.",
    track: "AI Ethics",
    conceptIds: ["reasoning-means-deciding"],
    challengeIds: ["what-do-you-do-next", "how-much-checking"],
    prerequisites: [
      "ai-ethics-01",
      "ai-ethics-02",
      "ai-ethics-03",
      "ai-ethics-04",
      "ai-ethics-05",
    ],
    totalXp: 300,
    estimatedMinutes: 30,
    isCapstone: true,
    learningObjectives: [
      "Reason through situations the rules do not cleanly cover.",
      "Decide and act rather than listing considerations.",
      "Calibrate verification to what a situation actually deserves.",
    ],
    keyTakeaways: [
      "Reasoning means landing somewhere.",
      "Match verification effort to the cost of being wrong.",
      "Citations are the highest-risk output and the cheapest to check.",
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

export const aiEthicsCurriculum: Curriculum = {
  id: "ai-ethics",
  name: "AI Ethics & Responsibility",
  description:
    "Trust, hallucinations, bias, privacy and academic integrity — built around concrete examples and scenarios rather than rules, and ending on a capstone that rewards reasoning over a lookup answer.",
  concepts: [],
  lessons: aiEthicsLessons,
  challenges: [],
  totalXp: aiEthicsLessons.reduce(
    (total, lesson) => total + lesson.totalXp,
    0,
  ),
};

export default aiEthicsLessons;
