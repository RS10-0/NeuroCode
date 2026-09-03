import type { AvatarTone, CapabilityId } from "./vocab";

/*
 * BuildGentic's own agents, as far as the browser is concerned.
 *
 * Five pre-built agents a learner unlocks with XP. This is the
 * PUBLIC half of the catalogue: everything the Library has to
 * render on a card, and nothing else. It ships in the bundle,
 * where anybody may read it, and none of it is what a learner
 * is paying for.
 *
 * The system prompts are NOT here. They live in
 * server/src/agents/flagshipPrompts.ts and never leave the
 * server, because they are the thing being sold — a Coding
 * Coach that costs 200 XP is 200 XP of behaviour rules, and
 * shipping those to every browser would mean pasting them into
 * a free agent in the Builder and never visiting the Library
 * again. The seeded knowledge is over there too, for the same
 * reason.
 *
 * THE FIVE ARE NOT SEEDED INTO THE DATABASE EITHER, which is
 * migration 0015's decision and worth restating here. A
 * purchased agent's row names which flagship it is and carries
 * no prompt of its own; AgentStore resolves the text on every
 * read. So improving a prompt improves it for the learner who
 * bought that agent last term, on their very next question.
 *
 * A LEAF MODULE: the only import is a type-only one from
 * ./vocab, and it must stay that way. The server reads this
 * file directly — the same trick SiteStore uses on
 * src/features/sites/slug.ts — which works only while nothing
 * behind it needs resolving. See vocab.ts.
 */

export type FlagshipId =
  | "writing-coach"
  | "study-tutor"
  | "research-assistant"
  | "coding-coach"
  | "career-explorer"
  | "email-agent";

export interface Flagship {
  id: FlagshipId;
  name: string;
  /* One line, on the card. The promise the agent makes. */
  tagline: string;
  xpCost: number;
  avatarEmoji: string;
  avatarTone: AvatarTone;
  /* What lands in `agents.description` and on the public page.
     Longer than the tagline and doing a different job: the
     tagline sells it, this explains it. */
  description: string;
  capabilities: CapabilityId[];
  /* Shown in the Test panel and on the published page when a
     conversation has not started yet. */
  starterPrompts: string[];
  /*
   * A one-off nudge on first open, for an agent that is
   * markedly better once the learner has given it something.
   * Only Study Tutor has one — see its entry.
   */
  onboardingNudge?: string;
  /*
   * Sampling temperature. Set per agent rather than taken from
   * the model default, because these differ in kind: a coach
   * reading a draft should be steadier than one brainstorming
   * career paths, and a debugging agent steadier still.
   */
  temperature: number;
  /*
   * Whether this agent ships with seeded knowledge, WITHOUT
   * shipping the knowledge itself.
   *
   * The Library card says "comes with reference material" or
   * stays quiet, and that is all the browser needs to know. The
   * content is server-side with the prompts.
   */
  hasSeededKnowledge: boolean;
  /*
   * Whether this agent may be given a public page.
   *
   * Absent means yes, which is what the first five are and what
   * every agent in the product was until the sixth arrived.
   *
   * Email Agent sets it false, and the reasoning is worth
   * stating because "it would be safe anyway" is true and is
   * not the argument. Every email capability is hard `false` on
   * the published-page door, so a page for this agent could not
   * touch a mailbox whatever anybody did — it would be safe.
   * It would also be a page for an email assistant that cannot
   * see any email, published under BuildGentic's name, telling
   * visitors what it does while being unable to do it.
   *
   * FlagshipStore's own header makes this rule for a different
   * feature: a card that describes a capability the page does
   * not have is the failure its generator exists to prevent.
   * This is that failure at the scale of a whole page, and the
   * honest fix is not to publish one.
   */
  publishable?: boolean;
}

/* =========================================================
   THE CATALOGUE

   Ordered by price, cheapest first, which is also the order the
   Library renders them in — the first card a learner sees
   should be one they might actually be able to afford.
========================================================= */

export const FLAGSHIPS: Flagship[] = [
  /* -------------------------------------------------------
     CAREER EXPLORER — 60 XP

     The cheapest, and deliberately the first a learner is
     likely to be able to afford. It is also the one with the
     least machinery behind it: no file analysis, nothing
     uploaded, just a conversation that remembers — and, since
     Phase 3, one that can write down where it got to and hand
     back a page about it.
     ------------------------------------------------------- */
  {
    id: "career-explorer",
    name: "Career Explorer",
    tagline:
      "Figure out what you might actually want to do — and how to get there.",
    xpCost: 60,
    avatarEmoji: "🧭",
    avatarTone: "caution",
    description:
      "Think through career and academic paths with someone who asks good questions and never pushes you toward an answer.",
    /*
     * File Analysis is off, per spec. Résumé and application
     * review is named there as a stretch feature rather than
     * part of this agent, and switching it on would change what
     * the agent is for without changing what it says it does.
     *
     * Knowledge Retrieval is on so the agent can RETAIN the
     * colleges, careers and interests a learner mentions across
     * sessions and build a real picture of them — the store
     * fills up from the conversation rather than from a seed.
     *
     * KEEP RECORDS is what actually delivers the sentence above,
     * and it is worth saying that plainly rather than leaving
     * two capabilities looking like they do the same job.
     * Retrieval SEARCHES a store; nothing in this build lets an
     * agent WRITE to one — agent_knowledge is filled by the
     * learner in the Builder. `data_store` is the first thing
     * this agent has ever had that it can write to on purpose,
     * and it is where the four stages go: which of Explore,
     * Compare, Test and Move a student has actually engaged
     * with, so a second visit opens where the first one
     * stopped rather than at the beginning again.
     *
     * MAKE FILES is the pathway one-pager. It is a summary of
     * paths already talked through, packaged — see the export
     * rule in flagshipPrompts.ts, which is where the cost
     * discipline for all five of these lives.
     */
    capabilities: [
      "chat",
      "web_search",
      "memory",
      "knowledge_retrieval",
      "document_generation",
      "data_store",
    ],
    temperature: 0.8,
    starterPrompts: [
      "I don't know what I want to do — help me think it through",
      "What's it actually like to work in [field]?",
      "What should I be doing now if I'm interested in [career]?",
    ],
    hasSeededKnowledge: false,
  },

  /* -------------------------------------------------------
     WRITING COACH — 90 XP
     ------------------------------------------------------- */
  {
    id: "writing-coach",
    name: "Writing Coach",
    tagline: "Sharpen every essay, story, and email before you hit submit.",
    xpCost: 90,
    avatarEmoji: "✍️",
    avatarTone: "accent",
    description:
      "Upload a draft and get focused, specific feedback that teaches the principle behind every edit — without writing it for you.",
    /*
     * MAKE FILES, and this is the agent where the cheap path is
     * not a cost compromise but the only correct behaviour.
     *
     * The prompt's hardest rule is "never write a student's
     * content for them wholesale". An export that SYNTHESISED a
     * document would break that rule with a download button on
     * it — the one artefact a student could hand in without
     * having written it. Packaging the draft that is already in
     * the conversation cannot: the words in the file are the
     * words they wrote, and the only thing the agent added was
     * the file.
     *
     * So the identity and the bill point the same way here,
     * which is why this is the flagship the export rule in
     * flagshipPrompts.ts is written around.
     *
     * KEEP RECORDS holds the thing memory is bad at: numbers.
     * Word count per pass, and which habits have actually gone
     * away. Memory forgets its oldest note when it fills, which
     * is exactly wrong for a revision history — the first pass
     * is the one with the most distance in it.
     */
    capabilities: [
      "chat",
      "file_analysis",
      "memory",
      "web_search",
      "knowledge_retrieval",
      "document_generation",
      "data_store",
    ],
    temperature: 0.7,
    starterPrompts: [
      "Upload your essay draft and I'll give you focused feedback",
      "Help me write a strong hook for my college essay",
      "Review my email to a teacher for tone",
    ],
    /* Ships with writing frameworks — structure, openings, and
       the line edits worth making first. */
    hasSeededKnowledge: true,
  },

  /* -------------------------------------------------------
     STUDY TUTOR — 100 XP
     ------------------------------------------------------- */
  {
    id: "study-tutor",
    name: "Study Tutor",
    tagline: "Understand it, don't just memorize it.",
    xpCost: 100,
    avatarEmoji: "📚",
    avatarTone: "correct",
    description:
      "A Socratic tutor across core subjects that remembers what you have covered and adapts to what you are actually being tested on.",
    /*
     * Web Search is off, per spec. The tradeoff named there is
     * the right one: current-events value does not outweigh the
     * accuracy risk on core curriculum, where a confidently
     * wrong search result is worse than no search at all.
     *
     * MAKE FILES is the study guide, and this is the one
     * flagship where a file genuinely beats an answer: revision
     * happens away from the screen the tutoring happened on.
     * It is also the flagship most likely to be asked for a
     * guide covering material the session never touched, which
     * is the case the export rule in flagshipPrompts.ts refuses
     * to do silently — it costs a synthesis the student did not
     * ask for and produces a guide with nothing behind it.
     *
     * KEEP RECORDS is Explain / Practise / Review, and what
     * keeps going wrong inside each. It is also what makes this
     * the one flagship worth putting on a schedule: a weekly
     * "what to review" email has something to read.
     */
    capabilities: [
      "chat",
      "knowledge_retrieval",
      "memory",
      "file_analysis",
      "document_generation",
      "data_store",
    ],
    temperature: 0.6,
    starterPrompts: [
      "Help me understand [topic] step by step",
      "Quiz me on what I just studied",
      "I'm stuck on this homework problem — upload photo/file",
    ],
    /*
     * The only agent with a nudge, because it is the only one
     * whose first conversation is meaningfully worse without an
     * upload. Encouraging rather than blocking, per spec: a
     * learner who ignores it still gets a working tutor.
     *
     * It is also this agent's answer to shipping no seeded
     * knowledge — a genuinely curated per-subject base is real
     * content work scoped separately, and a thin version would
     * outrank the learner's own notes in retrieval.
     */
    onboardingNudge:
      "Got notes or a study guide? Upload them and I can tailor everything to what you're actually being tested on.",
    hasSeededKnowledge: false,
  },

  /* -------------------------------------------------------
     RESEARCH ASSISTANT — 160 XP
     ------------------------------------------------------- */
  {
    id: "research-assistant",
    name: "Research Assistant",
    tagline: "Find real sources, organize what matters, cite it properly.",
    xpCost: 160,
    avatarEmoji: "🔎",
    avatarTone: "accent",
    description:
      "Find credible sources, learn to tell which ones hold up, and keep a project's research organised across sessions.",
    /*
     * The cleanest fit of the five, because both capabilities
     * are already in this agent's description — "keep a
     * project's research organised across sessions" was a
     * promise nothing in the build could actually keep.
     *
     * KEEP RECORDS is the source ledger: one record per source,
     * grouped under the project, holding the four fields the
     * seeded note on organising notes asks for. It survives
     * between sessions, which is the whole of "across
     * sessions".
     *
     * MAKE FILES is the bibliography, and it is pure
     * packaging by construction — the ledger already holds the
     * reference, so the export is a table of rows that exist.
     * Nothing about it is generated, which is why this one
     * never needs the fresh-synthesis path at all.
     */
    capabilities: [
      "chat",
      "web_search",
      "memory",
      "file_analysis",
      "knowledge_retrieval",
      "document_generation",
      "data_store",
    ],
    temperature: 0.5,
    starterPrompts: [
      "Help me research [topic] for my paper",
      "Find credible sources on [subject]",
      "I found this article — help me evaluate if it's reliable",
    ],
    /* Ships with source evaluation, note organisation and
       citation reference material. */
    hasSeededKnowledge: true,
  },

  /* -------------------------------------------------------
     CODING COACH — 200 XP

     The most expensive, and the one whose knowledge base is
     deliberately empty at launch.

     It is meant to be seeded from the "Building AI-Powered
     Websites" course, so that a learner hears the same
     explanations from the agent that they heard in the lesson.
     That course does not exist yet —
     src/features/courses/catalog.ts ships only ai-foundations
     and lists "Building with AI" as coming_soon with no
     lessons — so this ships empty rather than filled with
     invented material that would agree with nothing.
     ------------------------------------------------------- */
  {
    id: "coding-coach",
    name: "Coding Coach",
    tagline: "Debug it, understand it, build it yourself.",
    xpCost: 200,
    avatarEmoji: "🛠️",
    avatarTone: "correct",
    description:
      "Paste broken code and find out what is wrong and why — then fix it yourself, with someone a few steps ahead watching.",
    /*
     * Web Search is off, per spec, where it is listed as an
     * optional extra rather than part of the agent.
     *
     * KEEP RECORDS is the straightforward half: a skill log,
     * one record per topic, holding what was covered and where
     * the student got stuck. It is what lets a session three
     * weeks later open with "last time the scope of `this` was
     * the problem" instead of with the same first question.
     *
     * MAKE FILES IS ON, AND IT IS THE ONE PLACE ON THIS LIST
     * WHERE THE CAPABILITY DOES NOT DO WHAT THE AGENT WAS
     * ASKED FOR. Stating that here rather than discovering it
     * in a support conversation.
     *
     * The ask was a CODE FILE — take what is in the workbench,
     * write it out, run it. `make_document` cannot produce
     * one. Its formats are pdf, xlsx and docx (ai/types.ts) and
     * its block vocabulary is heading, text, list and table
     * (documents/plan.ts). There is no code block, no
     * monospace, and no plain-text format, so a program exported
     * through it arrives as Word paragraphs — proportional
     * font, indentation unreliable, not runnable. That is worse
     * than the student pressing copy.
     *
     * So what this capability is FOR on this agent is the thing
     * it can do honestly: the written half. A debugging
     * write-up, a walkthrough of a fix the student made, notes
     * from a session worth keeping — prose about code, which is
     * this agent's actual product anyway. The prompt in
     * flagshipPrompts.ts says so, and says to hand code back in
     * the answer rather than in a file.
     *
     * A real code export wants a fourth format — plain text with
     * a chosen extension, no rendering — which is a Phase 3
     * change to the format union, the renderers and the
     * download route, not a flag on this line.
     */
    capabilities: [
      "chat",
      "file_analysis",
      "memory",
      "knowledge_retrieval",
      "document_generation",
      "data_store",
    ],
    temperature: 0.4,
    starterPrompts: [
      "Why isn't my code working? (paste code or upload file)",
      "Explain what this code does line by line",
      "Help me build [small project idea] from scratch",
    ],
    hasSeededKnowledge: false,
  },

  /* -------------------------------------------------------
     EMAIL AGENT — 140 XP

     The sixth, and the first that reaches something outside
     BuildGentic that belongs to the student personally.

     Priced between Study Tutor and Research Assistant, which
     is a deliberate middle: it is more useful than the cheap
     end and it should not be the thing a learner saves up
     three weeks for, because the students who most need help
     digging out of an inbox are not the ones with 200 XP
     spare.

     THE CAPABILITY LIST IS THE INTERESTING PART OF THIS ENTRY.

     `email_send` IS on it, and it is worth saying what that
     does and does not mean, because the natural reading is the
     alarming one. It does not give this agent the ability to
     send mail — nothing in this product gives anything that
     ability, because there is no send tool. It turns on the
     Send button beneath a draft the student is looking at. The
     dangerous-sounding capability is the one that saves them
     copying a paragraph into Gmail.

     `web_search` is OFF, and that is a real decision rather
     than a gap. An agent that can both read your private
     correspondence and reach the open internet in the same
     turn is a shape worth not building on the first version of
     this capability: the interesting failure is not that it
     would leak something on purpose, it is that a message
     written by a stranger is now sitting in a prompt next to a
     tool that makes outbound requests. The action protocol
     fences that; not offering both at once means not having to
     rely on the fence. It can come back once the capability
     has been lived with.

     `file_analysis` is off for a related reason: attachments
     are NAMED but never opened, so the agent can say a
     spreadsheet arrived and cannot tell you what is in it.
     Turning file analysis on would let a student upload the
     attachment themselves — which is fine, and is what the
     Study Tutor is for — but on this agent it would blur a
     line the prompt spends a paragraph drawing.
     ------------------------------------------------------- */
  {
    id: "email-agent",
    name: "Email Agent",
    tagline: "Read your inbox, work out what matters, write the replies.",
    xpCost: 140,
    avatarEmoji: "📬",
    avatarTone: "accent",
    description:
      "Connect your email and get it triaged, summarised and answered — with every reply waiting for you to read before anything is sent.",
    capabilities: [
      "chat",
      "email_read",
      "email_draft",
      "email_send",
      "email_organize",
      "memory",
      "knowledge_retrieval",
      "document_generation",
      "data_store",
    ],
    /*
     * Low, and the lowest of the six. This agent's output is
     * mostly restatement of things that already exist —
     * somebody's messages, somebody's deadlines — and the one
     * place invention would be catastrophic is a summary of
     * post the student then acts on. Warmth belongs in the
     * writing, not in the sampler.
     */
    temperature: 0.4,
    starterPrompts: [
      "What in my inbox actually needs me today?",
      "Summarise this thread and tell me what I owe them",
      "Draft a polite reply saying I'll be available Thursday",
    ],
    /*
     * The only flagship besides Study Tutor with a nudge, and
     * the only one whose nudge names a prerequisite rather than
     * a suggestion. Every other agent works on its first
     * question; this one does nothing at all until a mailbox is
     * connected, and a student who does not know that will
     * conclude it is broken.
     */
    onboardingNudge:
      "Connect a mailbox on the Email screen first — until you do, there is nothing for me to read. BuildGentic never sees your password, and I can't send anything without you pressing Send.",
    /* Ships with triage criteria, tone-rewriting rules and how
       to write a reply somebody will actually send. */
    hasSeededKnowledge: true,
    /* See `publishable` on the interface above. */
    publishable: false,
  },
];

/* =========================================================
   LOOKUPS
========================================================= */

const BY_ID = new Map<string, Flagship>(
  FLAGSHIPS.map((entry) => [entry.id, entry])
);

/*
 * Undefined for an id this build does not ship.
 *
 * The honest answer for a stored `flagship_id` naming an agent
 * BuildGentic has since retired — the row is still the learner's,
 * it just has no catalogue entry to resolve against any more,
 * and every caller has to decide what to do about that rather
 * than being handed a fabricated default.
 */
export function findFlagship(
  id: string | null | undefined
): Flagship | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isFlagshipId(id: string | null | undefined): id is FlagshipId {
  return Boolean(id && BY_ID.has(id));
}

/*
 * The price, read from the catalogue and never from a request.
 *
 * The single function the purchase route uses to answer "what
 * does this cost", so there is no path where a caller could
 * name their own price. Null rather than 0 for an unknown id:
 * zero would be a free purchase.
 */
export function flagshipPrice(id: string): number | null {
  return BY_ID.get(id)?.xpCost ?? null;
}

/*
 * Whether one of BuildGentic's agents may be given a public
 * page.
 *
 * Defaults to TRUE for anything this build does not recognise,
 * which is the opposite of how the rest of this file fails and
 * is correct here. Everything else defaults closed because the
 * question is "may this learner have something"; this one is
 * asked about an agent whose catalogue entry has been retired,
 * and a page that already exists must not stop rendering
 * because the entry behind it was removed.
 */
export function flagshipPublishable(id: string | null | undefined): boolean {
  if (!id) {
    return true;
  }

  return BY_ID.get(id)?.publishable !== false;
}
