# The BuildGentic browser extension

A generic side panel. It works on any site, lists the agents their owner has
switched on for it, and can be given the page in front of you as context —
only when you ask it for something, on the page you asked from.

The design and the reasoning behind every decision here are in
[`docs/phase-4-browser-extension.md`](../docs/phase-4-browser-extension.md).
This file is only what you need to run it.

## What it is not

It is not a second way into your account. The extension never receives your
password or your BuildGentic session. Pairing gives it one `nlx_` token
which works on `/api/extension/*` and is refused by every other route on the
server — `getAuthenticatedUser` accepts Supabase JWTs only, and an `nlx_`
string is not one.

It is not a second set of permissions either. Every capability an agent has
in the side panel is read off the stored agent row on every turn. Switching
something off in the Builder switches it off here immediately, with nothing
to change in two places.

## Running it locally

**1. Configure the two ends.**

In `server/.env`:

```
NEUROLINK_EXTENSION_ORIGIN=chrome-extension://<your-unpacked-id>
```

Not needed in development if `NEUROLINK_ALLOWED_ORIGINS` is unset — the
server then accepts any `chrome-extension://` origin, because an unpacked
extension gets a different id on every machine. In production it must be the
exact origin, never a wildcard.

In the web app's `.env.local`:

```
VITE_EXTENSION_ID=<your-unpacked-id>
```

Without it the pairing page cannot hand the token over and says so.

**2. Point the extension at your API.**

`config.js` holds the two addresses. **They now point at production** —
`https://api.buildgentic.com` and `https://www.buildgentic.com` — so to work
against a local stack you change them back to `http://localhost:3001` and
`http://localhost:5199` (or whichever port Vite took; it moves when 5199 is
busy).

Whatever you set, `WEB_ORIGIN` and the matching entry under
`externally_connectable` in `manifest.json` must name the **same origin,
character for character**. That list is what allows the pairing page to talk
to the extension at all, and `sw.js` compares the sender's origin against
`WEB_ORIGIN` with strict equality on top of it. Note the `www.` in the
production value: the apex `buildgentic.com` answers every path with a 308
redirect to `www.`, so the pairing page runs on the `www` origin and nothing
else matches it.

**3. Load it.**

`chrome://extensions` → Developer mode → *Load unpacked* → this folder.

Copy the id it shows you into the two variables above, then restart the API
and the web dev server.

**4. Pair it.**

Press the extension's icon. It opens the panel, which offers to connect this
browser and opens `/extension/connect` in a tab. You are already signed in
there, so it is a confirmation rather than a login.

**5. Switch an agent on.**

Nothing appears in the panel until you do. Open any agent → **Deploy** →
*Browser extension* → *Show in the side panel*. "Read the page" is a second,
separate switch and is off until you turn it on as well.

## Icons

`icons/` holds `16.png`, `48.png` and `128.png` — a navy rounded square
carrying the same two-nodes-and-a-link mark as `src/components/BrandMark.tsx`,
redrawn as filled geometry so it survives being 16 pixels wide. The colours
are the app's own `--accent` / `--on-accent`.

## Pinning the extension id

Without a `key` field in the manifest, Chrome derives the extension's id from
a keypair it makes up per machine, so an unpacked install gets a different id
on every computer. That is survivable in development and fatal in production,
because the server identifies the extension *by* that id —
`NEUROLINK_EXTENSION_ORIGIN` is one exact origin and never a wildcard
(`server/src/index.ts`, `isAllowedOrigin`).

The id has to come from the Web Store, because the Store's own key is what
governs the published item. Generating a keypair locally would pin a
perfectly stable id that the Store then declines to use, and the server
setting would have to change again at publication.

1. Zip this folder — `npm run pack:extension` from the repo root writes
   `dist-extension/buildgentic-extension.zip`.
2. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   create a new item and upload that zip. **Do not submit it for review**;
   creating the draft is all that is needed.
3. Open the item's **Package** tab → **View public key**.
4. Copy the text *between* `-----BEGIN PUBLIC KEY-----` and
   `-----END PUBLIC KEY-----`, and join it into a single line with no
   newlines.
5. Paste it into `manifest.json` as a top-level `"key"` field.
6. Run `node extension/verify-key.js`. It prints the id that key yields and
   the exact `NEUROLINK_EXTENSION_ORIGIN` / `VITE_EXTENSION_ID` values to
   set — copied from a computed value rather than retyped from a dashboard.
7. Load the folder unpacked at `chrome://extensions` and confirm the id shown
   there matches. It is the same derivation, so a mismatch means the key was
   pasted wrong.

`key` is a **public** key. It belongs in git. The Store holds the private
half; there is no private key for this repository to leak.

## Permissions, and why they are what they are

`activeTab` + `scripting` rather than `host_permissions: ["<all_urls>"]`.
This is the decision the whole page-capture design rests on. `activeTab`
grants access to a tab **only after a user gesture on the extension** — its
icon, its keyboard command, its context-menu item. So "the extension only
reads the page when you ask it to" is not a rule this code follows; it is a
permission Chrome enforces. There is no moment at which extension code is
running on a page you did not just invoke it on, because the access does not
exist until you act.

The corollary bites, so it is worth stating: **the grant is per tab and dies
when that tab navigates.** A panel left open while somebody reads three
articles holds access to none of them. Two gestures re-grant it — the toolbar
icon, and the right-click item `contextMenus` adds — and the panel names both
when a capture is refused for want of access.

`sw.js` must **not** use `setPanelBehavior({ openPanelOnActionClick: true })`,
and the reason is the trap this whole section is about. The browser then
consumes the icon click to open the panel: `action.onClicked` never fires, and
`activeTab` is granted by an *invocation of the extension*, not by a panel
appearing — so it is never granted at all. The panel opens looking perfectly
healthy and every capture is refused. The click is therefore handled in
`onClicked`, which calls `sidePanel.open()` as its first statement, before any
`await` that would spend the user gesture.

`<all_urls>` is **not declared at all**, not even as an optional permission.
It used to sit in `optional_host_permissions` so that a future site-specific
phase could request it at runtime instead of taking a permission bump — but
a broad host permission that nothing requests is a question to answer at
Web Store review for a capability that does not exist yet. It costs nothing
to add back: `optional_host_permissions` can be introduced in the version
that first calls `chrome.permissions.request`, and only existing installs at
*that* point would see a prompt. Today there are none.

There are **no declared content scripts**, including on buildgentic.com. The
pairing page talks to the extension through `externally_connectable`, so
there is no extension code sitting on a page that holds your session.
