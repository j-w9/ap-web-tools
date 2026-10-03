/**
 * Rate binning: split event times into fixed-width bins and sum a weight (1 per message, or
 * the message size in bits) per bin, normalised to a rate per second.
 *
 * Port of upstream `bin_time`, `bin_count` and `total_count` (`StreamStats/StreamStats.js`).
 * Upstream accumulates the total in a sparse array inside `bin_count`; here each series' bin
 * sums are kept and the total is the bin-wise sum of those. With integer weights the result
 * is identical.
 */

/** Unnormalised bin sums of one series. Bin `i` covers `[(lowBin + i) * width, (lowBin + i + 1) * width)`. */
export interface BinSums {
  readonly lowBin: number
  readonly sums: Float64Array
}

/** A rate over time: one point per bin, at the bin centre. */
export interface RateSeries {
  /** Bin centre, seconds. */
  readonly time: Float64Array
  /** Rate in weight units per second (messages/s or bits/s). */
  readonly rate: Float64Array
}

/** Per-event weight: the same for every event, or one value per event. */
export type BinWeight = number | ArrayLike<number>

/** Bin centres for bins `lowBin..lowBin + count - 1` (upstream `bin_time`). */
export function binCentres(lowBin: number, count: number, width: number): Float64Array {
  const out = new Float64Array(count)
  const half = width * 0.5
  for (let i = 0; i < count; i++) out[i] = (lowBin + i) * width + half
  return out
}

/** Sum `weight` per bin of `width` seconds. Returns `null` for an empty series. */
export function binSums(time: ArrayLike<number>, weight: BinWeight, width: number): BinSums | null {
  const len = time.length
  if (len === 0) return null
  const bins = new Float64Array(len)
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < len; i++) {
    const bin = Math.floor(time[i]! / width)
    bins[i] = bin
    low = Math.min(low, bin)
    high = Math.max(high, bin)
  }
  const sums = new Float64Array(high - low + 1)
  for (let i = 0; i < len; i++) {
    sums[bins[i]! - low]! += typeof weight === 'number' ? weight : weight[i]!
  }
  return { lowBin: low, sums }
}

/**
 * Rate of one series. Upstream scales a single series by `1 / width` but divides the total by
 * `width`; the two are kept apart so results match to the last bit.
 */
export function seriesRate(binned: BinSums, width: number): RateSeries {
  const scale = 1 / width
  return {
    time: binCentres(binned.lowBin, binned.sums.length, width),
    rate: binned.sums.map((s) => s * scale)
  }
}

/** Bin-wise sum of several series, covering every bin from the lowest to the highest. */
export function sumBins(series: readonly BinSums[]): BinSums | null {
  if (series.length === 0) return null
  let low = Infinity
  let high = -Infinity
  for (const s of series) {
    low = Math.min(low, s.lowBin)
    high = Math.max(high, s.lowBin + s.sums.length - 1)
  }
  const sums = new Float64Array(high - low + 1)
  for (const s of series) {
    const at = s.lowBin - low
    for (let i = 0; i < s.sums.length; i++) sums[at + i]! += s.sums[i]!
  }
  return { lowBin: low, sums }
}

/** Rate of the total of several series (upstream `total_count`). */
export function totalRate(series: readonly BinSums[], width: number): RateSeries | null {
  const total = sumBins(series)
  if (total === null) return null
  return {
    time: binCentres(total.lowBin, total.sums.length, width),
    rate: total.sums.map((s) => s / width)
  }
}
