/**
 * Discrete-time models of ArduPilot's gyro filters and rate PID, ported from upstream
 * `FilterTool/filters.js`. Each filter is a plain data design (coefficients computed once) plus
 * a function evaluating its transfer function H(z) on a frequency grid. The arithmetic follows
 * upstream operation for operation so results match it to the last bit.
 */
import { complexArrayOf, complexDiv, complexInverse, complexMul, complexSquare, expJw, type ComplexArray } from '@apwt/signal'

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

/** Evaluate a biquad on a grid. */
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

/**
 * Second-order Butterworth low-pass, as `INS_GYRO_FILTER` (upstream `DigitalBiquadFilter`).
 * `biquad` is null when the cut-off is zero or negative, which disables the filter.
 */
export interface LowPassFilter {
  readonly kind: 'low-pass'
  readonly sampleRate: number
  readonly cutoffHz: number
  readonly biquad: Biquad | null
}

export function designLowPass(sampleRate: number, cutoffHz: number): LowPassFilter {
  if (cutoffHz <= 0) return { kind: 'low-pass', sampleRate, cutoffHz, biquad: null }

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
  return { kind: 'low-pass', sampleRate, cutoffHz, biquad }
}

/** First-order low-pass used on the PID error and derivative (upstream `LPF_1P`); null = pass-through. */
export interface FirstOrderLowPass {
  readonly alpha: number
}

export function designFirstOrderLowPass(sampleRate: number, cutoffHz: number): FirstOrderLowPass | null {
  if (cutoffHz <= 0) return null
  // calc_lowpass_alpha_dt
  const dt = 1.0 / sampleRate
  if (dt <= 0.0) return { alpha: 1.0 }
  const rc = 1.0 / (Math.PI * 2 * cutoffHz)
  return { alpha: dt / (dt + rc) }
}

/** H(z) = a / (1 - (1 - a) z^-1). */
export function firstOrderLowPassResponse(filter: FirstOrderLowPass | null, grid: ZGrid): ComplexArray {
  const len = grid.z1.re.length
  if (filter === null) return unityResponse(len)
  const { alpha } = filter
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

/**
 * One notch (upstream `NotchFilter`). `biquad` is null when the centre frequency is outside
 * the allowed range (above half the bandwidth and below Nyquist); the notch then passes all.
 */
export interface NotchFilter {
  readonly centerHz: number
  readonly bandwidthHz: number
  readonly attenuationDb: number
  readonly biquad: Biquad | null
}

export function designNotch(sampleRate: number, centerHz: number, bandwidthHz: number, attenuationDb: number): NotchFilter {
  const base = { centerHz, bandwidthHz, attenuationDb }
  // check center frequency is in the allowable range
  if (!(centerHz > 0.5 * bandwidthHz && centerHz < 0.5 * sampleRate)) return { ...base, biquad: null }

  // calculate_A_and_Q
  const A = Math.pow(10.0, -attenuationDb / 40.0)
  const octaves = Math.log2(centerHz / (centerHz - bandwidthHz / 2.0)) * 2.0
  const Q = Math.sqrt(Math.pow(2.0, octaves)) / (Math.pow(2.0, octaves) - 1.0)

  // init_with_A_and_Q
  if (!(centerHz > 0.0 && Q > 0.0)) return { ...base, biquad: null }
  const omega = (2.0 * Math.PI * centerHz) / sampleRate
  const alpha = Math.sin(omega) / (2 * Q)
  const b1 = -2.0 * Math.cos(omega)
  // Upstream stores 1 / a0 and inverts it again when evaluating; keep that for bit parity.
  const a0Inv = 1.0 / (1.0 + alpha)
  const biquad: Biquad = {
    b0: 1.0 + alpha * A ** 2,
    b1,
    b2: 1.0 - alpha * A ** 2,
    a0: 1 / a0Inv,
    a1: b1,
    a2: 1.0 - alpha
  }
  return { ...base, biquad }
}

export function notchResponse(notch: NotchFilter, grid: ZGrid): ComplexArray {
  return notch.biquad ? biquadResponse(notch.biquad, grid) : unityResponse(grid.z1.re.length)
}

// ---------- Harmonic notch ----------

/** Harmonic numbers selectable in `_HMNCS` (bit n selects harmonic n + 1). */
export type Harmonic = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const HARMONICS: readonly Harmonic[] = [1, 2, 3, 4, 5, 6, 7, 8]

/** Notches per harmonic, from the `_OPTS` double (bit 0) and triple (bit 4) options. */
export type NotchComposition = 'single' | 'double' | 'triple'

export const COMPOSITE_NOTCHES: Readonly<Record<NotchComposition, number>> = { single: 1, double: 2, triple: 3 }

/** How the notch centre follows the vehicle (`_MODE`), with the parameters each mode uses. */
export type NotchTracking =
  | { readonly mode: 'fixed' }
  /** Scales with the square root of throttle relative to `_REF`, never below `_FM_RAT` × `_FREQ`. */
  | { readonly mode: 'throttle'; readonly reference: number; readonly minRatio: number }
  /** Follows an RPM sensor (`RPM1` or `RPM2`) scaled by `_REF`, never below `_FREQ`. */
  | { readonly mode: 'rpm'; readonly sensor: 1 | 2; readonly reference: number }
  /** Follows ESC telemetry; with multi-source, one notch set per motor. */
  | { readonly mode: 'esc'; readonly reference: number; readonly multiSource: boolean }
  /** In-flight FFT; with no log to analyse the tool uses `_FREQ`, as upstream does. */
  | { readonly mode: 'fft' }

export type TrackingMode = NotchTracking['mode']

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

/** Values of the tracking sources, which the tool takes as inputs instead of from a log. */
export interface OperatingPoint {
  /** Throttle, 0 to 1. */
  readonly throttle: number
  readonly rpm1: number
  readonly rpm2: number
  readonly escRpm: number
  /** Motors sending ESC telemetry; used by multi-source ESC tracking. */
  readonly numMotors: number
}

/** A designed harmonic notch: the tracked fundamental and every resulting notch. */
export interface HarmonicNotchFilter {
  readonly kind: 'harmonic-notch'
  readonly sampleRate: number
  readonly enabled: boolean
  /** Fundamental centre frequency after tracking (Hz). */
  readonly fundamentalHz: number
  readonly notches: readonly NotchFilter[]
}

/** The fundamental after applying the tracking mode at the operating point. */
export function trackedFrequency(config: HarmonicNotchConfig, op: OperatingPoint): number {
  const freq = config.baseFreqHz
  const t = config.tracking
  switch (t.mode) {
    case 'fixed':
    case 'fft':
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
export function designHarmonicNotch(sampleRate: number, config: HarmonicNotchConfig, op: OperatingPoint): HarmonicNotchFilter {
  const freq = trackedFrequency(config, op)
  const base = { kind: 'harmonic-notch', sampleRate, fundamentalHz: freq } as const
  if (!config.enabled) return { ...base, enabled: false, notches: [] }

  const chained = config.tracking.mode === 'esc' && config.tracking.multiSource ? op.numMotors : 1
  const compositeNotches = COMPOSITE_NOTCHES[config.composition]
  const notches: NotchFilter[] = []
  const att = config.attenuationDb

  for (const fmul of config.harmonics) {
    let notchCenter = freq * fmul
    const bandwidthHz = config.bandwidthHz * fmul
    const notchBandwidth = bandwidthHz / compositeNotches
    for (let c = 0; c < chained; c++) {
      const nyquistLimit = sampleRate * 0.48
      const bandwidthLimit = bandwidthHz * 0.52

      // Calculate spread required to achieve an equivalent single notch using two notches with Bandwidth/2.
      // Upstream computes this before clamping, so later chained copies see the clamped centre.
      const notchSpread = bandwidthHz / (32.0 * notchCenter)

      // adjust the fundamental center frequency to be in the allowable range
      notchCenter = Math.min(Math.max(notchCenter, bandwidthLimit), nyquistLimit)

      // only enable a notch if its center frequency is below the nyquist frequency
      if (compositeNotches !== 2 && notchCenter < nyquistLimit) {
        notches.push(designNotch(sampleRate, notchCenter, notchBandwidth, att))
      }
      if (compositeNotches > 1) {
        for (const spread of [1.0 - notchSpread, 1.0 + notchSpread]) {
          const center = notchCenter * spread
          if (center < nyquistLimit) notches.push(designNotch(sampleRate, center, notchBandwidth, att))
        }
      }
    }
  }
  return { ...base, enabled: true, notches }
}

export function harmonicNotchResponse(filter: HarmonicNotchFilter, grid: ZGrid): ComplexArray {
  let h = unityResponse(grid.z1.re.length)
  for (const notch of filter.notches) h = complexMul(h, notchResponse(notch, grid))
  return h
}

// ---------- Gyro filter chain ----------

/** One filter in the gyro chain. */
export type GyroFilter = HarmonicNotchFilter | LowPassFilter

export function isFilterEnabled(filter: GyroFilter): boolean {
  switch (filter.kind) {
    case 'harmonic-notch':
      return filter.enabled
    case 'low-pass':
      return filter.biquad !== null
  }
}

export function gyroFilterResponse(filter: GyroFilter, grid: ZGrid): ComplexArray {
  switch (filter.kind) {
    case 'harmonic-notch':
      return harmonicNotchResponse(filter, grid)
    case 'low-pass':
      return filter.biquad ? biquadResponse(filter.biquad, grid) : unityResponse(grid.z1.re.length)
  }
}

// ---------- Rate PID ----------

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
export interface PidController {
  readonly kind: 'pid'
  readonly sampleRate: number
  readonly gains: PidGains
  readonly errorFilter: FirstOrderLowPass | null
  readonly derivativeFilter: FirstOrderLowPass | null
}

export function designPid(sampleRate: number, gains: PidGains): PidController {
  return {
    kind: 'pid',
    sampleRate,
    gains,
    errorFilter: designFirstOrderLowPass(sampleRate, gains.errorCutoffHz),
    derivativeFilter: designFirstOrderLowPass(sampleRate, gains.derivativeCutoffHz)
  }
}

/** Response of the PID and of each of its terms. */
export interface PidResponse {
  readonly total: ComplexArray
  readonly p: ComplexArray
  readonly i: ComplexArray
  readonly d: ComplexArray
}

export function pidResponse(pid: PidController, grid: ZGrid): PidResponse {
  const { z, z1 } = grid
  const len = z1.re.length
  const eTrans = firstOrderLowPassResponse(pid.errorFilter, grid)
  const dTrans = complexMul(eTrans, firstOrderLowPassResponse(pid.derivativeFilter, grid))

  // I term is k*z / (z - 1)
  const zLessOne: ComplexArray = { re: z.re.map((v) => v + -1), im: z.im.slice() }
  const iComp = complexMul(complexDiv(z, zLessOne), eTrans)
  const kI = pid.gains.kI / pid.sampleRate

  // D term is k * (1 - z^-1)
  const oneLessZ1: ComplexArray = { re: z1.re.map((v) => v * -1 + 1), im: z1.im.map((v) => v * -1) }
  const dComp = complexMul(oneLessZ1, dTrans)
  const kD = pid.gains.kD * pid.sampleRate
  const kP = pid.gains.kP

  const total = complexArrayOf(len)
  const p = complexArrayOf(len)
  const i = complexArrayOf(len)
  const d = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    p.re[n] = eTrans.re[n]! * kP
    p.im[n] = eTrans.im[n]! * kP
    i.re[n] = iComp.re[n]! * kI
    i.im[n] = iComp.im[n]! * kI
    d.re[n] = dComp.re[n]! * kD
    d.im[n] = dComp.im[n]! * kD
    total.re[n] = p.re[n]! + i.re[n]! + d.re[n]!
    total.im[n] = p.im[n]! + i.im[n]! + d.im[n]!
  }
  return { total, p, i, d }
}
