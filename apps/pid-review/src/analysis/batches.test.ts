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
    expect(b[0]).toMatchObject({ paramSet: 0, start: 0, end: 198 })
    expect(b[0]?.sampleRate).toBeCloseTo(400, 0)
  })

  it('splits at a gap in the data', () => {
    const time = [...ramp(200, 0.0025), ...ramp(200, 0.0025, 5)]
    const b = splitIntoBatches(time, oneSet)
    expect(b.map((x) => [x.start, x.end])).toEqual([
      [0, 199],
      [200, 398]
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

  it('skips samples before the first set starts', () => {
    const sets = [set(0.1, Infinity)]
    const b = splitIntoBatches(ramp(400, 0.0025), sets)
    expect(b).toHaveLength(1)
    expect(b[0]?.start).toBe(0)
    expect(b[0]?.end).toBe(398)
  })
})
