import { findFlagship, type FlagshipId } from "../../agents/flagships";
import type { CapabilityId } from "../../agents/vocab";

/*
 * The five signature pages, as words.
 *
 * BuildGentic's own agents get their own public page rather than
 * one of the four templates a student picks from, and this is
 * the spine every one of them is built on: what it calls
 * itself, what it says above the fold, how its conversation
 * opens, and what a visitor sees before they have typed
 * anything.
 *
 * WHY THIS IS A MODULE AND NOT A STORED DOCUMENT.
 *
 * A student's page is a `SiteConfig` in a row, because it is
 * theirs and they edit it. A flagship's page is not editable by
 * anybody — migration 0015's policy, enforced by
 * `requireEditableAgent` and explained on the Customise screen
 * — so storing its copy would mean a sentence that can only be
 * improved by writing a migration, and improved only for pages
 * published after it ran. Resolving here instead means the
 * exact thing `AgentStore` already does with flagship prompts:
 * a page published last term picks up today's design and
 * today's wording the next time somebody opens it.
 *
 * The stored config still decides the things that are actually
 * the learner's: whether the page is up, and where it lives.
 *
 * A LEAF MODULE. Types and data only, no JSX and no imports
 * beyond the catalogue, so a component can read it without
 * pulling a layout in behind it.
 */

export type FlagshipMode = "light" | "dark";

export interface FlagshipChatCopy {
  /* The agent's first line. Not sent back as history — see
     `useSiteChat` — so it can address the reader directly. */
  greeting: string;
  placeholder: string;
  /* What the composer's submit control says, for a page where
     "Send" is the wrong verb. */
  sendLabel: string;
  /* One line under the composer. The place to put the caveat
     that would otherwise have to live in a paragraph nobody
     reads. */
  hint: string;
  /* Shown in the transcript before a visitor has said anything.
     Each layout draws it differently; the words are here. */
  openingTitle: string;
  openingBody: string;
}

export interface FlagshipIdentity {
  id: FlagshipId;
  /* The agent's own name is on the row and may differ if
     BuildGentic ever renames one; this is what the DESIGN is,
     and it is what the masthead says. */
  name: string;
  /* Small type above the headline. Sets the register of the
     whole page in three words. */
  eyebrow: string;
  headline: string;
  deck: string;
  /* Light or dark is part of the identity here rather than a
     visitor preference or a stored field. A workbench that
     opened white would not be a workbench. */
  mode: FlagshipMode;
  chat: FlagshipChatCopy;
  /* What the page says about itself at the bottom, in place of
     a student's own footer note. The AI disclosure is added by
     the footer component and is not optional — see
     `FlagshipFooter`. */
  footnote: string;
}

/* =========================================================
   THE FIVE

   Five, not six, and the gap is a decision rather than a
   backlog item.

   Email Agent has no entry here because it has no published
   page — `publishable: false` in the catalogue, refused by the
   site route, and every email capability is hard `false` on the
   published door anyway. A page for it would be an email
   assistant that cannot see any email, published under
   BuildGentic's name, describing what it does while being
   unable to do it.

   `Partial` rather than `Record` is what encodes that. A
   `Record` would demand an identity for every flagship, and the
   only way to satisfy it would be to write copy for a page that
   must never exist — which is how the missing thing quietly
   becomes real. `flagshipIdentity` already returns undefined
   for an id it does not know, and `FlagshipSite` already
   renders nothing when it does, so the absent case was handled
   before there was one.
========================================================= */

const IDENTITIES: Partial<Record<FlagshipId, FlagshipIdentity>> = {
  /* -------------------------------------------------------
     WRITING COACH — the manuscript desk

     Editorial register throughout: passes, marginalia, folios.
     The page is a working surface for a draft, so the words
     assume somebody has one.
     ------------------------------------------------------- */
  "writing-coach": {
    id: "writing-coach",
    name: "Writing Coach",
    eyebrow: "Manuscript desk",
    headline: "Bring a draft. Leave with a better one.",
    deck:
      "Paste what you have written — an essay, a story, an email you are nervous about — and get the specific, unflattering, useful notes an editor would write in the margin.",
    mode: "light",
    chat: {
      greeting:
        "Paste a draft and tell me what you want from it — or ask me something about the writing you are stuck on.",
      placeholder: "Paste a draft, or describe what you are writing…",
      sendLabel: "Send to the desk",
      hint: "Your draft stays in this conversation. Nothing here writes the essay for you.",
      openingTitle: "The desk is clear.",
      openingBody:
        "Start with a pass, or paste a paragraph and ask what is wrong with it.",
    },
    footnote:
      "A BuildGentic flagship agent. It gives notes; the writing stays yours.",
  },

  /* -------------------------------------------------------
     CAREER EXPLORER — the pathway board

     Forward-looking without being a careers office poster. The
     copy has to make "I have no idea" a legitimate place to
     start, because it is the most common one.
     ------------------------------------------------------- */
  "career-explorer": {
    id: "career-explorer",
    name: "Career Explorer",
    eyebrow: "Pathways",
    headline: "You do not have to know yet.",
    deck:
      "Think out loud about what you might do — and find out what the work is actually like, what it takes to get there, and what you could do about it this month.",
    mode: "light",
    chat: {
      greeting:
        "Tell me anything — a subject you like, a job you are curious about, or that you have no idea. All three are a good start.",
      placeholder: "What are you curious about?",
      sendLabel: "Ask",
      hint: "It asks questions rather than picking for you. Nothing you say here goes on a record.",
      openingTitle: "Start anywhere on the path.",
      /* No direction words: the rail runs across the page on a
         wide screen and down it on a narrow one, so "at the
         left" is wrong half the time. */
      openingBody:
        "Most people start with a subject they like and no plan attached to it.",
    },
    footnote:
      "A BuildGentic flagship agent. Guidance to think with, not advice to act on blindly.",
  },

  /* -------------------------------------------------------
     RESEARCH ASSISTANT — the reading room

     Scholarly apparatus, and a page that says out loud that
     evaluating a source is the skill being taught.
     ------------------------------------------------------- */
  "research-assistant": {
    id: "research-assistant",
    name: "Research Assistant",
    eyebrow: "Reading room",
    headline: "Find sources that hold up.",
    deck:
      "Work through a research question with somebody who looks things up, says where the answer came from, and is straight with you about which sources are worth citing and which are not.",
    mode: "light",
    chat: {
      greeting:
        "What are you researching? Give me the question, the subject, or an article you are unsure about.",
      placeholder: "State your research question…",
      sendLabel: "Submit enquiry",
      hint: "Check every source before you cite it. It can be wrong, and it will tell you when it is unsure.",
      openingTitle: "No enquiries yet.",
      openingBody:
        "Open with a question, a subject, or a link you want a second opinion on.",
    },
    footnote:
      "A BuildGentic flagship agent. Verify every source before it reaches your bibliography.",
  },

  /* -------------------------------------------------------
     CODING COACH — the workbench

     The only dark page of the five, and the only one where
     that is the point rather than a preference.
     ------------------------------------------------------- */
  "coding-coach": {
    id: "coding-coach",
    name: "Coding Coach",
    eyebrow: "Workbench",
    headline: "Paste the broken thing.",
    deck:
      "Find out what is wrong and why it is wrong — then fix it yourself, with somebody a few steps ahead reading over your shoulder.",
    mode: "dark",
    chat: {
      greeting:
        "Paste the code and the error, or tell me what it should be doing and what it does instead.",
      placeholder: "Paste code, an error, or a question…",
      sendLabel: "Run it past me",
      hint: "It explains the bug rather than handing you the patch. That is the whole design.",
      openingTitle: "Session ready.",
      openingBody: "Paste a stack trace, or pick a command below.",
    },
    footnote:
      "A BuildGentic flagship agent. It reviews and explains; you write the fix.",
  },

  /* -------------------------------------------------------
     STUDY TUTOR — the study desk

     Warm and orderly. "Welcoming, not childish" is the whole
     brief, so the copy is plain rather than jolly.
     ------------------------------------------------------- */
  "study-tutor": {
    id: "study-tutor",
    name: "Study Tutor",
    eyebrow: "Study desk",
    headline: "Understand it, don't just memorise it.",
    deck:
      "Work through what you are stuck on one step at a time — with a tutor that asks you questions back, and that would rather you got there yourself.",
    mode: "light",
    chat: {
      greeting:
        "What are we working on? A topic, a question you got wrong, or a photo of the problem all work.",
      placeholder: "What are you studying?",
      sendLabel: "Ask",
      hint: "It will ask you questions back. That is not it being difficult — it is how the explanation lands.",
      openingTitle: "Nothing on the desk yet.",
      /* "From the list" rather than "below": the ways in sit
         beside the chat on a wide screen and under it on a
         narrow one, and only one of those is below. */
      openingBody:
        "Pick a way in from the list, or just say what you are stuck on.",
    },
    footnote:
      "A BuildGentic flagship agent. Check anything that will be marked.",
  },
};

/*
 * Undefined for anything that is not one of the five.
 *
 * Same contract as `findFlagship`, and for the same reason: a
 * page whose row names an agent this build no longer ships
 * falls back to the generic renderer rather than to a design
 * that has been deleted.
 */
export function flagshipIdentity(
  id: string | null | undefined
): FlagshipIdentity | undefined {
  return id ? IDENTITIES[id as FlagshipId] : undefined;
}

/*
 * What this agent can actually do, read from the catalogue.
 *
 * Every page below states its capabilities somewhere — the
 * study desk lists them as a session card, the workbench puts
 * them in a status bar — and none of them may hand-write the
 * list. The reasoning is `FlagshipStore.flagshipSections`':
 * switching a capability off has to switch the promise off
 * too, and it can only do that if there is one place the fact
 * is written down.
 */
export function flagshipCan(
  id: FlagshipId,
  capability: CapabilityId
): boolean {
  return findFlagship(id)?.capabilities.includes(capability) ?? false;
}
