/*
 * What gets read off a page, and what does not.
 *
 * THIS FUNCTION IS INJECTED, NOT LOADED. It is handed to
 * `chrome.scripting.executeScript` at the moment of a send and
 * runs once in the page. There is no content script anywhere in
 * this extension, which is the structural half of "reads the
 * page only when you ask": under `activeTab` the access does
 * not exist until the user acts on the extension, so there is
 * no moment at which this code is running on a page somebody
 * did not just invoke it on.
 *
 * Because it is injected, it must be SELF-CONTAINED — no
 * imports, no closure over module scope. That is why it is one
 * exported function rather than a set of small ones.
 *
 * WHAT IT TAKES
 *
 *   selection mode — window.getSelection().toString(). If the
 *   reader highlighted something, that is what they meant, and
 *   it is the smallest thing that could work.
 *
 *   page mode — rendered text from <main>/<article> if either
 *   exists, else <body>. Text nodes only.
 *
 * WHAT IT CANNOT TAKE, and "cannot" rather than "does not" is
 * the point in most of these:
 *
 *   Markup, attributes, comments, data-*. It walks text nodes,
 *   so there is nothing else to reach.
 *
 *   <input> values, INCLUDING PASSWORDS. A value is a
 *   property, not a text node, so this is genuinely structural
 *   — a walker cannot reach one however hard it tries.
 *
 *   <textarea> values and [contenteditable] content, which are
 *   NOT structural and are excluded by the filter below. Both
 *   are real text nodes and both were captured by the first
 *   version of this file. They are the reader's own unsent
 *   writing, and they are the reason the filter walks the
 *   ancestor chain rather than checking one parent.
 *
 *   Anything hidden. display:none, visibility:hidden, [hidden]
 *   and aria-hidden are all skipped, computed rather than
 *   declared — white-on-white injected text is still visible by
 *   this test, and that is deliberate: it should be captured and
 *   shown to the reader, not silently dropped.
 *
 *   Cross-origin iframes. Not reachable, and `all_frames` is
 *   not requested.
 *
 *   Cookies, localStorage, sessionStorage. Nothing here reads
 *   them.
 *
 *   The query string. Stripped here, and stripped again on the
 *   server, because a modified extension is exactly what a
 *   trust boundary is for.
 */

export function capturePage(mode, maxChars) {
  /* ------------------------------------------------------
     THE ADDRESS

     Origin and path. The query and fragment go, and how many
     parameters went is reported rather than silently dropped —
     somebody wondering why their agent cannot see a filtered
     dashboard deserves an answer.

     Query strings routinely carry session tokens, reset
     nonces, email addresses and search terms. Sending one
     would put those in a prompt, in the provider cascade, on
     every send, for no feature at all.
     ------------------------------------------------------ */
  const url = new URL(location.href);
  const strippedParams = Array.from(url.searchParams.keys()).length;

  url.search = "";
  url.hash = "";

  const head = {
    url: url.toString(),
    title: document.title || "",
    mode,
    strippedParams,
  };

  /* ------------------------------------------------------
     SELECTION
     ------------------------------------------------------ */

  if (mode === "selection") {
    const text = (window.getSelection()?.toString() ?? "").trim();

    return {
      ...head,
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      /*
       * An empty selection is reported rather than sent. The
       * server refuses an empty capture — an agent handed an
       * empty block describes the page anyway, which is the
       * confabulation this feature is likeliest to produce —
       * and the panel can say something better than a 400.
       */
      empty: text.length === 0,
    };
  }

  /* ------------------------------------------------------
     THE PAGE

     A TreeWalker over text nodes, with the filter doing the
     work. Reading `innerText` off <main> would have been one
     line and is wrong in the way that matters: it returns the
     value of form fields.
     ------------------------------------------------------ */

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "CANVAS",
    "TEMPLATE",
    "OBJECT",
    "EMBED",
    /* Chrome's own UI inside the page, when a page uses it. */
    "AUDIO",
    "VIDEO",
    /*
     * TEXTAREA IS ON THIS LIST AND INPUT IS NOT, and the
     * asymmetry is the whole reason it is here.
     *
     * An <input>'s value is a PROPERTY — there is no text node,
     * so a walker cannot reach it however hard it tries. A
     * <textarea>'s value is a CHILD TEXT NODE, so it is reached
     * by default. Without this entry, capturing a page would
     * capture whatever the reader was in the middle of typing:
     * a half-written message, a password pasted into the wrong
     * box, a comment they had not posted.
     *
     * Found by the fixture test rather than by reasoning, which
     * is worth recording — the header of this file claimed form
     * values were structurally excluded, and for textareas that
     * was simply untrue.
     */
    "TEXTAREA",
    /* SVG is handled by namespace below rather than by tag: its
       elements have lowercase tagName, so "SVG" in this set
       never matched the <text> node inside one. */
  ]);

  const SVG_NS = "http://www.w3.org/2000/svg";

  const root =
    document.querySelector("main") ??
    document.querySelector("article") ??
    document.body;

  if (!root) {
    return { ...head, text: "", truncated: false, empty: true };
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;

      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      /*
       * ONE WALK UP THE ANCESTOR CHAIN, checking everything.
       *
       * It has to be the chain rather than the immediate parent
       * for every test here, and each one has a case that
       * proves it:
       *
       *   tags — the text inside <svg><text> has <text> as its
       *   parent, not <svg>, so a parent-only tag check never
       *   saw the svg at all.
       *
       *   hidden — a text node inside a visible <span> inside a
       *   display:none <div> is not on screen.
       *
       *   contenteditable — the editable host is usually
       *   several levels above the text somebody typed.
       */
      for (let el = parent; el; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        /*
         * Namespace rather than tag name. SVG elements report
         * lowercase tagName ("text", "tspan"), so no entry in
         * an uppercase set could ever match one — which is
         * exactly how SVG text leaked past the first version of
         * this filter.
         */
        if (el.namespaceURI === SVG_NS) {
          return NodeFilter.FILTER_REJECT;
        }

        /*
         * What the reader has typed is theirs, not the page's.
         *
         * A rich-text composer — a mail draft, a comment box, a
         * document editor — is a contenteditable full of text
         * nodes, so it is captured by default. That is the
         * reader's unsent writing, and "ask about this page"
         * should not mean "send what I am in the middle of
         * writing".
         *
         * If they DO want it read, selection mode is the answer
         * and it is the right one: they highlight it, which is
         * the deliberate act this whole design is built on.
         */
        if (el.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }

        if (el.hidden || el.getAttribute("aria-hidden") === "true") {
          return NodeFilter.FILTER_REJECT;
        }

        const style = getComputedStyle(el);

        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        if (el === document.body) {
          break;
        }
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  /*
   * Collected into an array and joined once rather than
   * concatenated in the loop. A long page is tens of thousands
   * of nodes and repeated string concatenation on that is the
   * one performance mistake that would be felt — this runs on
   * the reader's own page, while they wait.
   */
  const parts = [];
  let length = 0;
  let truncated = false;

  while (walker.nextNode()) {
    const value = walker.currentNode.nodeValue.replace(/\s+/g, " ").trim();

    if (!value) {
      continue;
    }

    /*
     * Block-level parents get a paragraph break so the model
     * reads a page as prose rather than as one run-on line.
     * Cheap, and it is most of the difference between a useful
     * capture and a soup.
     */
    const display = getComputedStyle(walker.currentNode.parentElement).display;
    const separator =
      parts.length === 0 ? "" : display.startsWith("inline") ? " " : "\n";

    if (length + separator.length + value.length > maxChars) {
      /*
       * Cut here and say so. The remainder is dropped rather
       * than sampled: a capture stitched from the beginning and
       * the end of a page would be a document that never
       * existed, and the model would have no way to know.
       */
      const room = maxChars - length - separator.length;

      if (room > 0) {
        parts.push(separator + value.slice(0, room));
      }

      truncated = true;
      break;
    }

    parts.push(separator + value);
    length += separator.length + value.length;
  }

  const text = parts.join("").trim();

  return {
    ...head,
    text,
    truncated,
    empty: text.length === 0,
  };
}
