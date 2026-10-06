/*
 * Proof that the age gate decides what it says it decides.
 *
 * Every rule lives in server/src/account/rules.ts as a plain
 * function, and the browser's month-and-year arithmetic lives in
 * src/features/account/age.ts; this checks both with no
 * database, no server and no env. The end-to-end half — a real
 * pending account refused everywhere, a real email arriving —
 * needs migration 0024 applied and is described in
 * docs/deployment.md.
 *
 *   npx tsx ./scripts/verify-age-gate.mts
 */

import {
  consentConfirmationText,
  consentExpiry,
  consentNoticeText,
  isBlocked,
  isExpired,
  mayPublish,
  mayRecordAge,
  mayResend,
  mayUseTrainingProviders,
  mustWithdrawPublic,
  normaliseEmail,
  statusOf,
  CONSENT_LIFETIME_DAYS,
  RESENDS_PER_DAY,
  UNDER_13_CANNOT,
  type ScopeFacts,
} from "../server/src/account/rules";
import { bandFor } from "../src/features/account/age";
import { PROVIDER_CHAIN, withoutTrainingProviders } from "../server/src/ai/providerChain";
import { allEmbeddingModels } from "../server/src/ai/embeddingModels";

const problems: string[] = [];
let checks = 0;

function check(ok: boolean, message: string) {
  checks += 1;
  if (!ok) problems.push(message);
}

function eq<T>(actual: T, expected: T, message: string) {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

console.log("\nAGE GATE\n");

/* ---------------- age bands ---------------- */

console.log("  age bands from month and year");

// 5 October 2026. Months are 1-12.
const today = new Date(2026, 9, 5);

eq(bandFor({ month: 10, year: 2013 }, today), "13_17", "born this month 13 years ago has turned 13");
eq(bandFor({ month: 9, year: 2013 }, today), "13_17", "born last month 13 years ago is 13");
eq(bandFor({ month: 11, year: 2013 }, today), "under_13", "born next month 13 years ago is still 12");
eq(bandFor({ month: 1, year: 2014 }, today), "under_13", "born early the following year is 12");
eq(bandFor({ month: 10, year: 2008 }, today), "18_plus", "born this month 18 years ago has turned 18");
eq(bandFor({ month: 11, year: 2008 }, today), "13_17", "born next month 18 years ago is 17");
eq(bandFor({ month: 6, year: 1980 }, today), "18_plus", "an adult");
eq(bandFor({ month: 6, year: 2020 }, today), "under_13", "a six-year-old");

/* ---------------- statuses ---------------- */

console.log("  statuses and what each may do");

const unanswered: ScopeFacts | null = null;
const adult: ScopeFacts = { ageBand: "18_plus", consentStatus: "not_required" };
const teen: ScopeFacts = { ageBand: "13_17", consentStatus: "not_required" };
const waiting: ScopeFacts = { ageBand: "under_13", consentStatus: "pending" };
const approved: ScopeFacts = { ageBand: "under_13", consentStatus: "granted" };

eq(statusOf(unanswered), "unanswered", "no row");
eq(statusOf(adult), "active", "18+");
eq(statusOf(teen), "active", "13-17");
eq(statusOf(waiting), "pending", "under 13, waiting");
eq(statusOf(approved), "restricted", "under 13, approved");

eq(isBlocked(waiting), true, "pending is blocked");
eq(isBlocked(approved), false, "approved is not blocked");
eq(isBlocked(unanswered), false, "unanswered is NOT blocked on the server (deploy must not lock out existing users)");
eq(isBlocked(adult), false, "adult not blocked");

eq(mayPublish(adult), true, "adult may publish");
eq(mayPublish(teen), true, "teen may publish");
eq(mayPublish(approved), false, "approved under-13 may not publish");
eq(mayPublish(waiting), false, "pending may not publish");
eq(mayPublish(unanswered), false, "unanswered may not publish (fails closed)");

eq(mustWithdrawPublic(approved), true, "under-13 pages come down");
eq(mustWithdrawPublic(waiting), true, "pending pages come down");
eq(mustWithdrawPublic(unanswered), false, "unanswered pages stay up (existing users)");
eq(mustWithdrawPublic(adult), false, "adult pages stay up");

eq(mayRecordAge(unanswered), true, "first answer is accepted");
eq(mayRecordAge(adult), false, "a second answer is refused");
eq(mayRecordAge(waiting), false, "pending cannot re-answer its way out");

/* ---------------- consent timing ---------------- */

console.log("  consent expiry and resend limits");

const asked = new Date("2026-10-05T12:00:00Z");
const expires = consentExpiry(asked);

eq(
  (expires.getTime() - asked.getTime()) / 86_400_000,
  CONSENT_LIFETIME_DAYS,
  "expiry is the promised number of days"
);
eq(isExpired(expires, new Date(expires.getTime() - 1)), false, "a moment before expiry is live");
eq(isExpired(expires, expires), true, "at expiry it is expired");

const at = (iso: string) => new Date(iso);

const tooSoon = mayResend({ emailsSent: 1, lastSentAt: at("2026-10-05T12:00:00Z") }, at("2026-10-05T12:00:30Z"));
check(!tooSoon.ok, "a resend 30 seconds later is refused");

const second = mayResend({ emailsSent: 1, lastSentAt: at("2026-10-05T12:00:00Z") }, at("2026-10-05T12:05:00Z"));
check(second.ok && second.nextCount === 2, "a resend 5 minutes later is allowed and counted");

const atLimit = mayResend(
  { emailsSent: RESENDS_PER_DAY, lastSentAt: at("2026-10-05T12:00:00Z") },
  at("2026-10-05T18:00:00Z")
);
check(!atLimit.ok, `the ${RESENDS_PER_DAY + 1}th email in a day is refused`);
check(!atLimit.ok && atLimit.retryAfterSeconds > 0, "a refusal says when to retry");

const nextDay = mayResend(
  { emailsSent: RESENDS_PER_DAY, lastSentAt: at("2026-10-05T12:00:00Z") },
  at("2026-10-06T12:00:01Z")
);
check(nextDay.ok && nextDay.nextCount === 1, "a day later the count starts again");

/* ---------------- email addresses ---------------- */

console.log("  parent email addresses");

eq(normaliseEmail("  Parent@Example.COM "), "parent@example.com", "trimmed and lower-cased");
eq(normaliseEmail("not an email"), null, "nonsense refused");
eq(normaliseEmail("a@b"), null, "no dot in the domain refused");
eq(normaliseEmail(42), null, "non-string refused");

/* ---------------- what the parent is told ---------------- */

console.log("  the notice says what COPPA expects it to say");

const notice = consentNoticeText({
  childName: "Ada",
  siteUrl: "https://www.buildgentic.com",
  link: "https://www.buildgentic.com/parent-consent#token=abc",
});

const mustSay: Array<[string, string]> = [
  ["only because Ada gave it to us", "why we have the parent's address"],
  ["until you agree", "that nothing happens without consent"],
  [`after ${CONSENT_LIFETIME_DAYS} days`, "that unanswered requests are deleted"],
  ["WHAT WE WOULD COLLECT", "what would be collected"],
  ["only to AI services that do not use it to train AI", "the training statement"],
  ["/privacy", "a link to the full policy"],
  ["#token=abc", "the consent link"],
  ["change your mind", "that consent can be withdrawn"],
];

for (const [phrase, what] of mustSay) {
  check(notice.includes(phrase), `the notice states ${what} ("${phrase}")`);
}

for (const line of UNDER_13_CANNOT) {
  check(notice.includes(line), `the notice lists the restriction "${line}"`);
}

const confirmation = consentConfirmationText({
  childName: "Ada",
  parentName: "Grace Hopper",
  siteUrl: "https://www.buildgentic.com",
  revokeLink: "https://www.buildgentic.com/parent-consent#revoke=xyz",
});

check(confirmation.includes("#revoke=xyz"), "the confirmation carries the withdraw link");
check(confirmation.includes("Grace Hopper"), "the confirmation names the parent who signed");

/* ---------------- which AI providers an account may reach ---------------- */

console.log("  AI providers: under-13 and unanswered accounts stay off training providers");

eq(mayUseTrainingProviders(adult), true, "18+ may reach every provider");
eq(mayUseTrainingProviders(teen), true, "13-17 may reach every provider");
eq(mayUseTrainingProviders(approved), false, "approved under-13 may not");
eq(mayUseTrainingProviders(waiting), false, "pending under-13 may not");
eq(mayUseTrainingProviders(unanswered), false, "unanswered may not (could be a child)");

const trains = Object.fromEntries(PROVIDER_CHAIN.map((entry) => [entry.providerId, entry.trainsOnPrompts]));

eq(trains.groq, false, "Groq is marked as not training on prompts");
eq(trains.cloudflare, false, "Cloudflare is marked as not training on prompts");
eq(trains.openrouter, true, "OpenRouter's free NVIDIA endpoint is marked as training");
eq(trains.mistral, true, "Mistral's free plan is marked as training");

const fakeChain = PROVIDER_CHAIN.map((entry) => ({ providerId: entry.providerId, entry }));
const kept = withoutTrainingProviders([...fakeChain, { providerId: "mock", entry: null }]).map(
  (candidate) => candidate.providerId
);

eq(kept.join(","), "groq,cloudflare,mock", "the filtered chain is Groq, then Cloudflare, plus the offline mock");

const realEmbedding = allEmbeddingModels().find((model) => model.provider !== "mock");

eq(realEmbedding?.provider, "cloudflare", "the platform embeds on Cloudflare");
eq(realEmbedding?.dimensions, 768, "the embedding width still matches the column (768)");
check(
  !allEmbeddingModels().some((model) => model.provider === "gemini"),
  "no Gemini embedding model remains in the catalogue (its terms bar under-18 services)"
);
check(
  (realEmbedding?.maxInputChars ?? Infinity) <= 2_000,
  "the embedding input cap keeps chunks inside bge-base's 512-token window"
);

/* ---------------- summary ---------------- */

console.log("\n=== SUMMARY ===");
console.log(`  ${checks - problems.length} passed, ${problems.length} failed`);

for (const problem of problems) {
  console.log(`  FAIL ${problem}`);
}

process.exit(problems.length ? 1 : 0);
