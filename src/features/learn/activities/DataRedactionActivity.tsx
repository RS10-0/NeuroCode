import { useMemo, useState } from "react";

import type { DataRedactionActivityStep } from "../../../core/curriculum/Lesson";
import { Callout } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun, scoreOf } from "./kit/useActivityRun";

interface Segment {
  key: string;
  text: string;
  fieldId?: string;
}

export default function DataRedactionActivity({
  step,
  state,
  onProgress,
}: StepProps<DataRedactionActivityStep>) {
  const activity = step as DataRedactionActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [redacted, setRedacted] = useState<string[]>([]);

  /*
   * Split the document into plain text and redactable spans.
   *
   * Field offsets are authored, but fall back to searching for
   * the field text so a stale index cannot break the document.
   */
  const segments = useMemo<Segment[]>(() => {
    const content = activity.document.content;

    const fields = [...activity.document.fields]
      .map((field) => {
        const start =
          content.slice(field.startIndex, field.endIndex) === field.text
            ? field.startIndex
            : content.indexOf(field.text);

        return { ...field, resolvedStart: start };
      })
      .filter((field) => field.resolvedStart >= 0)
      .sort((a, b) => a.resolvedStart - b.resolvedStart);

    const result: Segment[] = [];
    let cursor = 0;

    fields.forEach((field, index) => {
      if (field.resolvedStart < cursor) {
        return;
      }

      if (field.resolvedStart > cursor) {
        result.push({
          key: `text-${index}`,
          text: content.slice(cursor, field.resolvedStart),
        });
      }

      result.push({
        key: field.id,
        text: field.text,
        fieldId: field.id,
      });

      cursor = field.resolvedStart + field.text.length;
    });

    if (cursor < content.length) {
      result.push({ key: "text-tail", text: content.slice(cursor) });
    }

    return result;
  }, [activity.document]);

  const shouldRedact = activity.document.fields.filter(
    (field) => field.shouldRedact
  );

  const hit = shouldRedact.filter((field) => redacted.includes(field.id)).length;

  /* Redacting something harmless is its own kind of failure. */
  const overzealous = activity.document.fields.filter(
    (field) => !field.shouldRedact && redacted.includes(field.id)
  ).length;

  const missing = shouldRedact.length - hit;
  const clean = missing === 0 && overzealous === 0;

  function toggle(fieldId: string) {
    setRedacted((current) =>
      current.includes(fieldId)
        ? activity.allowUndo === false
          ? current
          : current.filter((id) => id !== fieldId)
        : [...current, fieldId]
    );
  }

  function check() {
    run.check({
      completed: missing === 0,
      score: scoreOf(hit, shouldRedact.length + overzealous),
      correctActions: hit,
      totalActions: shouldRedact.length,
      actions: redacted,
    });
  }

  return (
    <>
      <p className="activity-note">
        Click anything that should not leave this building before the record is
        sent to an AI service. Over-redacting has a cost too — the document
        still has to be useful.
      </p>

      <div className="activity-group">
        <div className="activity-group__title">{activity.document.title}</div>

        <div className="doc">
          {segments.map((segment) => {
            if (!segment.fieldId) {
              return <span key={segment.key}>{segment.text}</span>;
            }

            const field = activity.document.fields.find(
              (candidate) => candidate.id === segment.fieldId
            );
            const isOn = redacted.includes(segment.fieldId);

            let modifier = isOn ? " redact--on" : "";

            if (run.checked && field) {
              if (field.shouldRedact && isOn) {
                modifier = " redact--correct";
              } else if (field.shouldRedact && !isOn) {
                modifier = " redact--missed";
              } else if (!field.shouldRedact && isOn) {
                modifier = " redact--overzealous";
              }
            }

            return (
              <button
                key={segment.key}
                type="button"
                className={`redact${modifier}`}
                aria-pressed={isOn}
                aria-label={`${isOn ? "Unredact" : "Redact"} ${segment.text}`}
                disabled={run.checked}
                onClick={() => toggle(segment.fieldId as string)}
              >
                {segment.text}
              </button>
            );
          })}
        </div>
      </div>

      <div className="activity-group">
        <div className="activity-group__title">What counts as sensitive here</div>

        <ul className="prose" style={{ fontSize: "var(--text-sm)" }}>
          {activity.sensitiveFields.map((field) => (
            <li key={field.id}>
              <strong>{field.label}</strong> ({field.riskLevel} risk) —{" "}
              {field.explanation}
            </li>
          ))}
        </ul>
      </div>

      <ActivityActions
        checked={run.checked}
        canCheck={redacted.length > 0}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Send to the AI service"
        onCheck={check}
        onReset={() => {
          run.reset();
          setRedacted([]);
        }}
      />

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout
            tone={clean ? "correct" : missing > 0 ? "error" : "caution"}
            title={
              clean
                ? "Safe to send"
                : missing > 0
                  ? `${missing} identifier${missing === 1 ? "" : "s"} still exposed`
                  : `${overzealous} unnecessary redaction${overzealous === 1 ? "" : "s"}`
            }
          >
            {missing > 0
              ? (activity.feedback?.incorrect ??
                "Anything you leave in gets sent to a third party and may be retained. Names and record numbers are the obvious ones; dates of birth and addresses identify people just as well.")
              : overzealous > 0
                ? "You blacked out more than you needed to. A record stripped of everything useful cannot do its job either — redaction is a judgement, not a reflex."
                : (activity.feedback?.correct ??
                  "Identifiers gone, clinical meaning intact. That is the balance you are aiming for.")}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
