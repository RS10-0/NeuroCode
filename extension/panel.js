import { API_ORIGIN, MAX_CAPTURE_CHARS } from "./config.js";
import { capturePage } from "./capture.js";
import { renderMarkdown } from "./markdown.js";

/*
 * The side panel.
 *
 * Everything with a duration happens here rather than in the
 * service worker, because this is a document and lives as long
 * as the panel is open, whereas MV3 kills an idle worker after
 * about thirty seconds. A chat turn is easily longer than that.
 *
 * The conversation is held in memory and dropped when the panel
 * closes. That is a deliberate limit rather than an omission:
 * persisting it would mean storing conversation content —
 * including anything a captured page contributed — and page
 * context is not kept anywhere else, so keeping it here would
 * be the one place the promise leaked.
 */

const el = (id) => document.getElementById(id);

const views = {
  pair: el("view-pair"),
  empty: el("view-empty"),
  chat: el("view-chat"),
};

let token = null;
let agents = [];
let pageScope = "unknown";
let messages = [];
let mode = "none";
let busy = false;

function show(name) {
  for (const [key, node] of Object.entries(views)) {
    node.hidden = key !== name;
  }
}

function fail(message) {
  const node = el("error");
  node.textContent = message;
  node.hidden = !message;
}

/* =========================================================
   THE API
========================================================= */

async function api(path, options = {}) {
  const response = await fetch(`${API_ORIGIN}/api/extension${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401) {
    /*
     * The pairing has lapsed — revoked from another browser, or
     * unused for 30 days. Forget it locally and go back to the
     * connect screen rather than showing an error somebody
     * cannot act on.
     */
    await chrome.storage.local.remove("token");
    token = null;
    show("pair");
    throw new Error("unpaired");
  }

  return response;
}

async function loadAgents() {
  const response = await api("/agents");

  if (!response.ok) {
    throw new Error("Could not load your agents.");
  }

  const body = await response.json();

  agents = body.agents ?? [];
  pageScope = body.pageContextScope ?? "unknown";

  const select = el("agent");
  select.innerHTML = "";

  for (const agent of agents) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = `${agent.avatarEmoji ?? ""} ${agent.name}`.trim();
    select.appendChild(option);
  }

  show(agents.length === 0 ? "empty" : "chat");
  syncPageControls();
}

/* =========================================================
   PAGE CONTEXT

   Two switches decide whether the control is even offered, and
   neither of them is this one — the server refuses the field if
   it disagrees. This is a courtesy, not the gate.
========================================================= */

function currentAgent() {
  return agents.find((agent) => agent.id === el("agent").value) ?? agents[0];
}

function syncPageControls() {
  const agent = currentAgent();
  const allowed = Boolean(agent?.pageContext) && pageScope === "allowed";

  el("page-controls").hidden = !allowed;

  const note = el("page-blocked");

  if (allowed) {
    note.hidden = true;
  } else if (pageScope !== "allowed") {
    /*
     * The account gate. Two different sentences because only
     * one of them is fixable, and somebody deserves to know
     * which they are looking at.
     */
    note.hidden = false;
    note.textContent =
      pageScope === "denied"
        ? "Reading web pages is switched off for this account. Your agent still answers from what you type."
        : "Reading web pages is not switched on for this account yet. Your agent still answers from what you type.";
  } else {
    note.hidden = false;
    note.textContent =
      "This agent cannot read the page. Turn on “Read the page” for it on BuildGentic if you want that.";
  }

  if (!allowed) {
    mode = "none";
    paintModes();
  }
}

function paintModes() {
  for (const button of document.querySelectorAll(".seg__opt")) {
    const on = button.dataset.mode === mode;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-checked", String(on));
  }
}

/*
 * Reads the page, right now, because somebody just pressed Ask.
 *
 * `chrome.scripting.executeScript` with `activeTab` — which
 * Chrome granted when they pressed the extension's button, and
 * which lapses on navigation. There is no content script and
 * nothing standing by; this is the only moment any of this
 * extension's code touches a page.
 */
async function capture() {
  if (mode === "none") {
    return null;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No page to read here.");
  }

  let results;

  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
      args: [mode, MAX_CAPTURE_CHARS],
    });
  } catch (error) {
    /*
     * TWO CAUSES WEARING THE SAME EXCEPTION, and saying the
     * wrong one sends somebody looking for a fault that is not
     * there.
     *
     * A restricted page — the browser's own pages, the Web
     * Store, a PDF viewer — can never be injected into, and no
     * amount of pressing anything will change that.
     *
     * An ordinary page that refuses means `activeTab` is not
     * held for this tab: the grant arrives with a press of the
     * extension's button and is revoked the moment the tab
     * navigates, so opening the panel and then browsing loses
     * it.
     *
     * `tab.url` tells them apart WITHOUT the `tabs` permission,
     * which is the neat part: the field is only populated for a
     * tab the extension has access to. Undefined therefore
     * means the grant is missing, and a readable http(s) URL
     * means it is held and something else went wrong.
     */
    const url = tab.url ?? "";

    console.error("[buildgentic] capture refused", {
      hasUrl: Boolean(tab.url),
      url,
      message: error?.message ?? String(error),
    });

    if (!url) {
      throw new Error(
        "Press the BuildGentic icon on this page — or right-click the page and pick “Ask BuildGentic about this page” — then ask again. Permission to read a page comes from that gesture and lapses when the tab moves on."
      );
    }

    throw new Error(
      /^https?:/.test(url)
        ? "That page refused to be read. Reload it and press the BuildGentic icon again."
        : "This page cannot be read — the browser does not allow it here."
    );
  }

  const captured = results?.[0]?.result;

  if (!captured || captured.empty) {
    throw new Error(
      mode === "selection"
        ? "Nothing is selected on that page."
        : "There was no readable text on that page."
    );
  }

  return captured;
}

/* =========================================================
   THE TURN
========================================================= */

function render() {
  const log = el("log");
  log.innerHTML = "";

  for (const message of messages) {
    const row = document.createElement("div");
    row.className = `msg msg--${message.role}`;

    if (message.page) {
      const chip = document.createElement("span");
      chip.className = "msg__page";
      chip.textContent =
        message.page.mode === "selection"
          ? `read your selection on ${message.page.title || message.page.url}`
          : `read ${message.page.title || message.page.url}`;
      row.appendChild(chip);
    }

    const text = document.createElement("div");

    if (message.role === "assistant") {
      /*
       * Answers arrive as Markdown, so they are rendered as
       * Markdown — printing the asterisks was never a decision,
       * just what `textContent` does with them.
       *
       * `renderMarkdown` builds nodes and sets their text with
       * `textContent`, so the rule below still holds: nothing
       * a model wrote reaches this document as markup. See the
       * header of markdown.js.
       */
      text.className = "msg__md";
      text.appendChild(renderMarkdown(message.content));
    } else {
      /*
       * A learner's own message is NOT rendered as Markdown,
       * and the asymmetry is on purpose: somebody who types an
       * asterisk means an asterisk, and seeing their own words
       * silently restyled is worse than seeing them plainly.
       *
       * textContent, never innerHTML. An answer can quote a
       * page, and a page is a stranger's markup.
       */
      text.className = "msg__text";
      text.textContent = message.content;
    }

    row.appendChild(text);

    log.appendChild(row);
  }

  log.scrollTop = log.scrollHeight;
}

async function ask(event) {
  event.preventDefault();

  if (busy) {
    return;
  }

  const input = el("prompt");
  const content = input.value.trim();

  if (!content) {
    return;
  }

  fail("");
  busy = true;
  el("send").disabled = true;

  let page = null;

  try {
    page = await capture();
  } catch (error) {
    fail(error.message);
    busy = false;
    el("send").disabled = false;
    return;
  }

  messages.push({ role: "user", content, page });
  input.value = "";

  const reply = { role: "assistant", content: "" };
  messages.push(reply);
  render();

  try {
    const response = await api("/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId: currentAgent().id,
        /* Only the turns, never the page chips — the server
           composes everything else from the stored agent.

           The filter is what drops the empty assistant
           placeholder pushed just above, and it is the only
           thing that should be dropped. Taking the last
           element off as well removed the question that was
           just typed with it, which on a first turn left the
           server an empty array and the reply "messages must
           contain at least one message". */
        messages: messages
          .filter((m) => m.content || m.role === "user")
          .map(({ role, content }) => ({ role, content })),
        ...(page
          ? {
              pageContext: {
                url: page.url,
                title: page.title,
                mode: page.mode,
                text: page.text,
                truncated: page.truncated,
              },
            }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? "That did not work.");
    }

    /*
     * SSE read off the body stream rather than with
     * EventSource, which cannot send an Authorization header —
     * and which does not exist in a worker anyway. The same
     * shape the web app's own client uses.
     */
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));

        if (!dataLine) {
          continue;
        }

        let event;

        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }

        if (event.type === "delta") {
          reply.content += event.text;
          render();
        } else if (event.type === "error") {
          throw new Error(event.error ?? "That did not work.");
        }
      }
    }

    if (!reply.content) {
      throw new Error("Your agent did not answer. Try again.");
    }
  } catch (error) {
    if (error.message !== "unpaired") {
      fail(error.message);
    }

    /* Drop the empty placeholder so the log does not keep a
       blank bubble somebody has to wonder about. */
    if (!reply.content) {
      messages = messages.filter((m) => m !== reply);
      render();
    }
  } finally {
    busy = false;
    el("send").disabled = false;
  }
}

/* =========================================================
   WIRING
========================================================= */

el("pair").addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "buildgentic:open-pairing" });
});

el("refresh").addEventListener("click", () => {
  void start();
});

el("clear").addEventListener("click", () => {
  messages = [];
  render();
  fail("");
});

el("agent").addEventListener("change", () => {
  messages = [];
  render();
  syncPageControls();
});

el("signout").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "buildgentic:sign-out" });
  token = null;
  messages = [];
  show("pair");
});

for (const button of document.querySelectorAll(".seg__opt")) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    paintModes();
  });
}

el("composer").addEventListener("submit", ask);

/* Enter sends, Shift+Enter makes a new line — the convention
   every chat box has, and its absence is felt immediately. */
el("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el("composer").requestSubmit();
  }
});

/*
 * Re-read when the pairing lands.
 *
 * The pairing happens in another tab, so this panel has no way
 * to know it finished except by watching what the worker wrote.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token?.newValue) {
    void start();
  }
});

async function start() {
  fail("");

  const stored = await chrome.storage.local.get("token");

  token = stored.token ?? null;

  if (!token) {
    show("pair");
    return;
  }

  try {
    await loadAgents();
  } catch (error) {
    if (error.message !== "unpaired") {
      fail(error.message);
      show("empty");
    }
  }
}

void start();
