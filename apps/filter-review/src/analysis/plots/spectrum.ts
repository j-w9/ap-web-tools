import { arrayAdd, arrayMul, arrayOffset, arrayScale, complexAbs, type AmplitudeScale, type ComplexArray } from '@apwt/signal'
import type { GyroAxis, GyroFft } from '../fft/batch-fft.js'
import { findEndIndex, findStartIndex, type TimeRange } from '../time-index.js'

/** Window indexes `[start, end)` averaged for a time range (upstream `find_*_index` plus one). */
export function windowRange(time: ArrayLike<number>, range: TimeRange): { start: number; end: number } {
  return { start: findStartIndex(time, range.start), end: findEndIndex(time, range.end) + 1 }
}

/** Window amplitude correction for the selected scale and the FFT resolution. */
export function fftWindowCorrection(fft: GyroFft, scale: AmplitudeScale): number {
  const resolution = fft.averageSampleRate / fft.windowSize
  return scale.windowCorrection(fft.correction, resolution)
}

/**
 * Mean spectrum of one axis over `range` with window correction applied, in the scale's
 * pre-display units (upstream `redraw()`). Apply `AliasHelper.apply` then `scale.scale` to plot.
 * Returns `undefined` when there are no FFT windows.
 */
export function meanSpectrum(fft: GyroFft, axis: GyroAxis, scale: AmplitudeScale, range: TimeRange): Float64Array | undefined {
  const spectra = fft[axis]
  if (spectra.length === 0) return undefined
  const { start, end } = windowRange(fft.time, range)
  let mean: Float64Array = new Float64Array(spectra[0]!.length)
  for (let j = start; j < end; j++) mean = arrayAdd(mean, scale.transform(spectra[j]!))
  return arrayScale(mean, fftWindowCorrection(fft, scale) / (end - start))
}

/**
 * Estimated post-filter mean spectrum (upstream `redraw_post_estimate_and_bode`): the
 * quantisation noise floor is removed, the filter attenuation applied and the floor re-added,
 * which makes the estimate line up with logged post-filter data.
 *
 * @param transfer Filter response on the FFT bins at each window (`InstanceTransfer.fft`).
 */
export function estimatedPostSpectrum(
  fft: GyroFft,
  axis: GyroAxis,
  scale: AmplitudeScale,
  range: TimeRange,
  transfer: readonly ComplexArray[],
  quantizationNoise: number
): Float64Array | undefined {
  const spectra = fft[axis]
  if (spectra.length === 0) return undefined
  const windowCorrection = fftWindowCorrection(fft, scale)
  // Scale quantization by the window correction factor so correction can be applied later
  const quantizationCorrection = quantizationNoise * scale.quantizationCorrection(windowCorrection)
  const { start, end } = windowRange(fft.time, range)
  let mean: Float64Array = new Float64Array(spectra[0]!.length)
  for (let j = start; j < end; j++) {
    const attenuation = complexAbs(transfer[j]!)
    const filtered = arrayOffset(arrayMul(arrayOffset(spectra[j]!, -quantizationCorrection), attenuation), quantizationCorrection)
    mean = arrayAdd(mean, scale.transform(filtered))
  }
  return arrayScale(mean, windowCorrection / (end - start))
}
