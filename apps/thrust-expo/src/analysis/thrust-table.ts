/**
 * The editable test stand table (upstream uses Tabulator): rows of cell text, the paste
 * parser, and conversion of valid rows into `ThrustData`.
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

/** One table row as the text in each cell. */
export type TableRow = Readonly<Record<Column, string>>

export const EMPTY_ROW: TableRow = { pwm: '', thrust: '', voltage: '', current: '' }

/** Rows after a reset (upstream: 10 empty rows). */
export function emptyRows(count = 10): TableRow[] {
  return Array.from({ length: count }, () => EMPTY_ROW)
}

/**
 * Numeric value of a cell, or null when it is not a number.
 *
 * Deviation: upstream keeps a row when `row.pwm && row.thrust && !isNaN(...)`, so a numeric 0
 * (pasted or from the example) was dropped while a typed "0" was kept. Here any finite
 * number, including 0, counts.
 */
export function cellValue(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** Rows with a valid ESC signal and thrust, as columns in table order. */
export function thrustData(rows: readonly TableRow[]): ThrustData {
  const pwm: number[] = []
  const thrust: number[] = []
  for (const row of rows) {
    const p = cellValue(row.pwm)
    const t = cellValue(row.thrust)
    if (p === null || t === null) continue
    pwm.push(p)
    thrust.push(t)
  }
  return { pwm: Float64Array.from(pwm), thrust: Float64Array.from(thrust) }
}

/** Set one cell. Editing the last row appends an empty one so there is always room to type. */
export function editCell(rows: readonly TableRow[], row: number, column: Column, text: string): TableRow[] {
  const next = rows.map((r, i) => (i === row ? { ...r, [column]: text } : r))
  if (row === rows.length - 1) next.push(EMPTY_ROW)
  return next
}

/** Text that came from a spreadsheet range rather than a single value. */
export function isRangePaste(text: string): boolean {
  return /[\t\n]/.test(text.trim())
}

/**
 * Paste tab-separated rows (as copied from a spreadsheet) with their top-left cell at
 * `row`/`column` (upstream `clipboardPasteParser` with `clipboardPasteAction: "range"`).
 * Values are read with `parseFloat`; columns past the last are dropped. Rows are added so
 * at least one empty row follows the paste.
 */
export function applyPaste(rows: readonly TableRow[], row: number, column: Column, text: string): TableRow[] {
  const startCol = COLUMNS.indexOf(column)
  const pasted = text
    .trim()
    .split('\n')
    .map((line) => line.split('\t'))
  const next = [...rows]
  while (next.length < row + pasted.length + 1) next.push(EMPTY_ROW)
  pasted.forEach((values, r) => {
    const current = next[row + r] ?? EMPTY_ROW
    const updated: Record<Column, string> = { ...current }
    values.forEach((value, c) => {
      const field = COLUMNS[startCol + c]
      if (field === undefined) return
      const number = parseFloat(value)
      // Upstream stores NaN, which the table shows as "NaN" and the analysis skips; an empty cell reads better.
      updated[field] = Number.isNaN(number) ? '' : String(number)
    })
    next[row + r] = updated
  })
  return next
}

/** Rows from numeric samples. */
export function rowsFromSamples(samples: readonly Readonly<Record<Column, number>>[]): TableRow[] {
  return samples.map((s) => ({
    pwm: String(s.pwm),
    thrust: String(s.thrust),
    voltage: String(s.voltage),
    current: String(s.current)
  }))
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
