/**
 * Thrust linearisation maths, ported from upstream `updateThrustExpoPlot` in ThrustExpo.js.
 *
 * The measured thrust/PWM curve is run through ArduPilot's own thrust linearisation
 * (AP_Motors_Thrust_Linearization.cpp) for demanded thrust 0 to 1. A good `MOT_THST_EXPO`
 * makes the resulting thrust a straight line, i.e. its gradient is constant, so the fit
 * minimises the standard deviation of that gradient.
 */
import { arrayFromRange, arrayMean, arrayOffset, arrayScale, linearInterp } from '@apwt/signal'

/** Step of the demanded thrust (actuator) test values, 0 to 1. */
export const ACTUATOR_STEP = 0.001
/** Expo search range and step (upstream tests -1 to 1 in steps of 0.005). */
export const EXPO_SEARCH = { start: -1, end: 1, step: 0.005 } as const

/** Motor output range parameters the linearisation depends on. */
export interface OutputRange {
  readonly spinMin: number
  readonly spinMax: number
  readonly pwmMin: number
  readonly pwmMax: number
}

/** Valid test stand samples as parallel columns, in table order. */
export interface ThrustData {
  readonly pwm: Float64Array
  readonly thrust: Float64Array
}

/** How the expo is chosen: fitted to the data, or a value the user entered. */
export type ExpoSetting = { readonly kind: 'fit' } | { readonly kind: 'fixed'; readonly expo: number }

/** Thrust after linearisation with one expo value (upstream `get_corrected_thrust` result). */
export interface CorrectedThrust {
  readonly expo: number
  /** Measured thrust at each actuator test value once linearised. */
  readonly correctedThrust: Float64Array
  /** Finite-difference gradient of `correctedThrust` per unit actuator, one shorter. */
  readonly gradient: Float64Array
  readonly mean: number
  /** Population standard deviation of `gradient`: the fit's cost. */
  readonly stdDeviation: number
}

export interface Linearisation {
  /** Actuator test values 0 to 1. */
  readonly actuator: Float64Array
  /** The same as throttle percent, the x axis of the thrust plot. */
  readonly throttlePct: Float64Array
  /** Gradient sample positions (mid-points between test values) in percent. */
  readonly gradientThrottlePct: Float64Array
  /** Measured thrust against actuator with no linearisation. */
  readonly uncorrectedThrust: Float64Array
  /** The chosen expo: the best fit, or the user's value. */
  readonly result: CorrectedThrust
  readonly setting: ExpoSetting['kind']
}

function constrainFloat(amt: number, low: number, high: number): number {
  if (amt < low) return low
  if (amt > high) return high
  return amt
}

/**
 * AP `apply_thrust_curve_and_volt_scaling` with constant battery voltage: demanded thrust
 * (0 to 1) to throttle (0 to 1).
 */
export function applyThrustCurve(thrust: number, curveExpo: number): number {
  const batteryScale = 1.0
  const liftMax = 1.0
  const thrustCurveExpo = constrainFloat(curveExpo, -1.0, 1.0)
  if (thrustCurveExpo === 0) {
    // zero expo means linear, avoid floating point exception for small values
    return liftMax * thrust * batteryScale
  }
  const throttleRatio =
    (thrustCurveExpo -
      1.0 +
      Math.sqrt((1.0 - thrustCurveExpo) * (1.0 - thrustCurveExpo) + 4.0 * thrustCurveExpo * liftMax * thrust)) /
    (2.0 * thrustCurveExpo)
  return constrainFloat(throttleRatio * batteryScale, 0.0, 1.0)
}

/** AP `thrust_to_actuator`: demanded thrust to linearised actuator output (0 to 1). */
export function thrustToActuator(thrust: number, curveExpo: number, range: OutputRange): number {
  const t = constrainFloat(thrust, 0.0, 1.0)
  return range.spinMin + (range.spinMax - range.spinMin) * applyThrustCurve(t, curveExpo)
}

/** AP `output_to_pwm`: actuator output (0 to 1) to PWM. */
export function outputToPwm(actuator: number, range: OutputRange): number {
  return range.pwmMin + (range.pwmMax - range.pwmMin) * actuator
}

/** Actuator test values 0 to 1 in `ACTUATOR_STEP` steps. */
export function actuatorTestValues(): Float64Array {
  return arrayFromRange(0.0, 1.0, ACTUATOR_STEP)
}

/** Linearised thrust and its gradient statistics for one expo (upstream `get_corrected_thrust`). */
export function correctedThrust(
  data: ThrustData,
  range: OutputRange,
  curveExpo: number,
  actuator: Float64Array = actuatorTestValues()
): CorrectedThrust {
  const len = actuator.length
  const pwm = new Float64Array(len)
  for (let i = 0; i < len; i++) pwm[i] = outputToPwm(thrustToActuator(actuator[i]!, curveExpo, range), range)

  // Interpolate the thrust for the given PWM
  const corrected = linearInterp(data.thrust, data.pwm, pwm)

  // Differentiate, good linearisation has constant gradient
  const gradient = new Float64Array(Math.max(len - 1, 0))
  for (let i = 0; i < len - 1; i++) gradient[i] = (corrected[i + 1]! - corrected[i]!) / ACTUATOR_STEP

  const mean = arrayMean(gradient)
  let sum = 0.0
  for (let i = 0; i < len - 1; i++) sum += (gradient[i]! - mean) ** 2
  const stdDeviation = Math.sqrt(sum / gradient.length)

  return { expo: curveExpo, correctedThrust: corrected, gradient, mean, stdDeviation }
}

/**
 * Expo with the most constant thrust gradient. Tests -1 to 1 in 0.005 steps, accumulating the
 * step exactly as upstream does, and keeps the first minimum.
 */
export function fitExpo(data: ThrustData, range: OutputRange, actuator: Float64Array = actuatorTestValues()): CorrectedThrust {
  let best = correctedThrust(data, range, EXPO_SEARCH.start, actuator)
  for (let expo = EXPO_SEARCH.start + EXPO_SEARCH.step; expo <= EXPO_SEARCH.end; expo += EXPO_SEARCH.step) {
    const test = correctedThrust(data, range, expo, actuator)
    if (test.stdDeviation < best.stdDeviation) best = test
  }
  return best
}

/** Measured thrust against actuator, inverting the spin and PWM ranges with no expo applied. */
export function uncorrectedThrust(data: ThrustData, range: OutputRange, actuator: Float64Array): Float64Array {
  const n = data.pwm.length
  const uncorrectedActuator = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const throttle = (data.pwm[i]! - range.pwmMin) / (range.pwmMax - range.pwmMin)
    uncorrectedActuator[i] = (throttle - range.spinMin) / (range.spinMax - range.spinMin)
  }
  return linearInterp(data.thrust, uncorrectedActuator, actuator)
}

/**
 * Whether upstream keeps a given expo rather than fitting: it tests `if (thrustExpo)`, so 0 and
 * NaN (an empty input) are refitted. Upstream bug reproduced: a manual expo of exactly 0 (linear)
 * cannot be tried (docs/upstream-bugs.md).
 */
export function keepsExpo(setting: ExpoSetting): setting is { readonly kind: 'fixed'; readonly expo: number } {
  return setting.kind === 'fixed' && setting.expo !== 0 && !Number.isNaN(setting.expo)
}

/** Run the whole linearisation. Returns null with no samples (upstream clears the plots). */
export function linearise(data: ThrustData, range: OutputRange, setting: ExpoSetting): Linearisation | null {
  if (data.pwm.length === 0) return null
  const actuator = actuatorTestValues()
  const fixed = keepsExpo(setting)
  const result = fixed ? correctedThrust(data, range, setting.expo, actuator) : fitExpo(data, range, actuator)
  return {
    actuator,
    throttlePct: arrayScale(actuator, 100.0),
    gradientThrottlePct: arrayScale(arrayOffset(actuator.subarray(0, -1), ACTUATOR_STEP * 0.5), 100.0),
    uncorrectedThrust: uncorrectedThrust(data, range, actuator),
    result,
    setting: fixed ? 'fixed' : 'fit'
  }
}

/** Hover point on the linearised curve. */
export interface HoverEstimate {
  /** Thrust each motor must produce: all-up weight over motor count. */
  readonly requiredThrust: number
  /** Throttle (percent) at which the linearised curve reaches it. */
  readonly throttlePct: number
  /** Estimated `MOT_THST_HOVER`, rounded to 4 decimal places. */
  readonly motThstHover: number
}

/**
 * Estimate hover throttle from all-up weight (same units as thrust) and motor count. Null
 * when either is not positive, or the hover point is off the curve.
 */
export function estimateHover(lin: Linearisation, allUpWeight: number, motorCount: number): HoverEstimate | null {
  if (!(allUpWeight > 0 && motorCount > 0)) return null
  const requiredThrust = allUpWeight / motorCount
  const throttlePct = linearInterp(lin.throttlePct, lin.result.correctedThrust, [requiredThrust])[0]
  if (throttlePct === undefined || !(throttlePct >= 0 && throttlePct <= 100)) return null
  return { requiredThrust, throttlePct, motThstHover: Math.round((throttlePct / 100) * 10000) / 10000 }
}

/** Spin parameters marked on the thrust plots. */
export interface SpinParams {
  readonly spinArm: number
  readonly spinMin: number
  readonly spinMax: number
  readonly pwmMin: number
  readonly pwmMax: number
}

export type SpinMarkerKey = 'SPIN_ARM' | 'SPIN_MIN' | 'SPIN_MAX'
export interface SpinMarker {
  readonly key: SpinMarkerKey
  readonly x: number
}

/** Positions of the spin markers on a PWM or percent axis (upstream `createSpinMarkers`). */
export function spinMarkers(p: SpinParams, axis: 'pwm' | 'percent'): readonly SpinMarker[] {
  const span = axis === 'pwm' ? p.pwmMax - p.pwmMin : 100
  const base = axis === 'pwm' ? p.pwmMin : 0
  return [
    { key: 'SPIN_ARM', x: base + p.spinArm * span },
    { key: 'SPIN_MIN', x: base + p.spinMin * span },
    { key: 'SPIN_MAX', x: base + p.spinMax * span }
  ]
}
