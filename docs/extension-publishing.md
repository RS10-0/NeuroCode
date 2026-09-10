# Publishing the extension

The runbook for putting the BuildGentic side panel on the Chrome Web Store,
and the paste-ready copy every field on the submission form asks for.

The design lives in [`phase-4-browser-extension.md`](phase-4-browser-extension.md)
and how to run it locally lives in [`../extension/README.md`](../extension/README.md).
This file is only publication.

---

## 0. Before anything else: does the pinned key match the Store item?

The extension's id is derived from the `key` in `manifest.json`, and that id
is **already in production** in two places:

- `NEUROLINK_EXTENSION_ORIGIN` on Render — `chrome-extension://cmoomhehlipadcgppmffkclnneffkhkh`
- `VITE_EXTENSION_ID` on Vercel — `cmoomhehlipadcgppmffkclnneffkhkh`

If that `key` did not come from the Store item's own keypair, publishing
assigns a **different** id, and on launch day pairing stops working and
every call from the panel is refused by CORS — both with no error anybody
would connect to the cause.

So, first:

1. Developer Dashboard → the BuildGentic item → **Package** → **View public key**.
2. Compare it to `key` in `extension/manifest.json`, ignoring the
   `-----BEGIN/END-----` lines and all newlines.
3. `node extension/verify-key.js` prints the id that key yields. It must be
   `cmoomhehlipadcgppmffkclnneffkhkh`.

If there is no draft item yet, create one and upload any zip to get a key
assigned, then take the key from there and re-run step 3. If the id changes,
both environment variables above change with it — and `VITE_EXTENSION_ID` is
a **build-time** variable, so Vercel needs a redeploy, not just a settings
save.

---

## 1. What public users will actually get

**Page reading will be off for everyone.** `user_account_scope` has no
writer, so every account resolves to `unknown`, and `unknown` denies — see
[§4.4.4](phase-4-browser-extension.md). New users get the side panel and
agent chat; the Include control stays hidden.

That is shippable and honest, but it has to shape the listing: nothing in
the Store copy below promises page reading as a feature you get on install.
The manifest description was reworded for the same reason — the old one
("Ask one of your own BuildGentic agents about the page you are on")
described the one thing a new user cannot do.

---

## 2. Store listing copy

**Name:** BuildGentic

**Short description** (132 char limit):

> Chat with the AI agents you built on BuildGentic, from a side panel on any site.

**Category:** Education

**Detailed description:**

> BuildGentic is where you build your own AI agents. This side panel is
> where you use them.
>
> Press the icon on any website and the agents you have switched on for the
> extension are there, ready to answer — the same agents, with the same
> capabilities, that you built in the Builder. No second login: you connect
> the browser once from your BuildGentic account.
>
> What it does
> • Talk to your own agents from a side panel, on any site
> • Every capability follows the agent — knowledge, web search, documents
> • Switch an agent off in the Builder and it disappears here immediately
>
> What it does not do
> • It never receives your BuildGentic password or session — only a
>   separate key that works on the extension's own routes and nowhere else
> • It has no access to any page you have not just invoked it on
> • It runs no code on any website in the background
>
> You need a BuildGentic account to use this extension.

**Privacy policy URL:** `https://www.buildgentic.com/privacy`

**Support URL:** `https://www.buildgentic.com`

---

## 3. Single purpose

The form asks for one sentence. Paste:

> A side panel that lets a signed-in BuildGentic user chat with the AI
> agents they built on buildgentic.com, and — only when they explicitly
> choose to on a page they have just invoked the extension on — ask about
> the content of that page.

---

## 4. Permission justifications

One field per permission. Each of these is a claim about what the code
does; the file that backs it is named so a reviewer's question has an
answer.

**`activeTab`**

> The panel reads the current page only at the moment the user presses Ask
> with "This page" or "Selection" chosen. activeTab scopes that access to
> the single tab the user just invoked the extension on, and it lapses when
> that tab navigates. We chose it deliberately instead of a broad host
> permission: there is no moment at which this extension can reach a page
> the user has not just acted on.

**`scripting`**

> Used once per request, to run a single text-extraction function in the
> active tab via chrome.scripting.executeScript. The extension declares no
> content scripts at all, so nothing runs on any website until the user asks
> a question with page context selected.

**`storage`**

> Stores one extension-scoped API token received at pairing, and nothing
> else. chrome.storage.local rather than session so the user is not asked to
> re-pair on every browser restart.

**`sidePanel`**

> The extension's entire user interface is a side panel.

**`contextMenus`**

> Adds one item, "Ask BuildGentic about this page", which opens the side
> panel. It is also the user gesture that re-grants activeTab after the
> earlier grant has lapsed on navigation.

**Host permission `https://api.buildgentic.com/*`**

> The panel calls the BuildGentic API to list the user's own agents and to
> run a chat turn. It is the only host the extension contacts.

**If asked about `externally_connectable`**

> It names https://www.buildgentic.com only, and is used solely to receive
> the pairing token from the user's own signed-in BuildGentic tab. It is the
> reason no content script needs to run on our own site.

**Remote code:** No. The extension loads and executes no code from any
remote source; every script is in the package.

---

## 5. Data disclosures

Tick:

- **Authentication information** — an extension-scoped API token is stored
  in `chrome.storage.local`.
- **Website content** — text from the current page, but only when the user
  selects "This page" or "Selection" and presses Ask.

Leave unticked: PII, health, financial, location, personal communications,
web history, user activity. None of these are collected.

Then the three certifications, all of which are true here:

- not being sold to third parties
- not being used or transferred for any purpose unrelated to the single
  purpose above
- not being used or transferred to determine creditworthiness

**"Is this directed to children?"** — this one is a decision, not a lookup.
BuildGentic is used by learners aged 10–13, and the privacy policy already
says so. Answer it against how the item is actually distributed, and
remember that the answer is also a promise about future versions.

---

## 6. Screenshots

At least one, 1280×800 or 640×400 PNG. Take them from a real install:

1. A page with the panel open and an agent mid-answer — the whole point of
   the product in one image.
2. The agent picker open, showing more than one agent.
3. The Deploy → Browser extension section in the app, showing the switch
   that puts an agent in the panel.

Crop to exactly 1280×800. Do not include a page with somebody's real
account, email, or a site that would read as an endorsement.

---

## 7. Submitting

```bash
npm run pack:extension
```

Writes `dist-extension/buildgentic-extension.zip` from an explicit file
list — 11 files, no strays. Then:

1. Dashboard → the item → **Package** → **Upload new package** → the zip.
2. Fill in §2–§6 above.
3. **Visibility: Unlisted.** Same review, link-only distribution. Real
   installs against the real id, with a handful of people rather than a
   crowd, so a wrong origin is found cheaply.
4. Submit. Review is usually days; the two things that lengthen it —
   remote code and broad host permissions — are both absent here.

Leave the `key` field in the shipped manifest. It is a recognised field, the
Store ignores it in favour of its own, and keeping it is what makes an
unpacked install on a developer's machine carry the same id as the
published one.

---

## 8. After it is approved

1. Install from the Store link in a browser that has never had the unpacked
   copy, and confirm `chrome://extensions` shows
   `cmoomhehlipadcgppmffkclnneffkhkh`. If it does not, stop: fix
   `NEUROLINK_EXTENSION_ORIGIN` and `VITE_EXTENSION_ID` first, and redeploy
   Vercel so the new id is compiled into the pairing page.
2. Pair from a real account that is not yours.
3. Ask that account's agent a question, and check the XP ledger records it
   as `agent_extension`.
4. Only then switch visibility to Public.

---

## 9. Edge

Edge users can install from the Chrome Web Store, so nothing here is
blocking them. A listing in the Microsoft Edge Add-ons store is a separate
submission with its own review, and the same zip. Worth doing only once the
Chrome listing is settled — two stores mean two review queues for every
change.
