import { describe, expect, it } from 'vitest'
import { baseLog } from '../test-utils/synthetic.js'
import { readPowerFlags, readTemperature, readVoltage } from './board-health.js'
import { canNameForDevice, canNameForNodeId, readCanNodes } from './can.js'
import { readCanRates } from './data-rates.js'
import { deviceLines, describeDevice } from './device.js'
import { readEmbeddedFiles } from './files.js'
import { readInternalErrors } from './internal-errors.js'
import { readIomcu } from './iomcu.js'
import { readMissions, waypointFileText } from './missions.js'
import { buildLogReport } from './report.js'
import { DeviceType } from '@apwt/ardupilot'
import { decodeIcsr, faultName, readWatchdogs, taskName, watchdogDecodeLine } from './watchdog.js'

describe('CAN nodes', () => {
  const log = baseLog()
    .define('CAND', 'QBBIIIZBB', 'TimeUS,NodeId,Driver,UID1,UID2,Version,Name,Major,Minor', 'NodeId')
    .write('CAND', [1, 125, 0, 0x11, 0x22, 0xab, 'org.ardupilot.periph', 1, 4])
    .write('CAND', [2, 125, 0, 0x11, 0x22, 0xab, 'org.ardupilot.periph', 1, 4]) // duplicate
    .write('CAND', [3, 10, 1, 0x33, 0x44, 0x1234, 'com.hex.here4', 2, 0])
    .write('CAND', [4, 10, 0, 0x55, 0x66, 0x1, 'other.gps', 3, 1])
    .write('CAND', [5, 125, 0, 0x11, 0x22, 0xac, 'org.ardupilot.periph', 1, 5]) // new firmware
    .params({
      COMPASS_DEV_ID: 97539,
      COMPASS_PRIO1_ID: 97539,
      GPS1_TYPE: 9,
      GPS1_CAN_NODEID: 10,
      GPS2_TYPE: 9,
      GPS2_CAN_NODEID: 125
    })
    .parse()
  const can = readCanNodes(log)

  it('keeps distinct identities ordered by driver and node', () => {
    expect(can.haveDriverNum).toBe(true)
    expect(can.nodes.map((n) => [n.driver, n.nodeId, n.name, n.version, n.hash])).toEqual([
      [0, 10, 'other.gps', '3.1', '00000001'],
      [0, 125, 'org.ardupilot.periph', '1.4', '000000ab'],
      [0, 125, 'org.ardupilot.periph', '1.5', '000000ac'],
      [1, 10, 'com.hex.here4', '2.0', '00001234']
    ])
    expect(can.nodes[1]?.isArduPilot).toBe(true)
  })

  it('names DroneCAN sensors and GPS nodes', () => {
    expect(canNameForDevice(can, 0, 125)).toBe('org.ardupilot.periph')
    expect(canNameForDevice(can, 3, 125)).toBeUndefined()
    // Node 10 exists on two drivers: ambiguous for GPS.
    expect(canNameForNodeId(can, 10)).toBeUndefined()
    expect(canNameForNodeId(can, 125)).toBe('org.ardupilot.periph')
    const dev = describeDevice(97539, DeviceType.compass, can)
    expect(deviceLines(dev)).toEqual(['DRONECAN bus: 0 node id: 125 sensor: 0', 'Name: org.ardupilot.periph'])

    const r = buildLogReport(log)
    expect(r.sensors.compass.sensors[0]?.device.canName).toBe('org.ardupilot.periph')
    expect(r.sensors.gps.map((g) => g?.canName)).toEqual([undefined, 'org.ardupilot.periph'])
  })

  it('falls back to driver-less entries when Driver is not logged', () => {
    const l = baseLog()
      .define('CAND', 'QBIIIZBB', 'TimeUS,NodeId,UID1,UID2,Version,Name,Major,Minor', 'NodeId')
      .write('CAND', [1, 125, 1, 2, 3, 'n', 1, 0])
      .parse()
    const c = readCanNodes(l)
    expect(c.haveDriverNum).toBe(false)
    expect(c.nodes[0]?.driver).toBe('all')
    expect(canNameForDevice(c, 1, 125)).toBe('n')
  })
})

describe('watchdog', () => {
  const log = baseLog()
    .define('WDOG', 'QbIHHHHHHHIBIIn', 'TimeUS,Tsk,IE,IEC,IEL,MvMsg,MvCmd,SmLn,FL,FT,FA,FP,ICSR,LR,TN')
    .write('WDOG', [1, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
    .write('WDOG', [2, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
    .write('WDOG', [3, 5, 1, 2, 3, 4, 5, 6, 7, 5, 8, 9, 0, 10, 'io'])
    .params({ ARMING_CHECK: 1 })
    .parse()

  it('drops consecutive duplicates and decodes fields', () => {
    const w = readWatchdogs(log)
    expect(w).toHaveLength(2)
    expect(w[0]).toMatchObject({ schedulerTask: -2, faultLine: 1234, faultType: 3, faultAddr: 0x08001234, threadName: 'main' })
    expect(taskName(-2)).toBe('Fast loop')
    expect(taskName(5)).toBeUndefined()
    expect(faultName(3)).toBe('HardFault')
    // Upstream bug, reproduced: BusFault/UsageFault sit under duplicate `case 4` labels.
    expect(faultName(5)).toBeUndefined()
    expect(faultName(4)).toBe('MemManage')
    expect(watchdogDecodeLine(w[1] as never)).toBe('"WDOG, 0, 5, 1, 2, 3, 4, 5, 6, 7, 5, 8, 9, 0, 10, io"')
    expect(buildLogReport(log).warnings.map((x) => [x.kind, x.level])).toEqual([['watchdog', 'error']])
  })

  it('decodes the ICSR register', () => {
    const f = decodeIcsr(0x80400803)
    const byName = Object.fromEntries(f.map((x) => [x.name, x]))
    expect(byName['VECTACTIVE']).toMatchObject({ value: 3, description: 'Hard fault' })
    expect(byName['RETOBASE']).toMatchObject({ value: 1, description: 'no (or no more) active exceptions' })
    expect(byName['ISRPENDING']).toMatchObject({ value: 1, description: 'Interrupt pending' })
    // Upstream's signed shift reads bit 31 as -1 (bug, reproduced); -1 is truthy, so 'NMI pending'.
    expect(byName['NMIPENDSET']).toMatchObject({ value: -1, description: 'NMI pending' })
    expect(byName['RESERVED1']?.description).toBeUndefined()
    expect(decodeIcsr(0x30 << 12).find((x) => x.name === 'VECTPENDING')?.description).toBe('IRQ32')
  })
})

describe('internal errors', () => {
  it('merges PM and MON, keeps changes and works out what to show', () => {
    const log = baseLog()
      .define('PM', 'QHIHI', 'TimeUS,ErrL,InE,ErC,Load')
      .define('MON', 'QIHI', 'TimeUS,IErr,IErrLn,IErrCnt')
      .write('PM', [100, 0, 0, 0, 0])
      .write('PM', [200, 55, 1 << 10, 3, 0]) // Constraining NaN x3 at line 55
      .write('MON', [250, 1 << 10, 55, 5]) // same mask/line, count rises
      .write('PM', [300, 77, (1 << 10) | (1 << 14) | (1 << 23), 7, 0]) // two new bits, two new errors
      .write('PM', [400, 0, (1 << 10) | (1 << 14) | (1 << 23) | (1 << 31), 8, 0])
      .parse()
    const e = readInternalErrors(log)
    expect(e.map((x) => [x.timeUs, x.maskChange >>> 0, x.names, x.countChange, x.displayCount, x.displayLine])).toEqual([
      [200, 1 << 10, ['Constraining NaN'], 5, 5, 55],
      [300, (1 << 14) | (1 << 23), ['SPI fail', 'stack overflow'], 2, undefined, 77],
      [400, 2 ** 31, ['undefined'], 1, undefined, undefined]
    ])
  })

  it('uses the newer PM field names and is empty without data', () => {
    const log = baseLog().define('PM', 'QHIH', 'TimeUS,ErrL,IntE,ErrC').write('PM', [1, 9, 1, 1]).parse()
    expect(readInternalErrors(log).map((x) => x.names)).toEqual([['logging map failure']])
    expect(readInternalErrors(baseLog().parse())).toEqual([])
  })
})

describe('IOMCU', () => {
  it('reports maximum counters', () => {
    const log = baseLog()
      .define('IOMC', 'QIIIII', 'TimeUS,RSErr,Nerr,Nerr2,NDel,Mem')
      .write('IOMC', [1, 0, 1, 0, 0, 0])
      .write('IOMC', [2, 0, 4, 0, 2, 0])
      .parse()
    expect(readIomcu(log)).toEqual({ statusReadErrors: 0, flightControllerErrors: 4, iomcuErrors: 0, delayedPackets: 2 })
    expect(readIomcu(baseLog().parse())).toBeUndefined()
  })
})

describe('missions, fences and rally points', () => {
  const log = baseLog()
    .define('CMD', 'QHHHffffLLfB', 'TimeUS,CTot,CNum,CId,Prm1,Prm2,Prm3,Prm4,Lat,Lng,Alt,Frame')
    .define('FNCE', 'QBBBBfLL', 'TimeUS,Tot,Seq,Type,Count,Radius,Lat,Lng')
    .define('RALY', 'QBBLLhB', 'TimeUS,Tot,Seq,Lat,Lng,Alt,Flags')
    // Mission A: 3 items
    .write('CMD', [1, 3, 0, 16, 0, 0, 0, 0, -353632621, 1491652374, 584, 0])
    .write('CMD', [2, 3, 1, 22, 15, 0, 0, 0, 0, 0, 10, 3])
    .write('CMD', [3, 3, 2, 16, 0, 0, 0, 0, -353600000, 1491650000, 20, 3])
    // Re-logging the same item keeps the mission; a different item starts mission B.
    .write('CMD', [4, 3, 1, 22, 15, 0, 0, 0, 0, 0, 10, 3])
    .write('CMD', [5, 3, 1, 22, 20, 0, 0, 0, 0, 0, 10, 3])
    .write('FNCE', [6, 4, 0, 98, 3, 0, 1, 2])
    .write('FNCE', [7, 4, 1, 98, 3, 0, 3, 4])
    .write('FNCE', [8, 4, 2, 93, 0, 50, 5, 6])
    .write('FNCE', [9, 4, 3, 1, 0, 0, 7, 8]) // unknown type: skipped
    .write('RALY', [10, 3, 0, 11, 12, 100, 0])
    .write('RALY', [11, 3, 1, 13, 14, 50, 0b100 | (3 << 3)]) // terrain frame
    .write('RALY', [12, 3, 2, 15, 16, 50, 0b100 | (2 << 3)]) // above origin: invalid, skipped
    .parse()
  const m = readMissions(log)

  it('splits CMD records into missions', () => {
    expect(m.missions).toHaveLength(2)
    expect(m.missions[0]?.items.map((i) => i?.command)).toEqual([16, 22, 16])
    expect(m.missions[1]?.items.map((i) => i?.param1)).toEqual([undefined, 20])
    const file = waypointFileText(m.missions[0] as never)
    expect(file.complete).toBe(true)
    expect(file.text.split('\n')[0]).toBe('QGC WPL 110')
    expect(file.text.split('\n')[1]).toBe(
      '0\t0\t0\t16\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t-35.36326210\t149.16523740\t584.000000\t1'
    )
    expect(waypointFileText(m.missions[1] as never).complete).toBe(false)
  })

  it('converts fences and rally points to mission commands', () => {
    expect(m.fences).toHaveLength(1)
    expect(m.fences[0]?.items.map((i) => i && [i.sequence, i.command, i.param1])).toEqual([
      undefined,
      [1, 5001, 3],
      [2, 5001, 3],
      [3, 5004, 50]
    ])
    expect(m.rally[0]?.items.map((i) => i && [i.sequence, i.command, i.frame, i.altitude])).toEqual([
      undefined,
      [1, 5100, 3, 100],
      [2, 5100, 10, 50]
    ])
  })
})

describe('embedded files', () => {
  it('appends a file written twice (upstream processFiles) and flags crash dumps', () => {
    const chunk = (s: string): string => s
    const log = baseLog()
      .define('FILE', 'NIBZ', 'FileName,Offset,Length,Data')
      .write('FILE', ['a.txt', 0, 5, chunk('hello')])
      .write('FILE', ['a.txt', 5, 6, chunk(' world')])
      .write('FILE', ['crash_dump.bin', 0, 3, chunk('abc')])
      .write('FILE', ['a.txt', 0, 5, chunk('HELLO')])
      .parse()
    const files = readEmbeddedFiles(log)
    expect(files.map((f) => [f.name, new TextDecoder().decode(f.data), f.isCrashDump])).toEqual([
      ['a.txt', 'hello worldHELLO', false],
      ['crash_dump.bin', 'abc', true]
    ])
  })
})

describe('CAN data rates', () => {
  it('differentiates cumulative counters and applies the classic CAN limit', () => {
    const log = baseLog()
      .define('CANS', 'QBII', 'TimeUS,I,T,R', 'I')
      .write('CANS', [1_000_000, 0, 0, 0])
      .write('CANS', [2_000_000, 0, 1000, 500])
      .write('CANS', [3_000_000, 0, 3000, 1500])
      .write('CANS', [1_000_000, 1, 0, 0])
      .write('CANS', [1_500_000, 1, 10, 10])
      .parse()
    const params = new Map([
      ['CAN_P1_DRIVER', 1],
      ['CAN_P1_BITRATE', 1000000],
      ['CAN_P2_DRIVER', 2],
      ['CAN_P2_FDBITRATE', 4],
      ['CAN_D2_UC_OPTION', 4]
    ])
    const rates = readCanRates(log, params)
    expect(rates.map((r) => [r.title, r.fd, r.bitrate, r.worstCaseLimit])).toEqual([
      ['DroneCAN 0: 1Mbit/s', false, 1000000, 6250],
      ['DroneCAN 1: 4Mbit/s', true, 4000000, undefined]
    ])
    expect([...(rates[0]?.time ?? [])]).toEqual([2, 3])
    expect([...(rates[0]?.tx ?? [])]).toEqual([1000, 2000])
    expect([...(rates[0]?.total ?? [])]).toEqual([1500, 3000])
    expect([...(rates[1]?.rx ?? [])]).toEqual([20])
  })
})

describe('board health series', () => {
  it('reads heater, POWR temperature, voltages and power flags', () => {
    const log = baseLog()
      .define('HEAT', 'Qff', 'TimeUS,Temp,Targ')
      .define('POWR', 'QffHHfffff', 'TimeUS,Vcc,VServo,Flags,AccFlags,MTemp,MVolt,MVmin,MVmax,X')
      .write('HEAT', [1_000_000, 44, 45])
      .write('POWR', [1_000_000, 5.1, NaN, 0b101, 0b100101, 40, 3.3, 3.2, 3.4, 0])
      .write('POWR', [2_000_000, 5.0, NaN, 0b001, 0b100101, 41, 3.3, 3.2, 3.4, 0])
      .parse()
    const t = readTemperature(log)
    expect(t?.heaterTarget?.values[0]).toBe(45)
    expect(t?.mcu?.values[1]).toBe(41)
    const v = readVoltage(log)
    expect(v?.servo).toBeUndefined()
    expect(v?.board?.values.length).toBe(2)
    expect(v?.mcu?.min[0]).toBeCloseTo(3.2)
    const f = readPowerFlags(log)
    expect([...(f?.usbConnected ?? [])]).toEqual([1, 0])
    expect([...(f?.brickValid ?? [])]).toEqual([1, 1])
  })

  it('hides power flags that never changed', () => {
    const log = baseLog().define('POWR', 'QffHH', 'TimeUS,Vcc,VServo,Flags,AccFlags').write('POWR', [1, 5, 0, 1, 1]).parse()
    expect(readPowerFlags(log)).toBeUndefined()
  })
})

describe('GPS boot messages', () => {
  it('takes the device name after "as"', () => {
    const log = baseLog()
      .params({ GPS_TYPE: 1, GPS_TYPE2: 0 })
      .write('MSG', [1, 'GPS 1: detected as u-blox at 230400 baud'])
      .parse()
    const r = buildLogReport(log)
    expect(r.sensors.gps.map((g) => g?.device)).toEqual(['u-blox', undefined])
  })

  it('fails where upstream crashes: a message names an unconfigured receiver', () => {
    const log = baseLog()
      .params({ GPS_TYPE: 1, GPS_TYPE2: 0 })
      .write('MSG', [1, 'GPS 1: detected as u-blox at 230400 baud'])
      .write('MSG', [2, 'GPS 2: detected as NMEA at 9600 baud'])
      .parse()
    expect(() => buildLogReport(log)).toThrow(/names GPS 2, which is not configured/)
  })
})
