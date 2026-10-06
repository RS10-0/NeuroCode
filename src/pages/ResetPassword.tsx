import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { recoveryLink } from "../lib/supabase";
import { Button, Callout, Field, IconButton, Input } from "../components/ui";

/*
 * Where a reset email's link lands.
 *
 * By the time this renders the Supabase client has already
 * spent the link: a good one became a session, a bad one became
 * nothing. What the link SAID was captured before that happened
 * (lib/supabase.ts), which is how this page tells "you came from
 * an email" apart from "you typed the address", and "that link
 * had expired" apart from "something else went wrong".
 *
 * Only a visit that came from a link gets the form. A learner
 * who is simply signed in and wanders here is not asked to set a
 * password — this page is the end of the reset flow, not a
 * settings screen.
 */
export default function ResetPassword() {
  useSurface("learn");

  const { user, isLoading, updatePassword } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }

    setIsSubmitting(true);

    try {
      await updatePassword(password);
      setIsDone(true);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Couldn't change your password. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmError =
    confirmPassword.length > 0 && password !== confirmPassword
      ? "Doesn't match"
      : undefined;

  /*
   * Which screen. A link with an error in it, or one that left
   * no session behind once the client had finished with it, has
   * expired or been used — Supabase spends a reset link the
   * first time it is opened, including by a mail scanner that
   * follows links to check them.
   */
  let body;

  if (!recoveryLink.arrived) {
    body = (
      <>
        <p className="auth__lede">
          Open the link in the reset email we sent you to choose a new
          password. If you haven't asked for one yet, start here.
        </p>
        <Link to="/forgot-password" className="btn btn--primary btn--lg btn--block">
          Send me a reset link
        </Link>
      </>
    );
  } else if (isLoading) {
    body = <p className="auth__lede">Checking your link…</p>;
  } else if (recoveryLink.error || !user) {
    body = (
      <>
        <Callout tone="error" title="This link has stopped working">
          Reset links work once and expire after a while. Ask for a new one
          and use the most recent email.
        </Callout>
        <Link
          to="/forgot-password"
          className="btn btn--primary btn--lg btn--block"
          style={{ marginTop: "var(--space-5)" }}
        >
          Send a new link
        </Link>
      </>
    );
  } else if (isDone) {
    body = (
      <>
        <Callout tone="correct" title="Password changed">
          You're signed in. Use the new password next time you sign in.
        </Callout>
        <Link
          to="/dashboard"
          className="btn btn--primary btn--lg btn--block"
          style={{ marginTop: "var(--space-5)" }}
        >
          Continue to BuildGentic
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="auth__lede">
          Choose a new password for <strong>{user.email}</strong>.
        </p>

        {error ? <Callout tone="error">{error}</Callout> : null}

        <form
          className="auth__form"
          onSubmit={handleSubmit}
          style={{ marginTop: error ? "var(--space-4)" : 0 }}
          noValidate
        >
          {/* The account's address, hidden, so a password manager
              files the new password against the right login. */}
          <input
            type="email"
            autoComplete="username"
            value={user.email}
            readOnly
            hidden
          />

          <Field label="New password" hint="At least 8 characters.">
            {({ id, describedBy }) => (
              <span className="auth__password-wrap">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  disabled={isSubmitting}
                  onChange={(event) => setPassword(event.target.value)}
                  style={{ paddingRight: "var(--space-7)" }}
                />
                <IconButton
                  className="auth__password-toggle"
                  size="sm"
                  label={showPassword ? "Hide password" : "Show password"}
                  icon={showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  onClick={() => setShowPassword((current) => !current)}
                />
              </span>
            )}
          </Field>

          <Field label="Confirm new password" error={confirmError}>
            {({ id, invalid, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                invalid={invalid}
                disabled={isSubmitting}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </>
    );
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

        <h1 className="auth__title">Choose a new password</h1>

        {body}

        {isDone ? null : (
          <p className="auth__footer">
            <Link to="/login">Back to sign in</Link>
          </p>
        )}
      </div>
    </div>
  );
}
