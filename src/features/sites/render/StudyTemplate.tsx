import { useCallback, useState } from "react";

import SiteChat from "./SiteChat";
import { Section, SiteAvatar, SiteFooter } from "./parts";
import type { TemplateProps } from "./SiteRenderer";

/*
 * TEMPLATE 2 — STUDY TOOL
 *
 * A workspace rather than a page.
 *
 * Two columns filling the viewport: a sticky rail carrying the
 * agent's identity and its suggested prompts, and a chat that
 * runs the full height beside it. Somebody is going to sit with
 * this for half an hour, so the transcript gets the room and
 * the page's written content waits below the fold.
 *
 * The prompts move into the rail on this layout, which is why
 * the chat is told to hide its own. That is a prop rather than
 * a stylesheet rule, and it has to stay one: the rail keeps its
 * prompts at every width, because CSS cannot re-render an
 * element React was told to leave out — see the note in
 * sites.css for the bug that made the point.
 */

export default function StudyTemplate({
  slug,
  config,
  agent,
  chatLive,
}: TemplateProps) {
  /*
   * A prompt in the rail has to reach the conversation, which
   * lives inside SiteChat.
   *
   * The counter is what makes clicking the same suggestion
   * twice work: the chat sends on a changed id rather than on
   * changed text, so two clicks on "Quiz me" are two questions
   * rather than one question and one dead button.
   */
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();

  const askPrompt = useCallback((prompt: string) => {
    setAsk((current) => ({ text: prompt, id: (current?.id ?? 0) + 1 }));
  }, []);

  return (
    <>
      <div className="site__wrap">
        <div className="site-workspace">
          <aside className="site-rail">
            <div className="site-rail__id">
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
            </div>

            {config.chat.enabled && config.chat.suggestedPrompts.length > 0 ? (
              <div className="site-rail__prompts">
                <p className="site-rail__label">Try asking</p>

                {config.chat.suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="site-rail__prompt"
                    onClick={() => askPrompt(prompt)}
                    disabled={!chatLive}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </aside>

          {config.chat.enabled ? (
            <div className="site-chatslot">
              <SiteChat
                slug={slug}
                agent={agent}
                config={config.chat}
                live={chatLive}
                ask={ask}
                hidePrompts
              />
            </div>
          ) : null}
        </div>
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
