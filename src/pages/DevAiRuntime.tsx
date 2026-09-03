import { useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, Play, RefreshCw, Trash2, Zap } from "lucide-react";

import { useSurface } from "../components/Surface";
import {
  Badge,
  Button,
  Callout,
  Field,
  Meter,
  Panel,
  Textarea,
} from "../components/ui";
import { authHeaders } from "../lib/api";
import {
  AiError,
  fetchAiRuntimeInfo,
  fetchAiUsage,
  sendChat,
  streamChat,
  type AiDoneInfo,
  type AiRuntimeInfo,
  type AiUsageReport,
} from "../lib/aiClient";

/*
 * Development harness for the AI runtime.
 *
 * Mounted only under `import.meta.env.DEV`, so it is tree-shaken
 * out of a production build entirely — the same treatment as the
 * activity gallery at /dev/activities. It is behind the auth
 * gate, because everything it exercises requires a real bearer
 * token and a harness that faked one would prove nothing.
 *
 * This is NOT the Lab. The Lab is a teaching surface: prompt,
 * compare, explain what moved. This page is an instrument panel
 * — it exists to show that an authenticated learner reaches an
 * answer, that text arrives progressively, that bad input is
 * refused, that limits bite, and that nothing on the wire names
 * a vendor.
 *
 * IT IS MUCH SMALLER THAN IT WAS. Most of this page used to be a
 * BYOK panel, a power-source selector and a model picker, and
 * none of those exist any more. What replaced its most valuable
 * part is scripts/verify-provider-cascade.mts, which can do the
 * thing this page never could: make a provider fail on demand
 * and prove the fallback is invisible.
 *
 * Nothing here has privileged access. It calls the same public
 * endpoints the Lab does, with the same token.
 */

interface ProbeResult {
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface StreamEventLog {
  at: number;
  type: string;
  detail: string;
}

export default function DevAiRuntime() {
  useSurface();

  const [info, setInfo] = useState<AiRuntimeInfo | null>(null);
  const [usage, setUsage] = useState<AiUsageReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("Explain a token in one sentence.");
  const [system, setSystem] = useState("");

  const [output, setOutput] = useState("");
  const [events, setEvents] = useState<StreamEventLog[]>([]);
  const [done, setDone] = useState<AiDoneInfo | null>(null);
  const [runError, setRunError] = useState<AiError | null>(null);
  const [streaming, setStreaming] = useState(false);

  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [probing, setProbing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextInfo, nextUsage] = await Promise.all([
        fetchAiRuntimeInfo(),
        fetchAiUsage().catch(() => null),
      ]);

      setInfo(nextInfo);
      setUsage(nextUsage);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof AiError ? error.message : String(error)
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const next = await load();

      if (!mounted) {
        return;
      }

      return next;
    })();

    return () => {
      mounted = false;
    };
  }, [load]);

  const log = useCallback((type: string, detail: string) => {
    setEvents((current) => [...current, { at: Date.now(), type, detail }]);
  }, []);

  async function run() {
    if (streaming) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setOutput("");
    setEvents([]);
    setDone(null);
    setRunError(null);

    try {
      const finished = await streamChat(
        {
          messages: [{ role: "user", content: prompt }],
          ...(system.trim() ? { system } : {}),
          feature: "dev_harness",
        },
        {
          onStart: () => log("start", "(carries nothing — by design)"),
          onDelta: (text) => {
            setOutput((current) => current + text);
          },
          onDone: (finish) => {
            log(
              "done",
              `${finish.finishReason} · ${finish.usage.inputTokens}→${finish.usage.outputTokens} tokens · ${finish.latencyMs}ms`
            );
          },
        },
        controller.signal
      );

      setDone(finished);
    } catch (error) {
      if (error instanceof AiError) {
        setRunError(error);
        log("error", `${error.code}: ${error.message}`);
      } else {
        log("error", String(error));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      void load();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  /* ---------------------------------------------------------
     PROBES

     Assertions about the wire, run against the real server. The
     leak checks are the ones that matter: everything else here
     is convenience.
     --------------------------------------------------------- */

  async function runProbes() {
    setProbing(true);
    setProbes([]);

    const results: ProbeResult[] = [];

    const add = (
      label: string,
      expected: string,
      actual: string,
      pass: boolean
    ) => {
      results.push({ label, expected, actual, pass });
      setProbes([...results]);
    };

    /* 1. A whole (non-streamed) answer comes back. */
    try {
      const whole = await sendChat({
        messages: [{ role: "user", content: "Say OK." }],
        maxOutputTokens: 16,
        feature: "dev_harness",
      });

      add(
        "sendChat returns text",
        "non-empty string",
        `${whole.text.slice(0, 40)}…`,
        whole.text.length > 0
      );

      /*
       * The important one. Anything in this body naming a vendor
       * is a leak: the whole point of the cascade is that the
       * learner never learns which of several providers answered.
       */
      const serialised = JSON.stringify(whole).toLowerCase();
      const leaked = [
        "groq",
        "cloudflare",
        "openrouter",
        "mistral",
        "gemini",
        "openai",
        "anthropic",
        "llama",
      ].filter((name) => serialised.includes(name));

      add(
        "no vendor name in the response body",
        "none",
        leaked.length ? leaked.join(", ") : "none",
        leaked.length === 0
      );

      add(
        "no provider/model field on the body",
        "absent",
        Object.keys(whole).join(", "),
        !("provider" in whole) && !("model" in whole)
      );
    } catch (error) {
      add(
        "sendChat returns text",
        "an answer",
        error instanceof AiError ? error.code : String(error),
        false
      );
    }

    /* 2. The runtime description names nothing either. */
    try {
      const described = await fetchAiRuntimeInfo();
      const serialised = JSON.stringify(described).toLowerCase();
      const leaked = [
        "groq",
        "cloudflare",
        "openrouter",
        "mistral",
        "gemini",
        "openai",
        "anthropic",
      ].filter((name) => serialised.includes(name));

      add(
        "GET /api/ai/models names no vendor",
        "none",
        leaked.length ? leaked.join(", ") : "none",
        leaked.length === 0
      );

      add(
        "the catalogue has exactly one public model",
        "1",
        String(described.models.length),
        described.models.length === 1
      );
    } catch (error) {
      add("GET /api/ai/models", "200", String(error), false);
    }

    /* 3. Bad input is refused rather than forwarded. */
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ messages: [], stream: false }),
      });

      add(
        "an empty conversation is refused",
        "400",
        String(response.status),
        response.status === 400
      );
    } catch (error) {
      add("an empty conversation is refused", "400", String(error), false);
    }

    /* 4. The retired BYOK routes are actually gone. */
    try {
      const response = await fetch("/api/ai/keys", {
        method: "GET",
        headers: await authHeaders(),
      });

      add(
        "GET /api/ai/keys is gone",
        "404",
        String(response.status),
        response.status === 404
      );
    } catch (error) {
      add("GET /api/ai/keys is gone", "404", String(error), false);
    }

    setProbing(false);
  }

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <p className="page__eyebrow">Development</p>
          <h1 className="page__title">AI runtime harness</h1>
          <p className="page__lede">
            An instrument panel for <code>/api/ai</code>. Not mounted in a
            production build.
          </p>
        </div>

        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          Reload
        </Button>
      </header>

      {loadError ? (
        <Callout tone="error" title="Could not read the runtime">
          {loadError}
        </Callout>
      ) : null}

      <Panel title="Runtime">
        {info ? (
          <dl className="kv">
            <div className="kv__row">
              <dt>Default model</dt>
              <dd>
                <Badge mono>{info.defaultModel}</Badge>
              </dd>
            </div>
            <div className="kv__row">
              <dt>Models offered</dt>
              <dd>{info.models.map((entry) => entry.displayName).join(", ")}</dd>
            </div>
            <div className="kv__row">
              <dt>Can see images</dt>
              <dd>{info.models.some((entry) => entry.vision) ? "yes" : "no"}</dd>
            </div>
            <div className="kv__row">
              <dt>Requests / day</dt>
              <dd>{info.limits.requestsPerDay.toLocaleString()}</dd>
            </div>
            <div className="kv__row">
              <dt>Tokens / day</dt>
              <dd>{info.limits.tokensPerDay.toLocaleString()}</dd>
            </div>
          </dl>
        ) : (
          <p className="meta">Loading…</p>
        )}
      </Panel>

      {usage ? (
        <Panel title="Usage today">
          <div className="stack gap-3">
            {usage.limits.requestsPerDay > 0 ? (
              <Meter
                label="Requests"
                used={usage.used.requestsToday}
                limit={usage.limits.requestsPerDay}
              />
            ) : null}

            {usage.limits.tokensPerDay > 0 ? (
              <Meter
                label="Tokens"
                used={usage.used.tokensToday}
                limit={usage.limits.tokensPerDay}
                unit="tokens"
              />
            ) : null}

            {usage.platform.budget.dailyTokens > 0 ? (
              <Meter
                label="Shared budget (everyone)"
                used={usage.platform.used.tokensToday}
                limit={usage.platform.budget.dailyTokens}
                unit="tokens"
              />
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="Stream a turn">
        <div className="stack gap-3">
          <Field label="System instructions">
            {({ id }) => (
              <Textarea
                id={id}
                rows={2}
                value={system}
                onChange={(event) => setSystem(event.target.value)}
              />
            )}
          </Field>

          <Field label="Prompt">
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            )}
          </Field>

          <p className="row gap-2">
            <Button onClick={() => void run()} disabled={streaming}>
              <Play size={14} aria-hidden="true" />
              Run
            </Button>

            {streaming ? (
              <Button variant="ghost" onClick={stop}>
                <CircleStop size={14} aria-hidden="true" />
                Stop
              </Button>
            ) : null}

            <Button
              variant="ghost"
              onClick={() => {
                setOutput("");
                setEvents([]);
                setDone(null);
                setRunError(null);
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Clear
            </Button>
          </p>

          {runError ? (
            <Callout tone="error" title={runError.code}>
              {runError.message}
            </Callout>
          ) : null}

          {output ? <pre className="codeblock">{output}</pre> : null}

          {done ? (
            <p className="meta">
              {done.finishReason} · {done.usage.inputTokens}→
              {done.usage.outputTokens} tokens · {done.latencyMs}ms
            </p>
          ) : null}

          {events.length > 0 ? (
            <ol className="stack gap-1">
              {events.map((event, index) => (
                <li key={index} className="meta">
                  <Badge mono>{event.type}</Badge> {event.detail}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Probes"
        actions={
          <Button variant="ghost" onClick={() => void runProbes()} disabled={probing}>
            <Zap size={14} aria-hidden="true" />
            {probing ? "Running…" : "Run probes"}
          </Button>
        }
      >
        {probes.length === 0 ? (
          <p className="meta">
            Asserts the wire contract against the real server, including that
            nothing on it names a provider.
          </p>
        ) : (
          <ol className="stack gap-2">
            {probes.map((probe, index) => (
              <li key={index} className="row gap-2">
                <Badge tone={probe.pass ? "correct" : "error"}>
                  {probe.pass ? "pass" : "fail"}
                </Badge>
                <span>
                  {probe.label} — expected {probe.expected}, got {probe.actual}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
