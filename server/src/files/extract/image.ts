import { fileAnalysis } from "../../ai/config";
import { refuseFile } from "../errors";
import type { AcceptedFile, ExtractedFile, FileExtractor } from "../types";

/*
 * Reading an image — which means measuring it, and nothing more.
 *
 * This is the one extractor that produces no text, and the
 * reason is the whole design of image support. A picture cannot
 * be described into a prompt without something looking at it,
 * and the only thing here capable of looking at it is the model.
 * So the bytes travel to the provider and the model does the
 * work, which is why File Analysis refuses an image outright on
 * a model that cannot see one rather than sending it hopefully.
 *
 * What this file does is decide whether the bytes are safe to
 * send. Dimensions are read from the header — a few bytes, no
 * decoding — because a 40-megapixel image is a decompression
 * bomb shaped like a holiday photo: a few hundred kilobytes on
 * disk that becomes a gigabyte in the provider's decoder, or in
 * ours if we ever added one.
 *
 * Nothing here decodes pixels, resizes, re-encodes or strips
 * metadata. Each of those would mean an image-processing
 * dependency parsing hostile input, which is a substantially
 * larger attack surface than the header read below, and none of
 * them is needed to answer "what does this chart show?".
 */

export const imageExtractor: FileExtractor = {
  kind: "image",
  displayName: "image",

  async extract(file: AcceptedFile): Promise<ExtractedFile> {
    const size =
      file.mediaType === "image/png"
        ? pngSize(file.bytes)
        : jpegSize(file.bytes);

    if (!size) {
      throw refuseFile(
        `${file.name} could not be read as an image. It may be corrupt, or saved in a format BuildGentic does not handle.`,
        `${file.mediaType} header did not yield dimensions`
      );
    }

    const pixels = size.width * size.height;

    if (pixels > fileAnalysis.maxImagePixels) {
      throw refuseFile(
        `${file.name} is ${size.width}×${size.height} pixels, which is ${(
          pixels / 1_000_000
        ).toFixed(
          0
        )} megapixels. The limit is ${Math.round(
          fileAnalysis.maxImagePixels / 1_000_000
        )}. Scaling it down first also makes the answer better — a model reading a huge image sees it shrunk anyway.`
      );
    }

    return {
      kind: "image",
      /*
       * No sections, deliberately. An empty text extract is the
       * honest representation of a file whose content nothing on
       * this server has read — the renderer says an image was
       * attached and the model says what is in it.
       */
      sections: [],
      truncated: false,
      image: {
        mediaType: file.mediaType,
        dataBase64: file.bytes.toString("base64"),
        width: size.width,
        height: size.height,
      },
    };
  },
};

interface Size {
  width: number;
  height: number;
}

/*
 * PNG puts its dimensions in the IHDR chunk, which the format
 * requires to be first — so this is a fixed offset read, not a
 * search.
 */
function pngSize(bytes: Buffer): Size | null {
  if (bytes.length < 24) {
    return null;
  }

  if (bytes.toString("latin1", 12, 16) !== "IHDR") {
    return null;
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  return width > 0 && height > 0 ? { width, height } : null;
}

/*
 * JPEG has no fixed header. Dimensions live in whichever
 * start-of-frame marker the encoder chose, which is somewhere
 * after an arbitrary run of metadata segments — so this walks
 * the segment chain.
 *
 * The walk is bounded in three ways, and all three matter
 * because the lengths come out of the file: segments must move
 * forward, a zero or negative length ends the walk, and the
 * whole thing gives up after a fixed number of segments. A
 * crafted file whose segment claims to be two bytes long can
 * otherwise loop forever inside a size check.
 */
function jpegSize(bytes: Buffer): Size | null {
  let offset = 2;
  let segments = 0;

  while (offset + 9 < bytes.length && segments < 512) {
    segments += 1;

    if (bytes[offset] !== 0xff) {
      /* Fill bytes are legal between segments. */
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    /* Standalone markers carry no length. */
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    /* Start of scan: the compressed data begins and there is no
       frame header left to find. */
    if (marker === 0xda || marker === 0xd9) {
      return null;
    }

    const length = bytes.readUInt16BE(offset + 2);

    if (length < 2) {
      return null;
    }

    /*
     * Every start-of-frame marker: baseline, extended,
     * progressive, lossless and their arithmetic-coded
     * counterparts. The four excluded values in these ranges are
     * DHT, JPG, DAC and DNL, which are not frame headers.
     */
    const isFrame =
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isFrame) {
      if (offset + 9 >= bytes.length) {
        return null;
      }

      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);

      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += 2 + length;
  }

  return null;
}
