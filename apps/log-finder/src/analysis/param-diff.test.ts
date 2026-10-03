import { describe, expect, it } from 'vitest'
import { ALL_PARAM_IGNORE_KEYS, isIgnoredChange, paramDiff, paramDiffCount } from './param-diff.js'
import { paramFileName } from './param-format.js'

describe('paramDiff', () => {
  const prev = new Map([
    ['A', 1],
    ['B', 2],
    ['STAT_RUNTIME', 10],
    ['GONE', 5]
  ])
  const next = new Map([
    ['A', 1],
    ['B', 3],
    ['STAT_RUNTIME', 20],
    ['NEW', 7]
  ])

  it('reports added, missing and changed parameters', () => {
    const d = paramDiff(next, prev, new Set())
    expect([...d.added]).toEqual([['NEW', 7]])
    expect([...d.missing]).toEqual([['GONE', 5]])
    expect([...d.changed]).toEqual([
      ['B', { from: 2, to: 3 }],
      ['STAT_RUNTIME', { from: 10, to: 20 }]
    ])
    expect(paramDiffCount(d)).toBe(4)
  })

  it('drops ignored value changes but never additions or removals', () => {
    const d = paramDiff(next, prev, new Set(ALL_PARAM_IGNORE_KEYS))
    expect([...d.changed.keys()]).toEqual(['B'])
    expect(paramDiffCount(paramDiff(new Map([['STAT_X', 1]]), new Map(), new Set(['stats'])))).toBe(1)
  })

  it('matches each ignore rule', () => {
    expect(isIgnoredChange('SYS_NUM_RESETS', new Set(['stats']))).toBe(true)
    expect(isIgnoredChange('INS_GYROFFS_X', new Set(['gyroOffsets']))).toBe(true)
    expect(isIgnoredChange('INS_GYROFFS_X', new Set(['stats']))).toBe(false)
    expect(isIgnoredChange('SR0_EXTRA1', new Set(['streamRates']))).toBe(true)
    expect(isIgnoredChange('COMPASS_DEC', new Set(['compassDec']))).toBe(true)
  })
})

describe('paramFileName', () => {
  it('names the file after the log', () => {
    expect(paramFileName('logs/00000012.BIN')).toBe('00000012.param')
    expect(paramFileName('C:\\x\\a.b.bin')).toBe('a.b.param')
    expect(paramFileName('noext')).toBe('noext.param')
    expect(paramFileName('.bin')).toBe('.bin.param')
  })
})
