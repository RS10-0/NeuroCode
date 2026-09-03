import { refuseFile } from "../errors";
import { docxExtractor } from "./docx";
import { imageExtractor } from "./image";
import { pdfExtractor } from "./pdf";
import { csvExtractor, xlsxExtractor } from "./sheet";
import type { FileExtractor, FileKind } from "../types";

/*
 * The extractor registry.
 *
 * The same shape as ai/ProviderRegistry.ts and
 * search/SearchRegistry.ts, and for the same reason: adding
 * PowerPoint later should be one new file plus one line here,
 * with nothing above this directory needing to know that a sixth
 * format exists.
 *
 * A plain object rather than a registration function, because
 * unlike a provider an extractor has no configuration to check
 * and no key to be missing. Every one of these is always
 * available; whether a given FILE is readable is a question its
 * own extractor answers.
 */
const EXTRACTORS: Record<FileKind, FileExtractor> = {
  pdf: pdfExtractor,
  docx: docxExtractor,
  xlsx: xlsxExtractor,
  csv: csvExtractor,
  image: imageExtractor,
};

export function extractorFor(kind: FileKind): FileExtractor {
  const extractor = EXTRACTORS[kind];

  if (!extractor) {
    /*
     * Unreachable while sniff.ts and this map agree, which is
     * exactly why it throws rather than returning undefined: the
     * day somebody adds a kind to the union and forgets this
     * line, the failure should name itself.
     */
    throw refuseFile(
      "BuildGentic cannot read that kind of file.",
      `no extractor registered for kind "${kind}"`
    );
  }

  return extractor;
}

export function describeKind(kind: FileKind): string {
  return EXTRACTORS[kind]?.displayName ?? kind;
}
