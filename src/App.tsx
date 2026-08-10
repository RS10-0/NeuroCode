import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
} from "react-router-dom";

import type { ReactNode } from "react";

import Learn from "./pages/Learn";
import Dashboard from "./pages/Dashboard";
import Courses from "./pages/Courses";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import Register from "./pages/Register";

import { useAuth } from "./auth/AuthContext";

function Home() {
  return (
    <div>
      <nav>
        <div className="nav-links">
          <a href="#about">About</a>

          <a href="#how-it-works">
            How It Works
          </a>

          <Link
            to="/login"
            className="login-button"
          >
            Log In
          </Link>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-content">
            <p className="eyebrow">
              LEARN • PRACTICE • BUILD
            </p>

            <h1>
              Learn to code.
              <br />
              <span>
                Actually understand it.
              </span>
            </h1>

            <p className="hero-description">
              NeuroCode helps beginner
              programmers learn through
              structured lessons, hands-on
              coding, and personalized
              feedback.
            </p>

            <div className="hero-buttons">
              <Link
                to="/register"
                className="primary-button"
              >
                Start Learning
              </Link>

              <a
                href="#about"
                className="secondary-button"
              >
                Explore NeuroCode
              </a>
            </div>
          </div>
        </section>

        <section
          id="about"
          className="section"
        >
          <p className="eyebrow">
            WHY NEUROCODE
          </p>

          <h2>
            A better way to learn
            programming.
          </h2>

          <div className="feature-grid">
            <div className="feature-card">
              <h3>Learn</h3>

              <p>
                Understand programming
                concepts through clear,
                structured lessons designed
                for beginners.
              </p>
            </div>

            <div className="feature-card">
              <h3>Practice</h3>

              <p>
                Turn concepts into working
                code through interactive
                challenges and hands-on
                exercises.
              </p>
            </div>

            <div className="feature-card">
              <h3>Improve</h3>

              <p>
                Get personalized feedback
                based on how you actually
                learn and code.
              </p>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="section process-section"
        >
          <p className="eyebrow">
            HOW IT WORKS
          </p>

          <h2>Learn by doing.</h2>

          <div className="steps">
            <div className="step">
              <span>01</span>

              <h3>
                Learn a concept
              </h3>

              <p>
                Start with a focused lesson
                built around one idea.
              </p>
            </div>

            <div className="step">
              <span>02</span>

              <h3>Write code</h3>

              <p>
                Practice the concept through
                real programming challenges.
              </p>
            </div>

            <div className="step">
              <span>03</span>

              <h3>Get feedback</h3>

              <p>
                Understand your mistakes
                instead of simply being told
                you're wrong.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <p>NeuroCode</p>

        <p>
          Built to make learning to code
          more accessible.
        </p>
      </footer>
    </div>
  );
}

// -----------------------------------------
// PROTECTED ROUTE
// -----------------------------------------

function ProtectedRoute({
  children,
}: {
  children: ReactNode;
}) {
  const { user, isLoading } =
    useAuth();

  if (isLoading) {
    return (
      <div className="auth-loading">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  return <>{children}</>;
}

// -----------------------------------------
// APP
// -----------------------------------------

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* PUBLIC */}

        <Route
          path="/"
          element={<Home />}
        />

        <Route
          path="/login"
          element={<Login />}
        />

        <Route
          path="/register"
          element={<Register />}
        />

        {/* PROTECTED */}

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/courses"
          element={
            <ProtectedRoute>
              <Courses />
            </ProtectedRoute>
          }
        />

        <Route
          path="/learn"
          element={
            <ProtectedRoute>
              <Learn />
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />

        {/* FALLBACK */}

        <Route
          path="*"
          element={
            <Navigate
              to="/"
              replace
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;