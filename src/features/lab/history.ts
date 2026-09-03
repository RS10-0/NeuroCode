import type { LabRun } from "./types";

/*
 * The Lab's run history.
 *
 * Deliberately the smallest mechanism that makes "run it again
 * and see what moved" possible, and no larger.
 *
 *   sessionStorage, not localStorage — history belongs to this
 *   tab and dies with it. A shared or lab computer should not
 *   hand the next person a list of what the last one typed.
 *
 *   Scoped to the signed-in learner — a sign-out and sign-in in
 *   the same tab must not carry one person's prompts into
 *   another person's Lab.
 *
 *   Never posted anywhere. Phase 2.1 decided that `ai_usage`
 *   records the shape and cost of a request but never its text,
 *   and a server-side history would quietly undo that decision.
 *   If prompts are ever worth keeping across devices, that is a
 *   product decision with a consent conversation attached — not
 *   something the Lab should start doing on its own.
 */

const STORAGE_KEY = "neurolink.lab.history.v1";

/* Enough to compare a session's worth of experiments; small
   enough that sessionStorage never becomes the reason a tab is
   slow. */
const MAX_RUNS = 20;

/*
 * Per-run output budget. A long answer is kept in full in the
 * live view; only the stored copy is clipped, and `truncated`
 * on the run says so rather than pretending otherwise.
 */
const MAX_STORED_OUTPUT_CHARS = 4_000;

interface StoredHistory {
  /* Whose runs these are. A mismatch empties the store. */
  userId: string;
  runs: LabRun[];
}

function readRaw(): StoredHistory | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredHistory;

    if (
      typeof parsed?.userId !== "string" ||
      !Array.isArray(parsed?.runs)
    ) {
      return null;
    }

    return parsed;
  } catch {
    /*
     * Storage can be unavailable outright — Safari's private
     * mode, an embedded webview, a browser with site data
     * blocked. The Lab works perfectly well without history, so
     * this is a degraded feature rather than an error worth
     * showing anybody.
     */
    return null;
  }
}

function write(value: StoredHistory): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Quota exceeded, or storage disabled. The in-memory copy
       React holds is still correct for this tab. */
  }
}

export function loadHistory(userId: string): LabRun[] {
  const stored = readRaw();

  if (!stored) {
    return [];
  }

  if (stored.userId !== userId) {
    /* Someone else's tab-local history. Drop it rather than
       leave it sitting there for the next reload. */
    clearHistory();
    return [];
  }

  return stored.runs.slice(0, MAX_RUNS);
}

/*
 * Trims a run down to what is worth storing.
 *
 * The live run object is not mutated — the panel on screen keeps
 * showing the whole answer.
 */
function forStorage(run: LabRun): LabRun {
  if (run.output.length <= MAX_STORED_OUTPUT_CHARS) {
    return run;
  }

  return {
    ...run,
    output: run.output.slice(0, MAX_STORED_OUTPUT_CHARS),
    truncated: true,
  };
}

/* Newest first, so the list reads the way it is rendered. */
export function saveHistory(userId: string, runs: LabRun[]): void {
  write({ userId, runs: runs.slice(0, MAX_RUNS).map(forStorage) });
}

export function clearHistory(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Nothing to do — see readRaw. */
  }
}

export { MAX_RUNS };
