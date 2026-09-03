import { supabase } from "../../lib/supabase";

/*
 * Whether this ACCOUNT may have pages read from it at all.
 *
 * Its own module rather than a function inside
 * extensionRequest.ts, and the separation is deliberate: a gate
 * that is easy to find is a gate somebody notices before
 * working around it. Anything that wants to capture a page has
 * to import this file by name.
 *
 * WHY THIS EXISTS.
 *
 * BuildGentic has users aged 10-13. Every capability shipped
 * before Phase 4 operates on material a learner BROUGHT here: a
 * prompt they typed, a document they uploaded, an agent they
 * built. Page context is the first that inverts it — the
 * material is whatever a child happened to have open, which for
 * a student is schoolwork, a school portal, a messaging app, a
 * health search.
 *
 * So capture is restricted to accounts 13+ whose consent scope
 * covers it. An account under 13, or one whose consent scope
 * does not explicitly cover browsing capture, gets the
 * extension WITHOUT page context: agent-only chat, no page
 * reading.
 *
 * WHY NOT REMOVE THE EXTENSION ENTIRELY for those accounts. A
 * learner typing a question to their own agent in a side panel
 * is doing exactly what the Test panel already lets them do, in
 * a different window — everything sent is something they typed,
 * on their own account, to their own agent, metered
 * identically. The entire novelty of Phase 4 is page capture.
 * Removing the extension outright would deny a younger learner
 * a feature that introduces none of the risk.
 *
 * It is also one predicate in one place rather than three gates
 * at three layers, and it fails safe: a lookup that errors
 * costs a learner page context, not their agent.
 *
 * WHY THE COLUMN IS A DECISION AND NOT A BIRTHDATE. A date of
 * birth is materially more sensitive than the yes/no it would
 * be used to compute, and holding one would make that table
 * worth attacking for something other than what it does. Age is
 * also not the whole question: a 15-year-old on a
 * school-managed account whose consent never mentioned browsing
 * capture is denied, and no arithmetic on a birthday produces
 * that.
 *
 * WHAT WRITES THE TABLE IS NOT DECIDED HERE. A sign-up age
 * gate, a roster import, a parental-consent flow — all
 * account-model questions rather than extension ones. This
 * module reads; the table is the seam they land behind. Until
 * one of them exists, every account reads `unknown` and page
 * context is dark platform-wide, which is the correct behaviour
 * of a gate that fails closed rather than a bug.
 */

export type PageContextScope = "allowed" | "denied" | "unknown";

const SCOPES: PageContextScope[] = ["allowed", "denied", "unknown"];

/*
 * The scope on record for this account.
 *
 * A MISSING ROW IS `unknown`, and `unknown` denies. No row
 * means nobody has ever established this account's age or
 * consent scope, and the right answer to "may we capture what
 * this person is browsing" when we do not know who they are is
 * no.
 *
 * `denied` and `unknown` both refuse, and they are still
 * different values on purpose — an account nobody has assessed
 * and an account assessed as under-13 need different things
 * said to them on screen, and only one of them is fixable.
 * That distinction is for the UI; this function's callers only
 * ever ask the yes/no below.
 */
export async function pageContextScopeOf(
  userId: string
): Promise<PageContextScope> {
  const { data, error } = await supabase
    .from("user_account_scope")
    .select("page_context_scope")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    /*
     * FAILS CLOSED, and this is the one branch in the file that
     * matters most.
     *
     * Every other "never throws" lookup in this project
     * degrades toward doing LESS of something optional — a
     * failed connection list costs an agent its tools, a failed
     * search costs it a lookup. This one degrades toward not
     * reading a child's screen, which is the same direction for
     * a much better reason.
     *
     * Logged rather than thrown, so a database hiccup costs the
     * learner page context and not their turn.
     */
    console.error(
      `[extension] could not resolve account scope for ${userId}: ${error.message}`
    );

    return "unknown";
  }

  const raw = (data as { page_context_scope?: unknown } | null)
    ?.page_context_scope;

  /*
   * Normalised against the closed vocabulary rather than cast.
   * The column carries a CHECK, but a value written by a newer
   * build must not become an unhandled branch here — and the
   * safe reading of an unrecognised scope is the one that
   * refuses.
   */
  return typeof raw === "string" && SCOPES.includes(raw as PageContextScope)
    ? (raw as PageContextScope)
    : "unknown";
}

/*
 * The gate itself.
 *
 * One boolean, so that every caller asks the same question and
 * no caller gets to interpret a scope for itself.
 */
export async function pageContextAllowed(userId: string): Promise<boolean> {
  return (await pageContextScopeOf(userId)) === "allowed";
}
