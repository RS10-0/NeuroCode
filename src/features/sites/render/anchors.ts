/*
 * Section anchors.
 *
 * One line, in its own file, because parts.tsx exports React
 * components and a module that mixes components with plain
 * functions loses fast refresh — the same reason
 * toastContext.ts sits beside Toast.tsx rather than inside it.
 *
 * Derived from an id this code generated rather than from a
 * student's heading, so an anchor cannot collide with a route,
 * with an element id already on the page, or with another
 * section that happens to share a title.
 */
export function anchorFor(sectionId: string): string {
  return `s-${sectionId}`;
}
