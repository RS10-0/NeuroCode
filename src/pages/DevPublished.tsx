import { useSurface } from "../components/Surface";
import { PublishedCard } from "./Published";
import type { Agent } from "../features/agents/types";
import type { PublishedItem } from "../features/agents/publishedApi";

/*
 * Developer gallery — every state a row on the Published page
 * can be in.
 *
 * Mounted only under `import.meta.env.DEV` and outside the auth
 * gate, exactly like the sites and desks galleries, and for a
 * sharper version of the same reason: reaching the real screen
 * with anything on it costs an account, a ready agent, a
 * deployment and a published page, and the states worth looking
 * at are the ones that need MORE than that — a page taken down,
 * an endpoint whose key was revoked. Those are close to
 * unreachable by hand, which is exactly how they would ship
 * broken. Run states have their own gallery at /dev/schedules.
 *
 * It renders the REAL PublishedCard, so what is on screen here
 * is what an owner gets. Only the data is fabricated.
 *
 * Every action on a card is a <Link> pointing at an agent id
 * that does not exist, so clicking one during a look-through
 * lands on the app's catch-all and loses the gallery. That is
 * the gallery's one rough edge and it is not worth a router to
 * fix — the first attempt at fixing it nested a MemoryRouter
 * inside the app's BrowserRouter, which React Router refuses
 * outright, and the crash was a blank page.
 */

const NOW = Date.now();

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function agent(
  id: string,
  name: string,
  emoji: string,
  tone: Agent["avatarTone"],
): Agent {
  return {
    id,
    name,
    description: "A fixture.",
    avatarEmoji: emoji,
    avatarTone: tone,
    instructions: "",
    model: "buildgentic-1",
    temperature: 0.7,
    maxOutputTokens: 1024,
    capabilities: ["chat"],
    status: "ready",
    isOfficial: false,
    flagshipId: null,
    createdAt: iso(-86_400_000 * 30),
    updatedAt: iso(-86_400_000),
  };
}

function deployment(id: string, publicId: string) {
  return {
    id,
    publicId,
    createdAt: iso(-86_400_000 * 12),
    endpoint: `https://api.buildgentic.com/api/v1/agents/${publicId}/chat`,
  };
}

function key(last4: string) {
  return {
    id: `key-${last4}`,
    last4,
    label: null,
    createdAt: iso(-86_400_000 * 12),
    lastUsedAt: iso(-1000 * 60 * 40),
    revokedAt: null,
  };
}

function site(
  slug: string,
  published: boolean,
  template: "assistant" | "study" | "portfolio" | "research",
  siteName: string,
) {
  return {
    id: `site-${slug}`,
    slug,
    url: `https://www.buildgentic.com/${slug}`,
    published,
    template,
    siteName,
    updatedAt: iso(-86_400_000 * 3),
  };
}

/* =========================================================
   THE STATES

   Ordered best to worst, which is also roughly the order a
   learner meets them.
========================================================= */

interface Case {
  title: string;
  note: string;
  item: PublishedItem;
  agent: Agent | null;
}

const CASES: Case[] = [
  {
    title: "Live, with schedules",
    note: "The good state. A page anybody can open, a key that answers, and two schedules — one running, one the owner switched off.",
    item: {
      agentId: "a1",
      deployment: deployment("d1", "3f9a1c04b7e25d81"),
      key: key("7b2c"),
      site: site("studybuddy", true, "study", "StudyBuddy"),
    },
    agent: agent("a1", "StudyBuddy", "📚", "accent"),
  },
  {
    title: "Page taken down",
    note: "The address is still theirs and the endpoint still answers, but nobody can open the page. The URL is struck through rather than hidden — it is what the link they already sent somebody points at.",
    item: {
      agentId: "a2",
      deployment: deployment("d2", "aa41b9e7c3d0f652"),
      key: key("91de"),
      site: site("careers-helper", false, "assistant", "Careers Helper"),
    },
    agent: agent("a2", "Careers Helper", "🧭", "caution"),
  },
  {
    title: "Deployed, no page",
    note: "Genuinely published — an app can call it — but there is no address a person can open. The row offers the missing half rather than only naming it.",
    item: {
      agentId: "a3",
      deployment: deployment("d3", "77c0e1a95b834fda"),
      key: key("04aa"),
      site: null,
    },
    agent: agent("a3", "Essay Feedback Bot", "✍️", "correct"),
  },
  {
    title: "Key revoked — the paused endpoint",
    note: "The page is up and answering; the API is not. A revoked key IS the pause, so both rows are true at once and the card has to show them separately.",
    item: {
      agentId: "a4",
      deployment: deployment("d4", "c5182bd3ea760194"),
      key: null,
      site: site("lab-notes", true, "research", "Lab Notes"),
    },
    agent: agent("a4", "Lab Notes", "🔬", "error"),
  },
  {
    title: "Long name, long slug, no agent on the shelf",
    note: "The overflow case and the missing-join case at once: the shelf query failed or the row is newer than it, and every string is as long as the schema allows.",
    item: {
      agentId: "a5",
      deployment: deployment("d5", "e2f4a6c8b0d1937500ff"),
      key: key("ffff"),
      site: site(
        "my-gcse-biology-revision-pal",
        true,
        "portfolio",
        "My GCSE Biology Revision Companion",
      ),
    },
    agent: null,
  },
];

export default function DevPublished() {
  /*
   * The gallery is mounted outside the app shell, so nothing
   * else sets the surface attribute every component stylesheet
   * reads its colours through. Without this the cards render
   * against the :root fallbacks and only look right if you
   * happened to arrive here from inside the app — which is
   * exactly the kind of accident a gallery exists to remove.
   * Same call the activities gallery makes, for the same
   * reason.
   */
  useSurface();

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Developer gallery</p>
        <h1 className="page__title">Published — every row state</h1>
        <p className="page__lede">
          The real <code>PublishedCard</code>, against fabricated data. Not part
          of the product; mounted only in development.
        </p>
      </header>

      {CASES.map((entry) => (
        <section key={entry.title} style={{ marginBottom: "var(--space-6)" }}>
          <h2 style={{ fontSize: "var(--text-md)" }}>{entry.title}</h2>
          <p
            className="meta"
            style={{
              marginBottom: "var(--space-3)",
              maxWidth: "62ch",
              lineHeight: "var(--leading-body)",
            }}
          >
            {entry.note}
          </p>

          <ul className="pubgrid">
            <PublishedCard item={entry.item} agent={entry.agent} />
          </ul>
        </section>
      ))}
    </div>
  );
}
