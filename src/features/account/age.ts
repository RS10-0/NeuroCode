/*
 * Month and year of birth, turned into the band the server
 * stores — here, in the browser, so a birthdate never leaves it.
 *
 * Month precision is deliberate. Asking the day as well would
 * collect more than the decision needs, and without it the one
 * ambiguous case is a learner whose 13th birthday falls later in
 * the current month. They are counted as 13: the month has
 * arrived, and a gate that told a child on their birthday week
 * to fetch a parent would be wrong more often than it was right.
 */

export type AgeBand = "under_13" | "13_17" | "18_plus";

export interface BirthMonth {
  /* 1-12. */
  month: number;
  year: number;
}

export function ageOn(birth: BirthMonth, today: Date): number {
  const thisMonth = today.getMonth() + 1;
  let age = today.getFullYear() - birth.year;

  if (thisMonth < birth.month) {
    age -= 1;
  }

  return age;
}

export function bandFor(birth: BirthMonth, today: Date = new Date()): AgeBand {
  const age = ageOn(birth, today);

  if (age < 13) {
    return "under_13";
  }

  return age < 18 ? "13_17" : "18_plus";
}

/* =========================================================
   REMEMBERING THE ANSWER IN THIS BROWSER

   The other half of a neutral screen: an answer that can be
   changed by pressing Back is not an answer. Sign-up
   (pages/Register.tsx) remembers what was chosen for a day and
   skips the question if it comes back. A day rather than forever, so a parent signing up on the
   same family computer tomorrow is not treated as their child.

   Per-browser convenience, not enforcement — it lives in
   localStorage and can be cleared. The enforcement is that the
   server records an age once and never accepts a second answer.
   ========================================================= */

const ANSWER_KEY = "neurolink:age-answer";
const ANSWER_TTL_MS = 24 * 60 * 60 * 1000;

export function rememberAnswer(band: AgeBand): void {
  try {
    localStorage.setItem(ANSWER_KEY, JSON.stringify({ band, at: Date.now() }));
  } catch {
    /* Storage blocked: the question will simply be asked again. */
  }
}

export function recalledAnswer(): AgeBand | null {
  try {
    const raw = localStorage.getItem(ANSWER_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { band?: unknown; at?: unknown };

    if (
      typeof parsed.at !== "number" ||
      Date.now() - parsed.at > ANSWER_TTL_MS ||
      (parsed.band !== "under_13" && parsed.band !== "13_17" && parsed.band !== "18_plus")
    ) {
      localStorage.removeItem(ANSWER_KEY);
      return null;
    }

    return parsed.band;
  } catch {
    return null;
  }
}
