import { useCallback, useMemo, useRef, useState } from "react";

import { authHeaders } from "../../lib/api";
import { AiError, type AiAnalysedFile, type AiFileLimits } from "../../lib/aiClient";
import { newId } from "./types";

/*
 * Attaching a file to a message.
 *
 * The important sentence, and the one the whole feature is built
 * around: the browser does not read the file. It hands the bytes
 * to BuildGentic's server, which decides what the file is, parses
 * it, and keeps the text — and thereafter this module deals only
 * in an opaque id.
 *
 * That is the opposite of how knowledge files work
 * (features/agents/knowledge.ts reads a .txt in the tab and
 * never uploads anything), and the difference is worth being
 * clear about because it is the difference between the two
 * features. A knowledge entry is text the learner is adding to
 * their agent permanently, and reading it locally is both
 * possible and more private. An attachment is a PDF or a
 * spreadsheet — container formats that need a real parser — read
 * once to answer one question and then dropped.
 *
 * Uploading starts the moment a file is picked rather than when
 * Send is pressed. Parsing a large PDF takes a second or two,
 * and doing it during the send would put that delay in front of
 * the answer, where it reads as the model being slow. Doing it
 * up front means the learner watches "Reading file…" finish
 * while they are still typing their question.
 */

/*
 * One attachment, as the composer sees it.
 *
 * The `id` here is local and exists from the moment the file is
 * picked; `file` — the server's summary, carrying the id the
 * chat request actually sends — only exists once the upload has
 * finished. Keeping them separate is what lets a chip appear
 * immediately, with a name and a spinner, for a file that the
 * server has not heard of yet.
 */
export interface Attachment {
  id: string;
  name: string;
  bytes: number;
  status: "reading" | "ready" | "error";
  /* Present once the server has read it. */
  file?: AiAnalysedFile;
  /* Present when it could not be read, written for the learner. */
  error?: string;
}

/* The server's error shape, which is the runtime's own. */
interface UploadErrorBody {
  error?: string;
  code?: AiError["code"];
}

export interface UploadOptions {
  agentId: string | null;
}

/*
 * Sends one file's bytes.
 *
 * Raw body with the name in a header rather than multipart or
 * base64 JSON, matching what the server's route accepts: it is
 * what `fetch(url, { body: file })` sends with no ceremony, and
 * it does not inflate every upload by a third the way base64
 * would.
 *
 * The name goes in a header, which means it has to survive being
 * one — headers are latin-1, and a file called "rapport-été.pdf"
 * would throw before the request left the tab. Encoding it keeps
 * the real name intact across the wire; the server decodes and
 * then sanitises it, because a name is untrusted regardless of
 * how carefully it was transmitted.
 */
async function upload(
  file: File,
  options: UploadOptions,
  signal: AbortSignal
): Promise<AiAnalysedFile> {
  const headers: Record<string, string> = {
    ...(await authHeaders()),
    "Content-Type": file.type || "application/octet-stream",
    "X-File-Name": encodeURIComponent(file.name),
  };

  if (options.agentId) {
    headers["X-Agent-Id"] = options.agentId;
  }

  let response: Response;

  try {
    response = await fetch("/api/agents/files", {
      method: "POST",
      headers,
      body: file,
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new AiError("cancelled", "Upload cancelled.");
    }

    throw new AiError(
      "provider_unavailable",
      error instanceof Error && error.message
        ? "Could not reach BuildGentic to upload that file. Check your connection and try again."
        : "Could not upload that file."
    );
  }

  if (!response.ok) {
    let body: UploadErrorBody | null = null;

    try {
      body = (await response.json()) as UploadErrorBody;
    } catch {
      /* Non-JSON error body; the status message stands. */
    }

    throw new AiError(
      body?.code ?? (response.status >= 500 ? "internal_error" : "invalid_request"),
      body?.error ?? `That file could not be read (HTTP ${response.status}).`
    );
  }

  return ((await response.json()) as { file: AiAnalysedFile }).file;
}

/*
 * A size check the learner sees before the upload starts.
 *
 * A courtesy rather than the enforcement — the server refuses
 * the same file again, from its bytes — but a courtesy worth
 * having: telling somebody their 40 MB video is too big should
 * not require sending 40 MB first.
 *
 * Images are checked against the lower ceiling, and by
 * extension rather than by MIME type, because browsers disagree
 * about what they report for an image dragged out of some
 * applications. Getting this wrong only means a check the
 * server repeats correctly.
 */
function tooBig(file: File, limits: AiFileLimits): string | null {
  const isImage =
    file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name);

  const ceiling = isImage ? limits.maxImageBytes : limits.maxFileBytes;

  if (file.size <= ceiling) {
    return null;
  }

  const mb = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MB`;

  return isImage
    ? `${file.name} is ${mb(file.size)}. Images have a lower limit than documents — ${mb(
        ceiling
      )} — because the picture itself is sent to the model.`
    : `${file.name} is ${mb(file.size)}, and the limit is ${mb(ceiling)}.`;
}

export interface UseAttachmentsOptions {
  limits: AiFileLimits;
}

/*
 * The composer's attachments.
 *
 * Owned by the page rather than by the panel, so that switching
 * to the Model section and back does not silently discard a file
 * somebody has just waited for.
 */
export function useAttachments({ limits }: UseAttachmentsOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  /*
   * The authority for the list, mirroring the state.
   *
   * Same pattern as useAgentChat's `turnsRef`, and here it is
   * load-bearing for a sharper reason than convenience.
   *
   * Starting an upload is a side effect, and side effects must
   * not live inside a state updater. React invokes updaters
   * twice in development to surface exactly this kind of
   * impurity — which it did: every file picked was uploaded
   * twice, held twice, and charged twice, and the browser's
   * network panel is where that showed up.
   *
   * So `add` reads the current list from this ref
   * synchronously, decides everything, starts the uploads, and
   * only then commits. The updater it passes to setState does
   * nothing but return a value.
   */
  const listRef = useRef<Attachment[]>([]);

  /* One controller per in-flight upload, so removing a chip
     actually stops the request rather than just hiding it. */
  const inFlight = useRef(new Map<string, AbortController>());

  /* Writes the ref and the state together, so the two can never
     describe different lists. */
  const commit = useCallback((next: Attachment[]) => {
    listRef.current = next;
    setAttachments(next);
  }, []);

  const patch = useCallback(
    (id: string, next: Partial<Attachment>) => {
      commit(
        listRef.current.map((entry) =>
          entry.id === id ? { ...entry, ...next } : entry
        )
      );
    },
    [commit]
  );

  const add = useCallback(
    (files: FileList | null, options: UploadOptions) => {
      if (!files || files.length === 0) {
        return;
      }

      const picked = [...files];
      const current = listRef.current;

      const room = Math.max(0, limits.maxFilesPerMessage - current.length);

      const accepted: Attachment[] = [];
      const starting: Array<{ entry: Attachment; file: File }> = [];

      for (const file of picked.slice(0, room)) {
        const entry: Attachment = {
          id: newId(),
          name: file.name,
          bytes: file.size,
          status: "reading",
        };

        const oversize = tooBig(file, limits);

        if (oversize) {
          entry.status = "error";
          entry.error = oversize;
        } else {
          starting.push({ entry, file });
        }

        accepted.push(entry);
      }

      /*
       * The ones past the limit are kept as errors rather than
       * dropped. A file that silently fails to appear reads as a
       * broken picker; a chip saying why reads as a rule.
       */
      const refused = picked.slice(room).map<Attachment>((file) => ({
        id: newId(),
        name: file.name,
        bytes: file.size,
        status: "error",
        error: `You can attach up to ${limits.maxFilesPerMessage} files to one message.`,
      }));

      commit([...current, ...accepted, ...refused]);

      /* After the commit, and outside any updater. */
      for (const { entry, file } of starting) {
        const controller = new AbortController();
        inFlight.current.set(entry.id, controller);

        void upload(file, options, controller.signal)
          .then((uploaded) => {
            patch(entry.id, { status: "ready", file: uploaded });
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) {
              return;
            }

            patch(entry.id, {
              status: "error",
              error:
                error instanceof AiError
                  ? error.message
                  : "That file could not be read.",
            });
          })
          .finally(() => {
            inFlight.current.delete(entry.id);
          });
      }
    },
    [commit, limits, patch]
  );

  /*
   * Removes an attachment, and means it.
   *
   * An in-flight upload is aborted; one the server is already
   * holding is deleted there too. A Remove button that only
   * removed a chip from the screen would be a lie about where
   * the document went — the file would sit in the server's store
   * until it expired, and the learner would have been told it
   * was gone.
   */
  const remove = useCallback(
    (id: string) => {
      inFlight.current.get(id)?.abort();
      inFlight.current.delete(id);

      const uploadedId = listRef.current.find((item) => item.id === id)?.file
        ?.id;

      commit(listRef.current.filter((item) => item.id !== id));

      if (!uploadedId) {
        return;
      }

      void (async () => {
        try {
          await fetch(`/api/agents/files/${encodeURIComponent(uploadedId)}`, {
            method: "DELETE",
            headers: await authHeaders(),
          });
        } catch {
          /*
           * Best effort. The store expires it within the
           * retention window regardless, and failing to reach
           * the server is not a reason to leave a chip on screen
           * the learner has asked to remove.
           */
        }
      })();
    },
    [commit]
  );

  /*
   * After a send. The ids have been used; the files belong to
   * the turn that is now in the transcript.
   *
   * The bail-out when the list is already empty is not an
   * optimisation. `clear` is called from an effect that runs
   * when the capability is switched off, and committing a new
   * empty array always re-renders — so without this, clearing an
   * empty list re-renders, which re-runs the effect, which
   * clears again. That is an infinite render loop, and it is
   * exactly what the browser check caught.
   */
  const clear = useCallback(() => {
    for (const controller of inFlight.current.values()) {
      controller.abort();
    }

    inFlight.current.clear();

    if (listRef.current.length > 0) {
      commit([]);
    }
  }, [commit]);

  /*
   * Memoised, and the whole return value with it.
   *
   * Everything below is derived from `attachments`, so
   * recomputing it on every render produces new array
   * identities on every render — which defeats the caller's
   * `useMemo` on the chat config and makes every callback that
   * closes over this a new function each time. The hook is
   * consumed by a page that re-renders on every keystroke, so
   * that is not a theoretical cost.
   */
  return useMemo(() => {
    const ready = attachments.filter(
      (entry): entry is Attachment & { file: AiAnalysedFile } =>
        entry.status === "ready" && Boolean(entry.file)
    );

    return {
      attachments,
      /* The ids a chat request carries. */
      ids: ready.map((entry) => entry.file.id),
      /* What the transcript shows back on the user's turn. */
      sent: ready.map((entry) => ({
        id: entry.file.id,
        name: entry.name,
        kind: entry.file.kind,
      })),
      /* True while any file is still being read, which is what
         disables Send — sending now would ask about a document
         the server has not finished reading. */
      busy: attachments.some((entry) => entry.status === "reading"),
      hasImage: ready.some((entry) => entry.file.kind === "image"),
      add,
      remove,
      clear,
    };
  }, [attachments, add, remove, clear]);
}
