// Compass parameter names, values and `.param` text formatting. Ported from upstream
// Libraries/Param_Helpers.js (`get_compass_param_names`, `param_to_string`) and the parameter
// handling in MAGFit/magfit.js (`save_parameters`, `check_params`).

import type { Vec3 } from './vector.js'
import { rotationName } from './rotations.js'

/** Three parameter names for the X, Y and Z components of a vector parameter. */
export type Vec3Names = readonly [string, string, string]

/** Names of the calibration parameters of one compass. */
export interface CompassParamNames {
  readonly use: string
  readonly offsets: Vec3Names
  readonly diagonals: Vec3Names
  readonly offDiagonals: Vec3Names
  readonly motor: Vec3Names
  readonly scale: string
  readonly orientation: string
  readonly external: string
  readonly id: string
}

function vec3Names(prefix: string): Vec3Names {
  return [prefix + 'X', prefix + 'Y', prefix + 'Z']
}

/** Parameter names for compass `index` (1-based), upstream `get_compass_param_names`. */
export function compassParamNames(index: number): CompassParamNames {
  const suffix = index === 1 ? '' : String(index)
  return {
    use: 'COMPASS_USE' + suffix,
    offsets: vec3Names('COMPASS_OFS' + suffix + '_'),
    diagonals: vec3Names('COMPASS_DIA' + suffix + '_'),
    offDiagonals: vec3Names('COMPASS_ODI' + suffix + '_'),
    motor: vec3Names('COMPASS_MOT' + suffix + '_'),
    scale: 'COMPASS_SCALE' + suffix,
    orientation: 'COMPASS_ORIENT' + suffix,
    external: index === 1 ? 'COMPASS_EXTERNAL' : 'COMPASS_EXTERN' + suffix,
    id: 'COMPASS_DEV_ID' + suffix
  }
}

/**
 * `COMPASS_MOTCT` values: 0 none, 1 throttle, 2 current. Upstream MAGFit only produces
 * current-based (2) fits, but the fit itself accepts any per-sample interference source.
 */
export type MotorCompType = 0 | 1 | 2

/** A full set of calibration parameters for one compass. */
export interface CalParams {
  readonly offsets: Vec3
  readonly diagonals: Vec3
  readonly offDiagonals: Vec3
  readonly scale: number
  readonly motor: Vec3
  readonly orientation: number
  /** Motor compensation type the `motor` values were fitted for. */
  readonly fitType: MotorCompType
}

/** Calibration parameters as found in a log, plus the device parameters MAGFit reads. */
export interface ExistingCompassParams extends Omit<CalParams, 'fitType'> {
  readonly id: number
  readonly use: number
  readonly external: number
}

/**
 * Read a compass's parameters from a log parameter map (last value wins, as upstream
 * `get_param_value`). Missing parameters read as NaN; upstream reads them as `undefined`,
 * which behaves identically in every comparison MAGFit makes.
 */
export function readCompassParams(params: ReadonlyMap<string, number>, names: CompassParamNames): ExistingCompassParams {
  const get = (name: string): number => params.get(name) ?? NaN
  const vec = (n: Vec3Names): Vec3 => [get(n[0]), get(n[1]), get(n[2])]
  return {
    offsets: vec(names.offsets),
    diagonals: vec(names.diagonals),
    offDiagonals: vec(names.offDiagonals),
    scale: get(names.scale),
    motor: vec(names.motor),
    id: get(names.id),
    use: get(names.use),
    external: get(names.external),
    orientation: get(names.orientation)
  }
}

/**
 * Shortest decimal string that round-trips through a 32-bit float (upstream `param_to_string`).
 * Throws if no 7, 8 or 9 significant figure representation round-trips (e.g. NaN).
 */
export function paramToString(value: number): string {
  // Make sure number can be represented by 32 bit float
  const floatVal = Math.fround(value)
  for (const figures of [7, 8, 9]) {
    const numberVal = Number(floatVal.toPrecision(figures))
    if (floatVal !== Math.fround(numberVal)) continue
    return numberVal.toString()
  }
  throw new Error('Could not convert ' + value.toString() + ' to float string')
}

/** Typical range of offsets; outside it a fit is invalid and saving warns (upstream `offsets_range`). */
export const OFFSETS_RANGE = [-1500.0, 1500.0] as const
/** Typical range of iron matrix diagonals (upstream `diagonals_range`). */
export const DIAGONALS_RANGE = [0.8, 1.2] as const
/** Typical range of iron matrix off-diagonals (upstream `off_diagonals_range`). */
export const OFF_DIAGONALS_RANGE = [-0.2, 0.2] as const
/** Typical range of the scale factor (upstream `scale_range`). */
export const SCALE_RANGE = [0.8, 1.2] as const

type Range = readonly [number, number]

function checkRange(name: string, value: number, range: Range): string {
  if (value > range[1]) return name + ' ' + String(value) + ' larger than ' + String(range[1]) + '\n'
  if (value < range[0]) return name + ' ' + String(value) + ' less than ' + String(range[0]) + '\n'
  return ''
}

function checkArray(names: Vec3Names, values: Vec3, range: Range): string {
  let ret = ''
  for (let i = 0; i < 3; i++) ret += checkRange(names[i]!, values[i]!, range)
  return ret
}

/**
 * Warning text for parameters outside their typical range or an orientation change
 * (upstream `check_params` without the `confirm` dialog). Empty string when all is well.
 *
 * @param compassIndex 0-based compass index.
 */
export function checkParams(
  compassIndex: number,
  names: CompassParamNames,
  values: CalParams,
  original: Pick<ExistingCompassParams, 'orientation'>
): string {
  let warning = ''
  warning += checkArray(names.offsets, values.offsets, OFFSETS_RANGE)
  warning += checkArray(names.diagonals, values.diagonals, DIAGONALS_RANGE)
  warning += checkArray(names.offDiagonals, values.offDiagonals, OFF_DIAGONALS_RANGE)
  warning += checkRange(names.scale, values.scale, SCALE_RANGE)

  if (warning !== '') warning = 'MAG ' + String(compassIndex + 1) + ' params outside typical range:\n' + warning

  if (original.orientation !== values.orientation) {
    if (warning !== '') warning += '\n'
    warning +=
      'MAG ' +
      String(compassIndex + 1) +
      ' orientation (' +
      names.orientation +
      ') changed from ' +
      String(rotationName(original.orientation)) +
      ' to ' +
      String(rotationName(values.orientation)) +
      '\n'
  }
  return warning
}

/** One `NAME,value` line of a `.param` file (upstream `param_string`). */
export function paramLine(name: string, value: number): string {
  return name + ',' + paramToString(value) + '\n'
}

/** `.param` lines for one compass's calibration, in upstream `save_params` order. */
export function compassParamLines(names: CompassParamNames, values: CalParams): string {
  let ret = ''
  for (let i = 0; i < 3; i++) ret += paramLine(names.offsets[i]!, values.offsets[i]!)
  for (let i = 0; i < 3; i++) ret += paramLine(names.diagonals[i]!, values.diagonals[i]!)
  for (let i = 0; i < 3; i++) ret += paramLine(names.offDiagonals[i]!, values.offDiagonals[i]!)
  for (let i = 0; i < 3; i++) ret += paramLine(names.motor[i]!, values.motor[i]!)
  ret += paramLine(names.scale, values.scale)
  ret += paramLine(names.orientation, values.orientation)
  return ret
}

/** What to do with `COMPASS_USEx` when saving (upstream "Use sensor" radio: 0, 1, 2). */
export type UseOverride = 'noChange' | 'use' | 'dontUse'

/** One compass's selected calibration to write to the parameter file. */
export interface ParamFileEntry {
  /** 0-based compass index. */
  readonly compassIndex: number
  readonly names: CompassParamNames
  readonly params: CalParams
  /** Display name of the selected calibration, for the summary. */
  readonly fitName: string
  readonly use?: UseOverride
}

/** Result of {@link buildParamFile}: the file text and a summary, or an error message. */
export type ParamFileResult =
  { readonly ok: true; readonly text: string; readonly summary: string } | { readonly ok: false; readonly error: string }

/**
 * Build the `MAGFit.param` text for the selected calibrations (upstream `save_parameters`
 * minus the file download and dialogs; run {@link checkParams} first to get the warnings
 * upstream shows in its confirm box). Entries should be in compass order.
 */
export function buildParamFile(entries: readonly ParamFileEntry[]): ParamFileResult {
  let text = ''
  let type: MotorCompType = 0
  let summary = 'Saved:\n'
  for (const entry of entries) {
    const values = entry.params
    if (!values.motor.every((m) => m === 0.0)) {
      // Check for conflicting motor compensation types
      if (type === 0) {
        type = values.fitType
      } else if (values.fitType !== 0 && values.fitType !== type) {
        return {
          ok: false,
          error: 'All compasses must use the same motor fit type, current and throttle compensation cannot be used together'
        }
      }
    }
    text += compassParamLines(entry.names, values)
    const use = entry.use ?? 'noChange'
    if (use !== 'noChange') text += paramLine(entry.names.use, use === 'use' ? 1 : 0)
    summary += '\tCompass ' + String(entry.compassIndex + 1) + ': ' + entry.fitName + '\n'
  }
  if (text === '') return { ok: false, error: 'No parameters to save' }
  text += paramLine('COMPASS_MOTCT', type)
  return { ok: true, text, summary }
}
