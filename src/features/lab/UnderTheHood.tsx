import { ChevronRight, Cpu } from "lucide-react";

import type { AiLimits, AiModel } from "../../lib/aiClient";
import { countInputChars, estimateInputTokens, previewJson } from "./request";
import type { LabSettings } from "./types";
import type { LabRunState } from "./useLabRun";

/*
 * The machinery, for whoever wants to look at it.
 *
 * Everything in here is true of every run and interesting on
 * roughly the third one — which is exactly what a collapsed
 * section is for. A learner on their first experiment should
 * not have to scroll past a JSON body to reach the temperature
 * slider; a learner on their tenth should be able to find it
 * without asking anyone.
 *
 * Native <details>, not a custom disclosure. It is keyboard
 * operable, screen-reader announced and findable by in-page
 * search with no code at all, and it keeps its own open/closed
 * state across re-renders without any of it being lifted into
 * React.
 */

interface UnderTheHoodProps {
  settings: LabSettings;
  model: AiModel | undefined;
  limits: AiLimits | undefined;
  state: LabRunState;
}

export default function UnderTheHood({
  settings,
  model,
  limits,
  state,
}: UnderTheHoodProps) {
  return (
    <section className="hood" aria-labelledby="hood-heading">
      <h2 className="rail-heading" id="hood-heading">
        <Cpu size={14} aria-hidden="true" />
        Under the Hood
      </h2>

      <Drawer title="Request anatomy" hint="The parts of what you send">
        <RequestAnatomy settings={settings} model={model} limits={limits} />
      </Drawer>

      <Drawer title="Raw JSON" hint="Exactly what the browser POSTs">
        <pre className="hood__code">
          <code>{previewJson(settings)}</code>
        </pre>

        <p className="hood__note">
          No API key appears here, or anywhere else in the browser. The server
          holds the credentials and attaches them after this arrives.
        </p>
      </Drawer>

      <Drawer title="API details" hint="Endpoint, transport and timings">
        <ApiDetails state={state} />
      </Drawer>
    </section>
  );
}

/* =========================================================
   ONE DRAWER
========================================================= */

function Drawer({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="hood__drawer">
      <summary className="hood__summary">
        <ChevronRight
          className="hood__chevron"
          size={14}
          aria-hidden="true"
        />

        <span className="hood__summary-text">
          <span className="hood__summary-title">{title}</span>
          <span className="hood__summary-hint">{hint}</span>
        </span>
      </summary>

      <div className="hood__panel">{children}</div>
    </details>
  );
}

/* =========================================================
   REQUEST ANATOMY

   The single most useful thing this page does. A chat window
   makes a prompt look like a sentence you say to a machine; it
   is not. It is a body with a system field, a message array, a
   model id and a set of numeric parameters — and every one of
   those is something the learner just chose.

   Because the same buildRequest builds both this and the real
   body, the preview cannot describe a request other than the
   one that gets sent.
========================================================= */

function RequestAnatomy({
  settings,
  model,
  limits,
}: {
  settings: LabSettings;
  model: AiModel | undefined;
  limits: AiLimits | undefined;
}) {
  const chars = countInputChars(settings);
  const tokens = estimateInputTokens(settings);

  const hasSystem = settings.system.trim().length > 0;

  /*
   * The character count includes a flat per-message overhead,
   * so an empty composer still reports eight characters — which
   * reads as a bug to anybody looking at two empty boxes.
   * Nothing is sent until there is a prompt, so nothing is
   * costed until then either.
   */
  const hasInput = settings.prompt.trim().length > 0 || hasSystem;

  const contextShare = model ? (tokens / model.contextWindow) * 100 : 0;

  return (
    <>
      <ol className="anatomy">
        <Part
          n={1}
          name="system"
          kind={hasSystem ? "A separate field" : "Omitted"}
          detail={
            hasSystem
              ? "Sent apart from the conversation. Providers each want system text in a different place, so the runtime takes one and puts it where that provider expects it."
              : "You have written no system instructions, so the field is left out entirely rather than sent empty."
          }
        />

        <Part
          n={2}
          name="messages"
          kind="An array of one"
          detail="Every run is a single user turn. Nothing from your previous run is included, which is why the same prompt behaves the same way twice."
        />

        <Part
          n={3}
          name="parameters"
          kind="Numbers that shape sampling"
          detail="Passed through to the provider. They change how the next token is chosen and when generation stops — never what the model knows."
          value={`temperature ${settings.temperature.toFixed(2)} · maxOutputTokens ${settings.maxOutputTokens.toLocaleString()}${
            settings.stop.length
              ? ` · stop ${settings.stop.map((s) => JSON.stringify(s)).join(", ")}`
              : ""
          }`}
        />
      </ol>

      <p className="anatomy__cost">
        {hasInput ? (
          <>
            <strong>{chars.toLocaleString()} characters</strong> ≈{" "}
            <strong>{tokens.toLocaleString()} input tokens</strong> — an
            estimate at roughly four characters per token. After the run, the
            provider&apos;s own count appears in the telemetry; comparing the
            two is the fastest way to get a feel for tokenisation.
            {model && contextShare < 1 ? (
              <>
                {" "}
                This fills under 1% of {model.displayName}&apos;s{" "}
                {model.contextWindow.toLocaleString()}-token context window.
              </>
            ) : null}
          </>
        ) : (
          "Write a prompt and this becomes a live estimate of what the request will cost, before you spend anything."
        )}
        {limits && limits.maxInputChars > 0 ? (
          <>
            {" "}
            BuildGentic caps one request&apos;s input at{" "}
            {limits.maxInputChars.toLocaleString()} characters.
          </>
        ) : null}
      </p>
    </>
  );
}

function Part({
  n,
  name,
  kind,
  detail,
  value,
}: {
  n: number;
  name: string;
  kind: string;
  detail: string;
  value?: string;
}) {
  return (
    <li className="anatomy__part">
      <span className="anatomy__n" aria-hidden="true">
        {n}
      </span>

      <div className="anatomy__body">
        <p className="anatomy__name">
          <code>{name}</code>
          <span className="anatomy__kind">{kind}</span>
        </p>

        <p className="anatomy__detail">{detail}</p>

        {value ? <p className="anatomy__value">{value}</p> : null}
      </div>
    </li>
  );
}

/* =========================================================
   API DETAILS

   The two timings are reported separately and never subtracted
   from one another, because they are two clocks over two
   different spans. The browser's starts when Run is pressed —
   before the session token is fetched, before the request has
   left the machine — and stops at the first character to
   arrive. The server's starts once the request has been
   admitted and stops at the provider's last token. Neither
   contains the other, so their difference is not a duration of
   anything.

   An earlier version did subtract them and cheerfully reported
   a first token at 2,596 ms inside a total of 980 ms.
========================================================= */

function ApiDetails({ state }: { state: LabRunState }) {
  const { done, firstTokenMs, estimatedInputTokens, output } = state;

  return (
    <dl className="apidetail">
      <Row label="Endpoint" value="POST /api/ai/chat" mono />
      <Row label="Transport" value="Server-sent events, streamed" />
      <Row
        label="Authentication"
        value="Supabase session bearer token, added by the client"
      />
      <Row
        label="Credentials"
        value="BuildGentic's own, attached server-side after the request arrives"
        note="Your browser never holds a provider key and never sees which service answered."
      />

      <Row
        label="First token (browser)"
        value={firstTokenMs === null ? "—" : `${firstTokenMs} ms`}
        note="From pressing Run to the first character — includes signing the request and the round trip."
      />

      <Row
        label="Generation (server)"
        value={done ? `${(done.latencyMs / 1000).toFixed(2)} s` : "—"}
        note="From the request being admitted to the provider's last token. The part the model actually spent."
      />

      <Row
        label="Input tokens"
        value={done ? done.usage.inputTokens.toLocaleString() : "—"}
        note={
          done
            ? `The Lab estimated ${estimatedInputTokens.toLocaleString()} before the run.`
            : undefined
        }
      />

      <Row
        label="Output tokens"
        value={done ? done.usage.outputTokens.toLocaleString() : "—"}
        note={done ? `${output.length.toLocaleString()} characters of text.` : undefined}
      />

      {done ? (
        <Row
          label="Token counts"
          value={done.usage.reported ? "Provider-reported" : "Estimated"}
          note={
            done.usage.reported
              ? "These came from the provider itself, so they are what you would be billed on."
              : "This provider did not report counts, so BuildGentic estimated them at roughly four characters per token. Close enough for a meter, not for a bill."
          }
        />
      ) : null}
    </dl>
  );
}

function Row({
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
    <div className="apidetail__row">
      <dt className="apidetail__label">{label}</dt>
      <dd className="apidetail__value">
        <span className={mono ? "apidetail__figure apidetail__figure--mono" : "apidetail__figure"}>
          {value}
        </span>
        {note ? <span className="apidetail__note">{note}</span> : null}
      </dd>
    </div>
  );
}
