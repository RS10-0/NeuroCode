import type { RefObject } from "react";
import {
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  TriangleAlert,
  X,
} from "lucide-react";

import type {
  AiAnalysedFile,
  AiFileAnalysisInfo,
  AiFileLimits,
} from "../../lib/aiClient";
import type { Attachment } from "./attachments";
import type { TurnAttachment } from "./useAgentChat";

/*
 * File Analysis, as a beginner meets it.
 *
 * The design rule the whole file follows: this must not look
 * like a document manager. There is no list of past uploads, no
 * folders, no "manage files" screen, no storage quota bar. An
 * attachment belongs to the message being written — it appears
 * when it is picked and is gone once the question has been asked
 * — and anything more would invite a learner to treat this as
 * storage, which it deliberately is not.
 *
 * What it does have to do is be honest about three things a
 * learner cannot otherwise see: that their file is still being
 * read, how much of it actually reached the model, and when
 * something about it was cut. The last is the one that matters
 * most. Somebody whose ninety-page report arrived as sixty pages
 * will otherwise conclude the model is bad at reading, which is
 * a completely different problem with a completely different
 * fix.
 */

/* =========================================================
   SHARED BITS
========================================================= */

const KIND_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  image: ImageIcon,
};

function KindIcon({ kind, size = 13 }: { kind: string; size?: number }) {
  const Icon = KIND_ICONS[kind] ?? Paperclip;
  return <Icon size={size} aria-hidden="true" />;
}

function describeBytes(count: number): string {
  return count >= 1024 * 1024
    ? `${(count / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(count / 1024))} KB`;
}

/*
 * What one file says about itself once it has been read.
 *
 * Format-specific on purpose. "4 pages", "3 sheets · 120 rows"
 * and "240×160" each answer the question a learner actually has
 * about that kind of file; a single generic "read successfully"
 * would answer none of them.
 */
function summarise(file: AiAnalysedFile): string {
  if (file.kind === "image") {
    return `${file.width}×${file.height}`;
  }

  if (file.pages !== undefined) {
    return `${file.pages} page${file.pages === 1 ? "" : "s"}`;
  }

  if (file.rows !== undefined) {
    const sheets = file.sheets?.length ?? 0;

    return sheets > 1
      ? `${sheets} sheets · ${file.rows} rows`
      : `${file.rows} row${file.rows === 1 ? "" : "s"}`;
  }

  return describeBytes(file.bytes);
}

/* =========================================================
   THE COMPOSER'S ATTACHMENTS
========================================================= */

/*
 * Everything the strip needs, owned by the page.
 *
 * Passed in rather than held in the panel so that a
 * rearrangement of the Builder that unmounted the panel would
 * not throw away a file somebody has just waited for.
 */
export interface FilesControl {
  attachments: Attachment[];
  limits: AiFileLimits;
  /* True while any file is still being read. */
  busy: boolean;
  /*
   * Set when an image is attached and the chosen model cannot
   * see one. The server refuses that combination with a clear
   * message, but discovering it by pressing Send is a worse
   * experience than being told while choosing.
   */
  visionWarning: string | null;
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}

export function AttachmentStrip({
  files,
  disabled,
  onPick,
  inputRef,
}: {
  files: FilesControl;
  disabled: boolean;
  onPick: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const full = files.attachments.length >= files.limits.maxFilesPerMessage;

  return (
    <div className="attach">
      {files.attachments.length > 0 ? (
        <ul className="attach__list">
          {files.attachments.map((entry) => (
            <li
              key={entry.id}
              className={
                entry.status === "error"
                  ? "attach__chip attach__chip--error"
                  : "attach__chip"
              }
            >
              <span className="attach__icon">
                {entry.status === "reading" ? (
                  <Loader2 size={13} className="spin" aria-hidden="true" />
                ) : (
                  <KindIcon kind={entry.file?.kind ?? "pdf"} />
                )}
              </span>

              <span className="attach__text">
                <span className="attach__name" title={entry.name}>
                  {entry.name}
                </span>

                <span className="attach__meta">
                  {entry.status === "reading"
                    ? "Reading file…"
                    : entry.status === "error"
                      ? entry.error
                      : entry.file
                        ? `${summarise(entry.file)}${
                            entry.file.truncated ? " · shortened" : ""
                          }`
                        : ""}
                </span>
              </span>

              <button
                type="button"
                className="attach__remove"
                onClick={() => files.onRemove(entry.id)}
                aria-label={`Remove ${entry.name}`}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {files.visionWarning ? (
        <p className="attach__warning">
          <TriangleAlert size={13} aria-hidden="true" />
          {files.visionWarning}
        </p>
      ) : null}

      <div className="attach__actions">
        <button
          type="button"
          className="attach__add"
          onClick={onPick}
          disabled={disabled || full}
        >
          <Paperclip size={14} aria-hidden="true" />
          {files.attachments.length === 0
            ? "Attach a file"
            : full
              ? `${files.limits.maxFilesPerMessage} files is the limit`
              : "Attach another"}
        </button>

        {files.attachments.length === 0 ? (
          <span className="attach__hint">
            PDF, Word, Excel, CSV or an image — then ask about it.
          </span>
        ) : null}

        {/* Never visible. The styled button above is what a
            learner clicks; this is what opens the picker, which
            is the only way to have both a native file input and
            a designed control. */}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={files.limits.accept.join(",")}
          multiple
          onChange={(event) => {
            files.onAdd(event.target.files);
            /* Cleared so picking the same file twice fires a
               change event the second time. */
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================
   WHAT IT READ

   The file half of the argument the retrieval and web strips
   make: an agent that answers well from an attachment is
   indistinguishable from one that guessed, unless you can see
   what it actually got.
========================================================= */

export function FilesRead({ info }: { info: AiFileAnalysisInfo }) {
  if (info.files.length === 0) {
    if (!info.reason || info.reason === "none") {
      return null;
    }

    /*
     * Four nothings, and saying which is the point. Only one of
     * them is a fault, and the other three each send a learner
     * somewhere different — to the Capabilities switch, to the
     * paperclip, or to a shorter conversation.
     */
    const said =
      info.reason === "off"
        ? "A file was attached, but File Analysis is switched off for this agent — so it did not read it."
        : info.reason === "expired"
          ? "The attached file was no longer available, so it answered without it."
          : info.reason === "no_room"
            ? "The attached file did not fit in the prompt, so it answered without it."
            : "The attached file could not be read this time.";

    return (
      <p className="turn__files turn__files--empty">
        <Paperclip size={12} aria-hidden="true" />
        {said}
      </p>
    );
  }

  const shortened = info.files.some((file) => file.truncated);

  return (
    <details className="turn__files">
      <summary>
        <Paperclip size={12} aria-hidden="true" />
        Read {info.files.length} {info.files.length === 1 ? "file" : "files"}
        {shortened ? " · some of it was cut" : ""}
      </summary>

      <ul className="turn__files-list">
        {info.files.map((file) => (
          <li key={file.id}>
            <span className="turn__files-name">
              <KindIcon kind={file.kind} size={12} />
              {file.name}
            </span>

            <span className="turn__files-meta">
              {summarise(file)}
              {file.chars > 0
                ? ` · ${file.chars.toLocaleString()} characters`
                : ""}
              {` · ${file.latencyMs.toLocaleString()} ms`}
            </span>

            {file.sheets && file.sheets.length > 1 ? (
              <span className="turn__files-meta">
                Sheets: {file.sheets.join(", ")}
              </span>
            ) : null}

            {file.truncated ? (
              <span className="turn__files-cut">
                Longer than the space available. Your agent saw the first part
                and was told the rest was not sent — so treat any total it
                gives you as covering that part only.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* What the learner attached, shown back on their own turn, so a
   transcript makes plain which question came with a file. */
export function SentFiles({ files }: { files: TurnAttachment[] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <p className="turn__sent">
      {files.map((file) => (
        <span key={file.id} className="turn__sent-file">
          <KindIcon kind={file.kind} size={12} />
          {file.name}
        </span>
      ))}
    </p>
  );
}
