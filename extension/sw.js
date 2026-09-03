import { WEB_ORIGIN, PAIR_PATH } from "./config.js";

/*
 * The service worker, and it does almost nothing on purpose.
 *
 * MV3 terminates this after roughly thirty seconds of
 * inactivity, so anything held in a module-scope variable is
 * gone by the next event. That is not a limitation to work
 * around — it is the reason the conversation and the streaming
 * request both live in the side panel, which is a real document
 * with a real lifetime for as long as it is open.
 *
 * What is left here is work that finishes in milliseconds:
 *
 *   own the pairing handshake from the web page,
 *   put the token in storage,
 *   make the toolbar button open the panel.
 *
 * None of it can be interrupted by termination in a way anybody
 * would notice, which is how you can tell it belongs here.
 *
 * THERE IS NO `fetch` IN THIS FILE. A chat turn can run for
 * tens of seconds and a worker mid-request can be killed; the
 * panel does that work instead.
 */

/*
 * The toolbar click opens the side panel — and, usefully, that
 * same click is the user gesture that grants `activeTab`. The
 * permission the whole capture design rests on and the way the
 * panel is opened are therefore the same action, which is why
 * capture can never be running without the user having just
 * acted.
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error("[buildgentic] could not set panel behaviour", error);
  });

/* =========================================================
   PAIRING

   The web page sends the token here. `externally_connectable`
   in the manifest is what allows it, and it names buildgentic's
   origin only.
========================================================= */

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  /*
   * THE SENDER IS CHECKED EVEN THOUGH THE MANIFEST ALREADY
   * RESTRICTS IT.
   *
   * `externally_connectable` is the real boundary and it is
   * enforced by Chrome. This is the second check, and it costs
   * one comparison: a manifest edited later to add another
   * origin — a staging domain, a partner — would otherwise
   * silently widen who can hand this extension a credential.
   * A list that grows for one reason should not quietly grant
   * for another.
   */
  if (!sender.url || new URL(sender.url).origin !== WEB_ORIGIN) {
    respond({ ok: false });
    return false;
  }

  if (message?.type !== "buildgentic:pair" || typeof message.token !== "string") {
    respond({ ok: false });
    return false;
  }

  /*
   * `chrome.storage.local` rather than `session`.
   *
   * `session` is memory-only and would be cleared on every
   * browser restart, which would mean re-pairing every morning
   * — and training somebody to click through a consent screen
   * routinely is the same objection that ruled out a second
   * OAuth login in the first place.
   *
   * What makes the trade acceptable is on the server: the token
   * is scoped to the extension's own routes, expires 30 days
   * after its last use, and can be revoked from any other
   * browser.
   */
  chrome.storage.local
    .set({ token: message.token })
    .then(() => respond({ ok: true }))
    .catch((error) => {
      console.error("[buildgentic] could not store the token", error);
      respond({ ok: false });
    });

  /* Keeps the message channel open for the async respond. */
  return true;
});

/* =========================================================
   MESSAGES FROM THE PANEL
========================================================= */

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "buildgentic:open-pairing") {
    chrome.tabs.create({ url: `${WEB_ORIGIN}${PAIR_PATH}` });
    respond({ ok: true });
    return false;
  }

  if (message?.type === "buildgentic:sign-out") {
    /*
     * Local only. This forgets the token on this machine; it
     * does NOT revoke it server-side, and the panel says so.
     * Revoking is a session-authenticated action on the web
     * app, deliberately — it has to be possible from a
     * different browser than the one being revoked, which is
     * the case that actually matters when a laptop is lost.
     */
    chrome.storage.local
      .remove("token")
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }));

    return true;
  }

  return false;
});
