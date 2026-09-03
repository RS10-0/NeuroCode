import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Trash2,
  Unplug,
} from "lucide-react";

import { Badge, Button, Callout, Dialog, EmptyState } from "../../components/ui";
import {
  disconnectEmailAccount,
  discardDraft,
  fetchEmailStatus,
  listEmailDrafts,
  sendDraft,
  startEmailConnect,
  type DraftSourcePage,
  type EmailAccountSummary,
  type EmailDraftRecord,
  type EmailStatus,
} from "./emailApi";
import type { AgentDraft } from "./types";

/*
 * The mailbox, and the tray of things waiting to be decided
 * about.
 *
 * THE SEND BUTTON IN THIS FILE IS THE ONLY WAY A MESSAGE LEAVES
 * BUILDGENTIC, and everything about the layout follows from
 * that one sentence.
 *
 * The whole draft is on screen — recipients, subject, body — so
 * that pressing Send is a decision made about something read
 * rather than about a summary of it. A card that said "Reply to
 * Professor Ellis · 3 paragraphs" with a button next to it
 * would be a card that trains people to approve without
 * looking, and this is the one screen in the product where that
 * habit has consequences outside the account.
 *
 * The state comes from ROWS, never from what the agent said.
 * That is what makes "drafted" and "sent" impossible for an
 * agent to blur: a reply it claimed to have sent shows up here
 * as a draft with a button still on it, contradicting its own
 * prose from the next panel over.
 */

interface EmailSectionProps {
  draft: AgentDraft;
  /* Null until the agent has been saved once. A draft row
     carries a foreign key to a saved agent, so this is the
     difference between a working tray and an explanation of why
     there is not one. */
  agentId: string | null;
  onOpenCapabilities: () => void;
}

export default function EmailSection({
  draft,
  agentId,
  onOpenCapabilities,
}: EmailSectionProps) {
  const canRead = draft.capabilities.includes("email_read");
  const canDraft = draft.capabilities.includes("email_draft");
  const canSendCapability = draft.capabilities.includes("email_send");
  const anyEmail =
    canRead || canDraft || canSendCapability ||
    draft.capabilities.includes("email_organize");

  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [drafts, setDrafts] = useState<EmailDraftRecord[] | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<EmailDraftRecord | null>(null);

  const refresh = useCallback(async () => {
    setError(null);

    try {
      const next = await fetchEmailStatus();
      setStatus(next);

      if (agentId) {
        const tray = await listEmailDrafts(agentId);
        setDrafts(tray.drafts);
        setCanSend(tray.canSend);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not check your email connection."
      );
    }
  }, [agentId]);

  /*
   * The first read, written as its own async body rather than
   * as a call to `refresh` — which calls setError synchronously
   * before it awaits, and inside an effect that is the
   * cascading render the lint rule is right about. The same
   * shape RecordsSection uses, for the same reason.
   */
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const next = await fetchEmailStatus();

        if (!active) {
          return;
        }

        setStatus(next);

        if (agentId) {
          const tray = await listEmailDrafts(agentId);

          if (active) {
            setDrafts(tray.drafts);
            setCanSend(tray.canSend);
          }
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not check your email connection."
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [agentId]);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await run();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);

    try {
      const url = await startEmailConnect({
        ...(agentId ? { agentId } : {}),
        returnPath: agentId ? `/agents/${agentId}` : "/agents",
      });

      /* A full navigation rather than a popup. Google's consent
         screen refuses to render in an iframe, and a popup is
         the thing browsers block by default. */
      window.location.href = url;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start connecting that account."
      );
      setBusy(false);
    }
  };

  const account: EmailAccountSummary | undefined = status?.accounts[0];

  const waiting = (drafts ?? []).filter(
    (entry) => entry.status === "draft" || entry.status === "sending"
  );
  const sent = (drafts ?? []).filter((entry) => entry.status === "sent");

  return (
    <section className="agentsec" aria-labelledby="agentsec-email">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-email">
          Email
        </h2>

        <p className="agentsec__lede">
          The mailbox your agent works with, and every reply it has written
          waiting for you to decide about.{" "}
          {anyEmail ? (
            <>
              Your agent cannot send anything by itself — there is no way for it
              to. Every message that leaves does so because you pressed Send on
              this screen.
            </>
          ) : (
            <>
              None of the email capabilities are switched on, so there is
              nothing for this agent to read. Turn one on in Capabilities.
            </>
          )}
        </p>
      </div>

      <div className="agentsec__body">
        {!anyEmail ? (
          <Callout tone="caution" title="Email is off for this agent">
            A mailbox you connect here belongs to your BuildGentic account
            rather than to one agent — but this agent will not read it until it
            has the capability.
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button variant="secondary" size="sm" onClick={onOpenCapabilities}>
                Open Capabilities
              </Button>
            </div>
          </Callout>
        ) : null}

        {error ? (
          <Callout tone="error" title="Something went wrong">
            {error}
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refresh()}
                icon={<RefreshCw size={14} />}
              >
                Try again
              </Button>
            </div>
          </Callout>
        ) : null}

        {!status && !error ? (
          <p className="agentsec__note">
            <Loader2 size={14} className="spin" aria-hidden="true" /> Checking
            your email connection…
          </p>
        ) : null}

        {/* -------------------------------------------------
            THE ACCOUNT

            Stated as a fact rather than a form. Nothing here
            asks for a password, and the copy says so — "give an
            AI product your email password" is a reasonable
            thing to refuse, and the answer belongs on the
            screen where somebody is deciding.
            ------------------------------------------------- */}
        {status && !status.configured ? (
          <Callout tone="caution" title="Email is not set up on this server">
            Connecting a mailbox needs Google credentials in the server's
            environment, and they are not there. This is a configuration
            problem rather than something you can fix from here — whoever runs
            this BuildGentic needs to set{" "}
            <code>NEUROLINK_GMAIL_CLIENT_ID</code> and{" "}
            <code>NEUROLINK_GMAIL_CLIENT_SECRET</code>.
          </Callout>
        ) : null}

        {status?.configured && !account ? (
          <div className="emailacct emailacct--empty">
            <EmptyState
              icon={<Mail size={20} />}
              title="No mailbox connected"
              text="Connect a Gmail account and your agent can read it, triage it and write replies for you. You sign in with Google — BuildGentic never sees your password, and the agent is never given the key."
            />

            <div className="emailacct__actions">
              <Button
                variant="primary"
                onClick={() => void connect()}
                disabled={busy}
                icon={<Mail size={16} />}
              >
                Connect Gmail
              </Button>
            </div>
          </div>
        ) : null}

        {account ? (
          <div className="emailacct">
            <div className="emailacct__head">
              <div>
                <h3 className="emailacct__address">
                  <CheckCircle2 size={16} aria-hidden="true" />{" "}
                  {account.emailAddress}
                </h3>

                <p className="agentsec__note">
                  Connected{" "}
                  {new Date(account.connectedAt).toLocaleDateString()} · the key
                  stays on the server and is never shown to your agent.
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => void act(() => disconnectEmailAccount(account.id))}
                disabled={busy}
                icon={<Unplug size={14} />}
              >
                Disconnect
              </Button>
            </div>

            {/* ---------------------------------------------
                WHAT WAS ACTUALLY GRANTED

                Shown because a person may untick a permission
                on Google's own screen, and an agent that
                believes it may draft when the mailbox was
                connected read-only fails at the tool with a
                sentence nobody expected. Saying it here turns
                that into something visible before it happens.
                --------------------------------------------- */}
            <div className="emailacct__grants">
              <Grant
                label="Read and search"
                granted={account.grants.includes("read")}
                wanted={canRead}
              />
              <Grant
                label="Write drafts"
                granted={account.grants.includes("draft")}
                wanted={canDraft}
              />
              <Grant
                label="Send"
                granted={account.grants.includes("send")}
                wanted={canSendCapability}
              />
              <Grant
                label="Labels and archiving"
                granted={account.grants.includes("organize")}
                wanted={draft.capabilities.includes("email_organize")}
              />
            </div>

            {account.grants.length > 0 &&
            ((canDraft && !account.grants.includes("draft")) ||
              (canSendCapability && !account.grants.includes("send")) ||
              (draft.capabilities.includes("email_organize") &&
                !account.grants.includes("organize"))) ? (
              <Callout tone="caution" title="Some permissions were not granted">
                This agent can do more than the mailbox allows. Reconnect and
                allow the missing permissions, or turn those capabilities off so
                the agent stops trying.
                <div style={{ marginTop: "var(--space-3)" }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void connect()}
                    disabled={busy}
                  >
                    Reconnect
                  </Button>
                </div>
              </Callout>
            ) : null}
          </div>
        ) : null}

        {/* -------------------------------------------------
            THE TRAY
            ------------------------------------------------- */}
        {!agentId ? (
          <Callout tone="info" title="Save this agent to see its drafts">
            A mailbox belongs to your account, so the connection above works
            straight away. Drafts are stored against a saved agent — save this
            one and anything it writes will appear here.
          </Callout>
        ) : null}

        {agentId && drafts ? (
          <div className="emaildrafts">
            <div className="memories__head">
              <div>
                <h3 className="memories__subtitle">
                  Waiting for you{waiting.length > 0 ? ` (${waiting.length})` : ""}
                </h3>
                <p className="agentsec__note">
                  Nothing here has been sent. Drafts are kept for a week.
                </p>
              </div>

              <div className="memories__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void refresh()}
                  disabled={busy}
                  icon={<RefreshCw size={14} />}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {waiting.length === 0 ? (
              <EmptyState
                icon={<Send size={20} />}
                title="No drafts waiting"
                text={
                  canDraft
                    ? "Ask your agent to reply to something in the Test panel and the draft will appear here for you to read."
                    : "Turn on Draft Replies and your agent can start writing replies for you to approve."
                }
              />
            ) : (
              <ul className="emaildrafts__list">
                {waiting.map((entry) => (
                  <DraftCard
                    key={entry.id}
                    draft={entry}
                    busy={busy}
                    canSend={canSend}
                    onSend={() => setConfirming(entry)}
                    onDiscard={() =>
                      void act(() => discardDraft(agentId, entry.id))
                    }
                  />
                ))}
              </ul>
            )}

            {sent.length > 0 ? (
              <div className="memories__deployed">
                <div className="memories__head">
                  <div>
                    <h3 className="memories__subtitle">Sent</h3>
                    <p className="agentsec__note">
                      Messages that actually left, with the time they went. This
                      list is built from what the mail provider confirmed, not
                      from what your agent said.
                    </p>
                  </div>
                </div>

                <ul className="emaildrafts__list">
                  {sent.map((entry) => (
                    <DraftCard
                      key={entry.id}
                      draft={entry}
                      busy={busy}
                      canSend={false}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------
          THE CONFIRMATION

          A second, deliberate step, and it names the recipient
          rather than saying "are you sure". The question worth
          asking before a message leaves is "is this going to
          the right person", and a dialog that does not say who
          cannot ask it.
          --------------------------------------------------- */}
      <Dialog
        open={confirming !== null}
        title="Send this message?"
        confirmLabel="Send it"
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);

          if (target && agentId) {
            void act(() => sendDraft(agentId, target.id));
          }
        }}
      >
        {confirming ? (
          <>
            <p>
              This will go to <strong>{confirming.to.join(", ")}</strong>
              {confirming.cc.length > 0 ? (
                <>
                  , copying <strong>{confirming.cc.join(", ")}</strong>
                </>
              ) : null}{" "}
              from {account?.emailAddress ?? "your connected mailbox"}.
            </p>
            <p>
              Subject: <strong>{confirming.subject || "(none)"}</strong>
            </p>
            <SourcePage page={confirming.sourcePage} />
            <p>Once it has gone it cannot be taken back.</p>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}

/* =========================================================
   PIECES
========================================================= */

/*
 * WHAT SHAPED THIS DRAFT, shown before it is sent.
 *
 * The condition attached to letting the extension inherit the
 * email capabilities at all, and the reason it is not optional.
 *
 * Everywhere else on this platform, the worst a hostile web
 * page achieves is a bad answer on the learner's own screen. A
 * drafted reply is the one thing that carries a captured page
 * toward another person — and `email_send`'s whole design rests
 * on the promise that every send is a decision made about
 * something you have read. A learner reading a draft sees the
 * words and not what produced them, so a reply that reads
 * perfectly reasonably may have been shaped by a paragraph its
 * author wrote specifically to shape it.
 *
 * SHOWING THE ADDRESS ALONE WOULD BE THE CHEAP VERSION AND IT
 * WOULD NOT WORK. An injected instruction lives in the text, so
 * a learner told only that example.com was used has been shown
 * the one part of the capture that cannot betray it. The whole
 * text is here.
 *
 * COLLAPSED BY DEFAULT, because most captures are unremarkable
 * and a wall of page text above every send would train people
 * to scroll past the entire screen — which would cost more than
 * it buys. Expandable rather than truncated, because the one
 * time it matters is the time the payload is at the bottom.
 *
 * AND IF THE CAPTURE WAS CUT SHORT, THAT IS SAID BEFORE THE
 * TEXT RATHER THAN INSIDE IT. A learner who reads a capture to
 * the end and finds nothing alarming has concluded something
 * the text did not support, because the alarming part may
 * simply not be in it. That sentence is worth more than the
 * character count beside it, so it does not hide behind the
 * same disclosure triangle.
 *
 * RENDERED AS INERT TEXT. The server already flattened this on
 * the way into the prompt — no control characters, no
 * bidirectional overrides — and it lands here inside a <pre>
 * with no markup interpretation. This screen exists to show a
 * learner what a hostile page said; it must not become a second
 * place where that page gets to draw.
 */
function SourcePage({ page }: { page: DraftSourcePage | null }) {
  /* Nothing to disclose. Most drafts. */
  if (!page) {
    return null;
  }

  return (
    <div className="emaildraft__source">
      <p>
        This reply was written while your agent was reading{" "}
        <strong>{page.title || "a web page"}</strong> — the{" "}
        {page.mode === "selection"
          ? "text you had selected"
          : "page you were on"}
        , at <code>{page.url}</code>. Check the reply against it before
        sending.
      </p>

      {/*
       * THE TRUNCATION MARKER, and it sits OUTSIDE the details
       * rather than inside it.
       *
       * Inside, it would reach only somebody who had already
       * decided to expand — and the failure this guards
       * against is precisely that the draft reads fine, so
       * nobody expands. This one line changes what the
       * disclosure below MEANS, so it is said while that
       * disclosure is still shut.
       *
       * The model was told the same thing on the way in, in
       * pageContext.ts. This is the half the learner gets.
       */}
      {page.truncated ? (
        <p className="emaildraft__cut">
          <strong>This is not the whole page.</strong> The capture stopped at
          its limit, so whatever came after that point was never sent to your
          agent and is not below either.
        </p>
      ) : null}

      <details>
        <summary>
          Show what your agent read ({page.text.length.toLocaleString()}{" "}
          characters{page.truncated ? ", cut short" : ""})
        </summary>
        {/* Inert on purpose — see the note above. */}
        <pre className="emaildraft__capture">{page.text}</pre>
      </details>
    </div>
  );
}

function Grant({
  label,
  granted,
  wanted,
}: {
  label: string;
  granted: boolean;
  /* Whether this agent has the matching capability. A
     permission the agent does not need is neither a problem
     nor an achievement, so it renders quietly. */
  wanted: boolean;
}) {
  return (
    <span className="emailacct__grant">
      <Badge
        tone={granted ? "correct" : wanted ? "caution" : "neutral"}
      >
        {granted ? "allowed" : wanted ? "not allowed" : "not needed"}
      </Badge>{" "}
      {label}
    </span>
  );
}

function DraftCard({
  draft,
  busy,
  canSend,
  onSend,
  onDiscard,
}: {
  draft: EmailDraftRecord;
  busy: boolean;
  canSend: boolean;
  onSend?: () => void;
  onDiscard?: () => void;
}) {
  const isSent = draft.status === "sent";

  return (
    <li className="emaildraft">
      <div className="emaildraft__head">
        <div className="emaildraft__to">
          <Badge tone={isSent ? "correct" : "caution"}>
            {isSent ? "sent" : draft.status === "sending" ? "sending" : "draft"}
          </Badge>{" "}
          <strong>{draft.to.join(", ") || "(no recipient)"}</strong>
          {draft.replyToMessageId ? (
            <span className="agentsec__note"> · a reply</span>
          ) : null}
        </div>

        <span className="agentsec__note">
          {isSent && draft.sentAt
            ? `sent ${new Date(draft.sentAt).toLocaleString()}`
            : new Date(draft.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="emaildraft__subject">{draft.subject || "(no subject)"}</p>

      {/* The whole body, deliberately. See the header: a card
          that hid what was being approved would teach people to
          approve without reading. */}
      <pre className="emaildraft__body">{draft.body}</pre>

      {!isSent ? (
        <div className="emaildraft__actions">
          {canSend ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onSend}
              disabled={busy || draft.status === "sending"}
              icon={<Send size={14} />}
            >
              Send
            </Button>
          ) : (
            <p className="agentsec__note">
              Send Email is off for this agent, so this draft stays here. Copy
              it into your mail app, or turn the capability on.
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={busy}
            icon={<Trash2 size={14} />}
          >
            Discard
          </Button>
        </div>
      ) : null}
    </li>
  );
}
