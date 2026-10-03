/**
 * Discrete-time models of ArduPilot's gyro filters, rate PID, feedforward, target and error
 * filters and angle controller, ported from upstream `AnalyticTune/AnalyticTune.js`. Each element
 * is a plain data design (coefficients computed once) evaluated as a transfer function H(z) on a
 * frequency grid. The arithmetic follows upstream operation for operation so results match it to
 * the last bit.
 *
 * Upstream's filter objects also store attenuation and phase as a side effect of `transfer`; the
 * tool never reads them, so here Bode data is computed on demand from a response (`bode.ts`).
 */
import {
  arrayFromRange,
  complexArrayOf,
  complexDiv,
  complexInverse,
  complexMul,
  complexSquare,
  expJw,
  type ComplexArray
} from '@apwt/signal'

// ---------- Frequency grid ----------

/** z, z^-1 and z^-2 evaluated on a frequency grid at one sample rate. */
export interface ZGrid {
  readonly z: ComplexArray
  readonly z1: ComplexArray
  readonly z2: ComplexArray
}

/** z = e^jw for each frequency (Hz) at `sampleRate` (Hz), with its inverse powers. */
export function zGrid(freq: ArrayLike<number>, sampleRate: number): ZGrid {
  const z = expJw(freq, sampleRate)
  return { z, z1: complexInverse(z), z2: complexInverse(complexSquare(z)) }
}

/** Frequencies `step, 2 step, ...` up to `max` (Hz), accumulated as upstream does. */
export function frequencyGrid(maxHz: number, stepHz: number): Float64Array {
  return arrayFromRange(stepHz, maxHz, stepHz)
}

/** H = 1 at every frequency: the response of a disabled filter. */
export function unityResponse(length: number): ComplexArray {
  const h = complexArrayOf(length)
  h.re.fill(1)
  return h
}

// ---------- Biquad ----------

/** Coefficients of H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2). */
export interface Biquad {
  readonly b0: number
  readonly b1: number
  readonly b2: number
  readonly a0: number
  readonly a1: number
  readonly a2: number
}

export function biquadResponse(c: Biquad, grid: ZGrid): ComplexArray {
  const { z1, z2 } = grid
  const len = z1.re.length
  const numerator = complexArrayOf(len)
  const denominator = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    numerator.re[i] = c.b0 + c.b1 * z1.re[i]! + c.b2 * z2.re[i]!
    numerator.im[i] = c.b1 * z1.im[i]! + c.b2 * z2.im[i]!

    denominator.re[i] = c.a0 + c.a1 * z1.re[i]! + c.a2 * z2.re[i]!
    denominator.im[i] = c.a1 * z1.im[i]! + c.a2 * z2.im[i]!
  }
  return complexDiv(numerator, denominator)
}

// ---------- Low-pass filters ----------

/** Second-order Butterworth low-pass, as `INS_GYRO_FILTER` (upstream `DigitalBiquadFilter`); null coefficients = disabled. */
export interface BiquadLowPass {
  readonly kind: 'biquad-low-pass'
  readonly sampleRate: number
  readonly biquad: Biquad | null
}

export function designBiquadLowPass(sampleRate: number, cutoffHz: number): BiquadLowPass {
  if (cutoffHz <= 0) return { kind: 'biquad-low-pass', sampleRate, biquad: null }

  const fr = sampleRate / cutoffHz
  const ohm = Math.tan(Math.PI / fr)
  const c = 1.0 + 2.0 * Math.cos(Math.PI / 4.0) * ohm + ohm * ohm

  const b0 = (ohm * ohm) / c
  const biquad: Biquad = {
    b0,
    b1: 2.0 * b0,
    b2: b0,
    a0: 1,
    a1: (2.0 * (ohm * ohm - 1.0)) / c,
    a2: (1.0 - 2.0 * Math.cos(Math.PI / 4.0) * ohm + ohm * ohm) / c
  }
  return { kind: 'biquad-low-pass', sampleRate, biquad }
}

/**
 * First-order low-pass H(z) = a / (1 - (1 - a) z^-1) (upstream `LPF_1P`), used for the PID error,
 * derivative and target filters and for input shaping. A null alpha passes everything.
 */
export interface FirstOrderLowPass {
  readonly kind: 'first-order-low-pass'
  readonly sampleRate: number
  readonly alpha: number | null
}

export function designFirstOrderLowPass(sampleRate: number, cutoffHz: number): FirstOrderLowPass {
  if (cutoffHz <= 0) return { kind: 'first-order-low-pass', sampleRate, alpha: null }
  // calc_lowpass_alpha_dt
  const dt = 1.0 / sampleRate
  if (dt <= 0.0) return { kind: 'first-order-low-pass', sampleRate, alpha: 1.0 }
  const rc = 1.0 / (Math.PI * 2 * cutoffHz)
  return { kind: 'first-order-low-pass', sampleRate, alpha: dt / (dt + rc) }
}

export function firstOrderLowPassResponse(filter: FirstOrderLowPass, grid: ZGrid): ComplexArray {
  const len = grid.z1.re.length
  const { alpha } = filter
  if (alpha === null) return unityResponse(len)
  const numerator = complexArrayOf(len)
  numerator.re.fill(alpha)
  const denominator = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    denominator.re[i] = grid.z1.re[i]! * (alpha - 1) + 1
    denominator.im[i] = grid.z1.im[i]! * (alpha - 1)
  }
  return complexDiv(numerator, denominator)
}

// ---------- Notch filters ----------

/** One notch; null coefficients pass everything (centre out of range). */
export interface Notch {
  readonly kind: 'notch'
  readonly sampleRate: number
  readonly centerHz: number
  readonly biquad: Biquad | null
}

/** Notch coefficients from attenuation and Q (upstream `init_with_A_and_Q`), or null if out of range. */
function notchBiquad(sampleRate: number, centerHz: number, q: number, attenuationDb: number): Biquad | null {
  if (!(centerHz > 0.0 && centerHz < 0.5 * sampleRate && q > 0.0)) return null
  const A = Math.pow(10.0, -attenuationDb / 40.0)
  const omega = (2.0 * Math.PI * centerHz) / sampleRate
  const alpha = Math.sin(omega) / (2 * q)
  const b1 = -2.0 * Math.cos(omega)
  // Upstream stores 1 / a0 and inverts it again when evaluating; keep that for bit parity.
  const a0Inv = 1.0 / (1.0 + alpha)
  return { b0: 1.0 + alpha * A ** 2, b1, b2: 1.0 - alpha * A ** 2, a0: 1 / a0Inv, a1: b1, a2: 1.0 - alpha }
}

/** A notch given by Q, as the `FILTn_` notches (upstream `NotchFilterusingQ`). */
export function designNotchWithQ(sampleRate: number, centerHz: number, q: number, attenuationDb: number): Notch {
  return { kind: 'notch', sampleRate, centerHz, biquad: notchBiquad(sampleRate, centerHz, q, attenuationDb) }
}

/** A notch given by bandwidth, as each harmonic notch (upstream `NotchFilter`). */
export function designNotchWithBandwidth(
  sampleRate: number,
  centerHz: number,
  bandwidthHz: number,
  attenuationDb: number
): Notch {
  const off: Notch = { kind: 'notch', sampleRate, centerHz, biquad: null }
  // check center frequency is in the allowable range
  if (!(centerHz > 0.5 * bandwidthHz && centerHz < 0.5 * sampleRate)) return off
  // calculate_A_and_Q: the range check above already guarantees centre > bandwidth / 2
  const octaves = Math.log2(centerHz / (centerHz - bandwidthHz / 2.0)) * 2.0
  const q = Math.sqrt(Math.pow(2.0, octaves)) / (Math.pow(2.0, octaves) - 1.0)
  return { ...off, biquad: notchBiquad(sampleRate, centerHz, q, attenuationDb) }
}

export function notchResponse(notch: Notch, grid: ZGrid): ComplexArray {
  return notch.biquad ? biquadResponse(notch.biquad, grid) : unityResponse(grid.z1.re.length)
}

// ---------- Harmonic notch ----------

/** Harmonic numbers selectable in `_HMNCS` (bit n selects harmonic n + 1); upstream models the first eight. */
export const HARMONICS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type Harmonic = (typeof HARMONICS)[number]

/** Notches per harmonic, from the `_OPTS` double (bit 0) and triple (bit 4) options. */
export type NotchComposition = 'single' | 'double' | 'triple'
const COMPOSITE_NOTCHES: Readonly<Record<NotchComposition, number>> = { single: 1, double: 2, triple: 3 }

/** How the notch centre follows the vehicle (`_MODE`), with the parameters each mode uses. */
export type NotchTracking =
  | { readonly mode: 'fixed' }
  /** Scales with the square root of throttle relative to `_REF`, never below `_FM_RAT` x `_FREQ`. */
  | { readonly mode: 'throttle'; readonly reference: number; readonly minRatio: number }
  /** Follows an RPM sensor scaled by `_REF`, never below `_FREQ`. */
  | { readonly mode: 'rpm'; readonly sensor: 1 | 2; readonly reference: number }
  /** Follows ESC telemetry; with multi-source, one notch set per motor. */
  | { readonly mode: 'esc'; readonly reference: number; readonly multiSource: boolean }

/** A harmonic notch's configuration (one `INS_HNTCH_*` / `INS_HNTC2_*` group). */
export interface HarmonicNotchConfig {
  readonly enabled: boolean
  readonly tracking: NotchTracking
  readonly baseFreqHz: number
  readonly bandwidthHz: number
  readonly attenuationDb: number
  readonly harmonics: readonly Harmonic[]
  readonly composition: NotchComposition
}

/** Values of the tracking sources, which the tool takes as inputs. */
export interface OperatingPoint {
  /** Throttle, 0 to 1. */
  readonly throttle: number
  readonly rpm1: number
  readonly rpm2: number
  readonly escRpm: number
  /** Motors sending ESC telemetry; used by multi-source ESC tracking. */
  readonly numMotors: number
}

export interface HarmonicNotch {
  readonly kind: 'harmonic-notch'
  readonly sampleRate: number
  readonly notches: readonly Notch[]
}

/** The fundamental after applying the tracking mode at the operating point. */
export function trackedFrequency(config: HarmonicNotchConfig, op: OperatingPoint): number {
  const freq = config.baseFreqHz
  const t = config.tracking
  switch (t.mode) {
    case 'fixed':
      return freq
    case 'throttle': {
      const motorsThrottle = Math.max(0, op.throttle)
      return freq * Math.max(t.minRatio, Math.sqrt(motorsThrottle / t.reference))
    }
    case 'rpm':
      return Math.max((t.sensor === 1 ? op.rpm1 : op.rpm2) / 60.0, freq) * t.reference
    case 'esc':
      return Math.max(op.escRpm / 60.0, freq) * t.reference
  }
}

/** Build the notches of a harmonic notch filter (upstream `HarmonicNotchFilter`). */
export function designHarmonicNotch(sampleRate: number, config: HarmonicNotchConfig, op: OperatingPoint): HarmonicNotch {
  if (!config.enabled) return { kind: 'harmonic-notch', sampleRate, notches: [] }

  const freq = trackedFrequency(config, op)
  const chained = config.tracking.mode === 'esc' && config.tracking.multiSource ? op.numMotors : 1
  const compositeNotches = COMPOSITE_NOTCHES[config.composition]
  const notches: Notch[] = []
  const att = config.attenuationDb

  for (const fmul of config.harmonics) {
    let notchCenter = freq * fmul
    const bandwidthHz = config.bandwidthHz * fmul
    for (let c = 0; c < chained; c++) {
      const nyquistLimit = sampleRate * 0.48
      const bandwidthLimit = bandwidthHz * 0.52

      // Spread required to achieve an equivalent single notch using two notches with bandwidth/2.
      // Upstream computes this before clamping, so later chained copies see the clamped centre.
      const notchSpread = bandwidthHz / (32.0 * notchCenter)

      // adjust the fundamental center frequency to be in the allowable range
      notchCenter = Math.min(Math.max(notchCenter, bandwidthLimit), nyquistLimit)

      // only enable a notch if its center frequency is below the nyquist frequency
      if (compositeNotches !== 2 && notchCenter < nyquistLimit) {
        notches.push(designNotchWithBandwidth(sampleRate, notchCenter, bandwidthHz / compositeNotches, att))
      }
      if (compositeNotches > 1) {
        for (const spread of [1.0 - notchSpread, 1.0 + notchSpread]) {
          const center = notchCenter * spread
          if (center < nyquistLimit) {
            notches.push(designNotchWithBandwidth(sampleRate, center, bandwidthHz / compositeNotches, att))
          }
        }
      }
    }
  }
  return { kind: 'harmonic-notch', sampleRate, notches }
}

export function harmonicNotchResponse(filter: HarmonicNotch, grid: ZGrid): ComplexArray {
  let h = unityResponse(grid.z1.re.length)
  for (const notch of filter.notches) h = complexMul(h, notchResponse(notch, grid))
  return h
}

// ---------- Controllers ----------

export interface PidGains {
  readonly kP: number
  readonly kI: number
  readonly kD: number
  /** Error filter cut-off (`_FLTE`, Hz); zero disables it. */
  readonly errorCutoffHz: number
  /** Derivative filter cut-off (`_FLTD`, Hz); zero disables it. */
  readonly derivativeCutoffHz: number
}

/** A rate PID at the main loop rate (upstream `PID`). */
export interface Pid {
  readonly kind: 'pid'
  readonly sampleRate: number
  readonly gains: PidGains
  readonly errorFilter: FirstOrderLowPass
  readonly derivativeFilter: FirstOrderLowPass
}

export function designPid(sampleRate: number, gains: PidGains): Pid {
  return {
    kind: 'pid',
    sampleRate,
    gains,
    errorFilter: designFirstOrderLowPass(sampleRate, gains.errorCutoffHz),
    derivativeFilter: designFirstOrderLowPass(sampleRate, gains.derivativeCutoffHz)
  }
}

/** I term z / (z - 1) (upstream `Z_less_one` construction). */
function integrator(z: ComplexArray): ComplexArray {
  const zLessOne: ComplexArray = { re: z.re.map((v) => v + -1), im: z.im.slice() }
  return complexDiv(z, zLessOne)
}

/** D term 1 - z^-1 (upstream `one_less_Z1` construction). */
function differentiator(z1: ComplexArray): ComplexArray {
  return { re: z1.re.map((v) => v * -1 + 1), im: z1.im.map((v) => v * -1) }
}

export function pidResponse(pid: Pid, grid: ZGrid): ComplexArray {
  const { z, z1 } = grid
  const len = z1.re.length
  const eTrans = firstOrderLowPassResponse(pid.errorFilter, grid)
  const dTrans = complexMul(eTrans, firstOrderLowPassResponse(pid.derivativeFilter, grid))

  const iComp = complexMul(integrator(z), eTrans)
  const kI = pid.gains.kI / pid.sampleRate

  const dComp = complexMul(differentiator(z1), dTrans)
  const kD = pid.gains.kD * pid.sampleRate
  const kP = pid.gains.kP

  const total = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    const pRe = eTrans.re[n]! * kP
    const pIm = eTrans.im[n]! * kP
    const iRe = iComp.re[n]! * kI
    const iIm = iComp.im[n]! * kI
    const dRe = dComp.re[n]! * kD
    const dIm = dComp.im[n]! * kD
    total.re[n] = pRe + iRe + dRe
    total.im[n] = pIm + iIm + dIm
  }
  return total
}

/** Angle P controller seen from the angle error: kP / sample rate x z / (z - 1) (upstream `Ang_P`). */
export interface AngleP {
  readonly kind: 'angle-p'
  readonly sampleRate: number
  readonly kP: number
}

export const designAngleP = (sampleRate: number, kP: number): AngleP => ({ kind: 'angle-p', sampleRate, kP })

export function anglePResponse(controller: AngleP, grid: ZGrid): ComplexArray {
  const len = grid.z1.re.length
  const iComp = integrator(grid.z)
  const kI = controller.kP / controller.sampleRate
  const out = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    out.re[n] = iComp.re[n]! * kI
    out.im[n] = iComp.im[n]! * kI
  }
  return out
}

/** Feedforward kFF + kFF_D x sample rate x (1 - z^-1) (upstream `feedforward`). */
export interface Feedforward {
  readonly kind: 'feedforward'
  readonly sampleRate: number
  readonly kFF: number
  readonly kFFD: number
}

export const designFeedforward = (sampleRate: number, kFF: number, kFFD: number): Feedforward => ({
  kind: 'feedforward',
  sampleRate,
  kFF,
  kFFD
})

export function feedforwardResponse(ff: Feedforward, grid: ZGrid): ComplexArray {
  const len = grid.z1.re.length
  const oneLessZ1 = differentiator(grid.z1)
  const kFFD = ff.kFFD * ff.sampleRate
  const out = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    out.re[n] = oneLessZ1.re[n]! * kFFD + ff.kFF
    out.im[n] = oneLessZ1.im[n]! * kFFD
  }
  return out
}

// ---------- Chains ----------

/** Any modelled element. */
export type TransferElement = BiquadLowPass | FirstOrderLowPass | Notch | HarmonicNotch | Pid | AngleP | Feedforward

export function elementResponse(element: TransferElement, grid: ZGrid): ComplexArray {
  switch (element.kind) {
    case 'biquad-low-pass':
      return element.biquad ? biquadResponse(element.biquad, grid) : unityResponse(grid.z1.re.length)
    case 'first-order-low-pass':
      return firstOrderLowPassResponse(element, grid)
    case 'notch':
      return notchResponse(element, grid)
    case 'harmonic-notch':
      return harmonicNotchResponse(element, grid)
    case 'pid':
      return pidResponse(element, grid)
    case 'angle-p':
      return anglePResponse(element, grid)
    case 'feedforward':
      return feedforwardResponse(element, grid)
  }
}

/**
 * Product of every element's response on `freq` (upstream `evaluate_transfer_functions`). Each
 * group shares the first element's sample rate; the product starts from unity, as upstream.
 */
export function chainResponse(freq: ArrayLike<number>, groups: readonly (readonly TransferElement[])[]): ComplexArray {
  let total = unityResponse(freq.length)
  for (const group of groups) {
    const first = group[0]
    if (first === undefined) continue
    const grid = zGrid(freq, first.sampleRate)
    for (const element of group) total = complexMul(total, elementResponse(element, grid))
  }
  return total
}
