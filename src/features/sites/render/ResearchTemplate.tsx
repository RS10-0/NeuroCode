import SiteChat from "./SiteChat";
import { SectionBody, SiteFooter } from "./parts";
import { anchorFor } from "./anchors";
import type { TemplateProps } from "./SiteRenderer";

/*
 * TEMPLATE 4 — RESEARCH PROJECT
 *
 * A document with an agent bound into it.
 *
 * Contents rail on the left, a narrow measure for the body, the
 * subtext set as a pull-quote abstract, and numbered sections.
 * The chat sits directly beneath the abstract rather than at
 * either end of the page — which is the one real layout
 * decision here. On a writeup the demo belongs where a reader
 * first wonders whether the thing works, which is immediately
 * after being told what it claims to do, not at the bottom
 * after they have finished reading.
 */

export default function ResearchTemplate({
  slug,
  config,
  agent,
  chatLive,
}: TemplateProps) {
  const titled = config.sections.filter((section) => section.title);

  return (
    <div className="site__wrap">
      <div className="site-paper">
        {titled.length > 1 ? (
          <nav className="site-toc" aria-label="Contents">
            <p className="site-toc__label">Contents</p>

            {titled.map((section, index) => (
              <a
                className="site-toc__link"
                key={section.id}
                href={`#${anchorFor(section.id)}`}
              >
                {index + 1}. {section.title}
              </a>
            ))}
          </nav>
        ) : (
          /* The grid has two columns; without this the document
             would slide left into the rail's track when there
             is no rail to draw. */
          <div aria-hidden="true" />
        )}

        <div className="site-doc">
          <header className="site-hero">
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

          {config.sections.map((section, index) => (
            <section
              className="site-section"
              key={section.id}
              id={anchorFor(section.id)}
            >
              {section.title ? (
                <h2 className="site-section__title">
                  <span className="site-section__num" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </h2>
              ) : null}

              <SectionBody section={section} />
            </section>
          ))}

          <SiteFooter
            showBadge={config.footer.showBadge}
            note={config.footer.note}
          />
        </div>
      </div>
    </div>
  );
}
