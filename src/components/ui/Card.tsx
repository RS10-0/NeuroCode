import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  flush?: boolean;
  children: ReactNode;
}

export default function Card({
  flush = false,
  children,
  className = "",
  ...rest
}: CardProps) {
  const classes = ["card", flush ? "card--flush" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
