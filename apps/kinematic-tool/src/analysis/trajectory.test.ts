import { describe, expect, it } from 'vitest'
import { differentiateAccel, runUntilSettled } from './trajectory.js'

describe('runUntilSettled', () => {
  it('runs 0.5 s past settling, or to the end time if later', () => {
    const settled = (i: number) => i >= 10
    const short = runUntilSettled({ dt: 0.1, endTime: 0.2, maxTime: 20, step: () => undefined, settled })
    expect(short[short.length - 1]).toBeCloseTo(1.6)
    const long = runUntilSettled({ dt: 0.1, endTime: 3, maxTime: 20, step: () => undefined, settled })
    expect(long[long.length - 1]).toBeCloseTo(3.1)
  })

  it('stops at the maximum time when it never settles', () => {
    const time = runUntilSettled({ dt: 0.5, endTime: 1, maxTime: 2, step: () => undefined, settled: () => false })
    expect(Array.from(time)).toEqual([0, 0.5, 1, 1.5, 2])
  })
})

describe('differentiateAccel', () => {
  it('differences acceleration half a step later', () => {
    const jerk = differentiateAccel(Float64Array.from([0, 1, 2]), [0, 2, 6], 1)
    expect(Array.from(jerk.time)).toEqual([0.5, 1.5])
    expect(Array.from(jerk.jerk)).toEqual([2, 4])
  })
})
