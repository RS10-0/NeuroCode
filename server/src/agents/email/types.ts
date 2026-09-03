/*
 * What an email provider is, as far as everything above it is
 * concerned.
 *
 * The same contract ai/types.ts writes for a model provider and
 * search/types.ts writes for a search one, and it exists for
 * the same reason: nothing above this file names Gmail. The
 * tools, the stores, the routes and the prompt all speak these
 * shapes, so adding Outlook is one new file plus one
 * `register()` call rather than a branch in nine places.
 *
 * TWO PROPERTIES OF THESE SHAPES ARE LOAD-BEARING RATHER THAN
 * TIDY, and both are about what a future browser extension will
 * need without this file knowing it exists.
 *
 * IDS ARE OPAQUE. A message id and a thread id are strings this
 * server received from a provider and hands back unchanged. It
 * never parses one, never constructs one, and never assumes a
 * format. That is what lets a different provider — or a page
 * the user is looking at — supply an id that means something
 * only to whoever issued it.
 *
 * BODIES ARE PLAIN TEXT AND ALREADY CAPPED. A provider adapter
 * is responsible for reducing whatever multipart HTML mess it
 * fetched down to readable text within `email.bodyChars` before
 * returning it. Not because HTML is hard to render, but because
 * the caller of this interface puts the result in a PROMPT: the
 * cap is a privacy ceiling as much as a budget, and a
 * capability that leaked markup would be handing a model a
 * larger attack surface for no gain.
 */

export type EmailProviderId = "gmail";

/*
 * One party on a message.
 *
 * `name` is whatever the sender chose to call themselves and is
 * therefore never trustworthy — it is display text and nothing
 * more. `address` is the machine-readable half and the only one
 * anything should compare.
 */
export interface EmailAddress {
  name: string | null;
  address: string;
}

/*
 * A message as a LISTING shows it: enough to recognise, decide
 * about and choose between, and deliberately not enough to read.
 *
 * This shape is what triage runs on, and the split from
 * `EmailMessage` below is the whole of this capability's cost
 * discipline. Twelve of these is about three thousand
 * characters; twelve full bodies would be forty thousand, would
 * not fit, and would put most of somebody's morning
 * correspondence into a single request to a model provider.
 */
export interface EmailSummary {
  /* Provider-opaque. See the header. */
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  /* ISO 8601, normalised by the adapter. Providers report dates
     in at least three formats between them and none of them is
     this one. */
  date: string;
  /* Already cut to `email.snippetChars` by the adapter. */
  snippet: string;
  unread: boolean;
  /*
   * Provider label or folder names, normalised to lowercase
   * where the provider uses constants. What the agent reads to
   * explain WHY it put a message in a category — "this is in
   * your Promotions tab" is a reason, and an inference about
   * the subject line is a guess.
   */
  labels: string[];
  hasAttachments: boolean;
}

/* The whole thing, fetched one at a time and on purpose. */
export interface EmailMessage extends EmailSummary {
  cc: EmailAddress[];
  /* Plain text, already within `email.bodyChars`. */
  body: string;
  /* Set when the adapter cut it. Surfaced to the model, because
     a model shown a truncated thread with no marker will report
     the last line it can see as the last line there is. */
  bodyTruncated: boolean;
  /*
   * What is attached, described but NOT fetched.
   *
   * File Analysis exists and is a separate capability with its
   * own extractors, its own limits and its own consent. Reading
   * an attachment's bytes because it happened to arrive in an
   * email would route around all three. So the agent is told a
   * spreadsheet is attached and can say so; opening it is not
   * something this capability does.
   */
  attachments: Array<{ filename: string; mimeType: string; bytes: number }>;
}

export interface EmailListOptions {
  /*
   * The provider's OWN search syntax, passed through unchanged.
   *
   * Not a query language of BuildGentic's invention, and that is
   * a deliberate refusal. Gmail's operators are documented, the
   * model knows them, and inventing a middle layer would mean
   * either reimplementing them or silently dropping the ones
   * not covered — and a search that quietly ignores half a
   * query is exactly the "do not invent search results" failure
   * this capability has to avoid.
   *
   * A provider that cannot honour a query says so, and the tool
   * reports that rather than pretending it searched.
   */
  query?: string;
  maxResults: number;
  unreadOnly?: boolean;
}

/*
 * What one organise call asks for.
 *
 * THERE IS NO DELETE, AND THERE IS NO TRASH.
 *
 * Not because the providers refuse — `gmail.modify` can trash a
 * message perfectly well — but because BuildGentic does not
 * offer it. Every field on this interface is reversible by a
 * person in thirty seconds through their own mail client, and
 * that is the line the MVP draws. A capability that can
 * irreversibly remove somebody's correspondence is a different
 * product decision from one that can tidy it, and it is not
 * one an agent should arrive at by having a `verb` field with
 * one more value in it.
 */
export interface EmailOrganizeInput {
  messageIds: string[];
  addLabels?: string[];
  removeLabels?: string[];
  archive?: boolean;
  markRead?: boolean;
  markUnread?: boolean;
}

/* What the agent wrote, on its way to becoming a stored draft.
   No ids: the draft does not exist yet. */
export interface EmailDraftContent {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  threadId?: string;
}

/*
 * A token set as a provider issues it.
 *
 * `refreshToken` is optional because Google returns one only on
 * the FIRST consent for a given client and user unless
 * `prompt=consent` is forced — a fact that has cost more
 * engineers an afternoon than any other detail of this flow.
 * The store treats an absent one as "keep the one I have"
 * rather than as "there is none", which is the only reading
 * that survives a re-authorisation.
 */
export interface EmailTokenSet {
  accessToken: string;
  refreshToken?: string;
  /* Seconds from now, as the provider reports it. */
  expiresIn?: number;
  /* Space-separated, as returned. Stored rather than assumed —
     a person may decline individual scopes on the consent
     screen. */
  scope?: string;
}

/*
 * Why a provider call failed, in terms the layers above can act
 * on differently.
 *
 *   unauthorized — the access token is dead. Refresh and retry
 *                  once; if that fails the grant is gone and
 *                  the person has to reconnect.
 *   forbidden    — authenticated, but this scope was not
 *                  granted. Reconnecting with more scopes is
 *                  the fix, and it is a different sentence from
 *                  the one above.
 *   not_found    — the id does not resolve. Ordinary: a model
 *                  guessing an id, or a message that moved.
 *   rate_limited — back off. Not the learner's fault and not a
 *                  reason to disable anything.
 *   unavailable  — the provider could not be reached.
 *   invalid      — the request was malformed, which is a bug
 *                  here rather than anywhere else.
 */
export type EmailErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "invalid";

export class EmailProviderError extends Error {
  readonly kind: EmailErrorKind;
  /* Safe to show a learner. The provider's own words are
     logged, never forwarded — they can name a project, a quota
     and an internal endpoint. */
  readonly detail: string | undefined;

  constructor(kind: EmailErrorKind, message: string, detail?: string) {
    super(message);
    this.name = "EmailProviderError";
    this.kind = kind;
    this.detail = detail;
  }
}

/*
 * The scopes a capability needs, named in BuildGentic's terms
 * rather than a provider's.
 *
 * The mapping to real scope strings lives in the adapter, which
 * is the only file allowed to know what Google calls things.
 */
export type EmailGrant = "read" | "draft" | "send" | "organize";

export interface EmailProvider {
  id: EmailProviderId;
  displayName: string;

  /*
   * Which grants this provider can actually offer.
   *
   * Reported rather than assumed, because a provider that
   * cannot do something must produce a refusal with an
   * explanation and not a 403 the learner has to interpret.
   */
  supports(grant: EmailGrant): boolean;

  /* Where to send the browser. The state and the PKCE challenge
     are made by oauth.ts and passed in; this only knows the
     provider's URL shape. */
  authorizeUrl(input: {
    state: string;
    codeChallenge: string;
    grants: EmailGrant[];
  }): string;

  exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<EmailTokenSet>;

  refresh(refreshToken: string): Promise<EmailTokenSet>;

  /* Best effort. A revoke that fails still results in the row
     being deleted — a token this server has thrown away is a
     token this server cannot use, whatever the provider still
     thinks. */
  revoke(token: string): Promise<void>;

  /* The address, from the provider, for the token just issued.
     Never from anything a caller typed. */
  identify(accessToken: string): Promise<string>;

  list(
    accessToken: string,
    options: EmailListOptions
  ): Promise<EmailSummary[]>;

  get(accessToken: string, messageId: string): Promise<EmailMessage>;

  thread(accessToken: string, threadId: string): Promise<EmailMessage[]>;

  /*
   * Sends. Called by the send ROUTE and by nothing else.
   *
   * No tool in the catalogue reaches this method, and that is
   * the send gate. See agents/email/tools.ts, which registers
   * read, draft and organize and deliberately does not register
   * a fourth.
   */
  send(
    accessToken: string,
    draft: EmailDraftContent
  ): Promise<{ messageId: string; threadId: string }>;

  organize(
    accessToken: string,
    input: EmailOrganizeInput
  ): Promise<{ changed: number }>;
}

/* How many grants map onto the scopes a provider will be asked
   for. Read is always requested; the rest follow the agent's
   capabilities at the moment the person connects. */
export const ALL_GRANTS: EmailGrant[] = ["read", "draft", "send", "organize"];
