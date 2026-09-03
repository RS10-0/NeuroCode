import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

import SiteChat from "./SiteChat";
import { SectionBody, SiteAvatar, SiteFooter } from "./parts";
import type { TemplateProps } from "./SiteRenderer";

/*
 * TEMPLATE 3 — PORTFOLIO
 *
 * An editorial page that happens to have an agent attached.
 *
 * The hero fills the screen, the sections alternate as banded
 * rows with their headings held in a sticky left column, and
 * the chat is a launcher in the corner rather than a panel on
 * the page. That ordering is the argument this template makes:
 * somebody arriving here is judging the project — a teacher, a
 * competition, an admissions reader — so they should read
 * before they type, and the demo should be one click away
 * rather than the first thing competing for their attention.
 *
 * The dock is the only piece of chrome in this feature that
 * floats, and it is `position: fixed` rather than sticky so it
 * stays reachable through a long scroll.
 */

export default function PortfolioTemplate({
  slug,
  config,
  agent,
  chatLive,
}: TemplateProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="site__wrap">
        <header className="site-hero">
          {config.hero.tagline ? (
            <span className="site-tagline">{config.hero.tagline}</span>
          ) : null}

          <h1 className="site-hero__headline">{config.hero.headline}</h1>

          {config.hero.subtext ? (
            <p className="site-hero__subtext">{config.hero.subtext}</p>
          ) : null}

          {config.hero.showAvatar ? (
            <SiteAvatar agent={agent} size="lg" />
          ) : null}
        </header>
      </div>

      {config.sections.map((section) => (
        <div className="site-band" key={section.id}>
          <div className="site__wrap">
            <section className="site-section" id={`s-${section.id}`}>
              <h2 className="site-section__title">{section.title}</h2>
              <div>
                <SectionBody section={section} />
              </div>
            </section>
          </div>
        </div>
      ))}

      <div className="site__wrap">
        <SiteFooter
          showBadge={config.footer.showBadge}
          note={config.footer.note}
        />
      </div>

      {config.chat.enabled ? (
        <div className="site-dock">
          {open ? (
            <div className="sitechat-dockpanel site-dock__panel">
              <SiteChat
                slug={slug}
                agent={agent}
                config={config.chat}
                live={chatLive}
              />
            </div>
          ) : null}

          <button
            type="button"
            className="site-dock__launch"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
          >
            {open ? (
              <>
                <X size={16} strokeWidth={2} aria-hidden="true" />
                Close
              </>
            ) : (
              <>
                <MessageCircle size={16} strokeWidth={2} aria-hidden="true" />
                {`Chat with ${agent.name}`}
              </>
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}
