import { Router } from "express";

import { requireUser } from "../lib/auth";
import {
  awardStepXp,
  countCompletedSteps,
  getStepProgress,
} from "../progress/StepProgressStore";
import { courseCompletionStepIds, resolveStepXp } from "../progress/xpPlan";
import { grant } from "../credits/CreditStore";
import { EARNINGS } from "../credits/costs";

export const progressRouter = Router();

/* ---------------------------------------------------------
   GET /api/progress/steps/:lessonId

   Every step the learner has already completed in a lesson.
   The player uses this to restore state and to know which
   steps have already paid out.
   --------------------------------------------------------- */

progressRouter.get("/steps/:lessonId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const steps = await getStepProgress(user.id, req.params.lessonId);
    res.json({ steps });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to load step progress.",
    });
  }
});

/* ---------------------------------------------------------
   POST /api/progress/step

   Records a completed step and grants its XP exactly once.
   Safe to call repeatedly: a repeat returns awarded: 0.

   Nothing about the award is taken from the request except
   which step it is. The user comes from the verified bearer
   token, and the amount and owning lesson come from the
   curriculum — a request body cannot name its own price.
   --------------------------------------------------------- */

progressRouter.post("/step", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  const { stepId, score } = req.body ?? {};

  if (typeof stepId !== "string" || stepId.length === 0) {
    res.status(400).json({ error: "stepId must be a non-empty string." });
    return;
  }

  if (
    score !== undefined &&
    score !== null &&
    (typeof score !== "number" || !Number.isFinite(score))
  ) {
    res.status(400).json({ error: "score must be a number when supplied." });
    return;
  }

  const planned = resolveStepXp(stepId);

  if (!planned) {
    res.status(400).json({
      error: `Unknown step: ${stepId}.`,
    });
    return;
  }

  try {
    const result = await awardStepXp(
      user.id,
      planned.lessonId,
      stepId,
      planned.xp,
      typeof score === "number" ? score : undefined
    );

    /*
     * FINISHING A LESSON EARNS SPENDABLE XP.
     *
     * Two different numbers move here and they must not be
     * confused. `result` is lifetime XP — the score that decides
     * a learner's level and only ever goes up. `earned` below is
     * wallet XP, which is what the Lab spends.
     *
     * Gated on `newlyCompleted` as well as on the step type, so
     * replaying a finished lesson pays nothing. The grant is
     * idempotent in SQL as well, keyed on the lesson id, so the
     * two guards would have to fail together.
     */
    let earned = 0;
    let courseEarned = 0;

    if (planned.finishesLesson && result.newlyCompleted) {
      const granted = await grant(
        user.id,
        EARNINGS.lessonComplete,
        "Completed a lesson",
        "lesson",
        planned.lessonId
      );

      earned = granted.granted;

      /*
       * FINISHING THE WHOLE COURSE PAYS AGAIN, on top.
       *
       * Measured against every lesson's completion step rather
       * than against "was this the last lesson in the list",
       * because lessons can be taken in any order and the
       * course is finished when the last REMAINING one is done
       * — which may well be lesson three.
       *
       * The empty-list guard is load-bearing: every() over an
       * empty array is true, so a course id this build does not
       * ship would otherwise pay a bonus for finishing a course
       * that does not exist.
       *
       * Idempotent in SQL on ("course", courseId), so a learner
       * who replays a lesson inside a finished course cannot
       * collect twice — the `newlyCompleted` guard above would
       * already have stopped them, and this is the guard that
       * does not depend on getting that one right.
       */
      const courseSteps = courseCompletionStepIds(planned.courseId);

      if (courseSteps.length > 0) {
        const done = await countCompletedSteps(user.id, courseSteps);

        if (done >= courseSteps.length) {
          const courseGrant = await grant(
            user.id,
            EARNINGS.courseComplete,
            "Completed a course",
            "course",
            planned.courseId
          );

          courseEarned = courseGrant.granted;
        }
      }
    }

    res.json({
      ...result,
      creditsEarned: earned + courseEarned,
      /* Reported separately so the player can celebrate
         finishing a course rather than showing one larger
         number with no explanation. */
      courseCreditsEarned: courseEarned,
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to record step progress.",
    });
  }
});
