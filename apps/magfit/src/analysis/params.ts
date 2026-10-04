// Compass calibration parameters and the MAGFit `.param` file. Ported from the parameter
// handling in upstream MAGFit/magfit.js (`save_parameters`, `check_params`); the generic
// Param_Helpers.js parts (`get_compass_param_names`, `param_to_string`) are in @apwt/ardupilot.

import { paramLine, type CompassParamNames, type Vector3Names } from '@apwt/ardupilot'
import type { Vec3 } from './vector.js'
import { rotationName } from './rotations.js'

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
  const vec = (n: Vector3Names): Vec3 => [get(n[0]), get(n[1]), get(n[2])]
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

function checkArray(names: Vector3Names, values: Vec3, range: Range): string {
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

  // Upstream compares with `!=`; a missing parameter is `undefined` there (equal to itself) and
  // NaN here, so treat two missing values as equal.
  const bothMissing = Number.isNaN(original.orientation) && Number.isNaN(values.orientation)
  if (original.orientation !== values.orientation && !bothMissing) {
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
  const type = motorCompType(entries)
  if (type.conflict) return { ok: false, error: MOTOR_TYPE_CONFLICT }
  let text = ''
  let summary = 'Saved:\n'
  for (const entry of entries) {
    // Upstream throws in `param_to_string(undefined)` and saves nothing when the orientation
    // parameter is missing; proven bug, fixed (docs/bug-proofs/magfit.md row 4): stop with a message.
    if (Number.isNaN(entry.params.orientation)) return { ok: false, error: missingOrientationError(entry.names.orientation) }
    text += compassParamLines(entry.names, entry.params)
    const use = entry.use ?? 'noChange'
    if (use !== 'noChange') text += paramLine(entry.names.use, use === 'use' ? 1 : 0)
    summary += '\tCompass ' + String(entry.compassIndex + 1) + ': ' + entry.fitName + '\n'
  }
  if (text === '') return { ok: false, error: 'No parameters to save' }
  text += paramLine('COMPASS_MOTCT', type.type)
  return { ok: true, text, summary }
}

/** Message when a calibration to save has no orientation because its parameter is not in the log. */
export function missingOrientationError(name: string): string {
  return name + ' is not in the log, so the calibration cannot be saved'
}

/** Upstream's alert when compasses were fitted for different motor compensation types. */
export const MOTOR_TYPE_CONFLICT =
  'All compasses must use the same motor fit type, current and throttle compensation cannot be used together'

/**
 * `COMPASS_MOTCT` for a set of entries (in compass order): the fit type of the first entry with
 * non-zero motor parameters; `conflict` when a later one has a different non-zero type.
 */
export function motorCompType(entries: readonly ParamFileEntry[]): { readonly type: MotorCompType; readonly conflict: boolean } {
  let type: MotorCompType = 0
  for (const entry of entries) {
    const values = entry.params
    if (values.motor.every((m) => m === 0.0)) continue
    // Check for conflicting motor compensation types
    if (type === 0) {
      type = values.fitType
    } else if (values.fitType !== 0 && values.fitType !== type) {
      return { type, conflict: true }
    }
  }
  return { type, conflict: false }
}
