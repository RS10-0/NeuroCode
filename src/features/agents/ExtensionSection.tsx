import { useCallback, useEffect, useState } from "react";
import { Check, PanelRight, ScanText } from "lucide-react";

import { Badge, Callout } from "../../components/ui";
import {
  EXTENSION_SETTINGS_OFF,
  fetchExtensionSettings,
  fetchPageContextScope,
  saveExtensionSettings,
  type ExtensionSettings,
  type PageContextScope,
} from "./extensionApi";

/*
 * Where an agent is reachable FROM, as opposed to what it can
 * DO.
 *
 * This section lives on the Deploy screen rather than in
 * Capabilities, and the placement is the argument. Every entry
 * in CAPABILITIES answers "what may this agent do", and that
 * file opens with the rule that a capability is `ready` when the
 * runtime can carry it out — a toggle that flips and changes
 * nothing about the answers is worse than no toggle. Extension
 * eligibility changes nothing about any answer. It would have
 * been the first entry in that list for which `ready` meant
 * nothing.
 *
 * It is also the same kind of thing a deployment key and a
 * published page are, and those are already here. Grouping the
 * three ways an agent can be reached on one screen is worth
 * doing on its own: an owner can see every door at once instead
 * of three screens apart.
 *
 * TWO SWITCHES, NOT ONE, and the split is the argument vocab.ts
 * makes for keeping email_draft apart from email_send: an owner
 * who wants the smaller grant should not have to make the larger
 * one. An agent you want in the side panel for quick questions
 * while you work is not necessarily an agent you want reading
 * whatever is on your screen.
 */

interface Props {
  agentId: string | null;
  /* Whether the agent has been saved. Settings hang off a saved
     agent, exactly as memories and records do. */
  saved: boolean;
}

export default function ExtensionSection({ agentId, saved }: Props) {
  const [settings, setSettings] = useState<ExtensionSettings>(
    EXTENSION_SETTINGS_OFF
  );
  const [scope, setScope] = useState<PageContextScope>("unknown");
  /*
   * Initialised from whether there is anything to load, rather
   * than flipped on inside the effect below.
   *
   * `setLoading(true)` in an effect body is a synchronous
   * setState during render, which is the cascading render the
   * lint rule is right about — the same reason EmailSection
   * writes its first read as its own async body instead of
   * calling `refresh`. Starting true when an agent id exists
   * says the same thing without the extra render.
   */
  const [loading, setLoading] = useState(Boolean(agentId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [next, nextScope] = await Promise.all([
          fetchExtensionSettings(agentId),
          fetchPageContextScope(),
        ]);

        if (!cancelled) {
          setSettings(next);
          setScope(nextScope);
        }
      } catch (problem) {
        if (!cancelled) {
          setError(
            problem instanceof Error
              ? problem.message
              : "Unable to load extension settings."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const save = useCallback(
    async (next: ExtensionSettings) => {
      if (!agentId) {
        return;
      }

      /* Optimistic, then reconciled with what the server kept.
         The write normalises page context off when the agent is
         off, so the value that comes back can differ from the
         one sent — and the switch must show what is stored. */
      setSettings(next);
      setError(null);

      try {
        setSettings(await saveExtensionSettings(agentId, next));
      } catch (problem) {
        setSettings(await fetchExtensionSettings(agentId));
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to save that setting."
        );
      }
    },
    [agentId]
  );

  const pageBlocked = scope !== "allowed";

  return (
    <section className="agentsec" aria-labelledby="agentsec-extension">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-extension">
          Browser extension
        </h2>
        <p className="agentsec__lede">
          Talk to this agent from a side panel while you are on any website,
          without coming back here.
        </p>
      </div>

      <div className="agentsec__body">
        {!saved || !agentId ? (
          <Callout tone="info">
            Save this agent first. Extension settings are stored against a
            saved agent, not a draft.
          </Callout>
        ) : (
          <>
            {error ? <Callout tone="error">{error}</Callout> : null}

            <ul className="caps">
              <li>
                <button
                  type="button"
                  className={
                    settings.extensionEnabled ? "cap cap--on" : "cap"
                  }
                  aria-pressed={settings.extensionEnabled}
                  aria-disabled={loading}
                  onClick={() => {
                    if (!loading) {
                      void save({
                        ...settings,
                        extensionEnabled: !settings.extensionEnabled,
                      });
                    }
                  }}
                >
                  <span className="cap__mark" aria-hidden="true">
                    {settings.extensionEnabled ? (
                      <Check size={16} />
                    ) : (
                      <PanelRight size={16} />
                    )}
                  </span>

                  <span className="cap__body">
                    <span className="cap__title">Show in the side panel</span>

                    <span className="cap__blurb">
                      This agent appears in the extension's list, so you can
                      ask it something without leaving the page you are on.
                    </span>

                    <span className="cap__hint">
                      It can still do exactly what it does here — no more and
                      no less. Everything you switch off in Capabilities stays
                      off in the extension, immediately, with nothing to
                      change in two places. Off by default for every agent.
                    </span>
                  </span>
                </button>
              </li>

              <li>
                <button
                  type="button"
                  className={
                    !settings.extensionEnabled || pageBlocked
                      ? "cap cap--soon"
                      : settings.extensionPageContext
                        ? "cap cap--on"
                        : "cap"
                  }
                  /*
                   * aria-disabled rather than disabled, the same
                   * choice CapabilitiesSection makes: the entry
                   * stays reachable by keyboard so the
                   * explanation below can be read, which is the
                   * whole reason it is still on screen when it
                   * cannot be switched on.
                   */
                  aria-disabled={
                    loading || !settings.extensionEnabled || pageBlocked
                  }
                  aria-pressed={
                    settings.extensionEnabled && !pageBlocked
                      ? settings.extensionPageContext
                      : undefined
                  }
                  onClick={() => {
                    if (loading || !settings.extensionEnabled || pageBlocked) {
                      return;
                    }

                    void save({
                      ...settings,
                      extensionPageContext: !settings.extensionPageContext,
                    });
                  }}
                >
                  <span className="cap__mark" aria-hidden="true">
                    {settings.extensionPageContext ? (
                      <Check size={16} />
                    ) : (
                      <ScanText size={16} />
                    )}
                  </span>

                  <span className="cap__body">
                    <span className="cap__title">
                      Read the page

                      {pageBlocked ? (
                        <span className="cap__soon">
                          {scope === "denied"
                            ? "Not on this account"
                            : "Not available yet"}
                        </span>
                      ) : null}
                    </span>

                    <span className="cap__blurb">
                      Let this agent see the page you are looking at, or the
                      text you have selected on it, when you ask it something
                      there.
                    </span>

                    <span className="cap__hint">
                      {pageBlocked
                        ? /*
                           * The two refusals say different
                           * things because only one of them is
                           * fixable, and a learner deserves to
                           * know which they are looking at.
                           */
                          scope === "denied"
                          ? "Reading web pages is switched off for this account. Your agent still works in the side panel — it just answers from what you type rather than from the page. This is not something you can change here."
                          : "Reading web pages is not switched on for this account yet. Your agent still works in the side panel and answers from what you type. Nothing is being read from any page you visit."
                        : "It only ever reads when you ask it to, on the page you asked from — never in the background, and never on any other tab. What it read is shown to you, and it is not kept afterwards. One thing worth knowing: a web page is written by a stranger, so treat what your agent says about one the way you would treat the page itself."}
                    </span>
                  </span>
                </button>
              </li>
            </ul>

            <p className="agentsec__note">
              <Badge tone={settings.extensionEnabled ? "correct" : "neutral"}>
                {settings.extensionEnabled ? "in the panel" : "hidden"}
              </Badge>{" "}
              You still have to connect each browser once, from the extension
              itself. Connecting a browser on its own gives it nothing — it
              only ever sees the agents you have switched on here.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
