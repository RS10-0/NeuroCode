import { Router } from "express";
import type { Response } from "express";

import { requireUser } from "../lib/auth";
import { getAgent } from "../agents/AgentStore";
import {
  createFlagshipAgent,
  findFlagshipAgentId,
  flagshipSections,
  seedFlagshipKnowledge,
  siteTemplateFor,
} from "../agents/FlagshipStore";
import {
  listUnlocks,
  purchaseFlagship,
  snapshot as creditSnapshot,
} from "../credits/CreditStore";
import { createDeployment } from "../agents/DeploymentStore";
import {
  createSite,
  getSiteForAgent,
  suggestSlug,
  type SiteSummary,
} from "../sites/SiteStore";
import { publicSiteBaseUrl } from "../ai/config";
import { parseSiteConfig } from "../../../src/features/sites/schema";
import { starterConfig } from "../../../src/features/sites/templates";
import type { TemplateId } from "../../../src/features/sites/schema";
import {
  FLAGSHIPS,
  findFlagship,
  flagshipPrice,
} from "../../../src/features/agents/flagships";
import { AiRuntimeError, statusFor, toErrorBody } from "../ai/errors";

export const libraryRouter = Router();

/*
 * The Agent Library — BuildGentic's own agents, and the XP that
 * buys them.
 *
 * A separate router from agents.ts rather than five more
 * handlers in it, for a reason that is about paths as much as
 * about file length: every route in that file is shaped
 * "/:agentId/something", and "/library" is not an agent id. A
 * static segment living among dynamic ones is a bug waiting for
 * somebody to reorder the file, so it is mounted ahead of them
 * in index.ts instead and the ambiguity never exists.
 *
 * TWO RULES RUN THROUGH THIS FILE.
 *
 * The price is never taken from the request. flagshipPrice() is
 * the only thing either handler asks about cost, so there is no
 * body a caller could send that names their own price.
 *
 * Owning is not the same as having. `agent_unlocks` is the
 * entitlement and the `agents` row is an instance, and they are
 * allowed to come apart: deleting a purchased agent keeps the
 * unlock, so somebody who deletes their Writing Coach still
 * owns it and re-adds it for nothing. Every ownership question
 * below is answered from the unlock, never from the agent.
 */

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  res.status(statusFor(error)).json(body);
}

function describeSite(site: SiteSummary) {
  return {
    slug: site.slug,
    url: `${publicSiteBaseUrl}/${site.slug}`,
    published: site.published,
  };
}

/* ---------------------------------------------------------
   GET /api/agents/library

   The catalogue, what this learner owns, and what they can
   afford.

   Carries no system prompt, because the browser has none and
   must not: see server/src/agents/flagshipPrompts.ts. What a
   card renders — name, tagline, price, capabilities — is the
   public half of the catalogue and ships in the bundle anyway.
   --------------------------------------------------------- */

libraryRouter.get("/", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const [owned, wallet] = await Promise.all([
      listUnlocks(user.id),
      creditSnapshot(user.id),
    ]);

    const ownedSet = new Set(owned);

    /*
     * The agent row behind each unlock, so a card can link
     * straight to it. Null for an entitlement whose agent was
     * deleted, which the Library renders as "Add again" rather
     * than as "Open" — and which costs nothing to act on.
     */
    const resolved = await Promise.all(
      FLAGSHIPS.filter((entry) => ownedSet.has(entry.id)).map(
        async (entry) =>
          [entry.id, await findFlagshipAgentId(user.id, entry.id)] as const
      )
    );

    const agentByFlagship = new Map(resolved);

    res.json({
      balance: wallet.balance,
      available: wallet.available,
      agents: FLAGSHIPS.map((entry) => ({
        id: entry.id,
        name: entry.name,
        tagline: entry.tagline,
        description: entry.description,
        xpCost: entry.xpCost,
        avatarEmoji: entry.avatarEmoji,
        avatarTone: entry.avatarTone,
        capabilities: entry.capabilities,
        starterPrompts: entry.starterPrompts,
        hasSeededKnowledge: entry.hasSeededKnowledge,
        owned: ownedSet.has(entry.id),
        agentId: agentByFlagship.get(entry.id) ?? null,
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/library/:flagshipId/unlock

   Buys one of BuildGentic's agents and builds the learner's copy:
   the agent, its reference material, a deployment, and a
   published page at its own address.

   Idempotent in two different ways, because there are two
   different repeats to survive. A double click hits the unique
   key on agent_unlocks and is reported as already owned,
   charging nothing. Somebody who deleted their copy and came
   back gets a fresh agent built against the entitlement they
   already hold, also charging nothing.
   --------------------------------------------------------- */

libraryRouter.post("/:flagshipId/unlock", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  const flagship = findFlagship(req.params.flagshipId);
  const price = flagship ? flagshipPrice(flagship.id) : null;

  if (!flagship || price === null) {
    res.status(404).json({
      error: "No such agent in the Library.",
      code: "not_found",
    });
    return;
  }

  try {
    const purchase = await purchaseFlagship(user.id, flagship.id, price);

    if (!purchase.ok) {
      /*
       * 402 rather than 400. The request was well formed and
       * the learner is who they say they are — they simply
       * cannot afford it yet, which is a state that fixes
       * itself by finishing a lesson or coming back tomorrow.
       */
      res.status(402).json({
        error: `${flagship.name} costs ${price} XP and you have ${purchase.balance}. Finish a lesson to earn more, or come back tomorrow for your daily XP.`,
        code: "out_of_xp",
        balance: purchase.balance,
        xpCost: price,
      });
      return;
    }

    /* Holds the agent itself, not merely the entitlement.
       Nothing left to build. */
    const existingId = await findFlagshipAgentId(user.id, flagship.id);

    if (existingId) {
      const site = await getSiteForAgent(user.id, existingId);

      res.json({
        agentId: existingId,
        alreadyOwned: true,
        charged: purchase.cost,
        balance: purchase.balance,
        site: site ? describeSite(site) : null,
      });
      return;
    }

    const agentId = await createFlagshipAgent(user.id, flagship);

    await seedFlagshipKnowledge(user.id, agentId, flagship.id);

    const site = await publishFlagshipPage(user.id, agentId, flagship.id);

    res.status(201).json({
      agentId,
      alreadyOwned: false,
      charged: purchase.cost,
      balance: purchase.balance,
      site: site ? describeSite(site) : null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/*
 * Deploys the new agent and gives it its address.
 *
 * Done here rather than left for the learner to press Publish,
 * because they cannot design the page anyway — the Customise
 * screen hides its panes for an official agent and the server
 * refuses the write — so an unpublished page would leave them
 * with a button they are not allowed to use. Everything the
 * page needs is already known: BuildGentic wrote the copy, chose
 * the layout, and the starter prompts are in the catalogue.
 *
 * BEST EFFORT, and never throws. The wallet has already been
 * debited by the time this runs, so a failure here has to
 * degrade rather than fail: an agent with no public page is a
 * partial purchase the learner can finish from the Deploy
 * screen, and an exception would be a purchase that took their
 * XP and reported an error.
 */
async function publishFlagshipPage(
  userId: string,
  agentId: string,
  flagshipId: string
): Promise<SiteSummary | null> {
  const flagship = findFlagship(flagshipId);

  if (!flagship) {
    return null;
  }

  try {
    /*
     * Read back rather than assembled from what was just
     * written: createDeployment refuses anything that is not
     * `ready`, and it should be checking the row rather than
     * trusting this function's memory of it.
     */
    const agent = await getAgent(userId, agentId);

    if (!agent) {
      throw new AiRuntimeError("internal_error", "Agent vanished after insert.");
    }

    const deployment = await createDeployment(agent);

    /*
     * The starter page, with the chat AND the sections replaced.
     *
     * `starterConfig` is kept for the hero and the theme, which
     * it keys off the real name and description. Everything it
     * writes as PROSE has to go: it is placeholder text a
     * student is meant to overwrite — "Replace this with
     * something only your agent does" — which is right for
     * somebody about to edit it and permanent on a page nobody
     * may edit. The first Writing Coach page published three of
     * them before this was caught.
     *
     * So the sections come from flagshipSections(), generated
     * from the capability list, and the chat comes from the
     * catalogue's own starter prompts.
     */
    const config = parseSiteConfig({
      ...starterConfig({
        agentName: flagship.name,
        description: flagship.description,
        template: siteTemplateFor(flagshipId) as TemplateId,
      }),
      sections: flagshipSections(flagship),
      chat: {
        enabled: true,
        greeting:
          flagship.onboardingNudge ??
          `Hi — I'm ${flagship.name}. What can I help you with?`,
        placeholder: "Ask a question…",
        suggestedPrompts: flagship.starterPrompts.slice(0, 3),
        /* Only where the agent can actually read what is handed
           to it. A paperclip on a page whose agent has File
           Analysis off is a promise it cannot keep. */
        allowUploads: flagship.capabilities.includes("file_analysis"),
      },
    });

    return await createSite({
      userId,
      agentId,
      deploymentId: deployment.id,
      slug: await suggestSlug(flagship.name),
      config,
    });
  } catch (error) {
    console.error(
      `[library] built ${flagshipId} for ${userId} but could not publish its page:`,
      error instanceof Error ? error.message : error
    );

    return null;
  }
}
