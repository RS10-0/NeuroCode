import { supabase } from "./supabase";

/*
 * Calls the BuildGentic API.
 *
 * Relative paths only — Vite proxies /api to the Express server
 * in development, and the two are same-origin in production. No
 * hardcoded localhost, and therefore no CORS round trip.
 */
async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(await authHeaders()),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const body = (await response.json()) as { error?: string };

      if (body.error) {
        message = body.error;
      }
    } catch {
      /* Non-JSON error body; keep the status message. */
    }

    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

/*
 * The bearer token every BuildGentic API call carries.
 *
 * Shared with the AI client, which cannot use `request` above:
 * a streamed response has to be read from the raw Response, not
 * parsed as JSON. One helper rather than two ways of finding the
 * session.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* =========================================================
   LESSON STEP PROGRESS
========================================================= */

export interface StepProgressRow {
  lesson_id: string;
  step_id: string;
  completed: boolean;
  score: number | null;
  attempts: number;
  xp_awarded: number;
}

export interface AwardResult {
  newlyCompleted: boolean;
  awarded: number;
  totalXp: number;
  level: number;
}

export function fetchStepProgress(
  lessonId: string
): Promise<{ steps: StepProgressRow[] }> {
  return request(`/progress/steps/${encodeURIComponent(lessonId)}`);
}

/*
 * Records a completed step. Safe to call more than once for the
 * same step — the server grants XP only on the first.
 *
 * No XP amount is sent. The server reads the step's worth from
 * the curriculum, so the browser cannot name its own price, and
 * `awarded` in the reply is the only number worth trusting.
 */
export function awardStepXp(input: {
  stepId: string;
  score?: number;
}): Promise<AwardResult> {
  return request("/progress/step", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
