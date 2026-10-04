// Oracle: upstream HardwareReport.js `load_log()` (run in a vm by test-utils/upstream.ts) against the
// port's `buildLogReport()`, for the log sections outside the sensor and parameter code: firmware and
// board, IOMCU, board health plots, performance, thread stacks, data rates, DroneCAN nodes,
// missions/fences/rally downloads, embedded files, warnings, logger stats, composition and clock drift.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { createUpstreamHardwareReport, type FakeElement, type UpstreamHardwareReport } from '../test-utils/upstream.js'
import { buildLogReport, type LogReport } from './report.js'
import { waypointFileText } from './missions.js'
import type { Series } from './series.js'

interface Trace {
  name?: string
  x?: ArrayLike<number>
  y?: ArrayLike<number>
}

interface Compared {
  up: UpstreamHardwareReport
  port: LogReport
}

async function both(bytes: Uint8Array): Promise<Compared> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  return { up, port: buildLogReport(DataflashLog.parse(bytes)) }
}

const arr = (v: ArrayLike<number> | undefined): number[] | undefined => (v === undefined ? undefined : Array.from(v))

function expectSeries(trace: Trace | undefined, series: Series | undefined, label: string): void {
  expect(arr(trace?.x), `${label} x`).toEqual(arr(series?.time))
  expect(arr(trace?.y), `${label} y`).toEqual(arr(series?.values))
}

/** Whether upstream shows the plot `id` (plots are shown and hidden through their container). */
function plotShown(up: UpstreamHardwareReport, id: string): boolean {
  return up.dom.getElementById(id).parentElement?.hidden === false
}

function plotData(up: UpstreamHardwareReport, name: string): Trace[] {
  return up.get(`${name}.data`) as Trace[]
}

function compareFirmware({ up, port }: Compared): void {
  const f = port.firmware
  const ver = up.dom.getElementById('VER')
  expect(ver.hidden).toBe(f.fwString === undefined)
  if (f.fwString !== undefined) expect(ver.textContent).toBe(f.fwString + (f.osString ?? ''))
  const fc = up.dom.getElementById('FC')
  const haveFc = f.flightController !== undefined || f.boardId !== undefined
  expect(fc.hidden).toBe(!haveFc)
  if (haveFc) {
    let text = f.flightController ?? ''
    if (f.boardId !== undefined) text += `Board ID: ${f.boardId}` + (f.boardName === undefined ? '' : ` ${f.boardName}`)
    expect(fc.textContent).toBe(text)
  }
}

function compareIomcu({ up, port }: Compared): void {
  const el = up.dom.getElementById('IOMCU')
  expect(el.hidden).toBe(port.iomcu === undefined)
  if (port.iomcu === undefined) return
  const mark = (n: number | undefined): string => `${n} ${n == 0 ? '✅' : '❌'}`
  const i = port.iomcu
  let text = ''
  if (i.statusReadErrors !== undefined) text += `Status read errors: ${mark(i.statusReadErrors)}`
  text += `Flight Controller errors: ${mark(i.flightControllerErrors)}`
  text += `IOMCU errors: ${mark(i.iomcuErrors)}`
  text += `Delayed packets: ${mark(i.delayedPackets)}`
  expect(el.textContent).toBe(text)
}

function compareBoardHealth({ up, port }: Compared): void {
  const t = port.plots.temperature
  expect(plotShown(up, 'Temperature')).toBe(t !== undefined)
  if (t !== undefined) {
    const traces = plotData(up, 'Temperature')
    expectSeries(traces[0], t.heaterTarget, 'heater target')
    expectSeries(traces[1], t.heaterActual, 'heater actual')
    expectSeries(traces[2], t.mcu, 'MCU temperature')
    for (let i = 3; i < traces.length; i++) {
      const name = traces[i]?.name
      expectSeries(
        traces[i],
        t.imu.find((s) => s.name === name),
        name ?? ''
      )
    }
  }

  const v = port.plots.voltage
  expect(plotShown(up, 'Board_Voltage')).toBe(v !== undefined)
  if (v !== undefined) {
    const traces = plotData(up, 'Board_Voltage')
    expectSeries(traces[1], v.servo, 'servo')
    expectSeries(traces[2], v.board, 'board')
    expectSeries(traces[3], v.mcu?.voltage, 'MCU voltage')
    const time = arr(v.mcu?.voltage.time)
    const envelope =
      v.mcu === undefined || time === undefined
        ? { x: undefined, y: undefined }
        : { x: [...time, ...[...time].reverse()], y: [...Array.from(v.mcu.max), ...Array.from(v.mcu.min).reverse()] }
    expect(arr(traces[0]?.x)).toEqual(envelope.x)
    expect(arr(traces[0]?.y)).toEqual(envelope.y)
  }

  const f = port.plots.powerFlags
  expect(plotShown(up, 'power_flags')).toBe(f !== undefined)
  if (f !== undefined) {
    const traces = plotData(up, 'power_flags')
    const ys = [f.brickValid, f.servoValid, f.usbConnected, f.periphOvercurrent, f.periphHipowerOvercurrent]
    ys.forEach((y, i) => expectSeries(traces[i], { name: '', time: f.time, values: y }, `flag ${i}`))
  }
}

function comparePerformance({ up, port }: Compared): void {
  const p = port.plots.performance
  expect(up.dom.getElementById('CPU').hidden).toBe(p === undefined)
  if (p !== undefined) {
    expectSeries(plotData(up, 'performance_load')[0], p.load, 'load')
    expectSeries(plotData(up, 'performance_mem')[0], p.freeMemory, 'memory')
    expectSeries(plotData(up, 'performance_time')[0], p.worstLoopRate, 'worst loop rate')
    expectSeries(plotData(up, 'performance_time')[1], p.averageLoopRate, 'average loop rate')
  }

  const stacks = port.plots.stacks
  expect(up.dom.getElementById('Stack').hidden).toBe(stacks.length === 0)
  if (stacks.length > 0) {
    const mem = plotData(up, 'stack_mem')
    const pct = plotData(up, 'stack_pct')
    expect(mem.map((t) => t.name)).toEqual(stacks.map((s) => s.name))
    stacks.forEach((s, i) => {
      expectSeries(mem[i], { name: s.name, time: s.time, values: s.free }, `${s.name} free`)
      expectSeries(pct[i], { name: s.name, time: s.time, values: s.usedPercent }, `${s.name} used`)
    })
  }
}

/** Upstream data-rate plots: one `div` per plot holding the title, an optional note and the plot. */
function upstreamDataRates(up: UpstreamHardwareReport): { title: string; note: string | undefined; traces: Trace[] }[] {
  return up.dom.getElementById('DataRates').children.map((div) => {
    const plot = div.children.find((c) => c.data !== undefined) as FakeElement
    const note = div.children.find((c) => c.nodeName === 'p')
    return { title: div.children[0]?.textContent ?? '', note: note?.textContent, traces: plot.data as Trace[] }
  })
}

function compareDataRates({ up, port }: Compared): void {
  const ups = upstreamDataRates(up)
  const { uartRates, canRates } = port.plots
  expect(ups.map((r) => r.title)).toEqual([...uartRates.map((u) => u.title), ...canRates.map((c) => c.title)])
  uartRates.forEach((u, i) => {
    const traces = ups[i]?.traces ?? []
    expectSeries(traces[0], { name: '', time: u.time, values: u.rx }, `${u.title} rx`)
    expectSeries(traces[1], { name: '', time: u.time, values: u.tx }, `${u.title} tx`)
    const limit = traces[2]
    expect(limit === undefined, `${u.title} limit shown`).toBe(u.limit === undefined)
    if (limit !== undefined) {
      expect(arr(limit.x)).toEqual([u.time[0], u.time[u.time.length - 1]])
      expect(arr(limit.y)).toEqual([u.limit, u.limit])
    }
  })
  canRates.forEach((c, j) => {
    const r = ups[uartRates.length + j]
    const traces = r?.traces ?? []
    expectSeries(traces[0], { name: '', time: c.time, values: c.rx }, `${c.title} rx`)
    expectSeries(traces[1], { name: '', time: c.time, values: c.tx }, `${c.title} tx`)
    expectSeries(traces[2], { name: '', time: c.time, values: c.total }, `${c.title} total`)
    const limit = traces[3]
    expect(limit === undefined, `${c.title} limit shown`).toBe(c.worstCaseLimit === undefined)
    expect(r?.note !== undefined).toBe(c.worstCaseLimit !== undefined)
    if (limit !== undefined) {
      expect(arr(limit.x)).toEqual([c.time[0], c.time[c.time.length - 1]])
      expect(arr(limit.y)).toEqual([c.worstCaseLimit, c.worstCaseLimit])
    }
  })
}

function compareCan({ up, port }: Compared): void {
  const section = up.dom.getElementById('DroneCAN')
  expect(section.hidden).toBe(port.can.nodes.length === 0)
  const upstream = section.children.flatMap((c) =>
    c.nodeName === 'h4' ? [c.textContent] : c.getElementsByTagName('fieldset').map((f) => f.textContent)
  )
  const expected: string[] = []
  let driver: string | undefined
  for (const n of port.can.nodes) {
    if (port.can.haveDriverNum && String(n.driver) !== driver) {
      driver = String(n.driver)
      expected.push(`Driver ${driver}:`)
    }
    expected.push(
      `Node id ${n.nodeId}Name: ${n.name}Firmware version: ${n.version}UID1: 0x${n.uid1.toString(16)}UID2: 0x${n.uid2.toString(16)}`
    )
  }
  expect(upstream).toEqual(expected)
}

function compareMissions({ up, port }: Compared): void {
  const section = up.dom.getElementById('WAYPOINTS')
  const links = section.getElementsByTagName('a')
  const sets = [
    ...port.missions.missions.map((s, i) => [`waypoints_${i}.txt`, s] as const),
    ...port.missions.fences.map((s, i) => [`fence_${i}.txt`, s] as const),
    ...port.missions.rally.map((s, i) => [`rally_${i}.txt`, s] as const)
  ]
  expect(links.map((a) => a.textContent)).toEqual(sets.map(([name]) => name))
  links.forEach((a, i) => {
    const entry = sets[i]
    if (entry === undefined) return
    up.saved.length = 0
    up.alerts.length = 0
    a.dispatch('click')
    const file = waypointFileText(entry[1])
    expect(up.saved).toEqual([{ name: entry[0], parts: [file.text] }])
    expect(up.alerts).toEqual(file.complete ? [] : ['Mission incomplete'])
  })
}

/**
 * The port's file with each 64-byte FILE chunk's trailing zeros removed, as upstream's
 * NUL-stripped `Data` strings hold it.
 */
function strippedChunks(data: Uint8Array): number[] {
  const out: number[] = []
  for (let at = 0; at < data.length; at += 64) {
    const chunk = Array.from(data.subarray(at, at + 64))
    while (chunk.length > 0 && chunk[chunk.length - 1] === 0) chunk.pop()
    out.push(...chunk)
  }
  return out
}

/**
 * Upstream's downloads against the port's files: identical, except for the files named in
 * `fixed`, where upstream's `processFiles()` appended a second copy or dropped trailing zero bytes
 * (proven upstream bug, docs/bug-proofs/js-dataflash-parser.md). For those the port holds the last
 * copy with every byte, so upstream's bytes end with the port's file read the upstream way.
 */
function compareFiles({ up, port }: Compared, fixed: readonly string[] = []): void {
  const section = up.dom.getElementById('FILES')
  const links = section.getElementsByTagName('a')
  expect(links.map((a) => a.textContent)).toEqual(port.files.map((f) => f.name))
  links.forEach((a, i) => {
    up.saved.length = 0
    a.dispatch('click')
    const saved = up.saved[0]
    const name = port.files[i]?.name ?? ''
    expect(saved?.name).toBe(name)
    const theirs = Array.from(saved?.parts[0] as Uint8Array)
    const mine = port.files[i]?.data ?? new Uint8Array()
    if (!fixed.includes(name)) {
      expect(Array.from(mine), name).toEqual(theirs)
      return
    }
    expect(Array.from(mine), name).not.toEqual(theirs)
    const read = strippedChunks(mine)
    expect(theirs.slice(theirs.length - read.length), name).toEqual(read)
  })
}

function compareWarnings({ up, port }: Compared): void {
  const tables = up.dom.getElementById('warnings').children
  // Watchdog and arming warnings are raised by sections outside this file's scope but share the list.
  expect(tables.map((t) => t.textContent)).toEqual(
    port.warnings.map((w) => (w.link === undefined ? w.message : `${w.message}For more information see ArduPilot documentation.`))
  )
  // `img.src` is assigned as a property, which the fake DOM keeps as an own field.
  const icons = tables.map((t) => String(Reflect.get(t.getElementsByTagName('img')[0] ?? {}, 'src')))
  expect(icons.map((src) => !src.includes('orange'))).toEqual(port.warnings.map((w) => w.level === 'error'))
  const links = tables.map((t) => t.getElementsByTagName('a')[0]?.href)
  expect(links).toEqual(port.warnings.map((w) => w.link))
}

function compareLogging({ up, port }: Compared): void {
  const l = port.plots.logging
  expect(plotShown(up, 'log_dropped')).toBe(l !== undefined)
  if (l !== undefined) {
    expectSeries(plotData(up, 'log_dropped')[0], l.dropped, 'dropped')
    const buffer = plotData(up, 'log_buffer')
    expectSeries(buffer[0], l.bufferMax, 'buffer max')
    expectSeries(buffer[1], l.bufferAverage, 'buffer average')
    expectSeries(buffer[2], l.bufferMin, 'buffer min')
  }
  const pie = (up.get('log_stats.data') as { labels: string[]; values: number[] }[])[0]
  expect(pie?.labels).toEqual(port.logStats.messages.map((m) => m.name))
  expect(pie?.values).toEqual(port.logStats.messages.map((m) => m.bytes))
  expect(up.dom.getElementById('LOGSTATS').textContent).toBe(`Total size: ${port.logStats.totalBytes} Bytes`)
}

function compareClockDrift({ up, port }: Compared): void {
  const d = port.plots.clockDrift
  expect(plotShown(up, 'clock_drift')).toBe(d !== undefined)
  const traces = up.get('clock_drift.data') as Trace[]
  expect(traces.map((t) => t.name)).toEqual(d?.series.map((s) => s.name) ?? [])
  d?.series.forEach((s, i) => expectSeries(traces[i], s, s.name))
  const yaxis = (up.get('clock_drift.layout') as { yaxis: { range?: number[]; autorange?: boolean } }).yaxis
  expect(yaxis.range).toEqual(d?.yRange === undefined ? undefined : [-d.yRange, d.yRange])
}

function compareAll(c: Compared, fixedFiles: readonly string[] = []): void {
  compareFirmware(c)
  compareIomcu(c)
  compareBoardHealth(c)
  comparePerformance(c)
  compareDataRates(c)
  compareCan(c)
  compareMissions(c)
  compareFiles(c, fixedFiles)
  compareWarnings(c)
  compareLogging(c)
  compareClockDrift(c)
}

describe.each(['copter-sitl.bin', 'copter-files.bin'])('oracle load_log sections: %s', (fixture) => {
  it('matches upstream', async () => {
    const c = await both(readFixture(fixture))
    expect(c.up.alerts).toEqual([])
    // copter-files.bin logs uarts.txt, memory.txt and threads.txt twice, and storage.bin with
    // zero-ended chunks.
    const fixed = ['@SYS/uarts.txt', '@SYS/memory.txt', '@SYS/threads.txt', '@SYS/storage.bin']
    compareAll(c, fixture === 'copter-files.bin' ? fixed : [])
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
    compareAll(c)
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
    compareAll(c)
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
    compareAll(await both(log.bytes()))
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
    compareAll(c)
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
    compareAll(c, ['@SYS/uarts.txt'])
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
    compareAll(c)
    expect(c.port.plots.clockDrift?.series.map((s) => s.name)).toEqual(['GPS 0', 'GPS 1'])
  })
})
