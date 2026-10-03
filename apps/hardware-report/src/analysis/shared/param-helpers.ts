/**
 * Parameter name helpers, value formatting and `.param` file text.
 *
 * Port of upstream `Libraries/Param_Helpers.js`. Candidate for a shared package: most
 * upstream tools that read or write parameters use it.
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
    const newValue = values[i] as number
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
 * `param_to_string`). Tries 7, 8 then 9 significant figures.
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

/**
 * `.param` file text, one `NAME,value` line per parameter in natural sort order to match
 * MAVProxy and Mission Planner (upstream `get_param_download_text`).
 */
export function paramDownloadText(params: ReadonlyMap<string, number>): string {
  const keys = [...params.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  let text = ''
  for (const key of keys) text += key + ',' + paramToString(params.get(key) as number) + '\n'
  return text
}
