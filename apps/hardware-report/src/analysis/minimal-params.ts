/**
 * Parameter export: all, changed-from-default and "minimal configuration" parameter files
 * (upstream `reset()` minimal-parameter groups, `update_minimal_config()`,
 * `save_all_parameters()`, `save_changed_parameters()` and `save_minimal_parameters()`).
 */
import { airspeedParamNames } from './airspeed.js'
import { baroParamNames } from './baro.js'
import { insParamNames, MAX_NUM_INS } from './ins.js'
import type { ParamValues } from './params.js'
import { compassParamNames, paramFileText, paramNameVector3 } from '@apwt/ardupilot'

/**
 * A group of parameters the user can opt in to the minimal configuration (one checkbox
 * upstream). Unselected groups are left out.
 */
export interface ParamGroup {
  /** Stable id (upstream checkbox id without the `param_` prefix). */
  readonly id: string
  /** Section heading, e.g. `"Compass"`. */
  readonly section: string
  /** Checkbox label, e.g. `"Calibration"`. */
  readonly label: string
  /** Parameters in the group. */
  readonly params: readonly string[]
}

function streamRateNames(prefix: string): string[] {
  return [
    'RAW_SENS',
    'EXT_STAT',
    'RC_CHAN',
    'RAW_CTRL',
    'POSITION',
    'EXTRA1',
    'EXTRA2',
    'EXTRA3',
    'PARAMS',
    'ADSB',
    'OPTIONS'
  ].map((s) => prefix + s)
}

function buildGroups(): ParamGroup[] {
  const groups: ParamGroup[] = []
  const add = (id: string, section: string, label: string, params: readonly string[]): void => {
    groups.push({ id, section, label, params })
  }

  const insGyro: string[] = []
  const insAccel: string[] = []
  const insUse: string[] = []
  const insPos: string[] = []
  for (let i = 0; i < MAX_NUM_INS; i++) {
    const n = insParamNames(i)
    insGyro.push(...n.gyro.offset, n.gyro.id, n.gyro.calTemp)
    insAccel.push(...n.accel.offset, ...n.accel.scale, n.accel.id, n.accel.calTemp)
    insUse.push(n.use)
    insPos.push(...n.pos)
  }
  add('ins_gyro', 'Inertial Sensors', 'Gyro', insGyro)
  add('ins_accel', 'Inertial Sensors', 'Accel', insAccel)
  add('ins_use', 'Inertial Sensors', 'Use', insUse)
  add('ins_position', 'Inertial Sensors', 'Position', insPos)

  const compassCal: string[] = []
  const compassIds: string[] = []
  const compassUse: string[] = []
  const compassOrder: string[] = []
  for (let i = 1; i <= 3; i++) {
    const n = compassParamNames(i)
    compassCal.push(...n.offsets, ...n.diagonals, ...n.offDiagonals, ...n.motor, n.scale, n.orientation)
    compassIds.push(n.id, n.external)
    compassUse.push(n.use)
    compassOrder.push(`COMPASS_PRIO${i}_ID`)
  }
  for (let i = 4; i <= 8; i++) compassIds.push(`COMPASS_DEV_ID${i}`)
  add('compass_calibration', 'Compass', 'Calibration', compassCal)
  add('compass_ordering', 'Compass', 'Ordering', compassOrder)
  add('compass_id', 'Compass', 'IDs', compassIds)
  add('compass_use', 'Compass', 'Use', compassUse)
  add('declination', 'Compass', 'Declination', ['COMPASS_DEC'])

  const baroCal: string[] = []
  const baroId: string[] = []
  const baroWind: string[] = []
  for (let i = 0; i < 3; i++) {
    const n = baroParamNames(i)
    baroCal.push(n.gndPress)
    baroId.push(n.id)
    baroWind.push(n.windComp.enabled, ...n.windComp.coefficients)
  }
  add('baro_calibration', 'Barometer', 'Calibration', baroCal)
  add('baro_id', 'Barometer', 'IDs', baroId)
  add('baro_wind_comp', 'Barometer', 'Wind compensation', baroWind)

  const arspCal: string[] = []
  const arspType: string[] = []
  const arspUse: string[] = []
  for (let i = 0; i < 2; i++) {
    const n = airspeedParamNames(i)
    arspCal.push(n.offset, n.ratio, n.autoCal)
    arspType.push(n.type, n.id, n.bus, n.pin, n.psiRange, n.tubeOrder, n.skipCal)
    arspUse.push(n.use)
  }
  add('airspeed_type', 'Airspeed', 'Type', arspType)
  add('airspeed_calibration', 'Airspeed', 'Calibration', arspCal)
  add('airspeed_use', 'Airspeed', 'Use', arspUse)

  add('ahrs_trim', 'AHRS', 'Trim', paramNameVector3('AHRS_TRIM_'))
  add('ahrs_orientation', 'AHRS', 'Orientation', ['AHRS_ORIENTATION'])

  const rcCal: string[] = []
  const rcRev: string[] = []
  const rcDz: string[] = []
  const rcOpt: string[] = []
  for (let i = 1; i <= 16; i++) {
    const p = `RC${i}_`
    rcCal.push(p + 'MIN', p + 'MAX', p + 'TRIM')
    rcRev.push(p + 'REVERSED')
    rcDz.push(p + 'DZ')
    rcOpt.push(p + 'OPTION')
  }
  add('rc_calibration', 'RC', 'Calibration', rcCal)
  add('rc_reverse', 'RC', 'Reversals', rcRev)
  add('rc_dz', 'RC', 'Dead zone', rcDz)
  add('rc_options', 'RC', 'Options', rcOpt)
  add('rc_flightmodes', 'RC', 'Flight modes', ['FLTMODE_CH', ...[1, 2, 3, 4, 5, 6].map((i) => `FLTMODE${i}`)])

  for (let i = 0; i <= 6; i++) {
    add(`stream_${i}`, 'Stream rates', `MAV ${i + 1}`, [...streamRateNames(`SR${i}_`), ...streamRateNames(`MAV${i + 1}_`)])
  }
  return groups
}

/** Every opt-in parameter group, in upstream display order. */
export const PARAM_GROUPS: readonly ParamGroup[] = buildGroups()

/** Parameters that are never written to a minimal file: statistics and read-only values. */
export const ALWAYS_SKIPPED_PARAMS: readonly string[] = [
  'STAT_BOOTCNT',
  'STAT_FLTTIME',
  'STAT_RUNTIME',
  'STAT_RESET',
  'STAT_FLTCNT',
  'STAT_DISTFLWN',
  'SYS_NUM_RESETS',
  'FORMAT_VERSION',
  'MIS_TOTAL',
  'FENCE_TOTAL',
  'RALLY_TOTAL'
]

/** Whether a value equals its firmware default (so it is dropped in "changed only" mode). */
function isDefault(name: string, value: number, defaults: ParamValues): boolean {
  return defaults.has(name) && value === defaults.get(name)
}

/**
 * Parameters of a group present in `params` (and, with `changedOnly`, differing from their
 * default). A group with none is disabled upstream; the list is its tooltip.
 */
export function presentGroupParams(
  group: ParamGroup,
  params: ParamValues,
  defaults: ParamValues,
  changedOnly: boolean
): string[] {
  return group.params.filter((p) => {
    const v = params.get(p)
    return v !== undefined && !(changedOnly && isDefault(p, v, defaults))
  })
}

/** All parameters as `.param` text (upstream `save_all_parameters`, file suffix `.param`). */
export function allParamsText(params: ParamValues): string {
  return paramFileText(params)
}

/** Parameters that differ from (or have no) default (upstream suffix `_changed.param`). */
export function changedParamsText(params: ParamValues, defaults: ParamValues): string {
  const changed = new Map<string, number>()
  for (const [name, value] of params) if (!isDefault(name, value, defaults)) changed.set(name, value)
  return paramFileText(changed)
}

/** Options for {@link minimalParams}. */
export interface MinimalOptions {
  /** Only keep parameters that differ from their default ("Changed from defaults"). */
  readonly changedOnly: boolean
  /** Ids of the groups to include; every other group's parameters are skipped. */
  readonly includedGroups: ReadonlySet<string>
}

/** The minimal configuration parameter set (upstream `save_minimal_parameters`). */
export function minimalParams(params: ParamValues, defaults: ParamValues, options: MinimalOptions): Map<string, number> {
  const skip = new Set(ALWAYS_SKIPPED_PARAMS)
  for (const g of PARAM_GROUPS) if (!options.includedGroups.has(g.id)) for (const p of g.params) skip.add(p)
  const out = new Map<string, number>()
  for (const [name, value] of params) {
    if (options.changedOnly && isDefault(name, value, defaults)) continue
    if (skip.has(name)) continue
    out.set(name, value)
  }
  return out
}

/** Minimal configuration as `.param` text (upstream suffix `_minimal.param`). */
export function minimalParamsText(params: ParamValues, defaults: ParamValues, options: MinimalOptions): string {
  return paramFileText(minimalParams(params, defaults, options))
}

/**
 * Output file name for an export (upstream `save_text`): the input name without extension
 * (or `"log"`) plus the suffix.
 */
export function exportFileName(inputName: string | undefined, suffix: string): string {
  const base = (inputName ?? '').replace(/.*[/\\]/, '') || 'log'
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) + suffix
}
