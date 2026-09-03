import { gmailProvider } from "./providers/GmailProvider";
import type { EmailProvider, EmailProviderId } from "./types";

/*
 * Which email providers this build ships.
 *
 * The same shape as ai/ProviderRegistry.ts and
 * search/providers, and it is a map with one entry on purpose:
 * the point of a registry with one member is that the SECOND
 * member is a file plus a line, rather than a refactor of
 * everything that assumed there was only ever one.
 *
 * Outlook is the intended second. Microsoft Graph's mail
 * endpoints map onto `EmailProvider` without a shape change —
 * `Mail.Read`, `Mail.ReadWrite` and `Mail.Send` land on read,
 * organize and send, and drafts are a resource rather than a
 * scope — so nothing above this file has to know when it
 * arrives.
 */

const PROVIDERS: Record<EmailProviderId, EmailProvider> = {
  gmail: gmailProvider,
};

export function emailProvider(id: string): EmailProvider | undefined {
  return PROVIDERS[id as EmailProviderId];
}

/* The one a new connection uses. A field rather than a constant
   the day there are two. */
export const DEFAULT_EMAIL_PROVIDER: EmailProviderId = "gmail";

export function isEmailProviderId(value: string): value is EmailProviderId {
  return value in PROVIDERS;
}
