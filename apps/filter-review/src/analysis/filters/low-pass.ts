import { applyBiquad, type TransferAccumulator, type ZGrid } from './z-grid.js'

/**
 * Second order Butterworth low-pass (upstream `DigitalBiquadFilter`, as `INS_GYRO_FILTER`).
 * A cut-off of zero or less disables the filter.
 */
export class LowPassFilter {
  /** Cut-off frequency (Hz). */
  readonly targetFreq: number

  constructor(freq: number) {
    this.targetFreq = freq
  }

  /** Multiply the filter response at `sampleFreq` (Hz) into `h`. */
  transfer(h: TransferAccumulator, sampleFreq: number, grid: ZGrid): void {
    if (this.targetFreq <= 0) return
    const fr = sampleFreq / this.targetFreq
    const ohm = Math.tan(Math.PI / fr)
    const c = 1.0 + 2.0 * Math.cos(Math.PI / 4.0) * ohm + ohm * ohm

    const b0 = (ohm * ohm) / c
    const b1 = 2.0 * b0
    const b2 = b0
    const a1 = (2.0 * (ohm * ohm - 1.0)) / c
    const a2 = (1.0 - 2.0 * Math.cos(Math.PI / 4.0) * ohm + ohm * ohm) / c

    // Upstream writes the denominator as 1 + a1 z^-1 + a2 z^-2
    applyBiquad(h, grid, b0, b1, b2, 1, a1, a2)
  }
}
