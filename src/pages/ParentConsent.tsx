import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Callout, Dialog, Field, Input } from "../components/ui";
import {
  AccountApiError,
  decideConsent,
  lookupConsent,
  lookupRevoke,
  revokeConsent,
} from "../features/account/ageApi";
import { UNDER_13_CANNOT } from "../features/account/restrictions";

/*
 * Where a parent's email lands: agree, decline, or — from the
 * confirmation email — withdraw.
 *
 * The token arrives in the URL FRAGMENT (#token=… or #revoke=…),
 * which never reaches a server log, and is read once on load and
 * then wiped from the address bar so it is not left sitting in
 * history or copied into a screenshot.
 *
 * Opening this page decides nothing. A mail scanner that follows
 * the link sees the notice and stops; only a person typing their
 * name, ticking the box and pressing a button sends the POST that
 * counts (server/src/account/consent.ts).
 */

type ConsentLink = { kind: "consent" | "revoke"; token: string } | null;

function readLink(): ConsentLink {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const consent = params.get("token");
  const revoke = params.get("revoke");

  if (consent) return { kind: "consent", token: consent };
  if (revoke) return { kind: "revoke", token: revoke };
  return null;
}

type View =
  | { name: "loading" }
  | { name: "invalid"; message: string }
  | { name: "consent"; childName: string; expiresAt: string }
  | { name: "approved"; childName: string }
  | { name: "declined"; childName: string }
  | { name: "revoke"; childName: string }
  | { name: "revoked"; childName: string };

const NO_LINK =
  "This page needs the link from a BuildGentic email. Open the email again and use the link in it.";

export default function ParentConsent() {
  useSurface("learn");

  const [link] = useState<ConsentLink>(() => readLink());
  const [view, setView] = useState<View>(() =>
    link ? { name: "loading" } : { name: "invalid", message: NO_LINK }
  );

  const [parentName, setParentName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"decline" | "revoke" | null>(null);

  useEffect(() => {
    if (!link) {
      return;
    }

    /* Off the address bar now that it is in memory. */
    window.history.replaceState(window.history.state, "", window.location.pathname);

    let active = true;

    const lookup =
      link.kind === "consent"
        ? lookupConsent(link.token).then(
            (found): View => ({ name: "consent", childName: found.childName, expiresAt: found.expiresAt })
          )
        : lookupRevoke(link.token).then(
            (found): View => ({ name: "revoke", childName: found.childName })
          );

    lookup
      .then((next) => {
        if (active) setView(next);
      })
      .catch((err: unknown) => {
        if (active) {
          setView({
            name: "invalid",
            message: err instanceof Error ? err.message : "This link isn't working.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [link]);

  const fail = (err: unknown) => {
    /* A link that died while the page was open (expired, or used
       in another tab) is a dead end, not a retry. */
    if (err instanceof AccountApiError && err.code === "link_expired") {
      setView({ name: "invalid", message: err.message });
      return;
    }

    setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
  };

  const approve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!link || view.name !== "consent") {
      return;
    }

    if (parentName.trim().length < 2) {
      setError("Type your full name to sign.");
      return;
    }

    if (!agreed) {
      setError("Tick the box to confirm you are their parent or guardian and you agree.");
      return;
    }

    setBusy(true);

    try {
      const result = await decideConsent({ token: link.token, decision: "approve", parentName });
      setView({ name: "approved", childName: result.childName });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!link) return;
    setBusy(true);
    setError("");

    try {
      const result = await decideConsent({ token: link.token, decision: "decline" });
      setView({ name: "declined", childName: result.childName });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const revoke = async () => {
    if (!link) return;
    setBusy(true);
    setError("");

    try {
      const result = await revokeConsent(link.token);
      setView({ name: "revoked", childName: result.childName });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  let title = "Parent or guardian consent";
  let body;

  switch (view.name) {
    case "loading":
      body = <p className="auth__lede">Checking your link…</p>;
      break;

    case "invalid":
      title = "This link isn't working";
      body = (
        <Callout tone="error">
          {view.message} If your child still wants to use BuildGentic, they can
          send you a new email from their account.
        </Callout>
      );
      break;

    case "consent": {
      const expires = new Date(view.expiresAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
      });

      title = `${view.childName} would like to use BuildGentic`;
      body = (
        <>
          <p className="auth__lede">
            BuildGentic teaches people how AI works by having them build small
            AI "agents". {view.childName} told us they are under 13, so their
            account stays switched off until a parent or guardian agrees.
          </p>

          <p className="auth__lede" style={{ marginBottom: "var(--space-2)" }}>
            <strong>What we would collect:</strong> their display name, email and
            password; their course progress and the agents they build; and what
            they type to those agents, which is sent only to AI services that
            don't use it to train AI, only to produce an answer. We don't use it
            to train AI, show ads, or sell it either.
          </p>

          <p className="auth__lede" style={{ marginBottom: "var(--space-2)" }}>
            <strong>Accounts for under-13s cannot:</strong>
          </p>
          <ul className="auth__list">
            {UNDER_13_CANNOT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <p className="auth__lede">
            You can withdraw your consent at any time from the confirmation email
            we send, which deletes the account. If you do nothing, we delete it on{" "}
            {expires}. <Link to="/privacy">Read our full privacy policy</Link>.
          </p>

          {error ? <Callout tone="error">{error}</Callout> : null}

          <form
            className="auth__form"
            onSubmit={approve}
            style={{ marginTop: error ? "var(--space-4)" : 0 }}
            noValidate
          >
            <Field label="Your full name" hint="This is your signature.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="name"
                  value={parentName}
                  disabled={busy}
                  onChange={(event) => setParentName(event.target.value)}
                />
              )}
            </Field>

            <label className="consent-check">
              <input
                type="checkbox"
                checked={agreed}
                disabled={busy}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <span>
                I am {view.childName}'s parent or legal guardian, and I agree to
                them using BuildGentic as described above.
              </span>
            </label>

            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? "Saving…" : "I agree"}
            </Button>
            <Button variant="ghost" block disabled={busy} onClick={() => setConfirm("decline")}>
              No, delete their account
            </Button>
          </form>
        </>
      );
      break;
    }

    case "approved":
      title = "Thank you";
      body = (
        <Callout tone="correct" title={`${view.childName} can start now`}>
          We've emailed you a confirmation. Keep it: it has a link that withdraws
          your consent and deletes the account, any time you want.
        </Callout>
      );
      break;

    case "declined":
      title = "Account deleted";
      body = (
        <Callout tone="info">
          We've deleted {view.childName}'s account and your email address. Nothing
          else will be sent.
        </Callout>
      );
      break;

    case "revoke":
      title = `Withdraw consent for ${view.childName}?`;
      body = (
        <>
          <p className="auth__lede">
            This deletes {view.childName}'s BuildGentic account and everything in
            it — their progress and the agents they built. It can't be undone.
          </p>
          {error ? <Callout tone="error">{error}</Callout> : null}
          <div className="auth__actions">
            <Button variant="danger" size="lg" block disabled={busy} onClick={() => setConfirm("revoke")}>
              Withdraw consent and delete
            </Button>
          </div>
        </>
      );
      break;

    case "revoked":
      title = "Consent withdrawn";
      body = (
        <Callout tone="info">
          We've deleted {view.childName}'s account and everything in it.
        </Callout>
      );
      break;
  }

  return (
    <div className="auth">
      <div className="auth__inner">
        <Link to="/" className="auth__brand">
          <span className="auth__brand-mark">
            <BrandMark size={14} />
          </span>
          <span className="auth__brand-word">BuildGentic</span>
        </Link>

        <h1 className="auth__title">{title}</h1>

        {body}

        <p className="auth__consent">
          Questions? Email{" "}
          <a href="mailto:buildgentic@gmail.com">buildgentic@gmail.com</a>.
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        title={confirm === "revoke" ? "Delete the account?" : "Decline and delete?"}
        text={
          confirm === "revoke"
            ? "The account and everything in it will be deleted straight away."
            : "Their account will be deleted straight away, along with your email address."
        }
        confirmLabel="Delete account"
        destructive
        busy={busy}
        onConfirm={() => void (confirm === "revoke" ? revoke() : decline())}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
