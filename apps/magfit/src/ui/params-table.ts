/** Rows of the "parameters to save" table: what each compass would write, against what it has now. */
import { paramToString, type CompassParamNames } from '@apwt/ardupilot'
import type { CalParams, ExistingCompassParams } from '../analysis/params.js'
import { rotationName } from '../analysis/rotations.js'

/** One parameter of one compass. */
export interface ParamCell {
  /** Full parameter name, e.g. `COMPASS_OFS2_X`. */
  readonly name: string
  /** Value as it would be written to the file. */
  readonly text: string
  /** Value differs from the one in the log. */
  readonly changed: boolean
}

/** A table row: one parameter kind across compasses. */
export interface ParamRow {
  readonly label: string
  /** One cell per compass column; `undefined` for an absent compass. */
  readonly cells: readonly (ParamCell | undefined)[]
}

type Values = Omit<CalParams, 'fitType'>

function text(value: number): string {
  return Number.isNaN(value) ? '–' : paramToString(value)
}

interface RowSpec {
  readonly label: string
  readonly name: (n: CompassParamNames) => string
  readonly value: (v: Values) => number
  readonly orientation?: true
}

type VecKey = 'offsets' | 'diagonals' | 'offDiagonals' | 'motor'

function vecRows(key: VecKey, labels: readonly string[]): RowSpec[] {
  return labels.map((label, i) => ({
    label,
    name: (n) => n[key][i] ?? '',
    value: (v) => v[key][i] ?? NaN
  }))
}

const ROWS: readonly RowSpec[] = [
  ...vecRows('offsets', ['Offset X', 'Offset Y', 'Offset Z']),
  ...vecRows('diagonals', ['Diagonal X', 'Diagonal Y', 'Diagonal Z']),
  ...vecRows('offDiagonals', ['Off-diagonal XY', 'Off-diagonal XZ', 'Off-diagonal YZ']),
  ...vecRows('motor', ['Motor X', 'Motor Y', 'Motor Z']),
  { label: 'Scale', name: (n) => n.scale, value: (v) => v.scale },
  { label: 'Orientation', name: (n) => n.orientation, value: (v) => v.orientation, orientation: true }
]

/** Per compass: its parameter names, the values in the log and the values to save (if any). */
export interface ParamColumn {
  readonly names: CompassParamNames
  readonly existing: ExistingCompassParams
  readonly selected: CalParams | undefined
}

/** Build the table rows. Columns without a selected fit show the existing values, unchanged. */
export function paramRows(columns: readonly (ParamColumn | undefined)[]): ParamRow[] {
  return ROWS.map((row) => ({
    label: row.label,
    cells: columns.map((c) => {
      if (c === undefined) return undefined
      const value = row.value(c.selected ?? c.existing)
      const old = row.value(c.existing)
      const shown = row.orientation ? (rotationName(value) ?? text(value)) : text(value)
      return {
        name: row.name(c.names),
        text: shown,
        changed: c.selected !== undefined && Math.fround(value) !== Math.fround(old)
      }
    })
  }))
}
