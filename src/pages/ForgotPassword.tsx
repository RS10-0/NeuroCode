import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Callout, Field, Input } from "../components/ui";

interface LocationState {
  email?: string;
}

/*
 * Asks for an address and sends a reset link to it.
 *
 * The confirmation never says whether the address has an
 * account. Saying "no account with that email" would let anyone
 * check whether a given student is on BuildGentic, which for a
 * platform with school-age users is exactly the question nobody
 * outside should be able to answer.
 */
export default function ForgotPassword() {
  useSurface("learn");

  const location = useLocation();
  const { requestPasswordReset } = useAuth();

  /* Carried over from the sign-in form, so a learner who has
     already typed their address does not type it twice. */
  const [email, setEmail] = useState(
    (location.state as LocationState | null)?.email ?? ""
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Enter the email you signed up with.");
      return;
    }

    setIsSubmitting(true);

    try {
      await requestPasswordReset(email);
      setSentTo(email.trim());
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Couldn't send the link. Try again in a minute.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__inner">
        <Link to="/" className="auth__brand">
          <span className="auth__brand-mark">
            <BrandMark size={14} />
          </span>
          <span className="auth__brand-word">BuildGentic</span>
        </Link>

        <h1 className="auth__title">Reset your password</h1>

        {sentTo ? (
          <>
            <p className="auth__lede">
              If there is an account for <strong>{sentTo}</strong>, a link to
              choose a new password is on its way. It can take a minute or
              two, and it is worth checking your spam folder.
            </p>

            <Callout tone="info">
              The link works once and expires after a while. If it has
              stopped working, ask for a new one here.
            </Callout>

            <Button
              variant="secondary"
              size="lg"
              block
              style={{ marginTop: "var(--space-5)" }}
              onClick={() => setSentTo(null)}
            >
              Use a different email
            </Button>
          </>
        ) : (
          <>
            <p className="auth__lede">
              Enter the email you signed up with and we'll send you a link
              to choose a new one.
            </p>

            {error ? <Callout tone="error">{error}</Callout> : null}

            <form
              className="auth__form"
              onSubmit={handleSubmit}
              style={{ marginTop: error ? "var(--space-4)" : 0 }}
              noValidate
            >
              <Field label="Email">
                {({ id }) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="email"
                    placeholder="name@school.edu"
                    value={email}
                    disabled={isSubmitting}
                    onChange={(event) => setEmail(event.target.value)}
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
                {isSubmitting ? "Sending link…" : "Send reset link"}
              </Button>
            </form>
          </>
        )}

        <p className="auth__footer">
          Remembered it? <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
