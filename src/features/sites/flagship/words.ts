/*
 * Words, for a page that wants to show a count.
 *
 * Its own module rather than a second export from
 * FlagshipChat.tsx, for the reason render/anchors.ts sits
 * beside parts.tsx: a file that exports both a component and a
 * plain function loses fast refresh, and the lint rule that
 * says so is right.
 *
 * Deliberately naive — split on whitespace. It is a writing
 * desk's reassurance that the draft arrived, not a word
 * processor's statistic, and a Unicode-segmenting version of
 * this would be a dependency for no gain a reader could see.
 */
export function wordCount(text: string): number {
  const trimmed = text.trim();

  return trimmed ? trimmed.split(/\s+/).length : 0;
}
