import { describe, expect, it } from 'vitest'
import { baseLog } from '../test-utils/synthetic.js'
import { interestingParamChanges, isChangedFromDefault, parseParamFile, readLogParams } from './params.js'

describe('parseParamFile', () => {
  it('reads every line with two fields, junk included, as upstream load_param_file, but skips # comment lines', () => {
    const text = '# comment line\nA,1\r\nB 2.5\nC\t-3\nD=4\n  E  5\nF\n\nG,abc\nH,1e3,extra\n7,1\n'
    expect([...parseParamFile(text).values]).toEqual([
      ['7', 1],
      ['A', 1],
      ['B', 2.5],
      ['C', -3],
      ['D', 4],
      ['', NaN],
      ['G', NaN],
      ['H', 1000]
    ])
  })

  it('keeps the last value for repeated names', () => {
    expect(parseParamFile('A,1\nA,2\n').values.get('A')).toBe(2)
  })
})

describe('readLogParams', () => {
  it('tracks values, defaults and changes', () => {
    const log = baseLog()
      .write('PARM', [1_000_000, 'A', 1, 1])
      .write('PARM', [1_000_000, 'B', 5, NaN])
      .write('PARM', [2_000_000, 'A', 1, 1])
      .write('PARM', [3_000_000, 'A', 2, 1])
      .write('PARM', [4_000_000, 'STAT_RUNTIME', 1, 0])
      .write('PARM', [5_000_000, 'STAT_RUNTIME', 2, 0])
      .parse()
    const p = readLogParams(log)
    expect([...(p?.values ?? [])]).toEqual([
      ['A', 2],
      ['B', 5],
      ['STAT_RUNTIME', 2]
    ])
    expect([...(p?.defaults ?? [])]).toEqual([
      ['A', 1],
      ['STAT_RUNTIME', 0]
    ])
    expect(p?.changes).toEqual([
      {
        name: 'A',
        changes: [
          { time: 2, value: 1 },
          { time: 3, value: 2 }
        ]
      },
      {
        name: 'STAT_RUNTIME',
        changes: [
          { time: 4, value: 1 },
          { time: 5, value: 2 }
        ]
      }
    ])
    expect(interestingParamChanges(p?.changes ?? []).map((c) => c.name)).toEqual(['A'])
    expect(isChangedFromDefault('A', 2, p?.defaults ?? new Map())).toBe(true)
    expect(isChangedFromDefault('B', 5, p?.defaults ?? new Map())).toBe(true)
    expect(isChangedFromDefault('STAT_RUNTIME', 0, p?.defaults ?? new Map())).toBe(false)
  })

  it('returns undefined without PARM', () => {
    expect(readLogParams(baseLog().write('MSG', [1, 'x']).parse())).toBeUndefined()
  })
})
