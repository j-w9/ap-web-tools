/**
 * @apwt/signal - framework-free numeric foundation for the ArduPilot web tools.
 *
 * - `complex`: complex vectors as parallel re/im arrays (`ComplexArray`) plus scalar `Complex`.
 * - `array`:   element-wise helpers over `ArrayLike<number>` returning `Float64Array`.
 * - `window`:  Hann window and its amplitude/energy correction factors.
 * - `fft`:     `RealFft` engine wrapper, windowed batch `runFft`, bin frequencies, layout conversions.
 * - `scale`:   amplitude (linear / dB / PSD) and frequency (Hz / RPM) axis recipes.
 *
 * Everything here is a direct port of upstream `Libraries/Array_Math.js` and `Libraries/fft.js`
 * and is numerically identical to it. No DOM access.
 */

export type { Complex, ComplexArray, ComplexArrayLike } from './complex.js'
export {
  complexArrayOf,
  complexArrayFrom,
  complexArrayCopy,
  complexAt,
  complexMul,
  complexDiv,
  complexAbs,
  complexInverse,
  complexSquare,
  complexPhase,
  complexConj,
  expJw
} from './complex.js'

export {
  arrayMax,
  arrayMin,
  arrayScale,
  arrayInverse,
  arrayMul,
  arrayDiv,
  arrayOffset,
  arrayAdd,
  arraySub,
  arrayLog10,
  arrayAbs,
  arraySqrt,
  arrayAllEqual,
  arrayAllNaN,
  arraySum,
  arrayMean,
  arrayFromRange,
  linearInterp
} from './array.js'

export type { WindowCorrection } from './window.js'
export { hanning, windowCorrectionFactors } from './window.js'

export type { NumericBuffer, InterleavedComplex, RunFftOptions, RunFftResult } from './fft.js'
export {
  RealFft,
  realLength,
  rfftFreq,
  isPowerOfTwo,
  stepWindowSize,
  runFft,
  toDoubleSided,
  toInterleaved,
  fromInterleaved
} from './fft.js'

export type {
  AmplitudeKind,
  AmplitudeScale,
  AmplitudeScaleOptions,
  FrequencyScale,
  FrequencyScaleOptions
} from './scale.js'
export { fftAmplitudeScale, fftFrequencyScale } from './scale.js'
