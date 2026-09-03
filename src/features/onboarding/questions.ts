export interface LiteracyOption {
  id: string;
  label: string;
  isCorrect: boolean;
  /* Shown after answering — why this option is right or wrong. */
  explanation: string;
}

export interface LiteracyQuestion {
  id: string;
  /* The lesson that teaches this, used to place the learner. */
  lessonId: string;
  lessonNumber: number;
  concept: string;
  prompt: string;
  options: LiteracyOption[];
}

/*
 * The AI Literacy Check.
 *
 * Every question maps to a lesson, so a wrong answer is not just
 * a lost point — it is the reason we recommend starting where we
 * do. The questions probe understanding of the mechanism rather
 * than vocabulary, because knowing the word "token" and knowing
 * what tokenisation implies are different things.
 */
export const LITERACY_QUESTIONS: LiteracyQuestion[] = [
  {
    id: "lc-01",
    lessonId: "ai-foundations-01",
    lessonNumber: 1,
    concept: "rules versus learning",
    prompt:
      "A spam filter and a thermostat both react to their input. What makes only one of them machine learning?",
    options: [
      {
        id: "a",
        label: "The spam filter worked out its own rules from examples",
        isCorrect: true,
        explanation:
          "That is the dividing line. A thermostat follows a rule somebody wrote; the spam filter derived its rule from thousands of labelled emails.",
      },
      {
        id: "b",
        label: "The spam filter is more complicated",
        isCorrect: false,
        explanation:
          "Complexity is not the test. Plenty of complicated software follows hand-written rules, and some machine learning models are very simple.",
      },
      {
        id: "c",
        label: "The spam filter runs on the internet",
        isCorrect: false,
        explanation:
          "Where software runs says nothing about how it decides. A learned model can run entirely on your phone.",
      },
    ],
  },
  {
    id: "lc-02",
    lessonId: "ai-foundations-02",
    lessonNumber: 2,
    concept: "training data",
    prompt:
      "A hiring model is trained on ten years of a company's past hires. What is it actually learning to predict?",
    options: [
      {
        id: "a",
        label: "Who this company has historically hired",
        isCorrect: true,
        explanation:
          "Exactly. It learns the pattern in the data it was given — past decisions, including any that were unfair — not who would do the job well.",
      },
      {
        id: "b",
        label: "Who will perform best in the role",
        isCorrect: false,
        explanation:
          "That would require data on performance, which the model never saw. It only ever learns the target it was actually given.",
      },
      {
        id: "c",
        label: "Who is most qualified on paper",
        isCorrect: false,
        explanation:
          "Only if past hiring tracked qualifications perfectly. The model reproduces the decisions in the data, whatever drove them.",
      },
    ],
  },
  {
    id: "lc-03",
    lessonId: "ai-foundations-03",
    lessonNumber: 3,
    concept: "how language models work",
    prompt: "When a language model writes a sentence, what is it doing?",
    options: [
      {
        id: "a",
        label: "Choosing a likely next piece of text, over and over",
        isCorrect: true,
        explanation:
          "Yes. There is no plan for the sentence and no separate check that it is true — each token is chosen given everything before it.",
      },
      {
        id: "b",
        label: "Looking up the answer in the text it was trained on",
        isCorrect: false,
        explanation:
          "It is not a search index. It cannot cite where an answer came from, which is also why it can produce text that appears nowhere in its training data.",
      },
      {
        id: "c",
        label: "Reasoning through the problem, then writing the conclusion",
        isCorrect: false,
        explanation:
          "The output can look like reasoning, but the mechanism underneath is next-token prediction. That gap is why it can be fluent and wrong at once.",
      },
    ],
  },
  {
    id: "lc-04",
    lessonId: "ai-foundations-04",
    lessonNumber: 4,
    concept: "prompting",
    prompt:
      "Which change is most likely to improve the answer to \"write about climate change\"?",
    options: [
      {
        id: "a",
        label:
          "Say who it is for, how long it should be, and what to cover",
        isCorrect: true,
        explanation:
          "Right. Anything you leave unspecified, the model decides for you — and it will not tell you that it guessed.",
      },
      {
        id: "b",
        label: "Add \"you are a world-class expert\" at the start",
        isCorrect: false,
        explanation:
          "Role-play phrasing is the most over-rated prompting trick. It shifts tone slightly; it does not tell the model what you actually want.",
      },
      {
        id: "c",
        label: "Ask it politely and say the task is important",
        isCorrect: false,
        explanation:
          "Urgency and politeness do not add information. Specificity does.",
      },
    ],
  },
  {
    id: "lc-05",
    lessonId: "ai-foundations-05",
    lessonNumber: 5,
    concept: "hallucination and confidence",
    prompt:
      "An AI gives you a citation with a title, authors, and a page number. It does not exist. What went wrong?",
    options: [
      {
        id: "a",
        label: "It generated text shaped like a citation, which is all it does",
        isCorrect: true,
        explanation:
          "A plausible-looking citation is exactly what next-token prediction produces. Nothing in the process checks that the paper is real.",
      },
      {
        id: "b",
        label: "Its training data contained that wrong citation",
        isCorrect: false,
        explanation:
          "Sometimes, but usually not. Fabricated citations are typically assembled from patterns rather than copied from anywhere.",
      },
      {
        id: "c",
        label: "It had a bug or was having an off day",
        isCorrect: false,
        explanation:
          "This is normal operation, not a malfunction. Treating it as a rare glitch is what gets people caught out.",
      },
    ],
  },
  {
    id: "lc-06",
    lessonId: "ai-foundations-06",
    lessonNumber: 6,
    concept: "bias",
    prompt:
      "A face-recognition system is far less accurate for some groups than others. What is the most common cause?",
    options: [
      {
        id: "a",
        label: "Those groups were underrepresented in the training data",
        isCorrect: true,
        explanation:
          "The usual culprit. A group that is a thin slice of the training data gets served worse, and no rule anywhere had to say so.",
      },
      {
        id: "b",
        label: "Someone wrote biased rules into the code",
        isCorrect: false,
        explanation:
          "Almost never. That is what makes this hard to catch — there is no line of code to point at.",
      },
      {
        id: "c",
        label: "Some faces are objectively harder to recognise",
        isCorrect: false,
        explanation:
          "This one is worth being careful with — it is the explanation that lets teams off the hook. Systems trained on balanced data do not show the same gaps.",
      },
    ],
  },
  {
    id: "lc-07",
    lessonId: "ai-foundations-07",
    lessonNumber: 7,
    concept: "responsible use",
    prompt:
      "You want to use an AI tool to summarise a friend's medical letter. What should you do first?",
    options: [
      {
        id: "a",
        label: "Remove the details that identify them",
        isCorrect: true,
        explanation:
          "Anything you paste in leaves your control and may be retained. Names, dates of birth, and record numbers all identify a person.",
      },
      {
        id: "b",
        label: "Nothing — it is only a summary",
        isCorrect: false,
        explanation:
          "The summary is not the risk; the input is. You are sending someone else's medical information to a third party.",
      },
      {
        id: "c",
        label: "Check the tool has a privacy policy",
        isCorrect: false,
        explanation:
          "Worth doing, but it is not consent. A policy governs what the company may do, not whether your friend agreed to any of it.",
      },
    ],
  },
  {
    id: "lc-08",
    lessonId: "ai-foundations-08",
    lessonNumber: 8,
    concept: "building with AI",
    prompt: "An AI writes you working code in seconds. What is still your job?",
    options: [
      {
        id: "a",
        label: "Deciding what it should do, and testing that it does",
        isCorrect: true,
        explanation:
          "Direction and verification stay with you. Code that runs is not the same as code that is correct, and the model cannot tell the difference.",
      },
      {
        id: "b",
        label: "Nothing much, if it runs without errors",
        isCorrect: false,
        explanation:
          "Running without errors only means the syntax is valid. It says nothing about whether the behaviour is what you wanted.",
      },
      {
        id: "c",
        label: "Rewriting it yourself so you understand it",
        isCorrect: false,
        explanation:
          "Understanding matters, but rewriting everything by hand gives up the point. Reading, testing, and directing is the workable middle.",
      },
    ],
  },
];

export const GOALS = [
  {
    id: "understand",
    label: "Understand how AI actually works",
    detail: "You keep hearing about it and want the real mechanism.",
  },
  {
    id: "build_agent",
    label: "Build an AI agent",
    detail: "Something with a purpose that other people can use.",
  },
  {
    id: "build_app",
    label: "Build software with AI",
    detail: "Turn an idea into a working, deployed application.",
  },
  {
    id: "school",
    label: "Use AI well for school",
    detail: "Without getting it wrong, or getting in trouble.",
  },
];

export const EXPERIENCE = [
  {
    id: "none",
    label: "None at all",
    detail: "I have not really used AI tools.",
  },
  {
    id: "chatbots",
    label: "I have used chatbots",
    detail: "ChatGPT, Claude, Gemini — that sort of thing.",
  },
  {
    id: "tinkering",
    label: "I tinker",
    detail: "I write prompts deliberately and notice what changes.",
  },
  {
    id: "building",
    label: "I have built things",
    detail: "Code, automations, or something with an API.",
  },
];

export type LiteracyLevel = "starting" | "grounded" | "confident";

export interface Placement {
  score: number;
  level: LiteracyLevel;
  /* Where to open. Always a lesson the learner can actually enter. */
  recommendedLessonId: string;
  headline: string;
  reason: string;
  /* Where the genuinely new material begins, if not at the start. */
  newMaterialFrom?: number;
  strengths: string[];
  gaps: string[];
}

/*
 * Turns answers into a starting point.
 *
 * Lessons unlock in order, so the recommendation is always the
 * first lesson — anything else would point at a locked row on
 * the course map. What the check actually changes is the framing:
 * a confident learner is told which lessons they will move
 * through quickly and where the new material starts, rather than
 * being sent somewhere they cannot open.
 */
export function placeLearner(answers: Record<string, string>): Placement {
  const graded = LITERACY_QUESTIONS.map((question) => {
    const chosen = question.options.find(
      (option) => option.id === answers[question.id]
    );

    return { question, correct: Boolean(chosen?.isCorrect) };
  });

  const score = graded.filter((entry) => entry.correct).length;

  const strengths = graded
    .filter((entry) => entry.correct)
    .map((entry) => entry.question.concept);

  const gaps = graded
    .filter((entry) => !entry.correct)
    .map((entry) => entry.question.concept);

  const firstGap = graded.find((entry) => !entry.correct)?.question;

  let level: LiteracyLevel = "starting";
  if (score >= 7) {
    level = "confident";
  } else if (score >= 4) {
    level = "grounded";
  }

  const headline =
    level === "confident"
      ? "You already know most of this"
      : level === "grounded"
        ? "You have the basics"
        : "Good place to start";

  let reason: string;

  if (level === "starting") {
    reason =
      "Several of these are genuinely counter-intuitive, and the course is built for exactly this starting point. Lesson one begins with what separates AI from ordinary software.";
  } else if (firstGap) {
    reason = `You were solid on ${strengths.length} of ${LITERACY_QUESTIONS.length}. Lessons unlock in order, so you will start at the beginning — but expect to move quickly until lesson ${firstGap.lessonNumber}, where ${firstGap.concept} comes in.`;
  } else {
    reason =
      "You got every one. The lessons still start at the beginning, but the activities are where the real work is — that is where this will stop feeling familiar.";
  }

  return {
    score,
    level,
    /* Prerequisites gate the course, so this is always the entry point. */
    recommendedLessonId: LITERACY_QUESTIONS[0].lessonId,
    headline,
    reason,
    newMaterialFrom: firstGap?.lessonNumber,
    strengths,
    gaps,
  };
}
