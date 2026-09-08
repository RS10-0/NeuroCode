import type { FlagshipId } from "../flagships";

/*
 * What "give it your material" means for each of the six.
 *
 * The desk is one component, not six. Every flagship carries
 * knowledge_retrieval, memory, data_store and
 * document_generation, so the SHAPE of the screen is the same
 * for all of them and only the words differ — which is the
 * cheapest possible way to make six purpose-built screens, and
 * the reason this file is data rather than five more layouts.
 *
 * Same method as sites/flagship/identity.ts, and deliberately
 * so: a copy table beside a catalogue entry, no JSX, no imports
 * beyond the id type. The difference is that this one covers
 * ALL SIX. identity.ts is a Partial because Email Agent must
 * never have a public page; every flagship has an owner, so
 * every flagship needs desk copy.
 *
 * The examples are the load-bearing part. "Add knowledge" is an
 * instruction nobody acts on; "the syllabus you are being
 * examined on" is one somebody can go and find.
 */

export interface DeskMaterialCopy {
  /* This agent's own word for its knowledge. Never "knowledge" —
     that is the schema's word, not the student's. */
  title: string;
  /* One line saying what giving it material actually buys. */
  lede: string;
  /* Three concrete things worth handing over, in the order a
     student is most likely to have them. */
  examples: string[];
}

export interface DeskCopy {
  /* Under the agent's name. Shorter than the catalogue's
     description, which the masthead already shows. */
  opening: string;
  material: DeskMaterialCopy;
}

/*
 * The generic desk, used for an id this build has no copy for.
 *
 * A retired flagship still has an owner who paid for it, so it
 * gets a working screen with honest wording rather than an
 * empty one. Same argument identity.ts makes for returning
 * undefined and falling through to a template.
 */
const FALLBACK: DeskCopy = {
  opening: "Give it what it should work from, and it will use that instead of guessing.",
  material: {
    title: "Its material",
    lede: "Anything you give it here is searched for every question you ask, so it can answer from your material rather than from what a model happened to have read.",
    examples: [
      "Notes or documents it should work from",
      "Rules or standards it should hold to",
      "Examples of what a good answer looks like",
    ],
  },
};

const COPY: Record<FlagshipId, DeskCopy> = {
  "study-tutor": {
    opening:
      "It already knows how to teach. What it does not know is what you are being taught.",
    material: {
      title: "Your course material",
      lede: "Give it what you are actually being examined on and it stops explaining the general case. It will use your wording, your topics and your mark scheme instead of a textbook's.",
      examples: [
        "The syllabus or specification for your course",
        "Class notes for a topic you are stuck on",
        "A past paper, and its mark scheme if you have one",
      ],
    },
  },

  "writing-coach": {
    opening:
      "It reads like an editor. Give it the piece and the standard you are being held to.",
    material: {
      title: "Your draft and your brief",
      lede: "It comes with its own craft rules. What it cannot guess is the assignment — the brief you were set, the house style, the things your marker takes points off for.",
      examples: [
        "The draft you are working on",
        "The brief, prompt or question you were given",
        "A style guide, or the rubric you are marked against",
      ],
    },
  },

  "research-assistant": {
    opening:
      "It knows how to weigh a source. It does not yet know which ones are yours.",
    material: {
      title: "Your sources and your question",
      lede: "Give it the material you are working from and it will answer out of that, and tell you which part it used — rather than out of whatever it read during training.",
      examples: [
        "Papers, articles or reports you are working from",
        "Your research question, and what is out of scope",
        "The citation style you have to write in",
      ],
    },
  },

  "coding-coach": {
    opening:
      "It explains the bug rather than handing you the patch. Show it what the project expects.",
    material: {
      title: "Your project's own rules",
      lede: "It can reason about code without any of this. What it cannot know is your conventions — so without them it will suggest the common answer rather than the one your codebase would accept.",
      examples: [
        "The conventions or style your project follows",
        "The spec or ticket you are building against",
        "An error you keep hitting, with what you have already tried",
      ],
    },
  },

  "career-explorer": {
    opening:
      "It asks better questions when it knows what you are actually weighing up.",
    material: {
      title: "What you are weighing up",
      lede: "It will not hand you an answer either way — that is the design. But it can only ask about the choice in front of you if it knows what that choice is.",
      examples: [
        "Subjects you are taking, or thinking about taking",
        "A job or course description that caught your eye",
        "Notes from anyone already doing the work",
      ],
    },
  },

  "email-agent": {
    opening:
      "Connect a mailbox below. Then tell it how you want to sound in a reply.",
    material: {
      title: "How you want replies written",
      lede: "It drafts; you send. Everything you put here shapes what a draft looks like before you read it — which is the only moment you get to change it cheaply.",
      examples: [
        "How formal you are with colleagues, and with strangers",
        "Answers you find yourself sending over and over",
        "Anything you never want said on your behalf",
      ],
    },
  },
};

/*
 * Always returns copy. See FALLBACK for why an unknown id gets
 * a working desk rather than nothing.
 */
export function deskCopy(id: string | null | undefined): DeskCopy {
  return COPY[id as FlagshipId] ?? FALLBACK;
}
