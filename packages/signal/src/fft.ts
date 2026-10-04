// Real FFT helpers ported from upstream/Libraries/fft.js, built on indutny's fft.js.
// The library is wrapped by `RealFft` so callers never touch it directly.

import FFT from 'fft.js'
import { arrayAbs, arrayMul } from './array.js'
import type { ComplexArray, ComplexArrayLike } from './complex.js'
import { complexArrayOf } from './complex.js'

/** Writable numeric buffer accepted by the FFT engine (plain or typed array). */
export type NumericBuffer = { [index: number]: number; readonly length: number }

/**
 * Interleaved complex buffer in fft.js layout: [re0, im0, re1, im1, ...] of length 2 * size.
 * This is the engine's native format; use `toInterleaved`/`fromInterleaved` to convert.
 */
export type InterleavedComplex = Float64Array

/** Number of non-redundant bins in the real FFT of `length` points: floor(length / 2) + 1. */
export function realLength(length: number): number {
  return Math.floor(length / 2) + 1
}

/** Frequency (Hz) of each real-FFT bin for `length` points sampled every `samplePeriod` seconds. */
export function rfftFreq(length: number, samplePeriod: number): Float64Array {
  const realLen = realLength(length)
  const freq = new Float64Array(realLen)
  for (let i = 0; i < realLen; i++) {
    freq[i] = i / (length * samplePeriod)
  }
  return freq
}

/** True when `n` is a positive integer power of two (the only sizes `RealFft` accepts). */
export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

/**
 * Next FFT window size when stepping `direction` from `current`: a power of two moves to the
 * adjacent power of two, anything else snaps to the nearest power of two in that direction.
 * Pure replacement for upstream's DOM-bound `fft_window_size_inc`.
 */
export function stepWindowSize(current: number, direction: 'up' | 'down'): number {
  let exponent = Math.log2(current)
  if (!Number.isInteger(exponent)) {
    exponent = Math.floor(exponent)
    if (direction === 'up') exponent += 1
  } else if (direction === 'up') {
    exponent += 1
  } else {
    exponent -= 1
  }
  return 2 ** exponent
}

/**
 * Upstream `fft_window_size_inc` (and AnalyticTune's identical `window_size_inc`) without the DOM:
 * given the last committed window size and the newly committed input value, return the value the
 * input takes. A change of exactly one is taken to come from the spinner arrows and steps to the
 * next power of two from `last` (`stepWindowSize`); any other value, typed or NaN, is kept as
 * entered (upstream does not snap or validate it). Call it on the input's native `change` event
 * (commit), not on every keystroke, and remember the result as the next `last`.
 */
export function fftWindowSizeInc(last: number, entered: number): number {
  const change = entered - last
  if (Math.abs(change) !== 1) return entered
  return stepWindowSize(last, change > 0 ? 'up' : 'down')
}

/** Fixed-size radix-4 FFT engine; `size` must be a power of two greater than one. */
export class RealFft {
  readonly size: number
  /** Bins in the real (positive-frequency) half spectrum. */
  readonly realLength: number
  private readonly engine: FFT

  constructor(size: number) {
    this.engine = new FFT(size)
    this.size = size
    this.realLength = realLength(size)
  }

  /** New zero-filled interleaved complex buffer of length 2 * size. */
  createComplexArray(): InterleavedComplex {
    return new Float64Array(this.size * 2)
  }

  /** Forward FFT of real `input` (length size) into interleaved `out`; only bins 0..size/2 are valid. */
  realTransform(out: NumericBuffer, input: ArrayLike<number>): void {
    this.engine.realTransform(out, input)
  }

  /** Forward FFT of interleaved complex `input` into interleaved `out`. */
  transform(out: NumericBuffer, input: ArrayLike<number>): void {
    this.engine.transform(out, input)
  }

  /** Inverse FFT of interleaved `input` into interleaved `out`, normalised by 1 / size. */
  inverseTransform(out: NumericBuffer, input: ArrayLike<number>): void {
    this.engine.inverseTransform(out, input)
  }

  /** Fill the negative-frequency half of an interleaved spectrum with the conjugate mirror. */
  completeSpectrum(spectrum: NumericBuffer): void {
    this.engine.completeSpectrum(spectrum)
  }
}

/** Options for `runFft`. */
export interface RunFftOptions {
  /** Samples per window; must equal `fft.size`. */
  readonly windowSize: number
  /** Samples between successive window starts (windowSize / 2 gives 50% overlap). */
  readonly windowSpacing: number
  /** Window function of length `windowSize`, e.g. `hanning(windowSize)`. */
  readonly window: ArrayLike<number>
  /** Engine sized to `windowSize`. */
  readonly fft: RealFft
  /** Also record the peak |windowed sample| of each window (upstream `take_max`). */
  readonly takeMax?: boolean
}

/** `runFft` options that request per-window peaks. */
export type RunFftOptionsWithMax = RunFftOptions & { readonly takeMax: true }

/** Result of `runFft`: one half-spectrum per window for every key. */
export interface RunFftResult<K extends string> {
  /** Centre of each window as a fractional sample index (start + windowSize / 2). */
  readonly center: Float64Array
  /** Per key: one single-sided complex spectrum per window, with 1/N (2/N for inner bins) scaling applied. */
  readonly spectra: Readonly<Record<K, ComplexArray[]>>
  /** Per key: peak absolute windowed sample of each window; present only when `takeMax` is set. */
  readonly max?: Readonly<Record<K, Float64Array>>
}

/** `runFft` result when `takeMax: true` was passed: `max` is guaranteed. */
export type RunFftResultWithMax<K extends string> = RunFftResult<K> & { readonly max: Readonly<Record<K, Float64Array>> }

/** Build a record with one entry per key. The single assertion here is sound: every key is set. */
function recordOf<K extends string, V>(keys: readonly K[], make: (key: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((k) => [k, make(k)])) as Record<K, V>
}

/**
 * Windowed batch FFT over the arrays `data[key]` for each key, in steps of `windowSpacing`.
 * Spectra are single-sided and amplitude-normalised (DC and Nyquist by 1/N, other bins by 2/N);
 * window gain correction (`windowCorrectionFactors`) is left to the caller, as upstream.
 * Missing keys throw. The window count is max(0, floor((n - windowSize) / windowSpacing) + 1).
 * Upstream omits the max(0, ...) and throws a RangeError (`new Array(num_windows)`) when the data is
 * shorter than one window by more than one spacing; that is a proven upstream bug, fixed here
 * (docs/bug-proofs/signal.md, row 2): such data gives zero windows, as slightly longer data does.
 */
export function runFft<K extends string>(
  data: Readonly<Record<K, ArrayLike<number>>>,
  keys: readonly K[],
  options: RunFftOptionsWithMax
): RunFftResultWithMax<K>
export function runFft<K extends string>(
  data: Readonly<Record<K, ArrayLike<number>>>,
  keys: readonly K[],
  options: RunFftOptions
): RunFftResult<K>
export function runFft<K extends string>(
  data: Readonly<Record<K, ArrayLike<number>>>,
  keys: readonly K[],
  options: RunFftOptions
): RunFftResult<K> {
  const { windowSize, windowSpacing, window, fft } = options
  const takeMax = options.takeMax === true
  if (fft.size !== windowSize) {
    throw new RangeError(`runFft: fft.size (${fft.size}) must equal windowSize (${windowSize})`)
  }
  for (const key of keys) {
    if (!(key in data)) throw new TypeError(`runFft: key "${key}" is not present in data`)
  }

  const firstKey = keys[0]
  const numPoints = firstKey === undefined ? 0 : data[firstKey].length
  const realLen = realLength(windowSize)
  // Proven upstream bug fixed (docs/bug-proofs/signal.md, row 2): upstream's count goes negative for
  // data shorter than windowSize - windowSpacing and its allocation throws; a count is never negative.
  const numWindows = Math.max(0, Math.floor((numPoints - windowSize) / windowSpacing) + 1)

  const center = new Float64Array(numWindows)
  const spectra = recordOf(keys, () => new Array<ComplexArray>(numWindows))
  const max = recordOf(keys, () => new Float64Array(takeMax ? numWindows : 0))

  // Double the positive spectrum to account for the discarded negative half, except at
  // DC and Nyquist, and normalise everything by the window size.
  const endScale = 1 / windowSize
  const midScale = 2 / windowSize
  const scale = new Float64Array(realLen)
  scale[0] = endScale
  for (let j = 1; j < realLen - 1; j++) scale[j] = midScale
  scale[realLen - 1] = endScale

  const result = fft.createComplexArray()
  for (let i = 0; i < numWindows; i++) {
    const windowStart = i * windowSpacing
    const windowEnd = windowStart + windowSize
    center[i] = windowStart + windowSize * 0.5

    for (const key of keys) {
      const windowed = arrayMul(sliceArrayLike(data[key], windowStart, windowEnd), window)

      if (takeMax) max[key][i] = maxOf(arrayAbs(windowed))

      fft.realTransform(result, windowed)

      const spectrum = complexArrayOf(realLen)
      for (let j = 0; j < realLen; j++) {
        const index = j * 2
        spectrum.re[j] = result[index]! * scale[j]!
        spectrum.im[j] = result[index + 1]! * scale[j]!
      }
      spectra[key][i] = spectrum
    }
  }

  return takeMax ? { center, spectra, max } : { center, spectra }
}

/**
 * Expand a scaled single-sided spectrum (as produced by `runFft`) back to the full
 * double-sided spectrum of (realLength - 1) * 2 bins, halving the doubled inner bins.
 */
export function toDoubleSided(x: ComplexArrayLike): ComplexArray {
  const realLen = x.re.length
  const fullLen = (realLen - 1) * 2
  const out = complexArrayOf(fullLen)

  out.re[0] = x.re[0]!
  out.im[0] = x.im[0]!

  out.re[realLen - 1] = x.re[realLen - 1]!
  out.im[realLen - 1] = x.im[realLen - 1]!

  for (let i = 1; i < realLen - 1; i++) {
    out.re[i] = x.re[i]! * 0.5
    out.im[i] = x.im[i]! * 0.5

    const rhs = fullLen - i
    out.re[rhs] = x.re[i]! * 0.5
    out.im[rhs] = x.im[i]! * -0.5
  }
  return out
}

/** Write a complex vector into an interleaved fft.js buffer `target` (upstream `to_fft_format`). */
export function toInterleaved(target: NumericBuffer, source: ComplexArrayLike): void {
  const len = source.re.length
  for (let i = 0; i < len; i++) {
    const index = i * 2
    target[index] = source.re[i]!
    target[index + 1] = source.im[i]!
  }
}

/** Read the first `length` complex values (default: all) out of an interleaved fft.js buffer. */
export function fromInterleaved(source: ArrayLike<number>, length = source.length >>> 1): ComplexArray {
  const out = complexArrayOf(length)
  for (let i = 0; i < length; i++) {
    const index = i * 2
    out.re[i] = source[index]!
    out.im[i] = source[index + 1]!
  }
  return out
}

function sliceArrayLike(a: ArrayLike<number>, start: number, end: number): ArrayLike<number> {
  if (a instanceof Float64Array || Array.isArray(a)) return a.slice(start, end) as ArrayLike<number>
  return Array.prototype.slice.call(a, start, end) as number[]
}

function maxOf(a: ArrayLike<number>): number {
  // Equivalent to Math.max(...a) without spreading very large windows onto the stack.
  let m = -Infinity
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (Number.isNaN(v)) return NaN
    if (v > m) m = v
  }
  return m
}
