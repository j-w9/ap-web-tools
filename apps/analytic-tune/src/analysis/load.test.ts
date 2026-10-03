import { describe, expect, it } from 'vitest'
import { LogWriter } from '@apwt/dataflash/testing'
import { identifyResponses, windowSizeFromText, WindowSizeError } from './freq-resp.js'
import { TuneLogError, loadTuneLog } from './load.js'
import { loadTimeHistory, nearestIndex } from './time-history.js'
import { buildSidLog } from './test-utils/synthetic.js'
import { loadAnalyticTuneUpstream } from './test-utils/upstream.js'

describe('loadTuneLog', () => {
  it('rejects logs without parameters with upstream message, and loads logs without SID data', () => {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x81, 'MSG', 'QZ', 'TimeUS,Message')
    w.write('MSG', [1, 'ArduCopter V4.6.0'])
    expect(() => loadTuneLog(w.toBytes())).toThrow(TuneLogError)
    expect(() => loadTuneLog(w.toBytes())).toThrow('No params in log')

    w.defineFormat(0x82, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
    w.write('PARM', [2, 'SCHED_LOOP_RATE', 300, 400, 0])
    const loaded = loadTuneLog(w.toBytes())
    expect(loaded.runs).toEqual([])
    expect(loaded.inputs.get('SCHED_LOOP_RATE')).toBe(300)
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
    expect(() => identifyResponses(history, 'Roll', 16384)).toThrow(/shorter than one FFT window/)
    expect(identifyResponses(history, 'Roll', 256).windowCount).toBeGreaterThan(5)
  })

  // The input is a number input, so its text is always valid floating-point text or empty.
  it.each(['1024', '256', '1024.9', '300', '', '0', '-4', '1', '2', '512.0', '4e3', '1e3'])(
    'reads window size text %j as upstream calculate_freq_resp does',
    (text) => {
      const up = loadAnalyticTuneUpstream()
      up.setForm('FFTWindow_size', text)
      // Without a log upstream gets past the window size checks and fails reading the log.
      let upstreamError = ''
      try {
        up.calculate()
      } catch (e) {
        upstreamError = e instanceof Error ? e.message : String(e)
      }
      let mine: number | string
      try {
        mine = windowSizeFromText(text)
      } catch (e) {
        mine = e instanceof Error ? e.message : String(e)
      }
      if (upstreamError.startsWith('upstream alert: ')) expect(mine).toBe(upstreamError.slice('upstream alert: '.length))
      else if (upstreamError.startsWith('FFT size')) expect(mine).toBe(upstreamError)
      else {
        expect(upstreamError).toMatch(/Cannot read properties of undefined/)
        expect(mine).toBe(parseInt(text))
      }
    }
  )

  it('finds the nearest sample as upstream does', () => {
    const up = loadAnalyticTuneUpstream()
    const values = [5, 1, 3, 3, 9, -2]
    for (const target of [0, 2, 3, 4, 100, -5]) expect(nearestIndex(values, target)).toBe(up.nearestIndex(values, target))
    expect(nearestIndex([], 1)).toBeNull()
  })
})
