import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  COLUMNS,
  COLUMN_TITLES,
  applyPaste,
  cellText,
  clearRange,
  copyRange,
  editCell,
  inRange,
  rangeBetween,
  type CellRange,
  type TableRow
} from '../analysis/thrust-table.js'

export interface ThrustTableProps {
  rows: readonly TableRow[]
  onRowsChange: (rows: readonly TableRow[]) => void
}

interface CellPos {
  row: number
  col: number
}

interface Selection {
  /** Where the selection started: the active cell, edited by Enter. */
  anchor: CellPos
  /** The other corner. */
  focus: CellPos
}

interface Editing extends CellPos {
  text: string
  invalid: boolean
}

const LAST_COL = COLUMNS.length - 1

const CELL_STYLE = {
  padding: '3px 6px',
  textAlign: 'right',
  cursor: 'cell',
  userSelect: 'none',
  minWidth: 110,
  height: 22
} as const
// Selection in the shell's accent: a yellow wash, and a yellow outline on the active cell.
const SELECTED_STYLE = { ...CELL_STYLE, background: 'rgba(250, 204, 21, 0.14)' } as const
const ACTIVE_STYLE = { ...SELECTED_STYLE, outline: '2px solid var(--yellow)', outlineOffset: -2 } as const
const HEADER_STYLE = { cursor: 'pointer', userSelect: 'none' } as const
const EDITOR_STYLE = { width: '100%', textAlign: 'right', boxSizing: 'border-box' } as const
const INVALID_EDITOR_STYLE = { ...EDITOR_STYLE, color: 'var(--red-text)', borderColor: 'var(--red-text)' } as const

/** A column heading with its unit, e.g. `(µs)`, kept out of the heading's uppercase. */
function ColumnTitle({ title }: { title: string }) {
  const unit = /^(.*?)\s*(\([^)]*\))$/.exec(title)
  if (unit === null) return title
  return (
    <>
      {unit[1]} <span className="te-unit">{unit[2]}</span>
    </>
  )
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * The test stand data grid, with the behaviour of upstream's Tabulator setup: click or drag to
 * select a range (Shift extends it; click a column heading for the whole column, a row number for
 * the whole row, the corner for everything); arrows move (Shift extends, Ctrl or Cmd jumps to the
 * edge); Tab moves right; double-click or Enter edits the active cell; Delete or Backspace clears
 * the range; Ctrl/Cmd+C copies it as tab-separated text; Ctrl/Cmd+V pastes spreadsheet data at it.
 */
export function ThrustTable({ rows, onRowsChange }: ThrustTableProps) {
  const grid = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<Selection>({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
  const [editing, setEditing] = useState<Editing | null>(null)
  const dragging = useRef(false)

  const lastRow = Math.max(rows.length - 1, 0)
  const anchor = { row: clamp(selection.anchor.row, 0, lastRow), col: selection.anchor.col }
  const focus = { row: clamp(selection.focus.row, 0, lastRow), col: selection.focus.col }
  const range: CellRange = rangeBetween(anchor, focus)

  const select = (a: CellPos, f: CellPos = a) => setSelection({ anchor: a, focus: f })
  const startEdit = (pos: CellPos) => {
    const row = rows[pos.row]
    const column = COLUMNS[pos.col]
    if (row === undefined || column === undefined) return
    setEditing({ ...pos, text: cellText(row[column]), invalid: false })
  }

  const finishEdit = () => {
    if (editing === null) return
    const column = COLUMNS[editing.col]
    if (column === undefined) return
    const result = editCell(rows, editing.row, column, editing.text)
    switch (result.kind) {
      case 'invalid':
        setEditing({ ...editing, invalid: true })
        return
      case 'unchanged':
        break
      case 'changed':
        onRowsChange(result.rows)
        break
    }
    setEditing(null)
    grid.current?.focus()
  }

  const cancelEdit = () => {
    setEditing(null)
    grid.current?.focus()
  }

  const onCellMouseDown = (e: MouseEvent, pos: CellPos) => {
    if (editing !== null) return
    dragging.current = true
    if (e.shiftKey) select(anchor, pos)
    else select(pos)
    grid.current?.focus()
    e.preventDefault()
  }

  const onCellMouseEnter = (pos: CellPos) => {
    if (dragging.current) select(anchor, pos)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing !== null) return
    const jump = e.ctrlKey || e.metaKey
    const move = (dRow: number, dCol: number) => {
      const from = e.shiftKey ? focus : anchor
      const target = {
        row: jump ? (dRow < 0 ? 0 : dRow > 0 ? lastRow : from.row) : clamp(from.row + dRow, 0, lastRow),
        col: jump ? (dCol < 0 ? 0 : dCol > 0 ? LAST_COL : from.col) : clamp(from.col + dCol, 0, LAST_COL)
      }
      if (e.shiftKey) select(anchor, target)
      else select(target)
      e.preventDefault()
    }
    switch (e.key) {
      case 'ArrowUp':
        move(-1, 0)
        return
      case 'ArrowDown':
        move(1, 0)
        return
      case 'ArrowLeft':
        move(0, -1)
        return
      case 'ArrowRight':
        move(0, 1)
        return
      case 'Tab': {
        const col = clamp(anchor.col + (e.shiftKey ? -1 : 1), 0, LAST_COL)
        select({ row: anchor.row, col })
        e.preventDefault()
        return
      }
      case 'Enter':
        startEdit(anchor)
        e.preventDefault()
        return
      case 'Delete':
      case 'Backspace': {
        const cleared = clearRange(rows, range)
        if (cleared !== null) onRowsChange(cleared)
        e.preventDefault()
        return
      }
    }
  }

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing !== null) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', copyRange(rows, range))
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    // While a cell is being edited the browser pastes into its editor, as upstream.
    if (editing !== null) return
    e.preventDefault()
    onRowsChange(applyPaste(rows, range, e.clipboardData.getData('text/plain')))
  }

  return (
    <div
      ref={grid}
      tabIndex={0}
      role="grid"
      aria-label="Test stand data"
      aria-multiselectable
      className="apwt-table-wrap"
      style={{ maxHeight: 420, overflowY: 'auto', outline: 'none' }}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
    >
      <table className="apwt-table">
        <thead>
          <tr>
            <th
              style={HEADER_STYLE}
              title="Select all"
              onMouseDown={() => select({ row: 0, col: 0 }, { row: lastRow, col: LAST_COL })}
            >
              #
            </th>
            {COLUMNS.map((c, col) => (
              <th
                key={c}
                style={HEADER_STYLE}
                onMouseDown={(e) => {
                  if (e.shiftKey) select({ row: 0, col: anchor.col }, { row: lastRow, col })
                  else select({ row: 0, col }, { row: lastRow, col })
                  grid.current?.focus()
                  e.preventDefault()
                }}
              >
                <ColumnTitle title={COLUMN_TITLES[c]} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <td
                style={HEADER_STYLE}
                onMouseDown={(e) => {
                  if (e.shiftKey) select({ row: anchor.row, col: 0 }, { row: r, col: LAST_COL })
                  else select({ row: r, col: 0 }, { row: r, col: LAST_COL })
                  grid.current?.focus()
                  e.preventDefault()
                }}
              >
                {r + 1}
              </td>
              {COLUMNS.map((c, col) => {
                if (editing !== null && editing.row === r && editing.col === col) {
                  return (
                    <td key={c} style={CELL_STYLE}>
                      <input
                        className="apwt-input"
                        type="text"
                        aria-label={`${COLUMN_TITLES[c]}, row ${r + 1}`}
                        aria-invalid={editing.invalid}
                        style={editing.invalid ? INVALID_EDITOR_STYLE : EDITOR_STYLE}
                        value={editing.text}
                        autoFocus
                        onChange={(e) => setEditing({ ...editing, text: e.target.value, invalid: false })}
                        onBlur={finishEdit}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') finishEdit()
                          else if (e.key === 'Escape') cancelEdit()
                        }}
                      />
                    </td>
                  )
                }
                const active = r === anchor.row && col === anchor.col
                const selected = inRange(range, r, col)
                return (
                  <td
                    key={c}
                    role="gridcell"
                    aria-selected={selected}
                    style={active ? ACTIVE_STYLE : selected ? SELECTED_STYLE : CELL_STYLE}
                    onMouseDown={(e) => onCellMouseDown(e, { row: r, col })}
                    onMouseEnter={() => onCellMouseEnter({ row: r, col })}
                    onDoubleClick={() => startEdit({ row: r, col })}
                  >
                    {cellText(row[c])}
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
