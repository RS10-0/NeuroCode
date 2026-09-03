interface BrandMarkProps {
  size?: number;
  className?: string;
}

/*
 * The BuildGentic mark: two nodes and the link between them.
 *
 * Drawn rather than set as an emoji — the old app used a "✦"
 * glyph, which renders differently on every platform and reads
 * as a placeholder.
 */
export default function BrandMark({ size = 16, className = "" }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M5.6 5.6 10.4 10.4" />
      <path d="M11.5 4.5h.01M4.5 11.5h.01" />
    </svg>
  );
}
