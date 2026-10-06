import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Callout, Field, IconButton, Input } from "../components/ui";
import AgeQuestion from "../features/account/AgeQuestion";
import {
  recalledAnswer,
  rememberAnswer,
  type AgeBand,
} from "../features/account/age";
import { consentAvailable, submitAge } from "../features/account/ageApi";
import { forgetAgeState } from "../features/account/ageState";

/*
 * Sign-up, in two steps: when were you born, then the account.
 *
 * The age comes FIRST, before a single field that collects
 * anything. For an under-13 that ordering is the law's whole
 * point — nothing about a child is gathered until we know to ask
 * a parent — and for everybody else it costs one extra click.
 *
 * Under 13 adds one field, a parent's email, and changes what
 * the button means: the account is created waiting, and a parent
 * has to agree before it does anything. See
 * server/src/account/consent.ts for the other side.
 */
export default function Register() {
  useSurface("learn");

  const navigate = useNavigate();
  const location = useLocation();
  const { register } = useAuth();

  /* A remembered answer skips the question — so pressing Back and
     choosing an older year does not get round it (AgeQuestion.tsx). */
  const [band, setBand] = useState<AgeBand | null>(() => recalledAnswer());

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const under13 = band === "under_13";

  const answerAge = (answer: AgeBand) => {
    rememberAnswer(answer);
    setBand(answer);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!band) {
      return;
    }

    if (!username.trim()) {
      setError("Choose a display name.");
      return;
    }

    if (password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }

    if (under13) {
      if (!parentEmail.trim()) {
        setError("Enter your parent or guardian's email address.");
        return;
      }

      if (parentEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
        setError("Your parent's email needs to be different from yours.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      /*
       * Asked before the account exists, not after. If this
       * server cannot email a parent, creating the account would
       * store a child's details with nobody ever asked to agree
       * and nothing that ever removes them.
       */
      if (under13 && !(await consentAvailable())) {
        setError(
          "We can't send emails to parents right now, so we can't set up accounts for under-13s yet. Please try again later."
        );
        return;
      }

      await register(username, email, password);

      /*
       * The age is recorded straight away. If this call fails
       * the account still exists, unanswered, and the gate in
       * RequireAgeCheck asks again on the very next page — so a
       * failure here costs the learner one repeated question,
       * not a missing age.
       */
      try {
        await submitAge({ band, ...(under13 ? { parentEmail } : {}) });
      } catch {
        /* Picked up by the gate; see above. */
      }

      forgetAgeState();

      /*
       * New accounts go to onboarding, not the dashboard — the
       * literacy check decides where they should start. An
       * under-13 account lands on the waiting screen instead,
       * because the gate sits in front of onboarding, and goes on
       * to it once a parent agrees.
       */
      navigate("/onboarding", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't create your account. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmError =
    confirmPassword.length > 0 && password !== confirmPassword
      ? "Doesn't match"
      : undefined;

  return (
    <div className="auth">
      <div className="auth__inner">
        <Link to="/" className="auth__brand">
          <span className="auth__brand-mark">
            <BrandMark size={14} />
          </span>
          <span className="auth__brand-word">BuildGentic</span>
        </Link>

        <h1 className="auth__title">Start building</h1>

        {!band ? (
          <>
            <p className="auth__lede">When were you born?</p>
            <AgeQuestion onAnswer={answerAge} />
          </>
        ) : (
          <>
            {under13 ? (
              <Callout tone="info" title="A parent or guardian needs to say yes">
                Fill this in, and we'll email your parent or guardian to ask.
                Once they agree, you can start. Until then, your account waits
                — and if they don't answer within a week, we delete it.
              </Callout>
            ) : (
              <p className="auth__lede">
                Learn how AI actually works, then make something with it.
              </p>
            )}

            {error ? (
              <Callout tone="error" className="auth__error">
                {error}
              </Callout>
            ) : null}

            <form
              className="auth__form"
              onSubmit={handleSubmit}
              style={{ marginTop: error || under13 ? "var(--space-4)" : 0 }}
              noValidate
            >
              <Field
                label="Display name"
                hint={under13 ? "What BuildGentic calls you." : "Shown on anything you publish."}
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    autoComplete="nickname"
                    placeholder="Ada"
                    value={username}
                    disabled={isSubmitting}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                )}
              </Field>

              <Field label={under13 ? "Your email" : "Email"}>
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

              <Field label="Password" hint="At least 8 characters.">
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

              <Field label="Confirm password" error={confirmError}>
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

              {under13 ? (
                <Field
                  label="Parent or guardian's email"
                  hint="We'll send them one email asking if it's OK."
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      type="email"
                      autoComplete="off"
                      placeholder="parent@example.com"
                      value={parentEmail}
                      disabled={isSubmitting}
                      onChange={(event) => setParentEmail(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              {/* Only while THIS form is sending. It used to also
                  show while the session check ran on page load,
                  which flashed "Creating account…" at somebody who
                  had not pressed anything. */}
              <Button type="submit" variant="primary" size="lg" block disabled={isSubmitting}>
                {isSubmitting
                  ? under13
                    ? "Sending…"
                    : "Creating account…"
                  : under13
                    ? "Ask my parent"
                    : "Create account"}
              </Button>
            </form>

            {/* The terms say an account IS the agreement — "by
                creating an account or using BuildGentic, you agree
                to these terms" — so the one place they have to be
                reachable, other than the footer, is the button that
                creates one. */}
            <p className="auth__consent">
              By creating an account you agree to our{" "}
              <Link to="/terms">Terms of Service</Link> and{" "}
              <Link to="/privacy">Privacy Policy</Link>.
            </p>
          </>
        )}

        <p className="auth__footer">
          Already have an account?{" "}
          {/* Passes on wherever the visitor was heading — a course
              card on the landing page, or a gated page that sent
              them here — so signing in lands them there. */}
          <Link to="/login" state={location.state}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
