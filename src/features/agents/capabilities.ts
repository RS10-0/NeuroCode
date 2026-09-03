import {
  Boxes,
  Braces,
  Brain,
  Database,
  FileOutput,
  Globe,
  Inbox,
  Mail,
  MessagesSquare,
  Paperclip,
  PenLine,
  Plug,
  Send,
} from "lucide-react";

/*
 * What an agent is allowed to do.
 *
 * Five of these work. The rest are listed anyway, marked as
 * what they are, for the same reason the Lab lists its unbuilt
 * workspaces: an agent that can only chat makes far more sense
 * as the first capability of several than as the only thing an
 * agent has ever been able to do.
 *
 * The rule this file exists to enforce is that nothing here
 * pretends. A capability is `ready` when the runtime can
 * actually carry it out; anything else renders as unavailable
 * and cannot be switched on. A toggle that flips but changes
 * nothing about the answers is worse than no toggle, because a
 * learner would spend an afternoon wondering why their agent
 * ignores the web.
 */

/*
 * Defined in ./vocab, which is a leaf module the server can read
 * without dragging this file's icon imports across the tsconfig
 * boundary. Re-exported here so every existing importer is
 * unaffected. See vocab.ts.
 */
export type { CapabilityId } from "./vocab";

import type { CapabilityId } from "./vocab";

export interface Capability {
  id: CapabilityId;
  label: string;
  blurb: string;
  icon: typeof MessagesSquare;
  ready: boolean;
  /* Shown on the ones that are not ready: what it will do, and
     honestly why it cannot yet. */
  soonHint?: string;
  /* Shown on a ready capability that needs a sentence about
     what turning it on does. */
  onHint?: string;
}

export const CAPABILITIES: Capability[] = [
  {
    id: "chat",
    label: "Chat",
    blurb:
      "Hold a conversation. Your instructions and knowledge go with every turn, and the agent answers through the same runtime the Lab uses.",
    icon: MessagesSquare,
    ready: true,
  },
  {
    id: "knowledge_retrieval",
    label: "Knowledge Search",
    blurb:
      "Search your knowledge for each question and use only the parts that match, instead of sending all of it every time.",
    icon: Boxes,
    ready: true,
  },
  {
    id: "web_search",
    label: "Web Search",
    blurb:
      "Let it search the live web when a question needs current information, and answer from what it finds — with links to the pages it used.",
    icon: Globe,
    ready: true,
    /*
     * Shown on the ones that ARE ready too, where it says what
     * switching this on actually changes. Web Search is the
     * first capability where that is not obvious: it does not
     * make the agent search, it makes the agent allowed to, and
     * a learner who expects every question to hit the internet
     * will conclude the switch is broken the first time it
     * answers from memory.
     */
    onHint:
      "Your agent decides for itself, question by question. It looks things up when the answer depends on something current and answers from what it already knows when it does not — and the Test panel shows you which happened.",
  },
  {
    id: "file_analysis",
    label: "File Analysis",
    blurb:
      "Let people attach a PDF, Word document, spreadsheet or picture to a message, and answer questions about what is in it.",
    icon: Paperclip,
    ready: true,
    /*
     * The distinction this hint has to land is the one between
     * Knowledge and File Analysis, because a learner who has
     * just used Knowledge will otherwise read this as the same
     * thing with a different button.
     *
     * Knowledge is what the agent always knows. A file is what
     * somebody hands it during a conversation, for one question,
     * and it is gone afterwards.
     */
    onHint:
      "A paperclip appears in the Test panel. Attach a file, ask a question about it, and the answer comes from the file itself — the Test panel shows how many pages, sheets or rows your agent actually read. This is different from Knowledge: an attached file is for the conversation it is attached to, not something the agent keeps.",
  },
  {
    id: "code_execution",
    label: "Run Code",
    blurb:
      "Write a small program, run it, and answer from what it actually printed — rather than working it out in its head.",
    icon: Braces,
    ready: true,
    /*
     * Three things have to land in this hint, and the first is
     * the one nobody expects.
     *
     * That the agent decides. Every other capability reads
     * like a setting; this one reads like a feature, and a
     * learner who switches it on and then asks "what is 2+2"
     * will watch it answer without running anything and
     * conclude the switch is broken. Saying that it is used
     * when it is needed is what makes the first test make
     * sense.
     *
     * That the sandbox is genuinely sealed, because "you are
     * letting an AI run code" is an entirely reasonable thing
     * to be uneasy about, and the honest answer is short.
     *
     * And that the trace is visible, because seeing the
     * program and its output is the whole lesson — an agent
     * that quietly got the right answer teaches nothing.
     */
    onHint:
      "The agent decides for itself when a question is worth computing rather than guessing — counting, parsing, dates, anything fiddly — then writes a small program and answers from what it printed. The Test panel shows you the code it wrote and the output it got back. The program runs sealed off: no internet, no files, no access to your account, and it is stopped if it runs too long. One tip worth having: do not write \"always use this tool\" in your instructions. Agents told they must always use a tool use it less, not more, and are likelier to describe running code they never ran. Say what the agent is for and let it choose.",
  },
  {
    id: "http_actions",
    label: "Call APIs",
    blurb:
      "Fetch live data from the web, and use services you connect it to.",
    icon: Plug,
    ready: true,
    /*
     * The hint that has to do the most work on this screen,
     * because this is the one capability whose effects leave
     * BuildGentic.
     *
     * It says what happens without setup, so the capability is
     * useful before a learner fills in any form. It says the
     * key is never shown to the agent, because "could someone
     * talk my agent into leaking my API key" is the right
     * question to ask and deserves an answer on the screen
     * where the key is entered rather than in documentation.
     * And it says plainly that a published page will not do
     * this, because discovering that later feels like a bug
     * rather than the deliberate line it is.
     */
    onHint:
      "With nothing set up it can read public addresses — a JSON feed, an open API — but only read them. To let it use a service that needs a key, add a Connection below: you give the address and the key, and the agent is told only the name. It never sees the key and cannot repeat it, whoever asks. Private and internal addresses are always refused. One limit worth knowing: a published page will not run these, even with this on — a link travels further than its author expects, and a stranger should not be able to spend your key.",
  },
  {
    id: "document_generation",
    label: "Make Files",
    blurb:
      "Turn an answer into a real PDF, spreadsheet or Word document you can download — and that a scheduled run attaches to its email.",
    icon: FileOutput,
    ready: true,
    /*
     * Three things have to land here, and the third is the one
     * that would otherwise arrive as a bug report.
     *
     * That the agent decides, which is the sentence every
     * capability hint on this screen has needed since Web
     * Search.
     *
     * That the file is real and downloadable, because the
     * obvious guess is that it produces a wall of text with
     * headings in it.
     *
     * And that a PDF cannot draw non-Latin scripts. That is a
     * genuine limitation of the built-in fonts, it is not
     * fixable by rewording the question, and a student whose
     * Japanese report comes back refused needs to already know
     * the answer is "ask for Word instead" — otherwise they
     * conclude the feature is broken.
     */
    onHint:
      "Your agent decides when an answer is worth a file rather than a paragraph — a weekly report, a table of results, something you would keep. It appears under the answer with a download button, and a scheduled run attaches it to the email it sends you. One limit worth knowing before you meet it: a PDF uses a built-in font that draws Latin alphabets only, so a document in Japanese, Chinese, Greek, Cyrillic or Arabic has to be a Word file — your agent is told this and will ask for the right one, and it will tell you if a few characters could not be drawn.",
  },
  {
    id: "data_store",
    label: "Keep Records",
    blurb:
      "Give it a small notebook it can write to and read back — a habit log, a running total, anything it should still know next week.",
    icon: Database,
    ready: true,
    /*
     * This hint has one job above all others: separating this
     * from Memory. They sound identical and they behave
     * oppositely, and a learner who has just read the Memory
     * card will otherwise assume this is the same thing with a
     * different button.
     *
     * Memory holds what the agent WORKED OUT about a person,
     * and forgets its oldest entry when it fills. This holds
     * what it was ASKED TO KEEP, and refuses rather than
     * forgetting — which is the behaviour a habit log needs and
     * the opposite of what memory should do.
     *
     * It also has to say, as Memory's does, that everything is
     * visible and removable. "This thing is quietly writing
     * down what I say" is a reasonable worry and the answer is
     * a screen.
     */
    onHint:
      "This is not the same as Memory, and the difference matters. Memory is what your agent works out about you on its own, and it forgets its oldest note when it gets full. This is a notebook it writes in on purpose — a habit log, a running total, yesterday's number — and when it is full it says so rather than quietly dropping the oldest entry, because that entry is usually the one with the most history behind it. It is the only thing your agent still has on a scheduled run tomorrow. Everything in it is listed in the Records section, where you can read, edit or delete any of it, and anything the agent removes waits a week there in case you want it back. Save the agent first: records are stored against a saved agent, not a draft.",
  },
  {
    id: "memory",
    label: "Memory",
    blurb:
      "Remember useful things about the person it is helping — their goals, how they like to be taught, what they are working on — and still know them next week.",
    icon: Brain,
    ready: true,
    /*
     * Three things have to land in this hint, and none of them
     * is obvious from the word "memory".
     *
     * That it is per agent, because the natural assumption is
     * the opposite one — a learner who tells their Maths Tutor
     * about their exam will expect their Essay Coach to know,
     * and would read the separation as a bug rather than as the
     * design. Saying it here is cheaper than saying it in a
     * support conversation later.
     *
     * That it needs a saved agent, because memories hang off an
     * agent and a draft has no id to hang them on.
     *
     * That it is visible and deletable, because "this thing is
     * quietly writing down what I say" is an entirely
     * reasonable thing to be uneasy about, and the answer is a
     * screen where every sentence it kept can be read and
     * removed.
     */
    onHint:
      "Its memory belongs to this agent alone — what you tell this one is not shared with your others. It decides for itself what is worth keeping, and the Test panel shows you what it remembered and what it just wrote down. Everything it has kept is listed in the Memory section, where you can delete any of it. Save the agent first: memories are stored against a saved agent, not a draft.",
  },

  /* =======================================================
     EMAIL

     Four switches for one mailbox, and they are four rather
     than one because they are genuinely four different things
     to be allowed to do with somebody's post.

     The hints below carry more weight than any others on this
     screen. Every capability before this one, at its very
     worst, produces a bad answer or spends some of a learner's
     allowance. These reach a real inbox, and a student turning
     them on deserves to know exactly where the edges are
     BEFORE they connect an account rather than afterwards.
  ======================================================= */
  {
    id: "email_read",
    label: "Read Email",
    blurb:
      "Connect a mailbox and let it read and search what is in there — so it can triage your inbox, summarise a thread, or find the message you half remember.",
    icon: Mail,
    ready: true,
    /*
     * Three things have to land, and the third is the one that
     * would otherwise arrive as a shock.
     *
     * That it is the whole mailbox, because "read email" sounds
     * like it might mean the message in front of you.
     *
     * That the key never reaches the agent, because "could
     * somebody talk my agent into giving away access to my
     * Gmail" is the right question and deserves answering on
     * the screen where the switch is.
     *
     * And that a published page and a deployed agent get none
     * of it. That limit is stricter than the one on Call APIs
     * and for a much sharper reason, and a student who found
     * out later would reasonably call it a bug.
     */
    onHint:
      "You connect a mailbox through Google's own sign-in — BuildGentic never sees your password, and the agent never sees the key either: it asks for messages and the server fetches them. It can read and search everything in that mailbox, so this is a real thing to hand over; connect the account you actually want it working on. One limit worth knowing now rather than later: a published page and a deployed agent get NO access to your email, ever, whatever this switch says. A link travels further than its author expects, and a stranger should not be able to read your post.",
  },
  {
    id: "email_draft",
    label: "Draft Replies",
    blurb:
      "Let it write replies for you — in the tone you ask for — and put them somewhere you can read, edit and decide about them.",
    icon: PenLine,
    ready: true,
    /*
     * The one sentence this hint exists to deliver is that
     * drafting is not sending. A student who reads "draft
     * replies" and assumes their agent is answering their
     * professor is a student who will not test it before
     * trusting it.
     */
    onHint:
      "It writes the reply; you send it. A draft appears with the recipient, the subject and the whole message, and it sits there until you press Send or throw it away — the agent cannot send anything, on its own or if you ask it to, because there is no way for it to. That is also true of a scheduled run: an agent working at six in the morning can leave a reply waiting for you, and that is all it can do.",
  },
  {
    id: "email_send",
    label: "Send Email",
    blurb:
      "Turn on the Send button underneath a draft, so a reply you have read can go out without leaving BuildGentic.",
    icon: Send,
    ready: true,
    /*
     * The most important hint on this screen, and the one that
     * has to be honest about how little this switch actually
     * grants — because a student expecting the dangerous thing
     * should find the boundary reassuring rather than absent.
     */
    onHint:
      "Separate from Draft Replies on purpose, and it does less than it sounds like. It does not let your agent send email — nothing does. It turns on the Send button beneath a draft you are looking at, so that you can send it from here instead of copying it into Gmail. Every send is you, pressing a button, on a message you have read. Leave this off and drafts still appear; you just finish them somewhere else.",
  },
  {
    id: "email_organize",
    label: "Organise Inbox",
    blurb:
      "Let it label, archive, and mark things read when you ask — so a triage can end with the inbox actually tidied.",
    icon: Inbox,
    ready: true,
    /*
     * Two jobs. Saying that nothing is destroyed, because
     * "let an AI reorganise my inbox" is a reasonable thing to
     * be uneasy about and the honest answer is short. And
     * saying it acts when asked, because the fear is an agent
     * that quietly rearranges things.
     */
    onHint:
      "IT CANNOT DELETE ANYTHING. There is no delete in BuildGentic at all — archiving takes a message out of the inbox and it stays in All Mail, and every other change here is one you can undo in your mail app in seconds. It also only acts when you ask: it will not tidy up on its own because your inbox looked untidy, and if it wants to archive twelve newsletters it will say so first. Labels have to already exist — it will not invent new ones.",
  },
];

/* The one every agent has and none can turn off. */
export const REQUIRED_CAPABILITY: CapabilityId = "chat";

export function findCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((entry) => entry.id === id);
}

/*
 * Drops anything a stored row names that this build does not
 * recognise or cannot honour, and guarantees `chat`.
 *
 * A row written by a newer build — or by hand — must not be able
 * to make the UI claim a capability the runtime will not carry
 * out.
 */
export function normalizeCapabilities(value: unknown): CapabilityId[] {
  const raw = Array.isArray(value) ? value : [];

  const kept = CAPABILITIES.filter(
    (entry) => entry.ready && raw.includes(entry.id)
  ).map((entry) => entry.id);

  return kept.includes(REQUIRED_CAPABILITY)
    ? kept
    : [REQUIRED_CAPABILITY, ...kept];
}
