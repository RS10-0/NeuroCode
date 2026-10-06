import type { Request, Response } from "express";
import type { User } from "@supabase/supabase-js";

import { supabase } from "./supabase";
import { accountBlocked } from "../account/AgeGate";

/*
 * Resolves the caller from the request's bearer token.
 *
 * The token is verified against Supabase on every call — the
 * service-role client here holds no session of its own, so the
 * token must be passed explicitly.
 */
export async function getAuthenticatedUser(
  req: Request
): Promise<User | null> {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.substring(7);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

/*
 * Same, but writes the 401 for you. Returns null when the
 * response has already been sent, so callers just bail out.
 *
 * Also the age gate's one enforcement point for signed-in
 * routes: an account under 13 that is still waiting for a
 * parent's consent is refused here, with a 403 the app
 * recognises, on every route that uses this — which is every
 * authenticated route except routes/account.ts, the ones such
 * an account needs in order to get unstuck. The lookup is cached
 * and fails open; see account/AgeGate.ts.
 */
export async function requireUser(
  req: Request,
  res: Response
): Promise<User | null> {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }

  if (await accountBlocked(user.id)) {
    res.status(403).json({
      error: "A parent or guardian needs to approve this account first.",
      code: "consent_pending",
    });
    return null;
  }

  return user;
}
