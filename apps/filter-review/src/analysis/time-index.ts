/** A user-selected analysis window in seconds (upstream `TimeStart` / `TimeEnd` inputs). */
export interface TimeRange {
  readonly start: number
  readonly end: number
}

/**
 * Index of the last sample strictly before `startTime`, or 0 when there is none.
 * Port of upstream `find_start_index`.
 */
export function findStartIndex(time: ArrayLike<number>, startTime: number): number {
  let startIndex = 0
  for (let j = 0; j < time.length; j++) {
    if (time[j]! < startTime) startIndex = j
  }
  return startIndex
}

/**
 * One past the last sample at or before `endTime`, capped at `time.length - 1`.
 * Port of upstream `find_end_index` (callers add 1 where upstream does).
 */
export function findEndIndex(time: ArrayLike<number>, endTime: number): number {
  let endIndex = 0
  for (let j = 0; j < time.length - 1; j++) {
    if (time[j]! <= endTime) endIndex = j + 1
  }
  return endIndex
}
