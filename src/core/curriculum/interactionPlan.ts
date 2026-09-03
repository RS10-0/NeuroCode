import type { InteractiveType } from "./Lesson";
import type { Lesson } from "./Lesson";

/*
 * ============================================================
 * INTERACTION VARIETY PLANNER
 * ============================================================
 *
 * Which interactive type each lesson's activity slots get.
 *
 * Two rules, both about how a course feels to sit through:
 * no lesson repeats the type of the lesson beside it, and no
 * handful of types carries the whole platform while the rest
 * are used once and forgotten.
 *
 * The plan is computed, not written down. A hardcoded table
 * would be correct on the day it was typed and wrong the next
 * time a course was added, because "evenly distributed" is a
 * fact about every course at once rather than about any one of
 * them. Adding a course here means adding its spine below and
 * re-running the planner — the balance re-solves itself.
 *
 * The output is deterministic for a given seed, which is what
 * lets authored content be checked against it. Activity
 * payloads are discriminated by interactiveType and cannot be
 * chosen at runtime, so the planner decides and
 * scripts/verify-interaction-plan.mts holds the content to that
 * decision.
 */

export const INTERACTIVE_TYPES: InteractiveType[] = [
  "decision_tree_builder",
  "ai_sorter",
  "dataset_playground",
  "parameter_tuning",
  "model_testing",
  "tokenizer_playground",
  "vector_similarity",
  "next_token_game",
  "prompt_weaver",
  "temperature_slider",
  "prompt_refinement",
  "fact_checker",
  "edge_case_matrix",
  "truth_assessment",
  "dataset_imbalance",
  "fairness_metrics",
  "bias_audit",
  "ethics_dial",
  "data_redaction",
  "policy_creator",
  "capstone_pipeline",
];

/*
 * Types that are not free to be dropped anywhere.
 *
 * Seventeen of the twenty-one are shells: give ai_sorter cards
 * and buckets and it will teach whatever sorts. The rest carry
 * something in their payload that the content cannot talk its
 * way out of, so they are held back and opted into per lesson.
 */

/*
 * Held back because the activity IS a specific mechanism —
 * splitting text into tokens, predicting a next token, distance
 * in meaning-space, a staged build. Put one on a lesson about
 * page copy and you get a working screen that teaches nothing.
 */
export const NARROW_TYPES: InteractiveType[] = [
  "tokenizer_playground",
  "vector_similarity",
  "next_token_game",
  "capstone_pipeline",
];

/*
 * Held back because the payload enums are ethics vocabulary and
 * are not relabelable: ethics_dial scores every outcome on
 * safety, fairness and legal compliance; policy_creator files
 * its tiles under privacy, transparency, oversight, safety and
 * ip; fairness_metrics, dataset_imbalance and bias_audit are
 * built around group representation. These fit wherever a
 * lesson genuinely touches that ground — which is more places
 * than the ethics course, but far from everywhere.
 */
export const DOMAIN_TYPES: InteractiveType[] = [
  "ethics_dial",
  "policy_creator",
  "fairness_metrics",
  "dataset_imbalance",
  "bias_audit",
];

/* Everything a lesson must opt into before it can be assigned. */
export const HELD_TYPES: InteractiveType[] = [
  ...NARROW_TYPES,
  ...DOMAIN_TYPES,
];

export interface LessonSlots {
  lessonId: string;

  /* How many activity steps this lesson has. */
  slots: number;

  /*
   * Types this lesson must use, one per slot, in order.
   * Fewer pins than slots leaves the rest to the planner.
   */
  pin?: InteractiveType[];

  /* Held-back types this lesson is allowed to be given. */
  allow?: InteractiveType[];

  /* Types this lesson must not be given. */
  exclude?: InteractiveType[];
}

export interface CourseSlots {
  courseId: string;

  /* In lesson order — adjacency is judged against this. */
  lessons: LessonSlots[];
}

export interface InteractionPlanRequest {
  courses: CourseSlots[];

  /*
   * Types already spent elsewhere on the platform. Counted
   * before anything is assigned, so a new course fills the
   * gaps left by the courses that already shipped rather than
   * starting the tally from zero.
   */
  baseline?: InteractiveType[];

  seed?: number;
}

/* Every interactive type used by a set of lessons, in order. */
export function collectInteractionTypes(
  lessons: Lesson[]
): InteractiveType[] {
  const used: InteractiveType[] = [];

  for (const lesson of lessons) {
    for (const step of lesson.steps) {
      if (step.type === "activity") {
        used.push(step.interactiveType);
      }
    }
  }

  return used;
}

/*
 * A stable number for a (lesson, slot, type) triple.
 *
 * Ties on usage count are common — early on, every type has
 * been used the same number of times — and breaking them by
 * array order would hand every course the same opening
 * activity. FNV-1a over the triple scatters them instead, and
 * scatters them the same way on every run.
 */
function hash(seed: number, key: string): number {
  let h = 2166136261 ^ seed;

  for (let index = 0; index < key.length; index += 1) {
    h ^= key.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

interface Candidate {
  type: InteractiveType;

  /* Times used in this course already. */
  courseUses: number;

  /* Times used anywhere on the platform already. */
  uses: number;

  tiebreak: number;
}

/*
 * Least-used wins, counted inside the course first.
 *
 * Platform balance alone is not enough: it will happily hand
 * one six-lesson course the same activity three times while the
 * global tally stays flat, and a learner does not experience the
 * global tally. Sorting on the course count first spreads types
 * within a course, and because every unused type ties at zero
 * there, the platform count still decides between them.
 */
function pick(
  candidates: Candidate[]
): InteractiveType | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((best, next) => {
    if (next.courseUses !== best.courseUses) {
      return next.courseUses < best.courseUses ? next : best;
    }

    if (next.uses !== best.uses) {
      return next.uses < best.uses ? next : best;
    }

    return next.tiebreak < best.tiebreak ? next : best;
  }).type;
}

export function planInteractions(
  request: InteractionPlanRequest
): Map<string, InteractiveType[]> {
  const seed = request.seed ?? 1;
  const baseline = request.baseline ?? [];

  const uses = new Map<InteractiveType, number>();

  for (const type of INTERACTIVE_TYPES) {
    uses.set(type, 0);
  }

  for (const type of baseline) {
    uses.set(type, (uses.get(type) ?? 0) + 1);
  }

  /*
   * Pins are decided before anything else, so they are counted
   * before anything else. A free slot that cannot see a pin
   * coming later in the course will happily spend that type up
   * to the cap, and the pin then pushes it past — which is how
   * an otherwise balanced plan ends up with one type used five
   * times and another used three.
   */
  for (const course of request.courses) {
    for (const lesson of course.lessons) {
      for (const pinned of (lesson.pin ?? []).slice(0, lesson.slots)) {
        uses.set(pinned, (uses.get(pinned) ?? 0) + 1);
      }
    }
  }

  const slotTotal = request.courses.reduce(
    (total, course) =>
      total +
      course.lessons.reduce((sum, lesson) => sum + lesson.slots, 0),
    0
  );

  /*
   * The ceiling that makes even distribution structural rather
   * than lucky. Picking the least-used type keeps the floor up;
   * without a cap nothing stops a type that happens to win
   * several tiebreaks from running away from the rest.
   */
  const cap = Math.ceil(
    (baseline.length + slotTotal) / INTERACTIVE_TYPES.length
  );

  const plan = new Map<string, InteractiveType[]>();

  for (const course of request.courses) {
    /*
     * Assignment runs left to right, so "not the same as the
     * lesson before" is checked directly and "not the same as
     * the lesson after" falls out of the next lesson's check.
     * The one case that does not cover is a pin sitting in the
     * next lesson, which is already decided and cannot move —
     * hence the lookahead.
     */
    let previous: InteractiveType[] = [];

    /* Pins count here too, for the same reason they do globally. */
    const courseUses = new Map<InteractiveType, number>();

    for (const lesson of course.lessons) {
      for (const pinned of (lesson.pin ?? []).slice(0, lesson.slots)) {
        courseUses.set(pinned, (courseUses.get(pinned) ?? 0) + 1);
      }
    }

    course.lessons.forEach((lesson, index) => {
      const nextPinned = course.lessons[index + 1]?.pin ?? [];
      const allowed = new Set(lesson.allow ?? []);
      const excluded = new Set(lesson.exclude ?? []);
      const chosen: InteractiveType[] = [];

      for (let slot = 0; slot < lesson.slots; slot += 1) {
        const pinned = lesson.pin?.[slot];

        /* Already counted in the pre-pass above. */
        if (pinned) {
          chosen.push(pinned);
          continue;
        }

        const forbidden = new Set<InteractiveType>([
          ...previous,
          ...nextPinned,
          ...chosen,
          ...excluded,
        ]);

        const eligible = INTERACTIVE_TYPES.filter((type) => {
          if (forbidden.has(type)) {
            return false;
          }

          /* Held types only where the lesson asked for them. */
          return !HELD_TYPES.includes(type) || allowed.has(type);
        });

        const candidates = eligible.map((type) => ({
          type,
          courseUses: courseUses.get(type) ?? 0,
          uses: uses.get(type) ?? 0,
          tiebreak: hash(seed, `${lesson.lessonId}:${slot}:${type}`),
        }));

        /*
         * Under the cap first. If the cap has closed every door,
         * fall back to the same choice without it: an uneven
         * plan is a worse outcome than no plan, but only just,
         * and the verify script reports the spread either way.
         */
        const type =
          pick(candidates.filter((entry) => entry.uses < cap)) ??
          pick(candidates);

        if (!type) {
          throw new Error(
            `No interactive type available for ${lesson.lessonId} slot ${slot}.`
          );
        }

        chosen.push(type);
        uses.set(type, (uses.get(type) ?? 0) + 1);
        courseUses.set(type, (courseUses.get(type) ?? 0) + 1);
      }

      plan.set(lesson.lessonId, chosen);
      previous = chosen;
    });
  }

  return plan;
}

/*
 * ============================================================
 * COURSE SPINES
 * ============================================================
 *
 * The shape of each course as far as the planner cares: how
 * many activities per lesson, and the few places where the
 * subject matter picks the type rather than the planner.
 *
 * Pins are deliberately sparse. Eleven of fifty-two slots are
 * spoken for, and every one of them is a lesson whose content
 * only works as that activity — a lesson called Fix a Terrible
 * Prompt is a prompt_refinement or it is nothing. The other
 * forty-one are the planner's to balance.
 */
export const NEW_COURSE_SPINES: CourseSlots[] = [
  {
    courseId: "prompt-engineering",
    lessons: [
      /* Predicting what the model says next is the lesson. */
      { lessonId: "prompt-engineering-01", slots: 2, pin: ["next_token_game"] },
      { lessonId: "prompt-engineering-02", slots: 2 },
      /* A length limit is a token budget before it is a style. */
      {
        lessonId: "prompt-engineering-03",
        slots: 2,
        pin: ["tokenizer_playground"],
      },
      /* Skewed examples produce skewed answers. */
      {
        lessonId: "prompt-engineering-04",
        slots: 2,
        allow: ["bias_audit", "dataset_imbalance"],
      },
      { lessonId: "prompt-engineering-05", slots: 2 },
      /* The capstone is, literally, a prompt refinement. */
      {
        lessonId: "prompt-engineering-06",
        slots: 2,
        pin: ["prompt_refinement"],
        allow: ["policy_creator"],
      },
    ],
  },
  {
    courseId: "ai-agents",
    lessons: [
      { lessonId: "ai-agents-01", slots: 2 },
      { lessonId: "ai-agents-02", slots: 2 },
      /* What the agent must never do belongs in its brief. */
      {
        lessonId: "ai-agents-03",
        slots: 2,
        allow: ["policy_creator", "ethics_dial"],
      },
      /*
       * Memory is retrieval by similarity; context is a token
       * budget. Both mechanisms earn their place here.
       */
      {
        lessonId: "ai-agents-04",
        slots: 2,
        pin: ["vector_similarity", "tokenizer_playground"],
      },
      /* A tool needs a rule about what it may touch. */
      { lessonId: "ai-agents-05", slots: 2, allow: ["policy_creator"] },
      /* Testing an agent is where you find what it got wrong. */
      {
        lessonId: "ai-agents-06",
        slots: 2,
        allow: [
          "bias_audit",
          "fairness_metrics",
          "ethics_dial",
          "dataset_imbalance",
        ],
      },
      /* The build mission, staged end to end. */
      {
        lessonId: "ai-agents-07",
        slots: 2,
        pin: ["capstone_pipeline"],
        allow: ["policy_creator"],
      },
    ],
  },
  {
    courseId: "ai-websites",
    lessons: [
      { lessonId: "ai-websites-01", slots: 2 },
      /* An audience is a position in meaning-space. */
      { lessonId: "ai-websites-02", slots: 2, pin: ["vector_similarity"] },
      { lessonId: "ai-websites-03", slots: 2 },
      /* Scannable copy is a next-word game played by a reader. */
      { lessonId: "ai-websites-04", slots: 2, pin: ["next_token_game"] },
      { lessonId: "ai-websites-05", slots: 2 },
      /* Reading your own page as somebody who is not you. */
      { lessonId: "ai-websites-06", slots: 2, allow: ["bias_audit"] },
      /*
       * Before it goes public: what is on the page that should
       * not be, and then the publish run itself.
       */
      {
        lessonId: "ai-websites-07",
        slots: 2,
        pin: ["data_redaction", "capstone_pipeline"],
      },
    ],
  },
  {
    courseId: "ai-ethics",
    lessons: [
      /*
       * The domain types are opted into by topic here rather
       * than blanket-allowed across the course. Allowing all
       * five everywhere let the planner spend them on lessons
       * one and two and leave the actual bias lesson holding
       * a temperature slider.
       */
      { lessonId: "ai-ethics-01", slots: 2 },
      { lessonId: "ai-ethics-02", slots: 2 },
      /* The bias lesson gets the representation activities. */
      {
        lessonId: "ai-ethics-03",
        slots: 2,
        allow: ["fairness_metrics", "dataset_imbalance", "bias_audit"],
      },
      /* Redacting what should never have been typed in. */
      {
        lessonId: "ai-ethics-04",
        slots: 2,
        pin: ["data_redaction"],
        allow: ["policy_creator"],
      },
      { lessonId: "ai-ethics-05", slots: 2, allow: ["ethics_dial", "policy_creator"] },
      /* Three citations, and what you actually do next. */
      {
        lessonId: "ai-ethics-06",
        slots: 2,
        pin: ["truth_assessment"],
        allow: ["ethics_dial"],
      },
    ],
  },
];
