import { describe, expect, it } from 'vitest'
import { US_TO_S, timeUsToSeconds } from './time.js'

describe('time', () => {
  it('uses the same double as the 1e-6 literal', () => {
    expect(US_TO_S).toBe(1e-6)
  })

  it('converts microseconds to seconds', () => {
    expect(Array.from(timeUsToSeconds([0, 1_500_000, 2_000_000]))).toEqual([0, 1.5, 2])
  })
})
