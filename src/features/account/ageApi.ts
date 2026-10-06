import { authHeaders } from "../../lib/api";
import type { AgeBand } from "./age";

/*
 * The age question and parental consent, from the browser.
 *
 * Errors carry the server's `code` as well as its message,
 * because several screens branch on it — a resend limit shows a
 * wait, an expired link shows "ask for a new one" — rather than
 * printing whatever text came back.
 */

export type AgeStatus = "unanswered" | "active" | "restricted" | "pending";

export interface AgeState {
  status: AgeStatus;
  band: AgeBand | null;
  pending: { parentEmail: string; expiresAt: string } | null;
}

export class AccountApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, code: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const BASE = "/api/account";

async function call<T>(
  path: string,
  init: RequestInit & { signedIn?: boolean } = {}
): Promise<T> {
  const { signedIn = true, ...rest } = init;

  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: signedIn
        ? { ...(await authHeaders()), ...rest.headers }
        : { "Content-Type": "application/json", ...rest.headers },
    });
  } catch {
    throw new AccountApiError(
      "Couldn't reach BuildGentic. Check your connection and try again.",
      0,
      "network"
    );
  }

  let body: Record<string, unknown> = {};

  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    /* Non-JSON body; the status alone has to do. */
  }

  if (!response.ok) {
    throw new AccountApiError(
      typeof body.error === "string" ? body.error : `Request failed with status ${response.status}.`,
      response.status,
      typeof body.code === "string" ? body.code : "unknown",
      typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined
    );
  }

  return body as T;
}

/* ---------------- the learner ---------------- */

export function fetchAgeState(): Promise<AgeState> {
  return call<AgeState>("/age");
}

export function submitAge(input: {
  band: AgeBand;
  parentEmail?: string;
}): Promise<{ status: AgeStatus; band: AgeBand; sentTo: string | null }> {
  return call("/age", { method: "POST", body: JSON.stringify(input) });
}

export function resendConsent(parentEmail?: string): Promise<{ sentTo: string }> {
  return call("/consent/resend", {
    method: "POST",
    body: JSON.stringify(parentEmail ? { parentEmail } : {}),
  });
}

export function deleteMyAccount(): Promise<{ deleted: true }> {
  return call("", { method: "DELETE" });
}

/* Whether this server can email a parent — asked before an
   under-13 account is created, never after. */
export async function consentAvailable(): Promise<boolean> {
  const { available } = await call<{ available: boolean }>("/consent/available", {
    signedIn: false,
  });
  return available;
}

/* ---------------- the parent (no session) ---------------- */

export function lookupConsent(token: string): Promise<{ childName: string; expiresAt: string }> {
  return call("/consent/lookup", { method: "POST", signedIn: false, body: JSON.stringify({ token }) });
}

export function decideConsent(input: {
  token: string;
  decision: "approve" | "decline";
  parentName?: string;
}): Promise<{ outcome: "approved" | "declined"; childName: string }> {
  return call("/consent/decide", { method: "POST", signedIn: false, body: JSON.stringify(input) });
}

export function lookupRevoke(token: string): Promise<{ childName: string }> {
  return call("/consent/revoke/lookup", { method: "POST", signedIn: false, body: JSON.stringify({ token }) });
}

export function revokeConsent(token: string): Promise<{ childName: string }> {
  return call("/consent/revoke", { method: "POST", signedIn: false, body: JSON.stringify({ token }) });
}
