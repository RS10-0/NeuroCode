import { supabase } from "../../lib/supabase";
import { AiRuntimeError } from "../../ai/errors";

/*
 * The feed, and the email outbox, in one table.
 *
 * One table rather than two because they are one thing seen
 * twice: every notification is a feed entry, and some of them
 * are also an email. Splitting them would mean a feed row and an
 * outbox row having to agree about what happened, which is a
 * consistency problem nobody needs and this feature would notice
 * — the whole point of a notification here is that it is the
 * only way somebody finds out.
 *
 * `email_state` is what makes email OPTIONAL rather than
 * required. With no provider key configured every row is written
 * `none`, the feed works completely, and a fresh clone still
 * runs — the same property the provider cascade's mock fallback
 * protects.
 */

export type NotificationKind =
  | "run_output"
  | "run_failed"
  | "schedule_disabled"
  | "limit_advisory";

export type EmailState = "none" | "pending" | "sent" | "failed";

export interface NotificationRecord {
  id: string;
  userId: string;
  kind: NotificationKind;
  scheduleId: string | null;
  /*
   * Which agent's schedule page this notice belongs to.
   *
   * Joined rather than stored, because it is already on the
   * schedule row and a second copy could disagree with it. It
   * exists so the feed is clickable: a notice a learner cannot
   * act on from where they read it is a notice they have to go
   * hunting for, and the one that matters most — "your schedule
   * was switched off" — is exactly the one they should be able
   * to reach in a click.
   *
   * Null when the schedule has since been deleted.
   */
  agentId: string | null;
  runId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  emailState: EmailState;
  createdAt: string;
}

const COLUMNS =
  "id, user_id, kind, schedule_id, run_id, title, body, read_at, " +
  "email_state, created_at, agent_schedules(agent_id)";

/*
 * The embedded schedule's agent id.
 *
 * PostgREST returns an embedded one-to-one as an object, and an
 * older client or a changed relationship can return it as a
 * single-element array. Both are read, because getting this
 * wrong makes every notification un-clickable and nothing else
 * would fail loudly enough to notice.
 */
function readAgentId(embedded: unknown): string | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;

  if (row && typeof row === "object" && "agent_id" in row) {
    const value = (row as { agent_id?: unknown }).agent_id;

    return typeof value === "string" ? value : null;
  }

  return null;
}

function toNotification(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as NotificationKind,
    scheduleId: (row.schedule_id as string | null) ?? null,
    agentId: readAgentId(row.agent_schedules),
    runId: (row.run_id as string | null) ?? null,
    title: String(row.title),
    body: String(row.body),
    readAt: (row.read_at as string | null) ?? null,
    emailState: (row.email_state as EmailState) ?? "none",
    createdAt: String(row.created_at),
  };
}

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  scheduleId?: string | null;
  runId?: string | null;
  title: string;
  body: string;
  /* Whether this one should also be emailed. The caller decides,
     because the rules differ per kind — see notify.ts. */
  email: boolean;
}

/*
 * Writes one notification.
 *
 * Never throws. It is called from the tick, after a run has
 * already settled, and a notification that could not be written
 * must not be able to turn a completed run into an error — the
 * run happened, the row records it, and the feed is the softer
 * half of this.
 *
 * Returns the id so the caller can log it, or null when nothing
 * was written. A null is not always a failure: the unique index
 * on (schedule_id, kind) for unread disable notices means a
 * second disable notice for the same schedule is refused by the
 * database, which is the reconciliation working rather than
 * breaking.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_notifications")
    .insert({
      user_id: input.userId,
      kind: input.kind,
      schedule_id: input.scheduleId ?? null,
      run_id: input.runId ?? null,
      title: input.title,
      body: input.body,
      email_state: input.email ? "pending" : "none",
    })
    .select("id")
    .single();

  if (error) {
    /* 23505 is a unique violation: the disable notice already
       exists. Expected, and not worth a line in the log. */
    if (error.code !== "23505") {
      console.error(
        `[schedule] could not write a ${input.kind} notification: ${error.message}`
      );
    }

    return null;
  }

  return String(data.id);
}

/* =========================================================
   THE FEED
========================================================= */

export async function listNotifications(
  userId: string,
  limit = 30
): Promise<NotificationRecord[]> {
  const { data, error } = await supabase
    .from("agent_notifications")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));

  if (error) {
    console.error(`[schedule] could not read the feed: ${error.message}`);
    throw new AiRuntimeError("internal_error", "Sorry — could not read your notifications.");
  }

  return (data ?? []).map((row) =>
    toNotification(row as unknown as Record<string, unknown>)
  );
}

export async function unreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("agent_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    console.error(`[schedule] could not count unread: ${error.message}`);
    return 0;
  }

  return count ?? 0;
}

/*
 * Marks one notification read, or all of them.
 *
 * The `user_id` predicate is the whole authorisation: the
 * service-role client bypasses RLS, so it is the only thing
 * stopping a forged id from clearing somebody else's badge.
 */
export async function markRead(
  userId: string,
  notificationId?: string
): Promise<void> {
  let query = supabase
    .from("agent_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  if (notificationId) {
    query = query.eq("id", notificationId);
  }

  const { error } = await query;

  if (error) {
    console.error(`[schedule] could not mark read: ${error.message}`);
    throw new AiRuntimeError("internal_error", "Sorry — could not update that.");
  }
}

/* =========================================================
   THE OUTBOX

   Drained by the same tick that runs schedules, never by the
   run itself. An email provider having a bad minute must not be
   able to turn a succeeded run into a failed one.
========================================================= */

export interface PendingEmail {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  attempts: number;
  /*
   * The run this notice is about, when there is one.
   *
   * Carried so the drain can find that run's generated files
   * and attach them. This column already existed — it is what
   * links a notification to the run card the link opens — and
   * reusing it is why the attachment path needs no new column
   * on this table: a run that produced two documents attaches
   * two, and a notice about no run attaches nothing.
   */
  runId: string | null;
}

export async function pendingEmails(limit = 10): Promise<PendingEmail[]> {
  const { data, error } = await supabase
    .from("agent_notifications")
    .select("id, user_id, kind, title, body, email_attempts, run_id")
    .eq("email_state", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[schedule] could not read the outbox: ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as NotificationKind,
    title: String(row.title),
    body: String(row.body),
    attempts: Number(row.email_attempts ?? 0),
    runId: row.run_id ? String(row.run_id) : null,
  }));
}

/*
 * Records the attempt.
 *
 * A failure is retried until `maxAttempts`, then parked at
 * 'failed' rather than retried for ever — an address that has
 * bounced three times is not going to start working, and a row
 * that retries on every tick is a row that fills the log.
 *
 * The notification itself is untouched either way: it is still
 * in the feed, still unread, still the record of what happened.
 * Email is the second copy, never the only one.
 */
export async function recordEmailAttempt(
  id: string,
  outcome: { ok: true } | { ok: false; error: string; attempts: number },
  maxAttempts = 3
): Promise<void> {
  const patch = outcome.ok
    ? {
        email_state: "sent" as const,
        email_sent_at: new Date().toISOString(),
        email_error: null,
      }
    : {
        email_state: (outcome.attempts + 1 >= maxAttempts
          ? "failed"
          : "pending") as EmailState,
        email_attempts: outcome.attempts + 1,
        email_error: outcome.error.slice(0, 500),
      };

  const { error } = await supabase
    .from("agent_notifications")
    .update(patch)
    .eq("id", id);

  if (error) {
    console.error(
      `[schedule] could not record an email attempt for ${id}: ${error.message}`
    );
  }
}

/*
 * The owner's email address.
 *
 * Read from auth.users with the service role, and read HERE
 * rather than accepted from anywhere. There is no address field
 * in the schedule UI and no column on the schedule table,
 * because a schedule that could name its own recipient would not
 * be "your agent tells you what it found" — it would be a mail
 * sender driven by a model, on a timer, spending somebody else's
 * reputation. That is a thing students would discover within a
 * week.
 */
export async function ownerEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);

  if (error || !data?.user?.email) {
    if (error) {
      console.error(
        `[schedule] could not read the address for ${userId}: ${error.message}`
      );
    }

    return null;
  }

  return data.user.email;
}
