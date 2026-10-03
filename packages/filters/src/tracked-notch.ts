/**
 * Harmonic notch notches as FilterReview models them (upstream `FilterReview.js` `NotchFilter`
 * and `MultiNotch`): the centre follows logged tracking data, the depth is reduced below the
 * minimum frequency, the composite spread comes from the configured `_FREQ` and is applied after
 * clamping to the minimum, and the response is accumulated (see `accumulateBiquad`).
 *
 * The arithmetic is FilterReview's, written as upstream writes it (`**`, `a0 = 1 + alpha`), and
 * differs from FilterTool / AnalyticTune (`notch.ts`, `harmonic-notch.ts`) on purpose.
 */
import { accumulateBiquad, type TransferAccumulator } from './biquad.js'
import type { ZGrid } from './z-grid.js'

/** Minimum notch frequency (Hz) for a harmonic number (upstream `min_freq_fun`). */
export type MinFrequency = (harmonic: number) => number

/** One notch whose centre is a tracked fundamental times `harmonic` times `spread`. */
export interface TrackedNotch {
  /** Linear depth from the attenuation in dB (upstream `this.A`). */
  readonly A: number
  readonly bandwidthHz: number
  readonly harmonic: number
  readonly minFreq: MinFrequency
  readonly spread: number
}

/** Upstream `new NotchFilter(attenuation_dB, bandwidth_hz, harmonic_mul, min_freq_fun, spread_mul)`. */
export function designTrackedNotch(
  attenuationDb: number,
  bandwidthHz: number,
  harmonic: number,
  minFreq: MinFrequency,
  spread: number
): TrackedNotch {
  return { A: 10.0 ** (-attenuationDb / 40.0), bandwidthHz, harmonic, minFreq, spread }
}

/**
 * The notches standing in for one harmonic (upstream `MultiNotch` for 2, 3 or 5, a single
 * `NotchFilter` for 1), in upstream order.
 *
 * @param baseFreqHz Configured `_FREQ`, which sets the spread of composite notches.
 */
export function designTrackedNotchGroup(
  attenuationDb: number,
  bandwidthHz: number,
  harmonic: number,
  minFreq: MinFrequency,
  compositeNotches: 1 | 2 | 3 | 5,
  baseFreqHz: number
): readonly TrackedNotch[] {
  if (compositeNotches === 1) return [designTrackedNotch(attenuationDb, bandwidthHz * harmonic, harmonic, minFreq, 1.0)]
  // Calculate spread required to achieve an equivalent single notch using two notches with Bandwidth/2
  const notchSpread = bandwidthHz / (32.0 * baseFreqHz)
  const bwScaled = (bandwidthHz * harmonic) / compositeNotches
  const notch = (spread: number): TrackedNotch => designTrackedNotch(attenuationDb, bwScaled, harmonic, minFreq, spread)

  const notches = [notch(1.0 - notchSpread), notch(1.0 + notchSpread)]
  if (compositeNotches >= 3) notches.push(notch(1.0))
  if (compositeNotches === 5) {
    notches.push(notch(1.0 - 2.0 * notchSpread))
    notches.push(notch(1.0 + 2.0 * notchSpread))
  }
  return notches
}

/** Multiply the notch response for fundamental `centerHz` at `sampleRate` into `h` (upstream `transfer`). */
export function accumulateTrackedNotch(
  h: TransferAccumulator,
  notch: TrackedNotch,
  centerHz: number,
  sampleRate: number,
  grid: ZGrid
): void {
  const bandwidthHz = notch.bandwidthHz
  let centerFreqHz = centerHz * notch.harmonic

  // check center frequency is in the allowable range
  if (centerFreqHz <= 0.5 * bandwidthHz || centerFreqHz >= 0.5 * sampleRate) return

  const minFreq = notch.minFreq(notch.harmonic)
  let A = notch.A
  if (centerFreqHz < minFreq) {
    const disableFreq = minFreq * 0.25
    if (centerFreqHz < disableFreq) {
      // Disabled
      return
    }
    // Reduce attenuation (A of 1.0 is no attenuation)
    const ratio = (centerFreqHz - disableFreq) / (minFreq - disableFreq)
    A = 1.0 + (A - 1.0) * ratio
  }
  centerFreqHz = Math.max(centerFreqHz, minFreq) * notch.spread

  const octaves = Math.log2(centerFreqHz / (centerFreqHz - bandwidthHz / 2.0)) * 2.0
  const Q = (2.0 ** octaves) ** 0.5 / (2.0 ** octaves - 1.0)
  const Asq = A ** 2

  const omega = (2.0 * Math.PI * centerFreqHz) / sampleRate
  const alpha = Math.sin(omega) / (2 * Q)
  const b1 = -2.0 * Math.cos(omega)
  accumulateBiquad(h, grid, { b0: 1.0 + alpha * Asq, b1, b2: 1.0 - alpha * Asq, a0: 1.0 + alpha, a1: b1, a2: 1.0 - alpha })
}

/** Apply every notch of a group, in order, for fundamental `centerHz`. */
export function accumulateTrackedNotchGroup(
  h: TransferAccumulator,
  group: readonly TrackedNotch[],
  centerHz: number,
  sampleRate: number,
  grid: ZGrid
): void {
  for (const notch of group) accumulateTrackedNotch(h, notch, centerHz, sampleRate, grid)
}
