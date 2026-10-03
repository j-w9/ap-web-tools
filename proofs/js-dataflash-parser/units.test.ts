/**
 * Rows: "`multipliersTable` maps 1e-6 to `n`" and "FMTU for an undefined type aborts unit loading"
 * (`parser.js` `multipliersTable`, `populateUnits`).
 */
import { readFileSync } from 'node:fs'
import { LogWriter } from '@apwt/dataflash/testing'
import { describe, expect, it } from 'vitest'
import { fixturePath, upstreamParse } from './_harness.js'

function baseWriter(): LogWriter {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0xb1, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(30, 'IMU', 'QBf', 'TimeUS,I,T')
  return w
}

describe('JsDataflashParser multipliersTable', () => {
  it('labels a TimeUS field (unit s, multiplier F = 1e-6) as ns', async () => {
    const { parser } = await upstreamParse(new Uint8Array(readFileSync(fixturePath('copter-sitl.bin'))))
    const timeUs = parser.messageTypes['IMU']!.complexFields['TimeUS']!
    expect(timeUs).toEqual({ name: 'TimeUS', units: 'ns', multiplier: 0.000001 })
  })

  it('labels a 1e-3 multiplier with the SI prefix m (same table)', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 30, 's#O', 'C--'])
    w.write('IMU', [1, 0, 20])
    const { parser } = await upstreamParse(w.toBytes())
    expect(parser.messageTypes['IMU']!.complexFields['TimeUS']!.units).toBe('ms')
  })
})

describe('JsDataflashParser populateUnits', () => {
  it('throws at an FMTU for a type with no FMT and ignores every later FMTU', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 99, '-#', '--']) // type 99 has no FMT
    w.write('FMTU', [0, 30, 's#O', 'F--']) // valid units for IMU
    for (let i = 0; i < 4; i++) w.write('IMU', [i, i % 2, 20 + i])
    const { parser, logged } = await upstreamParse(w.toBytes())

    // The TypeError is thrown inside populateUnits and reported by processData's catch.
    expect(logged[0]).toEqual(['error populating units'])
    const error = logged[1]?.[0]
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message).toBe("Cannot set properties of undefined (setting 'units')")

    // The valid FMTU for IMU was never applied: no units, no instance split.
    const imu = parser.messageTypes['IMU']!
    expect(imu.complexFields['TimeUS']).toEqual({ name: 'TimeUS', units: '?', multiplier: 1 })
    expect(imu.instances).toBeUndefined()
  })

  it('applies the same FMTU when the bad record is absent', async () => {
    const w = baseWriter()
    w.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 4; i++) w.write('IMU', [i, i % 2, 20 + i])
    const { parser, logged } = await upstreamParse(w.toBytes())
    expect(logged.some((l) => l[0] === 'error populating units')).toBe(false)
    expect(parser.messageTypes['IMU']!.instances).toEqual({ 0: 'IMU[0]', 1: 'IMU[1]' })
  })
})
