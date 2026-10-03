import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { LogWriter } from '@apwt/dataflash/testing'
import { Duration } from 'luxon'
import { defaultOffsetS, flightTimeText, logDateText, logDurationText, summariseLog } from './log-info.js'
import { scanRecordOffsets, timestampBounds } from './log-scan.js'
import { parseUpstream, readFixture, toArrayBuffer, upstreamLogFunctions } from '../test-utils/upstream.js'

/** A small log: FMT, PARM with STAT_FLTTIME changes, and ATT/GPS records out of time order by file position. */
function syntheticLog(opts: { flightTimes?: number[]; withParm?: boolean } = {}): ArrayBuffer {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  if (opts.withParm !== false) w.defineFormat(0x84, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x88, 'ATT', 'Qcc', 'TimeUS,Roll,Pitch')
  w.defineFormat(0x89, 'CTUN', 'Qf', 'TimeUS,ThO')
  w.write('ATT', [5_000_000, 1, 2])
  for (const [i, t] of (opts.flightTimes ?? []).entries()) w.write('PARM', [6_000_000 + i, 'STAT_FLTTIME', t, 0, 0])
  w.write('CTUN', [4_000_000, 0.5]) // earlier timestamp, later in the file
  w.write('ATT', [9_000_000, 3, 4])
  w.write('CTUN', [12_500_000, 0.6])
  w.write('ATT', [11_000_000, 5, 6]) // last record in the file, not the latest time
  return toArrayBuffer(w.toBytes())
}

describe('log facts match upstream VideoOverlay', () => {
  const cases: [string, () => ArrayBuffer][] = [
    ['copter-sitl.bin', () => readFixture('copter-sitl.bin')],
    ['copter-files.bin', () => readFixture('copter-files.bin')],
    ['synthetic, flight time changes', () => syntheticLog({ flightTimes: [100, 160, 3725] })],
    ['synthetic, flight time unchanged', () => syntheticLog({ flightTimes: [42, 42] })],
    ['synthetic, no STAT_FLTTIME', () => syntheticLog()],
    ['synthetic, no PARM', () => syntheticLog({ withParm: false })]
  ]

  it.each(cases)('%s', async (_name, make) => {
    const buffer = make()
    const up = upstreamLogFunctions(await parseUpstream(buffer.slice(0)))
    const log = DataflashLog.parse(buffer)
    const bounds = timestampBounds(buffer)

    expect(flightTimeText(log)).toBe(up.getFlightTime())
    const upDuration = up.getLogDurationUS()
    if (_name.endsWith('.bin')) expect(upDuration).toBeGreaterThan(0)
    expect(bounds === undefined ? undefined : bounds.lastTimeUs - bounds.firstTimeUs).toBe(upDuration)
    expect(defaultOffsetS(bounds)).toBe(up.defaultOffset())
  })
})

describe('file-position semantics (upstream picks records by position, not by value)', () => {
  it('uses the first record of each type and the last record of each type', () => {
    const buffer = syntheticLog()
    // First records: ATT 5 s (offset earlier) and CTUN 4 s; the earliest *position* is ATT.
    // Last records: CTUN 12.5 s and ATT 11 s; the latest *position* is ATT.
    expect(timestampBounds(buffer)).toEqual({ firstTimeUs: 5_000_000, lastTimeUs: 11_000_000 })
    expect(defaultOffsetS(timestampBounds(buffer))).toBe(-5)
  })

  it('returns no bounds and a zero offset without timestamps', () => {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x85, 'MSG', 'Z', 'Message')
    w.write('MSG', ['hello'])
    const buffer = toArrayBuffer(w.toBytes())
    expect(timestampBounds(buffer)).toBeUndefined()
    expect(defaultOffsetS(undefined)).toBe(0)
    expect(logDurationText(undefined)).toBeUndefined()
  })

  it('drops a final record that runs past the end of the buffer', () => {
    const bytes = new Uint8Array(syntheticLog())
    const truncated = toArrayBuffer(bytes.slice(0, bytes.length - 2))
    const att = [...scanRecordOffsets(truncated).values()].find((f) => f.name === 'ATT')
    expect(att?.offsets.length).toBe(2)
    expect(timestampBounds(truncated)?.lastTimeUs).toBe(12_500_000)
  })
})

describe('formatting', () => {
  it('formats durations like luxon toHuman, rounded to whole seconds', () => {
    expect(logDurationText({ firstTimeUs: 0, lastTimeUs: 3_725_400_000 })).toBe(
      Duration.fromMillis(3725 * 1000)
        .rescale()
        .toHuman({ listStyle: 'narrow', unitDisplay: 'short' })
    )
    expect(logDurationText({ firstTimeUs: 1_000_000, lastTimeUs: 62_600_000 })).toBe('1 min, 2 sec')
  })

  it('formats the start date and reproduces "Invalid DateTime" without GPS time', () => {
    expect(logDateText(new Date(2024, 2, 15, 22, 32, 11))).toBe('15/03/2024 10:32:11 PM')
    expect(logDateText(undefined)).toBe('Invalid DateTime')
  })

  it('summarises a log', () => {
    const buffer = syntheticLog({ flightTimes: [0, 90] })
    const summary = summariseLog(DataflashLog.parse(buffer), buffer)
    expect(summary).toEqual({ date: 'Invalid DateTime', flightTime: '1 min, 30 sec', duration: '6 sec', defaultOffsetS: -5 })
  })
})
