import { describe, expect, it } from 'vitest'
import { DataflashLog } from './log.js'
import { buildSyntheticLog } from './test-support/synthetic-log.js'

describe('DataflashLog (synthetic log)', () => {
  const bytes = buildSyntheticLog()
  const log = DataflashLog.parse(bytes)

  it('indexes message types with counts', () => {
    const types = log.messageTypes()
    expect([...types.keys()].sort()).toEqual(
      ['ATT', 'FMT', 'FMTU', 'GPS', 'IMU', 'MODE', 'MSG', 'MULT', 'PARM', 'TYP1', 'TYP2', 'UNIT'].sort()
    )
    expect(log.has('EMPT')).toBe(false) // defined but never logged
    expect(log.count('IMU')).toBe(100)
    expect(log.count('ATT')).toBe(25)
    expect(log.has('ATT', 'Roll')).toBe(true)
    expect(log.has('ATT', 'Nope')).toBe(false)
    expect(log.fieldNames('MODE')).toEqual(['TimeUS', 'Mode', 'ModeNum', 'Rsn'])
    expect(log.stats().get('ATT')).toEqual({ count: 25, recordSize: 27, bytes: 25 * 27 })
    expect(log.formats().some((f) => f.name === 'EMPT')).toBe(true)
  })

  it('ignores the truncated trailing record', () => {
    // 100 complete IMU records + one truncated one at the end of the buffer.
    expect(log.count('IMU')).toBe(100)
    expect(log.count('IMU', 1)).toBe(50)
  })

  it('resolves units and multipliers from the built-in tables, as upstream does', () => {
    const imu = log.messageType('IMU')
    expect(imu).toBeDefined()
    if (imu === undefined) return
    expect(imu.instanceField).toBe('I')
    expect(imu.fields[1]).toMatchObject({ name: 'I', unitId: '#', isInstance: true })
    expect(imu.fields[2]).toMatchObject({ name: 'GyrX', unit: 'rad/s', multiplier: 1, type: 'f' })
    // Upstream prefixes 1e-6 with `n` (bug, reproduced).
    expect(imu.fields[0]).toMatchObject({ name: 'TimeUS', unit: 'ns', multiplier: 1e-6 })
    const att = log.messageType('ATT')
    // The log's UNIT table says `deg`; upstream ignores it and uses its built-in `°`.
    expect(att?.fields[2]).toMatchObject({ unit: '°', multiplierId: 'B', multiplier: 0.01 })
    expect(att?.instances).toBeUndefined()
    // No FMTU for TYP1: units unknown.
    expect(log.messageType('TYP1')?.fields[1]).toMatchObject({ unit: '?', multiplier: 1, unitId: undefined })
  })

  it('splits instances', () => {
    expect(log.instances('IMU')).toEqual([0, 1])
    expect(log.instances('ATT')).toEqual([])
    expect(log.messageType('IMU')?.instances?.get(1)).toBe(50)
    const t0 = log.getNumbers('IMU', 'T', 0)
    const t1 = log.getNumbers('IMU', 'T', 1)
    expect(t0).toBeInstanceOf(Float32Array)
    expect(log.getInstance('IMU', 0, 'T')).toBe(t0)
    expect(Array.from(t0 ?? [])).toEqual(Array.from({ length: 50 }, (_, i) => 30 + i))
    expect(Array.from(t1 ?? [])).toEqual(Array.from({ length: 50 }, (_, i) => 31 + i))
    expect(log.getInstance('IMU', 2, 'T')).toBeUndefined()
    expect(log.getStrings('IMU', 'T')).toBeUndefined()
    expect(log.getStrings('MSG', 'Message')?.length).toBe(2)
    // Without an instance, all records are returned in log order.
    const all = log.getNumbers('IMU', 'I')
    expect(all).toBeInstanceOf(Uint8Array)
    expect(Array.from(all?.subarray(0, 4) ?? [])).toEqual([0, 1, 0, 1])
  })

  it('decodes columns into natural typed arrays', () => {
    expect(log.get('IMU', 'TimeUS')).toBeInstanceOf(Float64Array)
    expect(log.get('ATT', 'Roll')).toBeInstanceOf(Float64Array) // 'c' is scaled
    expect(log.get('MODE', 'Mode')).toBeInstanceOf(Uint8Array)
    expect(log.get('GPS', 'Lat')).toBeInstanceOf(Int32Array)
    expect(log.get('GPS', 'GMS')).toBeInstanceOf(Uint32Array)
    const roll = log.get('ATT', 'Roll') as Float64Array
    expect(roll[0]).toBeCloseTo(1.52, 10)
    expect(log.get('ATT', 'Yaw')?.[0]).toBeCloseTo(90.2, 10)
    expect(log.get('ATT', 'Missing')).toBeUndefined()
    expect(log.get('NOPE', 'X')).toBeUndefined()
  })

  it('decodes every type code', () => {
    const t1 = log.getMessage('TYP1')
    expect(t1).toBeDefined()
    if (t1 === undefined) return
    expect(t1.length).toBe(2)
    expect(t1.columns['TimeUS']?.[1]).toBe(2 ** 53 - 1)
    const a = t1.columns['A'] as Int16Array[]
    expect(a[0]).toBeInstanceOf(Int16Array)
    expect(a[0]?.length).toBe(32)
    expect(a[0]?.[0]).toBe(-1600)
    expect(a[1]?.[0]).toBe(1600)
    expect(Array.from(t1.columns['SB'] as Int8Array)).toEqual([-128, 127])
    expect(Array.from(t1.columns['UB'] as Uint8Array)).toEqual([255, 0])
    expect(Array.from(t1.columns['SH'] as Int16Array)).toEqual([-32768, 32767])
    expect(Array.from(t1.columns['UH'] as Uint16Array)).toEqual([65535, 0])
    expect(Array.from(t1.columns['SI'] as Int32Array)).toEqual([-2147483648, 2147483647])
    expect(Array.from(t1.columns['UI'] as Uint32Array)).toEqual([4294967295, 0])
    expect(Array.from(t1.columns['F'] as Float32Array)).toEqual([1.5, -0.25])
    expect(Array.from(t1.columns['D'] as Float64Array)).toEqual([Math.PI, -Math.E])

    const t2 = log.getMessage('TYP2')
    expect(t2).toBeDefined()
    if (t2 === undefined) return
    expect(t2.columns['N4']).toEqual(['abcd', 'ab'])
    expect(t2.columns['N16']).toEqual(['sixteen chars!!!', 'x'])
    expect(t2.columns['Z64']).toEqual(['zed', ''])
    expect(Array.from(t2.columns['C'] as Float64Array)).toEqual([-327.68, 1.23])
    expect(Array.from(t2.columns['UC'] as Float64Array)).toEqual([655.35, 4.56])
    expect(Array.from(t2.columns['E'] as Float64Array)).toEqual([-21474836.48, 7.89])
    expect(Array.from(t2.columns['UE'] as Float64Array)).toEqual([42949672.95, 10.11])
    expect(Array.from(t2.columns['L'] as Int32Array)).toEqual([-353632621, 1491652374])
    expect(Array.from(t2.columns['M'] as Uint8Array)).toEqual([7, 255])
    expect(Array.from(t2.columns['Q'] as Float64Array)).toEqual([-5_000_000_000, 2 ** 40 + 1])
  })

  it('caches decoded data', () => {
    const fresh = DataflashLog.parse(bytes)
    const a = fresh.get('ATT', 'Roll')
    expect(fresh.get('ATT', 'Roll')).toBe(a)
    const msg = fresh.getMessage('ATT')
    expect(fresh.getMessage('ATT')).toBe(msg)
    // Whole-message decode is reused by field access afterwards.
    expect(fresh.get('ATT', 'Pitch')).toBe(msg?.columns['Pitch'])
    const i0 = fresh.getInstance('IMU', 0, 'GyrX')
    expect(fresh.getInstance('IMU', 0, 'GyrX')).toBe(i0)
    expect(fresh.getMessage('IMU', 0)?.length).toBe(50)
    expect(fresh.getMessage('IMU', 7)).toBeUndefined()
  })

  it('reports params with last-value-wins semantics', () => {
    expect(log.param('ATC_RAT_RLL_P')).toBeCloseTo(0.15, 6)
    expect(log.param('INS_GYRO_FILTER')).toBe(20)
    expect(log.param('NOPE')).toBeUndefined()
    expect(log.params().size).toBe(2)
  })

  it('detects the vehicle and names modes', () => {
    expect(log.textMessages()[0]).toBe('ArduCopter V4.5.1 (deadbeef)')
    expect(log.vehicleType()).toBe('copter')
    expect(log.mavType()).toBe(2)
    expect(log.modes().map((m) => m.name)).toEqual(['STABILIZE', 'LOITER', 'UNKNOWN(99)'])
    expect(log.modes()[1]).toEqual({ timeUs: 1_000_020, mode: 5, reason: 2, name: 'LOITER' })
  })

  it('derives a start time from the first 3D GPS fix', () => {
    expect(log.firstTimeUs()).toBe(1_000_000)
    const start = log.startTime()
    expect(start).toBeInstanceOf(Date)
    if (start === undefined) return
    // First 3D fix is instance 0 at i = 20: GMS = 600000, GWk = 2300, TimeUS = t0 + 100 + 20*2500 + 3.
    const fixTimeUs = 1_000_000 + 100 + 20 * 2500 + 3
    const gpsMs = 2300 * 7 * 24 * 3600 * 1000 + 600000
    const expected = 315964800 * 1000 + gpsMs - (fixTimeUs - 1_000_000) / 1000 - 18 * 1000
    expect(Math.abs(start.getTime() - expected)).toBeLessThan(1) // Date truncates sub-ms
  })

  it('reports scan progress', () => {
    const seen: number[] = []
    DataflashLog.parse(bytes, { onProgress: (f) => seen.push(f) })
    expect(seen.at(-1)).toBe(1)
    const decodeSeen: number[] = []
    DataflashLog.parse(bytes).getMessage('IMU', undefined, (f) => decodeSeen.push(f))
    expect(decodeSeen.at(-1)).toBe(1)
    expect(decodeSeen.every((f) => f >= 0 && f <= 1)).toBe(true)
  })

  it('accepts a Uint8Array view without copying and an ArrayBuffer', () => {
    const padded = new Uint8Array(bytes.byteLength + 16)
    padded.set(bytes, 8)
    const view = padded.subarray(8, 8 + bytes.byteLength)
    const fromView = DataflashLog.parse(view)
    expect(fromView.count('IMU')).toBe(100)
    const fromBuffer = DataflashLog.parse(bytes.slice().buffer)
    expect(fromBuffer.count('IMU')).toBe(100)
    expect(fromView.byteLength).toBe(bytes.byteLength)
  })

  it('handles an empty buffer', () => {
    const empty = DataflashLog.parse(new Uint8Array(0))
    expect(empty.messageTypes().size).toBe(0)
    expect(empty.startTime()).toBeUndefined()
    expect(empty.modes()).toEqual([])
    expect(empty.params().size).toBe(0)
    expect(empty.vehicleType()).toBeUndefined()
  })
})
