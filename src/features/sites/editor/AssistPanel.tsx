import { useState } from "react";
import { CornerDownLeft, Info, RotateCcw, Sparkles } from "lucide-react";

import { Button, Callout, Textarea } from "../../../components/ui";
import { ApiError } from "../../../lib/api";
import { requestSiteEdit, type SiteEditResult } from "../siteApi";
import type { SiteConfig } from "../schema";

/*
 * "Make the background darker."
 *
 * The Phase 2 surface, and the smallest one that could work.
 * It is not a chat: there is no transcript, no follow-up turn
 * and no conversation to lose track of. A student describes a
 * change, sees exactly what it did, and keeps it or undoes it.
 *
 * Three things about it are deliberate.
 *
 * It does not save. The change lands in the draft, the Save bar
 * appears, and the student decides — because a model that
 * misreads "shorten the heading" as "rewrite the heading"
 * should cost a click, not a published page nobody looked at.
 *
 * The change list is built from the OPERATIONS the server
 * applied, not from the model's own summary of them. So a model
 * that says it changed the headline while actually changing the
 * palette is caught by reading the list, which is the one place
 * a student could otherwise be quietly misled.
 *
 * And what it CANNOT do is shown as prominently as what it did.
 * A request for a logo or a custom colour comes back as a plain
 * "that needs something this cannot do yet" rather than as a
 * near miss — a page that quietly got a different accent colour
 * instead of the logo somebody asked for is worse than a page
 * that did nothing and said so.
 */

export interface AssistPanelProps {
  agentId: string;
  config: SiteConfig;
  onApply: (config: SiteConfig) => void;
  /* Puts the draft back as it was before the last change. */
  onUndo: (config: SiteConfig) => void;
}

type Phase = "idle" | "thinking" | "error";

const EXAMPLES = [
  "Make the background darker",
  "Add a section explaining what I do",
  "Rewrite the headline to be shorter",
  "Use the study tool layout",
];

export default function AssistPanel({
  agentId,
  config,
  onApply,
  onUndo,
}: AssistPanelProps) {
  const [request, setRequest] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SiteEditResult | null>(null);

  /* The document as it was before the last applied change, so
     Undo is exact rather than an attempt to reverse the
     operations. */
  const [previous, setPrevious] = useState<SiteConfig | null>(null);

  const submit = async () => {
    const text = request.trim();

    if (!text || phase === "thinking") {
      return;
    }

    setPhase("thinking");
    setError(null);
    setResult(null);

    try {
      const next = await requestSiteEdit(agentId, {
        config,
        request: text,
      });

      /* Captured before applying, and captured from the config
         this request was planned against rather than from
         whatever is current — the two are the same here because
         the panel is disabled while thinking. */
      setPrevious(config);
      setResult(next);
      setPhase("idle");
      setRequest("");

      /* Applied even when part of the request was unsupported:
         the supported half is a real change the student asked
         for, and withholding it because the other half was
         impossible would be the wrong trade. */
      if (next.changes.length > 0) {
        onApply(next.config);
      }
    } catch (failure) {
      setPhase("error");
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Could not make that change. Try again."
      );
    }
  };

  const undo = () => {
    if (!previous) {
      return;
    }

    onUndo(previous);
    setPrevious(null);
    setResult(null);
  };

  return (
    <section className="siteedit__group siteedit__assist">
      <h3 className="siteedit__grouptitle">
        <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
        Describe a change
      </h3>

      <p className="siteedit__grouphint">
        Say what you want in plain English. It adjusts the same fields the
        tabs above do — it does not write code, and it will tell you when
        something is not possible.
      </p>

      <Textarea
        rows={2}
        value={request}
        placeholder="Make the background darker…"
        aria-label="Describe a change to your page"
        maxLength={600}
        disabled={phase === "thinking"}
        onChange={(event) => setRequest(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      <div className="siteedit__assistrow">
        <Button
          variant="primary"
          size="sm"
          disabled={!request.trim() || phase === "thinking"}
          iconEnd={<CornerDownLeft size={13} strokeWidth={2} />}
          onClick={() => void submit()}
        >
          {phase === "thinking" ? "Working…" : "Make the change"}
        </Button>

        {previous ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} strokeWidth={2} />}
            onClick={undo}
          >
            Undo
          </Button>
        ) : null}
      </div>

      {!result && phase === "idle" && !error ? (
        <div className="siteedit__examples">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="siteedit__example"
              onClick={() => setRequest(example)}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <Callout tone="error" title="That did not work">
          {error}
        </Callout>
      ) : null}

      {result ? (
        <div className="siteedit__assistresult">
          {result.changes.length > 0 ? (
            <Callout tone="correct" title="Changed">
              <ul className="siteedit__changes">
                {result.changes.map((change, index) => (
                  <li key={index}>{change}</li>
                ))}
              </ul>
              <p className="siteedit__grouphint">
                Nothing is saved until you press Save.
              </p>
            </Callout>
          ) : null}

          {result.unsupported.length > 0 ? (
            <Callout
              tone="caution"
              title={
                result.changes.length > 0
                  ? "Part of that is not possible yet"
                  : "That is not possible yet"
              }
            >
              <ul className="siteedit__changes">
                {result.unsupported.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>

              <p className="siteedit__grouphint">
                <Info size={12} strokeWidth={2} aria-hidden="true" /> Pages are
                built from a fixed set of fields, so anything needing custom
                code, images or colours outside the palettes cannot be done
                here yet.
              </p>
            </Callout>
          ) : null}

          {result.changes.length === 0 && result.unsupported.length === 0 ? (
            <Callout tone="info" title="Nothing changed">
              {result.summary ||
                "That did not match anything on the page. Try naming the part you mean — the headline, a section, the colours."}
            </Callout>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
