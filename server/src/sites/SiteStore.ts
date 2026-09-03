import { supabase } from "../lib/supabase";
import { AiRuntimeError } from "../ai/errors";
import { getAgentById, type AgentRecord } from "../agents/AgentStore";
import {
  canonicalizeSlug,
  checkSlug,
  fallbackSlug,
  slugCandidates,
} from "../../../src/features/sites/slug";
import {
  parseSiteConfig,
  type SiteConfig,
} from "../../../src/features/sites/schema";

/*
 * Published pages, and the addresses they hold.
 *
 * Two rules run through this file, and between them they are
 * most of what it does.
 *
 * The first: ownership is an explicit predicate, never a
 * policy. The service-role client bypasses RLS, so
 * `.eq("user_id", userId)` on every owner-facing query is the
 * only thing standing between one student's page and another's.
 * The public path has no user id to offer and does not pretend
 * to: it resolves a site from a slug and inherits the owner
 * from the row, exactly as `authenticateDeployment` inherits it
 * from a verified key.
 *
 * The second: an address is claimed atomically or not at all.
 * Checking that a slug is free and then inserting it is two
 * statements with a gap between them, and the gap is where two
 * students both get told "studybuddy is yours". The unique
 * index is what actually decides; everything here is arranged
 * so that losing that race is a retry rather than an error
 * somebody sees.
 *
 * The slug rules and the config schema are imported from
 * ../../../src/features/sites — the same modules the browser
 * imports, the way progress/xpPlan.ts imports the curriculum.
 * That is deliberate and load-bearing: the validator standing
 * in front of this table is literally the function the editor's
 * form obeys, so a page the form accepts cannot be a page the
 * server refuses.
 */

const SITE_COLUMNS =
  "id, deployment_id, agent_id, user_id, slug, config, published, created_at, updated_at";

export interface SiteSummary {
  id: string;
  deploymentId: string;
  agentId: string;
  slug: string;
  config: SiteConfig;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SiteRow {
  id: string;
  deployment_id: string;
  agent_id: string;
  user_id: string;
  slug: string;
  config: unknown;
  published: boolean;
  created_at: string;
  updated_at: string;
}

function fail(message: string, detail: string): never {
  throw new AiRuntimeError("internal_error", message, {
    internalDetail: detail,
  });
}

/*
 * A stored row becomes a summary.
 *
 * `config` is re-parsed on the way out rather than trusted,
 * which is not paranoia about our own writes: a row can have
 * been written by an older build of this file, or edited by
 * hand in the SQL console. Parsing here means every consumer —
 * the editor, the public renderer, the Phase 2 patcher — gets
 * a document that satisfies the current schema, and none of
 * them needs its own defence.
 */
function toSite(row: SiteRow): SiteSummary {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    agentId: row.agent_id,
    slug: row.slug,
    config: parseSiteConfig(row.config),
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* =========================================================
   OWNER-FACING READS
========================================================= */

export async function getSiteForAgent(
  userId: string,
  agentId: string
): Promise<SiteSummary | null> {
  const { data, error } = await supabase
    .from("agent_sites")
    .select(SITE_COLUMNS)
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    fail("Unable to load this agent's page.", `select failed: ${error.message}`);
  }

  return data ? toSite(data as SiteRow) : null;
}

/*
 * Whether an address is available, for the editor's live check.
 *
 * Answers only yes or no. It deliberately does not say who
 * holds a taken slug, because that would turn a validation
 * endpoint into a directory of every student's page.
 */
export async function isSlugAvailable(
  slug: string,
  exceptSiteId?: string
): Promise<boolean> {
  if (!checkSlug(slug).ok) {
    return false;
  }

  let query = supabase.from("agent_sites").select("id").eq("slug", slug);

  /* Renaming a page to the address it already has is not a
     collision with itself. */
  if (exceptSiteId) {
    query = query.neq("id", exceptSiteId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    fail("Unable to check that address.", `select failed: ${error.message}`);
  }

  return !data;
}

/*
 * The first address from a ladder that nobody holds.
 *
 * One round trip rather than one per candidate: the ladder is
 * generated up front and `in` asks about all of it at once.
 * The answer is a suggestion and not a reservation — it can be
 * taken between this call and the insert, which is why
 * `createSite` handles the unique violation rather than
 * assuming this held.
 */
export async function suggestSlug(base: string): Promise<string> {
  const candidates = slugCandidates(base);

  const { data, error } = await supabase
    .from("agent_sites")
    .select("slug")
    .in("slug", candidates);

  if (error) {
    fail("Unable to find a free address.", `select failed: ${error.message}`);
  }

  const taken = new Set((data ?? []).map((row) => (row as { slug: string }).slug));
  const free = candidates.find((candidate) => !taken.has(candidate));

  /* Every rung of a twelve-rung ladder taken is possible and
     not worth a second round trip to improve on. */
  return free ?? fallbackSlug(base);
}

/* =========================================================
   OWNER-FACING WRITES
========================================================= */

export interface CreateSiteInput {
  userId: string;
  agentId: string;
  deploymentId: string;
  slug: string;
  config: SiteConfig;
}

/*
 * Claim an address and publish a page.
 *
 * The retry loop is the whole substance of this function. A
 * slug that `suggestSlug` reported free can be claimed by
 * somebody else before this insert lands; the database says so
 * with 23505, and the right response is to try the next free
 * address rather than to hand the student an error about a
 * constraint they have never heard of. The second attempt uses
 * a random suffix rather than walking the same ladder, because
 * walking the same ladder would propose the same address and
 * lose the same race.
 *
 * Three attempts, because a fourth would mean something other
 * than contention is wrong and a loop that keeps trying would
 * hide it.
 */
export async function createSite(
  input: CreateSiteInput
): Promise<SiteSummary> {
  let slug = canonicalizeSlug(input.slug);

  const check = checkSlug(slug);

  if (!check.ok) {
    throw new AiRuntimeError("invalid_request", check.message ?? "That address cannot be used.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from("agent_sites")
      .insert({
        deployment_id: input.deploymentId,
        agent_id: input.agentId,
        user_id: input.userId,
        slug,
        config: input.config,
        published: true,
      })
      .select(SITE_COLUMNS)
      .single();

    if (!error) {
      return toSite(data as SiteRow);
    }

    if (error.code !== "23505") {
      fail("Unable to publish this page.", `insert failed: ${error.message}`);
    }

    /*
     * Two different unique constraints answer with the same
     * code, and they mean opposite things.
     *
     * unique (deployment_id) is two clicks on Publish, or two
     * tabs: the page already exists and the second click should
     * see it rather than an error. unique (slug) is the race
     * above and should retry with a different address.
     */
    const existing = await getSiteForAgent(input.userId, input.agentId);

    if (existing) {
      return existing;
    }

    slug = fallbackSlug(input.slug);
  }

  fail(
    "Unable to find a free address for this page.",
    `slug contention on ${input.slug} after 3 attempts`
  );
}

export interface UpdateSiteInput {
  userId: string;
  siteId: string;
  config?: SiteConfig;
  slug?: string;
  published?: boolean;
}

/*
 * An edit reaches the live page immediately.
 *
 * There is no draft column and no publish step beyond the
 * `published` flag, which is deliberate: the brief asks that
 * changes update the live page at once, and a draft/live pair
 * would be a second document to keep in step and a second
 * question ("is this the version people see?") on every screen.
 */
export async function updateSite(
  input: UpdateSiteInput
): Promise<SiteSummary> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.config !== undefined) {
    /* Re-parsed even though the route already did. This is the
       last point before the row, and it costs nothing. */
    patch.config = parseSiteConfig(input.config);
  }

  if (input.published !== undefined) {
    patch.published = input.published;
  }

  if (input.slug !== undefined) {
    const slug = canonicalizeSlug(input.slug);
    const check = checkSlug(slug);

    if (!check.ok) {
      throw new AiRuntimeError(
        "invalid_request",
        check.message ?? "That address cannot be used."
      );
    }

    patch.slug = slug;
  }

  const { data, error } = await supabase
    .from("agent_sites")
    .update(patch)
    .eq("id", input.siteId)
    .eq("user_id", input.userId)
    .select(SITE_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      /*
       * Only the slug index can produce this on an update —
       * deployment_id is not in the patch — so the message can
       * be specific without guessing.
       */
      throw new AiRuntimeError(
        "invalid_request",
        "Somebody else just took that address. Try another."
      );
    }

    fail("Unable to save this page.", `update failed: ${error.message}`);
  }

  if (!data) {
    /* No row matched BOTH the id and the owner. Whether the
       page does not exist or belongs to somebody else is not a
       distinction this caller is entitled to. */
    throw new AiRuntimeError("site_not_found", "That page could not be found.");
  }

  return toSite(data as SiteRow);
}

export async function deleteSite(
  userId: string,
  siteId: string
): Promise<boolean> {
  const { error, count } = await supabase
    .from("agent_sites")
    .delete({ count: "exact" })
    .eq("id", siteId)
    .eq("user_id", userId);

  if (error) {
    fail("Unable to take this page down.", `delete failed: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

/* =========================================================
   THE PUBLIC PATH

   The only function here that answers a request carrying no
   credential of any kind.
========================================================= */

export interface ResolvedSite {
  site: SiteSummary;
  agent: AgentRecord;
  /* Whose quota, whose keys, whose bill. Taken off the row,
     never off the request. */
  ownerId: string;
  /*
   * Whether the chat will actually answer.
   *
   * A page whose agent has been demoted to a draft still
   * renders — the student's writing is still theirs and a
   * shared link should not 404 because they are mid-edit — but
   * the composer is drawn as unavailable rather than accepting
   * a question it cannot answer.
   */
  chatLive: boolean;
}

/*
 * Resolve an address.
 *
 * Null for every way a page can be absent: no such slug,
 * unpublished, or the deployment behind it removed. The caller
 * answers 404 for all three, which is right — from outside,
 * "never existed", "taken down" and "paused" are the same
 * thing, and the difference is the owner's business.
 */
export async function resolveSite(
  rawSlug: string
): Promise<ResolvedSite | null> {
  const slug = canonicalizeSlug(rawSlug);

  if (!checkSlug(slug).ok) {
    /* Cannot be in the table — the CHECK constraint and the
       reserved list both stand in the way — so this is a 404
       without a query. */
    return null;
  }

  const { data, error } = await supabase
    .from("agent_sites")
    .select(SITE_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    fail("Unable to open that page.", `select failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const row = data as SiteRow;

  if (!row.published) {
    return null;
  }

  /*
   * The deployment is checked rather than assumed.
   *
   * The foreign key cascades, so a removed deployment should
   * already have taken this row with it. Reading it anyway
   * costs one indexed lookup and closes the window in which a
   * page outlives the endpoint it is a page for — which is the
   * one failure here that would leave a public URL answering
   * after its owner pulled the plug.
   */
  const { data: deployment, error: deploymentError } = await supabase
    .from("agent_deployments")
    .select("id")
    .eq("id", row.deployment_id)
    .maybeSingle();

  if (deploymentError) {
    fail(
      "Unable to open that page.",
      `deployment select failed: ${deploymentError.message}`
    );
  }

  if (!deployment) {
    return null;
  }

  const agent = await getAgentById(row.agent_id);

  if (!agent || agent.userId !== row.user_id) {
    return null;
  }

  return {
    site: toSite(row),
    agent,
    ownerId: row.user_id,
    /*
     * Three conditions, and all three have to hold.
     *
     * The student's own switch, the agent still being marked
     * ready by its owner, and the agent still being able to
     * chat at all. The middle one is the same gate
     * `authenticateDeployment` applies: `ready` is the owner
     * saying this is fit to be used, and demoting it withdraws
     * that from every door at once.
     */
    chatLive:
      toSite(row).config.chat.enabled &&
      agent.status === "ready" &&
      agent.capabilities.includes("chat"),
  };
}

/* =========================================================
   USAGE
========================================================= */

export interface SiteUsage {
  visitsDay: number;
  requestsDay: number;
  requestsTotal: number;
  tokensDay: number;
  lastVisitAt: string | null;
}

export async function siteUsage(deploymentId: string): Promise<SiteUsage> {
  const { data, error } = await supabase.rpc("agent_site_usage", {
    p_deployment_id: deploymentId,
  });

  if (error) {
    fail(
      "Unable to read this page's activity.",
      `agent_site_usage failed: ${error.message}`
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        visits_day: number;
        requests_day: number;
        requests_total: number;
        tokens_day: number;
        last_visit_at: string | null;
      }
    | undefined;

  return {
    visitsDay: Number(row?.visits_day ?? 0),
    requestsDay: Number(row?.requests_day ?? 0),
    requestsTotal: Number(row?.requests_total ?? 0),
    tokensDay: Number(row?.tokens_day ?? 0),
    lastVisitAt: row?.last_visit_at ?? null,
  };
}
