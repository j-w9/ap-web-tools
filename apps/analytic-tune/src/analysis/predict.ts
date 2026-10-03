/**
 * Predicted closed-loop responses: the identified bare aircraft combined with models of the gyro
 * filters, rate PID, feedforward, target and error notches, angle controller and input shaping.
 * Ported from upstream `calculate_predicted_TF` and `get_filters`.
 *
 * Every complex operation keeps upstream's operand order, so each result has the length upstream
 * gives it. Upstream's hand-written loops run one element past the end of the aircraft response
 * and leave a trailing NaN on a few results; those loops stop at the end here.
 */
import { complexArrayOf, complexDiv, complexMul, type ComplexArray, type ComplexArrayLike } from '@apwt/signal'
import {
  HARMONICS,
  chainResponse,
  designAngleP,
  designBiquadLowPass,
  designFeedforward,
  designFirstOrderLowPass,
  designHarmonicNotch,
  designNotchWithQ,
  designPid,
  frequencyGrid,
  type HarmonicNotchConfig,
  type NotchComposition,
  type NotchTracking,
  type OperatingPoint,
  type TransferElement
} from './filters.js'
import {
  controllerParams,
  filterIndex,
  filterParam,
  notchParam,
  type Inputs,
  type NotchPrefix,
  type RateParam,
  type TuneTarget
} from './params.js'
import type { AirspeedScaling } from './time-history.js'

// ---------- Gyro filters from parameters ----------

/** Tracking mode from `_MODE` (and multi-source from `_OPTS`), compared exactly as upstream does. */
function notchTracking(mode: number, reference: number, minRatio: number, options: number): NotchTracking {
  switch (mode) {
    case 1:
      return { mode: 'throttle', reference, minRatio }
    case 2:
      return { mode: 'rpm', sensor: 1, reference }
    case 5:
      return { mode: 'rpm', sensor: 2, reference }
    case 3:
      return { mode: 'esc', reference, multiSource: (options & 2) !== 0 }
    default:
      // Fixed, and in-flight FFT, which has no log value to follow here: the notch stays at _FREQ.
      return { mode: 'fixed' }
  }
}

function notchComposition(options: number): NotchComposition {
  if (options & 1) return 'double'
  if (options & 16) return 'triple'
  return 'single'
}

/** A harmonic notch configuration from its parameters, read exactly as upstream reads them. */
export function harmonicNotchConfig(inputs: Inputs, prefix: NotchPrefix): HarmonicNotchConfig {
  const v = (field: Parameters<typeof notchParam>[1]) => inputs[notchParam(prefix, field)]
  const mask = v('HMNCS')
  return {
    enabled: !(v('ENABLE') <= 0),
    tracking: notchTracking(v('MODE'), v('REF'), v('FM_RAT'), v('OPTS')),
    baseFreqHz: v('FREQ'),
    bandwidthHz: v('BW'),
    attenuationDb: v('ATT'),
    harmonics: HARMONICS.filter((h) => (mask & (1 << (h - 1))) !== 0),
    composition: notchComposition(v('OPTS'))
  }
}

export function operatingPoint(inputs: Inputs): OperatingPoint {
  return {
    throttle: inputs.Throttle,
    rpm1: inputs.RPM1,
    rpm2: inputs.RPM2,
    escRpm: inputs.ESC_RPM,
    numMotors: inputs.NUM_MOTORS
  }
}

/** The gyro filter chain at `sampleRate`, in upstream order: notch 1, notch 2, low-pass. */
export function gyroFilters(inputs: Inputs, sampleRate: number): TransferElement[] {
  const op = operatingPoint(inputs)
  return [
    designHarmonicNotch(sampleRate, harmonicNotchConfig(inputs, 'INS_HNTCH'), op),
    designHarmonicNotch(sampleRate, harmonicNotchConfig(inputs, 'INS_HNTC2'), op),
    designBiquadLowPass(sampleRate, inputs.INS_GYRO_FILTER)
  ]
}

// ---------- Helpers ----------

/** a + b element-wise over `length` elements (reads past the end of a shorter operand give NaN, as upstream). */
function complexAdd(a: ComplexArrayLike, b: ComplexArrayLike, length: number): ComplexArray {
  const out = complexArrayOf(length)
  for (let k = 0; k < length; k++) {
    out.re[k] = a.re[k]! + b.re[k]!
    out.im[k] = a.im[k]! + b.im[k]!
  }
  return out
}

/** a + 1 over `length` elements. */
function plusOne(a: ComplexArrayLike, length: number): ComplexArray {
  const out = complexArrayOf(length)
  for (let k = 0; k < length; k++) {
    out.re[k] = a.re[k]! + 1
    out.im[k] = a.im[k]!
  }
  return out
}

/**
 * The `FILTn_` notch a rate controller notch selection refers to, designed at the loop rate,
 * or null when unset or the notch has no frequency.
 *
 * Deviation: upstream fails on a selection that names no `FILTn_` group (not 1 to 8); here it
 * selects no notch.
 */
function selectedNotch(inputs: Inputs, selection: RateParam, loopRate: number): TransferElement | null {
  const index = filterIndex(inputs[selection])
  if (index === null) return null
  const freq = inputs[filterParam(index, 'NOTCH_FREQ')]
  if (!(freq > 0.0)) return null
  return designNotchWithQ(loopRate, freq, inputs[filterParam(index, 'NOTCH_Q')], inputs[filterParam(index, 'NOTCH_ATT')])
}

// ---------- Prediction ----------

/** Predicted responses, named after the loops the plots show. */
export interface PredictedResponses {
  /** Closed rate loop: rate target to rate. */
  readonly rate: ComplexArray
  /** Closed attitude loop with feedforward. */
  readonly attitudeFeedforward: ComplexArray
  /** Pilot input (through input shaping) to attitude. */
  readonly pilot: ComplexArray
  /** Attitude disturbance rejection. */
  readonly disturbance: ComplexArray
  /** Closed attitude loop without feedforward. */
  readonly attitudeNoFeedforward: ComplexArray
  /** Broken attitude loop (attitude stability). */
  readonly attitudeBrokenLoop: ComplexArray
  /** Broken rate loop (rate stability). */
  readonly rateBrokenLoop: ComplexArray
  /** Broken loop of the whole system. */
  readonly systemBrokenLoop: ComplexArray
}

export interface PredictionSettings {
  readonly target: TuneTarget
  readonly inputs: Inputs
  readonly airspeed: AirspeedScaling
}

/**
 * Predict every closed and broken loop response from the identified bare aircraft `aircraft`,
 * evaluated on upstream's model grid (`sampleRate / windowSize` steps up to Nyquist).
 */
export function predictResponses(
  aircraft: ComplexArray,
  sampleRate: number,
  windowSize: number,
  settings: PredictionSettings
): PredictedResponses {
  const { target, inputs, airspeed } = settings
  const { aspeed, eas2tas } = airspeed
  const freq = frequencyGrid(sampleRate * 0.5, sampleRate / windowSize)
  const len = aircraft.re.length
  const chain = (element: TransferElement) => chainResponse(freq, [[element]])

  const loopRate = inputs.SCHED_LOOP_RATE
  const p = controllerParams(target)
  const rate = (term: keyof typeof p.rate) => inputs[p.rate[term]]

  // Rate PID, with gains scaled by airspeed squared on fixed wing.
  const pidH = chain(
    designPid(loopRate, {
      kP: rate('P') * aspeed * aspeed,
      kI: rate('I') * aspeed * aspeed,
      kD: rate('D') * aspeed * aspeed,
      errorCutoffHz: rate('FLTE'),
      derivativeCutoffHz: rate('FLTD')
    })
  )

  // Error notch ahead of the PID.
  const errorNotch = selectedNotch(inputs, p.rate.NEF, loopRate)
  const pidTotal = errorNotch ? complexMul(chain(errorNotch), pidH) : pidH

  // Feedforward and its derivative, in parallel with the PID.
  const ffH = chain(designFeedforward(loopRate, (rate('FF') * aspeed) / eas2tas, (rate('D_FF') * aspeed) / eas2tas))
  const ffPid = complexAdd(pidTotal, ffH, len)

  // Target filtering: the target low-pass, with the target notch ahead of it when set.
  const targetLowPass = chain(designFirstOrderLowPass(loopRate, rate('FLTT')))
  const targetNotch = selectedNotch(inputs, p.rate.NTF, loopRate)
  const targetFilter = targetNotch ? complexMul(chain(targetNotch), targetLowPass) : targetLowPass

  // Gyro filters at the gyro sample rate.
  const gyroH = chainResponse(freq, [gyroFilters(inputs, inputs.GyroSampleRate)])

  // Rate loop.
  const pidAircraft = complexMul(aircraft, pidTotal)
  const gyroPidAircraft = complexMul(pidAircraft, gyroH)
  const ffPidAircraft = complexMul(aircraft, ffPid)
  const filteredFfPidAircraft = complexMul(ffPidAircraft, targetFilter)
  const rateClosed = complexDiv(filteredFfPidAircraft, plusOne(gyroPidAircraft, len))

  // Attitude loop around the closed rate loop.
  const angleP = p.angle.kind === 'time-constant' ? 1 / inputs[p.angle.param] : inputs[p.angle.param]
  const angleH = chain(designAngleP(loopRate, angleP))
  const rateAngleP = complexMul(rateClosed, angleH)
  const rateAnglePPlusOne = plusOne(rateAngleP, len)
  const anglePPlusOne = plusOne(angleH, len)
  const attitudeFeedforward = complexDiv(complexMul(anglePPlusOne, rateClosed), rateAnglePPlusOne)
  const attitudeNoFeedforward = complexDiv(complexMul(angleH, rateClosed), rateAnglePPlusOne)

  // Input shaping: a first-order low-pass at the input time constant (none on fixed wing).
  const tc = p.inputTc === null ? null : inputs[p.inputTc]
  const tcFreq = tc === null ? 0.0 : 1 / (tc * 2 * Math.PI)
  const tcH = chain(designFirstOrderLowPass(loopRate, tcFreq))
  const pilot = complexMul(tcH, attitudeFeedforward)

  // Disturbance rejection: -1 / (1 + broken attitude loop).
  const minusOne = complexArrayOf(len)
  minusOne.re.fill(-1)
  const disturbance = complexDiv(minusOne, rateAnglePPlusOne)

  const systemBrokenLoop = complexAdd(complexMul(angleH, filteredFfPidAircraft), complexMul(gyroH, pidAircraft), len)

  return {
    rate: rateClosed,
    attitudeFeedforward,
    pilot,
    disturbance,
    attitudeNoFeedforward,
    attitudeBrokenLoop: rateAngleP,
    rateBrokenLoop: gyroPidAircraft,
    systemBrokenLoop
  }
}
