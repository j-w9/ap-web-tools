/**
 * Rate binning: split event times into fixed-width bins and sum a weight (1 per message, or
 * the message size in bits) per bin, normalised to a rate per second.
 *
 * Port of upstream `bin_time`, `bin_count` and `total_count` (`StreamStats/StreamStats.js`),
 * kept step for step so that every window size, including ones upstream mishandles, gives the
 * same result:
 *
 * - The total is accumulated in a sparse array indexed by bin number. A negative window gives
 *   negative bin numbers, which a JavaScript array stores as plain properties: they are left out
 *   of the total (and the total is empty if no bin is `0`). See `docs/audit/stream-stats.md`.
 * - A window of `0` or `NaN` (an empty input) makes the bin range `NaN` or infinite, and
 *   `new Array(length)` throws a `RangeError` (upstream crashes the same way).
 */

/** A rate over time: one point per bin, at the bin centre. */
export interface RateSeries {
  /** Bin centre, seconds. */
  readonly time: readonly number[]
  /** Rate in weight units per second (messages/s or bits/s). */
  readonly rate: readonly number[]
}

/** Per-event weight: the same for every event, or one value per event. */
export type BinWeight = number | ArrayLike<number>

/** Running total over every series binned so far (upstream's `total` object). */
export interface RateTotal {
  /** Sparse: weight sum per bin number. Negative bin numbers become plain properties, as upstream. */
  readonly count: number[]
  lowBin: number
  highBin: number
}

export function emptyTotal(): RateTotal {
  return { count: [], lowBin: Infinity, highBin: -Infinity }
}

/**
 * Upstream `array_from_range(start, end, 1)`: accumulates `start + 1 + 1 ...`.
 *
 * @throws {RangeError} when the range length is not a valid array length (NaN, infinite or negative).
 */
function rangeFrom(start: number, end: number): number[] {
  const len = Math.floor(end - start) + 1
  const out = new Array<number>(len)
  let value = start
  for (let i = 0; i < len; i++) {
    out[i] = value
    value += 1
  }
  return out
}

/** Bin centres for bins `lowBin..highBin` (upstream `bin_time`: range, then scale, then offset). */
export function binCentres(lowBin: number, highBin: number, width: number): number[] {
  const half = width * 0.5
  return rangeFrom(lowBin, highBin).map((bin) => bin * width + half)
}

/**
 * Rate of one series (upstream `bin_count`), also adding its weights to `total`.
 *
 * @throws {RangeError} for an empty series or a window of 0 or NaN.
 */
export function binCount(time: ArrayLike<number>, weight: BinWeight, width: number, total: RateTotal): RateSeries {
  const len = time.length
  const bins = new Array<number>(len)
  for (let i = 0; i < len; i++) bins[i] = Math.floor(time[i]! / width)

  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < len; i++) {
    low = Math.min(low, bins[i]!)
    high = Math.max(high, bins[i]!)
  }
  total.lowBin = Math.min(total.lowBin, low)
  total.highBin = Math.max(total.highBin, high)

  const centres = binCentres(low, high, width)

  const count = new Array<number>(centres.length).fill(0)
  for (let i = 0; i < len; i++) {
    const bin = bins[i]!
    const size = typeof weight === 'number' ? weight : weight[i]!
    count[bin - low] = (count[bin - low] ?? 0) + size
    total.count[bin] = (total.count[bin] ?? 0) + size
  }

  // Upstream `array_scale(count, 1 / bin_width)`: multiply by the reciprocal.
  const scale = 1 / width
  return { time: centres, rate: count.map((c) => c * scale) }
}

/** Rate of the total (upstream `total_count`), or `null` when nothing was binned at a bin number >= 0. */
export function totalCount(total: RateTotal, width: number): RateSeries | null {
  if (total.count.length === 0) return null
  const time = binCentres(total.lowBin, total.highBin, width)
  const count = total.count.slice(total.lowBin, total.highBin + 1)
  // Upstream divides here, where `bin_count` multiplies by the reciprocal.
  const rate: number[] = []
  for (let i = 0; i < count.length; i++) rate.push((count[i] ?? 0) / width)
  return { time, rate }
}
