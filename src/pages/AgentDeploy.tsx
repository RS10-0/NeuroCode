import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Link2,
  Paintbrush,
  RotateCcw,
  Server,
  Terminal,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Callout,
  CodeBlock,
  Dialog,
  Meter,
  Panel,
  Skeleton,
  useToast,
} from "../components/ui";
import AgentFace from "../features/agents/AgentFace";
import ExtensionSection from "../features/agents/ExtensionSection";
import { getAgent, listKnowledge, setAgentStatus } from "../features/agents/agentStore";
import { agentToDraft, type Agent, type KnowledgeEntry } from "../features/agents/types";
import { composeSystem } from "../features/agents/compose";
import { hasErrors, validateConfig } from "../features/agents/validate";
import {
  curlExample,
  deployAgent,
  fetchDeployment,
  removeDeployment,
  revokeDeploymentKey,
  rotateDeploymentKey,
  type DeploymentState,
} from "../features/agents/deploymentApi";
import {
  fetchSite,
  publishSite,
  type SiteState,
} from "../features/sites/siteApi";
import { useAiRuntime } from "../features/lab/useAiRuntime";
import type { AiRuntimeInfo } from "../lib/aiClient";

/*
 * Deploying an agent.
 *
 * The screen exists to answer four questions in order, because
 * they are the order a learner asks them in: is this agent
 * finished, what will answer and who pays for it, where do I
 * call it, and what happens to the key.
 *
 * The one thing this page is careful about above all others is
 * the credential. A deployment key is shown exactly once, in the
 * response that mints it, and nothing on this screen or on the
 * server can produce it again — the server keeps a hash. So the
 * reveal is loud, it says plainly that it will not be repeated,
 * and it says what the key can do, which is spend this learner's
 * AI allowance.
 */

/* Which model actually answers, by its display name rather than
   its id. Falls back to the id, which is honest. */
function findModel(agent: Agent, info: AiRuntimeInfo | null) {
  return info
    ? info.models.find((entry) => entry.id === agent.model)
    : undefined;
}

function modelName(agent: Agent, info: AiRuntimeInfo | null): string {
  return findModel(agent, info)?.displayName ?? agent.model;
}

function when(iso: string | null): string {
  if (!iso) {
    return "never";
  }

  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) {
    return "unknown";
  }

  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  return new Date(then).toLocaleDateString();
}

/* =========================================================
   COPY BUTTON

   Its own component only because it holds one piece of state —
   the tick that confirms the copy landed — and putting that in
   the page would re-render everything to animate a checkmark.
========================================================= */

function CopyButton({
  value,
  label,
  size = "sm",
  variant = "ghost",
  icon,
}: {
  value: string;
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size={size}
      variant={variant}
      icon={
        copied ? (
          <Check size={size === "lg" ? 16 : 14} />
        ) : (
          icon ?? <Copy size={size === "lg" ? 16 : 14} />
        )
      }
      onClick={() => {
        /* Fails in an insecure context — a dev server reached
           over a LAN address — where there is no clipboard to
           write to. The learner can still select the text. */
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/* =========================================================
   PAGE
========================================================= */

type LoadError = "not-found" | "failed";

interface Loaded {
  forId: string;
  agent: Agent | null;
  knowledge: KnowledgeEntry[];
  deployment: DeploymentState | null;
  /*
   * The public page, which is what this screen now leads with.
   *
   * Null when the sites API could not be reached — deliberately
   * distinct from "there is no page yet", which is a site of
   * `null` INSIDE a loaded state. The first is a failure worth
   * saying nothing confident about; the second is an ordinary
   * thing to offer to fix.
   */
  site: SiteState | null;
  error: LoadError | null;
}

export default function AgentDeploy() {
  const { agentId } = useParams<{ agentId: string }>();
  const runtime = useAiRuntime();
  const { notify } = useToast();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);

  /* The plaintext key, held only between minting it and the
     learner navigating away. Never read back from anywhere. */
  const [revealed, setRevealed] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<"rotate" | "revoke" | "remove" | null>(
    null
  );

  /*
   * The developer disclosure, closed by default and staying
   * closed even when a key has just been minted.
   *
   * Opening it automatically on deploy would put an API key and
   * a curl command in front of somebody who came here to get a
   * link, which is the whole thing this screen was rearranged
   * to stop doing. The summary carries a badge instead, so the
   * one-time key is announced without being imposed.
   */
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = useCallback(async (id: string): Promise<Loaded> => {
    try {
      const agent = await getAgent(id);

      if (!agent) {
        return {
          forId: id,
          agent: null,
          knowledge: [],
          deployment: null,
          site: null,
          error: "not-found",
        };
      }

      /*
       * Knowledge is loaded in full rather than counted, because
       * marking an agent ready has to measure the composed system
       * prompt against the runtime's budget — and that needs the
       * text, not the number of rows.
       */
      const [knowledge, deployment, site] = await Promise.all([
        listKnowledge(id),
        fetchDeployment(id),
        /*
         * Tolerated separately from the other two. A page is the
         * headline of this screen but not the substance of it:
         * if the sites API is down, deploying, keys and usage
         * should all still work, and the page section says it
         * could not be read rather than taking the screen with
         * it.
         */
        fetchSite(id).catch(() => null),
      ]);

      return { forId: id, agent, knowledge, deployment, site, error: null };
    } catch {
      return {
        forId: id,
        agent: null,
        knowledge: [],
        deployment: null,
        site: null,
        error: "failed",
      };
    }
  }, []);

  useEffect(() => {
    if (!agentId) {
      return;
    }

    let active = true;

    void load(agentId).then((next) => {
      if (active) {
        setLoaded(next);
      }
    });

    return () => {
      active = false;
    };
  }, [agentId, load]);

  const { refreshUsage } = runtime;

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const refresh = useCallback(async () => {
    if (!agentId) {
      return;
    }

    setLoaded(await load(agentId));
  }, [agentId, load]);

  /*
   * The load is stamped with the id it was fetched for, so
   * "still loading" is derived rather than a second flag — the
   * same trick AgentBuilder uses. Anything from a previous
   * agentId is treated as absent.
   */
  const current = loaded && loaded.forId === agentId ? loaded : null;

  const agent = current?.agent ?? null;
  const state = current?.deployment ?? null;
  const site = current?.site ?? null;
  const loadError = current?.error ?? null;

  /* Memoised because the readiness check below depends on it,
     and a fresh [] every render would recompute the composed
     system prompt on every keystroke elsewhere in the tree. */
  const knowledge = useMemo(() => current?.knowledge ?? [], [current]);

  const info = runtime.info;

  /*
   * Whether this agent could be marked ready.
   *
   * The same rules the Builder's Save button uses, plus the
   * system budget — because an over-budget agent saves fine and
   * then fails every deployed request, and the deploy screen is
   * the last place to catch that before strangers do.
   */
  const readiness = useMemo(() => {
    if (!agent || !info) {
      return { ok: false, reason: "" };
    }

    const draft = agentToDraft(agent);
    const model = info.models.find((entry) => entry.id === agent.model);

    const errors = validateConfig(draft, model, info.requestLimits);

    if (hasErrors(errors)) {
      return {
        ok: false,
        reason:
          Object.values(errors)[0] ??
          "This agent is not finished. Open the Builder to fix it.",
      };
    }

    const composed = composeSystem(
      draft,
      knowledge,
      info.requestLimits.maxSystemChars
    );

    if (composed.overBy > 0) {
      return {
        ok: false,
        reason: `Its instructions and knowledge are ${composed.overBy.toLocaleString()} characters over the limit. Shorten them in the Builder first.`,
      };
    }

    return { ok: true, reason: "" };
  }, [agent, info, knowledge]);

  /* --------------------------------------------------------
     ACTIONS
     -------------------------------------------------------- */

  const guard = useCallback(
    async (verb: string, action: () => Promise<void>) => {
      setBusy(true);

      try {
        await action();
      } catch (error) {
        notify(
          error instanceof Error ? error.message : `Could not ${verb}.`,
          "error"
        );
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  const onMarkReady = () =>
    guard("mark this agent ready", async () => {
      if (!agentId) {
        return;
      }

      await setAgentStatus(agentId, "ready");
      await refresh();
      notify("Agent marked as ready.", "correct");
    });

  /*
   * Deploying, and getting a page for it.
   *
   * Two calls rather than one, and the second is the reason
   * this screen reads the way it does. "Deployed" used to mean
   * "there is an endpoint and a key", which is a sentence that
   * means nothing to most of the people using this — so
   * publishing now also gives the agent the thing they can
   * actually show somebody: an address that opens in a browser.
   *
   * The page call is allowed to fail without failing the
   * deploy. The endpoint is the real thing being created here
   * and it exists either way; a page that could not be made is
   * a button on the next screen, not a rolled-back deployment.
   * Both calls are idempotent, so pressing Publish twice — or
   * in two tabs — lands on the same endpoint and the same page.
   */
  const onDeploy = () =>
    guard("publish this agent", async () => {
      if (!agentId) {
        return;
      }

      const result = await deployAgent(agentId);

      setRevealed(result.token);

      try {
        await publishSite(agentId, {});
      } catch {
        /* Reported by the page section, which will show its own
           "give this agent a page" button. */
      }

      await refresh();
      notify(
        result.token ? "Your agent is live." : "This agent is already live.",
        "correct"
      );
    });

  /*
   * For a deployment made before pages existed, and for the
   * case where the publish above did not land.
   */
  const onCreatePage = () =>
    guard("create this page", async () => {
      if (!agentId) {
        return;
      }

      await publishSite(agentId, {});
      await refresh();
      notify("Your page is live.", "correct");
    });

  const onRotate = () =>
    guard("issue a new key", async () => {
      if (!agentId) {
        return;
      }

      const result = await rotateDeploymentKey(agentId);
      setRevealed(result.token);
      setConfirm(null);
      await refresh();
      notify("New key issued. The old one no longer works.", "correct");
    });

  const onRevoke = () =>
    guard("revoke that key", async () => {
      if (!agentId) {
        return;
      }

      await revokeDeploymentKey(agentId);
      setRevealed(null);
      setConfirm(null);
      await refresh();
      notify("Key revoked. This endpoint now refuses every call.", "info");
    });

  const onRemove = () =>
    guard("remove this deployment", async () => {
      if (!agentId) {
        return;
      }

      await removeDeployment(agentId);
      setRevealed(null);
      setConfirm(null);
      await refresh();
      notify("Deployment removed.", "info");
    });

  /* --------------------------------------------------------
     LOADING AND FAILURE
     -------------------------------------------------------- */

  const loading = (runtime.loading && !info) || current === null;

  if (loading) {
    return (
      <div className="page">
        <div className="agentboot">
          <Skeleton width="220px" height="34px" />
          <Skeleton width="100%" height="120px" />
          <Skeleton width="100%" height="240px" />
        </div>
      </div>
    );
  }

  if (loadError || !agent) {
    return (
      <div className="page">
        <Callout
          tone={loadError === "not-found" ? "caution" : "error"}
          title={
            loadError === "not-found"
              ? "That agent does not exist"
              : "This agent could not be loaded"
          }
        >
          <p>
            It may have been deleted, or it may belong to a different account.{" "}
            <Link to="/agents">Back to My Agents</Link>
          </p>
        </Callout>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="page">
        <Callout
          tone="error"
          title="Deployment could not reach BuildGentic's AI runtime"
        >
          <p>
            Without the model catalogue there is no way to say what this agent
            would answer with, so deploying it is refused rather than guessed
            at. Check that the BuildGentic server is running, then reload.
          </p>
        </Callout>
      </div>
    );
  }

  /* --------------------------------------------------------
     CONTENT
     -------------------------------------------------------- */

  const deployment = state?.deployment ?? null;
  const key = state?.key ?? null;
  const usage = state?.usage ?? null;
  const limits = state?.limits;
  const live = Boolean(deployment && key);

  const page = site?.site ?? null;

  return (
    <div className="page">
      <header className="page__header deployhead">
        <div>
          <p className="page__eyebrow">Agents</p>

          <h1 className="page__title deployhead__title">
            <AgentFace emoji={agent.avatarEmoji} tone={agent.avatarTone} size="md" />
            Share {agent.name}
          </h1>

          <p className="page__lede">
            Publishing gives {agent.name} its own web page — a link you can send
            to anyone. They can open it and talk to your agent without a
            BuildGentic account.
          </p>
        </div>

        <Link className="btn btn--ghost btn--sm" to={`/agents/${agent.id}`}>
          <span className="btn__icon" aria-hidden="true">
            <ArrowLeft size={15} />
          </span>
          Back to Builder
        </Link>
      </header>

      {/* ---- READINESS ---- */}

      {agent.status !== "ready" ? (
        <Callout tone="caution" title="This agent is still a draft">
          <p>
            A draft is yours to test and change. Marking it ready is you saying
            it is good enough for other people to use — which is what
            publishing actually shares.
          </p>

          {readiness.ok ? (
            <p style={{ marginTop: "var(--space-3)" }}>
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={onMarkReady}
              >
                Mark as ready
              </Button>
            </p>
          ) : (
            <p style={{ marginTop: "var(--space-3)" }}>
              <strong>Not ready yet.</strong> {readiness.reason}
            </p>
          )}
        </Callout>
      ) : null}

      {/* =====================================================
          THE PRIMARY VIEW

          One thing on this screen matters to most of the people
          who reach it: the link. So it is the biggest thing on
          the page, it is selectable text rather than a tooltip,
          and the two buttons beside it are the two things
          anybody actually does with a link.

          Everything that used to be here — the endpoint, the
          key, the curl, the meters — is real and is kept, one
          disclosure below. None of it is the answer to "did it
          work?", which is the question somebody arriving here
          is asking.
          ===================================================== */}

      {!deployment ? (
        <section className="deployhero deployhero--idle">
          <h2 className="deployhero__title">Not published yet</h2>

          <p className="deployhero__lede">
            Publishing creates a web page for {agent.name} at its own address.
            You can change how the page looks afterwards, and take it down
            whenever you like.
          </p>

          <Button
            variant="primary"
            size="lg"
            disabled={busy || agent.status !== "ready"}
            onClick={onDeploy}
          >
            Publish {agent.name}
          </Button>

          {agent.status !== "ready" ? (
            <p className="deployhero__hint">
              Mark it as ready first, above.
            </p>
          ) : null}
        </section>
      ) : (
        <section className="deployhero">
          <span className="deployhero__tick" aria-hidden="true">
            <Check size={22} strokeWidth={3} />
          </span>

          <h2 className="deployhero__title">
            {page && page.published
              ? `${agent.name} is live`
              : `${agent.name} is published`}
          </h2>

          {/* ---- the link, or the reason there is not one ---- */}

          {page && page.published ? (
            <>
              <p className="deployhero__lede">
                Anyone with this link can open it and chat with your agent. They
                do not need an account.
              </p>

              {/*
                A real element with the URL as its text, not a
                button that copies something invisible. Somebody
                reading it out, screenshotting it, or writing it
                on a whiteboard is the commonest way one of these
                gets shared.
              */}
              <p className="deployhero__url">{page.url}</p>

              <div className="deployhero__actions">
                <a
                  className="btn btn--primary btn--lg"
                  href={page.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="btn__icon" aria-hidden="true">
                    <ExternalLink size={17} />
                  </span>
                  Open My Page
                </a>

                <CopyButton
                  value={page.url}
                  label="Copy Link"
                  size="lg"
                  variant="secondary"
                  icon={<Link2 size={16} />}
                />
              </div>

              <Link className="deployhero__tweak" to={`/agents/${agent.id}/site`}>
                <Paintbrush size={14} aria-hidden="true" />
                Change how the page looks
                <ChevronRight size={14} aria-hidden="true" />
              </Link>
            </>
          ) : page && !page.published ? (
            <>
              <p className="deployhero__lede">
                Your page is hidden at the moment, so the link does not open for
                anyone else. Your address is still yours.
              </p>

              <Link
                className="btn btn--primary btn--lg"
                to={`/agents/${agent.id}/site`}
              >
                Make it public again
              </Link>
            </>
          ) : site ? (
            <>
              <p className="deployhero__lede">
                This agent is running, but it does not have a web page yet. One
                click gives it an address anybody can open.
              </p>

              <Button
                variant="primary"
                size="lg"
                disabled={busy}
                onClick={onCreatePage}
              >
                Create my page
              </Button>
            </>
          ) : (
            <p className="deployhero__lede">
              Your agent is running. Its web page could not be loaded just now —
              reload the screen to try again.
            </p>
          )}
        </section>
      )}

      {/* =====================================================
          ADVANCED — everything this screen used to lead with

          A <details> rather than a button and a conditional
          render, because the native element is keyboard
          accessible, announced correctly, and findable by the
          browser's own in-page search even while collapsed. A
          student looking for the word "curl" will find it here
          without knowing the section exists.
          ===================================================== */}

      {deployment ? (
        <details
          className="deployadv"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="deployadv__summary">
            <ChevronRight
              className="deployadv__chevron"
              size={16}
              aria-hidden="true"
            />

            <Terminal size={15} aria-hidden="true" />

            <span className="deployadv__label">
              Advanced: developer API access
            </span>

            {/*
              The one-time key is behind this fold, so when there
              is one waiting the fold says so. Without this, a
              student who deployed and never opened the section
              would lose a secret they were never told existed —
              regenerating is one click, but being surprised by
              it is avoidable.
            */}
            {revealed ? (
              <Badge tone="caution">New key — shown once</Badge>
            ) : (
              <Badge tone={live ? "correct" : "caution"}>
                {live ? "Live" : "No active key"}
              </Badge>
            )}
          </summary>

          <div className="deployadv__body">
            <p className="deploysec__note">
              None of this is needed to share your page. It is here for calling{" "}
              {agent.name} from your own code — a script, a game, a Discord bot
              — instead of through the page.
            </p>

            {/* ---- WHAT WILL ANSWER ---- */}

            <Panel title="What will answer" className="deploysec">
              <div className="agentcard__facts">
                <Badge tone="neutral" mono>
                  {modelName(agent, info)}
                </Badge>

                <Badge tone="accent" icon={<Server size={11} />}>
                  BuildGentic AI
                </Badge>

                {knowledge.length > 0 ? (
                  <Badge tone="neutral">
                    {knowledge.length} knowledge{" "}
                    {knowledge.length === 1 ? "entry" : "entries"}
                  </Badge>
                ) : null}

                {agent.capabilities.includes("web_search") ? (
                  <Badge tone="neutral" icon={<Globe size={11} />}>
                    Web search
                  </Badge>
                ) : null}
              </div>

              <p className="deploysec__note">
                Every request runs on{" "}
                <strong>BuildGentic&apos;s shared account</strong>, which is why
                this has an allowance. It spends the same daily budget your Lab
                and Builder runs do — including your XP, which is charged to you
                as the owner rather than to whoever calls it.
              </p>
            </Panel>

            {/* ---- ENDPOINT ---- */}

            <Panel title="Endpoint" className="deploysec">
              <div className="deployrow">
                <CodeBlock code={deployment.endpoint} caption="Endpoint" />
                <CopyButton value={deployment.endpoint} label="Copy URL" />
              </div>

              {!live ? (
                <Callout tone="caution" title="This endpoint has no active key">
                  <p>
                    The address still exists and every call to it is refused.
                    Issue a new key below to start answering again. Your web
                    page is unaffected — it does not use a key.
                  </p>
                </Callout>
              ) : null}

              <p className="deploysec__note">
                This is a server-to-server API. It deliberately sends no CORS
                headers, so a browser cannot call it from another site — a key
                that worked from a web page would be a key anyone could read out
                of your JavaScript.
              </p>
            </Panel>

            {/* ---- THE KEY, SHOWN ONCE ---- */}

            {revealed ? (
              <Callout
                tone="caution"
                title="Copy this key now — it is shown once"
              >
                <p>
                  BuildGentic stores only a hash of it, so there is no screen, no
                  support request and no database query that can show it to you
                  again. If you lose it, issue a new one.
                </p>

                <div className="deployrow">
                  <CodeBlock code={revealed} caption="Deployment key" />
                  <CopyButton value={revealed} label="Copy key" />
                </div>

                <p>
                  <strong>Treat it like a password.</strong> Anyone holding it
                  can make this agent answer, and every answer spends your
                  BuildGentic allowance. Keep it in a server environment variable
                  — never in browser code, a mobile app, or a public repository.
                </p>

                <CodeBlock
                  code={curlExample(deployment.endpoint, revealed)}
                  caption="Try it"
                />
              </Callout>
            ) : null}

            <Panel title="Key" className="deploysec">
              {key ? (
                <>
                  <p className="meta">
                    <code>…{key.last4}</code> · created {when(key.createdAt)} ·
                    last used {when(key.lastUsedAt)}
                  </p>

                  <p className="deploysec__note">
                    Only one key can reach a deployment at a time. Issuing a new
                    one revokes this one immediately, so rotating is a single
                    step with a single outcome.
                  </p>

                  <div className="deployactions">
                    <Button
                      size="sm"
                      icon={<RotateCcw size={14} />}
                      disabled={busy}
                      onClick={() => setConfirm("rotate")}
                    >
                      Regenerate key
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirm("revoke")}
                    >
                      Revoke key
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="deploysec__note">
                    No key can reach this deployment. Issuing one turns the
                    endpoint back on at the same address.
                  </p>

                  <Button
                    variant="primary"
                    size="sm"
                    icon={<KeyRound size={14} />}
                    disabled={busy}
                    onClick={onRotate}
                  >
                    Generate a key
                  </Button>
                </>
              )}
            </Panel>

            {/* ---- USAGE ---- */}

            {usage && limits ? (
              <Panel title="Usage" className="deploysec">
                <div className="deploymeters">
                  {limits.requestsPerDay > 0 ? (
                    <Meter
                      label="This endpoint, today"
                      used={usage.requestsDay}
                      limit={limits.requestsPerDay}
                      unit="requests"
                    />
                  ) : null}

                  {runtime.usage && runtime.usage.limits.requestsPerDay > 0 ? (
                    <Meter
                      label="Your BuildGentic allowance, today"
                      used={runtime.usage.used.requestsToday}
                      limit={runtime.usage.limits.requestsPerDay}
                      unit="requests"
                    />
                  ) : null}
                </div>

                <p className="meta">
                  {usage.requestsTotal.toLocaleString()} request
                  {usage.requestsTotal === 1 ? "" : "s"} all time ·{" "}
                  {usage.tokensDay.toLocaleString()} tokens today · last called{" "}
                  {when(usage.lastCalledAt)}
                </p>

                <p className="deploysec__note">
                  This has its own ceiling on top of yours, so one runaway
                  integration cannot spend your whole day before you notice it.
                  Visits to your web page are counted here too.
                </p>

                {usage.lastErrorCode ? (
                  <Callout tone="caution" title="Most recent failure">
                    <p>
                      <code>{usage.lastErrorCode}</code>,{" "}
                      {when(usage.lastErrorAt)}. Callers are only ever told the
                      agent is unavailable — the real reason is for you.
                    </p>
                  </Callout>
                ) : null}
              </Panel>
            ) : null}

            {/* ---- REMOVE ---- */}

            <Panel title="Unpublish" className="deploysec">
              <p className="deploysec__note">
                This retires the address, the key <strong>and the web page</strong>{" "}
                for good. Anything still calling it starts getting a 404, and
                the link you shared stops working. Your usage history is kept,
                and the agent itself is untouched.
              </p>

              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                disabled={busy}
                onClick={() => setConfirm("remove")}
              >
                Unpublish everything
              </Button>
            </Panel>
          </div>
        </details>
      ) : null}

      {/* ---------------------------------------------------
          THE THIRD DOOR

          A deployment key and a published page are the other
          two, and they are both above this. Grouping all three
          on one screen is the point: an owner can see every way
          their agent is reachable at once, rather than three
          screens apart.

          Unlike those two, this one grants nothing on its own —
          it makes the agent VISIBLE to a browser the owner has
          separately connected, and every capability it then has
          is the one the Builder already gave it.
          --------------------------------------------------- */}
      <ExtensionSection agentId={agentId ?? null} saved={Boolean(current)} />

      <Dialog
        open={confirm === "rotate"}
        title="Issue a new key?"
        text="The current key stops working immediately. Anything using it will start getting 401s until you paste the new one in. Your web page is unaffected."
        confirmLabel="Issue new key"
        busy={busy}
        onConfirm={onRotate}
        onCancel={() => setConfirm(null)}
      />

      <Dialog
        open={confirm === "revoke"}
        title="Revoke this key?"
        text="The endpoint stays at the same address and refuses every call until you issue a new key. Your web page keeps working — it does not use a key."
        confirmLabel="Revoke key"
        destructive
        busy={busy}
        onConfirm={onRevoke}
        onCancel={() => setConfirm(null)}
      />

      <Dialog
        open={confirm === "remove"}
        title="Unpublish this agent?"
        text="The web page, its address and the developer key are all retired permanently. The link you shared will stop working. The agent itself, and everything it knows, is untouched."
        confirmLabel="Unpublish everything"
        destructive
        busy={busy}
        onConfirm={onRemove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
