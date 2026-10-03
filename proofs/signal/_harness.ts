// Loads the original Libraries/Array_Math.js and Libraries/fft.js into an isolated node:vm context
// (the pattern of packages/signal/src/test-utils/upstream.ts, copied so proofs do not depend on
// code being edited).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import FFT from 'fft.js'

type Pair = [number[], number[]]

export interface UpstreamSignal {
  array_from_range(start: number, end: number, step: number): number[]
  linear_interp(values: number[], index: number[], query: number[]): (number | undefined)[]
  hanning(len: number): number[]
  run_fft(
    data: Record<string, number[]>,
    keys: string[],
    windowSize: number,
    windowSpacing: number,
    window: number[],
    fft: FFT
  ): { center: number[] } & Record<string, Pair[] | number[]>
}

const here = dirname(fileURLToPath(import.meta.url))
const libDir = resolve(here, '../../upstream/Libraries')

/** A fresh copy of the original library functions. */
export function loadSignal(): UpstreamSignal {
  const source =
    readFileSync(resolve(libDir, 'Array_Math.js'), 'utf8') +
    '\n' +
    readFileSync(resolve(libDir, 'fft.js'), 'utf8') +
    '\n;({ array_from_range, linear_interp, hanning, run_fft })'
  return runInContext(source, createContext({ FFTJS: FFT }), { filename: 'upstream-signal.js' }) as UpstreamSignal
}
