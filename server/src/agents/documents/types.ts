import { documents } from "../../ai/config";

/*
 * What a renderer hands back, and the two ways it declines.
 *
 * Both failures are exceptions rather than a result union, and
 * that is the opposite of how the tool layer works — `ToolSpec.run`
 * returns a failed outcome rather than throwing, deliberately,
 * because a tool that could not do its job is an ordinary step
 * the model reacts to.
 *
 * The difference is where the decision is made. A renderer is
 * three call frames deep in a page loop; unwinding by return
 * value would mean every one of those frames carrying a failure
 * branch that exists only to pass it up. So the renderers throw,
 * `render.ts` catches, and the TOOL still returns a
 * `ToolOutcome` — the boundary the rest of the system sees is
 * unchanged.
 */

export interface Rendered {
  bytes: Buffer;
  /* Whichever the format has. Absent means the idea does not
     apply to this format, not that it is unknown. */
  pages?: number;
  rows?: number;
  sheets?: number;
  /*
   * What could not be represented, in words an owner can read.
   *
   * Present is a warning, never an error: the file exists and
   * opens. Today only the PDF writer sets it, for characters
   * outside WinAnsi — the OOXML formats are UTF-8 and have
   * nothing to lose.
   */
  degraded?: string;
}

/*
 * The renderer will not produce this document, and the message
 * says what to do instead.
 *
 * Written for the model, in the second person, naming a
 * recovery — "ask for docx", "send fewer rows". A refusal the
 * model cannot act on costs a step and teaches nothing, which
 * is the same standard `renderFailure` in protocol.ts holds
 * tool errors to.
 */
export class RenderRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderRefused";
  }
}

/*
 * It rendered, and it is too big to keep.
 *
 * Its own class because the message has to name both numbers,
 * and because this is the one failure that is nobody's mistake
 * — the plan passed every check and the output still came out
 * over the ceiling. Refused rather than truncated: half a PDF
 * is not a smaller PDF, it is a file that will not open.
 */
export class DocumentTooLarge extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super(
      `That document came out at ${Math.round(bytes / 1024)} KB and the limit is ${Math.round(
        documents.maxBytes / 1024
      )} KB. Send fewer rows, or split it across two documents.`
    );

    this.name = "DocumentTooLarge";
    this.bytes = bytes;
  }
}
