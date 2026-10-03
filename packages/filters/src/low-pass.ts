/** Low-pass filters: ArduPilot's second-order Butterworth biquad and first-order `LPF_1P`. */
import { complexArrayOf, complexDiv, type ComplexArray } from '@apwt/signal'
import { biquadResponse, type Biquad } from './biquad.js'
import { unityResponse, type ZGrid } from './z-grid.js'

/**
 * Second-order Butterworth low-pass, as `INS_GYRO_FILTER` (upstream `DigitalBiquadFilter`).
 * `biquad` is null when the cut-off is zero or negative, which disables the filter.
 */
export interface BiquadLowPass {
  readonly kind: 'biquad-low-pass'
  readonly sampleRate: number
  readonly cutoffHz: number
  readonly biquad: Biquad | null
}

export function designBiquadLowPass(sampleRate: number, cutoffHz: number): BiquadLowPass {
  if (cutoffHz <= 0) return { kind: 'biquad-low-pass', sampleRate, cutoffHz, biquad: null }

  const fr = sampleRate / cutoffHz
  const ohm = Math.tan(Math.PI / fr)
  const c = 1.0 + 2.0 * Math.cos(Math.PI / 4.0) * ohm + ohm * ohm

  const b0 = (ohm * ohm) / c
  const biquad: Biquad = {
    b0,
    b1: 2.0 * b0,
    b2: b0,
    // Upstream writes the denominator as 1 + a1 z^-1 + a2 z^-2
    a0: 1,
    a1: (2.0 * (ohm * ohm - 1.0)) / c,
    a2: (1.0 - 2.0 * Math.cos(Math.PI / 4.0) * ohm + ohm * ohm) / c
  }
  return { kind: 'biquad-low-pass', sampleRate, cutoffHz, biquad }
}

export function biquadLowPassResponse(filter: BiquadLowPass, grid: ZGrid): ComplexArray {
  return filter.biquad ? biquadResponse(filter.biquad, grid) : unityResponse(grid.z1.re.length)
}

/**
 * First-order low-pass H(z) = a / (1 - (1 - a) z^-1) (upstream `LPF_1P`), used for the PID error,
 * derivative and target filters and for input shaping. A null alpha (cut-off of zero or less)
 * passes everything.
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
