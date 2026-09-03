import type { ReactNode } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /* Shown after the label, e.g. a count. */
  badge?: ReactNode;
}

interface TabsProps<T extends string> {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export default function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  className = "",
}: TabsProps<T>) {
  return (
    <div className={`tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          className="tabs__tab"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}
