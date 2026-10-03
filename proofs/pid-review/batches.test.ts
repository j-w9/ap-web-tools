// PID Review `split_into_batches`: batch sample rate and batch end.
import { describe, expect, it } from 'vitest'
import { loadPidReview } from './_harness'

interface Batch {
  param_set: number
  sample_rate: number
  batch_start: number
  batch_end: number
}

/** Upstream `split_into_batches` on one message whose single parameter set covers everything. */
function split(time: number[], setStart = 0): Batch[] {
  const page = loadPidReview()
  page.set('__msgs', [{ params: { sets: [{ start_time: setStart, end_time: 1e9 }] } }])
  page.set('__time', time)
  return page.run('split_into_batches(__msgs, 0, __time)') as Batch[]
}

/** `n` samples at exactly 400 Hz from `t0`. */
const uniform = (n: number, t0 = 0): number[] => Array.from({ length: n }, (_, i) => t0 + i / 400)

describe('split_into_batches sample rate', () => {
  it('reports 402.02 Hz for 200 samples at exactly 400 Hz', () => {
    const [batch, ...rest] = split(uniform(200))
    expect(rest).toHaveLength(0)
    expect(batch).toBeDefined()
    // 1 / ((time[198] - time[0]) / 199) = 199 * 400 / 198
    expect(batch?.sample_rate).toBeCloseTo((199 * 400) / 198, 9)
    expect(batch?.sample_rate).toBeCloseTo(402.0202, 4)
  })

  it('reports 323.23 Hz when the parameter set starts at 0.1 s', () => {
    const [batch] = split(uniform(200), 0.1)
    // Samples 1..39 (before 0.1 s) are not counted but stay in the span: 1 / ((198 / 400) / 160)
    expect(batch?.batch_start).toBe(0)
    expect(batch?.sample_rate).toBeCloseTo((160 * 400) / 198, 9)
  })
})

describe('split_into_batches batch end', () => {
  it('leaves the last sample before a gap, and the last two of the log, out of every batch', () => {
    // Samples 0..99 at 400 Hz, a 1 s gap, then samples 100..199 at 400 Hz.
    const time = [...uniform(100), ...uniform(100, 1 + 99 / 400)]
    const batches = split(time)
    expect(batches.map((b) => [b.batch_start, b.batch_end])).toEqual([
      [0, 99],
      [100, 198]
    ])
    // load() slices every field with slice(batch_start, batch_end) (PIDReview.js:1597-1614).
    const covered = new Set(batches.flatMap((b) => time.slice(b.batch_start, b.batch_end).map((_, k) => b.batch_start + k)))
    const missing = time.map((_, i) => i).filter((i) => !covered.has(i))
    expect(missing).toEqual([99, 198, 199])
    // The rate of the first batch spans to time[99] and counts 100 samples, i.e. sample 99 is in it.
    expect(batches[0]?.sample_rate).toBeCloseTo(1 / (time[99]! / 100), 9)
  })
})
