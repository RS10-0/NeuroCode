/*
 * Just enough Markdown for an answer in a 360px panel.
 *
 * The web app renders model output with react-markdown behind
 * rehype-sanitize (`src/features/lab/markdown.ts`). None of
 * that can come here: the extension has no bundler, no
 * dependencies, and a service worker that must stay small. So
 * this file covers the subset an answer actually arrives in —
 * bullets, numbers, bold, a heading now and then, the odd bit
 * of code — and nothing else.
 *
 * IT BUILDS NODES AND NEVER TOUCHES `innerHTML`, which is the
 * whole reason it can be trusted with this text.
 *
 * The app's approach is to let a parser produce markup and then
 * sanitise it, and that is right for a parser that has to
 * handle everything. Here the guarantee is structural instead:
 * every scrap of text reaches the document as `textContent` on
 * a node this file created, so there is no path by which a
 * model — or a page a model is quoting — can contribute an
 * element or an attribute. `<img onerror=...>` in an answer is
 * displayed, not run, and no allow-list is standing between the
 * two.
 *
 * WHAT IS DELIBERATELY MISSING. Tables, footnotes, nested
 * lists, images, HTML passthrough, maths. Each is either
 * unreadable at this width or a parser of its own, and an
 * answer that wants one is an answer better read in the app.
 * Unrecognised syntax degrades to its own source text, which is
 * exactly what the panel did for everything before this file
 * existed.
 */

/*
 * The inline grammar, in one pass and in this order.
 *
 * Code first, so that whatever is inside backticks is left
 * alone. Bold before italic, because `**` would otherwise
 * match as two empty italics. The lazy quantifiers matter:
 * `**a** and **b**` must be two bold runs rather than one
 * containing " and ".
 *
 * THE FLANKING RULES ARE THE PART WORTH READING. A naive
 * `\*([^*]+)\*` turns ordinary text into emphasis, and the two
 * ways it does that both show up in real answers:
 *
 *   "2 * 3 * 4" becomes "2 3 * 4" with "3" italicised,
 *   because nothing requires a delimiter to sit against the
 *   word it opens. So an opener must be followed by a
 *   non-space and a closer preceded by one.
 *
 *   "user_account_scope" becomes "useraccountscope" with the
 *   middle italicised — which in this project is a table name
 *   silently corrupted in an answer about it. So `_` emphasis
 *   additionally has to begin and end at a word boundary.
 *   Asterisks need no such guard: `*` does not appear inside
 *   identifiers.
 *
 * These are CommonMark's own left/right-flanking rules, cut
 * down to the cases a chat answer actually contains.
 */
const INLINE =
  /`([^`\n]+)`|\*\*(?=\S)([\s\S]*?[^\s*])\*\*|(?<![A-Za-z0-9_])__(?=\S)([\s\S]*?[^\s_])__(?![A-Za-z0-9_])|\*(?=\S)([^*\n]*[^\s*])\*|(?<![A-Za-z0-9_])_(?=\S)([^_\n]*[^\s_])_(?![A-Za-z0-9_])|\[([^\]\n]+)\]\(([^()\s]+)\)/g;

/*
 * A URL the panel is willing to make clickable.
 *
 * `javascript:` is the reason this exists, but the test is an
 * allow-list rather than a block-list — a scheme nobody
 * thought of is refused rather than permitted. A link that
 * fails it is not dropped: its text is kept as plain text, so
 * an answer never silently loses a word.
 */
function safeHref(url) {
  return /^https?:\/\//i.test(url) ? url : null;
}

function el(tag, text) {
  const node = document.createElement(tag);

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

/*
 * Inline spans, appended into `parent`.
 *
 * Recurses for the contents of bold and italic so that
 * `**very *very* bold**` works. The recursion is bounded by
 * the text getting strictly shorter each time, so there is no
 * depth to guard.
 */
function inline(parent, text) {
  /*
   * A FRESH REGEX PER CALL, and this is not tidiness.
   *
   * `INLINE` carries `g`, so it carries `lastIndex` — one
   * cursor, on one shared object. This function recurses for
   * the contents of bold and italic, and the inner call would
   * move that cursor out from under the outer loop, which then
   * re-matches the run it has already emitted and never
   * reaches the end of the string. A hung panel rather than a
   * wrong one.
   *
   * Cloning costs an allocation per span of text and removes
   * the shared state entirely, which is the fix rather than
   * saving and restoring `lastIndex` around the recursion.
   */
  const scan = new RegExp(INLINE.source, "g");

  let last = 0;
  let match;

  while ((match = scan.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(
        document.createTextNode(text.slice(last, match.index))
      );
    }

    const [, code, bold, boldAlt, italic, italicAlt, linkText, linkUrl] = match;

    if (code !== undefined) {
      parent.appendChild(el("code", code));
    } else if (bold !== undefined || boldAlt !== undefined) {
      const strong = el("strong");
      inline(strong, bold ?? boldAlt);
      parent.appendChild(strong);
    } else if (italic !== undefined || italicAlt !== undefined) {
      const em = el("em");
      inline(em, italic ?? italicAlt);
      parent.appendChild(em);
    } else if (linkText !== undefined) {
      const href = safeHref(linkUrl);

      if (href) {
        const anchor = el("a", linkText);
        anchor.href = href;
        anchor.target = "_blank";
        /* A panel opens links into somebody's own browsing
           session, so the new tab gets no handle back. */
        anchor.rel = "noopener noreferrer";
        parent.appendChild(anchor);
      } else {
        parent.appendChild(document.createTextNode(linkText));
      }
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/*
 * Blocks.
 *
 * A plain line walker rather than a tokeniser, because the
 * block grammar here is small enough that a tokeniser would be
 * more code to read and no more correct.
 *
 * Returns a DocumentFragment so the caller can put it wherever
 * it likes in one append.
 */
export function renderMarkdown(source) {
  const fragment = document.createDocumentFragment();
  const lines = String(source ?? "").split("\n");

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* ----- fenced code ----- */

    if (FENCE.test(line)) {
      const body = [];

      i += 1;

      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }

      /* Steps past the closing fence, or past the end of a
         block the stream has not finished sending yet. */
      i += 1;

      const pre = el("pre");
      pre.appendChild(el("code", body.join("\n")));
      fragment.appendChild(pre);
      continue;
    }

    /* ----- blank ----- */

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    /* ----- horizontal rule ----- */

    if (RULE.test(line)) {
      fragment.appendChild(el("hr"));
      i += 1;
      continue;
    }

    /* ----- heading ----- */

    const heading = HEADING.exec(line);

    if (heading) {
      /*
       * Every level lands in the same three tags. The panel is
       * one column of text with no document outline to respect,
       * and six sizes inside a 360px column is noise.
       */
      const level = Math.min(6, heading[1].length + 2);
      const node = el(`h${level}`);
      inline(node, heading[2]);
      fragment.appendChild(node);
      i += 1;
      continue;
    }

    /* ----- lists ----- */

    const listTag = BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : null;

    if (listTag) {
      const pattern = listTag === "ul" ? BULLET : NUMBER;
      const list = el(listTag);

      while (i < lines.length) {
        const item = pattern.exec(lines[i]);

        if (!item) {
          break;
        }

        const li = el("li");
        inline(li, item[1]);
        list.appendChild(li);
        i += 1;
      }

      fragment.appendChild(list);
      continue;
    }

    /* ----- blockquote ----- */

    if (QUOTE.test(line)) {
      const quote = el("blockquote");
      const body = [];

      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])[1]);
        i += 1;
      }

      inline(quote, body.join(" "));
      fragment.appendChild(quote);
      continue;
    }

    /* ----- paragraph ----- */

    const paragraph = el("p");
    let first = true;

    while (i < lines.length) {
      const next = lines[i];

      if (
        next.trim() === "" ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        BULLET.test(next) ||
        NUMBER.test(next) ||
        QUOTE.test(next) ||
        RULE.test(next)
      ) {
        break;
      }

      /*
       * A single newline becomes a <br> rather than a space.
       *
       * Markdown proper joins these lines, and for prose that
       * is right. Model output is not prose: it breaks lines
       * where it means them broken — a label and its value, a
       * step and the next step — and collapsing those into a
       * paragraph reads worse than the asterisks did.
       */
      if (!first) {
        paragraph.appendChild(el("br"));
      }

      inline(paragraph, next.trim());
      first = false;
      i += 1;
    }

    fragment.appendChild(paragraph);
  }

  return fragment;
}
