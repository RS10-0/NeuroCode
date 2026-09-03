import type { Request, Response } from "express";
import type { User } from "@supabase/supabase-js";

import { supabase } from "./supabase";

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

  return user;
}
