import { describe, expect, it } from 'vitest'
import { splitIntoBatches } from './batches.js'
import type { ParamSet } from './param-sets.js'
import { PID_PARAM_KEYS, type PidParamKey } from './vehicle.js'

const noValues = Object.fromEntries(PID_PARAM_KEYS.map((k) => [k, null])) as Record<PidParamKey, null>
const set = (startTime: number, endTime: number): ParamSet => ({ startTime, endTime, values: noValues })

const oneSet = [set(0, Infinity)]

function ramp(n: number, dt: number, t0 = 0): number[] {
  return Array.from({ length: n }, (_, i) => t0 + i * dt)
}

describe('splitIntoBatches', () => {
  it('returns one batch for steady data', () => {
    const b = splitIntoBatches(ramp(200, 0.0025), oneSet)
    expect(b).toHaveLength(1)
    // Samples [0, 199): the split point is the last sample, j = 199. Proven upstream bug fixed
    // (docs/bug-proofs/pid-review.md, row 2): upstream reads slice(batch_start, j - 1), [0, 198).
    expect(b[0]).toMatchObject({ paramSet: 0, start: 0, end: 199 })
    // 198 intervals over t[198] - t[0]. Proven upstream bug fixed (row 1): upstream divides by a
    // count of 199 samples, 1 / ((t[198] - t[0]) / 199) = 402.02 Hz.
    expect(b[0]?.sampleRate).toBe(198 / (198 * 0.0025))
    expect(b[0]?.sampleRate).toBeCloseTo(400, 9)
  })

  it('splits at a gap in the data', () => {
    const time = [...ramp(200, 0.0025), ...ramp(200, 0.0025, 5)]
    const b = splitIntoBatches(time, oneSet)
    // Upstream (row 2): [0, 199) and [200, 398), dropping sample 199 before the gap.
    expect(b.map((x) => [x.start, x.end])).toEqual([
      [0, 200],
      [200, 399]
    ])
  })

  it('drops batches shorter than 64 samples', () => {
    const time = [...ramp(30, 0.0025), ...ramp(200, 0.0025, 5)]
    expect(splitIntoBatches(time, oneSet)).toHaveLength(1)
  })

  it('splits at parameter set boundaries and tags the set', () => {
    const sets = [set(0, 0.25), set(0.25, Infinity)]
    const b = splitIntoBatches(ramp(400, 0.0025), sets)
    expect(b.map((x) => x.paramSet)).toEqual([0, 1])
  })

  it('skips samples before a set starts without counting them or moving the batch start', () => {
    const sets = [set(0.1, Infinity)]
    const b = splitIntoBatches(ramp(400, 0.0025), sets)
    expect(b).toHaveLength(1)
    expect(b[0]?.start).toBe(0)
    expect(b[0]?.end).toBe(399)
    // Samples 1..39 (before 0.1 s) are skipped, but the span still starts at sample 0. Upstream
    // (row 1) divides that span by the 360 samples counted, 1 / ((t[398] - t[0]) / 360) = 361.8 Hz;
    // the rate is the span's 398 intervals over its length.
    expect(b[0]?.sampleRate).toBe(398 / (398 * 0.0025 - 0))
  })
})
