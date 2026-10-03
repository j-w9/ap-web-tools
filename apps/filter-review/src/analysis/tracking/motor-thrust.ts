// Motor output to thrust conversion for the multi-source throttle notch (upstream
// tracking/Throttle.js). Inverts AP_MotorsMulticopter's thrust curve and compensation.

/** Motor parameters needed to recover thrust from PWM (`MOT_*` or `Q_M_*`). */
export interface MotorParams {
  readonly THST_EXPO: number
  readonly SPIN_MAX: number
  readonly SPIN_MIN: number
  readonly PWM_MIN: number
  readonly PWM_MAX: number
  readonly BAT_VOLT_MIN: number
  readonly BAT_VOLT_MAX: number
  readonly BAT_IDX: number
  readonly OPTIONS: number
}

/** Names of the motor parameters, in the order upstream reads them. */
export const MOTOR_PARAM_NAMES = [
  'THST_EXPO',
  'SPIN_MAX',
  'SPIN_MIN',
  'PWM_MIN',
  'PWM_MAX',
  'BAT_VOLT_MIN',
  'BAT_VOLT_MAX',
  'BAT_IDX',
  'OPTIONS'
] as const satisfies readonly (keyof MotorParams)[]

/** Normalised battery voltage and maximum lift per battery sample. */
export interface BatteryCompensation {
  readonly voltage: Float64Array
  readonly liftMax: Float64Array
}

/**
 * Normalised battery voltage and lift max per sample (AP_MotorsMulticopter::update_lift_max_from_batt_voltage).
 * `expo` must already be constrained to +-1.
 */
export function batteryCompensation(
  params: MotorParams,
  expo: number,
  rawVoltage: ArrayLike<number>,
  restingVoltage: ArrayLike<number>
): BatteryCompensation {
  const useRawVoltage = (params.OPTIONS & 1) !== 0
  const len = rawVoltage.length
  const voltageOut = new Float64Array(len)
  const liftMax = new Float64Array(len)
  const minVoltThreshold = 0.25 * params.BAT_VOLT_MIN
  for (let i = 0; i < len; i++) {
    // Resting voltage is constrained to be larger than raw voltage in:
    // AP_BattMonitor_Backend::voltage_resting_estimate()
    const voltage = useRawVoltage ? rawVoltage[i]! : Math.max(rawVoltage[i]!, restingVoltage[i]!)
    if (voltage < minVoltThreshold) {
      voltageOut[i] = 1.0
      liftMax[i] = 1.0
      continue
    }
    // Constrain to range and normalize
    const constrained = Math.min(Math.max(voltage, params.BAT_VOLT_MIN), params.BAT_VOLT_MAX)
    const v = constrained / params.BAT_VOLT_MAX
    voltageOut[i] = v
    liftMax[i] = v * (1 - expo) + expo * v * v
  }
  return { voltage: voltageOut, liftMax }
}

/** Air density compensation factor from the EAS2TAS ratio at each altitude. */
export function airDensityCorrection(eas2tasValues: ArrayLike<number>): Float64Array {
  const out = new Float64Array(eas2tasValues.length)
  for (let i = 0; i < out.length; i++) {
    const airDensityRatio = 1.0 / Math.pow(eas2tasValues[i]!, 2.0)
    if (airDensityRatio > 0.3 && airDensityRatio < 1.5) {
      out[i] = 1.0 / Math.min(Math.max(airDensityRatio, 0.5), 1.25)
    } else {
      out[i] = 1.0
    }
  }
  return out
}

/** Remove the thrust curve and voltage scaling from a 0..1 throttle (upstream helper of the same name). */
export function removeThrustCurveAndVoltScaling(
  throttle: number,
  battVoltageFilt: number,
  liftMax: number,
  expo: number
): number {
  let batteryScale = 1.0
  if (battVoltageFilt > 0) batteryScale = 1.0 / battVoltageFilt
  // apply thrust curve - domain -1.0 to 1.0, range -1.0 to 1.0
  if (expo === 0) {
    // zero expo means linear, avoid floating point exception for small values
    return throttle / (liftMax * batteryScale)
  }
  let thrust = (throttle / batteryScale) * (2.0 * expo) - (expo - 1.0)
  thrust = thrust * thrust - (1.0 - expo) * (1.0 - expo)
  thrust /= 4.0 * expo * liftMax
  return Math.min(Math.max(thrust, 0.0), 1.0)
}

/** Lift max and air density compensation gain (upstream `get_compensation_gain`). */
export function compensationGain(liftMax: number, airDensityRatio: number): number {
  if (liftMax <= 0) return 1.0
  return (1.0 / liftMax) * airDensityRatio
}

/**
 * Thrust (0..1) for each PWM sample of one motor.
 *
 * @param battery Battery voltage and lift max interpolated to the PWM times, or `undefined`
 *   when battery compensation is disabled.
 * @param density Air density correction interpolated to the PWM times.
 */
export function pwmToThrust(
  pwm: ArrayLike<number>,
  params: MotorParams,
  expo: number,
  battery: BatteryCompensation | undefined,
  density: ArrayLike<number>
): Float64Array {
  const thrust = new Float64Array(pwm.length)
  for (let i = 0; i < pwm.length; i++) {
    // Calculate actuator output using PWM min and max
    let throttle = (pwm[i]! - params.PWM_MIN) / (params.PWM_MAX - params.PWM_MIN)
    // Remove spin min and max
    throttle = (throttle - params.SPIN_MIN) / (params.SPIN_MAX - params.SPIN_MIN)
    // Constrain 0 to 1
    throttle = Math.min(Math.max(throttle, 0.0), 1.0)

    const liftMax = battery === undefined ? 1.0 : battery.liftMax[i]!
    let t = removeThrustCurveAndVoltScaling(throttle, battery === undefined ? 1.0 : battery.voltage[i]!, liftMax, expo)
    t /= compensationGain(liftMax, density[i]!)
    thrust[i] = t
  }
  return thrust
}
