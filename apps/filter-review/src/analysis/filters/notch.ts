import { applyBiquad, type TransferAccumulator, type ZGrid } from './z-grid.js'

/** Minimum notch frequency for a harmonic number. */
export type MinFrequency = (harmonic: number) => number

/** Anything that can apply a notch at a given centre frequency. */
export interface CenteredFilter {
  /** Multiply the response for fundamental `center` (Hz) at `sampleFreq` (Hz) into `h`. */
  transfer(h: TransferAccumulator, center: number, sampleFreq: number, grid: ZGrid): void
}

/** One notch of a harmonic notch filter (upstream `NotchFilter`). */
export class NotchFilter implements CenteredFilter {
  /** Linear depth of the notch from the attenuation in dB. */
  readonly A: number

  constructor(
    attenuationDb: number,
    private readonly bandwidthHz: number,
    private readonly harmonicMul: number,
    private readonly minFreq: MinFrequency,
    private readonly spreadMul: number
  ) {
    this.A = 10.0 ** (-attenuationDb / 40.0)
  }

  transfer(h: TransferAccumulator, center: number, sampleFreq: number, grid: ZGrid): void {
    const bandwidthHz = this.bandwidthHz
    let centerFreqHz = center * this.harmonicMul

    // check center frequency is in the allowable range
    if (centerFreqHz <= 0.5 * bandwidthHz || centerFreqHz >= 0.5 * sampleFreq) return

    const minFreq = this.minFreq(this.harmonicMul)
    let A = this.A
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
    centerFreqHz = Math.max(centerFreqHz, minFreq) * this.spreadMul

    const octaves = Math.log2(centerFreqHz / (centerFreqHz - bandwidthHz / 2.0)) * 2.0
    const Q = (2.0 ** octaves) ** 0.5 / (2.0 ** octaves - 1.0)
    const Asq = A ** 2

    const omega = (2.0 * Math.PI * centerFreqHz) / sampleFreq
    const alpha = Math.sin(omega) / (2 * Q)
    const b0 = 1.0 + alpha * Asq
    const b1 = -2.0 * Math.cos(omega)
    const b2 = 1.0 - alpha * Asq
    const a0 = 1.0 + alpha
    const a1 = b1
    const a2 = 1.0 - alpha

    applyBiquad(h, grid, b0, b1, b2, a0, a1, a2)
  }
}

/**
 * Two, three or five spread notches standing in for one wide notch (upstream `MultiNotch`).
 *
 * @param center Configured base frequency (`_FREQ`) used to compute the spread.
 */
export class MultiNotch implements CenteredFilter {
  readonly notches: readonly NotchFilter[]

  constructor(attenuationDb: number, bandwidthHz: number, harmonic: number, minFreq: MinFrequency, num: number, center: number) {
    // Calculate spread required to achieve an equivalent single notch using two notches with Bandwidth/2
    const notchSpread = bandwidthHz / (32.0 * center)
    const bwScaled = (bandwidthHz * harmonic) / num

    const notches = [
      new NotchFilter(attenuationDb, bwScaled, harmonic, minFreq, 1.0 - notchSpread),
      new NotchFilter(attenuationDb, bwScaled, harmonic, minFreq, 1.0 + notchSpread)
    ]
    if (num >= 3) notches.push(new NotchFilter(attenuationDb, bwScaled, harmonic, minFreq, 1.0))
    if (num === 5) {
      notches.push(new NotchFilter(attenuationDb, bwScaled, harmonic, minFreq, 1.0 - 2.0 * notchSpread))
      notches.push(new NotchFilter(attenuationDb, bwScaled, harmonic, minFreq, 1.0 + 2.0 * notchSpread))
    }
    this.notches = notches
  }

  transfer(h: TransferAccumulator, center: number, sampleFreq: number, grid: ZGrid): void {
    for (const notch of this.notches) notch.transfer(h, center, sampleFreq, grid)
  }
}
