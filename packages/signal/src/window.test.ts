import { describe, expect, it } from 'vitest'
import { hanning, windowCorrectionFactors } from './window.js'
import { loadUpstream } from './test-utils/upstream.js'

const up = loadUpstream()

describe('hanning', () => {
  it('is zero at the ends and one in the middle for odd lengths', () => {
    const w = hanning(5)
    const expected = [0, 0.5, 1, 0.5, 0]
    expect(w.length).toBe(5)
    for (let i = 0; i < 5; i++) expect(w[i]).toBeCloseTo(expected[i]!, 15)
  })

  it('is symmetric', () => {
    const w = hanning(64)
    for (let i = 0; i < 32; i++) expect(w[i]).toBeCloseTo(w[63 - i]!, 15)
  })

  it('matches upstream bit-for-bit', () => {
    for (const len of [2, 7, 8, 64, 1024]) {
      expect(Array.from(hanning(len))).toEqual(up.hanning(len))
    }
  })
})

describe('windowCorrectionFactors', () => {
  it('is 1 / 1 for a rectangular window', () => {
    expect(windowCorrectionFactors([1, 1, 1, 1])).toEqual({ linear: 1, energy: 1 })
  })

  it('is roughly 2 (linear) and sqrt(8/3) (energy) for a long Hann window', () => {
    const c = windowCorrectionFactors(hanning(4096))
    expect(c.linear).toBeCloseTo(2, 2)
    expect(c.energy).toBeCloseTo(Math.sqrt(8 / 3), 2)
  })

  it('matches upstream bit-for-bit', () => {
    for (const len of [8, 256, 1024]) {
      const w = up.hanning(len)
      expect(windowCorrectionFactors(w)).toEqual(up.window_correction_factors(w))
    }
  })
})
