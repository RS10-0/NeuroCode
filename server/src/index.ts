import express from "express";
import cors from "cors";

import {
  getProgress,
  recordEvaluation,
  setCurrentLesson,
} from "./progress/ProgressStore";

import { getAuthenticatedUser } from "./lib/auth";
import { progressRouter } from "./routes/progress";
import { aiRouter } from "./routes/ai";

import { creditsRouter } from "./routes/credits";
import { agentsRouter } from "./routes/agents";
import { schedulesRouter, schedulerTickRouter } from "./routes/schedules";
import { startScheduler } from "./agents/schedule/ticker";
import { libraryRouter } from "./routes/library";
import { deploymentsRouter } from "./routes/deployments";
import { sitesRouter } from "./routes/sites";
import { filesRouter } from "./routes/files";
import { documentsRouter } from "./routes/documents";
import { emailRouter } from "./routes/email";
import { extensionRouter } from "./routes/extension";
import { describeAiConfig, fileAnalysis } from "./ai/config";
import { describeSchema } from "./lib/schemaCheck";

const app = express();

const PORT = Number(process.env.PORT ?? 3001);

/*
 * Origins allowed to call this API.
 *
 * Previously `origin: "*"`, which is wrong for an API that
 * accepts bearer tokens. In development the Vite dev server
 * proxies /api to this port, so same-origin requests do not
 * hit CORS at all — the allowlist is the fallback for direct
 * calls and for deployed frontends.
 */
const ALLOWED_ORIGINS = (process.env.NEUROLINK_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/*
 * With no allowlist configured, this is a development machine,
 * and any localhost port is fine.
 *
 * The default used to be the single literal "http://localhost:5173".
 * Vite silently moves to 5174 when 5173 is taken — two dev servers,
 * or one left running in another terminal — and every progress
 * write then failed CORS with a 500 that looked exactly like a
 * database problem. A port number is not a security boundary;
 * losing an afternoon to one is a poor trade.
 *
 * Production sets NEUROLINK_ALLOWED_ORIGINS explicitly and gets
 * the strict allowlist, unchanged.
 */
const isDevelopmentDefault = ALLOWED_ORIGINS.length === 0;

const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/*
 * The browser extension's origin.
 *
 * A request from the side panel carries
 * `Origin: chrome-extension://<32-char id>`, which the exact-match
 * allowlist above refuses — so nothing in Phase 4 works until
 * this is configured. Production sets it explicitly in
 * NEUROLINK_EXTENSION_ORIGIN alongside the allowlist.
 *
 * AN EXACT ORIGIN, NEVER A `chrome-extension://*` PATTERN. A
 * wildcard here would let ANY installed extension call this API
 * with a token it had got hold of, which is most of the value
 * of having a per-client token at all.
 *
 * The development fallback accepts any chrome-extension origin,
 * and that is a deliberate difference rather than an oversight:
 * an unpacked extension gets a different id on every machine
 * unless a `key` is pinned in its manifest, so requiring the
 * exact value in development would make this file
 * per-developer configuration. The looseness costs nothing on a
 * laptop — the allowlist is already wide open to localhost
 * there — and production never reaches this branch.
 */
const EXTENSION_ORIGIN = (process.env.NEUROLINK_EXTENSION_ORIGIN ?? "").trim();

const ANY_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

function isAllowedOrigin(origin: string): boolean {
  if (isDevelopmentDefault) {
    return (
      LOCALHOST_ORIGIN.test(origin) || ANY_EXTENSION_ORIGIN.test(origin)
    );
  }

  if (EXTENSION_ORIGIN && origin === EXTENSION_ORIGIN) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin);
}

// -----------------------------------------
// DEPLOYED AGENTS
//
// Mounted above the CORS middleware on purpose, and the position
// is the security boundary rather than an ordering accident.
//
// This router answers external applications holding a deployment
// key. Adding no CORS headers means no browser will make a
// cross-origin call to it — which is exactly right, because a
// deployment key that works from a web page is a deployment key
// sitting in JavaScript anybody can read. Servers, scripts and
// CLIs are unaffected: CORS was never what protected them.
//
// It parses its own body, so it also sits above express.json.
// -----------------------------------------

/*
 * Two body parsers, chosen per request rather than per router.
 *
 * The chat endpoint takes JSON and the file endpoint takes raw
 * bytes, and Express picks by Content-Type: `express.raw` with a
 * `type` predicate ignores anything that looks like JSON, and
 * `express.json` ignores everything that is not. A file upload
 * therefore reaches its handler as a Buffer and a chat request
 * as an object, on the same router, with no route-specific
 * middleware to attach to the wrong one.
 *
 * The raw limit is the file ceiling plus headroom. It is a
 * second line rather than the real check — files/sniff.ts
 * refuses the same file from its bytes — but it is the one that
 * stops an oversized upload being buffered in full before
 * anything gets to look at it.
 */
const rawUploadLimit = `${Math.ceil(
  fileAnalysis.maxFileBytes / (1024 * 1024)
) + 1}mb`;

const uploadBody = express.raw({
  type: (req) => !/^application\/json\b/i.test(req.headers["content-type"] ?? ""),
  limit: rawUploadLimit,
});

app.use(
  "/api/v1",
  uploadBody,
  express.json({ limit: "1mb" }),
  deploymentsRouter
);

// -----------------------------------------
// THE SCHEDULER'S EXTERNAL DRIVER
//
// Mounted here, above the CORS middleware, for exactly the
// reason the deployments router is: adding no CORS headers means
// no browser makes a cross-origin call to it. This endpoint can
// make the server spend a learner's credits, so the only things
// that should be able to reach it are a platform cron and a
// terminal.
//
// It authenticates on a bearer read from the environment, and
// answers 404 to everything when none is configured.
// -----------------------------------------

/*
 * SCOPED TO ITS OWN PATH, and the scoping is a bug fix rather
 * than tidiness.
 *
 * This used to be `app.use(express.json({ limit: "16kb" }),
 * schedulerTickRouter)` with no path — which mounts at "/" and
 * therefore ran that parser on EVERY JSON request to this
 * server. `express.json` sets `req._body` and later parsers
 * skip an already-parsed body, so the 1mb parser below never
 * got a say: the whole API was silently capped at 16kb.
 *
 * That is well under what the runtime itself allows —
 * `maxInputChars` alone is 24,000 — so a long conversation, an
 * agent with substantial knowledge, or a captured web page came
 * back as a bare 413 with no code and no message, from a limit
 * that belongs to a cron endpoint nobody else calls.
 *
 * verify-ai-runtime caught this and was right; it had been
 * reporting it into a suite that aborted before anyone read it.
 *
 * The PARSER is scoped to the tick path; the router still
 * mounts at the root, so the endpoint's URL is unchanged.
 */
app.use("/internal/scheduler/tick", express.json({ limit: "16kb" }));

app.use(schedulerTickRouter);

// -----------------------------------------
// MIDDLEWARE
// -----------------------------------------

app.use(
  cors({
    origin(origin, callback) {
      /* Same-origin and server-to-server requests send no Origin. */
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed.`));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));

// -----------------------------------------
// HEALTH CHECK & DIAGNOSTICS
// -----------------------------------------

app.get("/", (_req, res) => {
  res.json({ message: "BuildGentic backend API is running." });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "BuildGentic backend",
  });
});

// -----------------------------------------
// PER-STEP PROGRESS AND XP
// -----------------------------------------

app.use("/api/progress", progressRouter);

// -----------------------------------------
// AI RUNTIME
//
// Every model call BuildGentic makes goes through here. Mounted
// before the aggregate-progress routes below only because
// Express matches in order and these paths do not overlap; the
// two systems share nothing but the auth helper.
// -----------------------------------------

// -----------------------------------------
// PUBLISHED AGENT PAGES (visitor side)
//
// Mounted BELOW the CORS middleware, unlike the /api/v1
// deployment router above, and the difference is deliberate
// rather than an inconsistency.
//
// That router is above CORS because a deployment key that works
// from a web page is a deployment key published to the world,
// so no browser must ever be able to call it cross-origin. This
// router is the opposite case: its only caller IS a browser —
// the published page itself, same-origin — and it carries no
// credential for CORS to protect. So the allowlist does exactly
// what it should here: BuildGentic's own pages reach it, and a
// third party embedding a student's agent in their own site
// does not.
//
// It is also the only router in this file mounted at a path
// that anonymous traffic reaches, which is why every limit it
// depends on lives somewhere it cannot be skipped: the site
// ceiling inside ai_usage_admit, and the per-visitor bucket in
// sites/visitorRate.ts.
// -----------------------------------------

app.use("/api/sites", sitesRouter);

app.use("/api/ai", aiRouter);

app.use("/api/credits", creditsRouter);

// -----------------------------------------
// AGENT DEPLOYMENT (owner side)
//
// Creating a deployment, rotating its key, revoking it, and
// reading what it has been doing. Session-authenticated, unlike
// the /api/v1 router above, which is why the two are separate
// files with no shared middleware between them.
// -----------------------------------------

// -----------------------------------------
// FILE ANALYSIS (owner side)
//
// Mounted before the agents router because it takes raw bytes
// rather than JSON, and the express.json above has already run
// by this point — a JSON parser handed a PDF produces a 400
// about malformed JSON, which is a confusing way to learn that
// your upload never reached the handler.
//
// Same path prefix as the agents router: these are agent
// operations, and splitting them across two prefixes would
// invent a distinction a caller does not care about.
// -----------------------------------------

// -----------------------------------------
// THE AGENT LIBRARY
//
// Mounted BEFORE the two routers below, and the order is the
// point rather than a preference. Every route in agents.ts is
// shaped "/:agentId/something", so "library" would otherwise
// arrive at one of them as an agent id — a 404 at best, and at
// worst whichever handler happened to match first. A more
// specific mount declared earlier removes the ambiguity
// instead of relying on nobody reordering that file.
// -----------------------------------------

app.use("/api/agents/library", libraryRouter);

app.use("/api/agents", uploadBody, filesRouter);

/*
 * Above agentsRouter, because that one owns "/:agentId" and
 * would otherwise match "/documents/:id" as an agent id and
 * answer 404 for every download.
 */
app.use("/api/agents", documentsRouter);

/* Above agentsRouter for the same reason, and with the same
   consequence if it moves: "/email/status" would be read as an
   agent id and the Email screen would 404 on load. */
app.use("/api/agents", emailRouter);

app.use("/api/agents", agentsRouter);

app.use("/api/schedules", schedulesRouter);

// -----------------------------------------
// THE BROWSER EXTENSION
//
// Mounted BELOW the CORS middleware, unlike the /api/v1
// deployment router at the top of this file, and the difference
// is deliberate rather than an inconsistency.
//
// That router is above CORS because a deployment key that works
// from a web page is a deployment key published to the world,
// so no browser must ever reach it cross-origin. This router is
// the opposite case: its caller IS a browser context — a side
// panel on some other site — so it needs CORS headers to work
// at all. The protection is that the allowlist admits exactly
// one extension origin rather than a wildcard. See
// isAllowedOrigin above.
//
// Two authentication schemes live on it: the pairing and
// device-management routes take an ordinary Supabase session,
// because the pairing page is a page in this app; everything
// else takes an `nlx_` extension token, which is refused
// everywhere else on this server.
// -----------------------------------------

app.use("/api/extension", extensionRouter);

// -----------------------------------------
// GET CURRENT USER PROGRESS
// -----------------------------------------

app.get("/api/progress", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const progress = await getProgress(user.id);

    return res.json(progress);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Unable to load progress.",
    });
  }
});

// -----------------------------------------
// RECORD EVALUATION
// -----------------------------------------

app.post("/api/progress/evaluation", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const { lessonId, conceptIds, correct } = req.body;

    if (typeof lessonId !== "string") {
      return res.status(400).json({
        error: "lessonId must be a string.",
      });
    }

    if (!Array.isArray(conceptIds)) {
      return res.status(400).json({
        error: "conceptIds must be an array.",
      });
    }

    if (!conceptIds.every((id) => typeof id === "string")) {
      return res.status(400).json({
        error: "conceptIds must contain only strings.",
      });
    }

    if (typeof correct !== "boolean") {
      return res.status(400).json({
        error: "correct must be a boolean.",
      });
    }

    const progress = await recordEvaluation(
      user.id,
      lessonId,
      conceptIds,
      correct
    );

    return res.json(progress);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Unable to record evaluation.",
    });
  }
});

// -----------------------------------------
// SET CURRENT LESSON
// -----------------------------------------

app.post("/api/progress/current-lesson", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const { lessonId } = req.body;

    if (typeof lessonId !== "string") {
      return res.status(400).json({
        error: "lessonId must be a string.",
      });
    }

    const progress = await setCurrentLesson(user.id, lessonId);

    return res.json(progress);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to update current lesson.",
    });
  }
});

// -----------------------------------------
// START SERVER
// -----------------------------------------

app.listen(PORT, async () => {
  console.log(`BuildGentic backend running at http://localhost:${PORT}`);

  /* Which AI provider is live, what the platform budget is, and
     whether BYOK can store anything — and nothing about any key
     beyond whether one exists. A deployment running offline on
     the mock because an env var was missed should be obvious
     here rather than at a learner's first prompt. */
  for (const line of describeAiConfig()) {
    console.log(line);
  }

  /*
   * Then whether the database matches this build.
   *
   * After the capability banner and before the scheduler, which
   * is where an operator is already looking — and it is the
   * question nothing used to ask. Migration 0019 sat unapplied
   * while this server started cleanly every time; the gap
   * surfaced days later as 0020 failing on a table it had every
   * right to expect. One glance should have cost, and now does.
   *
   * Awaited rather than fired and forgotten, so the warning
   * cannot arrive interleaved with the first request's logs.
   * It never throws and never stops the server: refusing to
   * start would take away the running system AND the screen
   * that explains why.
   */
  for (const line of await describeSchema()) {
    console.log(line);
  }

  /* Last, and after the banner, so a missing migration prints
     its hint where an operator is already looking. It refuses to
     start the timer rather than letting every run fail on a
     timer with nobody watching. */
  void startScheduler();
});
