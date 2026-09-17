/*
 * "just now", "12 min ago", "3 h ago", "2 d ago".
 *
 * Lifted out of RunHistoryDrawer when the Canvas needed the
 * same phrasing for its saved versions. Two timestamps side by
 * side in the same product should not be worded by two
 * different functions — one saying "3 h ago" and the other "3
 * hours ago" is the kind of small inconsistency that reads as
 * two teams rather than one page.
 *
 * Days were added here rather than in the drawer, where runs
 * live in sessionStorage and rarely see a second day. A canvas
 * draft does: it survives a reload on purpose, so "72 h ago" is
 * a real thing it would otherwise have said.
 *
 * Absolute dates are deliberately not offered. Everything this
 * formats is minutes-to-days old and read in sequence, where
 * "2 d ago" answers the question and a date makes the reader do
 * the subtraction.
 */
export function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} h ago`;
  }

  return `${Math.round(hours / 24)} d ago`;
}
