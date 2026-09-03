import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  text?: string;
  /* The call to action. Verb first. */
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  text,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`empty ${className}`.trim()}>
      {icon ? (
        <span className="empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}

      {/*
        A <p>, not a heading.

        An empty state is a message about a section, not a
        section of its own — and it is rendered inside one, so an
        <h2> here announced "Nothing run yet" as a sibling of the
        "Output" heading that contains it. The nesting depth also
        varies by caller, so no fixed level could be right.
      */}
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
      {action}
    </div>
  );
}
