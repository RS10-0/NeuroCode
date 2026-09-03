import type { ComponentPropsWithRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /* Rendered before the label. Decorative — give the button a
     real text label rather than relying on the icon alone. */
  icon?: ReactNode;
  iconEnd?: ReactNode;
  children?: ReactNode;
}

export default function Button({
  variant = "secondary",
  size = "md",
  block = false,
  icon,
  iconEnd,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    `btn--${variant}`,
    `btn--${size}`,
    block ? "btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {icon ? (
        <span className="btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
      {iconEnd ? (
        <span className="btn__icon" aria-hidden="true">
          {iconEnd}
        </span>
      ) : null}
    </button>
  );
}
