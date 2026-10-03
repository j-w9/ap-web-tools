/**
 * Which log messages and parameters describe each rate controller, per vehicle.
 * Mirrors the tables in upstream PIDReview.js `load()` and `get_PID_param_names()`.
 */

/** ArduPilot build types as logged in VER.BU. */
export const BUILD_TYPE = {
  rover: 1,
  copter: 2,
  plane: 3,
  tracker: 4,
  sub: 7,
  blimp: 12
} as const

export type BuildType = (typeof BUILD_TYPE)[keyof typeof BUILD_TYPE]

const RAD2DEG = 180 / Math.PI
const DEG_PER_SEC = 'deg / s'

/** One controller the tool can show: where its data lives and how to scale it. */
export interface PidMessageSpec {
  /** Message name, plus the axis letter when it comes from the combined RATE message. */
  id: readonly [string] | readonly [string, 'R' | 'P' | 'Y']
  /** Parameter prefixes to try, in order, e.g. `ATC_RAT_RLL_`. */
  prefixes: readonly string[]
  /** Multiply logged target/actual/error by this to get `units`. */
  unitScale: number
  /** Display units of the controlled quantity. */
  units: string
}

/** Stable key for a spec, e.g. `PIDR` or `RATE_R`; matches upstream's element ids. */
export function specKey(spec: PidMessageSpec): string {
  return spec.id.join('_')
}

/** Human label for a spec, e.g. `RATE Roll`. */
export function specLabel(spec: PidMessageSpec): string {
  if (spec.id.length === 1) return spec.id[0]
  const axis = { R: 'Roll', P: 'Pitch', Y: 'Yaw' }[spec.id[1]]
  return `${spec.id[0]} ${axis}`
}

/** All controller specs the tool knows about, in display order. */
export const ALL_SPEC_KEYS = [
  'RATE_R', 'RATE_P', 'RATE_Y',
  'PIDR', 'PIDP', 'PIDY',
  'PIQR', 'PIQP', 'PIQY',
  'PIDS', 'PIDA'
] as const

/** Controller specs available for a vehicle type, or null when the vehicle is unsupported. */
export function pidSpecsForVehicle(buildType: number | undefined): readonly PidMessageSpec[] | null {
  switch (buildType) {
    case BUILD_TYPE.rover:
      return [
        { id: ['PIDS'], prefixes: ['ATC_STR_RAT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['PIDA'], prefixes: ['ATC_SPEED_'], unitScale: 1, units: 'm / s' }
      ]
    case BUILD_TYPE.copter:
      return [
        { id: ['PIDR'], prefixes: ['ATC_RAT_RLL_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['PIDP'], prefixes: ['ATC_RAT_PIT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['PIDY'], prefixes: ['ATC_RAT_YAW_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['RATE', 'R'], prefixes: ['ATC_RAT_RLL_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['RATE', 'P'], prefixes: ['ATC_RAT_PIT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['RATE', 'Y'], prefixes: ['ATC_RAT_YAW_'], unitScale: RAD2DEG, units: DEG_PER_SEC }
      ]
    case BUILD_TYPE.plane:
      return [
        { id: ['PIDR'], prefixes: ['RLL_RATE_'], unitScale: 1, units: DEG_PER_SEC },
        { id: ['PIDP'], prefixes: ['PTCH_RATE_'], unitScale: 1, units: DEG_PER_SEC },
        { id: ['PIDY'], prefixes: ['YAW_RATE_'], unitScale: 1, units: DEG_PER_SEC },
        { id: ['PIQR'], prefixes: ['Q_A_RAT_RLL_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['PIQP'], prefixes: ['Q_A_RAT_PIT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['PIQY'], prefixes: ['Q_A_RAT_YAW_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['RATE', 'R'], prefixes: ['Q_A_RAT_RLL_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['RATE', 'P'], prefixes: ['Q_A_RAT_PIT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { id: ['RATE', 'Y'], prefixes: ['Q_A_RAT_YAW_'], unitScale: RAD2DEG, units: DEG_PER_SEC }
      ]
    default:
      return null
  }
}

/** The PID gains and filters shown in the parameter-set table, keyed by short id. */
export interface PidParamInfo {
  /** Column title. */
  title: string
  /** Parameter name suffix, appended to the controller prefix. */
  suffix: string
  decimalPlaces: number
}

export const PID_PARAMS = {
  KP: { title: 'KP', suffix: 'P', decimalPlaces: 4 },
  KI: { title: 'KI', suffix: 'I', decimalPlaces: 4 },
  KD: { title: 'KD', suffix: 'D', decimalPlaces: 4 },
  FF: { title: 'KFF', suffix: 'FF', decimalPlaces: 4 },
  D_FF: { title: 'KDFF', suffix: 'D_FF', decimalPlaces: 4 },
  I_max: { title: 'I Max', suffix: 'IMAX', decimalPlaces: 4 },
  Target_filter: { title: 'Target Filter (Hz)', suffix: 'FLTT', decimalPlaces: 4 },
  Notch_target: { title: 'Target Notch Index', suffix: 'NTF', decimalPlaces: 0 },
  Error_filter: { title: 'Error Filter (Hz)', suffix: 'FLTE', decimalPlaces: 4 },
  Notch_error: { title: 'Error Notch Index', suffix: 'NEF', decimalPlaces: 0 },
  D_filter: { title: 'D Filter (Hz)', suffix: 'FLTD', decimalPlaces: 4 },
  Slew_max: { title: 'Slew Max', suffix: 'SMAX', decimalPlaces: 4 }
} as const satisfies Record<string, PidParamInfo>

export type PidParamKey = keyof typeof PID_PARAMS
export const PID_PARAM_KEYS = Object.keys(PID_PARAMS) as readonly PidParamKey[]

/** Full parameter name for a key under a prefix, e.g. `ATC_RAT_RLL_P`. */
export function pidParamName(prefix: string, key: PidParamKey): string {
  return prefix + PID_PARAMS[key].suffix
}
