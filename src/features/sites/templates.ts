/*
 * The four layouts.
 *
 * These are not one page with six colour schemes. The thing
 * that separates them is where the chat lives and how the
 * content flows around it, because that is the actual design
 * decision a student is making — "is this a thing people come
 * to talk to, or a thing people come to read about that also
 * talks?" Everything else follows from the answer.
 *
 *   assistant  chat is the page. Hero above it, everything else
 *              below the fold. One column, centred.
 *   study      chat fills a working pane; identity, capability
 *              list and prompts live in a sticky sidebar beside
 *              it. Two columns, viewport-height, tool-shaped.
 *   portfolio  editorial scroll. Full-bleed hero, alternating
 *              content bands, chat docked as a launcher that
 *              expands over the page. Chat is secondary.
 *   research   a document. Narrow measure, abstract, numbered
 *              sections with a contents rail, and an "ask this
 *              project" panel pinned directly under the
 *              abstract rather than at either end.
 *
 * Every template renders every section kind. A template chooses
 * arrangement, never which of a student's content survives —
 * switching templates must be a thing you can do twice and end
 * up where you started, so nothing here is allowed to be
 * lossy.
 *
 * Pure data, no JSX and no icon imports, so this file can be
 * read by the server as well as the editor.
 */

import {
  newSectionId,
  TEMPLATE_DEFAULT_THEME,
  type SiteConfig,
  type SiteSection,
  type TemplateId,
} from "./schema";

export interface TemplateDefinition {
  id: TemplateId;
  name: string;
  /* One line, in the picker, under the name. */
  blurb: string;
  /* What it is actually for, in a sentence a student can match
     against their own project. */
  bestFor: string;
  /* Where the chat sits. Shown in the picker because it is the
     real difference between these and the thing a student is
     choosing whether they know it or not. */
  chatPlacement: "centre" | "pane" | "dock" | "inline";
  /* Sections this layout leads with when a student picks it
     from scratch. */
  starterSections: SectionKindPreset[];
}

type SectionKindPreset = "about" | "features" | "steps" | "faq" | "text";

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "assistant",
    name: "AI Assistant",
    blurb: "A conversation, front and centre. Everything else is context.",
    bestFor:
      "An agent people are meant to use straight away — a helper, a tutor, a support bot.",
    chatPlacement: "centre",
    starterSections: ["about", "features"],
  },
  {
    id: "study",
    name: "Study Tool",
    blurb: "A workspace. Prompts and capabilities beside a full-height chat.",
    bestFor:
      "A revision aid or practice partner somebody will sit with for half an hour.",
    chatPlacement: "pane",
    starterSections: ["steps", "faq"],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    blurb: "An editorial page that shows the work. Chat waits in the corner.",
    bestFor:
      "Showing an agent to somebody who is judging it — a teacher, a competition, an application.",
    chatPlacement: "dock",
    starterSections: ["about", "features", "text"],
  },
  {
    id: "research",
    name: "Research Project",
    blurb: "A written document with the agent attached to it.",
    bestFor:
      "A project writeup where the method matters as much as the demo.",
    chatPlacement: "inline",
    starterSections: ["about", "steps", "faq"],
  },
];

export function findTemplate(id: TemplateId): TemplateDefinition {
  return TEMPLATES.find((entry) => entry.id === id) ?? TEMPLATES[0];
}

/* =========================================================
   STARTER CONTENT

   Placeholder prose a student is meant to overwrite, and which
   reads as a finished page until they do.

   Every string here is written so that publishing it unchanged
   is embarrassing rather than misleading. "Describe what your
   agent does" is a prompt; "The best study tool ever built" is
   a claim a student did not make. Only the first kind belongs
   in a default.
========================================================= */

function starterSection(
  kind: SectionKindPreset,
  agentName: string,
  description: string
): SiteSection {
  switch (kind) {
    case "about":
      return {
        id: newSectionId(),
        kind: "about",
        title: "About this agent",
        body:
          description ||
          `Describe what ${agentName} is for, who built it, and what somebody should expect from a conversation with it.`,
      };

    case "features":
      return {
        id: newSectionId(),
        kind: "features",
        title: "What it can do",
        items: [
          {
            id: newSectionId("f"),
            icon: "chat",
            title: "Answers questions",
            body: "Replace this with something only your agent does.",
          },
          {
            id: newSectionId("f"),
            icon: "book",
            title: "Knows your material",
            body: "Say which documents or notes it was given.",
          },
          {
            id: newSectionId("f"),
            icon: "spark",
            title: "Explains its reasoning",
            body: "Say what a good answer from it looks like.",
          },
        ],
      };

    case "steps":
      return {
        id: newSectionId(),
        kind: "steps",
        title: "How to use it",
        items: [
          {
            id: newSectionId("t"),
            title: "Ask a question",
            body: "Type anything into the chat. Be specific — it helps.",
          },
          {
            id: newSectionId("t"),
            title: "Follow up",
            body: "It remembers the conversation, so you can dig deeper.",
          },
          {
            id: newSectionId("t"),
            title: "Check the answer",
            body: "It can be wrong. Say what somebody should verify.",
          },
        ],
      };

    case "faq":
      return {
        id: newSectionId(),
        kind: "faq",
        title: "Questions people ask",
        items: [
          {
            id: newSectionId("q"),
            question: "What is this?",
            answer: `${agentName} is an AI agent built on BuildGentic. Replace this answer with your own.`,
          },
          {
            id: newSectionId("q"),
            question: "Where does it get its information?",
            answer: "Say what you gave it, and what it does not know.",
          },
        ],
      };

    case "text":
    default:
      return {
        id: newSectionId(),
        kind: "text",
        title: "How it was built",
        body: "Write about the project — what you tried, what did not work, what you would do next.",
      };
  }
}

export interface StarterInput {
  agentName: string;
  description: string;
  template: TemplateId;
}

/*
 * A whole page, ready to publish, for one template.
 *
 * The hero and the greeting differ per template rather than
 * being shared, because the same sentence does not work in all
 * four. A study tool opens with an offer of help; a research
 * writeup opens with what the project is. Getting that wrong
 * makes a template feel like the wrong choice before a student
 * has changed anything.
 */
export function starterConfig(input: StarterInput): SiteConfig {
  const name = input.agentName.trim() || "My agent";
  const description = input.description.trim();
  const template = findTemplate(input.template);

  const copy = HERO_COPY[template.id](name);

  return {
    version: 1,
    template: template.id,
    theme: TEMPLATE_DEFAULT_THEME[template.id],
    siteName: name,
    hero: {
      headline: copy.headline,
      subtext: description || copy.subtext,
      tagline: copy.tagline,
      showAvatar: true,
    },
    chat: {
      enabled: true,
      greeting: copy.greeting,
      placeholder: copy.placeholder,
      suggestedPrompts: copy.prompts,
      allowUploads: false,
    },
    sections: template.starterSections.map((kind) =>
      starterSection(kind, name, description)
    ),
    footer: { showBadge: true, note: "" },
  };
}

interface HeroCopy {
  headline: string;
  subtext: string;
  tagline: string;
  greeting: string;
  placeholder: string;
  prompts: string[];
}

const HERO_COPY: Record<TemplateId, (name: string) => HeroCopy> = {
  assistant: (name) => ({
    headline: `Ask ${name}`,
    subtext: `${name} is an AI agent. Ask it anything below — it answers in the chat.`,
    tagline: "",
    greeting: `Hi — I'm ${name}. What can I help you with?`,
    placeholder: "Ask a question…",
    prompts: ["What can you help me with?", "How do you work?"],
  }),

  study: (name) => ({
    headline: name,
    subtext: `Work through a topic with ${name}. It keeps up with the conversation, so you can keep asking.`,
    tagline: "Study companion",
    greeting: `Ready when you are. What are you working on?`,
    placeholder: "What are you studying?",
    prompts: [
      "Quiz me on this topic",
      "Explain it more simply",
      "Give me a worked example",
    ],
  }),

  portfolio: (name) => ({
    headline: name,
    subtext:
      "An AI agent built on BuildGentic. Read about how it works, then try it yourself.",
    tagline: "A BuildGentic project",
    greeting: `Hello. Ask me something and see how I do.`,
    placeholder: "Try me…",
    prompts: ["What are you for?", "What are you bad at?"],
  }),

  research: (name) => ({
    headline: name,
    subtext:
      "Describe the question this project set out to answer, in two sentences.",
    tagline: "Research project",
    greeting: `Ask me about this project and I will answer from what I was given.`,
    placeholder: "Ask about this project…",
    prompts: ["What does this project do?", "What are its limitations?"],
  }),
};
