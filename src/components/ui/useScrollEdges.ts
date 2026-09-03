import { useCallback, useLayoutEffect, useRef, useState } from "react";

/*
 * Which side of a horizontal scroller has more content on it.
 *
 * WHAT THIS IS FOR, because a fade is not decoration here.
 *
 * A strip with `overflow-x: auto` and no edge treatment tells a
 * learner nothing. The Agent Builder's section tabs are 801px
 * of content in a 343px box on a phone: Memory, Records, Email,
 * Capabilities and Connections are all off-screen, and the last
 * thing visible is a tab cut cleanly in half by the viewport
 * edge, which reads as the end of the list rather than the
 * middle of it. Email and Capabilities are two of the most
 * important screens in the product and there was no way to find
 * out they existed.
 *
 * A FADE RATHER THAN ARROWS. Arrows are another two tap targets
 * on the screen with the least room for them, and they have to
 * say something about their own state when the strip is at an
 * end. A fade is the content itself running out of light, needs
 * no label, and disappears when there is nothing more that way.
 *
 * WHY THIS IS JAVASCRIPT AND NOT CSS. The fade has to know
 * where the strip is scrolled to — a permanent fade on the left
 * edge, sitting over the first tab while the strip is already
 * at the start, reads as a rendering fault rather than an
 * affordance. CSS can express "there is overflow" through the
 * `background-attachment: local` shadow trick, but that paints
 * BEHIND the content, and what has to fade here is the text.
 * `animation-timeline: scroll()` would do it in pure CSS and is
 * too new to rely on.
 *
 * The consumer puts the ref on the scrolling element and the
 * returned value in a `data-edges` attribute; the fade itself
 * is entirely in CSS, keyed off that attribute.
 */

export type ScrollEdges = "none" | "start" | "end" | "both";

/*
 * Sub-pixel slack.
 *
 * `scrollWidth` and `clientWidth` are integers while a flex
 * layout's real width is not, so a strip scrolled fully to the
 * end routinely reports a remainder of half a pixel. Without
 * this the fade never quite switches off, which is the exact
 * artefact the scroll-awareness exists to avoid.
 */
const SLACK = 2;

export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>("none");

  const measure = useCallback(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    /* `scrollLeft` is negative in a right-to-left writing mode
       in every engine that matters. Nothing here is RTL yet,
       and this costs one call to make it not matter later. */
    const from = Math.abs(el.scrollLeft);
    const hidden = el.scrollWidth - el.clientWidth;

    const atStart = from <= SLACK;
    const atEnd = from >= hidden - SLACK;

    setEdges(
      hidden <= SLACK
        ? "none"
        : atStart
          ? "end"
          : atEnd
            ? "start"
            : "both"
    );
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    measure();

    el.addEventListener("scroll", measure, { passive: true });

    /*
     * Two observers, because they catch different things and
     * neither catches the other's.
     *
     * ResizeObserver fires when the BOX changes — a rotation, a
     * window drag, the side panel opening. It does not fire
     * when a child is added, because adding one does not change
     * the scroller's own border box; only its scrollWidth.
     *
     * MutationObserver covers that case, which is real here:
     * the Email tab appears and disappears with the agent's
     * capabilities, and a strip that became scrollable without
     * anybody resizing anything would otherwise keep a stale
     * answer until the next scroll.
     */
    const resize = new ResizeObserver(measure);
    resize.observe(el);

    const mutate = new MutationObserver(measure);
    mutate.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", measure);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [measure]);

  return { ref, edges };
}
