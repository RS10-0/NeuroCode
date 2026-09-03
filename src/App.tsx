import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";

import Dashboard from "./pages/Dashboard";
import Courses from "./pages/Courses";
import CourseDetail from "./pages/CourseDetail";
import Lab from "./pages/Lab";
import Agents from "./pages/Agents";
import AgentBuilder from "./pages/AgentBuilder";
import AgentLibrary from "./pages/AgentLibrary";
import AgentDeploy from "./pages/AgentDeploy";
import AgentSite from "./pages/AgentSite";
import AgentSchedule from "./pages/AgentSchedule";
import ExtensionConnect from "./pages/ExtensionConnect";
import Projects from "./pages/Projects";
import Profile from "./pages/Profile";
import Onboarding from "./pages/Onboarding";
import PublicSite from "./pages/PublicSite";
import DevActivities from "./pages/DevActivities";
import DevSites from "./pages/DevSites";
import DevFlagships from "./pages/DevFlagships";
import DevAiRuntime from "./pages/DevAiRuntime";

import LessonPlayer from "./features/learn/LessonPlayer";

import AppShell from "./components/AppShell";
import RequireOnboarding from "./components/RequireOnboarding";
import { CreditsProvider } from "./features/credits/CreditsProvider";
import { ToastProvider } from "./components/ui";
import { useAuth } from "./auth/useAuth";

/* =========================================================
   AUTH GATES
   ========================================================= */

function AuthPending() {
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

/*
 * Gate only — no chrome.
 *
 * Used by routes that render their own full-viewport layout,
 * such as the lesson player.
 */
function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthPending />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/* Gate plus the nav rail / tab bar. */
function ShellLayout() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthPending />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  /*
   * The wallet is provided here rather than at the app root so
   * it is only ever fetched for a signed-in learner — there is
   * no balance to read without one, and the daily bonus it
   * claims on mount needs a bearer token.
   */
  return (
    <CreditsProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </CreditsProvider>
  );
}

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          {/* PUBLIC */}

          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* FULL-VIEWPORT, AUTHENTICATED

              The lesson player deliberately escapes the shell:
              focus mode has no rail and no tab bar. The Lab does
              not — it is a workspace inside BuildGentic, so it
              keeps the global rail and puts its own workspace
              navigation inside the page. */}

          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/learn/:lessonId" element={<LessonPlayer />} />
          </Route>

          {/* AUTHENTICATED, WITH CHROME */}

          <Route element={<ShellLayout />}>
            <Route element={<RequireOnboarding />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/courses" element={<Courses />} />
              <Route path="/courses/:courseId" element={<CourseDetail />} />
              <Route path="/lab" element={<Lab />} />
              {/* The static segment is declared before
                  /agents/:agentId so the Builder cannot be
                  swallowed by the dynamic match. Both render the
                  same page: /agents/builder opens an empty
                  draft, /agents/:agentId opens a saved one for
                  editing. They are one screen because building
                  an agent and revising one are the same act, and
                  a separate read-only view would only be a page
                  a learner passes through on the way here. */}
              <Route path="/agents/builder" element={<AgentBuilder />} />
              {/* Static, and declared above /agents/:agentId for
                  the same reason the Builder is: "library" is
                  not an agent id, and the dynamic route would
                  happily try to load one by that name. */}
              <Route path="/agents/library" element={<AgentLibrary />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/agents/:agentId" element={<AgentBuilder />} />
              <Route
                path="/agents/:agentId/deploy"
                element={<AgentDeploy />}
              />
              {/* Where a student designs the public page. The
                  page itself is /:slug, right at the root and
                  outside every gate in this file — see the
                  PUBLISHED AGENT PAGES route below. */}
              <Route path="/agents/:agentId/site" element={<AgentSite />} />
              {/* Where a student hands the agent a standing job.
                  Beside /deploy and /site because it is the third
                  thing you can do with a finished agent: call it,
                  publish it, or let it run on its own. */}
              <Route
                path="/agents/:agentId/schedule"
                element={<AgentSchedule />}
              />
              {/*
                * The extension's pairing page.
                *
                * Inside the authenticated shell on purpose: the
                * whole design of this flow is that the learner
                * is ALREADY signed in here, so pairing is a
                * confirmation rather than a second login. An
                * unauthenticated visit lands on the sign-in
                * screen and comes back, which is the correct
                * behaviour and needs no special case.
                */}
              <Route
                path="/extension/connect"
                element={<ExtensionConnect />}
              />
              <Route path="/projects" element={<Projects />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
          </Route>

          {/* LEGACY PATHS

              /learn was the course map before the navigation
              became Dashboard / Courses / Lab / My Agents /
              Projects. Lesson URLs are untouched — only the
              index moved — so /learn/:lessonId is a live route
              above, not a redirect.

              /build was one door onto two unrelated things; its
              agent half is now /agents. */}

          <Route
            path="/learn"
            element={<Navigate to="/courses/ai-foundations" replace />}
          />
          <Route path="/build" element={<Navigate to="/agents" replace />} />
          {/* An old deep link. The course page is /courses/:courseId
              now, so send the trailing /lessons form to the library
              rather than 404-ing it. */}
          <Route
            path="/courses/:courseId/lessons"
            element={<Navigate to="/courses" replace />}
          />
          <Route
            path="/lessons"
            element={<Navigate to="/courses/ai-foundations" replace />}
          />

          {/* DEVELOPMENT ONLY

              A gallery of every interactive activity, so they can
              be exercised without walking the whole course. Tree
              shaken out of production builds. */}

          {import.meta.env.DEV ? (
            <Route path="/dev/activities" element={<DevActivities />} />
          ) : null}

          {/* Every published-page template, against the starter
              content a student actually gets. Same reasoning as
              the activities gallery: the four layouts can be
              looked at without a database, a deployment or a
              published page. Also tree shaken out of
              production. */}

          {import.meta.env.DEV ? (
            <Route path="/dev/sites" element={<DevSites />} />
          ) : null}

          {/* The five signature pages BuildGentic's own agents
              get instead of a template. Same reasoning as the
              gallery above, and the same tree shaking. */}

          {import.meta.env.DEV ? (
            <Route path="/dev/flagships" element={<DevFlagships />} />
          ) : null}

          {/* The AI runtime harness. Behind the auth gate, unlike
              the gallery above: every endpoint it drives needs a
              real bearer token, and a harness holding a fake one
              would prove nothing. Also tree shaken out of
              production. */}

          {import.meta.env.DEV ? (
            <Route element={<RequireAuth />}>
              <Route path="/dev/ai" element={<DevAiRuntime />} />
            </Route>
          ) : null}

          {/* PUBLISHED AGENT PAGES

              A single path segment, matched last of all, and the
              lowest-priority real route in the application.

              React Router ranks static segments above dynamic
              ones, so every route above wins on its own path
              regardless of where it is declared — /dashboard is
              the dashboard even though ":slug" would also match
              it. That ranking is a convenience rather than the
              protection: the guarantee is that the server will
              not ISSUE a slug that collides, because it refuses
              every word in RESERVED_SLUGS. Two mechanisms, and
              the one that matters is the one in the database.

              One segment only. /studybuddy is a page; /studybuddy/
              settings is not, and falls through to the catch-all
              below rather than resolving the same site. */}

          <Route path="/:slug" element={<PublicSite />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
