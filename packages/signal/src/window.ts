// Window functions and their amplitude-correction factors (from upstream/Libraries/fft.js).

import { arrayMean, arrayMul } from './array.js'

/** Symmetric Hann ("hanning") window of the given length: 0.5 - 0.5*cos(2*pi*i/(len-1)). */
export function hanning(length: number): Float64Array {
  const w = new Float64Array(length)
  const scale = (2 * Math.PI) / (length - 1)
  for (let i = 0; i < length; i++) {
    w[i] = 0.5 - 0.5 * Math.cos(scale * i)
  }
  return w
}

/** Gains that undo the amplitude loss caused by a window function. */
export interface WindowCorrection {
  /** Linear (amplitude) spectrum correction: 1 / mean(w). */
  readonly linear: number
  /** Energy (power) spectrum correction: 1 / sqrt(mean(w^2)). */
  readonly energy: number
}

/** Linear and energy correction factors for the window `w`. */
export function windowCorrectionFactors(w: ArrayLike<number>): WindowCorrection {
  return {
    linear: 1 / arrayMean(w),
    energy: 1 / Math.sqrt(arrayMean(arrayMul(w, w)))
  }
}
