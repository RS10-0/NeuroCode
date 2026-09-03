import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, PanelRight, ShieldCheck, X } from "lucide-react";

import { Badge, Button, Callout, Panel } from "../components/ui";
import {
  listExtensionSessions,
  pairExtension,
  revokeExtensionSession,
  type ExtensionSession,
  type PairedExtension,
} from "../features/agents/extensionApi";

/*
 * Connecting a browser to BuildGentic.
 *
 * THE CONSENT SCREEN, and it is the only place the grant is
 * described in full — which is why it is a real page with real
 * copy rather than a confirm dialog.
 *
 * The extension opens this in a tab. The learner is already
 * signed in here, so there is no second login: pressing the
 * button mints a short-lived, extension-scoped token and hands
 * it to the extension over `externally_connectable`. The
 * extension never sees a Supabase session of any kind, and the
 * token it does get works on the extension's own routes and
 * nowhere else on this server.
 *
 * The most important sentence on this page is that connecting a
 * browser GRANTS NOTHING BY ITSELF. A freshly connected
 * extension with no extension-enabled agents lists nothing at
 * all. That belongs here, before somebody presses the button,
 * rather than being discovered afterwards as an empty panel
 * that looks broken.
 */

/*
 * The window in which the extension must claim the token.
 *
 * The handoff is a `postMessage` to an extension that is
 * listening because it opened this tab. If it is not there —
 * the learner navigated here themselves, or the extension was
 * removed — the token would otherwise sit in a page that has no
 * way to use it.
 */
const HANDOFF_MS = 10_000;

type Phase = "idle" | "pairing" | "waiting" | "done" | "no-extension";

/*
 * The extension's id, injected at build time.
 *
 * Absent in a plain web build, which is a normal state rather
 * than a misconfiguration: somebody who lands on this page
 * without the extension installed should be told what it is,
 * not shown an error about an environment variable.
 */
const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID as string | undefined;

/*
 * A name for this browser, good enough to tell two of them
 * apart on a settings screen.
 *
 * Deliberately coarse. The label is stored, so it should say
 * "Chrome on Windows" and not carry a full user-agent string —
 * a device fingerprint is not something this feature needs and
 * therefore not something it should keep.
 */
function browserLabel(): string {
  const agent = navigator.userAgent;

  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Chrome\//.test(agent)
      ? "Chrome"
      : "This browser";

  const platform = /Windows/.test(agent)
    ? "Windows"
    : /Mac OS X/.test(agent)
      ? "macOS"
      : /Linux/.test(agent)
        ? "Linux"
        : null;

  return platform ? `${browser} on ${platform}` : browser;
}

export default function ExtensionConnect() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ExtensionSession[]>([]);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listExtensionSessions());
    } catch {
      /* The list is context, not the task. A failure to load it
         must not stop somebody connecting a browser. */
    }
  }, []);

  /*
   * The first read, written as its own async body rather than
   * as a call to `refresh` — the same shape EmailSection uses,
   * and for the same reason: the linter treats a call into a
   * setState-bearing callback from an effect body as a
   * synchronous update, and the cascading render it warns about
   * is real.
   */
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const next = await listExtensionSessions();

        if (active) {
          setSessions(next);
        }
      } catch {
        /* The list is context, not the task. */
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);

    /*
     * The handoff.
     *
     * `chrome.runtime.sendMessage` from the page itself, which
     * is what `externally_connectable` in the manifest allows.
     * Deliberately NOT a content script: a content script on
     * buildgentic.com would be extension code with standing
     * access to a page that holds a session, and not having one
     * means there is nothing there to compromise.
     */
    const runtime = (
      window as unknown as {
        chrome?: {
          runtime?: {
            sendMessage?: (
              id: string,
              message: unknown,
              callback: (response?: { ok?: boolean }) => void
            ) => void;
            lastError?: { message?: string };
          };
        };
      }
    ).chrome?.runtime;

    /*
     * REACHABILITY IS CHECKED BEFORE ANYTHING IS MINTED, and
     * the order is the whole point.
     *
     * Minting first meant that somebody who opened this page
     * themselves — no extension installed, which is the common
     * way to arrive here — got a token written to
     * `extension_sessions` and then a message saying nothing
     * had been connected, with the row they had just created
     * listed underneath it. The page contradicted itself, and
     * the half that was true was the smaller print.
     *
     * There is nothing to undo if we never started.
     */
    if (!EXTENSION_ID || !runtime?.sendMessage) {
      setPhase("no-extension");
      return;
    }

    setPhase("pairing");

    let paired: PairedExtension;

    try {
      paired = await pairExtension(browserLabel());
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Unable to connect this browser."
      );
      setPhase("idle");
      return;
    }

    setPhase("waiting");

    /*
     * One outcome only. The timeout and the callback race each
     * other by design — a slow extension answers after we have
     * given up — and without this the loser revokes the token
     * the winner just accepted.
     */
    let settled = false;

    const settle = (next: Phase) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      setPhase(next);
      void refresh();
    };

    /*
     * The extension was there but never took the token, so the
     * row it was minted for describes a browser that is not
     * connected. Revoking it is what keeps "nothing has been
     * connected" true — the plaintext is already gone, so the
     * row could never be used, but a list showing a phantom
     * browser with a Disconnect button is its own problem.
     */
    const abandon = async () => {
      if (settled) {
        return;
      }

      /*
       * The outcome is claimed BEFORE the await, not after it.
       *
       * Revoking takes a round trip, and a slow extension can
       * answer inside it. Settling afterwards would let that
       * late `ok` win the phase while this function had already
       * destroyed the token behind it — a screen saying
       * Connected over a browser that is not.
       *
       * Claiming first makes the late answer a no-op. The
       * extension is left holding a revoked token, fails its
       * next call, and pairs again, which is the outcome the
       * sliding-expiry design already handles.
       */
      settled = true;
      clearTimeout(timer);

      try {
        await revokeExtensionSession(paired.sessionId);
      } catch {
        /* Best effort. An unusable row is a smaller problem
           than an error about one, and its own expiry takes it
           either way. */
      }

      setPhase("no-extension");
      void refresh();
    };

    const timer = setTimeout(() => void abandon(), HANDOFF_MS);

    runtime.sendMessage(
      EXTENSION_ID,
      { type: "buildgentic:pair", token: paired.token },
      (response) => {
        /*
         * `lastError` has to be READ, not merely ignored: Chrome
         * logs an unchecked runtime error to the console
         * otherwise, and "the extension is not installed" is an
         * ordinary outcome of this call rather than a fault.
         */
        if (runtime.lastError || !response?.ok) {
          void abandon();
          return;
        }

        settle("done");
      }
    );
  }, [refresh]);

  const disconnect = useCallback(
    async (id: string) => {
      try {
        await revokeExtensionSession(id);
        await refresh();
      } catch (problem) {
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to disconnect that browser."
        );
      }
    },
    [refresh]
  );

  return (
    <div className="extconnect">
      <header className="extconnect__head">
        <span className="extconnect__mark" aria-hidden="true">
          <PanelRight size={28} />
        </span>

        <h1 className="extconnect__title">Connect this browser</h1>

        <p className="extconnect__lede">
          So you can talk to your agents from a side panel while you are on
          any website, without signing in again.
        </p>
      </header>

      {error ? <Callout tone="error">{error}</Callout> : null}

      {phase === "done" ? (
        <Callout tone="correct">
          <strong>Connected.</strong> You can close this tab. Open the side
          panel from the extension's icon whenever you want to ask one of your
          agents something.
        </Callout>
      ) : null}

      {phase === "no-extension" ? (
        <Callout tone="caution">
          <strong>The extension did not answer.</strong> This page only works
          when the BuildGentic extension opens it — install the extension and
          press its icon, and it will bring you back here. If you got here on
          your own, nothing has been connected.
        </Callout>
      ) : null}

      {/* ---------------------------------------------------
          WHAT THE GRANT IS

          Written as two lists because the second one is the
          reason people say yes. An extension that can reach a
          learner's whole account is a different thing from one
          that can reach the three agents they picked, and the
          only way to show that difference is to say what it
          cannot do.
          --------------------------------------------------- */}
      <Panel>
        <h2 className="extconnect__subtitle">
          <ShieldCheck size={18} aria-hidden="true" /> What this lets the
          extension do
        </h2>

        <ul className="extconnect__list">
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Show the agents you have <strong>switched on for it</strong>, and
              let you chat with them. Every other agent stays invisible to it.
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Spend your XP when you ask something — the same 2 XP a test run
              in the Builder costs, from the same daily allowance.
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Read the page you are on, <strong>only</strong> for an agent you
              have turned that on for, and <strong>only</strong> at the moment
              you ask it something there.
            </span>
          </li>
        </ul>

        <h2 className="extconnect__subtitle">And what it cannot do</h2>

        <ul className="extconnect__list extconnect__list--no">
          <li>
            <X size={16} aria-hidden="true" />
            <span>
              Sign in as you anywhere. It never receives your password or your
              BuildGentic session — only a separate key that works in the side
              panel and nowhere else.
            </span>
          </li>
          <li>
            <X size={16} aria-hidden="true" />
            <span>
              Read pages in the background, on other tabs, or when you have not
              just asked it something. It cannot: your browser only grants it
              the page at the moment you press its button.
            </span>
          </li>
          <li>
            <X size={16} aria-hidden="true" />
            <span>
              Do anything an agent could not already do here. If you switched
              a capability off in the Builder, it is off in the side panel too
              — immediately, with nothing to change twice.
            </span>
          </li>
          <li>
            <X size={16} aria-hidden="true" />
            <span>
              Change your agents, buy anything, or send an email on its own.
            </span>
          </li>
        </ul>

        <Callout tone="info">
          <strong>Connecting on its own gives it nothing.</strong> Until you
          switch an agent on for the extension — on that agent's Deploy screen
          — the side panel will be empty. That is deliberate.
        </Callout>

        <div className="extconnect__actions">
          <Button
            variant="primary"
            onClick={() => void connect()}
            disabled={phase === "pairing" || phase === "waiting"}
          >
            {phase === "waiting"
              ? "Waiting for the extension…"
              : "Connect this browser"}
          </Button>

          <Link className="extconnect__link" to="/agents">
            Back to my agents
          </Link>
        </div>
      </Panel>

      {/* ---------------------------------------------------
          CONNECTED BROWSERS

          Here rather than only in Profile, because this is the
          page somebody lands on when they are thinking about
          browser access at all — and because revoking from a
          DIFFERENT browser is the case that matters. A token on
          a laptop somebody no longer has is exactly the one
          they need to be able to kill from somewhere else.
          --------------------------------------------------- */}
      {sessions.length > 0 ? (
        <Panel>
          <h2 className="extconnect__subtitle">Connected browsers</h2>

          <ul className="extconnect__sessions">
            {sessions.map((session) => (
              <li key={session.id}>
                <span className="extconnect__session">
                  <strong>{session.label}</strong>
                  <span className="extconnect__meta">
                    key ending {session.last4} ·{" "}
                    {session.lastUsedAt
                      ? `last used ${new Date(
                          session.lastUsedAt
                        ).toLocaleDateString()}`
                      : "not used yet"}
                  </span>
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void disconnect(session.id)}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>

          <p className="agentsec__note">
            <Badge tone="neutral">note</Badge> Disconnecting takes effect on
            that browser's very next question. A browser you have not used for
            30 days disconnects itself.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
