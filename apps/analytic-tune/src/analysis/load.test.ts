import { describe, expect, it } from 'vitest'
import { LogWriter } from '@apwt/dataflash/testing'
import { identifyResponses, WindowSizeError } from './freq-resp.js'
import { TuneLogError, loadTuneLog } from './load.js'
import { loadTimeHistory, nearestIndex } from './time-history.js'
import { buildSidLog } from './test-utils/synthetic.js'
import { loadAnalyticTuneUpstream } from './test-utils/upstream.js'

describe('loadTuneLog', () => {
  it('rejects logs without parameters or SID data', () => {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x81, 'MSG', 'QZ', 'TimeUS,Message')
    w.write('MSG', [1, 'ArduCopter V4.6.0'])
    expect(() => loadTuneLog(w.toBytes())).toThrow(TuneLogError)
    expect(() => loadTuneLog(w.toBytes())).toThrow(/no parameters/)

    w.defineFormat(0x82, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
    w.write('PARM', [2, 'SCHED_LOOP_RATE', 400, 400, 0])
    expect(() => loadTuneLog(w.toBytes())).toThrow(/system identification/)
  })

  it('reads runs, vehicle and inputs; a missing INS_GYRO_RATE gives a 1 kHz gyro, as upstream', () => {
    const loaded = loadTuneLog(
      buildSidLog({
        vehicle: 'copter',
        params: { ATC_RAT_PIT_D: 0.005, SCHED_LOOP_RATE: 0 },
        runs: [{ axis: 8, start: 2, length: 6 }]
      })
    )
    expect(loaded.vehicle).toBe('copter')
    expect(loaded.runs).toEqual([{ axis: 8, startTime: expect.closeTo(2, 2) as number, endTime: expect.closeTo(8, 2) as number }])
    expect(loaded.inputs.get('ATC_RAT_PIT_D')).toBe(Math.fround(0.005))
    expect(loaded.inputs.get('GyroSampleRate')).toBe(1000)
    expect(loaded.inputs.has('SCHED_LOOP_RATE')).toBe(false)
    expect(loaded.attitudeMessage).toBe('ATT')
    expect(loaded.firmware).toBe('ArduCopter V4.6.3 (abcdef12)')
  })
})

describe('analysis window', () => {
  const loaded = loadTuneLog(
    buildSidLog({ vehicle: 'copter', params: { SCHED_LOOP_RATE: 400 }, runs: [{ axis: 7, start: 2, length: 4 }] })
  )
  const target = { vehicle: 'copter', axis: 'Roll' } as const

  it('needs a power-of-two window that fits', () => {
    const history = loadTimeHistory(loaded.log, 'ATT', target, 2, 6)
    expect(() => identifyResponses(history, 'Roll', 1000)).toThrow(WindowSizeError)
    expect(() => identifyResponses(history, 'Roll', 4096)).toThrow(/shorter than one FFT window/)
    expect(identifyResponses(history, 'Roll', 256).windowCount).toBeGreaterThan(5)
  })

  it('finds the nearest sample as upstream does', () => {
    const up = loadAnalyticTuneUpstream()
    const values = [5, 1, 3, 3, 9, -2]
    for (const target of [0, 2, 3, 4, 100, -5]) expect(nearestIndex(values, target)).toBe(up.nearestIndex(values, target))
    expect(nearestIndex([], 1)).toBeNull()
  })
})
