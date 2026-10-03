import { describe, expect, it } from 'vitest'
import { loadUpstream, rng, upstreamOutput } from './test-utils/upstream.js'
import {
  compareParamNames,
  compassParamNames,
  paramFileText,
  paramLine,
  paramNameVector3,
  paramToString,
  paramValue,
  parseParamFile
} from './params.js'

describe('paramToString (oracle: upstream Param_Helpers.js)', () => {
  const up = loadUpstream()

  it('matches on special values, integers and decimal-looking values', () => {
    const values = [
      0,
      -0,
      1,
      -1,
      0.1,
      0.2,
      0.3,
      1 / 3,
      2 / 3,
      0.135,
      0.15,
      1e-7,
      1e-10,
      3.4e38,
      -3.4e38,
      1.17549435e-38,
      1e-45,
      123456789,
      16777216,
      16777217,
      2 ** 31,
      4294967295,
      3408138,
      97539,
      0.0001,
      12.5,
      99.99,
      1013.25,
      115200,
      921600,
      Math.PI,
      Math.E,
      Infinity,
      -Infinity
    ]
    for (const v of values) expect(paramToString(v), String(v)).toBe(up.param_to_string(v))
  })

  it('matches on random floats across magnitudes', () => {
    const next = rng(7)
    for (let i = 0; i < 20000; i++) {
      const v = (next() - 0.5) * 10 ** Math.floor(next() * 24 - 12)
      expect(paramToString(v)).toBe(up.param_to_string(v))
    }
    for (let i = 0; i < 2000; i++) {
      const v = Math.round((next() - 0.5) * 2 ** 25)
      expect(paramToString(v)).toBe(up.param_to_string(v))
    }
  })

  it('throws like upstream on NaN', () => {
    expect(() => up.param_to_string(NaN)).toThrow()
    expect(() => paramToString(NaN)).toThrow('Could not convert NaN to float string')
  })

  it('writes the same param file text with natural ordering', () => {
    const params: Record<string, number> = {
      SERIAL10_BAUD: 57,
      SERIAL2_BAUD: 115,
      SERIAL1_BAUD: 57,
      ATC_RAT_RLL_P: 0.135,
      a_lower: 1,
      INS_GYR_ID: 3408138
    }
    const text = paramFileText(new Map(Object.entries(params)))
    expect(text).toBe(up.get_param_download_text(params))
    expect(text.split('\n').slice(0, 4)).toEqual(['a_lower,1', 'ATC_RAT_RLL_P,0.135', 'INS_GYR_ID,3408138', 'SERIAL1_BAUD,57'])
  })
})

describe('param name helpers (oracle)', () => {
  const up = loadUpstream()

  it('builds vector3 names', () => {
    expect([...paramNameVector3('INS_POS1_')]).toEqual([...up.get_param_name_vector3('INS_POS1_')])
  })

  it('builds compass names for every index', () => {
    for (const i of [1, 2, 3, 4]) {
      const ts = compassParamNames(i)
      const u = up.get_compass_param_names(i)
      expect({
        use: ts.use,
        offsets: [...ts.offsets],
        diagonals: [...ts.diagonals],
        off_diagonals: [...ts.offDiagonals],
        motor: [...ts.motor],
        scale: ts.scale,
        orientation: ts.orientation,
        external: ts.external,
        id: ts.id
      }).toEqual(JSON.parse(JSON.stringify(u)))
    }
  })
})

describe('paramValue', () => {
  const names = ['A', 'B', 'A', 'A']
  const values = [1, 5, 2, 3]
  it('returns the last value and reports changes', () => {
    expect(paramValue(names, values, 'A')).toEqual({ value: 3, changes: ['A changed from 1 to 2', 'A changed from 2 to 3'] })
  })
  it('keeps the first value when changes are not allowed', () => {
    expect(paramValue(names, values, 'A', false)).toEqual({ value: 1, changes: ['Ignoring param change A changed from 1 to 2'] })
  })
  it('returns undefined for a missing param', () => {
    expect(paramValue(names, values, 'C').value).toBeUndefined()
  })

  it('matches upstream get_param_value: value, console messages and the alert', () => {
    const up = loadUpstream()
    const cases: [string[], number[]][] = [
      [names, values],
      [
        ['X', 'X', 'Y', 'X'],
        [0.1, 0.1, 2, 0.30000001192092896]
      ],
      [['Z'], [NaN]],
      [
        ['Z', 'Z'],
        [NaN, NaN]
      ]
    ]
    for (const [n, v] of cases) {
      for (const name of new Set([...n, 'MISSING'])) {
        for (const allow of [undefined, true, false]) {
          upstreamOutput.log.length = 0
          upstreamOutput.alert.length = 0
          const theirs = up.get_param_value({ Name: n, Value: v }, name, allow)
          const mine = paramValue(n, v, name, allow)
          expect(mine.value).toEqual(theirs)
          expect(mine.changes).toEqual(upstreamOutput.log)
          // Upstream alerts exactly the last message when changes are not allowed.
          expect(allow === false ? mine.changes.slice(-1).filter((m) => m.startsWith('Ignoring')) : []).toEqual(
            upstreamOutput.alert
          )
        }
      }
    }
  })
})

describe('param file text', () => {
  it('sorts naturally and formats as float32', () => {
    const params = new Map([
      ['SERVO10_MIN', 1000],
      ['SERVO2_MIN', 0.1],
      ['ATC_RAT_RLL_P', 0.135]
    ])
    expect(paramFileText(params)).toBe('ATC_RAT_RLL_P,0.135\nSERVO2_MIN,0.1\nSERVO10_MIN,1000\n')
    expect(paramFileText(new Map())).toBe('')
    expect(['B10', 'B2', 'A'].sort(compareParamNames)).toEqual(['A', 'B2', 'B10'])
    expect(paramLine('X', -0.30000000000000027)).toBe('X,-0.3\n')
  })
})

describe('parseParamFile', () => {
  it('accepts comma, space, tab and = separators and skips comments', () => {
    const text = '# comment line\nA,1\r\nB 2.5\nC\t-3\nD=4\n  E  5\nF\n\nG,abc\nH,1e3,extra\n'
    const parsed = parseParamFile(text)
    expect([...parsed.values]).toEqual([
      ['A', 1],
      ['B', 2.5],
      ['C', -3],
      ['D', 4],
      ['E', 5],
      ['H', 1000]
    ])
    expect(parsed.entries.map((e) => [e.name, e.line])).toEqual([
      ['A', 2],
      ['B', 3],
      ['C', 4],
      ['D', 5],
      ['E', 6],
      ['H', 10]
    ])
    expect(parsed.skipped).toEqual([
      { reason: 'missing-value', line: 7, text: 'F', name: 'F' },
      { reason: 'not-a-number', line: 9, text: 'G,abc', name: 'G' }
    ])
  })

  it('keeps the last value for repeated names at the first position', () => {
    const parsed = parseParamFile('A,1\nB,3\nA,2\n')
    expect([...parsed.values]).toEqual([
      ['A', 2],
      ['B', 3]
    ])
    expect(parsed.entries).toHaveLength(3)
  })

  it('reports lines without a name and empty values', () => {
    expect(parseParamFile(',5\nX,\n  # indented comment\n').skipped).toEqual([
      { reason: 'missing-name', line: 1, text: ',5', name: '' },
      { reason: 'not-a-number', line: 2, text: 'X,', name: 'X' }
    ])
  })

  it('reads values the way parseFloat does', () => {
    expect([...parseParamFile('A,Infinity\nB,12abc\nC,-0\n').values]).toEqual([
      ['A', Infinity],
      ['B', 12],
      ['C', -0]
    ])
  })

  it('round-trips param file text', () => {
    const params = new Map([
      ['SERIAL1_BAUD', 57],
      ['ATC_RAT_RLL_P', 0.135],
      ['INS_GYR_ID', 3408138]
    ])
    const text = paramFileText(params)
    expect(paramFileText(parseParamFile(text).values)).toBe(text)
  })
})
