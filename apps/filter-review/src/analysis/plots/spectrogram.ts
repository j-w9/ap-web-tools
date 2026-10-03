import { arrayMul, arrayOffset, arrayScale, complexAbs, type AmplitudeScale, type ComplexArray } from '@apwt/signal'
import type { GyroAxis, GyroFft } from '../fft/batch-fft.js'
import type { AliasHelper } from './alias.js'
import { fftWindowCorrection } from './spectrum.js'

/** Heatmap data for the spectrogram; `z[j]` is the spectrum at `time[j]` (transposed layout). */
export interface SpectrogramData {
  /** Window times (s) with two extra entries around every gap. */
  readonly time: number[]
  /** Frequency of each row (Hz); apply the frequency scale to plot. */
  readonly freq: Float64Array
  /** Scaled amplitude per time; `null` marks a gap column (upstream's empty array). */
  readonly z: (Float64Array | null)[]
}

/** Time axis with gap markers: where a step exceeds 2.5x the running mean, a blank section is inserted. */
export function spectrogramTimes(time: ArrayLike<number>): { time: number[]; gap: boolean[] } {
  const out: number[] = []
  const gap: boolean[] = []
  let count = 0
  let lastTime = time[0]!
  let sectionStart = time[0]!
  for (let j = 0; j < time.length; j++) {
    count++
    const thisTime = time[j]!
    const thisDt = thisTime - lastTime
    const averageDt = (thisTime - sectionStart) / count
    if (thisDt > averageDt * 2.5) {
      // Add a gap
      count = 0
      // start gap where next sample would have been expected
      out.push(lastTime + averageDt)
      gap.push(true)
      // End gap when previous sample would be expected
      out.push(thisTime - averageDt)
      gap.push(true)
      sectionStart = thisTime
    }
    out.push(thisTime)
    gap.push(false)
    lastTime = thisTime
  }
  return { time: out, gap }
}

/** Options for {@link spectrogramData}. */
export interface SpectrogramOptions {
  readonly axis: GyroAxis
  readonly scale: AmplitudeScale
  readonly alias: AliasHelper
  /** Filter response per window to show the estimated post-filter spectrum instead. */
  readonly estimate?: { readonly transfer: readonly ComplexArray[]; readonly quantizationNoise: number }
}

/** Build the spectrogram heatmap (upstream `redraw_Spectrogram`). */
export function spectrogramData(fft: GyroFft, options: SpectrogramOptions): SpectrogramData {
  const { axis, scale, alias, estimate } = options
  const { time, gap } = spectrogramTimes(fft.time)
  // Windowing amplitude correction depends on spectrum of interest
  const windowCorrection = fftWindowCorrection(fft, scale)
  const z: (Float64Array | null)[] = new Array<Float64Array | null>(time.length)
  let index = 0
  for (let j = 0; j < time.length; j++) {
    if (gap[j] === true) {
      // Null Z values result in a blank section in the plot
      z[j] = null
      continue
    }
    let amplitude = arrayScale(fft[axis][index]!, windowCorrection)
    if (estimate !== undefined) {
      const attenuation = complexAbs(estimate.transfer[index]!)
      const q = estimate.quantizationNoise
      amplitude = arrayOffset(arrayMul(arrayOffset(amplitude, -q), attenuation), q)
    }
    z[j] = scale.scale(scale.transform(alias.apply(amplitude)))
    index++
  }
  return { time, freq: alias.bins, z }
}
