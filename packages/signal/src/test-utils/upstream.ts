// Test-only: loads the vendored upstream JS (Array_Math.js + fft.js) into a vm context so the
// TypeScript port can be compared against it on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import FFT from 'fft.js'

type Pair = [number[], number[]]

export interface Upstream {
  complex_mul(a: Pair, b: Pair): Pair
  complex_div(a: Pair, b: Pair): Pair
  complex_abs(a: Pair): number[]
  complex_inverse(a: Pair): Pair
  complex_square(a: Pair): Pair
  complex_phase(a: Pair): number[]
  complex_conj(a: Pair): Pair
  exp_jw(freq: number[], rate: number): Pair
  array_max(a: number[], b: number[]): number[]
  array_min(a: number[], b: number[]): number[]
  array_scale(a: number[], s: number): number[]
  array_inverse(a: number[]): number[]
  array_mul(a: number[], b: number[]): number[]
  array_div(a: number[], b: number[]): number[]
  array_offset(a: number[], o: number): number[]
  array_add(a: number[], b: number[]): number[]
  array_sub(a: number[], b: number[]): number[]
  array_log10(a: number[]): number[]
  array_all_equal(a: number[], v: number): boolean
  array_all_NaN(a: number[]): boolean
  array_abs(a: number[]): number[]
  array_sqrt(a: number[]): number[]
  array_sum(a: number[]): number
  array_mean(a: number[]): number
  array_from_range(start: number, end: number, step: number): number[]
  linear_interp(values: number[], index: number[], query: number[]): number[]
  hanning(len: number): number[]
  window_correction_factors(w: number[]): { linear: number; energy: number }
  real_length(len: number): number
  rfft_freq(len: number, d: number): number[]
  run_fft(
    data: Record<string, number[]>,
    keys: string[],
    windowSize: number,
    windowSpacing: number,
    window: number[],
    fft: FFT,
    takeMax?: boolean
  ): { center: number[] } & Record<string, Pair[] | number[]>
  to_double_sided(x: Pair): Pair
  to_fft_format(target: number[], source: Pair): void
  fft_amplitude_scale(
    useDb: boolean,
    usePsd: boolean
  ): {
    fun(x: number[]): number[]
    scale(x: number[]): number[]
    label: string
    hover(axis: string): string
    window_correction(c: { linear: number; energy: number }, resolution: number): number
    quantization_correction(wc: number): number
  }
  fft_frequency_scale(
    useRpm: boolean,
    log: boolean
  ): {
    fun(x: number[]): number[]
    label: string
    hover(axis: string): string
    type: string
  }
}

const names = [
  'complex_mul',
  'complex_div',
  'complex_abs',
  'complex_inverse',
  'complex_square',
  'complex_phase',
  'complex_conj',
  'exp_jw',
  'array_max',
  'array_min',
  'array_scale',
  'array_inverse',
  'array_mul',
  'array_div',
  'array_offset',
  'array_add',
  'array_sub',
  'array_log10',
  'array_all_equal',
  'array_all_NaN',
  'array_abs',
  'array_sqrt',
  'array_sum',
  'array_mean',
  'array_from_range',
  'linear_interp',
  'hanning',
  'window_correction_factors',
  'real_length',
  'rfft_freq',
  'run_fft',
  'to_double_sided',
  'to_fft_format',
  'fft_amplitude_scale',
  'fft_frequency_scale'
]

let cached: Upstream | undefined

/** Load (once) the upstream helpers from upstream/Libraries into an isolated vm context. */
export function loadUpstream(): Upstream {
  if (cached !== undefined) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  const libDir = resolve(here, '../../../../upstream/Libraries')
  const source =
    readFileSync(resolve(libDir, 'Array_Math.js'), 'utf8') +
    '\n' +
    readFileSync(resolve(libDir, 'fft.js'), 'utf8') +
    `\n;({ ${names.join(', ')} })`
  const context = createContext({ FFTJS: FFT })
  cached = runInContext(source, context, { filename: 'upstream-libraries.js' }) as Upstream
  return cached
}

/** Upstream FFT engine instance (the raw fft.js object upstream passes to run_fft). */
export function upstreamFft(size: number): FFT {
  return new FFT(size)
}

/** Deterministic PRNG (mulberry32) so random oracle comparisons are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Array of `n` uniform random numbers in [lo, hi). */
export function randomArray(next: () => number, n: number, lo = -10, hi = 10): number[] {
  return Array.from({ length: n }, () => lo + (hi - lo) * next())
}

/** Upstream `[re[], im[]]` pair from a `{re, im}` complex array. */
export function toPair(c: { re: ArrayLike<number>; im: ArrayLike<number> }): Pair {
  return [Array.from(c.re), Array.from(c.im)]
}

/** `{re, im}` complex array from an upstream pair. */
export function fromPair(p: Pair): { re: number[]; im: number[] } {
  return { re: p[0], im: p[1] }
}
