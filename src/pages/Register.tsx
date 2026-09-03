import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Callout, Field, IconButton, Input } from "../components/ui";

export default function Register() {
  useSurface("learn");

  const navigate = useNavigate();
  const { register, isLoading: isAuthLoading } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

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

    setIsSubmitting(true);

    try {
      await register(username, email, password);

      /*
       * New accounts go to onboarding, not the dashboard —
       * the literacy check decides where they should start.
       */
      navigate("/onboarding", { replace: true });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Couldn't create your account. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isSubmitting || isAuthLoading;

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
        <p className="auth__lede">
          Learn how AI actually works, then make something with it.
        </p>

        {error ? <Callout tone="error">{error}</Callout> : null}

        <form
          className="auth__form"
          onSubmit={handleSubmit}
          style={{ marginTop: error ? "var(--space-4)" : 0 }}
          noValidate
        >
          <Field label="Display name" hint="Shown on anything you publish.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                autoComplete="nickname"
                placeholder="Ada"
                value={username}
                disabled={isBusy}
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>

          <Field label="Email">
            {({ id }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                placeholder="name@school.edu"
                value={email}
                disabled={isBusy}
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
                  disabled={isBusy}
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
                disabled={isBusy}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            )}
          </Field>

          <Button type="submit" variant="primary" size="lg" block disabled={isBusy}>
            {isBusy ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="auth__footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
