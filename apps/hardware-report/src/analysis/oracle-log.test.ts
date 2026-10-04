// Oracle: upstream HardwareReport.js `load_log()` (run in a vm by test-utils/upstream.ts) against the
// port's `buildLogReport()`, for the log sections outside the sensor and parameter code: firmware and
// board, IOMCU, board health plots, performance, thread stacks, data rates, DroneCAN nodes,
// missions/fences/rally downloads, embedded files, warnings, logger stats, composition and clock drift.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { compareLogSections, type Compared } from '../test-utils/compare-sections.js'
import { createUpstreamHardwareReport } from '../test-utils/upstream.js'
import { buildLogReport } from './report.js'
import { waypointFileText } from './missions.js'

async function both(bytes: Uint8Array): Promise<Compared> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  return { up, port: buildLogReport(DataflashLog.parse(bytes)) }
}

describe.each(['copter-sitl.bin', 'copter-files.bin'])('oracle load_log sections: %s', (fixture) => {
  it('matches upstream', async () => {
    const c = await both(readFixture(fixture))
    expect(c.up.alerts).toEqual([])
    // copter-files.bin logs uarts.txt, memory.txt and threads.txt twice, and storage.bin with
    // zero-ended chunks.
    const fixed = ['@SYS/uarts.txt', '@SYS/memory.txt', '@SYS/threads.txt', '@SYS/storage.bin']
    compareLogSections(c, fixture === 'copter-files.bin' ? fixed : [])
    if (fixture === 'copter-files.bin') {
      expect(c.port.plots.uartRates.length).toBeGreaterThan(3)
      expect(c.port.files.length).toBeGreaterThan(3)
    } else {
      expect(c.port.plots.clockDrift).toBeDefined()
    }
  })
})

/** Board health, IOMCU, performance, stacks and logger messages. */
function boardLog(variant: 'mcu' | 'powr' | 'quiet'): Uint8Array {
  const log = baseLog()
    .define('POWR', 'QffffffBB', 'TimeUS,Vcc,VServo,MTemp,MVolt,MVmin,MVmax,Flags,AccFlags')
    .define('HEAT', 'Qff', 'TimeUS,Targ,Temp')
    .define('IOMC', 'QHIIIi', 'TimeUS,Mem,RSErr,Nerr,Nerr2,NDel')
    .define('PM', 'QHHIIH', 'TimeUS,Load,Mem,MaxT,LR,NLon')
    .define('DSF', 'QIHHHH', 'TimeUS,Dp,Blk,FMx,FAv,FMn')
    .define('STAK', 'QBBHHN', 'TimeUS,Id,Pri,Total,Free,Name', 'Id')
    .define('IMU', 'QBf', 'TimeUS,I,T', 'I')
  if (variant === 'mcu') log.define('MCU', 'Qffff', 'TimeUS,MTemp,MVolt,MVmin,MVmax')
  log.params({ SERIAL1_PROTOCOL: 2 })
  for (let i = 0; i < 6; i++) {
    const t = 1_000_000 + i * 100_000
    const flags = variant === 'quiet' ? 1 : i < 3 ? 3 : 7
    const acc = variant === 'quiet' ? 1 : 7 | (i > 2 ? 32 : 0)
    log.write('POWR', [t, 5 + i * 0.01, NaN, 40 + i, 3.3, 3.2, 3.4, flags, acc])
    log.write('HEAT', [t, 45, 40 + i])
    log.write('IOMC', [t, 0, i, variant === 'quiet' ? 0 : i * 2, 0, i])
    log.write('PM', [t, 100 + i * 10, 20000 - i, 2500 + i * 100, 400, 0])
    log.write('DSF', [t, i, 0, 1000, 800 + i, 600])
    log.write('STAK', [t, 0, 180, 2048, 512 + i, 'main'])
    log.write('STAK', [t, 3, 181, 1024, 100, 'io'])
    log.write('IMU', [t, i % 2, 30 + i])
    if (variant === 'mcu') log.write('MCU', [t, 50 + i, 3.31, 3.25, 3.4])
  }
  return log.bytes()
}

describe('oracle load_log sections: synthetic board health', () => {
  it.each(['mcu', 'powr', 'quiet'] as const)('matches upstream (%s)', async (variant) => {
    const c = await both(boardLog(variant))
    compareLogSections(c)
    expect(c.port.iomcu).toBeDefined()
    expect(c.port.plots.powerFlags === undefined).toBe(variant === 'quiet')
  })
})

/** UART titles for serial, networking, DroneCAN and IOMCU ports; CAN rates with and without bitrates. */
function commsLog(): Uint8Array {
  const log = baseLog()
    .define('UART', 'QBff', 'TimeUS,I,Tx,Rx', 'I')
    .define('CANS', 'QBII', 'TimeUS,I,T,R', 'I')
    .define('CAND', 'QBBIIIZBB', 'TimeUS,NodeId,Driver,UID1,UID2,Version,Name,Major,Minor', 'NodeId')
  log.params({
    SERIAL0_PROTOCOL: 2,
    SERIAL0_BAUD: 115,
    SERIAL1_PROTOCOL: 50,
    SERIAL2_PROTOCOL: 47,
    SERIAL2_BAUD: 0,
    SERIAL3_PROTOCOL: -1,
    SERIAL3_BAUD: 1.5,
    NET_P1_PROTOCOL: 2,
    NET_P1_TYPE: 4,
    NET_P1_IP0: 192,
    NET_P1_IP1: 168,
    NET_P1_IP2: 1,
    NET_P1_IP3: 2,
    NET_P1_PORT: 5760,
    NET_P2_PROTOCOL: 5,
    NET_P2_TYPE: 7,
    CAN_D1_UC_S1_PRO: 5,
    CAN_D1_UC_S1_NOD: 12,
    CAN_D1_UC_S1_IDX: 0,
    CAN_D1_UC_S1_BD: 230,
    CAN_D2_UC_S2_PRO: 2,
    CAN_D2_UC_OPTION: 4,
    CAN_P1_DRIVER: 1,
    CAN_P1_BITRATE: 1000000,
    CAN_P2_DRIVER: 2,
    CAN_P2_FDBITRATE: 4,
    CAN_P3_DRIVER: 3
  })
  for (const inst of [0, 1, 2, 3, 7, 21, 22, 41, 52, 100]) {
    for (let i = 0; i < 4; i++) log.write('UART', [1_000_000 + i * 200_000 + inst, inst, 100 * i + inst, 50 * i])
  }
  for (const inst of [0, 1, 2, 3]) {
    for (let i = 0; i < 4; i++) log.write('CANS', [1_000_000 + i * 250_000, inst, i * i * 100 + inst, i * 70])
  }
  log
    .write('CAND', [1, 125, 0, 0x11, 0x22, 0xab, 'org.ardupilot.periph', 1, 4])
    .write('CAND', [2, 125, 0, 0x11, 0x22, 0xab, 'org.ardupilot.periph', 1, 4])
    .write('CAND', [3, 10, 1, 0x33, 0x44, 0x1234, 'com.hex.here4', 2, 0])
    .write('CAND', [4, 10, 0, 0x55, 0x66, 0x1, 'other.gps', 3, 1])
    .write('CAND', [5, 125, 0, 0x11, 0x22, 0xac, 'org.ardupilot.periph', 1, 5])
  return log.bytes()
}

describe('oracle load_log sections: synthetic comms', () => {
  it('matches upstream titles, rates, limits and DroneCAN nodes', async () => {
    const c = await both(commsLog())
    compareLogSections(c)
    const titles = c.port.plots.canRates.map((r) => r.title)
    // Upstream bug reproduced: a driver whose CAN_Pn_BITRATE is missing gets a NaN bitrate.
    expect(titles).toContain('DroneCAN 2: NaNMbit/s')
    expect(c.port.plots.uartRates.length).toBe(10)
  })

  it('groups nodes without a Driver field under one table', async () => {
    const log = baseLog()
      .define('CAND', 'QBIIIZBB', 'TimeUS,NodeId,UID1,UID2,Version,Name,Major,Minor', 'NodeId')
      .params({ X: 1 })
      .write('CAND', [1, 20, 1, 2, 3, 'a', 1, 0])
      .write('CAND', [2, 5, 4, 5, 6, 'org.ardupilot.b', 2, 1])
    compareLogSections(await both(log.bytes()))
  })
})

/** Missions (two uploads, one incomplete), fences of every type and rally points with frames. */
function missionLog(): Uint8Array {
  const log = baseLog()
    .define('CMD', 'QHHHffffLLfB', 'TimeUS,CTot,CNum,CId,Prm1,Prm2,Prm3,Prm4,Lat,Lng,Alt,Frame')
    .define('FNCE', 'QBBBBHLL', 'TimeUS,Tot,Seq,Type,Count,Radius,Lat,Lng')
    .define('RALY', 'QBBLLhB', 'TimeUS,Tot,Seq,Lat,Lng,Alt,Flags')
    .params({ MIS_TOTAL: 3 })
  for (let n = 0; n < 3; n++) log.write('CMD', [n, 3, n, 16, 0.5, 0, 0, 1.25, -353632621 + n, 1491652374 + n, 10.5 + n, 3])
  log.write('CMD', [10, 4, 0, 16, 0, 0, 0, 0, 1, 2, 3, 0])
  log.write('CMD', [11, 4, 2, 22, 0, 0, 0, 0, 1, 2, 30, 3])
  const fence: [number, number, number, number, number][] = [
    [0, 98, 4, 0, 0],
    [1, 98, 4, 0, 0],
    [2, 97, 3, 0, 0],
    [3, 95, 0, 0, 0],
    [4, 93, 0, 30, 0],
    [5, 92, 0, 50, 0],
    [6, 1, 0, 0, 0]
  ]
  for (const [seq, type, count, radius] of fence) log.write('FNCE', [seq, 7, seq, type, count, radius, 10 * seq, 20 * seq])
  const flags = [0, 0b100, 0b1100, 0b10100, 0b11100, 0b1000]
  flags.forEach((f, seq) => log.write('RALY', [seq, flags.length, seq, 100 + seq, 200 + seq, 50, f]))
  return log.bytes()
}

describe('oracle load_log sections: synthetic missions', () => {
  it('matches upstream waypoint files and the incomplete alert', async () => {
    const c = await both(missionLog())
    compareLogSections(c)
    expect(c.port.missions.missions.map((m) => waypointFileText(m).complete)).toEqual([true, false])
    expect(c.port.missions.fences.length).toBeGreaterThan(0)
  })
})

/** Embedded files written twice, a crash dump and disabled arming checks. */
function filesLog(): Uint8Array {
  return baseLog()
    .define('FILE', 'NIBZ', 'FileName,Offset,Length,Data')
    .params({ ARMING_CHECK: 0 })
    .write('FILE', ['@SYS/uarts.txt', 0, 6, 'UARTV1'])
    .write('FILE', ['crash_dump.bin', 0, 4, 'ab\u0000c'])
    .write('FILE', ['@SYS/uarts.txt', 0, 6, 'UARTV1'])
    .write('FILE', ['a/crash_dump.bin', 0, 1, 'z'])
    .bytes()
}

describe('oracle load_log sections: synthetic files', () => {
  it('matches upstream file downloads and warnings', async () => {
    const c = await both(filesLog())
    compareLogSections(c, ['@SYS/uarts.txt'])
    expect(c.port.warnings.map((w) => w.kind)).toEqual(['armingChecksDisabled', 'crashDump', 'crashDump'])
    // Upstream appends the second copy ('UARTV1UARTV1'); the port keeps the last (proven bug, fixed).
    expect(new TextDecoder().decode(c.port.files[0]?.data)).toBe('UARTV1')
  })
})

/** GPS clock drift: instance 2 (blend) skipped, invalid fixes and timestamps ignored. */
function gpsLog(drift: number): Uint8Array {
  const log = baseLog().define('GPS', 'QBBHI', 'TimeUS,I,Status,GWk,GMS', 'I').params({ X: 1 })
  for (const inst of [0, 1, 2]) {
    for (let i = 0; i < 20; i++) {
      const status = i === 3 ? 2 : 3
      const week = i === 4 ? 900 : 2300
      const ms = i === 5 ? 0 : 1000 * i + inst + Math.round(i * i * drift)
      log.write('GPS', [10_000_000 + i * 1_000_000 + inst * 7, inst, status, week, ms])
    }
  }
  return log.bytes()
}

describe('oracle load_log sections: synthetic clock drift', () => {
  it.each([0, 0.2, 40])('matches upstream drift and range (drift %d)', async (drift) => {
    const c = await both(gpsLog(drift))
    compareLogSections(c)
    expect(c.port.plots.clockDrift?.series.map((s) => s.name)).toEqual(['GPS 0', 'GPS 1'])
  })
})
