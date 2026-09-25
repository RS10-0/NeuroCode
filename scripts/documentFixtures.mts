/*
 * The documents an agent is actually asked for, as block lists.
 *
 * Shared between verify-documents.mts, which measures them
 * against what a step can write, and anything later that needs
 * a realistic payload rather than a two-block toy.
 *
 * THESE ARE FIXTURES WITH A JOB. The reason make_document
 * advertised a limit eleven times what a model could reach is
 * that every test of it was digest-sized, and a digest fits
 * comfortably at any budget this feature has ever had. The
 * bibliography below is the case that does not — it is what the
 * Research Assistant flagship is sold on, ten sources with real
 * annotations — and it is here so that "can the model actually
 * write this" stays a question somebody has to answer.
 *
 * Kept deliberately verbose. Trimming the annotations to make
 * the file shorter would trim exactly the property being
 * measured.
 */

import type { DocumentBlock } from "../server/src/agents/documents/plan";

/* ---------------------------------------------------------
   A NEWS DIGEST — the shape that always fitted
   --------------------------------------------------------- */

function story(n: number) {
  return {
    title: `Regulator opens consultation on classroom AI tools (${n})`,
    source: "The Guardian",
    date: "2026-09-16",
    summary:
      "The education regulator has opened a six-week consultation on how generative tools are used for assessed work, after a survey of 1,400 schools found wide variation in local policy. Heads asked for a single national line rather than per-school rules.",
  };
}

/* One table, which is how a model asked for a spreadsheet
   sends it. */
export function digestAsTable(): DocumentBlock[] {
  return [
    { type: "heading", level: 1, text: "News digest — 17 September 2026" },
    {
      type: "table",
      columns: ["Story", "Source", "Date", "Summary"],
      rows: [1, 2, 3].map((n) => {
        const s = story(n);
        return [s.title, s.source, s.date, s.summary.slice(0, 280)];
      }),
    },
  ];
}

/*
 * The same digest as prose blocks, which costs more JSON for
 * the same text — every block pays for its own braces and its
 * `"type"`. The worst overhead ratio in the set, and the reason
 * ACTION_JSON_OVERHEAD is sized above the average.
 */
export function digestAsBlocks(): DocumentBlock[] {
  return [
    { type: "heading", level: 1, text: "News digest — 17 September 2026" },
    ...[1, 2, 3].flatMap((n): DocumentBlock[] => {
      const s = story(n);
      return [
        { type: "heading", level: 2, text: s.title },
        { type: "text", text: `${s.source} · ${s.date}` },
        { type: "text", text: s.summary },
      ];
    }),
  ];
}

/* ---------------------------------------------------------
   AN ANNOTATED BIBLIOGRAPHY — the shape that did not
   --------------------------------------------------------- */

function source(n: number) {
  return {
    citation: `Okonkwo, A. and Reyes, M. (2025). "Retrieval practice and long-term recall in adolescent learners: a ${n}-year follow-up". Journal of Educational Psychology, 117(${n}), pp. ${n * 30}-${n * 30 + 18}.`,
    annotation:
      "A longitudinal study of 612 students across nine schools, comparing spaced retrieval practice against massed review. The effect on delayed recall held at twelve months (d = 0.41) but narrowed sharply for material the students rated as uninteresting, which is the finding most relevant to this essay's argument about motivation. Methodologically strong; the attrition rate of 14% is acknowledged and modelled.",
  };
}

/*
 * A citation and an annotation per source, under its own
 * heading — what a student asking for "my sources written up"
 * gets, and what a citation export produces.
 */
export function bibliography(count: number): DocumentBlock[] {
  return [
    {
      type: "heading",
      level: 1,
      text: "Annotated bibliography — memory and revision",
    },
    {
      type: "text",
      text: "Compiled 17 September 2026. Sources are ordered by how directly they bear on the research question.",
    },
    ...Array.from({ length: count }, (_, i): DocumentBlock[] => {
      const s = source(i + 1);
      return [
        { type: "heading", level: 2, text: `Source ${i + 1}` },
        { type: "text", text: s.citation },
        { type: "text", text: s.annotation },
      ];
    }).flat(),
  ];
}

/* The same sources as a two-column grid — the cheapest way to
   express them, and the best ratio in the set. */
export function bibliographyAsTable(count: number): DocumentBlock[] {
  return [
    {
      type: "heading",
      level: 1,
      text: "Annotated bibliography — memory and revision",
    },
    {
      type: "table",
      columns: ["Citation", "Annotation"],
      rows: Array.from({ length: count }, (_, i) => {
        const s = source(i + 1);
        return [s.citation.slice(0, 300), s.annotation.slice(0, 300)];
      }),
    },
  ];
}

/*
 * What the model has to emit for one of these: the whole
 * `{tool,args}` object, exactly as protocol.ts reads it back
 * between the sentinels.
 *
 * Measuring anything less would understate it. The block list
 * on its own leaves out the tool name, the format, the title
 * and the `args` wrapper, and those are not free.
 */
export function actionPayload(
  blocks: DocumentBlock[],
  title = "Annotated bibliography — memory and revision"
): string {
  return JSON.stringify({
    tool: "make_document",
    args: { format: "docx", title, blocks },
  });
}
