// Minimal typings for https://github.com/indutny/fft.js (ships no types).
// Only the surface used by `RealFft` is declared; keep this in sync with ./fft.ts.
declare module 'fft.js' {
  /** Any indexable numeric buffer: plain arrays and typed arrays both qualify. */
  type NumericBuffer = { [index: number]: number; readonly length: number }

  export default class FFT {
    constructor(size: number)
    readonly size: number
    /** New zero-filled interleaved buffer of length 2 * size. */
    createComplexArray(): number[]
    toComplexArray(input: ArrayLike<number>, storage?: NumericBuffer): NumericBuffer
    fromComplexArray(complex: ArrayLike<number>, storage?: NumericBuffer): NumericBuffer
    /** Mirror the positive half of an interleaved spectrum into the negative half (conjugate). */
    completeSpectrum(spectrum: NumericBuffer): void
    transform(out: NumericBuffer, data: ArrayLike<number>): void
    realTransform(out: NumericBuffer, data: ArrayLike<number>): void
    inverseTransform(out: NumericBuffer, data: ArrayLike<number>): void
  }
}
