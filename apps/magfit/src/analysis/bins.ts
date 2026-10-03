// Attitude binning used to weight samples so that over-represented orientations do not dominate
// the fit. Ported from upstream MAGFit/magfit.js (`calculate_bins`, `get_weights`).

import type { Vec3Series } from './vector.js'

/** Number of bins on the unit sphere (upstream `num_bins`). */
export const NUM_BINS = 80

/** Bin centres: a Fibonacci lattice of `numBins` points on the unit sphere. */
export function fibonacciLattice(numBins: number = NUM_BINS): Vec3Series {
  const x = new Float64Array(numBins)
  const y = new Float64Array(numBins)
  const z = new Float64Array(numBins)
  for (let i = 0; i < numBins; i++) {
    const k = i + 0.5
    const phi = Math.acos(1.0 - (2.0 * k) / numBins)
    const theta = Math.PI * (1 + Math.sqrt(5)) * k
    x[i] = Math.cos(theta) * Math.sin(phi)
    y[i] = Math.sin(theta) * Math.sin(phi)
    z[i] = Math.cos(phi)
  }
  return { x, y, z }
}

/**
 * Index of the closest lattice point to the direction of each expected body-frame field sample.
 * A zero-length sample matches no bin and gets -1 (upstream leaves it `undefined`).
 */
export function assignBins(expected: Vec3Series, numBins: number = NUM_BINS): Int32Array {
  const bins = fibonacciLattice(numBins)
  const len = expected.x.length
  const out = new Int32Array(len).fill(-1)
  for (let j = 0; j < len; j++) {
    // Convert to unit
    let x = expected.x[j]!
    let y = expected.y[j]!
    let z = expected.z[j]!
    const length = Math.sqrt(x ** 2 + y ** 2 + z ** 2)
    x /= length
    y /= length
    z /= length

    let minDist = Infinity
    for (let k = 0; k < numBins; k++) {
      const distSq = (x - bins.x[k]!) ** 2 + (y - bins.y[k]!) ** 2 + (z - bins.z[k]!) ** 2
      if (distSq < minDist) {
        minDist = distSq
        out[j] = k
      }
    }
  }
  return out
}

/** Per-sample weights and the fraction of bins visited. */
export interface BinWeights {
  /** Inverse bin population scaled so the mean weight over occupied bins is 1. */
  readonly weights: Float64Array
  /** Fraction of all bins with at least one sample, 0..1 (upstream coverage bar). */
  readonly coverage: number
}

/** Weights from bin assignments (upstream `get_weights`). */
export function binWeights(bins: ArrayLike<number>, numBins: number = NUM_BINS): BinWeights {
  const count = new Map<number, number>()
  const len = bins.length
  let numUniqueBins = 0
  let totalBins = 0
  for (let i = 0; i < len; i++) {
    const b = bins[i]!
    const c = count.get(b) ?? 0
    if (c === 0) numUniqueBins++
    count.set(b, c + 1)
    totalBins++
  }
  const meanBinSize = totalBins / numUniqueBins
  const coverage = numUniqueBins / numBins

  const weights = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    // Scale by mean_bin_size so that the average weight is 1
    weights[i] = meanBinSize / (count.get(bins[i]!) ?? NaN)
  }
  return { weights, coverage }
}
