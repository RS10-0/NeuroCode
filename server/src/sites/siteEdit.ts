import { runChat } from "../ai/AiRuntime";
import { siteEditLimits } from "../ai/config";
import { defaultModel } from "../ai/models";
import { AiRuntimeError } from "../ai/errors";
import {
  applyEdits,
  describeConfig,
  describeEdit,
  EditPlanError,
  parseEditPlan,
  type EditPlan,
  type SiteEdit,
} from "../../../src/features/sites/edits";
import {
  CORNER_STYLES,
  FONT_PAIRS,
  LIMITS,
  PALETTE_IDS,
  parseSiteConfig,
  SECTION_ICONS,
  SECTION_KINDS,
  SiteConfigError,
  TEMPLATE_IDS,
  THEME_MODES,
  type SiteConfig,
} from "../../../src/features/sites/schema";

/*
 * "Make the background darker", turned into a field change.
 *
 * The model call goes back through `runChat`, which is the same
 * decision the web-search planner and the memory extractor
 * made, for the same reason: the alternative is a second path
 * to a provider with its own credential lookup, its own
 * timeouts and its own usage row — precisely the drift the
 * runtime exists to prevent. Going round again means this is
 * admitted by the same gate, recorded in the same table and
 * refused by the same rules as everything else the student
 * does, and BYOK is correct for free.
 *
 * Recursion is bounded structurally rather than by a counter:
 * the body below sets every capability flag to false, so this
 * call cannot reach retrieval, search, files or memory.
 *
 * WHAT THE MODEL IS TRUSTED WITH is the part worth being
 * precise about, because it is less than it looks. Its output
 * is not applied — it is parsed into operations from a closed
 * list, the operations are applied by code that cannot do
 * anything they do not name, and the result goes through
 * `parseSiteConfig` before it can be stored. So the model's
 * influence is bounded twice over, and neither bound is a
 * matter of it following instructions.
 *
 * The prompt therefore does not need to be defensive. It needs
 * to be CLEAR, because the failure it can actually cause is a
 * student getting a change they did not ask for — which is
 * annoying and undoable, not dangerous.
 */

export interface SiteEditInput {
  userId: string;
  agentId: string;
  config: SiteConfig;
  request: string;
  signal?: AbortSignal;
}

export interface SiteEditResult {
  /* The proposed document. Already parsed, so a caller can
     store it — but the editor shows it first. */
  config: SiteConfig;
  /* What actually changed, described from the operations rather
     than from the model's own account of them. */
  changes: string[];
  /* What was asked for that no field can express. */
  unsupported: string[];
  summary: string;
}

/* =========================================================
   THE PROMPT

   Built from the schema's own constants rather than written
   out by hand, so a new palette or section kind is available
   to natural-language editing the moment it exists — and an
   removed one stops being offered. A hand-written list would
   drift from the vocabulary the parser accepts, and the
   student would be told their request worked while the
   operation was silently dropped.
========================================================= */

function systemPrompt(): string {
  return [
    "You edit a student's public web page for their AI agent.",
    "",
    "You do NOT write HTML, CSS, JavaScript or any code. The page is a",
    "structured document with a fixed set of fields, and you change it by",
    "returning a list of operations. There is no operation for custom code,",
    "custom colours, images, videos, or embedding anything, because the page",
    "cannot contain those things.",
    "",
    "Answer with ONE JSON object and nothing else. No prose before or after,",
    "no markdown fence. The object has exactly three keys:",
    "",
    '  {"edits": [...], "unsupported": [...], "summary": "..."}',
    "",
    "edits       — the operations to apply, in order. Empty if none apply.",
    "unsupported — short plain-English notes for parts of the request that",
    "              no field can express. Empty if everything was doable.",
    "summary     — one sentence, addressed to the student, saying what you",
    "              changed. No markdown.",
    "",
    "OPERATIONS",
    "",
    `  {"op":"set_template","template":"<${TEMPLATE_IDS.join("|")}>"}`,
    "      assistant = chat-first, one column.",
    "      study     = sidebar plus a full-height chat pane.",
    "      portfolio = long editorial scroll, chat in a corner launcher.",
    "      research  = a document with a contents rail.",
    "",
    "  {\"op\":\"set_theme\", any of:",
    `      "palette":"<${PALETTE_IDS.join("|")}>",`,
    `      "mode":"<${THEME_MODES.join("|")}>",`,
    `      "font":"<${FONT_PAIRS.join("|")}>",`,
    `      "corners":"<${CORNER_STYLES.join("|")}>"}`,
    "      mode is how light or dark the page is. Darker => \"dark\".",
    "      There are no other colours. Asked for a colour outside the",
    "      palette list, pick the closest one and say so in summary.",
    "",
    `  {"op":"set_name","siteName":"..."}   (max ${LIMITS.siteName} chars)`,
    "",
    "  {\"op\":\"set_hero\", any of:",
    `      "headline":"..." (max ${LIMITS.headline}),`,
    `      "subtext":"..." (max ${LIMITS.subtext}),`,
    `      "tagline":"..." (max ${LIMITS.tagline}),`,
    '      "showAvatar":true|false}',
    "",
    "  {\"op\":\"set_chat\", any of:",
    '      "enabled":true|false,',
    `      "greeting":"..." (max ${LIMITS.greeting}),`,
    `      "placeholder":"..." (max ${LIMITS.placeholder}),`,
    `      "suggestedPrompts":["...", ...] (max ${LIMITS.prompts} items,`,
    `          ${LIMITS.prompt} chars each),`,
    '      "allowUploads":true|false}',
    "",
    '  {"op":"set_footer","showBadge":true|false,"note":"..."}',
    "",
    `  {"op":"add_section","kind":"<${SECTION_KINDS.join("|")}>",`,
    '      "title":"...", then EITHER "body":"..." for about/text,',
    '      OR "items":[...] for features/steps/faq}',
    `      Max ${LIMITS.sections} sections on a page.`,
    "",
    '  {"op":"update_section","ref":N, "title"?, "body"?, "items"?}',
    '  {"op":"remove_section","ref":N}',
    '  {"op":"move_section","ref":N,"direction":"up"|"down"}',
    "      ref is the SECTION NUMBER from the outline below, starting at 1.",
    "",
    "ITEM SHAPES",
    `  features: {"icon":"<one of: ${SECTION_ICONS.join(", ")}>",`,
    `             "title":"...", "body":"..."}`,
    '  steps:    {"title":"...", "body":"..."}',
    '  faq:      {"question":"...", "answer":"..."}',
    "  items REPLACES the whole list for that section, so include the",
    "  items you want to keep as well as the ones you are adding.",
    "",
    "RULES",
    "  - Change only what was asked for. Do not tidy, rewrite or improve",
    "    anything else, and do not restyle a page because you would have",
    "    designed it differently.",
    "  - All text is plain text. No HTML, no markdown, no emoji-as-icons.",
    "  - If part of the request needs something the fields cannot express —",
    "    a logo, an image, a video, a custom colour, a form, a link, a font",
    "    that is not listed, arbitrary layout — put it in unsupported and",
    "    do NOT approximate it with something else. Saying it cannot be done",
    "    is the correct answer and is more useful than a near miss.",
    "  - If the whole request is unsupported, return an empty edits list.",
  ].join("\n");
}

function userPrompt(config: SiteConfig, request: string): string {
  return [
    "THE PAGE AS IT IS NOW",
    "",
    describeConfig(config),
    "",
    "WHAT THE STUDENT ASKED FOR",
    "",
    request,
  ].join("\n");
}

/* =========================================================
   READING THE ANSWER
========================================================= */

/*
 * The first JSON object in the text.
 *
 * Models fence JSON in markdown, or preface it with a sentence,
 * however firmly they are told not to. Scanning for the first
 * balanced object costs nothing and turns a formatting habit
 * into a non-event — and this is a small model call whose one
 * job is structured output, so being lenient about the wrapper
 * while being strict about the contents is the right split.
 */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");

  if (start === -1) {
    throw new EditPlanError("The assistant did not answer with a change.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          throw new EditPlanError(
            "The assistant's answer could not be read. Try rephrasing."
          );
        }
      }
    }
  }

  throw new EditPlanError(
    "The assistant's answer was cut off. Try a shorter request."
  );
}

/* =========================================================
   THE CALL
========================================================= */

export async function planSiteEdit(
  input: SiteEditInput
): Promise<SiteEditResult> {
  const request = input.request.trim();

  if (!request) {
    throw new AiRuntimeError(
      "invalid_request",
      "Say what you would like to change."
    );
  }

  if (request.length > siteEditLimits.maxRequestChars) {
    throw new AiRuntimeError(
      "invalid_request",
      `Keep the request under ${siteEditLimits.maxRequestChars} characters.`
    );
  }

  /* BuildGentic publishes one model, and this uses it — the same
     one that will answer on the page being edited. */
  const model = defaultModel();

  let text = "";

  for await (const event of runChat({
    userId: input.userId,
    signal: input.signal,
    /*
     * Its own quota window, the same shape every capability
     * uses: an edit is a second call on top of whatever else
     * the student is doing, and charging it to their chat
     * window would mean designing a page eats the allowance
     * for testing the agent it is a page for.
     */
    quotaScope: {
      prefix: "siteedit",
      limits: siteEditLimits.quota,
    },
    body: {
      model: model.id,
      system: systemPrompt(),
      messages: [{ role: "user", content: userPrompt(input.config, request) }],
      settings: {
        /*
         * Low, not zero. This is structured output where the
         * operations must be exact, but the copy it writes for
         * a new section is prose and reads like a form letter
         * at zero.
         */
        temperature: 0.2,
        maxOutputTokens: siteEditLimits.maxOutputTokens,
      },
      feature: "site_edit",
      agentId: input.agentId,
      /* All four off. This is what bounds the recursion
         structurally rather than with a depth counter, and it
         is also why an edit costs one call rather than five. */
      knowledgeRetrieval: false,
      webSearch: false,
      fileAnalysis: false,
      memory: false,
      /* A page edit designs a layout. It has no business
         running code or calling anything. */
      codeExecution: false,
      httpActions: false,
      /* This call turns "make the background darker" into a
         field change. It has no business writing a file or
         touching the agent's records, and the agent whose page
         it is is not even the thing being asked. */
      documentGeneration: false,
      dataStore: false,
      /* Writing page copy. It has no business with anybody's
         post, and the compiler required an answer. */
      emailRead: false,
      emailDraft: false,
      emailOrganize: false,
      /* Nothing attached either: the page outline is the whole
         context, and re-sending a student's uploads to decide
         a palette would pay for them again and change nothing. */
      attachments: [],
      stream: false,
    },
  })) {
    if (event.type === "delta") {
      text += event.text;
    }
  }

  if (!text.trim()) {
    throw new AiRuntimeError(
      "empty_response",
      "The assistant did not answer. Try again."
    );
  }

  const plan: EditPlan = parseEditPlan(extractJson(text));

  /*
   * Applied, then validated.
   *
   * `applyEdits` cannot produce markup — there is no operation
   * that carries any — but it can produce a document the schema
   * refuses: a headline the model padded past the cap, a ninth
   * section, a page over the byte ceiling. When that happens the
   * WHOLE plan is refused rather than partially applied,
   * because a half-applied edit is a page in a state the
   * student did not ask for and cannot easily reason about.
   */
  const candidate = applyEdits(input.config, plan.edits);

  let config: SiteConfig;

  try {
    config = parseSiteConfig(candidate);
  } catch (error) {
    if (error instanceof SiteConfigError) {
      throw new AiRuntimeError(
        "invalid_request",
        `That change would not fit the page (${error.message}) Try asking for something smaller.`
      );
    }

    throw error;
  }

  return {
    config,
    /* Described from the operations, not from the model's own
       summary, so the student is shown what happened rather
       than what it said it would do. */
    changes: plan.edits.map((edit: SiteEdit) => describeEdit(edit)),
    unsupported: plan.unsupported,
    summary: plan.summary,
  };
}
