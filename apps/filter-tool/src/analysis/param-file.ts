/**
 * Reading and writing ArduPilot `.param` files (upstream `load_parameters` / `save_parameters`
 * and `param_to_string` from `Libraries/Param_Helpers.js`).
 */
import { PARAM_NAMES, isParamName, type Inputs, type ParamName } from './params.js'

export interface ParsedParamFile {
  /** Values of the parameters this tool simulates. */
  readonly values: Partial<Record<ParamName, number>>
  /** How many lines held some other parameter. */
  readonly ignored: number
}

/**
 * Parse a `.param` file: one `NAME,value` (or space, tab or `=` separated) per line. QuadPlane
 * `Q_A_RAT_*` gains are read as `ATC_RAT_*`, as upstream does.
 */
export function parseParamFile(text: string): ParsedParamFile {
  const values: Partial<Record<ParamName, number>> = {}
  let ignored = 0
  for (const raw of text.split('\n')) {
    const fields = raw
      .trim()
      .replace('Q_A_RAT_', 'ATC_RAT_')
      .split(/[\s,=\t]+/)
    const [name, valueText] = fields
    if (name === undefined || valueText === undefined || name === '' || name.startsWith('#')) continue
    const value = parseFloat(valueText)
    if (isParamName(name) && Number.isFinite(value)) values[name] = value
    else ignored++
  }
  return { values, ignored }
}

/** Shortest decimal string that round-trips through a 32-bit float (upstream `param_to_string`). */
export function paramToString(value: number): string {
  const floatVal = Math.fround(value)
  for (const figures of [7, 8, 9]) {
    const numberVal = Number(floatVal.toPrecision(figures))
    if (floatVal === Math.fround(numberVal)) return numberVal.toString()
  }
  throw new Error(`Could not convert ${value} to float string`)
}

/**
 * The `.param` text upstream saves: the `INS_*` filter parameters only, so the file can be
 * loaded onto a vehicle without touching its PID gains.
 */
export function formatParamFile(inputs: Inputs): string {
  return PARAM_NAMES.filter((name) => name.startsWith('INS_'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `${name},${paramToString(inputs[name])}\n`)
    .join('')
}
