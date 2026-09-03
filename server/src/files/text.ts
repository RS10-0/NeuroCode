import { fileAnalysis } from "../ai/config";
import { collapse } from "../search/sanitize";
import type { ExtractedSection } from "./types";

/*
 * Turning whatever came out of a parser into text that is safe
 * to put in a prompt.
 *
 * Every extractor ends here, and the reason is the same one that
 * put search/sanitize.ts between a search provider and the
 * prompt: the value has to be made well-formed in one place, or
 * a format added in a hurry lowers the floor for all of them.
 *
 * What "well-formed" means here is narrower than it is for a
 * search snippet, because a document has structure worth
 * keeping. Newlines survive — a spreadsheet's rows and a
 * document's paragraphs are the difference between answering
 * "what does row 12 say" and not — while control characters,
 * bidirectional overrides and runaway blank space do not.
 *
 * The framing that makes this text data rather than instructions
 * is not here. It is in agents/files/context.ts, for the same
 * reason it is in websearch/context.ts rather than in the
 * sanitiser: making a value well-formed and making a model treat
 * it as quoted material are two different jobs, and neither is
 * sufficient alone.
 */

/*
 * One line of extracted text.
 *
 * `collapse` does the character-class work — the same one the
 * search layer uses — and is applied per line so the line breaks
 * that carry a document's structure survive it.
 */
function cleanLine(line: string): string {
  return collapse(line);
}

/*
 * Whitespace, made regular.
 *
 * PDF extraction in particular produces a lot of ragged space:
 * a page of a two-column layout can come back with dozens of
 * blank lines between fragments. Left alone that is thousands of
 * characters of nothing eating a budget meant for words.
 */
export function tidy(raw: string): string {
  const lines = raw.split(/\r\n|\r|\n/).map(cleanLine);

  const out: string[] = [];
  let blanks = 0;

  for (const line of lines) {
    if (line === "") {
      blanks += 1;
      /* One blank line is a paragraph break and is worth
         keeping. Six are a layout artefact. */
      if (blanks > 1 || out.length === 0) {
        continue;
      }
    } else {
      blanks = 0;
    }

    out.push(line);
  }

  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }

  return out.join("\n");
}

/*
 * Cuts a value to a ceiling at a sensible boundary.
 *
 * Used for spreadsheet cells, where a single cell containing an
 * essay would otherwise spend a whole row's budget. The ellipsis
 * is deliberate and visible: a value that has been shortened
 * should look shortened to the model reading it.
 */
export function clip(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars).trimEnd()}…`;
}

export interface CappedSections {
  sections: ExtractedSection[];
  truncated: boolean;
  /* Written for the learner, and repeated to the model. Present
     only when something was actually dropped. */
  truncationNote?: string;
}

/*
 * Applies the per-file extraction ceiling across a document's
 * sections.
 *
 * The rule this encodes, and the reason it is a shared helper
 * rather than four copies: a document that runs out of budget
 * stops at a section boundary and SAYS SO. It does not stop
 * quietly, and it does not stop in the middle of a sentence
 * unless the very first section is bigger than the whole budget
 * — which is the one case where there is nothing else to do.
 *
 * "Says so" is the part that matters. A learner whose fifty-page
 * report reached the model as thirty pages needs to know that,
 * because "the agent did not mention the conclusion" and "the
 * conclusion was never sent" look identical from the outside and
 * have completely different fixes. The note travels in two
 * directions: into the prompt, where the model can say it, and
 * into the telemetry, where the Test panel shows it.
 */
export function capSections(
  sections: ExtractedSection[],
  unit: string
): CappedSections {
  const budget = Math.max(0, fileAnalysis.maxExtractedChars);

  if (budget === 0) {
    return { sections, truncated: false };
  }

  const kept: ExtractedSection[] = [];
  let spent = 0;

  for (const section of sections) {
    const cost = section.label.length + section.text.length + 2;

    if (spent + cost <= budget) {
      kept.push(section);
      spent += cost;
      continue;
    }

    /*
     * Nothing has fitted yet and this one is already too big.
     * Cutting mid-section is worse than dropping it, except when
     * dropping it leaves the model with nothing at all.
     */
    if (kept.length === 0) {
      const room = Math.max(500, budget - section.label.length - 200);

      kept.push({
        label: section.label,
        text: `${section.text.slice(0, room).trimEnd()}\n[Cut here: this ${unit} is longer than the space available.]`,
      });
    }

    break;
  }

  if (kept.length === sections.length) {
    return { sections: kept, truncated: false };
  }

  const dropped = sections.length - kept.length;

  return {
    sections: kept,
    truncated: true,
    truncationNote:
      dropped > 0
        ? `Only the first ${kept.length} of ${sections.length} ${unit}s fitted in the space BuildGentic allows for one file. The rest was not sent.`
        : `This ${unit} was longer than the space BuildGentic allows for one file and was cut short.`,
  };
}
