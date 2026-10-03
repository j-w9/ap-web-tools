import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/upstream.js'
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

  it('reports serial port configuration', () => {
    expect(r.serialPorts.map((p) => [p.index, p.protocolName, p.baud])).toEqual([
      [0, 'MAVLink2', 115200],
      [1, 'ESC Telemetry', 115200],
      [2, 'RCIN', 57600],
      [3, 'GPS', 230400],
      [4, 'GPS', 230400],
      [6, 'DisplayPort', 115200],
      [7, 'GPS', 57600],
      [8, 'None', 57600],
      [9, 'MAVLink2', 115200]
    ])
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

  it('reassembles embedded files by offset', () => {
    expect(r.files.map((f) => [f.name, f.data.length])).toEqual([
      ['@SYS/uarts.txt', 832],
      ['@SYS/memory.txt', 346],
      ['@SYS/threads.txt', 1230],
      ['@SYS/timers.txt', 344],
      ['@ROMFS/hwdef.dat', 3380],
      ['@SYS/storage.bin', 32768],
      ['defaults.parm', 128]
    ])
    const threads = new TextDecoder().decode(r.files[2]?.data)
    expect(threads.match(/ThreadsV2/g)).toHaveLength(1)
    expect(threads.startsWith('ThreadsV2\nISR ')).toBe(true)
    expect(r.files.some((f) => f.isCrashDump)).toBe(false)
  })

  it('decodes @SYS uarts, threads, timers and memory', () => {
    const sys = r.sysFiles
    expect(sys.uarts).toHaveLength(10)
    expect(sys.uarts?.[5]).toMatchObject({ index: 5, device: 'EMPTY', empty: true })
    expect(sys.uarts?.[7]).toMatchObject({
      index: 7,
      device: 'UART7',
      rxDma: true,
      txDma: false,
      framingErrors: 8,
      noiseErrors: 40
    })
    expect(sys.uarts?.[0]).toMatchObject({ txBytes: 9990, txRate: 49950 })
    expect(sys.timers?.map((t) => t.timer)).toEqual(['TIM3', 'TIM2', 'TIM5', 'TIM4', 'TIM1', 'TIM15'])
    expect(sys.timers?.[0]).toEqual({ timer: 'TIM3', clockMhz: 200, mode: 'PWM', frequency: 7, target: 8 })
    expect(sys.memory).toHaveLength(6)
    expect(sys.memory?.[0]).toEqual({ start: '0x30000000', length: 256 * 1024, free: 416, largest: 320, type: 8 })
    expect(sys.dma).toBeUndefined()
    expect(sys.threads?.length).toBe(24)
    expect(sys.threads?.[1]).toEqual({
      name: 'ArduCopter',
      priority: 182,
      stackPointer: '0x30000600',
      stackFree: 4432,
      stackSize: 7168
    })
  })

  it('thread stack figures agree with STAK records', () => {
    const stak = new Map(r.plots.stacks.map((s) => [s.name, s]))
    let compared = 0
    for (const t of r.sysFiles.threads ?? []) {
      const s = stak.get(t.name)
      if (s === undefined) continue
      expect(t.stackSize).toBe(s.total[0])
      compared++
    }
    expect(compared).toBeGreaterThan(10)
    // STAK sorted by priority, highest first.
    const pri = r.plots.stacks.map((s) => s.priority)
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
    expect(r.logStats.messages.every((m) => m.count > 0)).toBe(true)
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
    expect(r.sysFiles).toEqual({ uarts: undefined, threads: undefined, timers: undefined, dma: undefined, memory: undefined })
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
    expect(r.serialPorts).toEqual(log.serialPorts)
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
