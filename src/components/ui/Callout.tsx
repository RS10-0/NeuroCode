import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

export type CalloutTone = "info" | "correct" | "caution" | "error";

interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}

const ICONS = {
  info: Info,
  correct: CircleCheck,
  caution: TriangleAlert,
  error: CircleAlert,
};

/*
 * Feedback container.
 *
 * The title alone is never the whole message — lesson feedback
 * must explain WHY, so `children` is required.
 */
export default function Callout({
  tone = "info",
  title,
  className = "",
  children,
}: CalloutProps) {
  const Icon = ICONS[tone];

  return (
    <div className={`callout callout--${tone} ${className}`.trim()}>
      <Icon className="callout__icon" size={17} aria-hidden="true" />

      <div className="callout__body">
        {title ? <div className="callout__title">{title}</div> : null}
        <div className="callout__text">{children}</div>
      </div>
    </div>
  );
}
