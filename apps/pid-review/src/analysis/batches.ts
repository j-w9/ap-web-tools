import type { ParamSet } from './param-sets.js'

/** A run of contiguous samples with a steady rate, within one parameter set. */
export interface Batch {
  paramSet: number
  /** Hz, estimated from the batch's own timestamps. */
  sampleRate: number
  /** Inclusive start index into the message's samples. */
  start: number
  /** Inclusive end index. */
  end: number
}

/** Minimum samples for a batch to be worth analysing. */
export const MIN_BATCH_SAMPLES = 64

/**
 * Split a message's time series into batches: a new batch starts at any gap in the
 * data (a sample interval more than five times the running average, i.e. roughly two
 * missed messages) and at every parameter-set boundary. Batches shorter than
 * `MIN_BATCH_SAMPLES` are dropped. Times are in seconds.
 */
export function splitIntoBatches(time: ArrayLike<number>, paramSets: readonly ParamSet[]): Batch[] {
  const batches: Batch[] = []
  const len = time.length
  if (len === 0 || paramSets.length === 0) return batches

  let batchStart = 0
  let count = 0
  let setIndex = 0
  let setStart = paramSets[0]!.startTime
  let setEnd = paramSets[0]!.endTime

  for (let j = 1; j < len; j++) {
    const t = time[j] as number
    if (t < setStart) continue
    count++
    const prev = time[j - 1] as number
    const pastSetEnd = t > setEnd
    const gap = (t - prev) * count > (t - (time[batchStart] as number)) * 5
    if (gap || j === len - 1 || pastSetEnd) {
      if (count >= MIN_BATCH_SAMPLES) {
        // Intervals in the batch, not samples (upstream divides by the sample count, a
        // small bias at short batches).
        const intervals = j - 1 - batchStart
        const sampleRate = intervals / (prev - (time[batchStart] as number))
        batches.push({ paramSet: setIndex, sampleRate, start: batchStart, end: j - 1 })
      }
      if (pastSetEnd) {
        setIndex++
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

/** Overall time span covered by a time series. */
export function timeSpan(time: ArrayLike<number>): { start: number; end: number } {
  return { start: time[0] as number, end: time[time.length - 1] as number }
}
