import type { ParamSet } from './param-sets.js'

/** A run of contiguous samples with a steady rate, within one parameter set. */
export interface Batch {
  paramSet: number
  /** Hz, estimated from the batch's own timestamps (upstream formula, see `splitIntoBatches`). */
  sampleRate: number
  /** Inclusive start index into the message's samples. */
  start: number
  /**
   * Exclusive end index: the batch's samples are `[start, end)`. Upstream records
   * `batch_end = j - 1` and then reads `slice(batch_start, batch_end)`, so the last sample
   * before the split point is not part of the batch.
   */
  end: number
}

/** Minimum samples for a batch to be worth analysing. */
export const MIN_BATCH_SAMPLES = 64

/**
 * Split a message's time series into batches (upstream `split_into_batches`): a new batch
 * starts at any gap in the data (a sample interval more than five times the running average,
 * i.e. roughly two missed messages), at the last sample and at every parameter-set boundary.
 * Batches with fewer than `MIN_BATCH_SAMPLES` counted samples are dropped. Times are in seconds.
 *
 * Reproduced upstream quirks (see docs/audit/pid-review.md):
 * - the sample rate is `1 / ((time[j-1] - time[start]) / count)`, dividing the span of
 *   `j-1-start` intervals by the `count` of samples counted since the batch started;
 * - samples before the current set's start are skipped without being counted, but the
 *   batch start index is not moved past them;
 * - the batch read back is `[start, j-1)`, one sample shorter than the span measured.
 */
export function splitIntoBatches(time: ArrayLike<number>, paramSets: readonly ParamSet[]): Batch[] {
  const batches: Batch[] = []
  const len = time.length
  const first = paramSets[0]
  if (len === 0 || !first) return batches

  let batchStart = 0
  let count = 0
  let setIndex = 0
  let setStart = first.startTime
  let setEnd = first.endTime

  for (let j = 1; j < len; j++) {
    const t = time[j]!
    if (t < setStart) continue
    count++
    const pastSetEnd = t > setEnd
    const gap = (t - time[j - 1]!) * count > (t - time[batchStart]!) * 5
    if (gap || j === len - 1 || pastSetEnd) {
      if (count >= MIN_BATCH_SAMPLES) {
        const sampleRate = 1 / ((time[j - 1]! - time[batchStart]!) / count)
        batches.push({ paramSet: setIndex, sampleRate, start: batchStart, end: j - 1 })
      }
      if (pastSetEnd) {
        setIndex++
        // Every set but the last ends at a finite time, the last at Infinity, so a next set
        // always exists here (upstream reads it unguarded).
        const next = paramSets[setIndex]
        if (!next) break
        setStart = next.startTime
        setEnd = next.endTime
      }
      batchStart = j
      count = 0
    }
  }
  return batches
}
