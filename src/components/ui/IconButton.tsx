import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /* Required: an icon-only control is invisible to a screen
     reader without it. */
  label: string;
  icon: ReactNode;
  size?: "sm" | "md";
  bordered?: boolean;
}

export default function IconButton({
  label,
  icon,
  size = "md",
  bordered = false,
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    "icon-btn",
    `icon-btn--${size}`,
    bordered ? "icon-btn--bordered" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} aria-label={label} title={label} {...rest}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
