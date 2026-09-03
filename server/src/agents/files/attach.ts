import { fileAnalysis } from "../../ai/config";
import { AiRuntimeError } from "../../ai/errors";
import type {
  AnalysedFile,
  ChatImage,
  FileAnalysisReason,
  ModelDescriptor,
} from "../../ai/types";
import { get, type FileScope, type HeldFile } from "../../files/FileStore";
import { renderFileContext } from "./context";

/*
 * One turn of File Analysis, end to end.
 *
 * Resolve, check, render — and unlike the web-search equivalent,
 * this one THROWS. That difference is the whole design decision
 * in this file, so it is worth stating plainly.
 *
 * A failed search degrades: most questions do not need the web,
 * an agent that cannot search must still answer, and turning a
 * search provider's bad ten minutes into a 503 would be the
 * wrong trade every time. None of that is true of an
 * attachment. Somebody attached a file and asked about it. An
 * answer produced without the file is not a slightly worse
 * answer to the same question — it is a confident answer to a
 * different one, and the person reading it has no way to tell.
 *
 * So every failure here is a refusal naming the problem: the
 * attachment expired, the model cannot see images, the document
 * did not fit. All of them are things the person can act on, and
 * all of them are better than an agent that quietly answers from
 * memory about a document it never received.
 */

export interface AttachInput {
  scope: FileScope;
  /* The ids the caller sent, already shape-checked by the
     validator. Ownership is checked here, and only here. */
  attachments: string[];
  model: ModelDescriptor;
}

export interface AttachOutcome {
  /* Appended to the system prompt. */
  text: string;
  /* Attached to the last user turn. Empty for a message with no
     images on it, which is most of them. */
  images: ChatImage[];
  /* For the `file_analysis` stream event and the Test panel. */
  files: AnalysedFile[];
  reason?: FileAnalysisReason;
}

export const NO_FILES: AttachOutcome = { text: "", images: [], files: [] };

function refuse(message: string, detail?: string): never {
  throw new AiRuntimeError("invalid_request", message, {
    internalDetail: detail,
  });
}

/*
 * Resolves what was attached and turns it into prompt material.
 *
 * The ownership check is `FileStore.get`, and it is the only one
 * — every path into an attachment goes through a function that
 * demands a scope alongside the id, so there is no query that
 * could accidentally omit it. A file belonging to another
 * learner, a file that has expired, and an id that never existed
 * are one indistinguishable outcome, which is what somebody
 * else's id should look like.
 */
export function attachFiles(input: AttachInput): AttachOutcome {
  if (input.attachments.length === 0) {
    return { ...NO_FILES, reason: "none" };
  }

  if (input.attachments.length > Math.max(1, fileAnalysis.maxFilesPerMessage)) {
    refuse(
      `You can attach up to ${fileAnalysis.maxFilesPerMessage} files to one message. Remove some and ask again — or ask about them one at a time, which usually gets a better answer anyway.`
    );
  }

  const held: HeldFile[] = [];

  for (const id of input.attachments) {
    const entry = get(id, input.scope);

    if (!entry) {
      /*
       * Deliberately one message for three causes. See the note
       * on FileStore.get: telling somebody that an id they
       * guessed exists but is not theirs is telling them it is
       * somebody's.
       */
      refuse(
        "One of the attached files is no longer available. Attachments are held for a short while after they are uploaded — attach it again and ask once more.",
        `attachment ${String(id).slice(0, 8)}… not resolvable for this scope`
      );
    }

    /* An id sent twice would render the same document twice and
       charge the budget for both. */
    if (!held.some((existing) => existing.id === entry.id)) {
      held.push(entry);
    }
  }

  const images = held.filter((entry) => entry.extracted.image);

  if (images.length > Math.max(1, fileAnalysis.maxImagesPerMessage)) {
    refuse(
      `You can attach up to ${fileAnalysis.maxImagesPerMessage} images to one message. Each one is sent to the model in full, which is why the limit is lower than for documents.`
    );
  }

  /*
   * THE HONESTY CHECK.
   *
   * A model that cannot see an image is told about it in the
   * prompt, receives no pixels, and answers anyway — describing
   * a picture it has never seen, fluently and completely wrongly,
   * with nothing on screen to suggest anything went missing.
   * That is the single worst failure this capability could
   * produce, and it is the reason `vision` is on the model
   * descriptor rather than assumed per provider.
   *
   * So it is a refusal, before the quota slot, naming the model
   * and naming the fix.
   */
  if (images.length > 0 && !input.model.vision) {
    refuse(
      `${input.model.displayName} cannot look at images — it reads text only. Choose a model that can see pictures, or remove ${
        images.length === 1
          ? `"${images[0].name}"`
          : "the images"
      } and ask about a document instead.`,
      `model ${input.model.id} has no vision capability; ${images.length} image(s) attached`
    );
  }

  const rendered = renderFileContext(held);

  if (rendered.dropped.length > 0) {
    /*
     * Dropped rather than truncated, and refused rather than
     * dropped quietly.
     *
     * The per-file cut already happened during extraction, where
     * it could be described honestly. Reaching this line means
     * the files that survived that still do not fit one prompt
     * together — so the only remaining choices are to answer
     * about some of them without saying which, or to say so.
     */
    refuse(
      `${rendered.dropped
        .map((file) => `"${file.name}"`)
        .join(" and ")} did not fit alongside the other attachments. Ask about ${
        rendered.dropped.length === 1 ? "it" : "them"
      } in a separate message, or remove one of the others.`,
      `${rendered.dropped.length} file(s) over the ${fileAnalysis.contextChars}-char context budget`
    );
  }

  return {
    text: rendered.text,
    files: rendered.files,
    images: held
      .map((entry) => entry.extracted.image ? toChatImage(entry) : null)
      .filter((image): image is ChatImage => image !== null),
  };
}

function toChatImage(entry: HeldFile): ChatImage | null {
  const image = entry.extracted.image;

  if (!image) {
    return null;
  }

  return {
    name: entry.name,
    mediaType: image.mediaType,
    dataBase64: image.dataBase64,
    width: image.width,
    height: image.height,
  };
}
