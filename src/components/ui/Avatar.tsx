interface AvatarProps {
  /* Used for the fallback initials and the accessible name. */
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  square?: boolean;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2);
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

export default function Avatar({
  name,
  src,
  size = "md",
  square = false,
  className = "",
}: AvatarProps) {
  const classes = [
    "avatar",
    `avatar--${size}`,
    square ? "avatar--square" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (src) {
    return (
      <img
        className={classes}
        src={src}
        alt=""
        style={{ objectFit: "cover" }}
      />
    );
  }

  return (
    <span className={classes} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
