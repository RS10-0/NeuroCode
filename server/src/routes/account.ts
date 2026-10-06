import { Router } from "express";
import type { Request, Response } from "express";

import { getAuthenticatedUser } from "../lib/auth";
import { admitVisitor, callerAddress } from "../sites/visitorRate";
import { AccountError, ageStatusOf, deleteAccount } from "../account/AgeGate";
import {
  answerAge,
  decideRequest,
  describeRequest,
  describeRevoke,
  pendingSummary,
  resendRequest,
  revokeConsent,
} from "../account/consent";
import { isAgeBand } from "../account/rules";
import { mailEnabled } from "../ai/config";

/*
 * The age question, the parent's consent, and leaving.
 *
 * WHY THESE ROUTES USE getAuthenticatedUser AND NOT requireUser.
 * requireUser refuses an account that is waiting for a parent —
 * that is the whole point of the gate — and these are the routes
 * a waiting account needs in order to stop waiting: answer,
 * resend, change the address, or delete itself. Everything else
 * in the API goes through requireUser and stays shut.
 *
 * The parent's routes carry no session at all. Who they act on
 * comes from the token in the email, and they are rate-limited
 * by caller address like the published pages are.
 */

export const accountRouter = Router();

function sendError(res: Response, error: unknown): void {
  if (error instanceof AccountError) {
    if (error.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }

    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    });
    return;
  }

  console.error(`[account] ${error instanceof Error ? error.message : String(error)}`);
  res.status(500).json({ error: "Something went wrong. Try again.", code: "internal" });
}

async function signedIn(req: Request, res: Response) {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }

  return user;
}

/* Parents' routes: one bucket per caller, shared across the
   three, so a script cannot guess tokens at any useful rate. */
function admitParent(req: Request, res: Response): boolean {
  const verdict = admitVisitor(
    callerAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress),
    "account:parent-consent"
  );

  if (!verdict.ok) {
    res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
    res.status(429).json({
      error: "Too many requests. Wait a moment and try again.",
      code: "rate_limited",
    });
    return false;
  }

  return true;
}

/* ---------------------------------------------------------
   GET /api/account/consent/available

   Asked by sign-up BEFORE it creates an under-13 account. If
   this server cannot email a parent, the account must not be
   created at all: a child's details stored with no consent
   request behind them are details nothing will ever ask about
   or sweep away. No session, nothing secret — a yes or no.
   --------------------------------------------------------- */

accountRouter.get("/consent/available", (_req, res) => {
  res.json({ available: mailEnabled() });
});

/* ---------------------------------------------------------
   GET /api/account/age — what the app's gate renders from.
   --------------------------------------------------------- */

accountRouter.get("/age", async (req, res) => {
  const user = await signedIn(req, res);

  if (!user) {
    return;
  }

  try {
    const { status, band } = await ageStatusOf(user.id);
    const pending = status === "pending" ? await pendingSummary(user.id) : null;

    res.json({ status, band, pending });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/account/age — { band, parentEmail? }
   --------------------------------------------------------- */

accountRouter.post("/age", async (req, res) => {
  const user = await signedIn(req, res);

  if (!user) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;

    if (!isAgeBand(raw.band)) {
      res.status(400).json({ error: "Choose your age.", code: "invalid_request" });
      return;
    }

    const { sentTo } = await answerAge({
      userId: user.id,
      band: raw.band,
      parentEmail: raw.parentEmail,
    });

    const { status, band } = await ageStatusOf(user.id);

    res.json({ status, band, sentTo });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/account/consent/resend — { parentEmail? }
   --------------------------------------------------------- */

accountRouter.post("/consent/resend", async (req, res) => {
  const user = await signedIn(req, res);

  if (!user) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    res.json(await resendRequest({ userId: user.id, parentEmail: raw.parentEmail }));
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/account — the account and everything in it.
   --------------------------------------------------------- */

accountRouter.delete("/", async (req, res) => {
  const user = await signedIn(req, res);

  if (!user) {
    return;
  }

  try {
    await deleteAccount(user.id);
    res.json({ deleted: true });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   THE PARENT'S PAGE

   The token travels in the request BODY even for the read, so
   it is never part of a URL any log records — the email link
   carries it in a fragment for the same reason (consent.ts).
   --------------------------------------------------------- */

accountRouter.post("/consent/lookup", async (req, res) => {
  if (!admitParent(req, res)) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    res.json(await describeRequest(raw.token));
  } catch (error) {
    sendError(res, error);
  }
});

accountRouter.post("/consent/decide", async (req, res) => {
  if (!admitParent(req, res)) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      await decideRequest({
        token: raw.token,
        decision: raw.decision,
        parentName: raw.parentName,
      })
    );
  } catch (error) {
    sendError(res, error);
  }
});

accountRouter.post("/consent/revoke/lookup", async (req, res) => {
  if (!admitParent(req, res)) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    res.json(await describeRevoke(raw.token));
  } catch (error) {
    sendError(res, error);
  }
});

accountRouter.post("/consent/revoke", async (req, res) => {
  if (!admitParent(req, res)) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    res.json(await revokeConsent(raw.token));
  } catch (error) {
    sendError(res, error);
  }
});
