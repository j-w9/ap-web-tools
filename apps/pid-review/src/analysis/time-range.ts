/**
 * Index bounds used when averaging windows inside the user's analysis time range.
 * Faithful to upstream `find_start_index`/`find_end_index`: the start is the last
 * sample strictly before `start` (so the range is bracketed), the end is exclusive.
 */
export function timeRangeIndices(time: ArrayLike<number>, start: number, end: number): [number, number] {
  let startIndex = 0
  for (let j = 0; j < time.length; j++) {
    if ((time[j] as number) < start) startIndex = j
  }
  let endIndex = 0
  for (let j = 0; j < time.length - 1; j++) {
    if ((time[j] as number) <= end) endIndex = j + 1
  }
  return [startIndex, endIndex + 1]
}
