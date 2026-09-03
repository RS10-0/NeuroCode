import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /* Right-aligned tabular numerals. */
  numeric?: boolean;
  render: (row: T) => ReactNode;
  tone?: (row: T) => "correct" | "wrong" | undefined;
}

interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}

/*
 * Results grid. Scrolls inside its own container so a wide
 * matrix never pushes the page sideways.
 */
export default function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: DataTableProps<T>) {
  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column, index) => {
                const tone = column.tone?.(row);

                const className = [
                  index === 0 ? "dtable__lead" : "",
                  column.numeric ? "is-num" : "",
                  tone === "correct" ? "is-correct" : "",
                  tone === "wrong" ? "is-wrong" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <td key={column.key} className={className || undefined}>
                    {column.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
