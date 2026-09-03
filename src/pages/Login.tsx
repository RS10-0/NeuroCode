import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Callout, Field, IconButton, Input } from "../components/ui";

interface LocationState {
  from?: { pathname?: string };
}

export default function Login() {
  useSurface("learn");

  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading: isAuthLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  /*
   * ProtectedLayout records where the visitor was heading before
   * they were bounced here. The old page captured this and then
   * ignored it, always landing on the dashboard.
   */
  const from = (location.state as LocationState | null)?.from?.pathname;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate(from ?? "/dashboard", { replace: true });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Couldn't sign you in. Check your email and password.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isSubmitting || isAuthLoading;

  return (
    <div className="auth">
      <div className="auth__inner">
        <Link to="/" className="auth__brand">
          <span className="auth__brand-mark">
            <BrandMark size={14} />
          </span>
          <span className="auth__brand-word">BuildGentic</span>
        </Link>

        <h1 className="auth__title">Welcome back</h1>
        <p className="auth__lede">Pick up where you left off.</p>

        {error ? (
          <Callout tone="error" className="auth__error">
            {error}
          </Callout>
        ) : null}

        <form
          className="auth__form"
          onSubmit={handleSubmit}
          style={{ marginTop: error ? "var(--space-4)" : 0 }}
          noValidate
        >
          <Field label="Email">
            {({ id, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                placeholder="name@school.edu"
                value={email}
                invalid={invalid}
                disabled={isBusy}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>

          <Field label="Password">
            {({ id }) => (
              <span className="auth__password-wrap">
                <Input
                  id={id}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
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

          <Button type="submit" variant="primary" size="lg" block disabled={isBusy}>
            {isBusy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="auth__footer">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
