import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { useAuth } from "../auth/useAuth";
import BrandMark from "./BrandMark";
import { useSurface } from "./Surface";
import { Button, Callout, Dialog, Field, Input } from "./ui";
import AgeQuestion from "../features/account/AgeQuestion";
import type { AgeBand } from "../features/account/age";
import {
  AccountApiError,
  deleteMyAccount,
  fetchAgeState,
  resendConsent,
  submitAge,
  type AgeState,
} from "../features/account/ageApi";
import {
  AgeStatusContext,
  cacheAgeState,
  cachedAgeState,
  forgetAgeState,
} from "../features/account/ageState";

/*
 * The age gate, in front of everything a signed-in learner does.
 *
 * Sits in App.tsx inside both auth gates and in front of
 * onboarding, so it is the first thing a signed-in account meets:
 *
 *   unanswered — every account from before the gate existed, once
 *   pending    — under 13, waiting for a parent; nothing else
 *   active / restricted — through, with the status available to
 *                pages that need it (useAgeStatus)
 *
 * The server is what actually enforces this (requireUser refuses
 * a pending account on every route); this is the screen that
 * explains it, so a waiting learner sees a sentence rather than
 * a page of failed requests.
 *
 * FAILS OPEN on a lookup error, matching the server: a hiccup in
 * one request must not lock a learner out of the whole site.
 */

export default function RequireAgeCheck({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const userId = user?.id ?? null;

  const [state, setState] = useState<AgeState | null>(() =>
    userId ? cachedAgeState(userId) : null
  );
  const [failed, setFailed] = useState(false);

  /*
   * Failing open is for a hiccup, not for an account that no
   * longer exists. A parent who declines or withdraws deletes the
   * account while the child's tab still holds its session, and the
   * next check answers 401. Letting that through would drop a
   * deleted account into the app; signing out lands it on the
   * sign-in page, which is the truth.
   */
  const onLookupError = useCallback(
    (error: unknown) => {
      if (error instanceof AccountApiError && error.status === 401) {
        forgetAgeState();
        void logout();
        return;
      }

      console.error("Age check failed:", error);
      setFailed(true);
    },
    [logout]
  );

  /* The first look, when nothing is cached yet. Same shape as
     RequireOnboarding: resolve, then set, unless unmounted. */
  useEffect(() => {
    if (!userId || cachedAgeState(userId)) {
      return;
    }

    let active = true;

    fetchAgeState()
      .then((next) => {
        if (!active) {
          return;
        }

        cacheAgeState(userId, next);
        setState(next);
      })
      .catch((error: unknown) => {
        if (active) {
          onLookupError(error);
        }
      });

    return () => {
      active = false;
    };
  }, [userId, onLookupError]);

  /* Asked again after the learner does something — answers,
     resends, or checks whether a parent has agreed. */
  const refresh = useCallback(async () => {
    if (!userId) {
      return;
    }

    try {
      const next = await fetchAgeState();
      cacheAgeState(userId, next);
      setState(next);
      setFailed(false);
    } catch (error) {
      onLookupError(error);
    }
  }, [userId, onLookupError]);

  if (failed) {
    return <>{children}</>;
  }

  if (!state) {
    return <GatePending />;
  }

  if (state.status === "unanswered") {
    return <AskAge onDone={refresh} />;
  }

  if (state.status === "pending") {
    return <WaitingForParent state={state} onRefresh={refresh} />;
  }

  return (
    <AgeStatusContext.Provider value={state.status}>
      {children}
    </AgeStatusContext.Provider>
  );
}

function GatePending() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--canvas)",
        color: "var(--ink-muted)",
        fontSize: "var(--text-sm)",
      }}
    >
      Loading BuildGentic…
    </div>
  );
}

function GateFrame({ title, children }: { title: string; children: ReactNode }) {
  useSurface("learn");

  return (
    <div className="auth">
      <div className="auth__inner">
        <span className="auth__brand">
          <span className="auth__brand-mark">
            <BrandMark size={14} />
          </span>
          <span className="auth__brand-word">BuildGentic</span>
        </span>
        <h1 className="auth__title">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/* =========================================================
   UNANSWERED — accounts from before the age question existed
   ========================================================= */

function AskAge({ onDone }: { onDone: () => Promise<void> }) {
  const { user } = useAuth();

  const [band, setBand] = useState<AgeBand | null>(null);
  const [parentEmail, setParentEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (answer: AgeBand, parent?: string) => {
    setBusy(true);
    setError("");

    try {
      await submitAge({ band: answer, ...(parent ? { parentEmail: parent } : {}) });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
      setBusy(false);

      /*
       * The answer can be saved even when the request fails — an
       * under-13 age is recorded before the parent's email is
       * sent, and it is the SEND that failed. Asking again moves
       * the learner on to the waiting screen, which can resend,
       * instead of leaving them on a form whose every retry is
       * refused as already answered. If nothing was saved, this
       * screen stays and shows the error.
       */
      await onDone();
    }
  };

  /* 13 and over saves straight away; under 13 asks one more
     thing first. Nothing is sent until the parent's address is
     in, so a child who closes the tab here has recorded nothing. */
  const answer = (value: AgeBand) => {
    if (value === "under_13") {
      setBand(value);
      return;
    }

    void save(value);
  };

  const submitParent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!parentEmail.trim()) {
      setError("Enter your parent or guardian's email address.");
      return;
    }

    if (user?.email && parentEmail.trim().toLowerCase() === user.email.toLowerCase()) {
      setError("Your parent's email needs to be different from yours.");
      return;
    }

    void save("under_13", parentEmail);
  };

  if (band === "under_13") {
    return (
      <GateFrame title="A parent or guardian needs to say yes">
        <p className="auth__lede">
          We'll email your parent or guardian to ask if it's OK for you to use
          BuildGentic. Once they agree, you can carry on where you left off.
        </p>

        {error ? <Callout tone="error">{error}</Callout> : null}

        <form
          className="auth__form"
          onSubmit={submitParent}
          style={{ marginTop: error ? "var(--space-4)" : 0 }}
          noValidate
        >
          <Field label="Parent or guardian's email">
            {({ id }) => (
              <Input
                id={id}
                type="email"
                autoComplete="off"
                placeholder="parent@example.com"
                value={parentEmail}
                disabled={busy}
                onChange={(event) => setParentEmail(event.target.value)}
              />
            )}
          </Field>

          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? "Sending…" : "Ask my parent"}
          </Button>
        </form>
      </GateFrame>
    );
  }

  return (
    <GateFrame title="One quick question">
      <p className="auth__lede">When were you born?</p>

      {error ? (
        <Callout tone="error" className="auth__error">
          {error}
        </Callout>
      ) : null}

      <div style={{ marginTop: error ? "var(--space-4)" : 0 }}>
        <AgeQuestion busy={busy} onAnswer={answer} />
      </div>
    </GateFrame>
  );
}

/* =========================================================
   PENDING — waiting for a parent
   ========================================================= */

function WaitingForParent({
  state,
  onRefresh,
}: {
  state: AgeState;
  onRefresh: () => Promise<void>;
}) {
  const { logout } = useAuth();

  const [message, setMessage] = useState<{ tone: "correct" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sentTo = state.pending?.parentEmail ?? null;
  const expires = state.pending
    ? new Date(state.pending.expiresAt).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : null;

  const resend = async (address?: string) => {
    setBusy(true);
    setMessage(null);

    try {
      const { sentTo: to } = await resendConsent(address);
      setMessage({ tone: "correct", text: `Sent again to ${to}.` });
      setChanging(false);
      setNewEmail("");
      await onRefresh();
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Couldn't send the email. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  /* If the parent has agreed, the refresh swaps this screen for
     the app and nothing below runs visibly. If this screen is
     still here afterwards, they have not — and saying so beats a
     button that appears to do nothing. */
  const check = async () => {
    setBusy(true);
    setMessage(null);
    await onRefresh();
    setBusy(false);
    setMessage({
      tone: "error",
      text: "Not yet — we haven't heard from them. It can take a little while for the email to arrive.",
    });
  };

  const remove = async () => {
    setBusy(true);

    try {
      await deleteMyAccount();
      forgetAgeState();
      await logout();
    } catch (err) {
      setConfirmDelete(false);
      setBusy(false);
      setMessage({
        tone: "error",
        text:
          err instanceof AccountApiError || err instanceof Error
            ? err.message
            : "Couldn't delete the account. Try again.",
      });
    }
  };

  return (
    <GateFrame title="Waiting for your parent">
      <p className="auth__lede">
        {sentTo ? (
          <>
            We emailed <strong>{sentTo}</strong> to ask if it's OK for you to use
            BuildGentic. As soon as they say yes, you can start.
          </>
        ) : (
          <>We need your parent or guardian to say yes before you can start.</>
        )}
      </p>

      {expires ? (
        <Callout tone="info">
          If nobody answers by {expires}, we'll delete this account. Ask them to
          check their spam folder if they can't find the email.
        </Callout>
      ) : null}

      {message ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout tone={message.tone}>{message.text}</Callout>
        </div>
      ) : null}

      {changing ? (
        <form
          className="auth__form"
          style={{ marginTop: "var(--space-5)" }}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (newEmail.trim()) {
              void resend(newEmail);
            }
          }}
        >
          <Field label="Parent or guardian's email">
            {({ id }) => (
              <Input
                id={id}
                type="email"
                autoComplete="off"
                placeholder="parent@example.com"
                value={newEmail}
                disabled={busy}
                onChange={(event) => setNewEmail(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block disabled={busy || !newEmail.trim()}>
            Send to this address
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => setChanging(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="auth__actions">
          <Button variant="primary" size="lg" block disabled={busy} onClick={() => void check()}>
            My parent said yes
          </Button>
          <Button variant="secondary" block disabled={busy} onClick={() => void resend()}>
            Send the email again
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => setChanging(true)}>
            Use a different email
          </Button>
        </div>
      )}

      <p className="auth__footer">
        <button type="button" className="auth__linklike" onClick={() => void logout()}>
          Sign out
        </button>
        {" · "}
        <button type="button" className="auth__linklike" onClick={() => setConfirmDelete(true)}>
          Delete my account
        </button>
      </p>

      <Dialog
        open={confirmDelete}
        title="Delete your account?"
        text="This removes your account and everything in it. You can always sign up again later."
        confirmLabel="Delete account"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </GateFrame>
  );
}
