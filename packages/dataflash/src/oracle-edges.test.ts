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
import { upstreamFiles, upstreamParse, type UpstreamParser } from './test-support/upstream-parser.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures')

function expectSameStats(log: DataflashLog, up: UpstreamParser): void {
  const theirs = Object.entries(up.stats()).map(([name, s]) => [name, s.count, s.msg_size, s.size])
  const mine = [...log.stats()].map(([name, s]) => [name, s.count, s.recordSize, s.bytes])
  expect(mine).toEqual(theirs)
}

/**
 * Embedded files. Where upstream's FILE records hold one copy per file and every chunk's `Data`
 * keeps all `Length` bytes, the port's files are upstream's bytes exactly. Otherwise (a file
 * written twice, or chunks ending in zero bytes) upstream's `processFiles()` is wrong (proven
 * upstream bug, docs/bug-proofs/js-dataflash-parser.md): the port's file is then upstream's own
 * decoded records placed at `Offset`, `Length` bytes each (the stripped bytes are the trailing
 * NULs), keeping the last copy.
 */
function expectSameFiles(log: DataflashLog, up: UpstreamParser): void {
  const theirs = upstreamFiles(up)
  const mine = log.files()
  expect([...mine.keys()]).toEqual(Object.keys(theirs))
  const file = up.messages['FILE'] as Record<string, ArrayLike<unknown>> | undefined
  for (const [name, data] of Object.entries(theirs)) {
    const records: { at: number; length: number; data: string }[] = []
    for (let i = 0; i < (file?.['FileName']?.length ?? 0); i++) {
      if (file?.['FileName']?.[i] !== name) continue
      records.push({ at: file['Offset']![i] as number, length: file['Length']![i] as number, data: file['Data']![i] as string })
    }
    const copies = records.filter((r) => r.at === 0).length
    const intact = records.every((r) => r.data.length === r.length)
    if (copies <= 1 && intact) {
      expect(Array.from(mine.get(name) ?? []), name).toEqual(Array.from(data))
      continue
    }
    const last = records.slice(records.map((r) => r.at).lastIndexOf(0))
    const expected = new Uint8Array(Math.max(...last.map((r) => r.at + r.length)))
    for (const r of last) {
      for (let j = 0; j < r.length; j++) expected[r.at + j] = j < r.data.length ? r.data.charCodeAt(j) : 0
    }
    expect(Array.from(mine.get(name) ?? []), name).toEqual(Array.from(expected))
    expect(Array.from(mine.get(name) ?? []), `${name} differs from upstream`).not.toEqual(Array.from(data))
  }
}

function expectSameTypes(log: DataflashLog, up: UpstreamParser): void {
  const names = Object.keys(up.messageTypes).filter((n) => !n.includes('['))
  expect([...log.messageTypes().keys()].sort()).toEqual([...names].sort())
  for (const name of names) {
    const theirs = up.messageTypes[name]!
    const info = log.messageType(name)!
    expect(info.count, name).toBe(log.count(name))
    const instances = theirs.instances === undefined ? [] : Object.keys(theirs.instances).map(Number)
    expect([...log.instances(name)], `${name} instances`).toEqual(instances)
    for (const field of info.fields) {
      const complex = theirs.complexFields[field.name]!
      // Upstream gives `undefined` for ids missing from its tables; the port gives '?' and 1.
      if (complex.multiplier !== undefined && !complex.units.includes('undefined')) {
        // Upstream labels 1e-6 with `n`; the port uses the SI prefix `µ` (proven upstream bug,
        // docs/bug-proofs/js-dataflash-parser.md). Every other label is identical.
        const units = complex.multiplier === 1e-6 && complex.units.startsWith('n') ? 'µ' + complex.units.slice(1) : complex.units
        expect(field.unit, `${name}.${field.name} unit`).toBe(units)
        expect(field.multiplier, `${name}.${field.name} multiplier`).toBe(complex.multiplier)
      }
    }
  }
}

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
})
