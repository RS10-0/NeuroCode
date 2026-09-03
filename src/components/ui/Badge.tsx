import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "correct" | "caution" | "error";

interface BadgeProps {
  tone?: BadgeTone;
  mono?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export default function Badge({
  tone = "neutral",
  mono = false,
  icon,
  className = "",
  children,
}: BadgeProps) {
  const classes = [
    "badge",
    `badge--${tone}`,
    mono ? "badge--mono" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}
