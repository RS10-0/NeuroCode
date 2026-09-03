import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, RotateCw, Waves } from "lucide-react";

import { Callout } from "../../components/ui";
import { describeFinishReason, explainError } from "./explain";
import type { LabRunState } from "./useLabRun";

/*
 * The answer, as it arrives — and what to do when it does not.
 *
 * Given the whole width and a good deal of vertical room,
 * because it is the thing the page exists to produce. Under it,
 * on one quiet line, the four numbers that make this a lab
 * rather than a chat window: which model actually answered, how
 * long it took, what it cost in tokens, and the id of this
 * particular run.
 *
 * The accessibility decision worth spelling out: the streaming
 * text is NOT a live region. Marking it aria-live="polite"
 * looks correct and is close to unusable — a screen reader then
 * re-reads the growing answer on every delta, dozens of times a
 * second. The text is marked aria-busy while it grows, and a
 * separate, quiet status region announces only the transitions
 * a non-sighted learner actually needs: it started, it
 * finished, it cost this much, it failed for this reason.
 */

/*
 * Split out of the main bundle.
 *
 * A markdown parser, KaTeX and a syntax highlighter come to
 * roughly 190 kB gzipped between them — more than a quarter of
 * everything BuildGentic ships. None of it is needed to read a
 * lesson, look at the dashboard or sit a quiz, and the Lab is
 * one destination out of five.
 *
 * It is fetched the moment this panel mounts rather than when
 * the first answer arrives, so the chunk is in place long before
 * a provider returns its first token and the fallback below is
 * effectively never seen.
 */
const ResponseMarkdown = lazy(() => import("./ResponseMarkdown"));

interface NeuralResponseProps {
  state: LabRunState;
  onRetry: () => void;
}

export default function NeuralResponse({
  state,
  onRetry,
}: NeuralResponseProps) {
  const { phase, output, error, done, firstTokenMs, runId } = state;

  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  /*
   * Follow the text down while it streams — but only when the
   * learner is already at the bottom. Yanking the viewport back
   * while they are reading something further up is the standard
   * way an auto-scrolling log becomes infuriating.
   */
  useEffect(() => {
    const node = bodyRef.current;

    if (!node || phase !== "streaming") {
      return;
    }

    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;

    if (distanceFromBottom < 80) {
      node.scrollTop = node.scrollHeight;
    }
  }, [output, phase]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);

  /* Warm the renderer's chunk while the learner is still typing.
     A failure here is not worth reporting — Suspense will simply
     wait for the retry when the panel actually needs it. */
  useEffect(() => {
    void import("./ResponseMarkdown").catch(() => {});
  }, []);

  const guidance = error ? explainError(error) : null;
  const finish = done ? describeFinishReason(done.finishReason) : null;

  return (
    <section className="response" aria-labelledby="response-heading">
      <div className="response__head">
        <h2 className="response__heading" id="response-heading">
          <Waves size={17} aria-hidden="true" className="response__wave" />
          Neural Response
        </h2>

        <div className="response__head-right">
          {phase === "streaming" ? (
            <span className="response__live">
              <span className="response__live-dot" aria-hidden="true" />
              Streaming
            </span>
          ) : null}

          {output ? (
            <button
              type="button"
              className="response__copy"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(output)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      </div>

      {/*
        The announcement channel. Empty most of the time, never
        visible — its whole job is to say out loud what a sighted
        learner reads from the panel changing.
      */}
      <p className="sr-only" role="status">
        {announcement(state)}
      </p>

      <div
        ref={bodyRef}
        className="response__body"
        aria-busy={phase === "streaming"}
        tabIndex={0}
        role="region"
        aria-label="Model output"
      >
        {output ? (
          <>
            {/*
              Rendered as markdown and LaTeX rather than shown as
              source. The text itself is untouched — `output` is
              still exactly what the provider streamed, and Copy
              still copies that. See ResponseMarkdown.
            */}
            <Suspense
              fallback={
                <p className="response__waiting">Preparing the answer…</p>
              }
            >
              <ResponseMarkdown
                source={output}
                streaming={phase === "streaming"}
              />
            </Suspense>
            {phase === "streaming" ? (
              <span className="response__caret" aria-hidden="true" />
            ) : null}
          </>
        ) : phase === "streaming" ? (
          <p className="response__waiting">
            <span className="response__caret" aria-hidden="true" />
            Waiting for the first token…
          </p>
        ) : phase === "idle" ? (
          <div className="response__empty">
            <span className="response__empty-mark" aria-hidden="true">
              <Waves size={22} />
            </span>

            <p className="response__empty-title">Nothing run yet</p>

            <p className="response__empty-text">
              Write a prompt, choose your parameters, and run the experiment.
              The answer streams in here a token at a time.
            </p>
          </div>
        ) : (
          <p className="response__waiting">No text was produced.</p>
        )}
      </div>

      {/* ---------------------------------------------------------
          TELEMETRY

          Four facts on one line. The latency shown is the
          server's — the span the model actually spent — because
          it is the one a learner can reason about. The
          browser-side first-token measurement is a different
          clock over a different span and lives in the run
          report under "Under the Hood", where there is room to
          say so.
          --------------------------------------------------------- */}

      <dl className="telemetry">
        <Telemetry
          label="Latency"
          value={
            done
              ? `${(done.latencyMs / 1000).toFixed(2)} s`
              : firstTokenMs !== null
                ? `${firstTokenMs} ms`
                : "—"
          }
          note={done ? "generation" : firstTokenMs !== null ? "to first token" : undefined}
        />

        <Telemetry
          label="Tokens"
          value={
            done
              ? `${done.usage.inputTokens.toLocaleString()} → ${done.usage.outputTokens.toLocaleString()}`
              : "—"
          }
          note={
            done
              ? done.usage.reported
                ? "provider-reported"
                : "estimated"
              : undefined
          }
        />

        <Telemetry
          label="Run ID"
          value={runId ? runId.slice(0, 8) : "—"}
          note={finish ? finish.label.toLowerCase() : undefined}
          mono
        />
      </dl>

      {phase === "stopped" ? (
        <Callout tone="caution" title="You stopped this run">
          The text above is what arrived before you pressed stop. The request
          was aborted at the provider, so the rest was never generated and is
          not being billed — though what did arrive still counts against your
          allowance.
        </Callout>
      ) : null}

      {done?.finishReason === "length" ? (
        <Callout tone="caution" title="This answer was cut off">
          The model did not decide to stop — it hit your max output tokens cap
          of{" "}
          {state.settings?.maxOutputTokens.toLocaleString() ?? "the current"}{" "}
          tokens. Raise the cap and run it again to see the rest, or ask for a
          shorter answer in the prompt.
        </Callout>
      ) : null}

      {guidance && error ? (
        <Callout tone={guidance.tone} title={guidance.title}>
          {/*
            The runtime's own sentence, first and always. It is
            the only part that knows which failure this actually
            was — "out of credit" rather than "unavailable" — and
            errors.ts guarantees it carries no provider
            internals.
          */}
          <p>{error.message}</p>

          {guidance.body ? (
            <p className="response__context">{guidance.body}</p>
          ) : null}

          {guidance.action ? (
            <div className="response__actions">
              {guidance.action === "retry" ? (
                <button
                  type="button"
                  className="response__act"
                  onClick={onRetry}
                >
                  <RotateCw size={14} aria-hidden="true" />
                  Run it again
                </button>
              ) : null}


              {guidance.action === "sign-in" ? (
                /* A destination, not an action — so a real link,
                   which middle-clicks and opens in a new tab the
                   way a learner expects. */
                <Link className="response__act" to="/login">
                  Sign in again
                </Link>
              ) : null}
            </div>
          ) : null}
        </Callout>
      ) : null}
    </section>
  );
}

/* =========================================================
   ONE TELEMETRY FACT
========================================================= */

function Telemetry({
  label,
  value,
  note,
  mono = false,
}: {
  label: string;
  value: string;
  note?: string;
  mono?: boolean;
}) {
  return (
    /* A <dl> wrapper group. Only dt, dd and a grouping div are
       allowed inside a description list, so the note lives
       inside the dd rather than beside it. */
    <div className="telemetry__item">
      <dt className="telemetry__label">{label}</dt>
      <dd className="telemetry__value">
        <span className={mono ? "telemetry__figure telemetry__figure--mono" : "telemetry__figure"}>
          {value}
        </span>
        {note ? <span className="telemetry__note">{note}</span> : null}
      </dd>
    </div>
  );
}

/* What the status region says, and when. */
function announcement(state: LabRunState): string {
  switch (state.phase) {
    case "streaming":
      return state.output ? "Generating a response." : "Waiting for the model.";

    case "done":
      return state.done
        ? `Response complete. ${state.done.usage.outputTokens.toLocaleString()} output tokens in ${(
            state.done.latencyMs / 1000
          ).toFixed(1)} seconds.`
        : "Response complete.";

    case "stopped":
      return "Run stopped.";

    case "error":
      return state.error ? `Run failed. ${state.error.message}` : "Run failed.";

    default:
      return "";
  }
}
