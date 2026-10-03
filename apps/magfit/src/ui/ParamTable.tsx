import type { ParamRow } from './params-table.js'

/** Props of {@link ParamTable}. */
export interface ParamTableProps {
  /** Column headings, one per compass present. */
  columns: readonly { readonly title: string; readonly calibration: string }[]
  rows: readonly ParamRow[]
}

/** The values each compass would save; changes from the log are highlighted. */
export function ParamTable({ columns, rows }: ParamTableProps) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th>Parameter</th>
            {columns.map((c) => (
              <th key={c.title}>
                {c.title}
                <br />
                <span className="magfit-th-sub">{c.calibration}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {row.cells.map((cell, i) =>
                cell ? (
                  <td key={i} title={cell.name} className={cell.changed ? 'apwt-changed' : undefined}>
                    {cell.text}
                  </td>
                ) : null
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
