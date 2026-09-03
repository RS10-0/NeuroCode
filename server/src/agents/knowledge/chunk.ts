import { createHash } from "node:crypto";

import { retrieval } from "../../ai/config";

/*
 * Cutting a knowledge entry into pieces that can be searched.
 *
 * This is the first half of retrieval and the half nobody looks
 * at, which is unfortunate, because it decides more about
 * whether an agent answers well than the embedding model does.
 * A chunk that stops mid-sentence embeds to the meaning of half
 * a thought. A chunk that swallows an entire document embeds to
 * the average of everything in it, which is to say nothing.
 *
 * So the rules, in order of preference:
 *
 *   split at a markdown heading   — the author already told us
 *                                   where the topics change
 *   split at a blank line         — a paragraph is a unit
 *   split at a sentence end       — still a complete thought
 *   split at a word boundary      — last resort, never mid-word
 *
 * Two things are carried across boundaries. The heading a chunk
 * fell under is prepended to it, so a piece from the middle of
 * a document still says what it is about — which matters twice
 * over, because that text is both embedded and shown to the
 * model as a citation. And the tail of the previous chunk is
 * repeated at the front of the next, so a fact that straddles a
 * boundary exists somewhere in one piece rather than in neither.
 *
 * Pure, synchronous, and dependency-free: given the same text
 * and the same settings it always produces the same chunks,
 * which is what makes `contentHash` below a reliable answer to
 * "are the stored chunks still current?".
 */

export interface Chunk {
  /* 0-based position within the entry. */
  ordinal: number;
  content: string;
}

export interface ChunkOptions {
  /* Soft target. A chunk may exceed it slightly once its
     heading and overlap are prepended. */
  chunkChars: number;
  overlapChars: number;
  /* Hard ceiling, from the embedding model. Nothing may exceed
     this, because the provider would refuse it. */
  maxChars: number;
}

export function defaultChunkOptions(maxChars: number): ChunkOptions {
  return {
    chunkChars: Math.max(120, retrieval.chunkChars),
    /* Never more than half the chunk, or the overlap becomes the
       chunk and the same text is embedded three times. */
    overlapChars: Math.max(
      0,
      Math.min(retrieval.chunkOverlap, Math.floor(retrieval.chunkChars / 2))
    ),
    maxChars: Math.max(240, maxChars),
  };
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/;

interface Block {
  text: string;
  /* The most recent heading at or above this block. Empty at
     the top of a document that has none. */
  heading: string;
  isHeading: boolean;
}

/*
 * Paragraph-sized units, each tagged with the heading it lives
 * under.
 *
 * Headings become blocks of their own rather than being
 * swallowed into the paragraph beneath them, so a heading
 * immediately followed by a long paragraph does not force the
 * two apart at an awkward point.
 */
function toBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const blocks: Block[] = [];

  let heading = "";
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join("\n").trim();
    buffer = [];

    if (joined) {
      blocks.push({ text: joined, heading, isHeading: false });
    }
  };

  for (const line of lines) {
    const match = HEADING.exec(line);

    if (match) {
      flush();
      heading = match[2];
      blocks.push({ text: line.trim(), heading, isHeading: true });
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    buffer.push(line);
  }

  flush();

  return blocks;
}

/*
 * Breaks a single over-long block into pieces, preferring
 * sentence ends and falling back to word boundaries.
 *
 * The fallback matters more than it looks: a pasted CSV, a
 * minified JSON blob or a language that does not use spaces has
 * no sentence ends at all, and a splitter that only knew about
 * full stops would hand the embedding provider one 40 KB string
 * and get an error nobody could act on.
 */
function splitLong(text: string, limit: number): string[] {
  const pieces: string[] = [];

  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);

    /* Last sentence end that leaves a piece worth having. */
    let cut = -1;

    for (const match of window.matchAll(/[.!?](?=\s|$)/g)) {
      if (match.index !== undefined && match.index >= limit * 0.4) {
        cut = match.index + 1;
      }
    }

    if (cut === -1) {
      const space = window.lastIndexOf(" ");
      cut = space >= limit * 0.4 ? space : limit;
    }

    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) {
    pieces.push(rest);
  }

  return pieces.filter(Boolean);
}

/*
 * The tail of the previous chunk, snapped to a word boundary.
 *
 * Snapped rather than cut at exactly N characters because an
 * overlap beginning "…ondary school" is worse than useless: it
 * embeds a word that does not exist and shows the model a
 * fragment.
 */
function tailOf(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) {
    return text.trim();
  }

  const tail = text.slice(text.length - chars);
  const space = tail.search(/\s/);

  return (space === -1 ? tail : tail.slice(space + 1)).trim();
}

export function chunkText(
  text: string,
  options: ChunkOptions
): Chunk[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const blocks = toBlocks(trimmed);

  if (blocks.length === 0) {
    return [];
  }

  /* Room for a heading line and an overlap on top of the target,
     without ever passing what the provider accepts. */
  const hardLimit = options.maxChars;
  const bodyLimit = Math.min(options.chunkChars, hardLimit - 200);

  const chunks: Chunk[] = [];

  let current: string[] = [];
  let currentHeading = "";
  let currentChars = 0;
  let previous = "";

  const push = () => {
    if (current.length === 0) {
      return;
    }

    const body = current.join("\n\n").trim();
    current = [];
    currentChars = 0;

    if (!body) {
      return;
    }

    const parts: string[] = [];

    /*
     * The heading, unless the chunk already opens with it —
     * which it does whenever a section starts a new chunk, and
     * repeating it there would be noise in both the vector and
     * the citation.
     */
    if (currentHeading && !body.startsWith("#")) {
      parts.push(`## ${currentHeading}`);
    }

    const overlap =
      previous && options.overlapChars > 0
        ? tailOf(previous, options.overlapChars)
        : "";

    if (overlap) {
      parts.push(overlap);
    }

    parts.push(body);

    const content = parts.join("\n\n").slice(0, hardLimit).trim();

    if (content) {
      chunks.push({ ordinal: chunks.length, content });
      previous = body;
    }
  };

  for (const block of blocks) {
    /*
     * A heading closes the chunk before it. Topic boundaries
     * are the best split points a document offers and throwing
     * them away to save a few chunks would be a poor trade.
     */
    if (block.isHeading) {
      push();
      currentHeading = block.heading;
      current.push(block.text);
      currentChars = block.text.length;
      continue;
    }

    for (const piece of splitLong(block.text, bodyLimit)) {
      if (currentChars > 0 && currentChars + piece.length + 2 > bodyLimit) {
        push();
        currentHeading = block.heading;
      }

      if (current.length === 0) {
        currentHeading = block.heading;
      }

      current.push(piece);
      currentChars += piece.length + 2;
    }
  }

  push();

  return chunks;
}

/*
 * Proof that a set of stored chunks is still the right text.
 *
 * Everything that would change the chunks is in it: the text
 * itself, the title (which is part of every citation), and the
 * chunker's settings.
 *
 * The embedding model is deliberately NOT in it, and that is
 * what lets an agent be switched between BuildGentic's AI and its
 * owner's without re-embedding every time. The two facts are
 * separate questions — "is this still the same text?" and "was
 * it embedded by the model we are about to search with?" — and
 * the indexer answers them independently, so switching back to
 * a model whose chunks are still on disk costs nothing.
 *
 * A hash rather than a timestamp, so that saving an entry
 * without touching it does not re-embed a document, and editing
 * one character does.
 */
export function contentHash(input: {
  title: string;
  content: string;
  options: ChunkOptions;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.title.trim(),
        input.content,
        input.options.chunkChars,
        input.options.overlapChars,
        input.options.maxChars,
      ])
    )
    .digest("hex");
}
