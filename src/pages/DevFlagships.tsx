import { useState } from "react";

import {
  FLAGSHIPS,
  flagshipPublishable,
  type FlagshipId,
} from "../features/agents/flagships";
import SiteRenderer from "../features/sites/render/SiteRenderer";
import { starterConfig } from "../features/sites/templates";
import type { PublicSite } from "../features/sites/publicApi";

/*
 * Developer gallery — the signature pages.
 *
 * Mounted only under `import.meta.env.DEV` and outside the auth
 * gate, exactly like /dev/sites and /dev/activities: these
 * layouts can be looked at, resized and clicked through without
 * a database, a purchase, a deployment or a published page. Not
 * part of the product, and tree shaken out of a production
 * build.
 *
 * It renders the REAL `SiteRenderer` against the shape the
 * public endpoint returns, so what is on screen here is what a
 * visitor gets — including the branch that picks a signature
 * page over a template, which is the thing most worth being
 * able to see.
 *
 * AN AGENT WITH NO PUBLIC PAGE IS NOT IN THE PICKER, and the
 * omission is load-bearing rather than tidy.
 *
 * Email Agent sets `publishable: false`, so it has no identity
 * in identity.ts and `FlagshipSite` returns null for it. Listed
 * anyway, selecting it fell through to the generic template and
 * rendered starterConfig's PLACEHOLDER copy — "Replace this
 * with something only your agent does" — under BuildGentic's
 * own agent's name. That is a page for an agent that must never
 * have one, showing text nobody could ever edit, in the tool
 * whose entire job is showing what a visitor really gets.
 *
 * So the picker is built from what is publishable, and the
 * count in the heading is derived rather than written down.
 *
 * The stored config is deliberately the plain starter: a
 * flagship page takes its content from the catalogue rather
 * than from the row, so passing the barest possible document
 * proves that.
 */

const CHROME_HEIGHT = 44;

export default function DevFlagships() {
  /* Only the ones that get a page at all. See the header. */
  const publishable = FLAGSHIPS.filter((entry) =>
    flagshipPublishable(entry.id)
  );

  const [id, setId] = useState<FlagshipId>("writing-coach");
  const [live, setLive] = useState(true);

  const flagship =
    publishable.find((entry) => entry.id === id) ?? publishable[0];

  const site: PublicSite = {
    slug: `dev-${flagship.id}`,
    config: starterConfig({
      agentName: flagship.name,
      description: flagship.description,
      template: "assistant",
    }),
    agent: {
      name: flagship.name,
      avatarEmoji: flagship.avatarEmoji,
      avatarTone: flagship.avatarTone,
      flagshipId: flagship.id,
    },
    /* Live by default so the composer, the prompts and the
       failure state are all reachable. Sending here really does
       call the API, which really does 404 on a slug that was
       never published — which is the error path worth being
       able to look at. */
    chatLive: live,
  };

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          height: CHROME_HEIGHT,
          padding: "0 16px",
          background: "#101010",
          color: "#f4f4f4",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <span style={{ opacity: 0.6 }}>
          signature pages ({publishable.length} of {FLAGSHIPS.length})
        </span>

        {publishable.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setId(entry.id)}
            style={{
              border: "1px solid",
              borderColor: entry.id === id ? "#f4f4f4" : "#3a3a3a",
              background: entry.id === id ? "#f4f4f4" : "transparent",
              color: entry.id === id ? "#101010" : "#c8c8c8",
              font: "inherit",
              padding: "3px 8px",
              cursor: "pointer",
            }}
          >
            {entry.name}
          </button>
        ))}

        <label style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          chatLive
        </label>
      </div>

      {/* Keyed so switching pages remounts rather than reusing a
          transcript from the previous agent. */}
      <SiteRenderer key={`${flagship.id}-${String(live)}`} site={site} />
    </div>
  );
}
