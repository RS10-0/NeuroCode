import SiteChat from "./SiteChat";
import { Section, SiteAvatar, SiteFooter } from "./parts";
import type { TemplateProps } from "./SiteRenderer";

/*
 * TEMPLATE 1 — AI ASSISTANT
 *
 * The chat is the page.
 *
 * One centred column, the hero kept short, and the composer
 * above the fold on any reasonable screen. Everything the
 * student wrote sits below it, because on this layout the
 * sections are context for a conversation somebody has already
 * started rather than material they are meant to read first.
 */

export default function AssistantTemplate({
  slug,
  config,
  agent,
  chatLive,
}: TemplateProps) {
  return (
    <>
      <div className="site__wrap">
        <header className="site-hero">
          {config.hero.showAvatar ? (
            <SiteAvatar agent={agent} size="lg" />
          ) : null}

          {config.hero.tagline ? (
            <span className="site-tagline">{config.hero.tagline}</span>
          ) : null}

          <h1 className="site-hero__headline">{config.hero.headline}</h1>

          {config.hero.subtext ? (
            <p className="site-hero__subtext">{config.hero.subtext}</p>
          ) : null}
        </header>

        {config.chat.enabled ? (
          <div className="site-chatslot">
            <SiteChat
              slug={slug}
              agent={agent}
              config={config.chat}
              live={chatLive}
            />
          </div>
        ) : null}
      </div>

      {config.sections.length > 0 ? (
        <div className="site-sections">
          <div className="site__wrap">
            {config.sections.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="site__wrap">
        <SiteFooter
          showBadge={config.footer.showBadge}
          note={config.footer.note}
        />
      </div>
    </>
  );
}
