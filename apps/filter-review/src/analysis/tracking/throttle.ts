import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'
import { linearInterp } from '@apwt/signal'
import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import type { TimeRange } from '../time-index.js'
import { eas2tas } from './atmosphere.js'
import {
  MOTOR_PARAM_NAMES,
  airDensityCorrection,
  batteryCompensation,
  pwmToThrust,
  type BatteryCompensation,
  type MotorParams
} from './motor-thrust.js'
import { isInstanced, readSeries } from './read-series.js'
import {
  NotchTarget,
  isMultiSource,
  mapValues,
  meanOverRange,
  single,
  type InterpolatedTarget,
  type LoggedSeries,
  type TargetFrequency,
  type TrackingContext
} from './target.js'

/** `INS_HNTCH_MODE` value tracking throttle. */
export const THROTTLE_MODE = 1

/** Thrust of one motor over time. */
export interface MotorThrust {
  readonly time: Float64Array
  readonly thrust: Float64Array
}

const K_MOTOR1 = 33
const K_MOTOR8 = 40
const K_MOTOR9 = 82
const K_MOTOR12 = 85

/** True if a servo function is a multicopter motor. */
function isMotor(val: number | undefined): boolean {
  if (val === undefined) return false
  return (val >= K_MOTOR1 && val <= K_MOTOR8) || (val >= K_MOTOR9 && val <= K_MOTOR12)
}

/** The k_motor function for a zero-based motor channel. */
function motorFunction(channel: number): number {
  if (channel < 8) return K_MOTOR1 + channel
  return K_MOTOR9 + channel - 8
}

/** Frame classes with the number of motor outputs each needs (upstream `motor_frame_class`). */
function frameClasses(motorCount: number): readonly { name: string; value: number; count: number }[] {
  return [
    { name: 'QUAD', value: 1, count: 4 },
    { name: 'HEXA', value: 2, count: 6 },
    { name: 'OCTA', value: 3, count: 8 },
    { name: 'OCTAQUAD', value: 4, count: 8 },
    { name: 'Y6', value: 5, count: 6 },
    { name: 'TRI', value: 7, count: 4 }, // Not all are really motors
    { name: 'SINGLE', value: 8, count: 6 }, // Not all are really motors
    { name: 'COAX', value: 9, count: 6 }, // Not all are really motors
    { name: 'DODECAHEXA', value: 12, count: 12 },
    { name: 'DECA', value: 14, count: 10 },
    { name: 'SCRIPTING_MATRIX', value: 15, count: motorCount },
    { name: '_6DOF_SCRIPTING', value: 16, count: motorCount },
    { name: 'DYNAMIC_SCRIPTING_MATRIX', value: 17, count: motorCount }
  ]
}

const FRAME_TRI = 7
const FRAME_SINGLE = 8
const FRAME_COAX = 9
const FRAME_TAILSITTER = 10

/** Log message holding the output of a zero-based servo channel. */
function outputMessage(channel: number): string {
  if (channel < 14) return 'RCOU'
  if (channel < 18) return 'RCO2'
  return 'RCO3'
}

/** Result of reading per-motor thrust, with the reason when it is unavailable. */
interface MotorThrustResult {
  readonly motors: MotorThrust[]
  readonly notes: string[]
}

/** Servo functions assigned to the motors of the configured frame, or a reason why not. */
function motorFunctions(
  functions: readonly (number | undefined)[],
  frameClass: number | undefined,
  notes: string[]
): number[] | undefined {
  let motorCount = 0
  for (const f of functions) if (isMotor(f)) motorCount += 1

  let motors: number[] = []
  for (const frame of frameClasses(motorCount)) {
    if (frame.value !== frameClass) continue
    if (motorCount !== frame.count) {
      notes.push(`Expected ${frame.count} motors for frame class: ${frame.name}`)
      return undefined
    }
    for (let i = 0; i < frame.count; i++) motors.push(motorFunction(i))
    break
  }

  // These frame classes don't use all the motor outputs for motors
  if (frameClass === FRAME_TRI) {
    motors = [motorFunction(0), motorFunction(1), motorFunction(3)]
  } else if (frameClass === FRAME_SINGLE || frameClass === FRAME_COAX) {
    motors = [motorFunction(5), motorFunction(6)]
  } else if (frameClass === FRAME_TAILSITTER) {
    // Tailsitter doesn't use the motor outputs at all: throttle left, throttle right
    motors = [73, 74]
  }

  if (motors.length === 0) {
    notes.push(`Unknown frame class: ${frameClass ?? 'not set'}`)
    return undefined
  }
  for (const motor of motors) {
    if (!functions.includes(motor)) {
      notes.push(`Could not find servo assigned to function: ${motor}`)
      return undefined
    }
  }
  return motors
}

/** Read `MOT_*` / `Q_M_*` parameters; `undefined` if any is missing. */
function motorParams(log: DataflashLog, notes: string[]): MotorParams | undefined {
  // Default options to 0 so there is no error if it is missing
  const out: Partial<Record<keyof MotorParams, number>> = { OPTIONS: 0 }
  for (const name of MOTOR_PARAM_NAMES) {
    const hasDefault = out[name] !== undefined
    for (const prefix of ['MOT_', 'Q_M_']) {
      const value = log.param(prefix + name)
      if (value === undefined) continue
      if (!hasDefault && out[name] !== undefined) notes.push('Unexpected motor param: ' + prefix + name)
      out[name] = value
    }
    if (out[name] === undefined) {
      // Need all params to extract throttle
      notes.push('Missing motor param: ' + name)
      return undefined
    }
  }
  return out as MotorParams
}

/** Per-motor thrust estimated from PWM outputs (upstream `ThrottleTarget` constructor body). */
function readMotorThrust(log: DataflashLog): MotorThrustResult {
  const notes: string[] = []
  const none = (): MotorThrustResult => ({ motors: [], notes })

  // Need RC outputs for per motor throttle notch
  if (!log.has('RCOU')) return none()

  const functions: (number | undefined)[] = []
  for (let i = 0; i < 32; i++) functions.push(log.param(`SERVO${i + 1}_FUNCTION`))

  const frameClass = log.param('FRAME_CLASS') ?? log.param('Q_FRAME_CLASS')
  const motors = motorFunctions(functions, frameClass, notes)
  if (motors === undefined) return none()

  const params = motorParams(log, notes)
  if (params === undefined) return none()

  // Thrust expo must be in the range +- 1.0
  const expo = Math.min(Math.max(params.THST_EXPO, -1.0), 1.0)

  // Battery compensation
  const skipBatteryComp = params.BAT_VOLT_MAX <= 0 || params.BAT_VOLT_MIN >= params.BAT_VOLT_MAX
  let battTime: ArrayLike<number> | undefined
  let battery: BatteryCompensation | undefined
  if (!skipBatteryComp) {
    const raw = isInstanced(log, 'BAT') ? log.getNumbers('BAT', 'Volt', params.BAT_IDX) : undefined
    const resting = raw === undefined ? undefined : log.getNumbers('BAT', 'VoltR', params.BAT_IDX)
    battTime = raw === undefined ? undefined : log.getNumbers('BAT', 'TimeUS', params.BAT_IDX)
    if (raw === undefined || resting === undefined || battTime === undefined) {
      notes.push('No battery logging for multi throttle notch')
      return none()
    }
    battery = batteryCompensation(params, expo, raw, resting)
  }

  // Air density correction
  const primaryBaro = log.param('BARO_PRIMARY')
  const baroTime =
    primaryBaro !== undefined && isInstanced(log, 'BARO') ? log.getNumbers('BARO', 'TimeUS', primaryBaro) : undefined
  const baroAlt = baroTime === undefined || primaryBaro === undefined ? undefined : log.getNumbers('BARO', 'Alt', primaryBaro)
  if (baroTime === undefined || baroAlt === undefined) {
    notes.push('No barometer logging for multi throttle notch')
    return none()
  }
  const densityCorrection = airDensityCorrection(mapValues(baroAlt, eas2tas))

  // Find each motor function in the log
  const out: MotorThrust[] = []
  for (const motor of motors) {
    const channel = functions.findIndex((f) => f === motor)
    const message = outputMessage(channel)
    const pwm = log.getNumbers(message, `C${channel + 1}`)
    const time = log.getNumbers(message, 'TimeUS')
    if (pwm === undefined || time === undefined) {
      // Upstream would throw here; treat as no multi-source data instead
      notes.push(`No output logging for servo ${channel + 1}`)
      return none()
    }

    // Interpolate battery and baro corrections to the PWM time
    const density = linearInterp(densityCorrection, baroTime, time)
    const batteryAtPwm =
      battery === undefined || battTime === undefined
        ? undefined
        : { voltage: linearInterp(battery.voltage, battTime, time), liftMax: linearInterp(battery.liftMax, battTime, time) }

    out.push({ time: timeUsToSeconds(time), thrust: pwmToThrust(pwm, params, expo, batteryAtPwm, density) })
  }
  return { motors: out, notes }
}

/**
 * Averaged throttle source: `RATE.AOut`, or `CTUN.ThO` on ArduCopter when RATE is not logged.
 * Upstream tests the firmware build type (`VER.BU`, else a bracketed MSG banner); the shared
 * `vehicleType()` uses the same `VER.BU` but a looser banner match for very old logs.
 */
function readThrottle(log: DataflashLog): LoggedSeries | undefined {
  if (log.has('RATE')) return readSeries(log, 'RATE', 'AOut')
  if (log.has('CTUN') && log.vehicleType() === 'copter') return readSeries(log, 'CTUN', 'ThO')
  return undefined
}

/** Throttle-based tracking (upstream `ThrottleTarget`, `tracking/Throttle.js`). */
export class ThrottleTarget extends NotchTarget {
  /** Average throttle over time. */
  readonly throttle: LoggedSeries | undefined
  /** Per-motor thrust for the multi-source throttle notch (empty when unavailable). */
  readonly motors: readonly MotorThrust[]
  /** Why per-motor thrust is unavailable, plus any parameter oddities (upstream console logs). */
  readonly notes: readonly string[]

  constructor(log: DataflashLog) {
    const throttle = readThrottle(log)
    // Upstream passes a null mode when there is no throttle source, so mode 1 is then unsupported
    super('Throttle', throttle === undefined ? null : THROTTLE_MODE)
    this.throttle = throttle
    const motors = readMotorThrust(log)
    this.motors = motors.motors
    this.notes = motors.notes
  }

  override noDataError(config: NotchParams, filterVersion: FilterVersion): string {
    if (isMultiSource(config)) {
      if (this.motors.length === 0) return 'No tracking data available for multi-Source throttle notch'
      if (filterVersion < 2) return 'Multi-Source throttle notch only available on filter V2+'
    }
    return super.noDataError(config, filterVersion)
  }

  override haveData(config: NotchParams | undefined, filterVersion: FilterVersion): boolean {
    if (isMultiSource(config)) {
      if (this.motors.length === 0) return false
      if (filterVersion < 2) return false
    }
    return this.throttle !== undefined
  }

  /** Notch frequency for a thrust (or average throttle) value. */
  target(config: NotchParams, thrust: number, filterVersion: FilterVersion): number {
    if (config.ref === 0) return config.freq
    const motorsThrottle = Math.max(0, thrust)
    const throttleNorm = Math.sqrt(motorsThrottle / config.ref)
    if (filterVersion >= 2) return Math.abs(config.freq * throttleNorm)
    return config.freq * Math.max(config.minRatio, throttleNorm)
  }

  override targetFrequency(config: NotchParams, context: TrackingContext): TargetFrequency | undefined {
    const version = context.filterVersion
    if (!this.haveData(config, version) || this.throttle === undefined) return undefined
    const map = (v: number): number => this.target(config, v, version)
    if (isMultiSource(config)) {
      // Tracking multiple peaks
      return { multi: true, series: this.motors.map((m) => ({ time: m.time, freq: mapValues(m.thrust, map) })) }
    }
    // Just average
    return single(this.throttle.time, mapValues(this.throttle.value, map))
  }

  override interpolate(time: ArrayLike<number>): InterpolatedTarget | undefined {
    const throttle = this.throttle
    if (throttle === undefined) return undefined
    const average = linearInterp(throttle.value, throttle.time, time)
    const perMotor = this.motors.map((m) => linearInterp(m.thrust, m.time, time))
    return {
      frequencies: (index, config, version) => {
        if (isMultiSource(config)) return perMotor.map((m) => this.target(config, m[index]!, version))
        return [this.target(config, average[index]!, version)]
      }
    }
  }

  override mean(range: TimeRange): number | undefined {
    return this.throttle === undefined ? undefined : meanOverRange(this.throttle.time, this.throttle.value, range)
  }
}
