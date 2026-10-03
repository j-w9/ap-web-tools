/**
 * Parameter names, value formatting and `.param`/`.parm` files.
 *
 * Port of upstream `Libraries/Param_Helpers.js` (`param_to_string`, `get_param_download_text`,
 * `get_param_name_vector3`, `get_compass_param_names`, `get_param_value`) plus the parameter
 * file reader several upstream tools carry their own copy of (`load_param_file` and friends).
 */

/** Three parameter names `<prefix>X`, `<prefix>Y`, `<prefix>Z`. */
export type Vector3Names = readonly [string, string, string]

/** Names of the X/Y/Z parameters of a Vector3 parameter (upstream `get_param_name_vector3`). */
export function paramNameVector3(prefix: string): Vector3Names {
  return [prefix + 'X', prefix + 'Y', prefix + 'Z']
}

/** Parameter names of one compass (upstream `get_compass_param_names`). */
export interface CompassParamNames {
  /** `COMPASS_USE[n]`. */
  readonly use: string
  /** `COMPASS_OFS[n]_X/Y/Z`. */
  readonly offsets: Vector3Names
  /** `COMPASS_DIA[n]_X/Y/Z`. */
  readonly diagonals: Vector3Names
  /** `COMPASS_ODI[n]_X/Y/Z`. */
  readonly offDiagonals: Vector3Names
  /** `COMPASS_MOT[n]_X/Y/Z`. */
  readonly motor: Vector3Names
  /** `COMPASS_SCALE[n]`. */
  readonly scale: string
  /** `COMPASS_ORIENT[n]`. */
  readonly orientation: string
  /** `COMPASS_EXTERNAL` or `COMPASS_EXTERN<n>`. */
  readonly external: string
  /** `COMPASS_DEV_ID[n]`. */
  readonly id: string
}

/** Compass parameter names for a 1-based compass index (upstream `get_compass_param_names`). */
export function compassParamNames(index: number): CompassParamNames {
  const n = index !== 1 ? String(index) : ''
  return {
    use: 'COMPASS_USE' + n,
    offsets: paramNameVector3('COMPASS_OFS' + n + '_'),
    diagonals: paramNameVector3('COMPASS_DIA' + n + '_'),
    offDiagonals: paramNameVector3('COMPASS_ODI' + n + '_'),
    motor: paramNameVector3('COMPASS_MOT' + n + '_'),
    scale: 'COMPASS_SCALE' + n,
    orientation: 'COMPASS_ORIENT' + n,
    external: index !== 1 ? `COMPASS_EXTERN${index}` : 'COMPASS_EXTERNAL',
    id: 'COMPASS_DEV_ID' + n
  }
}

/** Result of {@link paramValue}. */
export interface ParamValueResult {
  /** Value in force (the last one, or the first when changes are not allowed). */
  readonly value: number | undefined
  /** Human-readable notes about each change seen, in log order. */
  readonly changes: readonly string[]
}

/**
 * Value of a parameter from PARM columns (upstream `get_param_value`).
 *
 * Deviation: upstream logs changes to the console and, when `allowChange === false`, raises
 * an `alert`; here the messages are returned instead so the caller can present them.
 */
export function paramValue(
  names: ArrayLike<string>,
  values: ArrayLike<number>,
  name: string,
  allowChange?: boolean
): ParamValueResult {
  let value: number | undefined
  const changes: string[] = []
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== name) continue
    const newValue = values[i]!
    if (value !== undefined && value !== newValue) {
      const msg = `${name} changed from ${value} to ${newValue}`
      if (allowChange === false) {
        changes.push('Ignoring param change ' + msg)
        return { value, changes }
      }
      changes.push(msg)
    }
    value = newValue
  }
  return { value, changes }
}

/**
 * Shortest decimal string that round-trips to the same 32-bit float (upstream
 * `param_to_string`). Tries 7, 8 then 9 significant figures; throws when none round-trips,
 * which only happens for NaN.
 */
export function paramToString(value: number): string {
  const floatVal = Math.fround(value)
  for (const figures of [7, 8, 9]) {
    const numberVal = Number(floatVal.toPrecision(figures))
    if (floatVal !== Math.fround(numberVal)) continue
    return numberVal.toString()
  }
  throw new Error('Could not convert ' + value.toString() + ' to float string')
}

/** Natural ordering of parameter names (`SERIAL2_` before `SERIAL10_`), as MAVProxy and Mission Planner sort. */
export function compareParamNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

/** One `NAME,value` line of a `.param` file, with its newline (upstream `param_string`). */
export function paramLine(name: string, value: number): string {
  return name + ',' + paramToString(value) + '\n'
}

/**
 * `.param` file text: one `NAME,value` line per parameter in natural name order
 * (upstream `get_param_download_text`).
 */
export function paramFileText(params: ReadonlyMap<string, number>): string {
  return [...params]
    .sort(([a], [b]) => compareParamNames(a, b))
    .map(([name, value]) => paramLine(name, value))
    .join('')
}

/** A parameter read from a file. */
export interface ParamFileEntry {
  readonly name: string
  readonly value: number
  /** 1-based line number in the file. */
  readonly line: number
}

/** Why a line that looked like data was not read. */
export type SkippedParamReason = 'missing-name' | 'missing-value' | 'not-a-number'

/** A line skipped by {@link parseParamFile}. Comment and blank lines are not reported. */
export interface SkippedParamLine {
  readonly reason: SkippedParamReason
  /** 1-based line number in the file. */
  readonly line: number
  /** The line, trimmed. */
  readonly text: string
  /** First field of the line (empty for `missing-name`). */
  readonly name: string
}

/** Result of {@link parseParamFile}. */
export interface ParsedParamFile {
  /** Every parameter line read, in file order (repeated names appear more than once). */
  readonly entries: readonly ParamFileEntry[]
  /** Values by name; for repeated names the last value wins, at the first occurrence's position. */
  readonly values: ReadonlyMap<string, number>
  /** Lines that looked like data but could not be read, in file order. */
  readonly skipped: readonly SkippedParamLine[]
}

/**
 * Parse `.param`/`.parm` text (MAVProxy, Mission Planner or QGC style): each line is a name and
 * value separated by whitespace, commas, `=` or tabs; anything after the value is ignored.
 * Lines are trimmed (so `\r\n` endings and indentation are fine), blank lines and lines starting
 * with `#` are comments, and lines without a name (`missing-name`), with a single field
 * (`missing-value`) or whose value does not parse as a number (`not-a-number`, including an empty
 * value as in `NAME,`) are skipped and reported. Values use `parseFloat`, so `1e3`, `12abc` and
 * `Infinity` are numbers.
 *
 * Deviation: the upstream readers keep every line with two fields, so comments become junk
 * entries such as `"#"` → `NaN`. Tools that need an upstream quirk apply it on top of this.
 */
export function parseParamFile(text: string): ParsedParamFile {
  const entries: ParamFileEntry[] = []
  const values = new Map<string, number>()
  const skipped: SkippedParamLine[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const [name = '', valueText] = trimmed.split(/[\s,=]+/)
    const line = i + 1
    const skip = (reason: SkippedParamReason): void => {
      skipped.push({ reason, line, text: trimmed, name })
    }
    if (name === '') {
      skip('missing-name')
      continue
    }
    if (valueText === undefined) {
      skip('missing-value')
      continue
    }
    const value = parseFloat(valueText)
    if (Number.isNaN(value)) {
      skip('not-a-number')
      continue
    }
    entries.push({ name, value, line })
    values.set(name, value)
  }
  return { entries, values, skipped }
}
