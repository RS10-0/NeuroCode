import { useState } from "react";
import { AlertTriangle, FileDown, Globe, Wrench } from "lucide-react";

import { Badge, Button } from "../../components/ui";
import {
  downloadDocument,
  type StoredDocumentSummary,
} from "./documentsApi";
import { outcomeCopy, type Run } from "./scheduleApi";

/*
 * One scheduled run, and the evidence for believing it.
 *
 * Lifted out of the per-agent Schedule screen unchanged when
 * the Schedules tab was added, because the two screens have to
 * agree about what a run looked like. Two copies of this would
 * be two places for the confabulation banner to drift, and the
 * whole point of that banner is that a learner can trust it to
 * appear.
 *
 * The rule it exists to enforce: nothing on this card is taken
 * from the answer's own account of itself. The file list is
 * built from document rows, so a run that says "the report is
 * attached" and made no file shows nothing — and the
 * contradiction sits directly under the claim. The trace is the
 * runtime's own events. The confabulation banner quotes the
 * sentence that triggered it, because a flag a learner cannot
 * audit is one they learn to ignore.
 */


export default function RunCard({
  run,
  documents,
}: {
  run: Run;
  documents: StoredDocumentSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const copy = outcomeCopy(run);

  const when = new Date(run.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <li className={`runcard runcard--${copy.tone}`}>
      <div className="runcard__head">
        <Badge tone={copy.tone}>{copy.label}</Badge>
        <span className="runcard__when">{when}</span>
        {run.trigger === "manual" ? (
          <Badge tone="neutral">Test run</Badge>
        ) : null}
        <span className="runcard__meta">
          {run.latencyMs !== null ? `${(run.latencyMs / 1000).toFixed(1)}s` : "—"}
          {run.xpSpent > 0 ? ` · ${run.xpSpent} XP` : ""}
          {run.toolCalls > 0
            ? ` · ${run.toolCalls} tool ${run.toolCalls === 1 ? "step" : "steps"}`
            : ""}
        </span>
      </div>

      <p className="runcard__meaning">{copy.meaning}</p>

      {/*
       * The files this run produced.
       *
       * Built from document rows, never from the run's output
       * text — which is the whole of why this is trustworthy. A
       * run whose answer says "the report is attached" and which
       * made no file shows nothing here, and the contradiction
       * sits directly under the claim.
       */}
      {documents.length > 0 ? (
        <div className="runcard__files">
          {documents.map((file) => (
            <div className="runcard__file" key={file.id}>
              <FileDown size={13} aria-hidden="true" />
              <span className="runcard__file-name">{file.filename}</span>
              <span className="runcard__file-size">
                {file.bytes < 1024
                  ? `${file.bytes} bytes`
                  : `${Math.round(file.bytes / 1024)} KB`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={downloading === file.id}
                onClick={async () => {
                  setDownloading(file.id);
                  setFileError(null);

                  try {
                    await downloadDocument(file.id, file.filename);
                  } catch (cause) {
                    setFileError(
                      cause instanceof Error
                        ? cause.message
                        : "The file could not be downloaded."
                    );
                  } finally {
                    setDownloading(null);
                  }
                }}
              >
                {downloading === file.id ? "Opening…" : "Download"}
              </Button>

              {file.degraded ? (
                <p className="runcard__file-note">{file.degraded}</p>
              ) : null}
            </div>
          ))}

          {fileError ? <p className="runcard__claim">{fileError}</p> : null}
        </div>
      ) : null}

      {/*
       * The confabulation banner, and the sentence that caused
       * it. Showing the phrase is the difference between a
       * warning a learner can check and one they have to take on
       * faith — and the second kind gets ignored.
       */}
      {run.outcome === "confabulated" && run.claimPhrase ? (
        <p className="runcard__claim">
          <AlertTriangle size={13} aria-hidden="true" /> It said:{" "}
          <q>{run.claimPhrase}</q>
        </p>
      ) : null}

      {run.missedRuns > 0 ? (
        <p className="runcard__missed">
          {run.missedRuns} earlier run{run.missedRuns === 1 ? "" : "s"} were
          missed while BuildGentic was unreachable. They were not repeated.
        </p>
      ) : null}

      {run.output ? (
        <>
          <button
            type="button"
            className="runcard__toggle"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"} what it said
            {run.trace.length > 0 ? ` and what it ran (${run.trace.length})` : ""}
          </button>

          {open ? (
            <div className="runcard__body">
              {run.trace.length > 0 ? (
                <ol className="runtrace">
                  {run.trace.map((entry, index) => (
                    <li
                      key={`${entry.step}-${entry.kind}-${index}`}
                      className={`runtrace__item runtrace__item--${entry.kind}${
                        entry.kind === "search" && entry.ok ? " is-ok" : ""
                      }`}
                    >
                      {entry.kind === "search" ? (
                        <Globe size={12} aria-hidden="true" />
                      ) : (
                        <Wrench size={12} aria-hidden="true" />
                      )}
                      <span className="runtrace__tool">
                        {entry.kind === "search"
                          ? entry.provider
                            ? `web search (${entry.provider})`
                            : "web search"
                          : (entry.tool ??
                            (entry.kind === "limit" ? "step limit" : "unreadable action"))}
                      </span>
                      <span className="runtrace__detail">
                        {entry.kind === "search"
                          ? entry.ok
                            ? `read ${entry.resultCount ?? 0} ${
                                entry.resultCount === 1 ? "page" : "pages"
                              }`
                            : /* The line this whole change exists to
                                 print. Says what happened and what it
                                 means, because "no_results" means
                                 nothing to the person reading it. */
                              "found nothing — everything below is from memory, not the web"
                          : entry.kind === "call"
                            ? "asked to run"
                            : entry.kind === "limit"
                              ? entry.reason === "budget"
                                ? "no room left for more tool output"
                                : "used all 4 steps"
                              : entry.ok
                                ? entry.summary
                                : entry.error}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}

              <pre className="runcard__output">{run.output}</pre>

              {run.outputTruncated ? (
                <p className="runcard__missed">
                  The answer was longer than this and was cut off.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}
