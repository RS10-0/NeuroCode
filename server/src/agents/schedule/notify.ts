import {
  actions as actionConfig,
  mail,
  mailEnabled,
  publicSiteBaseUrl,
} from "../../ai/config";

import { sendMail, type MailAttachment } from "./mail";
import {
  createNotification,
  ownerEmail,
  pendingEmails,
  recordEmailAttempt,
  type NotificationKind,
} from "./NotificationStore";
import { disabledWithoutNotice, type DisabledReason } from "./ScheduleStore";
import type { ScheduledRunReport } from "./runner";

/*
 * Who gets told what, and in which of the two places.
 *
 * The rules matter more than they look, because the failure mode
 * of a notification system is not silence — it is noise. A
 * student who gets four emails about one outage learns to filter
 * the sender, and the fifth email, the one that says their agent
 * has been switched off, goes into the same folder unread.
 *
 * So:
 *
 *   A MANUAL RUN NOTIFIES NOTHING. Somebody pressed a button and
 *   is looking at the result. Telling them what they can see is
 *   how an inbox becomes worthless.
 *
 *   A FAILURE EMAILS ONCE PER STREAK. Three failures in a row is
 *   one problem. After the first, the next email about that
 *   schedule is the disable notice — which is the one that
 *   actually requires them to do something.
 *
 *   A DISABLE ALWAYS EMAILS, whatever the schedule's settings
 *   say. It is the only event here that leaves the product in a
 *   state the owner has to act on, and a preference that could
 *   suppress it would be a preference for not being told your
 *   automation has stopped.
 */

/* =========================================================
   AFTER A RUN
========================================================= */

export interface NotifyInput {
  report: ScheduledRunReport;
  agentId: string;
  userId: string;
  scheduleId: string;
  scheduleLabel: string;
}

export async function notifyRunFinished(input: NotifyInput): Promise<void> {
  const { report } = input;
  const settled = report.settled;

  /*
   * No settle means the reaper got there first: this run was
   * already recorded as abandoned, its counter has already
   * moved, and somebody has already been told whatever there was
   * to tell. Notifying now would double it.
   */
  if (!settled) {
    return;
  }

  const link = scheduleLink(input.agentId);

  /* ---- the disable, first and unconditionally ---- */

  if (settled.disabled) {
    await createNotification({
      userId: input.userId,
      kind: "schedule_disabled",
      scheduleId: input.scheduleId,
      runId: report.runId,
      title:
        settled.disabledReason === "expired"
          ? `“${settled.scheduleLabel}” has finished its run`
          : `“${settled.scheduleLabel}” was switched off`,
      body: disabledBody(settled.disabledReason, report, link),
      email: true,
    });

    /* The disable subsumes the failure that caused it. Two
       notices about one event is the noise this file exists to
       prevent. */
    return;
  }

  /* ---- an ordinary outcome ---- */

  switch (report.outcome) {
    case "succeeded":
    case "limit_reached": {
      if (!settled.notifyOnSuccess) {
        break;
      }

      await createNotification({
        userId: input.userId,
        kind: "run_output",
        scheduleId: input.scheduleId,
        runId: report.runId,
        title: `“${settled.scheduleLabel}” ran`,
        body: outputBody(report, link),
        email: settled.notifyEmail,
      });

      break;
    }

    case "confabulated":
    case "infra_failure": {
      /*
       * Email only on the FIRST failure of a streak. The counter
       * has already been incremented by the settle, so a value
       * of one means this run started the streak.
       */
      const first = settled.consecutiveFailures === 1;

      await createNotification({
        userId: input.userId,
        kind: "run_failed",
        scheduleId: input.scheduleId,
        runId: report.runId,
        title:
          report.outcome === "confabulated"
            ? `“${settled.scheduleLabel}” reported work it did not do`
            : `“${settled.scheduleLabel}” could not run`,
        body: failureBody(report, settled.consecutiveFailures, link),
        email: first && settled.notifyEmail,
      });

      break;
    }

    case "skipped":
      /*
       * Silent until it has happened three times, and then said
       * once. A single skipped run is not news — the learner
       * spent their XP on a lesson, which is the product working
       * — but a schedule that has not run for three windows is
       * something they would want to know before they notice the
       * gap themselves.
       */
      if (settled.consecutiveSkips >= 3) {
        await createNotification({
          userId: input.userId,
          kind: "limit_advisory",
          scheduleId: input.scheduleId,
          runId: report.runId,
          title: `“${settled.scheduleLabel}” has been skipping runs`,
          body: skippedBody(report, link),
          email: false,
        });
      }

      break;
  }

  /* ---- the advisory, alongside whatever else was said ---- */

  if (settled.consecutiveLimits >= 5) {
    await createNotification({
      userId: input.userId,
      kind: "limit_advisory",
      scheduleId: input.scheduleId,
      runId: report.runId,
      title: `“${settled.scheduleLabel}” keeps running out of steps`,
      body: [
        `The last ${settled.consecutiveLimits} runs all used up their ${actionConfig.maxSteps} tool steps and answered with what they had.`,
        "",
        "That usually means the task is asking for more than one turn can do. Try splitting it, or making it more specific about what you want back.",
        "",
        `It is still running. ${link}`,
      ].join("\n"),
      email: false,
    });
  }
}

/* =========================================================
   THE COPY

   Written for a fifteen-year-old, and the outcome goes in the
   first line rather than the last — an email read on a phone is
   read one line at a time.
========================================================= */

function scheduleLink(agentId: string): string {
  return `${publicSiteBaseUrl}/agents/${agentId}/schedule`;
}

/*
 * The first line: what the run actually did.
 *
 * It is built from the run's own counters, and it counts the
 * WEB SEARCH as well as the tool steps — which the first
 * version of this did not, and that omission is the whole
 * reason this is a function rather than a ternary.
 *
 * A search is not an action. It happens before the loop has a
 * first step, so it never increments `toolCalls`, so a digest
 * built on that counter alone told an owner "Ran, without
 * needing a tool" about a run whose entire job was to read the
 * news — and told them exactly the same thing when the search
 * provider had refused the request and the answer came out of
 * the model's memory. Those are three different mornings and
 * they were one sentence.
 *
 * The failed search leads, when there was one. It is the only
 * thing here that changes how the answer below should be read.
 */
function activityLine(report: ScheduledRunReport): string {
  if (report.outcome === "limit_reached") {
    /*
     * Two different mornings, and the old copy called them the
     * same one.
     *
     * A step limit means the agent was working and ran out of
     * room: the task is asking for more than a turn can do, and
     * the fix is to make it smaller. Truncation means the agent
     * could not finish WRITING a request — its task may have
     * been perfectly sized, and telling its owner to cut it down
     * sends them to edit something that was never the problem.
     *
     * The truncation line also says the answer may be fine,
     * because it usually is: the run this was written for had a
     * complete, correctly dated answer sitting underneath four
     * failed attempts to reach for a tool it did not need.
     */
    if (report.detail === "truncated") {
      return [
        "Its requests for a tool kept being cut off, so it stopped trying and answered with what it already had.",
        "The answer below may well be complete — check it before changing anything. If this keeps happening, the agent probably has a tool switched on that this task does not need.",
      ].join("\n");
    }

    return `Ran out of its ${actionConfig.maxSteps} tool steps and answered with what it had.`;
  }

  const steps =
    report.toolCalls > 0
      ? `${report.toolCalls} tool ${report.toolCalls === 1 ? "step" : "steps"}`
      : null;

  /*
   * Attempted, and could not be completed. Said plainly and
   * first, because everything below it is now the model's own
   * recollection wearing the clothes of a research answer — and
   * an owner skimming a phone at seven in the morning has no
   * other way to know that.
   */
  if (report.searchReason === "unavailable") {
    return [
      "Could not reach a web search provider.",
      "Anything below that depends on recent events came from the model's own knowledge rather than the web — treat dates and figures in it with care.",
      ...(steps ? [`It used ${steps}.`] : []),
    ].join("\n");
  }

  /*
   * Sentences rather than a clause hung off "Ran," which is
   * what the subject line already says. The parts are ordered
   * the way the run performed them: the search happens before
   * the loop has a first step.
   */
  const web = report.searched
    ? report.searchResults > 0
      ? `Searched the web and read ${report.searchResults} result${
          report.searchResults === 1 ? "" : "s"
        }`
      : "Searched the web and found nothing usable"
    : null;

  if (web && steps) {
    return `${web}, then used ${steps}.`;
  }

  if (web) {
    return `${web}.`;
  }

  if (steps) {
    return `Used ${steps}.`;
  }

  /*
   * Nothing happened, and there are two different nothings.
   *
   * A null reason means no `web_search` event was emitted at
   * all, which is what an agent with the capability switched
   * OFF produces — telling its owner it did not need the web
   * would describe a choice it was never in a position to make.
   * A reason of "not_needed" is the real choice: the web was
   * there and it read the task and decided against it.
   */
  return report.searchReason === null
    ? "Ran, without needing a tool."
    : "Ran, without needing the web or a tool.";
}

function outputBody(report: ScheduledRunReport, link: string): string {
  const header = activityLine(report);

  const output = report.output.trim();

  const shown =
    output.length > mail.bodyChars
      ? `${output.slice(0, mail.bodyChars)}\n\n[…cut off here. The full answer is in the app.]`
      : output;

  /*
   * The files, named from the RUN'S OWN ROWS.
   *
   * Never from the answer text, and that is the point rather
   * than an implementation detail. An agent can write "I have
   * attached the full report" whether or not it made one; this
   * line exists only when a document row does, and the
   * attachment beside it exists for the same reason. A claim
   * with no file is visibly a claim with no file.
   */
  const files =
    report.documents.length > 0
      ? [
          "",
          `Attached: ${report.documents
            .map(
              (document) =>
                `${document.filename} (${
                  document.bytes < 1024
                    ? `${document.bytes} bytes`
                    : `${Math.round(document.bytes / 1024)} KB`
                })`
            )
            .join(", ")}`,
          ...report.documents
            .filter((document) => document.degraded)
            .map((document) => `  ${document.filename}: ${document.degraded}`),
        ]
      : [];

  /*
   * The drafts, named from the RUN'S OWN ROWS, for exactly the
   * reason the files above are — and this is the line where
   * that discipline earns the most.
   *
   * A digest email is read on a phone, at seven in the morning,
   * by somebody who is not going to open the app to check. If
   * the agent's prose said "I replied to your professor" and
   * nothing here contradicted it, they would believe it, and
   * they would be wrong: nothing in this product can send a
   * message from a scheduled run, because there is no send
   * tool.
   *
   * So the list is built from rows, and every entry says WAITING
   * rather than sent — because that is what every one of them
   * is, always, without exception, whatever the answer above it
   * claims.
   */
  const drafted =
    report.drafts.length > 0
      ? [
          "",
          `${report.drafts.length} repl${
            report.drafts.length === 1 ? "y is" : "ies are"
          } waiting for you to approve — nothing has been sent:`,
          ...report.drafts.map(
            (draft) =>
              `  · to ${draft.to.join(", ")} — ${
                draft.subject || "(no subject)"
              }`
          ),
        ]
      : [];

  /*
   * The heads-up, and where it sits is the whole of it.
   *
   * AFTER the answer rather than before. This email exists to
   * deliver the digest, and a notice about scheduling pushed
   * above the news would make the reader hunt for the thing they
   * actually opened it for. They read the answer, then they read
   * that there will not be another one.
   *
   * It is the last chance. There is no run after this one, so
   * nothing else will be sent — the alternative to this
   * paragraph is a digest that simply stops arriving and an
   * owner who works it out a week later.
   */
  const ending = report.finalRun
    ? [
        "",
        "— That was the last run. This schedule has now switched itself off.",
        "Nothing went wrong: schedules stop on their own so one you have forgotten cannot keep spending your XP.",
        `Switching it on again takes one click, and the task is unchanged: ${link}`,
      ]
    : [];

  return [
    header,
    "",
    shown,
    ...files,
    ...drafted,
    ...ending,
    "",
    `See the full run: ${link}`,
  ].join("\n");
}

function failureBody(
  report: ScheduledRunReport,
  streak: number,
  link: string
): string {
  if (report.outcome === "confabulated") {
    return [
      "This run said it used a tool. No tool actually ran.",
      "",
      "Do not trust any figures in its answer — they were not measured, they were written.",
      ...(report.claimPhrase ? ["", `It said: ${report.claimPhrase}`] : []),
      "",
      "This usually means the task asks for something the agent cannot do with the tools it has switched on. Check its capabilities in the Builder, or make the task ask for less.",
      "",
      `See the run: ${link}`,
    ].join("\n");
  }

  return [
    `Could not run${report.detail ? ` (${humanDetail(report.detail)})` : ""}.`,
    "",
    streak > 1
      ? `That is ${streak} in a row. After 3, it switches itself off and tells you.`
      : "One failure is usually temporary — the next run will try again.",
    "",
    `See the run: ${link}`,
  ].join("\n");
}

function skippedBody(report: ScheduledRunReport, link: string): string {
  if (report.detail === "out_of_xp") {
    return [
      "Skipped, because your XP balance was too low.",
      "",
      "Scheduled runs stop before they spend the XP you need for lessons. Earn some by finishing a lesson, or come back tomorrow for your daily XP, and it will pick up again on its own.",
      "",
      `See the schedule: ${link}`,
    ].join("\n");
  }

  return [
    "Skipped — the agent it points at is not available.",
    "",
    `See the schedule: ${link}`,
  ].join("\n");
}

function disabledBody(
  reason: DisabledReason | null,
  report: ScheduledRunReport,
  link: string
): string {
  /*
   * The one disable that is not a failure, and it is first here
   * so that nothing below can accidentally claim it.
   *
   * Every other branch in this function is written for somebody
   * who has to fix something. This one is written for somebody
   * who has to decide something, which is a different email: no
   * failure count, no "test it before switching it back on", no
   * suggestion that their agent did anything wrong. It ran for
   * as long as it was set up to run, and now they choose whether
   * to have another window.
   *
   * The reason is given rather than merely the fact. "Your
   * schedule has been switched off" with no explanation reads as
   * something being taken away; the sentence about XP is what
   * turns it into a rule that is on their side.
   */
  if (reason === "expired") {
    return [
      "Its run has finished, and the schedule has switched itself off.",
      "",
      "Nothing went wrong. Schedules stop on their own after a set time so one you have forgotten about cannot keep spending the XP you need for lessons.",
      "",
      "The task is unchanged and still works — switching it back on is one click, and it will run for another full window.",
      "",
      `Start it again here: ${link}`,
    ].join("\n");
  }

  if (reason === "confabulation") {
    return [
      "Switched off after 2 runs that reported work they did not do.",
      "",
      "The agent said it used a tool when no tool had run. That does not fix itself by waiting — it means the task is asking for something the agent cannot actually do, so it kept describing the answer instead of getting one.",
      ...(report.claimPhrase ? ["", `The last one said: ${report.claimPhrase}`] : []),
      "",
      "Check which capabilities the agent has switched on in the Builder, then edit the task and run it once to test before switching the schedule back on.",
      "",
      `Fix it here: ${link}`,
    ].join("\n");
  }

  return [
    "Switched off after 3 failed runs in a row.",
    "",
    report.detail
      ? `The last one failed with: ${humanDetail(report.detail)}.`
      : "The last three runs could not complete.",
    "",
    "Nothing was charged for the runs that never reached a provider. Run it once to test when you are ready, and switching it back on is one click after that.",
    "",
    `Fix it here: ${link}`,
  ].join("\n");
}

/*
 * An error code a learner can read.
 *
 * The codes themselves are the runtime's own vocabulary and go
 * to the log; a student reading "provider_unavailable" learns
 * nothing except that something is wrong with words they do not
 * have.
 */
function humanDetail(detail: string): string {
  switch (detail) {
    case "timeout":
      return "it took too long to answer";
    case "cancelled":
      return "it was stopped before it finished";
    case "empty_response":
      return "the answer came back empty";
    case "out_of_xp":
      return "your XP balance was too low";
    case "quota_exceeded":
    case "rate_limited":
      return "it had already run as often as it is allowed to today";
    case "provider_unavailable":
    case "provider_not_configured":
      return "BuildGentic could not reach an AI provider";
    case "abandoned":
      return "the run was interrupted and never finished";
    case "claimed_without_evidence":
      return "it reported work it had not done";
    case "truncated":
      return "its requests for a tool kept being cut off";
    case "step_limit":
      return "it used all the tool steps one turn allows";
    case "budget":
      return "it gathered as much tool output as one turn holds";
    default:
      return "something went wrong on our side";
  }
}

/* =========================================================
   THE OUTBOX DRAIN

   Runs on the same tick as the schedules. Never on the run's own
   path: a provider having a bad minute must not be able to turn
   a succeeded run into a failed one.
========================================================= */

export interface DrainResult {
  sent: number;
  failed: number;
}

export async function drainOutbox(): Promise<DrainResult> {
  if (!mailEnabled()) {
    /* Nothing to do, and nothing wrong. Rows written `none`
       never reach this queue; rows written `pending` before the
       key was removed simply wait. */
    return { sent: 0, failed: 0 };
  }

  const queue = await pendingEmails(mail.batch);

  let sent = 0;
  let failed = 0;

  /* Addresses are looked up once per user rather than once per
     notification — a burst is usually one person's schedules. */
  const addresses = new Map<string, string | null>();

  for (const item of queue) {
    if (!addresses.has(item.userId)) {
      addresses.set(item.userId, await ownerEmail(item.userId));
    }

    const to = addresses.get(item.userId) ?? null;

    if (!to) {
      await recordEmailAttempt(
        item.id,
        { ok: false, error: "no address on the account", attempts: item.attempts },
        mail.maxAttempts
      );

      failed += 1;
      continue;
    }

    /*
     * The run's files, attached.
     *
     * Looked up here rather than carried on the notification,
     * so the attachment list is built from what actually EXISTS
     * at send time — which is the structural half of this
     * feature's honesty. An agent that claims a report it never
     * made produces an email with no attachment, contradicted by
     * the message beside its own prose. No classifier reads the
     * answer to decide this.
     *
     * A failure here loses the attachment, not the email. The
     * body already names the files and links to the run, so a
     * learner whose storage hiccuped gets the words and a link
     * rather than nothing at all — the same degradation the
     * outbox exists to provide when email itself is off.
     */
    const attachments = item.runId
      ? await attachmentsForRun(item.userId, item.runId)
      : [];

    const result = await sendMail({
      to,
      subject: subjectFor(item.kind, item.title),
      text: item.body,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    if (result.ok) {
      await recordEmailAttempt(item.id, { ok: true }, mail.maxAttempts);
      sent += 1;
    } else {
      await recordEmailAttempt(
        item.id,
        { ok: false, error: result.error, attempts: item.attempts },
        mail.maxAttempts
      );
      failed += 1;
    }
  }

  return { sent, failed };
}

/*
 * One run's files, as base64 ready to attach.
 *
 * Bounded by the same per-turn ceiling the tool enforces, so a
 * run can contribute at most `documents.maxPerTurn` files of at
 * most `documents.maxBytes` each — around two megabytes,
 * comfortably inside what any provider accepts.
 *
 * Scoped by user id on the listing, so the byte fetch that
 * follows is already inside an ownership check: it takes ids
 * that came back from a query filtered on the notification's
 * own owner.
 */
async function attachmentsForRun(
  userId: string,
  runId: string
): Promise<MailAttachment[]> {
  try {
    const { listForRun, bytesForAttachment } = await import(
      "../documents/DocumentStore"
    );

    const documents = await listForRun(userId, runId);
    const attachments: MailAttachment[] = [];

    for (const document of documents) {
      const bytes = await bytesForAttachment(document.id);

      if (bytes) {
        attachments.push({
          filename: document.filename,
          contentBase64: bytes.toString("base64"),
        });
      }
    }

    return attachments;
  } catch (error) {
    console.error(
      `[schedule] could not attach files for run ${runId}: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );

    return [];
  }
}

/*
 * The subject line, prefixed by what happened.
 *
 * The prefix is not decoration. A confabulated or limit-reached
 * run has to be labelled where the student actually reads it,
 * and on a phone that is the subject line and the first line of
 * the body — never a badge in an app they have not opened.
 */
function subjectFor(kind: NotificationKind, title: string): string {
  switch (kind) {
    case "schedule_disabled":
      return `BuildGentic — action needed: ${title}`;
    case "run_failed":
      return `BuildGentic — ${title}`;
    default:
      return `BuildGentic — ${title}`;
  }
}

/* =========================================================
   RECONCILIATION

   Settling and notifying are two statements, so a process that
   dies between them leaves a schedule switched off with nobody
   told. That is the one silent failure this feature cannot
   tolerate: the entire promise is that somebody finds out.

   The tick asks this question every minute. The unique index on
   (schedule_id, kind) for unread disable notices is what makes
   it safe to ask repeatedly.
========================================================= */

export async function reconcileDisables(): Promise<number> {
  const orphans = await disabledWithoutNotice();

  let written = 0;

  for (const orphan of orphans) {
    /*
     * EXPIRY ARRIVES HERE AND NOWHERE ELSE, which is why this
     * branch matters more than it looks.
     *
     * The breaker's disables come with a run attached, so they
     * are announced by notifyRunFinished above and reach this
     * function only when a process died between settling and
     * notifying. Expiry has no run: it happens in SQL, inside
     * the claim, to a schedule that is not going to run again.
     * So for an expired schedule this reconciliation is not the
     * backstop — it is the delivery path.
     *
     * Which means the old copy would have been what its owner
     * actually received. "Switched off after 3 failed runs in a
     * row", about a schedule that never failed once, with a
     * link telling them to go and fix it.
     */
    const expired = orphan.reason === "expired";

    const id = await createNotification({
      userId: orphan.userId,
      kind: "schedule_disabled",
      scheduleId: orphan.id,
      title: expired
        ? `“${orphan.label}” has finished its run`
        : `“${orphan.label}” was switched off`,
      body: expired
        ? [
            "Its run has finished, and the schedule has switched itself off.",
            "",
            "Nothing went wrong. Schedules stop on their own after a set time so one you have forgotten about cannot keep spending the XP you need for lessons.",
            "",
            "The task is unchanged and still works — switching it back on is one click.",
            "",
            `Start it again here: ${publicSiteBaseUrl}/agents`,
          ].join("\n")
        : [
            orphan.reason === "confabulation"
              ? "Switched off after 2 runs that reported work they did not do."
              : "Switched off after 3 failed runs in a row.",
            "",
            `Fix it here: ${publicSiteBaseUrl}/agents`,
          ].join("\n"),
      email: true,
    });

    if (id) {
      written += 1;
    }
  }

  return written;
}
