// Analysis window selection, ported from upstream MAGFit/magfit.js (`find_start_index`,
// `find_end_index`). Upstream reads the times from the TimeStart/TimeEnd inputs.

/** Last index whose time is before `startTime`, or 0 (upstream `find_start_index`). */
export function findStartIndex(time: ArrayLike<number>, startTime: number): number {
  let startIndex = 0
  for (let j = 0; j < time.length; j++) {
    if (time[j]! < startTime) startIndex = j
  }
  return startIndex
}

/** One past the last index (excluding the final sample) at or before `endTime` (upstream `find_end_index`). */
export function findEndIndex(time: ArrayLike<number>, endTime: number): number {
  let endIndex = 0
  for (let j = 0; j < time.length - 1; j++) {
    if (time[j]! <= endTime) endIndex = j + 1
  }
  return endIndex
}

/** Half-open sample range `[start, end)` used for fitting. */
export interface SampleRange {
  readonly start: number
  readonly end: number
}

/**
 * Sample range for an analysis window, exactly as upstream `check_orientation` and `fit`
 * compute it: `[find_start_index, find_end_index + 1)`.
 */
export function analysisRange(time: ArrayLike<number>, startTime: number, endTime: number): SampleRange {
  return { start: findStartIndex(time, startTime), end: findEndIndex(time, endTime) + 1 }
}
