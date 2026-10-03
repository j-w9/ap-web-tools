import type { GyroFft } from '../fft/batch-fft.js'

/** How sensor-rate frequencies are shown against the loop rate (upstream `Aliasing_*` radios). */
export type AliasMode = 'none' | 'on' | 'only'

/** Frequency folding helper (upstream `get_alias_obj`). */
export interface AliasHelper {
  /** Output frequency bins (Hz). */
  readonly bins: Float64Array
  /** Map an amplitude spectrum on the FFT bins to `bins`. */
  apply(amp: ArrayLike<number>): Float64Array
}

/**
 * Build the aliasing helper. With aliasing enabled the spectrum is re-sampled to fine bins
 * and folded about the loop-rate Nyquist frequency; `only` keeps just the folded part.
 */
export function aliasHelper(
  fft: Pick<GyroFft, 'bins' | 'averageSampleRate' | 'windowSize'>,
  mode: AliasMode,
  loopRate: number
): AliasHelper {
  if (mode === 'none') {
    // No aliasing, directly return passed in values
    return { bins: fft.bins, apply: (x) => Float64Array.from(x) }
  }

  const nyquist = loopRate * 0.5

  // Re-sample frequencies to make for easy folding. Array from 0 to Nyquist ending exactly on
  // it; smaller steps maintain amplitude in interpolation
  const len = Math.ceil(nyquist / (0.1 * (fft.averageSampleRate / fft.windowSize))) + 1
  const reSampleDt = nyquist / (len - 1)
  const bins = new Float64Array(len)
  for (let i = 0; i < len; i++) bins[i] = i * reSampleDt

  // Pre-calculate linear interpolation indexes and scale factors
  const fftBins = fft.bins
  const totalBins = Math.floor(fftBins[fftBins.length - 1]! / reSampleDt)
  const interpIndex = new Int32Array(totalBins)
  const interpScale = new Float64Array(totalBins)
  let index = 0
  for (let i = 0; i < totalBins; i++) {
    const bin = i * reSampleDt
    if (bin > fftBins[index + 1]!) index += 1
    interpIndex[i] = index
    interpScale[i] = (bin - fftBins[index]!) / (fftBins[index + 1]! - fftBins[index]!)
  }

  // Interpolate to new frequency bins and fold down
  const start = mode === 'only' ? len : 0
  return {
    bins,
    apply: (amp) => {
      const ret = new Float64Array(len)
      const reflectLen = (len - 1) * 2
      for (let i = start; i < totalBins; i++) {
        // Interpolate amplitude to new bins
        const preAmp = amp[interpIndex[i]!]!
        const postAmp = amp[interpIndex[i]! + 1]!
        const lerpAmp = preAmp + (postAmp - preAmp) * interpScale[i]!
        // fold down
        const foldIndex = Math.abs(i - reflectLen * Math.round(i / reflectLen))
        ret[foldIndex] = ret[foldIndex]! + lerpAmp
      }
      return ret
    }
  }
}
