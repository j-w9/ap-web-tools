/** Frequency grids and the delay operators every transfer function is evaluated on. */
import { arrayFromRange, complexArrayOf, complexInverse, complexSquare, expJw, type ComplexArray } from '@apwt/signal'

/** z, z^-1 and z^-2 evaluated on a frequency grid at one sample rate. */
export interface ZGrid {
  readonly z: ComplexArray
  readonly z1: ComplexArray
  readonly z2: ComplexArray
}

/** z = e^jw for each frequency (Hz) at `sampleRate` (Hz), with its inverse powers, computed as upstream. */
export function zGrid(freq: ArrayLike<number>, sampleRate: number): ZGrid {
  const z = expJw(freq, sampleRate)
  return { z, z1: complexInverse(z), z2: complexInverse(complexSquare(z)) }
}

/** Frequencies `step, 2 step, ...` up to `max` (Hz), accumulated as upstream `array_from_range` does. */
export function frequencyGrid(maxHz: number, stepHz: number): Float64Array {
  return arrayFromRange(stepHz, maxHz, stepHz)
}

/** H = 1 at every frequency: the response of a disabled filter. */
export function unityResponse(length: number): ComplexArray {
  const h = complexArrayOf(length)
  h.re.fill(1)
  return h
}
