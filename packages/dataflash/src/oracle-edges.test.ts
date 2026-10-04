/**
 * Oracle tests for the parser behaviours the tools depend on beyond plain column decoding:
 * `stats()`, embedded files, FMTU handling (units, multipliers, instances) and how the scan treats
 * formats it can not size. Each case runs the upstream JsDataflashParser on the same bytes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DataflashLog } from './log.js'
import { LogWriter } from './test-support/synthetic-log.js'
import { expectSameFiles, expectSameStats, expectSameTypes } from './test-support/oracle-compare.js'
import { quietly, upstreamParse } from './test-support/upstream-parser.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures')

describe.each(['copter-sitl.bin', 'copter-files.bin'])('oracle edges: %s', (file) => {
  const bytes = new Uint8Array(readFileSync(join(fixtures, file)))
  const log = DataflashLog.parse(bytes)

  it('matches stats (every defined type, in id order, zero counts included)', async () => {
    expectSameStats(log, await upstreamParse(bytes))
  })

  it('matches units, multipliers and instances', async () => {
    expectSameTypes(log, await upstreamParse(bytes))
  })

  it('matches the embedded files', async () => {
    expectSameFiles(log, await upstreamParse(bytes))
  })
})

function baseWriter(): LogWriter {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0xb1, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(30, 'IMU', 'QBf', 'TimeUS,I,T')
  w.defineFormat(31, 'EMPT', 'Qf', 'TimeUS,V')
  w.defineFormat(20, 'FILE', 'NIBZ', 'FileName,Offset,Length,Data')
  return w
}

function rawFmt(w: LogWriter, id: number, name: string, format: string, columns: string): void {
  w.raw([0xa3, 0x95, 0x80, ...LogWriter.encodeBody('BBnNZ', [id, 0, name, format, columns])])
}

describe('oracle edges: synthetic logs', () => {
  it('places file chunks at Offset with Length bytes, keeping the last copy (upstream appends them; proven bug)', async () => {
    const w = baseWriter()
    w.write('FILE', ['@SYS/a.txt', 0, 6, 'first '])
    w.write('FILE', ['crash_dump.bin', 0, 4, 'a\u0000b\u0000'])
    w.write('FILE', ['@SYS/a.txt', 6, 4, 'copy'])
    w.write('FILE', ['@SYS/a.txt', 0, 6, 'second'])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    const up = await upstreamParse(bytes)
    expectSameFiles(log, up)
    // Upstream: both copies appended, the crash dump's trailing zero dropped.
    expect(new TextDecoder().decode(up.files['@SYS/a.txt'])).toBe('first copysecond')
    expect(Array.from(up.files['crash_dump.bin'] ?? [])).toEqual([0x61, 0, 0x62])
    // Port: the second copy at Offset 0 replaces the first; all 4 bytes of the dump are kept.
    expect(new TextDecoder().decode(log.files().get('@SYS/a.txt'))).toBe('second')
    expect(Array.from(log.files().get('crash_dump.bin') ?? [])).toEqual([0x61, 0, 0x62, 0])
  })

  it('skips a FMTU record for an undefined type (upstream abandons every later FMTU; proven bug)', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 99, '-#', '--'])
    w.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 4; i++) w.write('IMU', [i, i % 2, 20 + i])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    const up = await upstreamParse(bytes)
    expectSameStats(log, up)
    // Upstream: the IMU FMTU after the bad record is never applied.
    expect(up.messageTypes['IMU']?.instances).toBeUndefined()
    expect(up.messageTypes['IMU']?.complexFields['TimeUS']).toEqual({ name: 'TimeUS', units: '?', multiplier: 1 })
    // Port: the bad record is skipped, so IMU gets the units and instances of the same log without it.
    expect(log.instances('IMU')).toEqual([0, 1])
    expect(log.messageType('IMU')?.fields[0]).toMatchObject({ unit: 'µs', multiplier: 1e-6 })
    const without = baseWriter()
    without.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 4; i++) without.write('IMU', [i, i % 2, 20 + i])
    const withoutBytes = without.toBytes()
    expectSameTypes(DataflashLog.parse(withoutBytes), await upstreamParse(withoutBytes))
    expect(log.messageType('IMU')?.fields).toEqual(DataflashLog.parse(withoutBytes).messageType('IMU')?.fields)
  })

  it('splits instances and applies the built-in units when FMTU is valid', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 6; i++) w.write('IMU', [i, (i * 7) % 3, 20 + i])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    expectSameTypes(log, await upstreamParse(bytes))
    // Upstream labels TimeUS `ns`; the port `µs` (proven upstream bug, fixed).
    expect(log.messageType('IMU')?.fields[0]?.unit).toBe('µs')
  })

  it('ends the scan at the first record of a format with an unknown type code', async () => {
    const w = baseWriter()
    rawFmt(w, 40, 'BAD', 'Qx', 'TimeUS,X')
    w.write('IMU', [1, 0, 20])
    w.raw([0xa3, 0x95, 40, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    w.write('IMU', [2, 0, 21])
    w.write('IMU', [3, 0, 22])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    const up = await upstreamParse(bytes)
    expect(log.count('IMU')).toBe(1)
    expect(up.stats()['IMU']?.count).toBe(1)
  })

  it.each([
    [['ArduPlane V4.5.7 (2a3dc4b7)'], [0, 24, 25, 26]],
    [['ArduCopter V4.7.0 (af47743e)'], [0, 26, 27, 28, 29]],
    [
      ['Frame: QUAD', 'Rover V4.5 (12345678)'],
      [0, 8, 9, 16]
    ],
    [['AntennaTracker V4 (12345678)'], [0, 4, 10]],
    [['ArduSub V4 (12345678)'], [20, 21]],
    [['Blimp V4.6 (12345678)'], [0, 1, 5]],
    [['no banner'], [0, 27]]
  ])('names modes as getModeString does (MSG %j)', async (messages, modes) => {
    const w = baseWriter()
    w.defineFormat(32, 'MSG', 'QZ', 'TimeUS,Message')
    w.defineFormat(33, 'MODE', 'QMBB', 'TimeUS,Mode,ModeNum,Rsn')
    for (const m of messages) w.write('MSG', [1, m])
    for (const m of modes) w.write('MODE', [2, m, m, 1])
    const bytes = w.toBytes()
    const up = await upstreamParse(bytes)
    quietly(() => {
      up.parseAtOffset('MSG')
      up.parseAtOffset('MODE')
    })
    const log = DataflashLog.parse(bytes)
    expect(log.modes().map((m) => m.name)).toEqual(up.messages['MODE']?.['asText'])
    expect(modes.map((m) => log.modeName(m))).toEqual(up.messages['MODE']?.['asText'])
  })
})
