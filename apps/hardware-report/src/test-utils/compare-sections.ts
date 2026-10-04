// Test-only: the comparisons of upstream `load_log()` log sections (firmware and board, IOMCU, board
// health plots, performance, thread stacks, data rates, DroneCAN nodes, missions/fences/rally
// downloads, embedded files, warnings, logger stats and clock drift) against the port's
// `buildLogReport()`. Shared by the oracle tests and the real-log test.
import { expect } from 'vitest'
import type { LogReport } from '../analysis/report.js'
import { waypointFileText } from '../analysis/missions.js'
import type { Series } from '../analysis/series.js'
import type { FakeElement, UpstreamHardwareReport } from './upstream.js'

interface Trace {
  name?: string
  x?: ArrayLike<number>
  y?: ArrayLike<number>
}

export interface Compared {
  up: UpstreamHardwareReport
  port: LogReport
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

export function compareLogSections(c: Compared, fixedFiles: readonly string[] = []): void {
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
