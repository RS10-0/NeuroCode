import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function Login() {
  const navigate = useNavigate();
  const { login, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setError("");

    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to log in."
      );
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <Link to="/" className="auth-logo">
            NeuroCode
          </Link>

          <p className="eyebrow">WELCOME BACK</p>

          <h1>Log in</h1>

          <p>
            Continue your programming journey.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">
              Email
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">
              Password
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Enter your password"
              required
            />
          </div>

          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="primary-button auth-submit"
            disabled={isLoading}
          >
            {isLoading
              ? "Logging in..."
              : "Log In"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account?{" "}
            <Link to="/register">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;