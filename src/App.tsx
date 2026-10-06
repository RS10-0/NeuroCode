import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

/*
 * The doors a stranger walks through are in the entry bundle;
 * everything behind them is fetched when it is first visited.
 *
 * Before this the whole application was one 1.5 MB script, so
 * somebody opening the landing page downloaded the Lab, the
 * Builder, every lesson and every flagship desk before seeing a
 * headline. The four pages imported directly below are the ones
 * a visitor can land on without an account; each lazy page
 * becomes its own chunk, and pages that share code (the
 * curriculum, the markdown renderer) share a chunk for it.
 */
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import { Privacy, Terms } from "./pages/Legal";

const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ParentConsent = lazy(() => import("./pages/ParentConsent"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Courses = lazy(() => import("./pages/Courses"));
const CourseDetail = lazy(() => import("./pages/CourseDetail"));
const Lab = lazy(() => import("./pages/Lab"));
const Agents = lazy(() => import("./pages/Agents"));
const AgentBuilder = lazy(() => import("./pages/AgentBuilder"));
const AgentLibrary = lazy(() => import("./pages/AgentLibrary"));
const AgentDeploy = lazy(() => import("./pages/AgentDeploy"));
const AgentSite = lazy(() => import("./pages/AgentSite"));
const AgentSchedule = lazy(() => import("./pages/AgentSchedule"));
const ExtensionConnect = lazy(() => import("./pages/ExtensionConnect"));
const Published = lazy(() => import("./pages/Published"));
const Schedules = lazy(() => import("./pages/Schedules"));
const Profile = lazy(() => import("./pages/Profile"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const PublicSite = lazy(() => import("./pages/PublicSite"));
const DevActivities = lazy(() => import("./pages/DevActivities"));
const DevPublished = lazy(() => import("./pages/DevPublished"));
const DevSchedules = lazy(() => import("./pages/DevSchedules"));
const DevSites = lazy(() => import("./pages/DevSites"));
const DevFlagships = lazy(() => import("./pages/DevFlagships"));
const DevDesks = lazy(() => import("./pages/DevDesks"));
const DevAiRuntime = lazy(() => import("./pages/DevAiRuntime"));
const DevCanvas = lazy(() => import("./pages/DevCanvas"));

const LessonPlayer = lazy(() => import("./features/learn/LessonPlayer"));

import AppShell from "./components/AppShell";
import CanonicalLink from "./components/CanonicalLink";
import RequireOnboarding from "./components/RequireOnboarding";
import RequireAgeCheck from "./components/RequireAgeCheck";
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
 * What the shell shows while a lazy page's chunk arrives.
 *
 * Inside <main>, so the rail and the tab bar stay put and only
 * the content area waits — moving between Courses and the Lab
 * should never blank the navigation the learner just clicked.
 * Empty on purpose: a chunk is usually on screen in well under
 * a second, and a word that flashes for that long reads as a
 * flicker rather than as information.
 */
function PagePending() {
  return <div style={{ minHeight: "60vh" }} aria-busy="true" />;
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

  return (
    <RequireAgeCheck>
      <Outlet />
    </RequireAgeCheck>
  );
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
   *
   * The age gate goes outside it for the same reason: an account
   * waiting for a parent is refused by every route the wallet
   * calls, so it should never mount the wallet at all.
   */
  return (
    <RequireAgeCheck>
      <CreditsProvider>
        <AppShell>
          <Suspense fallback={<PagePending />}>
            <Outlet />
          </Suspense>
        </AppShell>
      </CreditsProvider>
    </RequireAgeCheck>
  );
}

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  return (
    <BrowserRouter>
      <CanonicalLink />
      <ToastProvider>
        {/* The outer boundary, for the lazy pages with no shell
            around them: onboarding, the lesson player, a
            published page. Pages inside the shell are caught
            by the boundary in ShellLayout first. */}
        <Suspense fallback={<AuthPending />}>
          <Routes>
            {/* PUBLIC */}
  
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Both ungated: somebody who has forgotten their
                password has no session, and the reset link
                brings its own. Both are in RESERVED_SLUGS. */}

            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Where a parent's consent email lands. Ungated: the
                parent has no account, and the token in the link
                is what says whose child this is. Reserved in
                RESERVED_SLUGS. */}

            <Route path="/parent-consent" element={<ParentConsent />} />
  
            {/* The two documents anyone may have to read before
                they can decide whether to have an account at all
                — a parent, a school's IT reviewer, Google's OAuth
                reviewer. Ungated for exactly that reason, and
                declared here beside the other public routes
                rather than anywhere near a gate.
  
                Both words are already in RESERVED_SLUGS (see
                features/sites/slug.ts), so no student's published
                agent can ever have been issued this address. */}
  
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
  
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
                <Route path="/published" element={<Published />} />
                <Route path="/schedules" element={<Schedules />} />
                <Route path="/profile" element={<Profile />} />
              </Route>
            </Route>
  
            {/* LEGACY PATHS
  
                /learn was the course map before the navigation
                became Dashboard / Courses / Lab / My Agents /
                Published. Lesson URLs are untouched — only the
                index moved — so /learn/:lessonId is a live route
                above, not a redirect.
  
                /build was one door onto two unrelated things; its
                agent half is now /agents. */}
  
            <Route
              path="/learn"
              element={<Navigate to="/courses/ai-foundations" replace />}
            />
            <Route path="/build" element={<Navigate to="/agents" replace />} />
            {/* /projects was an empty placeholder that promised a
                container it never had. The tab is /published now,
                and names what is actually on it. Redirected rather
                than dropped because it was in the nav and on the
                Dashboard, so it is in people's history. */}
            <Route
              path="/projects"
              element={<Navigate to="/published" replace />}
            />
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
  
            {/* The owner's desk for a purchased flagship. Worth a
                gallery more than the others are: reaching this
                screen in the product costs an account, a hundred
                XP and a purchase, which is the friction that let
                four empty tabs sit on it unnoticed. Same tree
                shaking. */}
  
            {import.meta.env.DEV ? (
              <Route path="/dev/desks" element={<DevDesks />} />
            ) : null}
  
            {/* The Prompt Canvas, outside the gate with the other
                galleries. It is the one bench in the Lab that
                talks to nothing — no model, no quota, no request —
                so it is also the only one that can be exercised
                without an account, and the same tree shaking
                applies. */}
  
            {import.meta.env.DEV ? (
              <Route path="/dev/canvas" element={<DevCanvas />} />
            ) : null}
  
            {/* Every state a row on the Published screen can be
                in. Worth a gallery for the same reason the desks
                are: the states that matter most there — a page
                taken down, a revoked key, a schedule that
                switched itself off — each cost a deployment and
                a deliberate act of undoing to reach by hand, so
                they are the ones nobody checks. Same tree
                shaking. */}
  
            {import.meta.env.DEV ? (
              <Route path="/dev/published" element={<DevPublished />} />
            ) : null}
  
            {/* Every outcome a scheduled run can have. The
                sharpest case for a gallery here: you cannot ask
                for a confabulated run, or a web search that came
                back empty, or a task that genuinely runs out of
                steps — you wait for one. So these are the cards
                most likely to ship broken, and they are the ones
                whose whole job is to tell a learner not to
                believe an answer that reads perfectly well. Same
                tree shaking. */}
  
            {import.meta.env.DEV ? (
              <Route path="/dev/schedules" element={<DevSchedules />} />
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
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  );
}
