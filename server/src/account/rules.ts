/*
 * The age gate's decisions, with no database in them.
 *
 * Every rule that decides what an account may do lives here as a
 * plain function over plain values, so scripts/verify-age-gate.mts
 * can prove each one without a Supabase project. AgeGate.ts and
 * consent.ts read rows and call these; neither makes a decision
 * of its own.
 */

import { UNDER_13_CANNOT } from "../../../src/features/account/restrictions";

export type AgeBand = "under_13" | "13_17" | "18_plus";

export const AGE_BANDS: readonly AgeBand[] = ["under_13", "13_17", "18_plus"];

export type ConsentStatus = "not_required" | "pending" | "granted";

/*
 * What the app does with an account.
 *
 *   unanswered — has not been asked yet: every account from
 *                before the gate existed, until its next visit
 *   active     — 13 or over
 *   restricted — under 13, a parent agreed; most things work
 *   pending    — under 13, waiting for a parent; nothing works
 */
export type AgeStatus = "unanswered" | "active" | "restricted" | "pending";

export interface ScopeFacts {
  ageBand: AgeBand | null;
  consentStatus: ConsentStatus | null;
}

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}

export function statusOf(facts: ScopeFacts | null): AgeStatus {
  if (!facts?.ageBand) {
    return "unanswered";
  }

  if (facts.ageBand !== "under_13") {
    return "active";
  }

  return facts.consentStatus === "granted" ? "restricted" : "pending";
}

/*
 * Whether the account is shut out of everything but the routes
 * that let it get unstuck (resend, change address, delete).
 *
 * Only `pending`. An unanswered account is NOT blocked on the
 * server: every learner who existed before this shipped is
 * unanswered, and blocking them would turn the deploy into an
 * outage for the whole site. The app asks them on their next
 * page view; the server's job is the accounts it knows are
 * under 13.
 */
export function isBlocked(facts: ScopeFacts | null): boolean {
  return statusOf(facts) === "pending";
}

/*
 * Whether the account may create something a stranger can
 * reach — a published page or a deployment key.
 *
 * Fails CLOSED: only a recorded 13+ answer may. An unanswered
 * account is asked before it reaches these screens anyway, and
 * the alternative ordering — let anyone publish until proven
 * young — is the one that puts a child's page on the internet
 * because a lookup failed.
 */
export function mayPublish(facts: ScopeFacts | null): boolean {
  return facts?.ageBand === "13_17" || facts?.ageBand === "18_plus";
}

/*
 * Whether something ALREADY public should stop answering.
 *
 * The opposite default from mayPublish, deliberately. Pages and
 * keys created before the gate existed belong to accounts that
 * have not answered yet, almost all of them 13 or over; taking
 * every one offline at deploy would break the product for the
 * learners it is not about. Only a recorded under-13 answer
 * takes a page down.
 */
export function mustWithdrawPublic(facts: ScopeFacts | null): boolean {
  return facts?.ageBand === "under_13";
}

/*
 * Whether this account's prompts may go to an AI provider that
 * keeps them to train its own models (providerChain.ts
 * `trainsOnPrompts`).
 *
 * Only a recorded 13+ answer may. Under 13 never: the parent's
 * consent email says what their child types is not used to
 * train AI. Unanswered also not — an existing account that has
 * not been asked yet may well be a child, and its schedules and
 * published agents keep running before its owner next signs in.
 * The cost of being cautious with an adult is a few hours on the
 * two providers that do not train; the cost the other way is a
 * child's words in somebody's training set.
 */
export function mayUseTrainingProviders(facts: ScopeFacts | null): boolean {
  return facts?.ageBand === "13_17" || facts?.ageBand === "18_plus";
}

/*
 * The write-once rule for the age answer.
 *
 * Asked once, recorded once. A learner who could re-answer could
 * answer "under 13", get refused something, and answer again —
 * or, worse, an account under 13 could re-answer "18" to escape
 * the pending state. Changing a recorded band is an operator
 * action in SQL, not a button.
 */
export function mayRecordAge(existing: ScopeFacts | null): boolean {
  return !existing?.ageBand;
}

/* =========================================================
   CONSENT REQUESTS
========================================================= */

/* How long a parent has to answer before the account goes. */
export const CONSENT_LIFETIME_DAYS = 7;

/* Emails to parents, per account, per rolling day — and the gap
   between any two. Without both, the parent-email field is a way
   to make BuildGentic mail a stranger as often as somebody
   likes. */
export const RESENDS_PER_DAY = 3;
export const RESEND_GAP_SECONDS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export function consentExpiry(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + CONSENT_LIFETIME_DAYS * DAY_MS);
}

export interface SendHistory {
  emailsSent: number;
  lastSentAt: Date;
}

export type ResendVerdict =
  | { ok: true; nextCount: number }
  | { ok: false; retryAfterSeconds: number };

/*
 * Whether another email may go out now.
 *
 * The count resets once a full day has passed since the last
 * send. That is a slightly generous reading of "three a day" —
 * a learner who sends one email a day forever is never refused —
 * and that is the right side to be generous on: the limit exists
 * to stop bursts aimed at a stranger, not a child nudging a
 * parent once each morning.
 */
export function mayResend(history: SendHistory, now: Date): ResendVerdict {
  const sinceLast = now.getTime() - history.lastSentAt.getTime();

  if (sinceLast < RESEND_GAP_SECONDS * 1000) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((RESEND_GAP_SECONDS * 1000 - sinceLast) / 1000),
    };
  }

  const count = sinceLast >= DAY_MS ? 0 : history.emailsSent;

  if (count >= RESENDS_PER_DAY) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((DAY_MS - sinceLast) / 1000),
    };
  }

  return { ok: true, nextCount: count + 1 };
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/*
 * A plausible email address, and nothing cleverer.
 *
 * The real test of an address is whether mail arrives, and the
 * consent flow is that test. This only refuses what cannot be an
 * address at all, so the error shows up on the form rather than
 * as a send that fails at the provider.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const email = raw.trim().toLowerCase();

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

/* =========================================================
   THE PARENT'S EMAILS

   Plain text, built here so the test can check what they say.
   COPPA's direct notice has required contents — that we have
   their address only to ask, that nothing happens without them,
   what we would collect and why, that unanswered requests are
   deleted, and where the full policy is. Each is a sentence
   below, and verify-age-gate.mts asserts every one is present.
========================================================= */

/* Shared with the parent's page so the two cannot disagree. */
export { UNDER_13_CANNOT };

export function consentNoticeText(input: {
  childName: string;
  siteUrl: string;
  link: string;
}): string {
  const { childName, siteUrl, link } = input;

  return [
    `Hello,`,
    ``,
    `${childName} has asked to join BuildGentic, a website where people learn how AI works by building small AI "agents". They told us they are under 13, so we need a parent or guardian to agree before their account can be used.`,
    ``,
    `We have your email address only because ${childName} gave it to us so we could ask you. We have not used their account for anything, and we will not until you agree.`,
    ``,
    `To say yes or no, open this link:`,
    link,
    ``,
    `If you do nothing, we will delete ${childName}'s account and your email address after ${CONSENT_LIFETIME_DAYS} days.`,
    ``,
    `WHAT WE WOULD COLLECT, AND WHY`,
    `- Their display name, email address and password, so they can sign in.`,
    `- Their course progress and points, and the agents they build, so the website works.`,
    `- What they type to the agents they build, and any notes they give those agents. This is sent only to AI services that do not use it to train AI, only to produce the agent's answer. We do not use it to train AI either, and we do not show it to anyone else.`,
    `We do not sell children's information, show them ads, or share it with advertisers.`,
    ``,
    `WHAT ACCOUNTS FOR UNDER-13s CANNOT DO`,
    ...UNDER_13_CANNOT.map((line) => `- ${line}`),
    `Nothing they make on BuildGentic can be seen by anyone else.`,
    ``,
    `YOUR CHOICES`,
    `You can change your mind at any time. After you agree, we will email you a link that withdraws your consent and deletes the account and everything in it.`,
    ``,
    `Our full privacy policy: ${siteUrl}/privacy`,
    ``,
    `If you did not expect this email, you can ignore it. Nothing will happen and the account will be deleted.`,
    ``,
    `— BuildGentic`,
  ].join("\n");
}

export function consentConfirmationText(input: {
  childName: string;
  parentName: string;
  siteUrl: string;
  revokeLink: string;
}): string {
  const { childName, parentName, siteUrl, revokeLink } = input;

  return [
    `Hello ${parentName},`,
    ``,
    `You agreed to ${childName}'s BuildGentic account. They can now sign in and use it, with the limits for under-13 accounts: no public pages, no keys for other apps, no email accounts, and no browser extension reading web pages.`,
    ``,
    `If this was not you, or you change your mind later, open this link to withdraw your consent. It deletes the account and everything in it:`,
    revokeLink,
    ``,
    `Keep this email — the link keeps working for as long as the account exists.`,
    ``,
    `Our full privacy policy: ${siteUrl}/privacy`,
    ``,
    `— BuildGentic`,
  ].join("\n");
}
