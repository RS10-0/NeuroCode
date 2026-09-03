import type { ReactNode } from "react";

interface PanelProps {
  /*
   * Rendered as an <h2>, not a styled <span>.
   *
   * A panel title is a section heading in everything but markup,
   * and leaving it as a span meant the Lab's two most important
   * sections — Compose and Parameters — did not appear when a
   * screen-reader user listed the page's headings, while the
   * five sections around them did.
   */
  title?: ReactNode;
  /* Controls rendered at the right of the header. */
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Panel({
  title,
  actions,
  flush = false,
  className = "",
  children,
}: PanelProps) {
  return (
    <div className={`panel ${className}`.trim()}>
      {title || actions ? (
        <div className="panel__header">
          {/* Guarded: a header can exist for its actions alone, and
              an empty <h2> is a heading with no name. */}
          {title ? <h2 className="panel__title">{title}</h2> : null}
          {actions}
        </div>
      ) : null}

      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>
        {children}
      </div>
    </div>
  );
}
