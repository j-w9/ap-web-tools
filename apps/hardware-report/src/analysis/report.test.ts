import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { buildLogReport, buildParamFileReport, loadHardwareReport, type LogReport } from './report.js'
import { allParamsText } from './minimal-params.js'

const load = (name: string): LogReport => buildLogReport(DataflashLog.parse(readFixture(name)))

describe('buildLogReport on copter-files.bin (real H743 board)', () => {
  const r = load('copter-files.bin')

  it('identifies firmware and board', () => {
    expect(r.firmware).toMatchObject({
      fwString: 'ArduCopter V4.6.3 (92b0cd78)',
      fwHash: '92b0cd78',
      osString: 'ChibiOS: 88b84600',
      flightController: 'BROTHERHOBBYH743 0033003A 3433510B 34303639',
      boardId: 5810,
      boardName: undefined,
      canCheckRelease: true
    })
  })

  it('lists the two ICM42688 IMUs on SPI with health', () => {
    const ins = r.sensors.ins.filter((s) => s !== undefined)
    expect(ins).toHaveLength(2)
    expect(
      ins.map((s) => [s.number, s.gyro.devId, s.gyro.decoded.name, s.gyro.decoded.busType, s.gyro.decoded.bus, s.combined])
    ).toEqual([
      [1, 3408138, 'ICM42688', 'SPI', 1, true],
      [2, 3408162, 'ICM42688', 'SPI', 4, true]
    ])
    for (const s of ins) expect([s.accelHealthy, s.gyroHealthy]).toEqual([true, true])
  })

  it('lists the SPL06 barometer and no compass', () => {
    expect(r.sensors.baro.primary).toBe(1)
    const baro = r.sensors.baro.sensors[0]
    expect(baro?.device.decoded).toMatchObject({ name: 'SPL06', busType: 'I2C', address: 118 })
    expect(baro?.healthy).toBe(true)
    expect(r.sensors.compass.sensors.every((s) => s === undefined)).toBe(true)
    expect(r.sensors.gps[0]).toMatchObject({ type: 1, typeName: 'AUTO', device: undefined })
  })

  it('titles the UART data rates from the serial parameters', () => {
    expect(r.plots.uartRates.map((u) => u.title)).toEqual([
      'Serial 0: MAVLink2, 115200 baud',
      'Serial 2: RCIN, 57600 baud',
      'Serial 3: GPS, 230400 baud',
      'Serial 6: DisplayPort, 115200 baud',
      'Serial 7: GPS, 57600 baud',
      'Serial 9: MAVLink2, 115200 baud'
    ])
    for (const u of r.plots.uartRates) expect(u.rx.length).toBe(u.time.length)
  })

  it('reassembles embedded files by appending chunks, as upstream processFiles', () => {
    // uarts.txt is written twice in this log; upstream ignores Offset, so both copies are kept.
    expect(r.files.map((f) => f.name)).toEqual([
      '@SYS/uarts.txt',
      '@SYS/memory.txt',
      '@SYS/threads.txt',
      '@SYS/timers.txt',
      '@ROMFS/hwdef.dat',
      '@SYS/storage.bin',
      'defaults.parm'
    ])
    expect(r.files[0]?.data.length).toBe(1664)
    expect(r.files.some((f) => f.isCrashDump)).toBe(false)
  })

  it('sorts thread stacks by priority, highest first', () => {
    const pri = r.plots.stacks.map((s) => s.priority)
    expect(pri.length).toBeGreaterThan(10)
    expect([...pri].sort((a, b) => b - a)).toEqual(pri)
  })

  it('extracts board health and log statistics', () => {
    expect(r.plots.temperature?.mcu?.values.length).toBe(169)
    expect(r.plots.temperature?.imu.map((s) => s.name)).toEqual(['IMU 1', 'IMU 2'])
    expect(r.plots.voltage?.mcu?.voltage.values.length).toBe(169)
    expect(r.plots.voltage?.servo).toBeUndefined()
    expect(r.plots.performance?.load.values.length).toBe(2)
    expect(r.plots.logging?.dropped?.values.length).toBe(16)
    expect(r.logStats.totalBytes).toBe(457146)
    const sum = r.logStats.messages.reduce((n, m) => n + m.bytes, 0)
    expect(sum).toBeGreaterThan(0.9 * r.logStats.totalBytes)
    expect(sum).toBeLessThanOrEqual(r.logStats.totalBytes)
    // Upstream's stats() lists defined types without records too.
    expect(r.logStats.messages.some((m) => m.count === 0)).toBe(true)
  })

  it('has params with defaults and no warnings', () => {
    expect(r.params.values.size).toBe(1253)
    expect(r.params.defaults.size).toBe(1253)
    expect(r.warnings).toEqual([])
    expect(r.watchdogs).toEqual([])
    expect(r.internalErrors).toEqual([])
  })
})

describe('buildLogReport on copter-sitl.bin', () => {
  const r = load('copter-sitl.bin')

  it('lists SITL IMUs with separate gyro and accel ids', () => {
    const ins = r.sensors.ins.filter((s) => s !== undefined)
    expect(ins.map((s) => [s.gyro.devId, s.accel.devId, s.combined, s.gyro.decoded.busType])).toEqual([
      [2752772, 2753028, false, 'SITL'],
      [2752780, 2753036, false, 'SITL']
    ])
  })

  it('lists compasses from priorities then extra device ids', () => {
    const c = r.sensors.compass.sensors
    expect(c.map((s) => s?.device.devId)).toEqual([97539, 131874, 263178, 97283, 97795, 98051, undefined])
    expect(c.map((s) => s?.calibration !== undefined)).toEqual([true, true, true, false, false, false, false])
    expect(c[0]?.device.decoded).toMatchObject({ kind: 'dronecan', bus: 0, address: 125, sensorId: 0 })
    expect(c[0]?.calibration?.external).toBe(true)
    expect(c[2]?.device.decoded.name).toBe('AK8963 ')
    expect(c.slice(0, 3).map((s) => s?.healthy)).toEqual([true, true, true])
    expect(c[3]?.healthy).toBeUndefined()
  })

  it('lists both SITL baros with health from the H field', () => {
    expect(r.sensors.baro.sensors.map((s) => s?.healthy)).toEqual([true, true, undefined])
  })

  it('reports in-log parameter changes without STAT_ params', () => {
    const names = r.paramChanges.map((c) => c.name)
    expect(names).toContain('MIS_TOTAL')
    expect(names.some((n) => n.startsWith('STAT_'))).toBe(false)
    const mis = r.paramChanges.find((c) => c.name === 'MIS_TOTAL')
    expect(mis?.changes.map((c) => c.value)).toEqual([0, 1])
    expect(r.params.values.get('MIS_TOTAL')).toBe(1)
  })

  it('computes GPS clock drift with a 1000 ppm display range', () => {
    const drift = r.plots.clockDrift
    expect(drift?.series.map((s) => s.name)).toEqual(['GPS 0'])
    const values = drift?.series[0]?.values ?? new Float64Array()
    const finite = [...values].filter((v) => !Number.isNaN(v))
    expect(finite.length).toBeGreaterThan(10)
    expect(finite[0]).toBe(0)
    expect(drift?.yRange).toBeGreaterThan(0)
    expect(Math.max(...finite.map(Math.abs))).toBeLessThan(drift?.yRange ?? 0)
  })

  it('has no embedded files', () => {
    expect(r.files).toEqual([])
  })
})

describe('parameter file report', () => {
  it('round-trips the parameters of a log through .param text', () => {
    const log = load('copter-files.bin')
    const text = allParamsText(log.params.values)
    const r = buildParamFileReport(text)
    expect(r.source).toBe('params')
    expect(r.params.values.size).toBe(log.params.values.size)
    expect(r.sensors.ins.map((s) => s?.gyro.devId)).toEqual(log.sensors.ins.map((s) => s?.gyro.devId))
    expect(r.sensors.baro.sensors[0]?.device.devId).toBe(816641)
    // No log: no health, no boot-message GPS device.
    expect(r.sensors.ins[0]?.gyroHealthy).toBeUndefined()
    expect(r.sensors.baro.sensors[0]?.healthy).toBeUndefined()
  })

  it('dispatches on the file extension', () => {
    expect(loadHardwareReport('flight.BIN', readFixture('copter-sitl.bin')).source).toBe('log')
    const p = loadHardwareReport('setup.param', new TextEncoder().encode('ARMING_CHECK,0\nINS_GYR_ID 3408138\n'))
    expect(p.source).toBe('params')
    expect(p.warnings.map((w) => w.kind)).toEqual(['armingChecksDisabled'])
  })

  it('rejects a log without parameters', async () => {
    const { SyntheticLog } = await import('../test-utils/synthetic.js')
    const log = new SyntheticLog().define('MSG', 'QZ', 'TimeUS,Message').write('MSG', [1, 'hello']).parse()
    expect(() => buildLogReport(log)).toThrow('No parameter values found in log')
  })
})
