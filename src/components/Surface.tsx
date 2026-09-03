import { useLayoutEffect } from "react";

/*
 * BuildGentic renders on one surface: editorial paper.
 *
 * There was a second, near-black "console" surface behind the
 * AI Lab and the agent pages. Two of five destinations looking
 * like a different product is not visual identity, it is
 * inconsistency, so the console palette has been removed and
 * those pages now sit on the same cream as everything else.
 *
 * The Lab's warm alabaster is not a second surface either. It
 * is scoped to the Lab's own content area by the `.labsurface`
 * class in tokens.css, so the global rail keeps BuildGentic's
 * identity while a learner is working — the Lab is a workspace
 * inside the application, not another one.
 *
 * The attribute still lands on <html> because every component
 * stylesheet reads its colours through [data-surface="learn"].
 * Keeping the hook — rather than hardcoding the attribute in
 * index.html — means a second surface stays a token block away
 * if one is ever genuinely wanted.
 */
export type SurfaceName = "learn";

export function useSurface(surface: SurfaceName = "learn"): void {
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-surface", surface);
  }, [surface]);
}
