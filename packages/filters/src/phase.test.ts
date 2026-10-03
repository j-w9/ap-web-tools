import { describe, expect, it } from 'vitest'
import { phaseDegrees, unwrapPhase, unwrapPhaseInclusive, wrapPhase } from './index.js'
import { expectBitEqual } from './test-utils/compare.js'
import { rng } from './test-utils/random.js'
import { loadUpstream } from './test-utils/upstream.js'

/** Random phases plus jumps landing exactly on the thresholds, where the two unwraps differ. */
function phases(seed: number): number[] {
  const next = rng(seed)
  const out = Array.from({ length: 300 }, () => next() * 360 - 180)
  out.push(0, 315, 0, -45, 0)
  return out
}

describe('unwrapPhase', () => {
  it.each(['FilterTool', 'AnalyticTune'] as const)('matches upstream %s unwrap', (tool) => {
    const up = loadUpstream(tool)
    const phase = phases(3)
    up.set('__phase', phase)
    expectBitEqual(unwrapPhase(phase), up.run('unwrap(__phase)') as number[], 'unwrap')
  })

  it('biases toward positive jumps from notches', () => {
    expect(Array.from(unwrapPhase([0, -60, -50, 270]))).toEqual([0, 300, 310, 270])
  })

  it('handles an empty array', () => {
    expect(unwrapPhase([]).length).toBe(0)
    expect(unwrapPhaseInclusive([]).length).toBe(0)
  })
})

describe('unwrapPhaseInclusive', () => {
  it('matches upstream FilterReview get_phase', () => {
    const up = loadUpstream('FilterReview')
    const next = rng(5)
    const h = { re: Array.from({ length: 300 }, () => next() - 0.5), im: Array.from({ length: 300 }, () => next() - 0.5) }
    up.set('__h', [h.re, h.im])
    expectBitEqual(unwrapPhaseInclusive(phaseDegrees(h)), up.run('get_phase(__h)') as number[], 'get_phase')
  })

  it('treats jumps exactly at the thresholds as wraps, unlike unwrapPhase', () => {
    expect(Array.from(unwrapPhaseInclusive([0, 315, 0, -45]))).toEqual([0, -45, 0, 315])
    expect(Array.from(unwrapPhase([0, 315, 0, -45]))).toEqual([0, 315, 360, 315])
  })
})

describe('wrapPhase', () => {
  it('wraps every array by the shift that wraps the first', () => {
    const [a, b] = wrapPhase([
      [0, 200, -190, 600],
      [1, 2, 3, 4]
    ])
    expect(Array.from(a!)).toEqual([0, -160, 170, -120])
    expect(Array.from(b!)).toEqual([1, -358, 363, -716])
    expect(wrapPhase([])).toEqual([])
  })
})
