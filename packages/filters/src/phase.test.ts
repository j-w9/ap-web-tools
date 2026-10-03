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
    // Upstream returns [undefined] (it assigns element 0 of an empty array); both plot nothing.
    expect(loadUpstream('FilterTool').run('unwrap([])')).toEqual([undefined])
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

  /** Upstream `phase_scale` with "wrap" selected, on copies of `arrays` aliased as `layout` says. */
  function upstreamWrap(arrays: number[][], layout: number[]): number[][] {
    const up = loadUpstream('FilterReview')
    up.set('document', { getElementById: () => ({ checked: true }) })
    up.set(
      '__arrays',
      arrays.map((a) => a.slice())
    )
    up.set('__layout', layout)
    return up.run('phase_scale(__layout.map((k) => __arrays[k]))') as number[][]
  }

  it('matches upstream phase_scale on unwrapped responses', () => {
    const next = rng(11)
    // Unwrapped phases that drift through several turns, as get_phase produces.
    const drift = (): number[] => {
      let v = 0
      return Array.from({ length: 400 }, () => (v += next() * 40 - 25))
    }
    const arrays = [drift(), drift(), drift()]
    const before = arrays.map((a) => a.slice())
    const mine = wrapPhase(arrays)
    const theirs = upstreamWrap(arrays, [0, 1, 2])
    mine.forEach((m, k) => expectBitEqual(m, theirs[k]!, `phase ${k}`))
    // Something was wrapped, and the inputs are not mutated.
    expect(Array.from(mine[0]!)).not.toEqual(before[0])
    expect(arrays).toEqual(before)
  })

  it('shifts an array passed twice twice, as upstream does when max and min are the same array', () => {
    const next = rng(12)
    let v = 0
    const mean = Array.from({ length: 200 }, () => (v += next() * 30 - 12))
    const shared = mean.map((x) => x + 5)
    const mine = wrapPhase([mean, shared, shared])
    const theirs = upstreamWrap([mean, shared], [0, 1, 1])
    expect(mine[1]).toBe(mine[2])
    mine.forEach((m, k) => expectBitEqual(m, theirs[k]!, `phase ${k}`))
    // The shared array ends up shifted by twice the mean's shift.
    const i = mean.findIndex((x) => x > 540)
    expect(mine[1]![i]! - shared[i]!).toBe(2 * (mine[0]![i]! - mean[i]!))
  })
})
