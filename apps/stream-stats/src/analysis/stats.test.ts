import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { binStreams } from './bin.js'
import { dropPercent, streamStats, versionsLabel, type MessageKey, type RateUnit, type StreamStats } from './stats.js'
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
  const buffer = readFileSync(resolve(__dirname, '../../../../packages/dataflash/test-fixtures/copter-sitl.bin'))
  const parsed = DataflashLog.parse(new Uint8Array(buffer))
  const log = binStreams(parsed)

  /** An object shaped like upstream's DataflashParser, backed by the same parsed log. */
  function fakeUpstreamLog(): UpstreamFakeBinLog {
    const stats: ReturnType<UpstreamFakeBinLog['stats']> = {}
    for (const [name, s] of parsed.stats()) stats[name] = { count: s.count, msg_size: s.recordSize, size: s.bytes }
    const messageTypes: UpstreamFakeBinLog['messageTypes'] = {}
    for (const [name, info] of parsed.messageTypes()) {
      messageTypes[name] = { expressions: [...info.fieldNames] }
      if (info.instances)
        messageTypes[name].instances = Object.fromEntries([...info.instances.keys()].map((i) => [String(i), {}]))
    }
    return {
      stats: () => stats,
      messageTypes,
      get: (name, field) => Array.from(parsed.getNumbers(name, field) ?? []),
      get_instance: (name, instance, field) => Array.from(parsed.getNumbers(name, field, Number(instance)) ?? []),
      data: { byteLength: parsed.byteLength }
    }
  }

  for (const unit of ['bits', 'messages'] as const satisfies readonly RateUnit[]) {
    it(`matches upstream plot_log (${unit})`, () => {
      const upstream = loadUpstream()
      upstream.setSettings(2, unit === 'bits')
      upstream.plotLog(fakeUpstreamLog())
      const expected = upstreamResult(upstream)
      // Deviations: zero-count types are left out, and the pie counts bits rather than bytes.
      expected.composition = expected.composition
        .filter((c) => (parsed.stats().get(c.label)?.count ?? 0) > 0)
        .map((c) => ({ label: c.label, value: unit === 'bits' ? (c.value ?? 0) * 8 : c.value }))
      const stats = streamStats({ kind: 'bin', log }, { unit, binWidth: 2 })
      expect(stats.rates.length).toBeGreaterThan(5)
      expect(portResult(stats)).toEqual(expected)
    })
  }
})
