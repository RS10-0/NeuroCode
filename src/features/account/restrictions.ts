/*
 * What an account for an under-13 cannot do, in the words a
 * parent reads.
 *
 * One list, read by both sides: the server's consent email
 * (server/src/account/rules.ts) and the parent's page in the
 * browser. A parent who agrees on the page has agreed to what
 * the email told them, and they cannot drift apart if there is
 * only one copy. verify-age-gate.mts checks every line reaches
 * the email.
 *
 * Each line corresponds to a server-side refusal:
 *   public page    — routes/agents.ts refusePublic, SiteStore resolveSite
 *   keys for apps  — routes/agents.ts refusePublic, DeploymentStore
 *   email account  — routes/email.ts /email/connect
 *   page reading   — page_context_scope 'denied', AccountScope.ts
 */
export const UNDER_13_CANNOT = [
  "publish a public page or share a link that strangers can open",
  "create keys that let other apps or websites use their agents",
  "connect an email account to an agent",
  "let the BuildGentic browser extension read web pages",
];
