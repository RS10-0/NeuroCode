import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function Register() {
  const navigate = useNavigate();
  const { register, isLoading } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [error, setError] = useState("");

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError(
        "Password must be at least 8 characters."
      );
      return;
    }

    try {
      await register(
        username,
        email,
        password
      );

      navigate("/dashboard");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to create account."
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

          <p className="eyebrow">
            GET STARTED
          </p>

          <h1>Create your account</h1>

          <p>
            Start learning programming with
            NeuroCode.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">
              Username
            </label>

            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) =>
                setUsername(
                  event.target.value
                )
              }
              placeholder="Choose a username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">
              Email
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
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
                setPassword(
                  event.target.value
                )
              }
              placeholder="At least 8 characters"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">
              Confirm password
            </label>

            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(
                  event.target.value
                )
              }
              placeholder="Enter your password again"
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
              ? "Creating account..."
              : "Create Account"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account?{" "}
            <Link to="/login">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;