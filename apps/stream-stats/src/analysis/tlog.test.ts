import { describe, expect, it } from 'vitest'
import { TlogTimeError, parseTlog, type Tlog } from './tlog.js'
import { buildTlog, type FrameSpec } from './test-support/tlog-writer.js'
import { loadUpstream } from './test-support/upstream.js'
import { rng } from './test-support/random.js'

const T0 = 1_700_000_000_000_000n

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

/** Compare the port with upstream `load_tlog`'s `system` object. */
function expectMatchesUpstream(bytes: Uint8Array, tlog: Tlog) {
  const upstream = loadUpstream()
  upstream.loadTlog(bufferOf(bytes))
  const system = upstream.system()
  const expected = Object.entries(system).flatMap(([sys, comps]) =>
    Object.entries(comps).map(([comp, c]) => ({
      systemId: Number(sys),
      componentId: Number(comp),
      received: c.received,
      dropped: c.dropped,
      versions: [...c.version].sort(),
      signed: Boolean(c.signed),
      messages: Object.entries(c.msg).map(([name, m]) => ({
        name,
        time: Array.from(m.time),
        sizeBits: Array.from(m.size),
        versions: [...m.version].sort(),
        signed: Boolean(m.signed)
      }))
    }))
  )
  const actual = tlog.components.map((c) => ({
    systemId: c.systemId,
    componentId: c.componentId,
    received: c.received,
    dropped: c.dropped,
    versions: [...c.versions].sort(),
    signed: c.signed,
    messages: c.messages.map((m) => ({
      name: m.name,
      time: Array.from(m.time),
      sizeBits: Array.from(m.sizeBits),
      versions: [...m.versions].sort(),
      signed: m.signed
    }))
  }))
  expect(actual).toEqual(expected)
}

describe('parseTlog', () => {
  it('collects frames per component and message', () => {
    const bytes = buildTlog([
      { timeUs: T0, name: 'HEARTBEAT', version: 1, sequence: 0 },
      { timeUs: T0 + 500_000n, name: 'ATTITUDE', payloadLength: 28, sequence: 1 },
      { timeUs: T0 + 1_000_000n, name: 'HEARTBEAT', sequence: 2, signed: true },
      { timeUs: T0 + 1_100_000n, name: 'HEARTBEAT', systemId: 255, componentId: 190, sequence: 9 }
    ])
    const tlog = parseTlog(bytes)
    expect(tlog.startTime?.getTime()).toBe(Number(T0 / 1000n))
    expect(tlog.duration).toBeCloseTo(1.1)
    expect(tlog.components.map((c) => [c.systemId, c.componentId])).toEqual([
      [1, 1],
      [255, 190]
    ])
    const [ap] = tlog.components
    expect(ap?.received).toBe(3)
    expect(ap?.dropped).toBe(0)
    expect([...(ap?.versions ?? [])].sort()).toEqual([1, 2])
    expect(ap?.signed).toBe(true)
    expect(ap?.messages.map((m) => m.name)).toEqual(['HEARTBEAT', 'ATTITUDE'])
    const heartbeat = ap?.messages[0]
    expect(Array.from(heartbeat?.time ?? [])).toEqual([0, 1])
    // MAVLink 1: 8 + 9 bytes; MAVLink 2 signed: 12 + 9 + 13 bytes.
    expect(Array.from(heartbeat?.sizeBits ?? [])).toEqual([17 * 8, 34 * 8])
    expect(ap?.messages[1]?.signed).toBe(false)
    expectMatchesUpstream(bytes, tlog)
  })

  it('counts sequence gaps as dropped, across the 255 wrap', () => {
    const frames: FrameSpec[] = [253, 254, 1, 2, 5].map((sequence, i) => ({
      timeUs: T0 + BigInt(i) * 1000n,
      name: 'SYS_STATUS',
      sequence
    }))
    const bytes = buildTlog(frames)
    const tlog = parseTlog(bytes)
    // 254 -> 1 skips 255 and 0; 2 -> 5 skips 3 and 4.
    expect(tlog.components[0]?.dropped).toBe(4)
    expect(tlog.components[0]?.received).toBe(5)
    expectMatchesUpstream(bytes, tlog)
  })

  it('skips junk, unknown ids and bad checksums, and stops at a truncated frame', () => {
    const bytes = buildTlog([
      Uint8Array.of(1, 2, 3, 0xfe, 0xfd),
      { timeUs: T0, name: 'HEARTBEAT' },
      { timeUs: T0 + 10n, name: 'HEARTBEAT', corrupt: true, sequence: 1 },
      Uint8Array.of(0xfd, 0, 0, 0, 0, 1, 1, 0xff, 0xff, 0xff, 0, 0),
      { timeUs: T0 + 20n, name: 'GPS_RAW_INT', payloadLength: 30, sequence: 2 },
      Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0xfe, 200, 0, 1, 1, 0)
    ])
    const tlog = parseTlog(bytes)
    expect(tlog.components[0]?.received).toBe(2)
    expect(tlog.components[0]?.messages.map((m) => m.name)).toEqual(['HEARTBEAT', 'GPS_RAW_INT'])
    expectMatchesUpstream(bytes, tlog)
  })

  it('returns no components for data without frames', () => {
    const tlog = parseTlog(new Uint8Array(64))
    expect(tlog.components).toEqual([])
    expect(tlog.startTime).toBeUndefined()
  })

  it('rejects timestamps that go backwards, as upstream does', () => {
    const bytes = buildTlog([
      { timeUs: T0 + 1000n, name: 'HEARTBEAT' },
      { timeUs: T0, name: 'HEARTBEAT', sequence: 1 }
    ])
    expect(() => parseTlog(bytes)).toThrow(TlogTimeError)
    const upstream = loadUpstream()
    expect(() => upstream.loadTlog(bufferOf(bytes))).toThrow()
    expect(upstream.alerts).toEqual(['Time went backwards!'])
  })

  it('matches upstream on a random multi-component stream', () => {
    const next = rng(42)
    const names = ['HEARTBEAT', 'ATTITUDE', 'GLOBAL_POSITION_INT', 'RC_CHANNELS', 'TIMESYNC', 'RADIO_STATUS'] as const
    const sequences = new Map<string, number>()
    const parts: (FrameSpec | Uint8Array)[] = []
    let t = T0
    for (let i = 0; i < 2000; i++) {
      t += BigInt(Math.floor(next() * 20_000))
      const systemId = next() < 0.8 ? 1 : 255
      const componentId = systemId === 1 ? (next() < 0.9 ? 1 : 68) : 190
      const key = `${systemId},${componentId}`
      const sequence = ((sequences.get(key) ?? 0) + (next() < 0.05 ? 2 : 1)) % 256
      sequences.set(key, sequence)
      const name = names[Math.floor(next() * names.length)] ?? 'HEARTBEAT'
      parts.push({
        timeUs: t,
        name,
        version: next() < 0.2 ? 1 : 2,
        payloadLength: 1 + Math.floor(next() * 40),
        systemId,
        componentId,
        sequence,
        signed: next() < 0.1,
        corrupt: next() < 0.02
      })
      if (next() < 0.03) parts.push(Uint8Array.of(0xfe, 0xfd, Math.floor(next() * 256)))
    }
    const bytes = buildTlog(parts)
    expectMatchesUpstream(bytes, parseTlog(bytes))
  })
})
