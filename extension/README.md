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

`config.js` holds the two addresses. The defaults are the local dev server
(`http://localhost:3001`) and the local web app (`http://localhost:5199`).
If Vite moved to another port — it does when 5199 is taken — change
`WEB_ORIGIN` and the matching entry under `externally_connectable` in
`manifest.json`, because that list is what allows the pairing page to talk to
the extension at all.

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

`icons/` is empty in the repository. Chrome will load the extension without
icons and draw a placeholder; add `16.png`, `48.png` and `128.png` before
publishing.

## Permissions, and why they are what they are

`activeTab` + `scripting` rather than `host_permissions: ["<all_urls>"]`.
This is the decision the whole page-capture design rests on. `activeTab`
grants access to a tab **only after a user gesture on the extension** — its
icon, its keyboard command, its context-menu item. So "the extension only
reads the page when you ask it to" is not a rule this code follows; it is a
permission Chrome enforces. There is no moment at which extension code is
running on a page you did not just invoke it on, because the access does not
exist until you act.

`<all_urls>` is declared as **optional** and never requested. It is there so
a future site-specific phase can ask for it at runtime rather than needing a
permission bump that re-prompts every existing install.

There are **no declared content scripts**, including on buildgentic.com. The
pairing page talks to the extension through `externally_connectable`, so
there is no extension code sitting on a page that holds your session.
