import type { AiFeature } from "../ai/types";

/*
 * What each AI action costs a learner, in XP.
 *
 * One object, so the price list is a thing you can read rather
 * than a set of literals scattered through the runtime — and so
 * changing what an agent test costs is one edit that cannot
 * disagree with itself.
 *
 * FLAT PER ACTION, deliberately. Charging by tokens would be
 * fairer and would also mean a learner cannot predict what
 * pressing Run will cost them, which is the wrong trade in a
 * teaching tool: the whole point of the Lab is that you change
 * one thing and run it again, and hesitating over the price of
 * that is the behaviour we least want to encourage.
 *
 * THE ZEROS BELOW ARE NOT ALL THE SAME KIND OF ZERO, and the
 * difference now matters. Three sorts appear here:
 *
 *   Genuinely free sub-calls — retrieval, memory, indexing. A
 *   single turn with capabilities on is five or six model
 *   calls, and the learner asked for ONE thing. Charging six
 *   times for having good capabilities enabled would make the
 *   best agents the expensive ones. These ride free, bounded
 *   only by the ai_usage quota gate.
 *
 *   Surcharged capabilities — web search and file analysis.
 *   Priced, but NOT here. See SURCHARGES.
 *
 *   Not built — vibe, and the dev harness that must not drain
 *   the allowance it exists to test.
 */
export const COSTS: Record<AiFeature, number> = {
  /* A Lab experiment, or a chat message. */
  lab: 1,
  compare: 1,

  /* An Agent Builder test run. Two, because it is doing more:
     an agent carries instructions, knowledge and memory that a
     bare Lab prompt does not. */
  agent_test: 2,

  /*
   * A call to somebody's deployed agent.
   *
   * Charged to the OWNER, not the caller — an external caller
   * has no BuildGentic account to charge. That is a real
   * consequence worth stating plainly: a public endpoint spends
   * its owner's allowance, so a popular agent goes quiet when
   * its owner runs out.
   */
  agent_public: 1,

  /*
   * A visitor's question on a student's published page.
   *
   * Priced the same as the deployment endpoint, and charged to
   * the same person — the owner — for the same reason: a
   * stranger who followed a link has no BuildGentic account to
   * charge.
   *
   * The consequence is sharper here than it is next door and is
   * worth stating rather than discovering. A deployment key
   * goes to somebody its owner chose; a page URL goes wherever
   * it is forwarded. So a page that gets shared widely spends
   * its owner's balance quickly, and when it runs out the page
   * stops answering. That is why the page carries its own
   * tighter ceiling in `siteLimits` and a per-visitor bucket in
   * front of it.
   */
  agent_site: 1,

  /*
   * A natural-language page edit, made by the owner.
   *
   * Priced like an Agent Builder test rather than like a chat
   * turn: it is one call, but it carries the whole page as
   * context and it produces a change the student then reviews.
   */
  site_edit: 2,

  /* The dev harness. Free: it exists to prove the runtime
     works, and a harness that drains the allowance it is
     testing cannot finish testing it. */
  dev_harness: 0,

  /* Not built. */
  vibe: 0,

  /* ----- free sub-calls. See the header. ----- */
  agent_index: 0,
  agent_retrieval: 0,
  agent_memory: 0,

  /*
   * ----- surcharged sub-calls, priced at ZERO HERE -----
   *
   * Both of these cost the learner something, and neither can
   * be priced on this table. The reason is that neither
   * corresponds one-to-one with a turn:
   *
   *   `agent_web_search` is recorded TWICE on a searching turn
   *   — once for the model call that decides whether to search
   *   (AiRuntime) and once for the search itself
   *   (WebSearchRuntime). A price here would charge double.
   *
   *   `agent_file_analysis` is recorded ONCE PER ATTACHED FILE
   *   (FileAnalysisRuntime), so a price here would charge three
   *   times for three attachments.
   *
   * The learner attached one message and asked one question, so
   * they pay one surcharge. It is applied per turn in AiRuntime
   * out of SURCHARGES below.
   */
  agent_web_search: 0,
  agent_file_analysis: 0,
  /*
   * Zero of the same kind the two above are: the work is real
   * and is counted in its own quota windows, but what the
   * learner is charged for it is the one surcharge below, not
   * a price per tool call and per continuation step. A turn
   * that ran code three times is still one thing they asked
   * for.
   */
  agent_action: 0,

  /*
   * A scheduled run. Priced at Agent Builder parity, and the
   * parity is the point rather than a coincidence.
   *
   * A scheduled run IS an agent test — the same composed
   * prompt, the same knowledge, the same tools, through the
   * same `runChat`. The only difference is that a timer asked
   * instead of a person. Charging more for that would be
   * charging for the absence of a human; charging less would
   * make the unattended path the cheap one, which is the
   * opposite of the incentive this should carry.
   *
   * The number is what makes the frequency floor arithmetic
   * work out. At 2 XP plus the action surcharge, a run costs
   * about 3, so the 6-hourly floor is 12 XP a day against a 40
   * XP daily grant — under a third. An hourly floor would have
   * been 72, which is nearly double what a learner earns, and
   * the first thing they would have learned about agents is
   * that theirs stopped working. See scheduleLimits in
   * ai/config.ts.
   */
  agent_scheduled: 2,

  /*
   * A turn from the browser extension. Priced at Agent Builder
   * parity, and the parity is the point rather than a
   * coincidence — the same argument the line above makes.
   *
   * An extension turn IS an agent test: the same composed
   * prompt, the same knowledge, the same tools, through the
   * same `runChat`. The only difference is where the person was
   * standing when they asked.
   *
   * Charging LESS would matter more here than the reasoning
   * above it admits, because it would make the extension the
   * cheap door — and a fourth door that is cheaper than the
   * other three is a side-channel around the cost of the first
   * three, whatever else it is. Charging MORE would price a
   * learner out of the surface most likely to make an agent
   * feel worth building.
   *
   * There is deliberately no page-context surcharge beside
   * this. A large page inflates input tokens, and input tokens
   * are ALREADY metered — countInputChars runs before admit and
   * the estimate feeds the daily token window — so a page is
   * paid for in the windows it actually costs. A surcharge
   * would charge twice for one thing. Compare `fileAnalysis`
   * below, which does carry one and should: parsing a PDF is
   * real server-side work, whereas extracting text from a page
   * happens in the learner's own browser and costs this server
   * nothing.
   */
  agent_extension: 2,
};

/*
 * What a capability adds to the turn that used it.
 *
 * Charged ONCE PER TURN, on top of the turn's own cost, and not
 * through the COSTS table above — see the note beside those two
 * zeros for why they cannot live there.
 *
 * The two are collected at different moments, because the two
 * facts become knowable at different moments:
 *
 *   fileAnalysis is known BEFORE the turn runs. Attachments
 *   arrive in the request, so this is folded into the up-front
 *   gate and a learner who cannot afford the turn is refused
 *   before a single file is parsed.
 *
 *   webSearch is NOT knowable before the turn runs — the model
 *   decides whether to search. So it is collected after a
 *   search has actually happened, once, however many queries
 *   that search ran. A turn where the agent decided not to
 *   search costs nothing extra, which is the honest outcome and
 *   also the one that keeps the capability worth switching on.
 *
 *   actions is webSearch-shaped, and more so. Whether an agent
 *   acts, and how many times, is decided inside the turn — so
 *   it is collected afterwards, once, whether the agent took
 *   one step or four. Once rather than per step on purpose:
 *   an agent that needed three tries to get an API call right
 *   has not given its owner three times the value, and pricing
 *   per step would teach learners to avoid the loop rather
 *   than to use it well.
 */
export const SURCHARGES = {
  webSearch: 1,
  fileAnalysis: 2,
  actions: 1,
} as const;

export function costOf(feature: AiFeature): number {
  return COSTS[feature] ?? 0;
}

/*
 * What a learner earns.
 *
 * All of these are granted through idempotent paths, so a
 * replayed lesson or a double-fired login pays exactly once.
 *
 * They accumulate. Since migration 0014 a balance carries over
 * from day to day and stops at a ceiling rather than resetting
 * to a daily figure, which is what makes anything priced above
 * a single day's earnings — every agent in the Library —
 * reachable at all.
 */
export const EARNINGS = {
  /*
   * Showing up. The largest single grant, and the reason it is
   * large is that it is now the floor of the whole economy
   * rather than a bonus on top of a refill: under 0014 this is
   * what arrives each day, and nothing else refills anything.
   */
  dailyLogin: 40,

  /*
   * Ten consecutive days, then the counter starts again.
   *
   * MUST STAY IDENTICAL TO claim_daily_credits IN MIGRATION
   * 0014, which is where the streak is actually computed and
   * this bonus is actually paid. The copy here exists so the
   * UI can say what a streak is worth without a round trip; the
   * database is the authority. The streak lives in SQL because
   * user_stats.current_streak is browser-writable, and a
   * client-trusted counter that pays XP is a money printer.
   */
  streakBonus: 20,

  /*
   * Finishing a lesson. Smaller than it was under the old
   * resetting wallet, because it is no longer competing with a
   * nightly reset — fifteen XP that keeps its value is worth
   * more than twenty that evaporates at midnight.
   */
  lessonComplete: 15,

  /* Finishing an entire course, on top of its lessons. The one
     grant that rewards finishing something rather than doing
     something. */
  courseComplete: 50,
} as const;

/*
 * The ceiling, and the level scale.
 *
 * Both mirror migration 0014 — `user_credits.max_balance`
 * defaults to 300, and credit_level() divides by 200. They are
 * duplicated here so the UI can render a meter and a progress
 * bar without asking the database what the maximum is, and the
 * server sends the real per-row values in the wallet snapshot
 * so a learner given a different ceiling still sees their own.
 */
export const WALLET = {
  defaultMaxBalance: 300,
  xpPerLevel: 200,
} as const;
