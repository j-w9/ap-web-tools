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

function expectSameFiles(log: DataflashLog, up: UpstreamParser): void {
  const theirs = Object.entries(upstreamFiles(up)).map(([name, data]) => [name, Array.from(data)])
  const mine = [...log.files()].map(([name, data]) => [name, Array.from(data)])
  expect(mine).toEqual(theirs)
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
        expect(field.unit, `${name}.${field.name} unit`).toBe(complex.units)
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
  it('appends file chunks in log order, ignoring Offset and Length, and drops trailing NULs', async () => {
    const w = baseWriter()
    w.write('FILE', ['@SYS/a.txt', 0, 6, 'first '])
    w.write('FILE', ['crash_dump.bin', 0, 4, 'a\u0000b\u0000'])
    w.write('FILE', ['@SYS/a.txt', 6, 4, 'copy'])
    w.write('FILE', ['@SYS/a.txt', 0, 6, 'second'])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    expectSameFiles(log, await upstreamParse(bytes))
    expect(Array.from(log.files().get('crash_dump.bin') ?? [])).toEqual([0x61, 0, 0x62])
  })

  it('stops reading FMTU at a record for an undefined type', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 99, '-#', '--'])
    w.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 4; i++) w.write('IMU', [i, i % 2, 20 + i])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    const up = await upstreamParse(bytes)
    expectSameTypes(log, up)
    expectSameStats(log, up)
    expect(log.instances('IMU')).toEqual([])
  })

  it('splits instances and applies the built-in units when FMTU is valid', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 6; i++) w.write('IMU', [i, (i * 7) % 3, 20 + i])
    const bytes = w.toBytes()
    const log = DataflashLog.parse(bytes)
    expectSameTypes(log, await upstreamParse(bytes))
    expect(log.messageType('IMU')?.fields[0]?.unit).toBe('ns')
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
