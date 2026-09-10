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
 * The toolbar click opens the side panel AND grants
 * `activeTab`, and getting both out of one click takes more
 * care than it looks.
 *
 * `setPanelBehavior({ openPanelOnActionClick: true })` is the
 * one-liner for this and it is WRONG HERE. The browser then
 * consumes the click itself to open the panel: `onClicked`
 * never fires, and `activeTab` — which is granted by an
 * invocation of the extension, not by a panel appearing — is
 * never granted at all. The panel opens, capture is refused
 * for want of access to the tab, and nothing anywhere says
 * why. Found on Edge, and the behaviour is Chromium's rather
 * than Edge's.
 *
 * So the click is handled here instead. `onClicked` fires,
 * which IS the invocation that grants `activeTab`, and opening
 * the panel from inside that handler is allowed because the
 * handler runs in a user gesture.
 *
 * `open()` is called FIRST THING, with nothing awaited before
 * it. A gesture does not survive an await, so any groundwork
 * put above this line would silently cost the panel its right
 * to open.
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((error) => {
    console.error("[buildgentic] could not set panel behaviour", error);
  });

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) {
    return;
  }

  /*
   * Scoped to the tab rather than the window, so the panel
   * lives exactly as long as the permission does. `activeTab`
   * is per-tab and lapses when that tab navigates; a panel
   * that followed you to a different tab would look ready
   * while holding no access to what is in front of you, which
   * is the confusion this whole file is trying to end.
   */
  chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {
    console.error("[buildgentic] could not open the side panel", error);
  });
});

/*
 * A SECOND WAY IN, for when the first one has expired.
 *
 * `activeTab` lapses on navigation, so a panel left open while
 * somebody reads three articles is a panel that can no longer
 * read any of them. Pressing the toolbar icon again re-grants
 * it — but a right-click is the gesture people already reach
 * for on the page itself, and it grants `activeTab` just as
 * the icon does.
 *
 * Registered on install rather than at the top level: the
 * worker is restarted constantly, and `create` on an id that
 * already exists is an error.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: "buildgentic-ask",
      title: "Ask BuildGentic about this page",
      contexts: ["page", "selection"],
    },
    () => {
      /* Read so that a duplicate-id complaint after a reload is
         not an unhandled error in the console. */
      void chrome.runtime.lastError;
    }
  );
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "buildgentic-ask" || !tab?.id) {
    return;
  }

  chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {
    console.error("[buildgentic] could not open the side panel", error);
  });
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
