/**
 * Single notch filters as FilterTool and AnalyticTune model them (upstream `NotchFilter`,
 * `NotchFilterusingQ`, `init_with_A_and_Q`). FilterReview's notch, which tracks a moving centre
 * and reduces its depth near the minimum frequency, is in `tracked-notch.ts`.
 */
import type { ComplexArray } from '@apwt/signal'
import { biquadResponse, type Biquad } from './biquad.js'
import { unityResponse, type ZGrid } from './z-grid.js'

interface NotchBase {
  readonly kind: 'notch'
  readonly sampleRate: number
  readonly centerHz: number
  readonly attenuationDb: number
  /** Null passes everything (centre or Q out of range). */
  readonly biquad: Biquad | null
}

/** A notch specified by its bandwidth (upstream `NotchFilter`). */
export interface BandwidthNotch extends NotchBase {
  readonly width: 'bandwidth'
  readonly bandwidthHz: number
}

/** A notch specified by its Q (upstream `NotchFilterusingQ`). */
export interface QNotch extends NotchBase {
  readonly width: 'q'
  readonly q: number
}

/** One notch. */
export type Notch = BandwidthNotch | QNotch

/**
 * Notch coefficients from attenuation and Q (upstream `init_with_A_and_Q`), or null when the
 * centre is not inside (0, Nyquist) or Q is not positive.
 */
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

/** A notch given by Q, as the `FILTn_` notches (upstream AnalyticTune `NotchFilterusingQ`). */
export function designNotchWithQ(sampleRate: number, centerHz: number, q: number, attenuationDb: number): QNotch {
  return {
    kind: 'notch',
    width: 'q',
    sampleRate,
    centerHz,
    q,
    attenuationDb,
    biquad: notchBiquad(sampleRate, centerHz, q, attenuationDb)
  }
}

/**
 * A notch given by bandwidth, as each harmonic notch (upstream `NotchFilter`). Passes everything
 * unless the centre is above half the bandwidth and below Nyquist.
 */
export function designNotchWithBandwidth(
  sampleRate: number,
  centerHz: number,
  bandwidthHz: number,
  attenuationDb: number
): BandwidthNotch {
  const off: BandwidthNotch = {
    kind: 'notch',
    width: 'bandwidth',
    sampleRate,
    centerHz,
    bandwidthHz,
    attenuationDb,
    biquad: null
  }
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
