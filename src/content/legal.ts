/*
 * The two documents BuildGentic is legally answerable for.
 *
 * Kept as markdown strings rather than JSX on purpose. These
 * are the only pages in the application whose *wording* is the
 * artefact — a lawyer, a school administrator or Google's OAuth
 * reviewer reads them, and any of them may hand back an edit.
 * Markdown means that edit is a text change to a paragraph
 * instead of a hunt through nested elements, and it means the
 * source here can be diffed against whatever document was
 * approved elsewhere.
 *
 * Nothing on this page is user input or model output. It is a
 * compile-time constant written by us, which is why the
 * renderer in pages/Legal.tsx does not carry the sanitising
 * stack that features/lab/markdown.ts builds for an answer a
 * model wrote. That distinction is the whole reason the two
 * renderers are separate.
 */

export interface LegalDocument {
  /* Where it lives. Used for the cross-link each document
     carries to the other, so the pair cannot drift apart from
     the routes in App.tsx. */
  path: string;
  title: string;
  /* Rendered under the title and nowhere else. Written out in
     full rather than as a numeric date, because "9/14/2026"
     means two different days depending on who is reading. */
  updated: string;
  /* The opening paragraph, lifted out of the body so it can be
     set as a lede above the rule. */
  lede: string;
  body: string;
}

/* =========================================================
   PRIVACY POLICY
   ========================================================= */

const PRIVACY_BODY = `
## What we collect

**Account information.** When you create an account, we collect your email address, a username, and basic profile information you provide.

**Course and platform activity.** Your progress through courses, XP earned, and agents you build are stored so the platform works — this is the core of the product.

**Conversations with agents.** When you chat with an agent (in the Lab, the Builder, or a published agent page), the conversation is processed to generate a response. Some agents can be given "Memory," which stores specific facts extracted from conversations, scoped to that agent, so it can recall them in future conversations with the same person.

**Files you upload.** If you attach a file to a conversation for an agent to analyze, that file is processed and stored temporarily (currently up to a limited retention window) and then deleted.

**Connections and third-party services.** If you connect an agent to a third-party service (an API key, a Gmail account, etc.), we store what's necessary to maintain that connection securely. Credentials/keys are encrypted and are never shown back to you, to the agent, or to anyone else after you enter them.

**Gmail access (Email Agent).** If you choose to connect a Gmail account, you'll go through Google's own sign-in and consent screen. We only request the specific permissions (scopes) needed for the features you've enabled — for example, read-only access if you've only turned on reading, and drafting access separately from sending. We do not request permission to permanently delete your email, and sending a real email always requires you to explicitly click "Send" yourself — no AI agent can trigger a send on its own.

**Browser extension.** The BuildGentic browser extension only reads the content of a page when you explicitly ask an agent to look at it. It does not run in the background, does not track your browsing, and cannot see any tab other than the one you're actively using it on.

**Usage and technical data.** We log basic technical information (timestamps, error logs, request volume) to keep the service running and secure.

## What we don't do

* We do not sell your personal information.
* We do not use your private conversations, documents, or emails to train AI models.
* We do not share your data with advertisers.
* We do not read or store your Gmail data beyond what's needed to perform the specific action you asked an agent to take.

## Third-party services we use

BuildGentic is built on top of a small number of infrastructure providers who process data on our behalf, under their own security and privacy commitments:

* **Supabase** — database and authentication
* **Vercel and Render** — application hosting
* **AI model providers** (e.g., Google Gemini) — used to generate agent responses
* **Resend** — transactional email delivery
* **Google (Gmail API)** — only for accounts that explicitly connect Gmail through Email Agent

## Children's privacy

BuildGentic is used in educational settings that may include students under 13. For accounts identified as belonging to a user under 13, certain features (including the browser extension's page-reading capability, and Email Agent) are restricted or unavailable by default, consistent with the Children's Online Privacy Protection Act (COPPA). Where BuildGentic is used through a school or program, that organization may provide consent on behalf of parents for use strictly within the educational program, as permitted under COPPA guidance for schools.

## Your choices

You can disconnect a connected service (like Gmail) at any time, which revokes BuildGentic's access. You can delete memories an agent holds. You can request deletion of your account and associated data by contacting us at [buildgentic@gmail.com](mailto:buildgentic@gmail.com).

## Data retention

We keep your data as long as your account is active. Uploaded files and generated documents are retained for a limited window and then automatically deleted. If you delete your account, we delete your associated personal data, other than what we're required to retain for legal or security reasons.

## Changes to this policy

If this policy changes in a material way, we'll update the "Last updated" date above and, where appropriate, notify users directly.

## Contact

Questions about this policy or your data can be sent to [buildgentic@gmail.com](mailto:buildgentic@gmail.com).
`;

export const PRIVACY_POLICY: LegalDocument = {
  path: "/privacy",
  title: "Privacy Policy",
  updated: "10 September 2026",
  lede: "This policy explains what information BuildGentic collects, why, and how it's handled. It covers the BuildGentic website, the BuildGentic browser extension, and any AI agents you build or use through BuildGentic.",
  body: PRIVACY_BODY,
};

/* =========================================================
   TERMS OF SERVICE
   ========================================================= */

const TERMS_BODY = `
## What BuildGentic is

BuildGentic is an educational platform for learning about AI: courses, an Agent Lab for experimenting, and an Agent Builder for creating and deploying AI agents with optional capabilities like running code, calling external APIs, generating documents, scheduling automated runs, and to email.

## Your account

You're responsible for keeping your account credentials secure and for activity that happens under your account. You must provide accurate information when creating an account.

## Acceptable use

You agree not to use BuildGentic to:

* Build or deploy an agent for illegal purposes, harassment, spam, or generating harmful content
* Attempt to bypass usage limits, security controls, or capability restrictions
* Use a connected email account, API connection, or any capability to send unauthorized communications or access data you're not entitled to
* Attempt to access another user's account, data, or connected services
* Interfere with the operation of the platform (e.g., attempting to overload it, probing for vulnerabilities without authorization)

## Agents you build

You're responsible for what your agents are configured to do and for any consequential action you personally authorize — including sending an email, since every send requires your explicit confirmation. BuildGentic is not responsible for the content an AI model generates, though we build safeguards to catch and disclose likely errors (for example, showing you what a captured web page actually said before you act on an agent's draft).

## Third-party connections

If you connect a third-party account or service (like Gmail) to an agent, you're also subject to that provider's own terms. You can disconnect at any time.

## XP, credits, and purchases

XP earned and spent within BuildGentic (for example, to unlock a flagship agent) has no cash value and cannot be exchanged for real currency.

## Content and intellectual property

You retain ownership of content you create (agent instructions, uploaded files, documents you generate). By using BuildGentic, you grant us the license needed to store, process, and display that content back to you as part of operating the service. We do not claim ownership of your work.

## Availability and changes

BuildGentic is provided as-is. Features may change, and we may need to restrict or pause a capability (for example, a beta feature) for safety or technical reasons. We'll try to communicate significant changes.

## Termination

We may suspend or terminate an account that violates these terms, particularly around the acceptable-use section above. You may delete your account at any time.

## Limitation of liability

BuildGentic is provided without warranties of any kind. To the extent permitted by law, we are not liable for indirect or consequential damages arising from your use of the platform, including actions taken by AI agents you configure.

## Children and educational use

If you're using BuildGentic through a school or educational program, that organization's own agreement with BuildGentic (if any) governs data handling for that program's students in addition to these terms.

## Changes to these terms

We may update these terms from time to time. Continued use of BuildGentic after a change means you accept the updated terms.

## Contact

Questions about these terms can be sent to [buildgentic@gmail.com](mailto:buildgentic@gmail.com).
`;

export const TERMS_OF_SERVICE: LegalDocument = {
  path: "/terms",
  title: "Terms of Service",
  updated: "14 September 2026",
  lede: "Welcome to BuildGentic. By creating an account or using BuildGentic, you agree to these terms.",
  body: TERMS_BODY,
};
