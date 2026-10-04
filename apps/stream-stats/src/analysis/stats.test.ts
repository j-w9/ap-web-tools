import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { binStreams } from './bin.js'
import {
  EMPTY_SELECTION,
  dropPercent,
  streamStats,
  versionsLabel,
  type ComponentKey,
  type MessageKey,
  type RateUnit,
  type StreamStats
} from './stats.js'
import { parseTlog } from './tlog.js'
import { buildTlog, type FrameSpec } from './test-support/tlog-writer.js'
import { loadUpstream, type UpstreamFakeBinLog, type UpstreamStreamStats } from './test-support/upstream.js'
import { rng } from './test-support/random.js'

const T0 = 1_700_000_000_000_000n

function randomTlog(seed: number): Uint8Array {
  const next = rng(seed)
  const names = ['HEARTBEAT', 'ATTITUDE', 'VFR_HUD', 'RADIO_STATUS'] as const
  const parts: FrameSpec[] = []
  let t = T0
  const seq = new Map<number, number>()
  for (let i = 0; i < 1500; i++) {
    t += BigInt(Math.floor(next() * 60_000))
    const componentId = next() < 0.7 ? 1 : 68
    const sequence = ((seq.get(componentId) ?? 0) + 1) % 256
    seq.set(componentId, sequence)
    parts.push({
      timeUs: t,
      name: names[Math.floor(next() * names.length)] ?? 'HEARTBEAT',
      componentId,
      sequence,
      payloadLength: 1 + Math.floor(next() * 30),
      version: next() < 0.3 ? 1 : 2
    })
  }
  return buildTlog(parts)
}

function upstreamResult(upstream: UpstreamStreamStats) {
  const total = upstream.total()
  const composition = upstream.composition()
  return {
    rates: upstream.rates().map((r) => ({ name: r.name, time: Array.from(r.x ?? []), rate: Array.from(r.y ?? []) })),
    total: total.x === null ? null : { time: Array.from(total.x), rate: Array.from(total.y ?? []) },
    composition: Array.from(composition.labels, (label, i) => ({ label, value: composition.values[i] }))
  }
}

/** Upstream's `.bin` result with its bits-mode pie converted from bytes to bits. */
function bitsPie(result: ReturnType<typeof upstreamResult>, unit: RateUnit): ReturnType<typeof upstreamResult> {
  if (unit !== 'bits') return result
  return { ...result, composition: result.composition.map((c) => ({ ...c, value: (c.value ?? 0) * 8 })) }
}

function portResult(stats: StreamStats) {
  return {
    rates: stats.rates.map((r) => ({ name: r.name, time: Array.from(r.time), rate: Array.from(r.rate) })),
    total: stats.total === null ? null : { time: Array.from(stats.total.time), rate: Array.from(stats.total.rate) },
    composition: stats.composition.map((c) => ({ ...c }))
  }
}

describe('streamStats for a tlog', () => {
  const bytes = randomTlog(3)
  const tlog = parseTlog(bytes)

  for (const unit of ['bits', 'messages'] as const satisfies readonly RateUnit[]) {
    for (const width of [1, 10, 0.25]) {
      it(`matches upstream plot_tlog (${unit}, ${width} s)`, () => {
        const upstream = loadUpstream()
        upstream.loadTlog(bytes.slice().buffer)
        upstream.setSettings(width, unit === 'bits')
        upstream.plotTlog()
        const stats = streamStats(
          { kind: 'tlog', tlog, selection: { excludedComponents: new Set(), excludedMessages: new Set() } },
          { unit, binWidth: width }
        )
        expect(portResult(stats)).toEqual(upstreamResult(upstream))
      })
    }
  }

  it('matches upstream with components and messages excluded', () => {
    const upstream = loadUpstream()
    upstream.loadTlog(bytes.slice().buffer)
    const system = upstream.system()
    system['1']!['68']!.include.checked = false
    system['1']!['1']!.msg['ATTITUDE']!.include.checked = false
    upstream.setSettings(5, true)
    upstream.plotTlog()
    // Upstream disables (but keeps checked) the message checkboxes of an excluded component.
    expect(system['1']!['68']!.msg['HEARTBEAT']!.include.disabled).toBe(true)
    const excludedMessages = new Set<MessageKey>(['1,1,ATTITUDE'])
    const stats = streamStats(
      { kind: 'tlog', tlog, selection: { excludedComponents: new Set(['1,68']), excludedMessages } },
      { unit: 'bits', binWidth: 5 }
    )
    expect(stats.rates.map((r) => r.key)).toEqual(['1,1,HEARTBEAT', '1,1,VFR_HUD', '1,1,RADIO_STATUS'])
    expect(portResult(stats)).toEqual(upstreamResult(upstream))
  })

  // Window sizes below the box's min="0.1" (proven upstream bug, fixed: docs/bug-proofs/stream-stats.md).
  it('rejects a negative window, where upstream plots negative rates', () => {
    const upstream = loadUpstream()
    upstream.loadTlog(bytes.slice().buffer)
    upstream.setSettings(-4, true)
    upstream.plotTlog()
    expect(upstream.rates().some((r) => (r.y ?? []).some((v) => v < 0))).toBe(true)
    expect(() => streamStats({ kind: 'tlog', tlog, selection: EMPTY_SELECTION }, { unit: 'bits', binWidth: -4 })).toThrow(
      new RangeError('Window size must be a number of at least 0.1 s')
    )
  })

  for (const width of [0, Number.NaN]) {
    it(`rejects a ${width} s window, where upstream throws while binning (or plots nothing when everything is excluded)`, () => {
      const upstream = loadUpstream()
      upstream.loadTlog(bytes.slice().buffer)
      upstream.setSettings(width, true)
      expect(() => upstream.plotTlog()).toThrow('Invalid array length')
      const none = { excludedComponents: new Set<ComponentKey>(['1,1', '1,68']), excludedMessages: new Set<MessageKey>() }
      for (const selection of [EMPTY_SELECTION, none]) {
        expect(() => streamStats({ kind: 'tlog', tlog, selection }, { unit: 'bits', binWidth: width })).toThrow(
          new RangeError('Window size must be a number of at least 0.1 s')
        )
      }
    })
  }

  it('has no total when everything is excluded', () => {
    const stats = streamStats(
      { kind: 'tlog', tlog, selection: { excludedComponents: new Set(['1,1', '1,68']), excludedMessages: new Set() } },
      { unit: 'messages', binWidth: 1 }
    )
    expect(stats).toEqual({ rates: [], total: null, composition: [] })
  })

  it('formats versions and drop rates like upstream', () => {
    expect(versionsLabel(new Set([2, 1]))).toBe('1, 2')
    expect(dropPercent({ dropped: 1, received: 8 }).toFixed(2)).toBe('12.50')
  })
})

describe('streamStats for a DataFlash log', () => {
  const fixtures = resolve(__dirname, '../../../../packages/dataflash/test-fixtures')

  type UpstreamParserCtor = new (sendPostMessage: boolean) => UpstreamFakeBinLog & {
    processData(buffer: ArrayBuffer, msgs: string[]): unknown
  }

  /** The real upstream JsDataflashParser, as upstream `load_log` uses it. */
  async function upstreamParser(buffer: ArrayBuffer): Promise<UpstreamFakeBinLog> {
    const g: Record<string, unknown> = globalThis
    g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
    const path = resolve(__dirname, '../../../../upstream/modules/JsDataflashParser/parser.js')
    const mod: { default: UpstreamParserCtor } = await import(/* @vite-ignore */ path)
    const log = new mod.default(false)
    log.processData(buffer, [])
    return log
  }

  function fixture(name: string): ArrayBuffer {
    const buffer = readFileSync(resolve(fixtures, name))
    return new Uint8Array(buffer).slice().buffer
  }

  for (const file of ['copter-sitl.bin', 'copter-files.bin']) {
    for (const unit of ['bits', 'messages'] as const satisfies readonly RateUnit[]) {
      for (const width of [2, 10]) {
        it(`matches upstream plot_log on ${file} (${unit}, ${width} s)`, async () => {
          const upstream = loadUpstream()
          upstream.setSettings(width, unit === 'bits')
          upstream.plotLog(await upstreamParser(fixture(file)))
          const log = binStreams(DataflashLog.parse(fixture(file)))
          const stats = streamStats({ kind: 'bin', log }, { unit, binWidth: width })
          expect(stats.rates.length).toBeGreaterThan(5)
          // Includes zero-count types. In bits mode upstream's pie holds bytes under a "bits" hover;
          // the port's holds bits (proven upstream bug, fixed): everything else is identical.
          expect(portResult(stats)).toEqual(bitsPie(upstreamResult(upstream), unit))
        })
      }
      it(`rejects a negative window on ${file} (${unit}), where upstream plots negative rates`, async () => {
        const upstream = loadUpstream()
        upstream.setSettings(-3, unit === 'bits')
        upstream.plotLog(await upstreamParser(fixture(file)))
        expect(upstream.rates().some((r) => (r.y ?? []).some((v) => v < 0))).toBe(true)
        const log = binStreams(DataflashLog.parse(fixture(file)))
        expect(() => streamStats({ kind: 'bin', log }, { unit, binWidth: -3 })).toThrow(RangeError)
      })
    }
  }

  it('plots bits in the bits pie (upstream: bytes) and lists types without records, as upstream', async () => {
    const log = binStreams(DataflashLog.parse(fixture('copter-sitl.bin')))
    const stats = streamStats({ kind: 'bin', log }, { unit: 'bits', binWidth: 10 })
    const imu = log.messages.find((m) => m.name === 'IMU')
    expect(stats.composition.find((c) => c.label === 'IMU')?.value).toBe((imu?.totalBytes ?? 0) * 8)
    const upstream = loadUpstream()
    upstream.plotLog(await upstreamParser(fixture('copter-sitl.bin')))
    const labels = upstream.composition().labels
    expect(upstream.composition().values[labels.indexOf('IMU')]).toBe(imu?.totalBytes)
    expect(upstream.composition().values).toContain(0)
    expect(stats.composition.some((c) => c.value === 0)).toBe(true)
  })

  it('loads an empty file as an empty log; FMT is 0 bits, where upstream has NaN', async () => {
    const empty = new ArrayBuffer(100)
    const upstream = loadUpstream()
    upstream.plotLog(await upstreamParser(empty))
    const log = binStreams(DataflashLog.parse(empty))
    // Upstream's built-in FMT has no Size (proven upstream bug, fixed): its slice is NaN.
    expect(upstreamResult(upstream).composition).toEqual([{ label: 'FMT', value: NaN }])
    expect(log.messages.find((m) => m.name === 'FMT')).toMatchObject({ count: 0, recordBytes: 89, totalBytes: 0 })
    expect(portResult(streamStats({ kind: 'bin', log }, { unit: 'bits', binWidth: 10 }))).toEqual({
      ...upstreamResult(upstream),
      composition: [{ label: 'FMT', value: 0 }]
    })
  })
})
