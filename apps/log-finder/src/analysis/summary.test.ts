import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { distanceTravelled, flightPath, logWarnings, warningLevel } from './summary.js'
import { readFixture } from './test-utils/upstream.js'
import { makeSummary } from './test-utils/summary.js'

describe('distanceTravelled', () => {
  it('is zero for one point and sums straight segments', () => {
    expect(distanceTravelled([0], [0], [0])).toBe(0)
    // 1e-5 degrees of latitude is about 1.113 m; plus a 2 m climb.
    const d = distanceTravelled([0, 100, 100], [0, 0, 0], [0, 0, 2])
    expect(d).toBeCloseTo(100 * 0.011131884502145034 + 2, 9)
  })

  it('wraps longitude across the antimeridian', () => {
    const near = distanceTravelled([0, 0], [1799999900, -1799999900], [0, 0])
    expect(near).toBeCloseTo(200 * 0.011131884502145034, 9)
  })
})

describe('flightPath', () => {
  it('starts at the origin and has one point per POS record', () => {
    const log = DataflashLog.parse(readFixture('copter-sitl.bin'))
    const path = flightPath(log)
    expect(path).toBeDefined()
    expect(path?.northM[0]).toBe(0)
    expect(path?.eastM.length).toBe(log.count('POS'))
    expect(flightPath(DataflashLog.parse(readFixture('copter-files.bin')))).toBeUndefined()
  })
})

describe('logWarnings', () => {
  it('flags nothing for a healthy log', () => {
    const w = logWarnings(makeSummary({ params: new Map([['ARMING_CHECK', 1]]) }))
    expect(w).toEqual([])
    expect(warningLevel(w)).toBe('none')
  })

  it('treats disabled arming checks as a caution', () => {
    for (const params of [new Map([['ARMING_CHECK', 0]]), new Map([['ARMING_SKIPCHK', 3]])]) {
      const w = logWarnings(makeSummary({ params }))
      expect(w.map((x) => x.kind)).toEqual(['arming-checks-disabled'])
      expect(warningLevel(w)).toBe('caution')
    }
    expect(logWarnings(makeSummary({ params: new Map([['ARMING_SKIPCHK', 0]]) }))).toEqual([])
  })

  it('lists crash dump, watchdog and arming in upstream order as an error', () => {
    const w = logWarnings(makeSummary({ crashDump: true, watchdog: true, params: new Map([['ARMING_CHECK', 0]]) }))
    expect(w.map((x) => x.kind)).toEqual(['crash-dump', 'watchdog', 'arming-checks-disabled'])
    expect(warningLevel(w)).toBe('error')
  })
})
