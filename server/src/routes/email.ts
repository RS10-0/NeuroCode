import { Router } from "express";
import type { Response } from "express";

import { getAgent } from "../agents/AgentStore";
import {
  disconnectAccount,
  explainProblem,
  listAccounts,
  usableAccount,
} from "../agents/email/AccountStore";
import { cleanAddresses } from "../agents/email/addresses";
import {
  claimForSend,
  discardDraft,
  getDraft,
  listDrafts,
  markSent,
  releaseClaim,
} from "../agents/email/DraftStore";
import { beginAuthorization, completeAuthorization } from "../agents/email/oauth";
import { DEFAULT_EMAIL_PROVIDER, emailProvider } from "../agents/email/registry";
import type { EmailGrant } from "../agents/email/types";
import { email as emailConfig, emailEnabled, publicSiteBaseUrl } from "../ai/config";
import { AiRuntimeError, statusFor, toErrorBody } from "../ai/errors";
import { canSeal } from "../ai/crypto";
import { requireUser } from "../lib/auth";

/*
 * The owner's side of email: connecting a mailbox, seeing what
 * has been drafted, and sending one.
 *
 * ONE ROUTE HERE DELIVERS A MESSAGE, AND IT IS THE ONLY PLACE
 * IN THIS PROJECT THAT CAN.
 *
 * That is the entire architecture of the capability, stated as
 * a fact about the file system: `POST /drafts/:id/send` is the
 * single caller of any provider's `send`, it requires a
 * Supabase session, and it acts on a row a person has read on a
 * screen. There is no send tool in the catalogue, so no turn —
 * not in the Test panel, not on a schedule, not from a
 * deployment — has a path to it.
 *
 * Which means the worst outcome available to a prompt injection
 * that fully controls what an agent says is a paragraph in a
 * tray with a button next to it. Somebody still has to press
 * the button.
 *
 * Mounted ABOVE agentsRouter for the reason documentsRouter is:
 * that router owns "/:agentId", so "/email/..." would otherwise
 * be read as an agent id and every route here would 404.
 */

export const emailRouter = Router();

function sendError(res: Response, error: unknown): void {
  const body = toErrorBody(error);

  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  res.status(statusFor(error)).json(body);
}

/* =========================================================
   CONNECTING
========================================================= */

/* ---------------------------------------------------------
   GET /api/agents/email/status

   What the Email screen renders from.

   Carries the ADDRESS and what was granted, and nothing else.
   There is no token on this response and no shape in which one
   could be — `listAccounts` returns `EmailAccount`, which has
   no token field for this handler to forget to strip. That is
   deliberate rather than careful: a route cannot leak what its
   type cannot hold.
   --------------------------------------------------------- */

emailRouter.get("/email/status", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    /*
     * Both reported rather than assumed, and for the reason the
     * connections route reports `secretsAvailable`: with either
     * missing, everything on the screen works right up to the
     * redirect, and the failure is invisible from the browser.
     * Saying so up front lets the UI explain a configuration
     * problem to the one person who can fix it.
     */
    const configured = emailEnabled() && canSeal();

    res.json({
      configured,
      provider: DEFAULT_EMAIL_PROVIDER,
      accounts: configured ? await listAccounts(user.id) : [],
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/email/connect

   Starts the flow and hands back a URL for the browser to go
   to.

   A POST returning a URL rather than a redirect, deliberately.
   The request needs a bearer token, and a browser following a
   redirect does not carry one — so the session is proved here,
   in a fetch, and the navigation happens afterwards with a URL
   the caller already holds.
   --------------------------------------------------------- */

emailRouter.post("/email/connect", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;

    /*
     * WHICH PERMISSIONS TO ASK GOOGLE FOR, TAKEN FROM THE
     * AGENT'S OWN CAPABILITIES.
     *
     * Not from the request, and not "all of them". A person
     * connecting a mailbox for an agent that can only read
     * should see a consent screen asking to read — being asked
     * for permission to send mail by something that cannot send
     * mail is how people learn to click through consent screens
     * without reading them.
     *
     * `read` is always included because every other grant is
     * useless without it: a draft written without having read
     * the message it answers is not a draft anybody wants.
     */
    const grants = new Set<EmailGrant>(["read"]);

    if (typeof raw.agentId === "string" && raw.agentId) {
      const agent = await getAgent(user.id, raw.agentId);

      if (!agent) {
        res.status(404).json({
          error: "That agent does not exist.",
          code: "invalid_request",
        });
        return;
      }

      if (agent.capabilities.includes("email_draft")) grants.add("draft");
      if (agent.capabilities.includes("email_send")) grants.add("send");
      if (agent.capabilities.includes("email_organize")) grants.add("organize");
    }

    const { url } = await beginAuthorization({
      userId: user.id,
      provider: DEFAULT_EMAIL_PROVIDER,
      grants: [...grants],
      ...(typeof raw.returnPath === "string"
        ? { returnPath: raw.returnPath }
        : {}),
    });

    res.json({ url });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   GET /api/agents/email/callback

   Where Google sends the browser back to.

   THE ONE ROUTE IN THIS FILE WITH NO BEARER TOKEN, and it does
   not need one: the caller is a redirected browser, which
   carries no Authorization header and cannot be made to. Who
   this is comes off the state row instead — a random string
   this server issued, bound to a user id, consumable exactly
   once.

   It answers with a redirect rather than JSON, because what is
   on the other end is a person looking at a browser tab.
   --------------------------------------------------------- */

emailRouter.get("/email/callback", async (req, res) => {
  /*
   * Where to send them when it goes wrong.
   *
   * The app's own origin, from the same config the published
   * pages use. Never anything off the query string: a redirect
   * target a caller supplies is an open redirect, and this is
   * the one route on the server that a stranger can cause a
   * browser to reach.
   */
  const base = publicSiteBaseUrl.replace(/\/+$/, "");

  const fail = (reason: string) =>
    res.redirect(`${base}/agents?email=${encodeURIComponent(reason)}`);

  /*
   * Google's own refusal, when somebody presses Cancel on the
   * consent screen. Not an error on anybody's part.
   */
  if (typeof req.query.error === "string") {
    fail(req.query.error === "access_denied" ? "cancelled" : "failed");
    return;
  }

  try {
    const done = await completeAuthorization({
      state: req.query.state,
      code: req.query.code,
    });

    res.redirect(
      `${base}${done.returnPath}?email=connected&address=${encodeURIComponent(
        done.account.emailAddress
      )}`
    );
  } catch (error) {
    /*
     * Logged here and generalised on the way out. A callback's
     * failure detail is about a state row and a token exchange;
     * the person needs a screen that says try again, and an
     * operator needs the reason.
     */
    console.error(
      `[email] callback failed: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );

    fail("failed");
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/email/accounts/:accountId
   --------------------------------------------------------- */

emailRouter.delete("/email/accounts/:accountId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    await disconnectAccount(user.id, req.params.accountId);
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});

/* =========================================================
   DRAFTS
========================================================= */

/* ---------------------------------------------------------
   GET /api/agents/:agentId/email/drafts

   The tray.
   --------------------------------------------------------- */

emailRouter.get("/:agentId/email/drafts", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const agent = await getAgent(user.id, req.params.agentId);

    if (!agent) {
      res.status(404).json({
        error: "That agent does not exist.",
        code: "invalid_request",
      });
      return;
    }

    res.json({
      drafts: await listDrafts(user.id, agent.id),
      /*
       * Whether the Send button should be there at all.
       *
       * Read off the stored agent row rather than from the
       * browser, because this is the capability check for the
       * one consequential action in the product — and the same
       * value is checked again on the send itself. The browser
       * gets it so the UI can be honest about what it will do,
       * not so that it can decide.
       */
      canSend: agent.capabilities.includes("email_send"),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   POST /api/agents/:agentId/email/drafts/:draftId/send

   THE SEND.

   Everything in this capability exists so that this is a
   separate, deliberate, authenticated act rather than something
   a sentence can cause. Five things have to be true before a
   message leaves, and they are checked in this order because
   each is cheaper than the next:

     a Supabase session, matching the row's owner;
     the AGENT carries `email_send`, which its owner decided;
     the MAILBOX granted send, which its owner decided on
       Google's consent screen;
     the draft is still a draft — claimed with a compare-and-set
       BEFORE the provider is reached, so a double-click sends
       once;
     and the addresses still validate, re-checked here because
       the row could have been written by an older build and
       this is the last moment anything can be stopped.
   --------------------------------------------------------- */

emailRouter.post("/:agentId/email/drafts/:draftId/send", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  let claimed = false;

  try {
    const agent = await getAgent(user.id, req.params.agentId);

    if (!agent) {
      res.status(404).json({
        error: "That agent does not exist.",
        code: "invalid_request",
      });
      return;
    }

    if (!agent.capabilities.includes("email_send")) {
      /*
       * The capability gate, and it is deliberately separate
       * from `email_draft`. An agent may be allowed to write
       * replies without being allowed to deliver them, which is
       * a sensible thing to want and the reason the two are
       * different ids rather than one "email" switch.
       */
      res.status(403).json({
        error:
          "This agent is not allowed to send email. Turn on Send Email in its capabilities first.",
        code: "invalid_request",
      });
      return;
    }

    const draft = await getDraft(user.id, req.params.draftId);

    if (!draft || draft.agentId !== agent.id) {
      res.status(404).json({
        error: "That draft does not exist.",
        code: "invalid_request",
      });
      return;
    }

    if (draft.status === "sent") {
      /*
       * A 409 rather than a fresh send. Somebody pressing the
       * button twice must be told the first one worked, not
       * given a second message.
       */
      res.status(409).json({
        error: "That draft has already been sent.",
        code: "invalid_request",
      });
      return;
    }

    if (draft.status !== "draft") {
      res.status(409).json({
        error:
          draft.status === "sending"
            ? "That draft is being sent already."
            : "That draft was discarded.",
        code: "invalid_request",
      });
      return;
    }

    /*
     * Re-validated on the way out.
     *
     * The tool checked these when the row was written, and this
     * is not a duplicate of that check — it is the LAST one. A
     * row could have been written by an older build with looser
     * rules, and a header-injecting address is worth refusing
     * twice.
     */
    const to = cleanAddresses(draft.to);
    const cc = cleanAddresses(draft.cc);

    if (!to.ok || !cc.ok || to.clean.length === 0) {
      res.status(400).json({
        error:
          to.clean.length === 0
            ? "That draft has no recipient."
            : `That draft has an address BuildGentic will not send to: ${[
                ...to.rejected,
                ...cc.rejected,
              ]
                .map((entry) => `"${entry}"`)
                .join(", ")}.`,
        code: "invalid_request",
      });
      return;
    }

    if (draft.body.trim().length === 0) {
      res.status(400).json({
        error: "That draft is empty.",
        code: "invalid_request",
      });
      return;
    }

    if (to.clean.length + cc.clean.length > emailConfig.maxRecipients) {
      res.status(400).json({
        error: `That draft has more than ${emailConfig.maxRecipients} recipients.`,
        code: "invalid_request",
      });
      return;
    }

    const account = await usableAccount({ userId: user.id, requires: "send" });

    if (!account.ok) {
      res.status(400).json({
        error: explainProblem(account.problem),
        code: "invalid_request",
      });
      return;
    }

    const provider = emailProvider(account.account.provider);

    if (!provider) {
      throw new AiRuntimeError(
        "internal_error",
        "That mail provider is no longer supported."
      );
    }

    /*
     * THE CLAIM, AND IT HAPPENS BEFORE GMAIL IS REACHED.
     *
     * A guard applied after the provider call would refuse only
     * the second WRITE — long after both messages had left. Two
     * clicks a second apart both read a `draft` row, both call
     * Gmail, and the person has replied twice. The
     * compare-and-set is what makes that impossible, and it has
     * to be on this side of the network call.
     */
    const claim = await claimForSend(user.id, draft.id);

    if (!claim) {
      res.status(409).json({
        error: "That draft is already being sent.",
        code: "invalid_request",
      });
      return;
    }

    claimed = true;

    const result = await provider.send(account.account.accessToken, {
      to: to.clean,
      cc: cc.clean,
      subject: draft.subject,
      body: draft.body,
      ...(draft.replyToMessageId
        ? { replyToMessageId: draft.replyToMessageId }
        : {}),
      ...(draft.threadId ? { threadId: draft.threadId } : {}),
    });

    /* The message has gone. From here on a failure is a
       bookkeeping problem, not a delivery one, and `markSent`
       says so in its own error. */
    claimed = false;

    const sent = await markSent({
      userId: user.id,
      draftId: draft.id,
      providerMessageId: result.messageId,
    });

    res.json({ draft: sent, from: account.account.emailAddress });
  } catch (error) {
    if (claimed) {
      /* The send failed with the claim still held. Put the row
         back so the person can try again rather than leaving it
         stuck in a state with no button. */
      await releaseClaim(user.id, req.params.draftId);
    }

    sendError(res, error);
  }
});

/* ---------------------------------------------------------
   DELETE /api/agents/:agentId/email/drafts/:draftId

   Throwing one away. Soft, so a tray that has been cleared can
   still be audited — and because "the agent drafted something
   and I decided against it" is a fact worth keeping for as long
   as the row lives anyway.
   --------------------------------------------------------- */

emailRouter.delete("/:agentId/email/drafts/:draftId", async (req, res) => {
  const user = await requireUser(req, res);

  if (!user) {
    return;
  }

  try {
    const draft = await getDraft(user.id, req.params.draftId);

    if (!draft || draft.agentId !== req.params.agentId) {
      res.status(404).json({
        error: "That draft does not exist.",
        code: "invalid_request",
      });
      return;
    }

    if (draft.status === "sent") {
      res.status(409).json({
        error: "That message has already been sent and cannot be withdrawn.",
        code: "invalid_request",
      });
      return;
    }

    await discardDraft(user.id, draft.id);
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
});
