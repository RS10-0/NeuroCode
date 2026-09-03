import { Router } from "express";

import { requireUser } from "../lib/auth";
import { claimDaily, snapshot } from "../credits/CreditStore";
import { COSTS, EARNINGS, SURCHARGES } from "../credits/costs";

export const creditsRouter = Router();

/*
 * The XP wallet's HTTP surface.
 *
 * Read-only from the browser's point of view. There is no
 * endpoint here that lets a client set a balance, and there
 * never should be: the only things that move XP are the runtime
 * spending it, the curriculum granting it, and the Library
 * charging for an agent — all server-side, all keyed on a
 * verified bearer token.
 *
 * The daily claim is the one exception, and it is not really
 * one — the client can ask for it, but the client cannot say
 * how much it is worth or claim it twice. See below.
 */

/* ---------------------------------------------------------
   GET /api/credits

   The balance, the ceiling, the level, and the price list.

   The prices are published so the UI can say "this costs 2 XP"
   next to a button rather than hard-coding a number that would
   drift the first time costs.ts changed. They are not a secret:
   a learner discovers every one of them by pressing the button
   once.

   `level` and `xpToNextLevel` are computed here rather than in
   the browser, so there is one definition of the scale and it
   is the one the database agrees with. The number they are
   derived from is deliberately NOT sent under a name that
   invites a second interpretation — the UI gets a level and a
   progress figure, not a raw running total to draw its own
   conclusions from.
   --------------------------------------------------------- */

creditsRouter.get("/", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const wallet = await snapshot(user.id);

    res.json({
      available: wallet.available,
      balance: wallet.balance,
      maxBalance: wallet.maxBalance,
      dailyGrant: wallet.dailyGrant,
      lastRefillAt: wallet.lastRefillAt,

      level: wallet.level,
      xpIntoLevel: wallet.xpIntoLevel,
      xpPerLevel: wallet.xpPerLevel,
      xpToNextLevel: Math.max(0, wallet.xpPerLevel - wallet.xpIntoLevel),

      costs: {
        lab: COSTS.lab,
        agentTest: COSTS.agent_test,
        agentPublic: COSTS.agent_public,
      },
      /* What a capability adds to the turn that used it, so the
         Builder can say what switching one on will cost before
         a learner switches it on. */
      surcharges: {
        webSearch: SURCHARGES.webSearch,
        fileAnalysis: SURCHARGES.fileAnalysis,
      },
      earnings: {
        lessonComplete: EARNINGS.lessonComplete,
        courseComplete: EARNINGS.courseComplete,
        dailyLogin: EARNINGS.dailyLogin,
        streakBonus: EARNINGS.streakBonus,
      },
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Unable to load your XP.",
    });
  }
});

/* ---------------------------------------------------------
   POST /api/credits/daily

   Claims today's login grant, at most once per UTC day, and
   advances the streak that pays a bonus every tenth day.

   GRANTS RATHER THAN REFILLS. Under the old wallet this endpoint
   topped somebody up to a fixed daily figure; since 0014 it adds
   the day's XP to whatever was already saved, stopping at the
   learner's ceiling. That is the change that makes saving for a
   200 XP marketplace agent possible at all.

   Safe to call on every page load, which is exactly how the
   client uses it: the idempotency is a unique index on
   (user_id, source_type, source_id) in the database, not a
   check in the browser and not a flag in a session. Calling it
   a hundred times in a minute grants once and reports zero for
   the other ninety-nine.

   The date is computed HERE, from the server's clock, rather
   than accepted from the request. A client-supplied day would
   be a client-supplied number of bonuses — and, now, a
   client-supplied streak.
   --------------------------------------------------------- */

creditsRouter.post("/daily", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  /* UTC, so a learner cannot collect twice by changing their
     timezone, and so the boundary is the same for everybody. */
  const day = new Date().toISOString().slice(0, 10);

  try {
    const result = await claimDaily(user.id, day);

    res.json({
      granted: result.granted,
      /* The ten-day streak bonus, on the day it lands. Reported
         separately from the login grant so the UI can celebrate
         it rather than showing one larger number with no
         explanation. */
      bonus: result.bonus,
      balance: result.balance,
      streak: result.streak,
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to claim your daily XP.",
    });
  }
});
