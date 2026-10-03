/**
 * The editable test stand table (upstream uses Tabulator with range selection): cell values,
 * editing, range paste, copy and clear, and conversion of usable rows into `ThrustData`.
 */
import type { ThrustData } from './linearisation.js'

export const COLUMNS = ['pwm', 'thrust', 'voltage', 'current'] as const
export type Column = (typeof COLUMNS)[number]

/** Column headings (upstream Tabulator column titles). Voltage and current are for reference only. */
export const COLUMN_TITLES: Readonly<Record<Column, string>> = {
  pwm: 'ESC signal (µs)',
  thrust: 'Thrust',
  voltage: 'Voltage (V)',
  current: 'Current (A)'
}

/**
 * What a cell holds, as in upstream's Tabulator data: text typed into the cell editor, a number
 * (pasted values go through `parseFloat`, so `NaN` is possible; the example data is numeric), or
 * `undefined` once a range has been cleared with Delete or Backspace.
 */
export type CellValue = string | number | undefined

/** One table row. */
export type TableRow = Readonly<Record<Column, CellValue>>

export const EMPTY_ROW: TableRow = { pwm: '', thrust: '', voltage: '', current: '' }

/** Rows after a reset (upstream: 10 empty rows). */
export function emptyRows(count = 10): TableRow[] {
  return Array.from({ length: count }, () => EMPTY_ROW)
}

/** JavaScript truthiness of a cell value. */
function truthy(value: CellValue): boolean {
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  return value !== undefined && value !== ''
}

/** JavaScript's global `isNaN`, which converts its argument with `Number` first. */
function looseIsNaN(value: CellValue): boolean {
  return Number.isNaN(Number(value))
}

/**
 * Whether upstream uses a row: `row.pwm && row.thrust && !isNaN(row.pwm) && !isNaN(row.thrust)`.
 * Upstream bug reproduced: a numeric 0 (pasted or from the example) is falsy and drops the row,
 * while a typed "0" is kept (docs/upstream-bugs.md).
 */
export function isUsableRow(row: TableRow): boolean {
  return truthy(row.pwm) && truthy(row.thrust) && !looseIsNaN(row.pwm) && !looseIsNaN(row.thrust)
}

/** Upstream `parseFloat(value)` of a cell (`parseFloat` converts a number to text first). */
export function cellFloat(value: CellValue): number {
  return Number.parseFloat(String(value))
}

/** Usable rows, unparsed (upstream plots their raw `pwm` and `thrust` values against PWM). */
export function usableRows(rows: readonly TableRow[]): TableRow[] {
  return rows.filter(isUsableRow)
}

/** Usable rows as `parseFloat`-ed columns in table order (upstream `updateThrustExpoPlot`). */
export function thrustData(rows: readonly TableRow[]): ThrustData {
  const usable = usableRows(rows)
  return {
    pwm: Float64Array.from(usable, (r) => cellFloat(r.pwm)),
    thrust: Float64Array.from(usable, (r) => cellFloat(r.thrust))
  }
}

/**
 * Tabulator's `numeric` validator, which every column uses: empty, or not `isNaN`.
 * An edit that fails it is not committed (the editor stays open).
 */
export function isValidCellText(text: string): boolean {
  return text === '' || !looseIsNaN(text)
}

/** The table with the same row count plus, when `addRow`, one more empty row at the bottom. */
function withRow(rows: TableRow[], addRow: boolean): TableRow[] {
  if (addRow) rows.push(EMPTY_ROW)
  return rows
}

/** Outcome of committing a cell edit. */
export type EditResult =
  /** Fails the numeric validator: upstream keeps the editor open and nothing changes. */
  | { readonly kind: 'invalid' }
  /** Same as the stored value: the edit is cancelled, so nothing is replotted. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'changed'; readonly rows: TableRow[] }

/**
 * Commit a cell edit (Tabulator's input editor and upstream's `cellEdited` handler). The cell is
 * written when the text differs from the stored value (`!==`, so typing "5" over a pasted 5 does
 * write the text "5"); a write to the last row appends an empty row.
 */
export function editCell(rows: readonly TableRow[], row: number, column: Column, text: string): EditResult {
  if (!isValidCellText(text)) return { kind: 'invalid' }
  const current = rows[row]
  if (current === undefined || current[column] === text) return { kind: 'unchanged' }
  const next = rows.map((r, i) => (i === row ? { ...r, [column]: text } : r))
  return { kind: 'changed', rows: withRow(next, row === rows.length - 1) }
}

/** A rectangular selection of cells, inclusive, in row index and column index (0 = ESC signal). */
export interface CellRange {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** Range spanning two corner cells in any order. */
export function rangeBetween(a: { row: number; col: number }, b: { row: number; col: number }): CellRange {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col)
  }
}

export function inRange(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right
}

/**
 * Paste spreadsheet text into the table (upstream `clipboardPasteParser` with Tabulator's
 * `range` paste action):
 *
 * - The text is trimmed, split into lines on `\n` and cells on tabs; each value is read with
 *   `parseFloat` (so unreadable values become `NaN`, shown as "NaN"); columns past the last are
 *   dropped. Pasted values start at the range's left column.
 * - Rows are added until one row follows the pasted block (counted from the range's top).
 * - With a single selected cell every pasted line is written; with a larger range the lines fill
 *   exactly the range's rows, repeating from the first when there are fewer (Tabulator's range
 *   action). Only the pasted fields of each row change.
 */
export function applyPaste(rows: readonly TableRow[], range: CellRange, text: string): TableRow[] {
  const parsed = text
    .trim()
    .split('\n')
    .map((line) => {
      const values: Partial<Record<Column, number>> = {}
      line.split('\t').forEach((value, i) => {
        const field = COLUMNS[range.left + i]
        if (field !== undefined) values[field] = Number.parseFloat(value)
      })
      return values
    })

  const next = [...rows]
  while (next.length < range.top + parsed.length + 1) next.push(EMPTY_ROW)

  const singleCell = range.top === range.bottom && range.left === range.right
  const height = singleCell ? parsed.length : range.bottom - range.top + 1
  const end = Math.min(range.top + height, next.length)
  for (let r = range.top; r < end; r++) {
    const update = parsed[(r - range.top) % parsed.length]
    next[r] = { ...next[r]!, ...update }
  }
  return next
}

/**
 * Delete or Backspace on a range (`selectableRangeClearCells`): every cell becomes `undefined`.
 * Returns `null` when no cell changed (nothing to replot). Clearing a cell counts as an edit, so
 * a change in the last row appends an empty row, as upstream's `cellEdited` handler does.
 */
export function clearRange(rows: readonly TableRow[], range: CellRange): TableRow[] | null {
  let changed = false
  let lastRowChanged = false
  const next: TableRow[] = []
  for (const [r, row] of rows.entries()) {
    if (r < range.top || r > range.bottom) {
      next.push(row)
      continue
    }
    const updated: Record<Column, CellValue> = { ...row }
    for (const [i, c] of COLUMNS.entries()) {
      if (i < range.left || i > range.right || updated[c] === undefined) continue
      changed = true
      if (r === rows.length - 1) lastRowChanged = true
      updated[c] = undefined
    }
    next.push(updated)
  }
  return changed ? withRow(next, lastRowChanged) : null
}

/** Cell text as the table shows it and the clipboard copies it. */
export function cellText(value: CellValue): string {
  return value === undefined ? '' : String(value)
}

/** Copy a range as tab-separated lines without headers (`clipboardCopyRowRange: "range"`). */
export function copyRange(rows: readonly TableRow[], range: CellRange): string {
  const lines: string[] = []
  for (let r = range.top; r <= Math.min(range.bottom, rows.length - 1); r++) {
    const row = rows[r]!
    lines.push(
      COLUMNS.slice(range.left, range.right + 1)
        .map((c) => cellText(row[c]))
        .join('\t')
    )
  }
  return lines.join('\n')
}

/** Rows from numeric samples, stored as numbers like upstream's `setData`. */
export function rowsFromSamples(samples: readonly Readonly<Record<Column, number>>[]): TableRow[] {
  return samples.map((s) => ({ pwm: s.pwm, thrust: s.thrust, voltage: s.voltage, current: s.current }))
}

/**
 * Example test stand data (upstream `loadExample`, from
 * https://docs.google.com/spreadsheets/d/1_75aZqiT_K1CdduhUe4-DjRgx3Alun4p8V2pt6vM5P8).
 * Columns: ESC signal (µs), thrust, voltage (V), current (A).
 */
export const EXAMPLE_SAMPLES: readonly Readonly<Record<Column, number>>[] = (
  [
    [1000, 0.196, 21.72, 0.042],
    [1001, 0.196, 21.72, 0.042],
    [1012, 0.196, 21.72, 0.041],
    [1024, 0.196, 21.72, 0.041],
    [1038, 0.196, 21.72, 0.042],
    [1051, 0.196, 21.72, 0.042],
    [1065, 0.196, 21.72, 0.042],
    [1078, 0.197, 21.72, 0.046],
    [1092, 0.204, 21.71, 0.315],
    [1105, 0.237, 21.72, 0.23],
    [1118, 0.245, 21.72, 0.178],
    [1130, 0.25, 21.72, 0.187],
    [1145, 0.261, 21.72, 0.217],
    [1158, 0.271, 21.72, 0.238],
    [1172, 0.287, 21.72, 0.297],
    [1186, 0.303, 21.72, 0.311],
    [1198, 0.314, 21.71, 0.354],
    [1212, 0.335, 21.71, 0.428],
    [1225, 0.358, 21.71, 0.482],
    [1239, 0.378, 21.71, 0.547],
    [1252, 0.398, 21.71, 0.608],
    [1266, 0.418, 21.71, 0.665],
    [1279, 0.439, 21.71, 0.722],
    [1292, 0.451, 21.71, 0.771],
    [1306, 0.472, 21.71, 0.849],
    [1319, 0.514, 21.7, 1.025],
    [1332, 0.546, 21.7, 1.11],
    [1346, 0.574, 21.7, 1.191],
    [1360, 0.6, 21.7, 1.302],
    [1373, 0.624, 21.7, 1.391],
    [1386, 0.647, 21.7, 1.493],
    [1400, 0.672, 21.7, 1.584],
    [1414, 0.699, 21.69, 1.704],
    [1429, 0.726, 21.69, 1.796],
    [1443, 0.748, 21.69, 1.919],
    [1457, 0.774, 21.69, 2.05],
    [1470, 0.804, 21.69, 2.192],
    [1484, 0.838, 21.69, 2.369],
    [1498, 0.872, 21.69, 2.513],
    [1512, 0.915, 21.68, 2.788],
    [1526, 0.964, 21.67, 3.025],
    [1540, 1.001, 21.67, 3.215],
    [1555, 1.039, 21.68, 3.482],
    [1568, 1.082, 21.67, 3.699],
    [1583, 1.113, 21.67, 3.851],
    [1596, 1.15, 21.66, 4.103],
    [1609, 1.184, 21.66, 4.386],
    [1623, 1.224, 21.65, 4.57],
    [1636, 1.261, 21.65, 4.808],
    [1650, 1.289, 21.65, 5],
    [1664, 1.321, 21.64, 5.245],
    [1676, 1.352, 21.65, 5.509],
    [1690, 1.388, 21.64, 5.748],
    [1704, 1.428, 21.63, 6.026],
    [1717, 1.463, 21.63, 6.275],
    [1730, 1.493, 21.62, 6.564],
    [1746, 1.519, 21.62, 6.887],
    [1759, 1.554, 21.62, 7.172],
    [1773, 1.596, 21.61, 7.481],
    [1786, 1.637, 21.61, 7.821],
    [1800, 1.674, 21.6, 8.143],
    [1814, 1.711, 21.6, 8.469],
    [1827, 1.742, 21.59, 8.812],
    [1840, 1.774, 21.59, 9.125],
    [1854, 1.809, 21.58, 9.423],
    [1867, 1.846, 21.58, 9.784],
    [1881, 1.882, 21.57, 10.161],
    [1895, 1.936, 21.56, 10.602],
    [1909, 1.987, 21.56, 10.993],
    [1923, 2.028, 21.55, 11.387],
    [1937, 2.07, 21.55, 11.823],
    [1950, 2.107, 21.54, 12.235],
    [1963, 2.152, 21.53, 12.671],
    [1977, 2.195, 21.53, 13.078],
    [1989, 2.233, 21.52, 13.511],
    [2000, 2.254, 21.52, 13.854]
  ] as const
).map(([pwm, thrust, voltage, current]) => ({ pwm, thrust, voltage, current }))

/** All-up weight the example sets (upstream sets `COPTER_AUW` to 2.5). */
export const EXAMPLE_ALL_UP_WEIGHT = 2.5
