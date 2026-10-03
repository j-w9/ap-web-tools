import { describe, expect, it } from 'vitest'
import { splitParamSets } from './param-sets.js'

function parm(rows: Array<[string, number, number]>) {
  return {
    names: rows.map((r) => r[0]),
    timeUs: rows.map((r) => r[1] * 1e6),
    values: rows.map((r) => r[2])
  }
}

describe('splitParamSets', () => {
  it('returns null when no prefix matches', () => {
    expect(splitParamSets(parm([['FOO_P', 0, 1]]), ['ATC_RAT_RLL_'])).toBeNull()
  })

  it('uses the first prefix with any matching parameter', () => {
    const r = splitParamSets(parm([['Q_A_RAT_RLL_P', 0, 0.1]]), ['RLL_RATE_', 'Q_A_RAT_RLL_'])
    expect(r?.prefix).toBe('Q_A_RAT_RLL_')
    expect(r?.sets).toHaveLength(1)
    expect(r?.sets[0]?.values.KP).toBe(0.1)
    expect(r?.sets[0]?.endTime).toBe(Infinity)
  })

  it('splits at a parameter change after a second of stability', () => {
    const r = splitParamSets(
      parm([
        ['ATC_RAT_RLL_P', 1, 0.1],
        ['ATC_RAT_RLL_I', 1, 0.05],
        ['ATC_RAT_RLL_P', 20, 0.2]
      ]),
      ['ATC_RAT_RLL_']
    )
    expect(r?.sets.map((s) => [s.startTime, s.endTime, s.values.KP, s.values.KI])).toEqual([
      [0, 20, 0.1, 0.05],
      [20, Infinity, 0.2, 0.05]
    ])
  })

  it('merges changes made within a second into one new set', () => {
    const r = splitParamSets(
      parm([
        ['ATC_RAT_RLL_P', 1, 0.1],
        ['ATC_RAT_RLL_D', 1, 0.004],
        ['ATC_RAT_RLL_P', 20, 0.2],
        ['ATC_RAT_RLL_D', 20.5, 0.005]
      ]),
      ['ATC_RAT_RLL_']
    )
    expect(r?.sets).toHaveLength(2)
    expect(r?.sets[1]).toMatchObject({ startTime: 20.5, values: { KP: 0.2, KD: 0.005 } })
  })

  it('ignores a re-write of the same value', () => {
    const r = splitParamSets(parm([['ATC_RAT_RLL_P', 1, 0.1], ['ATC_RAT_RLL_P', 30, 0.1]]), ['ATC_RAT_RLL_'])
    expect(r?.sets).toHaveLength(1)
  })
})
