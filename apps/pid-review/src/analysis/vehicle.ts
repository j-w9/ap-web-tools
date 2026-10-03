/**
 * Which log messages and parameters describe each rate controller, per vehicle.
 * Mirrors the tables in upstream PIDReview.js `load()` and `get_PID_param_names()`.
 */

import type { VehicleType } from '@apwt/dataflash'

const RAD2DEG = 180 / Math.PI
const DEG_PER_SEC = 'deg / s'

/** Every controller the tool knows about, in display order. */
export const ALL_SPEC_KEYS = [
  'RATE_R',
  'RATE_P',
  'RATE_Y',
  'PIDR',
  'PIDP',
  'PIDY',
  'PIQR',
  'PIQP',
  'PIQY',
  'PIDS',
  'PIDA'
] as const

/** Identifies one controller, e.g. `PIDR` or `RATE_R`. */
export type SpecKey = (typeof ALL_SPEC_KEYS)[number]

type RateAxis = 'R' | 'P' | 'Y'
type PidMessage = Exclude<SpecKey, `RATE_${RateAxis}`>

/** Where a controller's data lives: its own PID message, or one axis of the combined RATE message. */
export type PidSource = { readonly message: PidMessage } | { readonly message: 'RATE'; readonly axis: RateAxis }

/** One controller the tool can show: where its data lives and how to scale it. */
export interface PidMessageSpec {
  key: SpecKey
  source: PidSource
  /** Parameter prefixes to try, in order, e.g. `ATC_RAT_RLL_`. */
  prefixes: readonly string[]
  /** Multiply logged target/actual/error by this to get `units`. */
  unitScale: number
  /** Display units of the controlled quantity. */
  units: string
}

const AXIS_NAMES: Readonly<Record<RateAxis, string>> = { R: 'Roll', P: 'Pitch', Y: 'Yaw' }

/** Human label for a controller, e.g. `RATE Roll` or `PIDR`. */
export function specLabel(key: SpecKey): string {
  const rate = /^RATE_([RPY])$/.exec(key)
  return rate ? `RATE ${AXIS_NAMES[rate[1] as RateAxis]}` : key
}

/** Controller specs available for a vehicle type, or null when the vehicle is unsupported. */
export function pidSpecsForVehicle(vehicle: VehicleType | undefined): readonly PidMessageSpec[] | null {
  switch (vehicle) {
    case 'rover':
      return [
        { key: 'PIDS', source: { message: 'PIDS' }, prefixes: ['ATC_STR_RAT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { key: 'PIDA', source: { message: 'PIDA' }, prefixes: ['ATC_SPEED_'], unitScale: 1, units: 'm / s' }
      ]
    case 'copter':
      return [
        { key: 'PIDR', source: { message: 'PIDR' }, prefixes: ['ATC_RAT_RLL_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { key: 'PIDP', source: { message: 'PIDP' }, prefixes: ['ATC_RAT_PIT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { key: 'PIDY', source: { message: 'PIDY' }, prefixes: ['ATC_RAT_YAW_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        {
          key: 'RATE_R',
          source: { message: 'RATE', axis: 'R' },
          prefixes: ['ATC_RAT_RLL_'],
          unitScale: RAD2DEG,
          units: DEG_PER_SEC
        },
        {
          key: 'RATE_P',
          source: { message: 'RATE', axis: 'P' },
          prefixes: ['ATC_RAT_PIT_'],
          unitScale: RAD2DEG,
          units: DEG_PER_SEC
        },
        {
          key: 'RATE_Y',
          source: { message: 'RATE', axis: 'Y' },
          prefixes: ['ATC_RAT_YAW_'],
          unitScale: RAD2DEG,
          units: DEG_PER_SEC
        }
      ]
    case 'plane':
      return [
        { key: 'PIDR', source: { message: 'PIDR' }, prefixes: ['RLL_RATE_'], unitScale: 1, units: DEG_PER_SEC },
        { key: 'PIDP', source: { message: 'PIDP' }, prefixes: ['PTCH_RATE_'], unitScale: 1, units: DEG_PER_SEC },
        { key: 'PIDY', source: { message: 'PIDY' }, prefixes: ['YAW_RATE_'], unitScale: 1, units: DEG_PER_SEC },
        { key: 'PIQR', source: { message: 'PIQR' }, prefixes: ['Q_A_RAT_RLL_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { key: 'PIQP', source: { message: 'PIQP' }, prefixes: ['Q_A_RAT_PIT_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        { key: 'PIQY', source: { message: 'PIQY' }, prefixes: ['Q_A_RAT_YAW_'], unitScale: RAD2DEG, units: DEG_PER_SEC },
        {
          key: 'RATE_R',
          source: { message: 'RATE', axis: 'R' },
          prefixes: ['Q_A_RAT_RLL_'],
          unitScale: RAD2DEG,
          units: DEG_PER_SEC
        },
        {
          key: 'RATE_P',
          source: { message: 'RATE', axis: 'P' },
          prefixes: ['Q_A_RAT_PIT_'],
          unitScale: RAD2DEG,
          units: DEG_PER_SEC
        },
        {
          key: 'RATE_Y',
          source: { message: 'RATE', axis: 'Y' },
          prefixes: ['Q_A_RAT_YAW_'],
          unitScale: RAD2DEG,
          units: DEG_PER_SEC
        }
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
