/**
 * The parameters and inputs the tool works with: upstream `ThrustExpo/params.json` as typed
 * metadata, and the `params` table at the top of `ThrustExpo.js` (defaults and which values
 * are written to the parameter file).
 */

/** ArduPilot parameters the tool reads or writes. */
export const MOTOR_PARAM_NAMES = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX',
  'MOT_THST_EXPO',
  'MOT_THST_HOVER'
] as const
export type MotorParamName = (typeof MOTOR_PARAM_NAMES)[number]

export interface ParamMetadata {
  readonly displayName: string
  readonly description: string
  readonly units?: string
  readonly range: { readonly low: number; readonly high: number }
  readonly user: 'Standard' | 'Advanced'
}

/** Upstream `params.json` (the `MOT_` group), with ranges as numbers. */
export const PARAM_METADATA = {
  MOT_PWM_MIN: {
    displayName: 'PWM output minimum',
    description: 'This sets the min PWM output value in microseconds that will ever be output to the motors',
    units: 'µs',
    range: { low: 0, high: 2000 },
    user: 'Advanced'
  },
  MOT_PWM_MAX: {
    displayName: 'PWM output maximum',
    description: 'This sets the max PWM value in microseconds that will ever be output to the motors',
    units: 'µs',
    range: { low: 0, high: 2000 },
    user: 'Advanced'
  },
  MOT_SPIN_ARM: {
    displayName: 'Motor Spin armed',
    description:
      'Point at which the motors start to spin expressed as a number from 0 to 1 in the entire output range.  Should be lower than MOT_SPIN_MIN.',
    range: { low: 0, high: 1 },
    user: 'Advanced'
  },
  MOT_SPIN_MIN: {
    displayName: 'Motor Spin minimum',
    description:
      'Point at which the thrust starts expressed as a number from 0 to 1 in the entire output range.  Should be higher than MOT_SPIN_ARM.',
    range: { low: 0, high: 1 },
    user: 'Advanced'
  },
  MOT_SPIN_MAX: {
    displayName: 'Motor Spin maximum',
    description: 'Point at which the thrust saturates expressed as a number from 0 to 1 in the entire output range',
    range: { low: 0, high: 1 },
    user: 'Advanced'
  },
  MOT_THST_EXPO: {
    displayName: 'Thrust Curve Expo',
    description: 'Motor thrust curve exponent (0.0 for linear to 1.0 for second order curve)',
    range: { low: -1, high: 1 },
    user: 'Advanced'
  },
  MOT_THST_HOVER: {
    displayName: 'Thrust Hover Value',
    description: 'Motor thrust needed to hover expressed as a number from 0 to 1',
    range: { low: 0.125, high: 0.6875 },
    user: 'Advanced'
  }
} as const satisfies Record<MotorParamName, ParamMetadata>

/** Editable inputs: the motor parameters plus the two hover-estimate inputs, which are not parameters. */
export const INPUT_NAMES = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX',
  'MOT_THST_EXPO',
  'MOTOR_COUNT',
  'COPTER_AUW'
] as const
export type InputName = (typeof INPUT_NAMES)[number]

export interface InputSpec {
  readonly default: number
  readonly step: number
  /** Browser min/max hints; upstream sets them from the metadata range for `class="constrain"` inputs. */
  readonly min?: number
  readonly max?: number
}

/** Upstream `params` defaults and the index.html input attributes. */
export const INPUTS = {
  MOT_SPIN_ARM: { default: 0.1, step: 0.01, min: 0, max: 1 },
  MOT_SPIN_MIN: { default: 0.15, step: 0.01, min: 0, max: 1 },
  MOT_SPIN_MAX: { default: 0.95, step: 0.01, min: 0, max: 1 },
  MOT_PWM_MIN: { default: 1000, step: 1 },
  MOT_PWM_MAX: { default: 2000, step: 1 },
  MOT_THST_EXPO: { default: 0.65, step: 0.001, min: -1, max: 1 },
  MOTOR_COUNT: { default: 4, step: 1, min: 1, max: 12 },
  COPTER_AUW: { default: 0, step: 0.1, min: 0 }
} as const satisfies Record<InputName, InputSpec>

/** Parameters always written to the parameter file, in upstream order. `MOT_THST_HOVER` follows when estimated. */
export const SAVED_PARAM_NAMES = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX',
  'MOT_THST_EXPO'
] as const satisfies readonly MotorParamName[]
export type SavedParamName = (typeof SAVED_PARAM_NAMES)[number]

/** Every input at its default value. */
export function defaultInputs(): Record<InputName, number> {
  return {
    MOT_SPIN_ARM: INPUTS.MOT_SPIN_ARM.default,
    MOT_SPIN_MIN: INPUTS.MOT_SPIN_MIN.default,
    MOT_SPIN_MAX: INPUTS.MOT_SPIN_MAX.default,
    MOT_PWM_MIN: INPUTS.MOT_PWM_MIN.default,
    MOT_PWM_MAX: INPUTS.MOT_PWM_MAX.default,
    MOT_THST_EXPO: INPUTS.MOT_THST_EXPO.default,
    MOTOR_COUNT: INPUTS.MOTOR_COUNT.default,
    COPTER_AUW: INPUTS.COPTER_AUW.default
  }
}

export function isInputName(name: string): name is InputName {
  return (INPUT_NAMES as readonly string[]).includes(name)
}
