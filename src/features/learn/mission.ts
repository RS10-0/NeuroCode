import { supabase } from "../../lib/supabase";
import type { LessonMission } from "../../core/curriculum/Lesson";

/*
 * Where a mission actually sends somebody.
 *
 * Two of the three targets are fixed routes. The third is not:
 * "publish your page" has to land on a specific agent, because
 * the publishing flow is addressed as /agents/:agentId/site and
 * has no picker of its own — the deep link IS the selection. So
 * the resolver goes and finds the learner's most recent
 * deployment and points at that.
 *
 * A learner with nothing deployed is a normal case, not an
 * error. They finished the course on the strength of the
 * work rather than by having a deployment ready, so the mission
 * degrades to the agents list with different copy instead of
 * dead-ending on a route that would 404 them.
 */

export interface ResolvedMission {
  href: string;

  /* Overrides the authored label when the fallback is taken. */
  label: string;

  /* Set when we could not send them where the mission meant. */
  note?: string;
}

interface DeploymentRow {
  agent_id: string;
}

/*
 * The most recently deployed agent, or null.
 *
 * Read straight from the browser: agent_deployments carries an
 * owner-read policy and a (user_id, created_at desc) index, and
 * there is no list endpoint on the API that would answer this.
 * Null covers signed-out, nothing-deployed and query-failed
 * alike, because all three lead to the same fallback.
 */
async function latestDeployedAgentId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const { data, error } = await supabase
    .from("agent_deployments")
    .select("agent_id")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    return null;
  }

  const rows = (data ?? []) as DeploymentRow[];

  return rows[0]?.agent_id ?? null;
}

export async function resolveMission(
  mission: LessonMission
): Promise<ResolvedMission> {
  if (mission.target === "lab") {
    return { href: "/lab", label: mission.label };
  }

  if (mission.target === "agent_builder") {
    return { href: "/agents/builder", label: mission.label };
  }

  const agentId = await latestDeployedAgentId();

  if (agentId) {
    return { href: `/agents/${agentId}/site`, label: mission.label };
  }

  return {
    href: "/agents",
    label: "Deploy an agent first",
    note: "A page needs a deployed agent behind it. Deploy one, then come back to this and publish.",
  };
}
