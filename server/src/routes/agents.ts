import { Router } from "express";
import type { Response } from "express";

import { requireUser } from "../lib/auth";
import { getAgent } from "../agents/AgentStore";
import {
  indexAgent,
  knowledgeStatus,
} from "../agents/knowledge/KnowledgeIndex";
import {
  createDeployment,
  deleteDeployment,
  deploymentUsage,
  getActiveKey,
  getDeployment,
  issueKey,
  revokeActiveKey,
  type DeploymentSummary,
} from "../agents/DeploymentStore";
import {
  clearMemories,
  deleteMemory,
  listForAgent,
  type ClearTarget,
} from "../agents/memory/MemoryStore";
import {
  createConnection,
  deleteConnection,
  listConnections,
  METHODS,
  type ConnectionAuth,
} from "../agents/actions/http/ConnectionStore";
import { canSeal } from "../ai/crypto";
/* The catalogue, read directly, the same way library.ts and
   AgentStore read it. See flagships.ts on why that file is a
   leaf. */
import { flagshipPublishable } from "../../../src/features/agents/flagships";
import {
  deploymentLimits,
  memory,
  publicApiBaseUrl,
  publicSiteBaseUrl,
  siteLimits,
} from "../ai/config";
import {
  createSite,
  deleteSite,
  getSiteForAgent,
  isSlugAvailable,
  siteUsage,
  suggestSlug,
  updateSite,
  type SiteSummary,
} from "../sites/SiteStore";
import { planSiteEdit } from "../sites/siteEdit";
import { EditPlanError } from "../../../src/features/sites/edits";
import {
  parseSiteConfig,
  SiteConfigError,
} from "../../../src/features/sites/schema";
import { starterConfig } from "../../../src/features/sites/templates";
import {
  canonicalizeSlug,
  checkSlug,
} from "../../../src/features/sites/slug";
import { AiRuntimeError, statusFor, toErrorBody } from "../ai/errors";

export const agentsRouter = Router();

/*
 * The owner's side of deployment.
 *
 * Everything here needs a Supabase session and answers about one
 * learner's own agent. The other half — the endpoint an external
 * application actually calls — is routes/deployments.ts, and the
 * two are separate files because they authenticate completely
 * differently and must never grow a shared middleware that could
 * be applied to the wrong one.
 *
 * Nothing in this router edits an agent's configuration. Agents
 * are edited in the Builder, browser-to-Supabase under RLS,
 * exactly as in Phase 2.3; deploying does not change that and
 * does not need to.
 *
 * The knowledge routes below are the one thing here that writes,
 * and what they write is not configuration: chunks, vectors, and
 * the `status` column that says whether an entry is searchable
 * yet. All three are conclusions the server reached by calling
 * an embedding provider, so the browser cannot produce them and
 * must not be able to assert them — which is why those tables
 * are owner-read with no write policy at all.
 *
 * The memory routes are the mirror of that, and the asymmetry is
 * the whole security model of that capability: they can read and
 * they can DELETE, and there is no route here — or anywhere —
 * that adds a memory. Remembering is a conclusion the server
 * reaches from a conversation; forgetting is a decision a person
 * makes. agent_memories is owner-read with no write policy for
 * the same reason the knowledge tables are.
 */

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

/*
 * The address to give an external application.
 *
 * Assembled from configuration rather than from the request, so
 * it is the URL a caller elsewhere would use rather than
 * whichever host header happened to arrive.
 */
function endpointFor(deployment: DeploymentSummary): string {
  return `${publicApiBaseUrl}/api/v1/agents/${deployment.publicId}/chat`;
}

function describe(deployment: DeploymentSummary) {
  return {
    id: deployment.id,
    publicId: deployment.publicId,
    createdAt: deployment.createdAt,
    endpoint: endpointFor(deployment),
  };
}

function parseLabel(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const raw = (body as Record<string, unknown>).label;

  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AiRuntimeError(
      "invalid_request",
      "label must be a string when supplied."
    );
  }

  if (raw.length > 60) {
    throw new AiRuntimeError(
      "invalid_request",
      "label may be at most 60 characters."
    );
  }

  return raw.trim() || undefined;
}

/*
 * Resolves the agent, or answers.
 *
 * Another learner's agent id is indistinguishable from one that
 * does not exist, which is what it should look like — the same
 * choice DELETE /api/ai/keys/:id makes.
 */
async function requireAgent(res: Response, userId: string, agentId: string) {
  const agent = await getAgent(userId, agentId);

  if (!agent) {
    res.status(404).json({ error: "No such agent.", code: "invalid_request" });
    return null;
  }

  return agent;
}

/*
 * The same, but refuses one of BuildGentic's own agents.
 *
 * Guards the two routes that let a learner change how their
 * page looks and reads. A purchased agent's page is designed by
 * BuildGentic and is not theirs to redesign — the one deliberate
 * difference between an agent they bought and one they built.
 *
 * The database refuses the underlying write anyway: migration
 * 0015 tightened the WITH CHECK on `agents` so an official row
 * cannot be updated from a browser at all. This is here so the
 * refusal is a sentence the learner can read rather than a
 * policy violation surfacing as a failed save, and so the
 * natural-language editor does not spend 2 XP on a change it
 * was never going to be allowed to make.
 */
async function requireEditableAgent(
  res: Response,
  userId: string,
  agentId: string
) {
  const agent = await requireAgent(res, userId, agentId);

  if (!agent) {
    return null;
  }

  if (agent.isOfficial) {
    res.status(403).json({
      error:
        "This is one of BuildGentic's own agents. Its page is designed by BuildGentic and cannot be edited — build your own agent to design a page for it.",
      code: "invalid_request",
    });
    return null;
  }

  return agent;
}

/* ---------------------------------------------------------
   GET /api/agents/:agentId/knowledge

   What state this agent's knowledge is in: which entries are
   searchable, how many pieces each became, which are still
   waiting, and which could not be indexed and why.

   Read-only, and cheap — two selects and a catalogue lookup, no
   provider call. The Builder polls it while an index run is in
   flight, so it must stay that way.

   Contains no chunk text and no vector. The learner already has
   the content; what they do not have, and what this exists to
   give them, is the answer to "is my agent actually searching
   this yet?".
   --------------------------------------------------------- */

agentsRouter.get("/:agentId/knowledge", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    res.json(await knowledgeStatus(user.id, agent));
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/:agentId/knowledge/index

   Chunks and embeds whatever needs it, and reports what is
   left.

   Idempotent by construction rather than by promise: an entry
   whose text has not moved and whose vectors already exist for
   this power source's model is skipped, so calling this after
   every save costs one hash comparison per entry and nothing
   else. That is what lets the Builder simply call it on every
   save rather than making a learner decide when to.

   `remaining` above zero means the chunk budget ran out and the
   caller should call again. It is not an error, and the entries
   already indexed are real.

   Never fails an agent. Every per-entry failure is recorded on
   that entry, its status is put back to `inline` so it keeps
   reaching the model the old way, and the response is a 200
   describing what happened.
   --------------------------------------------------------- */

agentsRouter.post("/:agentId/knowledge/index", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;

    if (
      body?.force !== undefined &&
      body.force !== null &&
      typeof body.force !== "boolean"
    ) {
      throw new AiRuntimeError(
        "invalid_request",
        "force must be a boolean when supplied."
      );
    }

    /* A client that hangs up mid-index should not leave a
       provider call running, exactly as on the chat routes. */
    const clientGone = new AbortController();

    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone.abort();
      }
    });

    res.json(
      await indexAgent(user.id, agent, {
        force: body?.force === true,
        signal: clientGone.signal,
      })
    );
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/agents/:agentId/memory

   Everything this agent remembers, and about whom.

   The owner's own memories in full, and their deployment's as
   counts plus content — because it is their agent, their
   storage and their bill, and because "clear everything this
   thing has learned about anyone" has to be an action a person
   can actually take. What they cannot see is WHO those callers
   are: the subject is a salted digest of whatever key the
   caller sent, so the screen says three different people used
   it rather than naming them.

   Read-only and cheap: one indexed select. No provider call and
   no vector, so the Memory section can be opened as often as
   somebody likes.
   --------------------------------------------------------- */

agentsRouter.get("/:agentId/memory", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const memories = await listForAgent(user.id, agent.id);

    res.json({
      /* Published so the panel's meter has a denominator that
         cannot drift from the server's. */
      limits: {
        maxMemories: memory.maxMemories,
        maxContentChars: memory.maxContentChars,
      },
      /* Whether the capability is actually on, off the stored
         row. The panel shows a very different thing when it is
         off, and reading it from the draft in the browser would
         make a saved agent and an edited one disagree. */
      enabled: agent.capabilities.includes("memory"),
      memories,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/:agentId/memory/:memoryId

   Forgets one thing.

   This route and the one below are the ONLY ways a memory is
   ever removed, and that is the security model stated as an
   API. Extraction can propose a memory and can correct one it
   was shown; it has no vocabulary for deletion, so no
   conversation, document, web page or model output can reach
   this. A person with a session can.

   Another agent's memory id answers 404, which is what
   somebody else's id should always look like.
   --------------------------------------------------------- */

agentsRouter.delete("/:agentId/memory/:memoryId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const removed = await deleteMemory(user.id, agent.id, req.params.memoryId);

    if (!removed) {
      res.status(404).json({
        error: "No such memory.",
        code: "invalid_request",
      });
      return;
    }

    res.json({ removed: true });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/:agentId/memory

   Forgets everything, or one side of it.

   `?scope=owner` clears what the agent learned about its owner
   while they were building it. `?scope=deployment` clears what
   it learned from callers of its endpoint, which is an action
   an owner may have to take on somebody else's behalf rather
   than their own. `all`, the default, is the button on the
   Memory screen.

   Nothing else changes: the capability stays on and the agent
   starts learning again from the next conversation. Turning it
   off is a separate decision made in Capabilities, and
   conflating the two would mean a learner who wanted a clean
   slate silently got a lobotomy.
   --------------------------------------------------------- */

agentsRouter.delete("/:agentId/memory", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const requested = req.query.scope;

    if (
      requested !== undefined &&
      requested !== "owner" &&
      requested !== "deployment" &&
      requested !== "all"
    ) {
      throw new AiRuntimeError(
        "invalid_request",
        'scope must be "owner", "deployment" or "all" when supplied.'
      );
    }

    const cleared = await clearMemories(
      user.id,
      agent.id,
      (requested as ClearTarget | undefined) ?? "all"
    );

    res.json({ cleared });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/agents/:agentId/deployment

   Everything the Deploy screen needs: whether this agent is
   live, at what address, whether a key can currently reach it,
   and what that endpoint has been doing.

   Never contains token material. `last4` is the whole of what a
   browser is told about a key, the same as for BYOK.
   --------------------------------------------------------- */

agentsRouter.get("/:agentId/deployment", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const deployment = await getDeployment(user.id, agent.id);

    res.json({
      /* Published so the screen can show the shape of the URL
         before there is one to show. */
      endpointBase: `${publicApiBaseUrl}/api/v1/agents`,
      limits: deploymentLimits,
      deployment: deployment ? describe(deployment) : null,
      key: deployment ? await getActiveKey(user.id, deployment.id) : null,
      usage: deployment ? await deploymentUsage(deployment.id) : null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/:agentId/deployment

   Deploys, and issues the first key in the same step.

   One action rather than two because a deployment with no key
   answers nothing, and leaving a learner on a screen holding a
   URL that refuses every request is a worse first impression
   than any amount of saved API surface is worth.

   `token` appears in this response and in the response to a
   rotation. Nowhere else, ever.
   --------------------------------------------------------- */

agentsRouter.post("/:agentId/deployment", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const existing = await getDeployment(user.id, agent.id);

    if (existing) {
      /*
       * Already deployed. Idempotent rather than an error: a
       * second tab, or a double click, should see the truth and
       * not a conflict. No token, because this did not mint one
       * and cannot recover the old one.
       */
      res.json({
        deployment: describe(existing),
        key: await getActiveKey(user.id, existing.id),
        token: null,
      });
      return;
    }

    /* Refuses a draft. */
    const deployment = await createDeployment(agent);
    const issued = await issueKey(user.id, deployment.id, parseLabel(req.body));

    res.status(201).json({
      deployment: describe(deployment),
      key: issued.key,
      token: issued.token,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/:agentId/deployment/key

   Rotation. Revokes whatever key exists and returns a new one,
   so the old credential stops working the instant the new one
   starts.
   --------------------------------------------------------- */

agentsRouter.post("/:agentId/deployment/key", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const deployment = await getDeployment(user.id, agent.id);

    if (!deployment) {
      res.status(404).json({
        error: "This agent is not deployed.",
        code: "invalid_request",
      });
      return;
    }

    const issued = await issueKey(user.id, deployment.id, parseLabel(req.body));

    res.status(201).json({ key: issued.key, token: issued.token });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/:agentId/deployment/key

   Revoke without replacing. The endpoint survives and refuses
   everything, which is what pausing a deployment is here.
   --------------------------------------------------------- */

agentsRouter.delete("/:agentId/deployment/key", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const deployment = await getDeployment(user.id, agent.id);

    if (!deployment) {
      res.status(404).json({
        error: "This agent is not deployed.",
        code: "invalid_request",
      });
      return;
    }

    res.json({ revoked: await revokeActiveKey(user.id, deployment.id) });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/:agentId/deployment

   Removes the deployment and its keys. The usage rows survive,
   carrying the id of a deployment that no longer exists — which
   is the point of a spending history.
   --------------------------------------------------------- */

agentsRouter.delete("/:agentId/deployment", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const removed = await deleteDeployment(user.id, agent.id);

    if (!removed) {
      res.status(404).json({
        error: "This agent is not deployed.",
        code: "invalid_request",
      });
      return;
    }

    res.json({ removed: true });
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   PUBLISHED PAGES (owner side)

   Creating a student's public page, renaming its address,
   saving its design, and taking it down. Session-authenticated,
   unlike routes/sites.ts, which answers the visitors.

   The two files never share a handler, which is deliberate: one
   of them is allowed to know who the owner is and the other is
   structurally unable to. Merging them would put an
   `if (isOwner)` between a stranger and somebody's account.
========================================================= */

/*
 * The address a student shares.
 *
 * Built from the configured site origin rather than from the
 * request, for the reason `publicApiBaseUrl` exists: the server
 * cannot infer the address somebody else's browser would use
 * from a request it has not received yet.
 */
function siteUrlFor(slug: string): string {
  return `${publicSiteBaseUrl}/${slug}`;
}

function describeSite(site: SiteSummary) {
  return {
    id: site.id,
    slug: site.slug,
    url: siteUrlFor(site.slug),
    config: site.config,
    published: site.published,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

/* ---------------------------------------------------------
   GET /api/agents/:agentId/site

   Whether this agent has a page, what is on it, and what it
   has been doing.

   Answers usefully when there is no page yet: `suggestedSlug`
   is the address the student would get if they published now,
   so the Customise screen can show them their URL before they
   commit to it rather than after.
   --------------------------------------------------------- */

agentsRouter.get("/:agentId/site", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const site = await getSiteForAgent(user.id, agent.id);
    const deployment = await getDeployment(user.id, agent.id);

    res.json({
      /* Published so the screen can show the shape of the URL
         before there is one. */
      siteBase: publicSiteBaseUrl,
      limits: siteLimits,
      /*
       * A page needs a deployment behind it, and this is how
       * the screen knows to say so rather than offering a
       * Publish button that would fail.
       */
      deployed: Boolean(deployment),
      site: site ? describeSite(site) : null,
      suggestedSlug: site ? site.slug : await suggestSlug(agent.name),
      usage: site ? await siteUsage(site.deploymentId) : null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/agents/:agentId/site/slug?value=…

   Whether an address is free, for the editor's live check.

   Behind the session gate even though it reads nothing
   sensitive, because an unauthenticated version of this is a
   way to enumerate which addresses are taken — a directory of
   every student's page, one guess at a time. It answers only
   yes or no, and never who holds a taken one.
   --------------------------------------------------------- */

agentsRouter.get("/:agentId/site/slug", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const raw = typeof req.query.value === "string" ? req.query.value : "";
    const slug = canonicalizeSlug(raw);
    const shape = checkSlug(slug);

    if (!shape.ok) {
      res.json({ slug, available: false, reason: shape.message });
      return;
    }

    /* An existing page renaming to the address it already holds
       is not a collision with itself. */
    const site = await getSiteForAgent(user.id, agent.id);
    const available = await isSlugAvailable(slug, site?.id);

    res.json({
      slug,
      available,
      ...(available ? {} : { reason: "That address is already taken." }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/:agentId/site

   Publishes a page.

   Refuses an agent that is not deployed, and the gate is here
   rather than only in the UI because it is an invariant about
   the row: a page is a door onto a deployment, so there must
   never be one without a deployment behind it. The foreign key
   says the same thing; this says it with a sentence a student
   can act on.
   --------------------------------------------------------- */

agentsRouter.post("/:agentId/site", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const existing = await getSiteForAgent(user.id, agent.id);

    /* Two clicks on Publish, or two tabs. The second should see
       the page the first made. */
    if (existing) {
      res.json({ site: describeSite(existing) });
      return;
    }

    /*
     * One of BuildGentic's own agents that does not get a page.
     *
     * The check is here rather than in the UI alone because
     * "the button is hidden" is not the same guarantee as "the
     * route refuses", and this is the route.
     *
     * Only Email Agent sets it today, and the reason is in the
     * catalogue entry: every email capability is hard-off on
     * the published door, so a page for it would be an email
     * assistant that cannot see any email, published under
     * BuildGentic's name, describing what it does while being
     * unable to do it.
     */
    if (agent.isOfficial && !flagshipPublishable(agent.flagshipId)) {
      res.status(400).json({
        error:
          "This agent does not get a public page. It works with your own email account, and a page anybody can open must never reach that — so there is nothing a page could honestly offer a visitor.",
        code: "invalid_request",
      });
      return;
    }

    const deployment = await getDeployment(user.id, agent.id);

    if (!deployment) {
      res.status(400).json({
        error:
          "Deploy this agent before giving it a page. A page needs a live agent behind it.",
        code: "invalid_request",
      });
      return;
    }

    const body = (req.body ?? {}) as { slug?: unknown; config?: unknown };

    /*
     * The config goes through the same `parseSiteConfig` the
     * browser's form obeys — the shared module, not a copy. A
     * page the editor accepts cannot be a page the server
     * refuses, and vice versa.
     */
    /*
     * `starterConfig`, not `defaultSiteConfig`.
     *
     * The two differ by a page a student would actually want:
     * the starter has suggested questions and a couple of
     * sections, the default has a headline and one paragraph.
     * That gap did not matter while publishing only happened
     * from the Customise screen — which composes its own
     * starter — but the Deploy screen now publishes in one
     * click, and that path had been quietly handing out the
     * barer of the two.
     *
     * `defaultSiteConfig` keeps its job as the fallback inside
     * `readSiteConfig`, where the only requirement is that a
     * page renders at all.
     */
    const config = parseSiteConfig(
      body.config ??
        starterConfig({
          agentName: agent.name,
          description: agent.description ?? "",
          template: "assistant",
        })
    );

    const slug =
      typeof body.slug === "string" && body.slug.trim()
        ? body.slug
        : await suggestSlug(agent.name);

    const site = await createSite({
      userId: user.id,
      agentId: agent.id,
      deploymentId: deployment.id,
      slug,
      config,
    });

    res.status(201).json({ site: describeSite(site) });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   PATCH /api/agents/:agentId/site

   Saves a design change, an address change, or both.

   There is no draft/live pair: an edit reaches the published
   page immediately, which is what the feature asks for and
   which removes the second question ("is this the version
   people see?") from every screen.
   --------------------------------------------------------- */

agentsRouter.patch("/:agentId/site", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireEditableAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const site = await getSiteForAgent(user.id, agent.id);

    if (!site) {
      res.status(404).json({
        error: "This agent does not have a page yet.",
        code: "invalid_request",
      });
      return;
    }

    const body = (req.body ?? {}) as {
      slug?: unknown;
      config?: unknown;
      published?: unknown;
    };

    const updated = await updateSite({
      userId: user.id,
      siteId: site.id,
      ...(body.config !== undefined
        ? { config: parseSiteConfig(body.config) }
        : {}),
      ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
      ...(typeof body.published === "boolean"
        ? { published: body.published }
        : {}),
    });

    res.json({ site: describeSite(updated) });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/:agentId/site

   Takes the page down and gives up the address.

   Distinct from `published: false`, which keeps both. This is
   the destructive one, and the screen asks before calling it —
   an address somebody has shared is not recoverable once
   another student claims it.
   --------------------------------------------------------- */

agentsRouter.delete("/:agentId/site", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const site = await getSiteForAgent(user.id, agent.id);

    if (!site) {
      res.json({ removed: false });
      return;
    }

    const removed = await deleteSite(user.id, site.id);

    res.json({ removed });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/:agentId/site/edit

   Phase 2. A sentence becomes a field change.

   Deliberately does NOT save. It returns a proposed document
   and a list of what changed, and the editor shows both before
   the student decides — because a model that misreads "make the
   heading shorter" as "rewrite the heading" should cost a click
   to undo rather than a published page nobody reviewed.

   The request body carries the config being edited rather than
   the server reading the stored row, and that is deliberate
   too: a student edits a draft that may be several unsaved
   changes ahead of what is published, and planning against the
   stored version would return operations addressed to sections
   that have since moved.
   --------------------------------------------------------- */

agentsRouter.post("/:agentId/site/edit", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireEditableAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const body = (req.body ?? {}) as { config?: unknown; request?: unknown };

    if (typeof body.request !== "string") {
      res.status(400).json({
        error: "Say what you would like to change.",
        code: "invalid_request",
      });
      return;
    }

    /* Through the same validator a save goes through, so a
       malformed draft is refused before it reaches the model
       rather than after. */
    const config = parseSiteConfig(body.config);

    /* A student who navigates away mid-request becomes a
       cancelled provider call rather than tokens nobody reads. */
    const clientGone = new AbortController();

    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone.abort();
      }
    });

    const result = await planSiteEdit({
      userId: user.id,
      agentId: agent.id,
      config,
      request: body.request,
      signal: clientGone.signal,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof SiteConfigError) {
      res.status(400).json({ error: error.message, code: "invalid_request" });
      return;
    }

    if (error instanceof EditPlanError) {
      /* The model answered, but not in a shape this can use.
         A 502 rather than a 500: nothing on our side is
         broken, and retrying is a reasonable thing to do. */
      res.status(502).json({ error: error.message, code: "unusable_answer" });
      return;
    }

    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   CONNECTIONS

   The credentials an agent may present when it calls an API.

   Three routes and no update. A connection is small enough
   that changing one is deleting it and making another, and
   leaving out the update path removes the question this
   feature would otherwise have to answer on every save: what
   does an empty secret field mean — "leave the key alone" or
   "there is no key now"? Two reasonable readings, one of
   which silently strips a credential. There is no partial
   write here to get that wrong.

   Every route goes through requireEditableAgent. A purchased
   flagship's configuration is BuildGentic's, and a learner
   attaching their own credentials to one would be editing an
   agent whose instructions they cannot even read.
   --------------------------------------------------------- */

agentsRouter.get("/:agentId/connections", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const connections = await listConnections(user.id, agent.id);

    res.json({
      connections,
      /*
       * Whether this server can store a secret at all.
       *
       * Reported rather than assumed, because the failure it
       * describes is invisible from the browser: with
       * NEUROLINK_SECRET_KEY unset, everything on the
       * connection form works right up to the save. Saying so
       * up front lets the UI disable the authenticated options
       * and explain why, which is a configuration problem
       * shown to the one person who can fix it.
       */
      secretsAvailable: canSeal(),
      methods: METHODS,
    });
  } catch (error) {
    sendError(res, error);
  }
});

agentsRouter.post("/:agentId/connections", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireEditableAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    const raw = (req.body ?? {}) as Record<string, unknown>;

    /*
     * Shape only. Everything that needs judgement — the slug
     * rules, the address rules, whether a key is required for
     * the chosen auth kind — belongs to ConnectionStore.validate,
     * which is also what the runtime's assumptions rest on.
     * Splitting that across two files is how the two drift.
     */
    const connection = await createConnection(user.id, agent.id, {
      slug: typeof raw.slug === "string" ? raw.slug : "",
      label: typeof raw.label === "string" ? raw.label : "",
      description: typeof raw.description === "string" ? raw.description : null,
      baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
      authKind: (typeof raw.authKind === "string"
        ? raw.authKind
        : "none") as ConnectionAuth,
      authName: typeof raw.authName === "string" ? raw.authName : null,
      allowedMethods: Array.isArray(raw.allowedMethods)
        ? raw.allowedMethods.filter(
            (method): method is string => typeof method === "string"
          )
        : ["GET"],
      secret: typeof raw.secret === "string" ? raw.secret : null,
    });

    /*
     * The stored row, which carries no secret — `COLUMNS` in
     * ConnectionStore does not select it. The plaintext the
     * caller just sent is not echoed back either: it reached
     * this process once, was sealed, and has no reason to make
     * a second trip across the network.
     */
    res.status(201).json({ connection });
  } catch (error) {
    sendError(res, error);
  }
});

agentsRouter.delete("/:agentId/connections/:connectionId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await requireEditableAgent(res, user.id, req.params.agentId);

    if (!agent) {
      return;
    }

    await deleteConnection(user.id, agent.id, req.params.connectionId);

    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});
