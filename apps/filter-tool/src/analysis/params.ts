/**
 * The ArduPilot parameters the filter tool simulates, and the extra operating-point inputs
 * (gyro rate, throttle, RPM) that are not parameters but set where tracking notches sit.
 *
 * Names are the ArduPilot parameter names (and upstream's form ids for the extra inputs), so
 * `.param` files and share links stay compatible with the upstream tool.
 */

/** The two harmonic notch parameter groups. */
export const NOTCH_PREFIXES = ['INS_HNTCH', 'INS_HNTC2'] as const
export type NotchPrefix = (typeof NOTCH_PREFIXES)[number]

/** Fields of one harmonic notch, in the order upstream lays them out. */
export const NOTCH_FIELDS = ['ENABLE', 'MODE', 'FREQ', 'BW', 'ATT', 'REF', 'FM_RAT', 'HMNCS', 'OPTS'] as const
export type NotchField = (typeof NOTCH_FIELDS)[number]
export type NotchParam = `${NotchPrefix}_${NotchField}`

/** Rate controller axes. */
export const PID_AXES = ['RLL', 'PIT', 'YAW'] as const
export type PidAxis = (typeof PID_AXES)[number]

/** Rate controller terms the tool models. */
export const PID_TERMS = ['P', 'I', 'D', 'FLTE', 'FLTD'] as const
export type PidTerm = (typeof PID_TERMS)[number]
export type PidParam = `ATC_RAT_${PidAxis}_${PidTerm}`

export type ParamName = 'SCHED_LOOP_RATE' | 'INS_GYRO_FILTER' | NotchParam | PidParam

export const notchParam = (prefix: NotchPrefix, field: NotchField): NotchParam => `${prefix}_${field}`
export const pidParam = (axis: PidAxis, term: PidTerm): PidParam => `ATC_RAT_${axis}_${term}`

/** Every simulated parameter, in upstream's form order. */
export const PARAM_NAMES: readonly ParamName[] = [
  'SCHED_LOOP_RATE',
  'INS_GYRO_FILTER',
  ...NOTCH_PREFIXES.flatMap((p) => NOTCH_FIELDS.map((f) => notchParam(p, f))),
  ...PID_AXES.flatMap((a) => PID_TERMS.map((t) => pidParam(a, t)))
]

const PARAM_NAME_SET: ReadonlySet<string> = new Set(PARAM_NAMES)

export function isParamName(name: string): name is ParamName {
  return PARAM_NAME_SET.has(name)
}

/** Operating-point inputs (upstream form ids). */
export const SIM_INPUT_NAMES = ['GyroSampleRate', 'Throttle', 'NUM_MOTORS', 'ESC_RPM', 'RPM1', 'RPM2'] as const
export type SimInputName = (typeof SIM_INPUT_NAMES)[number]

/** Every numeric input of the tool. */
export type InputName = ParamName | SimInputName

export const INPUT_NAMES: readonly InputName[] = [...SIM_INPUT_NAMES, ...PARAM_NAMES]

/** Current value of every input. */
export type Inputs = Readonly<Record<InputName, number>>

/** Defaults from upstream `index.html`. */
export const DEFAULT_INPUTS: Inputs = {
  GyroSampleRate: 2000,
  Throttle: 0.3,
  NUM_MOTORS: 1,
  ESC_RPM: 2500,
  RPM1: 2500,
  RPM2: 2500,
  SCHED_LOOP_RATE: 400,
  INS_GYRO_FILTER: 20,
  INS_HNTCH_ENABLE: 0,
  INS_HNTCH_MODE: 0,
  INS_HNTCH_FREQ: 0,
  INS_HNTCH_BW: 0,
  INS_HNTCH_ATT: 0,
  INS_HNTCH_REF: 0,
  INS_HNTCH_FM_RAT: 0,
  INS_HNTCH_HMNCS: 0,
  INS_HNTCH_OPTS: 0,
  INS_HNTC2_ENABLE: 0,
  INS_HNTC2_MODE: 0,
  INS_HNTC2_FREQ: 0,
  INS_HNTC2_BW: 0,
  INS_HNTC2_ATT: 0,
  INS_HNTC2_REF: 0,
  INS_HNTC2_FM_RAT: 0,
  INS_HNTC2_HMNCS: 0,
  INS_HNTC2_OPTS: 0,
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0036,
  ATC_RAT_RLL_FLTE: 0,
  ATC_RAT_RLL_FLTD: 20,
  ATC_RAT_PIT_P: 0.135,
  ATC_RAT_PIT_I: 0.135,
  ATC_RAT_PIT_D: 0.0036,
  ATC_RAT_PIT_FLTE: 0,
  ATC_RAT_PIT_FLTD: 20,
  ATC_RAT_YAW_P: 0.09,
  ATC_RAT_YAW_I: 0.009,
  ATC_RAT_YAW_D: 0,
  ATC_RAT_YAW_FLTE: 2.5,
  ATC_RAT_YAW_FLTD: 0
}
