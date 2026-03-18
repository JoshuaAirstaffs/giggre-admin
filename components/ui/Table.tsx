interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export default function Table<T extends { [key: string]: any }>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data available.",
}: TableProps<T>) {
  return (
    <div className="table-container">
      <style>{`
        .table-container {
          overflow-x: auto;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        thead tr {
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border);
        }
        th {
          padding: 12px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-muted);
          white-space: nowrap;
        }
        tbody tr {
          border-bottom: 1px solid var(--border-muted);
          transition: background 0.12s;
        }
        tbody tr:last-child { border-bottom: none; }
        tbody tr:hover { background: var(--bg-elevated); }
        tbody tr.clickable { cursor: pointer; }
        td {
          padding: 13px 16px;
          font-size: 13.5px;
          color: var(--text-secondary);
          vertical-align: middle;
        }
        .table-empty {
          padding: 48px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
        }
      `}</style>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={String(col.key)} style={{ width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="table-empty">{emptyMessage}</div>
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={i}
                className={onRowClick ? "clickable" : ""}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td key={String(col.key)}>
                    {col.render
                      ? col.render(row)
                      : row[col.key as keyof T]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
