import type { KeyboardEvent } from 'react'
import {
  COLUMNS,
  COLUMN_TITLES,
  applyPaste,
  cellValue,
  editCell,
  isRangePaste,
  type Column,
  type TableRow
} from '../analysis/thrust-table.js'

export interface ThrustTableProps {
  rows: readonly TableRow[]
  onRowsChange: (rows: readonly TableRow[]) => void
}

const CELL_STYLE = { padding: '3px 6px' } as const
const INPUT_STYLE = { width: '100%', minWidth: 90, textAlign: 'right' } as const
const INVALID_STYLE = { ...INPUT_STYLE, color: 'var(--red-text)', borderColor: 'var(--red-text)' } as const

/** Move focus to the same column in another row. */
function focusCell(from: HTMLElement, row: number, column: Column): boolean {
  const target = from.closest('table')?.querySelector<HTMLInputElement>(`input[data-cell="${row}:${column}"]`)
  if (!target) return false
  target.focus()
  target.select()
  return true
}

/**
 * The test stand data grid. Each cell is a text input; pasting a range copied from a
 * spreadsheet fills cells from the one pasted into, adding rows as needed. Enter and the
 * up/down arrows move between rows.
 */
export function ThrustTable({ rows, onRowsChange }: ThrustTableProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, row: number, column: Column) => {
    const step = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step !== 0 && focusCell(e.currentTarget, row + step, column)) e.preventDefault()
  }

  return (
    <div className="apwt-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
      <table className="apwt-table">
        <thead>
          <tr>
            <th>#</th>
            {COLUMNS.map((c) => (
              <th key={c}>{COLUMN_TITLES[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <td style={CELL_STYLE}>{r + 1}</td>
              {COLUMNS.map((c) => {
                const text = row[c]
                const invalid = text.trim() !== '' && cellValue(text) === null
                return (
                  <td key={c} style={CELL_STYLE}>
                    <input
                      className="apwt-input"
                      type="text"
                      inputMode="decimal"
                      aria-label={`${COLUMN_TITLES[c]}, row ${r + 1}`}
                      aria-invalid={invalid}
                      data-cell={`${r}:${c}`}
                      style={invalid ? INVALID_STYLE : INPUT_STYLE}
                      value={text}
                      onChange={(e) => onRowsChange(editCell(rows, r, c, e.target.value))}
                      onKeyDown={(e) => onKeyDown(e, r, c)}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData('text/plain')
                        if (!isRangePaste(pasted)) return
                        e.preventDefault()
                        onRowsChange(applyPaste(rows, r, c, pasted))
                      }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
