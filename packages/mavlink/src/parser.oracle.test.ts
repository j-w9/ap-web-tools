// Oracle tests for framing and signing: the same bytes, in the same chunks, fed to this package's
// MavlinkParser and to upstream's MAVLink20Processor.parseBuffer (mavlink.js run in node:vm) must
// produce the same messages and the same discarded byte runs (upstream's BAD_DATA messages), in the
// same order, with the same counters and signing state afterwards. Signatures, SHA-256 and the
// signing timestamp are compared byte for byte.
import { beforeAll, describe, expect, it } from 'vitest'
import { crcAccumulate, crcX25 } from './crc.js'
import type { MessageDescriptor } from './descriptor.js'
import { ALL_MESSAGES, ATTITUDE, HEARTBEAT, MISSION_CLEAR_ALL, SYS_STATUS } from './generated/messages.js'
import { MavlinkParser, type ParseEvent } from './parser.js'
import { sha256 } from './sha256.js'
import { createSignature, INCOMPAT_FLAG_SIGNED, MavlinkSigning, signingTimestamp } from './signing.js'
import { random } from './test-utils/random.js'
import {
  loadUpstream,
  type UpstreamHeader,
  type UpstreamMavlink,
  type UpstreamMessage,
  type UpstreamProcessor
} from './test-utils/upstream.js'

let upstream: UpstreamMavlink
beforeAll(async () => {
  upstream = await loadUpstream()
})

const hex = (bytes: ArrayLike<number>): string => Buffer.from(Uint8Array.from(bytes)).toString('hex')
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
const WRONG_KEY = KEY.map((b) => b ^ 0x5a)
const T0 = 1_000_000_000_000

interface FrameOptions {
  readonly version?: 1 | 2
  readonly sequence?: number
  readonly systemId?: number
  readonly componentId?: number
  readonly incompatFlags?: number
  readonly compatFlags?: number
  readonly messageId?: number
  /** Signs with this state (the SIGNED flag is added to `incompatFlags`). */
  readonly signing?: MavlinkSigning
}

/** A frame carrying exactly `payload`, with a correct checksum for `descriptor`. */
function rawFrame(descriptor: MessageDescriptor, payload: Uint8Array, options: FrameOptions = {}): Uint8Array {
  const v1 = options.version === 1
  const id = options.messageId ?? descriptor.id
  const flags = (options.incompatFlags ?? 0) | (options.signing === undefined ? 0 : INCOMPAT_FLAG_SIGNED)
  const header = v1
    ? [0xfe, payload.length, options.sequence ?? 0, options.systemId ?? 1, options.componentId ?? 1, id & 0xff]
    : [
        0xfd,
        payload.length,
        flags,
        options.compatFlags ?? 0,
        options.sequence ?? 0,
        options.systemId ?? 1,
        options.componentId ?? 1,
        id & 0xff,
        (id >> 8) & 0xff,
        id >> 16
      ]
  const frame = new Uint8Array(header.length + payload.length + 2)
  frame.set(header)
  frame.set(payload, header.length)
  const crc = crcAccumulate(descriptor.crcExtra, crcX25(frame.subarray(1, header.length + payload.length)))
  frame[frame.length - 2] = crc & 0xff
  frame[frame.length - 1] = crc >> 8
  return options.signing === undefined ? frame : options.signing.sign(frame)
}

type Mode = 'no key' | 'key' | 'key, allow even ids'

/** Upstream and package parsers configured alike. */
function parsers(mode: Mode): { theirs: UpstreamProcessor; ours: MavlinkParser; signing: MavlinkSigning | undefined } {
  const theirs = new upstream.MAVLink20Processor(null, 255, 190)
  if (mode === 'no key') return { theirs, ours: new MavlinkParser({ messages: ALL_MESSAGES }), signing: undefined }
  theirs.signing.secret_key = KEY
  theirs.signing.timestamp = T0
  if (mode === 'key, allow even ids') theirs.signing.allow_unsigned_callback = (_processor, msgId) => msgId % 2 === 0
  const signing = new MavlinkSigning({
    secretKey: KEY,
    timestamp: T0,
    ...(mode === 'key, allow even ids' ? { allowUnsigned: (header) => header.messageId % 2 === 0 } : {})
  })
  return { theirs, ours: new MavlinkParser({ messages: ALL_MESSAGES, signing }), signing }
}

function describeUpstream(m: UpstreamMessage): string {
  if (m._name === 'BAD_DATA') return `bad ${hex(m._data as Uint8Array)}`
  const h = m._header as UpstreamHeader
  const link = m._signed === true ? String(m._link_id) : '-'
  const header = [h.mlen, h.seq, h.srcSystem, h.srcComponent, h.msgId, h.incompat_flags, h.compat_flags].join(',')
  return `${m._name} ${header} signed=${String(m._signed)} link=${link} ${hex(m._msgbuf as Uint8Array)}`
}

function describeOurs(e: ParseEvent): string {
  switch (e.kind) {
    case 'message': {
      const { header: h, signature } = e.message
      const verified = signature?.verified === true
      const header = [h.payloadLength, h.sequence, h.systemId, h.componentId, h.messageId, h.incompatFlags, h.compatFlags].join(
        ','
      )
      return `${e.message.name} ${header} signed=${String(verified)} link=${verified ? String(signature.linkId) : '-'} ${hex(e.message.frame)}`
    }
    case 'unknown':
    case 'rejected':
      return `bad ${hex(e.frame)}`
    case 'garbage':
      return `bad ${hex(e.bytes)}`
  }
}

/** Feeds `chunks` to both parsers and checks that everything observable agrees. Returns our events. */
function compare(mode: Mode, chunks: readonly Uint8Array[]): ParseEvent[] {
  const { theirs, ours, signing } = parsers(mode)
  const expected: string[] = []
  const actual: string[] = []
  const events: ParseEvent[] = []
  for (const chunk of chunks) {
    for (const m of theirs.parseBuffer(chunk) ?? []) expected.push(describeUpstream(m))
    const found = ours.parse(chunk)
    events.push(...found)
    actual.push(...found.map(describeOurs))
  }
  expect(actual).toEqual(expected)
  expect(ours.stats).toMatchObject({
    bytesReceived: theirs.total_bytes_received,
    messagesReceived: theirs.total_packets_received,
    receiveErrors: theirs.total_receive_errors
  })
  if (signing !== undefined) {
    const s = theirs.signing
    expect(signing.stats).toEqual({
      signedFrames: s.sig_count,
      goodSignatures: s.goodsig_count,
      badSignatures: s.badsig_count,
      acceptedUnsigned: s.unsigned_count,
      rejected: s.reject_count
    })
    expect(Object.fromEntries(signing.streamTimestamps)).toEqual({ ...s.stream_timestamps })
    expect(signing.timestamp).toBe(s.timestamp)
  }
  return events
}

const kinds = (events: readonly ParseEvent[]): string[] =>
  events.map((e) =>
    e.kind === 'message' ? e.message.name : e.kind === 'garbage' || e.kind === 'rejected' ? `${e.kind}:${e.reason}` : e.kind
  )

/** Splits `bytes` at random points (sizes 1..max). */
function chunked(bytes: Uint8Array, next: () => number, max: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let at = 0; at < bytes.length;) {
    const size = 1 + Math.floor(next() * max)
    chunks.push(bytes.subarray(at, at + size))
    at += size
  }
  return chunks
}

const concat = (...parts: readonly ArrayLike<number>[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => Array.from(p)))

const heartbeatPayload = Uint8Array.of(4, 0, 0, 0, 2, 3, 0x81, 4, 3)

describe('framing matches upstream parseBuffer', () => {
  const frame = rawFrame(HEARTBEAT, heartbeatPayload, { sequence: 1 })
  const attitude = rawFrame(
    ATTITUDE,
    Uint8Array.from({ length: 28 }, (_, i) => i + 1),
    { sequence: 2 }
  )

  it('fragmented input: every split of two coalesced frames', () => {
    const stream = concat(frame, attitude)
    for (let cut = 0; cut <= stream.length; cut++) {
      expect(kinds(compare('no key', [stream.subarray(0, cut), stream.subarray(cut)]))).toEqual(['HEARTBEAT', 'ATTITUDE'])
    }
    expect(
      kinds(
        compare(
          'no key',
          chunked(stream, () => 0, 1)
        )
      )
    ).toEqual(['HEARTBEAT', 'ATTITUDE'])
  })

  it('noise before, between and after frames is one discarded run each, up to the earliest marker', () => {
    const events = compare('no key', [concat([1, 2, 3], frame, [7, 8], attitude, [9])])
    expect(kinds(events)).toEqual(['garbage:noise', 'HEARTBEAT', 'garbage:noise', 'ATTITUDE', 'garbage:noise'])
  })

  it('a bad checksum discards the whole frame and the next frame is decoded', () => {
    const bad = frame.slice()
    bad[12] = bad[12]! ^ 1
    expect(kinds(compare('no key', [concat(bad, attitude)]))).toEqual(['garbage:crc', 'ATTITUDE'])
  })

  it('a false start marker in noise swallows the claimed length, losing the frames inside it (upstream bug)', () => {
    // 0xFD then length 40: upstream waits for 52 bytes and discards them, including the HEARTBEAT.
    const noise = Uint8Array.of(0xfd, 40, 0, 0, 0, 1, 1, 0, 0, 0)
    const events = compare('no key', [concat(noise, frame, new Uint8Array(30), attitude)])
    expect(kinds(events)).toEqual(['garbage:crc', 'garbage:noise', 'ATTITUDE'])
  })

  it('a corrupted length byte discards the bytes it claims (upstream bug)', () => {
    const bad = frame.slice()
    bad[1] = 30
    expect(kinds(compare('no key', [concat(bad, attitude, attitude)]))).toEqual(['garbage:crc', 'garbage:noise', 'ATTITUDE'])
  })

  it('unknown message ids consume the frame without a checksum check', () => {
    const unknown = rawFrame(HEARTBEAT, heartbeatPayload, { messageId: 0x123456 })
    unknown[unknown.length - 1] = unknown[unknown.length - 1]! ^ 0xff
    expect(kinds(compare('no key', [concat(unknown, frame)]))).toEqual(['unknown', 'HEARTBEAT'])
  })

  it('truncated frames wait for the claimed length, then fail', () => {
    const events = compare('no key', [frame.subarray(0, 15), attitude])
    expect(kinds(events)).toEqual(['garbage:crc', 'garbage:noise'])
    expect(compare('no key', [frame.subarray(0, 2), new Uint8Array(0), frame.subarray(2)]).length).toBe(1)
  })

  it('mixes MAVLink 1 and 2, including short and long MAVLink 1 payloads', () => {
    const v1 = rawFrame(HEARTBEAT, heartbeatPayload, { version: 1, sequence: 3 })
    const clear = rawFrame(MISSION_CLEAR_ALL, Uint8Array.of(1, 1), { version: 1 })
    const long = rawFrame(MISSION_CLEAR_ALL, Uint8Array.of(1, 1, 7, 8), { version: 1 })
    expect(kinds(compare('no key', [concat(v1, frame, clear, long, v1)]))).toEqual([
      'HEARTBEAT',
      'HEARTBEAT',
      'MISSION_CLEAR_ALL',
      'MISSION_CLEAR_ALL',
      'HEARTBEAT'
    ])
  })

  it('refuses incompatibility flags other than SIGNED after taking the whole frame', () => {
    const two = rawFrame(HEARTBEAT, heartbeatPayload, { incompatFlags: 2 })
    // 0x03 has SIGNED set, so 13 more bytes belong to the frame.
    const three = concat(rawFrame(HEARTBEAT, heartbeatPayload, { incompatFlags: 3 }), new Uint8Array(13))
    const compat = rawFrame(HEARTBEAT, heartbeatPayload, { compatFlags: 0x80 })
    expect(kinds(compare('no key', [concat(two, three, compat)]))).toEqual([
      'garbage:incompat-flags',
      'garbage:incompat-flags',
      'HEARTBEAT'
    ])
  })
})

describe('signing matches upstream', () => {
  const sender = (timestamp: number, options: { key?: Uint8Array; linkId?: number } = {}): MavlinkSigning =>
    new MavlinkSigning({ secretKey: options.key ?? KEY, timestamp, linkId: options.linkId ?? 0 })

  it('accepts good signatures and rejects replays, stale new streams, wrong keys and unsigned frames', () => {
    const good = sender(T0 - 6_000_000, { linkId: 1 })
    const first = rawFrame(HEARTBEAT, heartbeatPayload, { signing: good })
    const second = rawFrame(ATTITUDE, new Uint8Array(28), { signing: good })
    const stale = rawFrame(HEARTBEAT, heartbeatPayload, { signing: sender(T0 - 6_000_001, { linkId: 2 }) })
    const wrong = rawFrame(HEARTBEAT, heartbeatPayload, { signing: sender(T0, { key: WRONG_KEY, linkId: 3 }) })
    const unsigned = rawFrame(HEARTBEAT, heartbeatPayload)
    const unsignedOdd = rawFrame(SYS_STATUS, new Uint8Array(31))
    const stream = [first, second, first, stale, wrong, unsigned, unsignedOdd]
    expect(kinds(compare('key', stream))).toEqual([
      'HEARTBEAT',
      'ATTITUDE',
      'rejected:replayed',
      'rejected:stale-stream',
      'rejected:bad-signature',
      'rejected:unsigned',
      'rejected:unsigned'
    ])
    // The callback sees every failing frame; HEARTBEAT (id 0) is let through, SYS_STATUS (1) is not.
    expect(kinds(compare('key, allow even ids', stream))).toEqual([
      'HEARTBEAT',
      'ATTITUDE',
      'HEARTBEAT',
      'HEARTBEAT',
      'HEARTBEAT',
      'HEARTBEAT',
      'rejected:unsigned'
    ])
    // Without a key, signed frames are delivered unverified.
    const names: Readonly<Record<number, string>> = { 0: 'HEARTBEAT', 1: 'SYS_STATUS', 30: 'ATTITUDE' }
    expect(kinds(compare('no key', stream))).toEqual(stream.map((f) => names[f[7]!]))
  })

  it('a forged signature does not start a stream, so the genuine frame is still accepted', () => {
    const genuine = rawFrame(HEARTBEAT, heartbeatPayload, { signing: sender(T0) })
    const forged = genuine.slice()
    forged[forged.length - 7] = forged[forged.length - 7]! ^ 1
    expect(kinds(compare('key', [forged, genuine]))).toEqual(['rejected:bad-signature', 'HEARTBEAT'])
  })

  it('signs outgoing frames byte for byte as upstream, for any link id, timestamp and key length', () => {
    for (const [linkId, timestamp, keyLength] of [
      [0, 0, 32],
      [7, T0, 32],
      [255, 2 ** 48 - 1, 32],
      [3, 2 ** 48 + 5, 32],
      [1, 123_456_789, 16]
    ] as const) {
      const key = KEY.subarray(0, keyLength)
      const processor = new upstream.MAVLink20Processor(null, 42, 1)
      Object.assign(processor.signing, { secret_key: key, timestamp, link_id: linkId, sign_outgoing: true })
      const message = new upstream.mavlink20.messages.heartbeat!(11, 3, 137, 5, 4, 3)
      const theirs = Uint8Array.from(message.pack(processor))
      const signing = new MavlinkSigning({ secretKey: key, timestamp, linkId })
      const ours = rawFrame(HEARTBEAT, Uint8Array.of(5, 0, 0, 0, 11, 3, 137, 4, 3), { systemId: 42, signing })
      expect(hex(ours), `link ${linkId} timestamp ${timestamp}`).toBe(hex(theirs))
      expect(signing.timestamp).toBe(processor.signing.timestamp)
    }
  })

  it('starts the signing timestamp at the current time, as upstream', () => {
    const before = signingTimestamp()
    const theirs = new upstream.MAVLink20Processor(null, 1, 1).signing.timestamp
    const ours = new MavlinkSigning({ secretKey: KEY }).timestamp
    const after = signingTimestamp()
    for (const value of [theirs, ours]) {
      expect(value).toBeGreaterThanOrEqual(before)
      expect(value).toBeLessThanOrEqual(after)
    }
    expect(signingTimestamp(Date.UTC(2015, 0, 1) - 5)).toBe(0)
  })

  it('computes SHA-256 and signatures as upstream', () => {
    const next = random(5)
    for (const length of [0, 1, 31, 55, 56, 63, 64, 65, 119, 120, 239, 306, 1000]) {
      const input = Uint8Array.from({ length }, () => Math.floor(next() * 256))
      expect(hex(sha256(input))).toBe(hex(upstream.mavlink20.sha256(input)))
      expect(hex(createSignature(KEY, input))).toBe(hex(upstream.mavlink20.create_signature(KEY, input)))
      expect(hex(createSignature(KEY.subarray(0, 20), input))).toBe(
        hex(upstream.mavlink20.create_signature(KEY.subarray(0, 20), input))
      )
    }
    // Upstream copies the key into a 32-byte slot and the data over anything beyond it, so a longer
    // key acts as its first 32 bytes, unless it is longer than the slot plus the data.
    const long = Uint8Array.from({ length: 40 }, (_, i) => i + 1)
    expect(hex(createSignature(long, new Uint8Array(8)))).toBe(hex(upstream.mavlink20.create_signature(long, new Uint8Array(8))))
    expect(hex(createSignature(long, new Uint8Array(8)))).toBe(hex(createSignature(long.subarray(0, 32), new Uint8Array(8))))
    expect(() => createSignature(long, new Uint8Array(1))).toThrow(RangeError)
    expect(() => upstream.mavlink20.create_signature(long, new Uint8Array(1))).toThrow(/out of bounds/)
  })
})

describe('random streams', () => {
  /** Messages with ids that fit MAVLink 1, for MAVLink 1 frames. */
  const v1Messages = ALL_MESSAGES.filter((m) => m.id < 256)
  const unknownIds = [0x123456, 300, 9999, 65535, 0xffffff].filter((id) => !ALL_MESSAGES.some((m) => m.id === id))

  /** A stream of valid, signed, corrupted, truncated, unknown and noise pieces. */
  function randomStream(next: () => number): Uint8Array {
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
    const signers = [
      new MavlinkSigning({ secretKey: KEY, timestamp: T0 - 1000, linkId: 1 }),
      new MavlinkSigning({ secretKey: KEY, timestamp: T0 - 7_000_000, linkId: 2 }),
      new MavlinkSigning({ secretKey: WRONG_KEY, timestamp: T0, linkId: 3 })
    ]
    const sent: Uint8Array[] = []
    const parts: Uint8Array[] = []
    for (let i = 0; i < 60; i++) {
      const roll = next()
      const descriptor = pick(ALL_MESSAGES)
      const length = next() < 0.5 ? descriptor.length : Math.floor(next() * (descriptor.length + 1))
      const payload = Uint8Array.from({ length: Math.max(1, length) }, () => Math.floor(next() * 256))
      const address = { sequence: i, systemId: 1 + Math.floor(next() * 3), componentId: 1 }
      if (roll < 0.3) {
        parts.push(rawFrame(descriptor, payload, address))
      } else if (roll < 0.4) {
        const v1 = pick(v1Messages)
        const v1Payload = Uint8Array.from({ length: next() < 0.7 ? v1.baseLength : v1.length }, () => Math.floor(next() * 256))
        parts.push(rawFrame(v1, v1Payload, { ...address, version: 1 }))
      } else if (roll < 0.55) {
        const frame = rawFrame(descriptor, payload, { ...address, signing: pick(signers) })
        sent.push(frame)
        parts.push(frame)
      } else if (roll < 0.62 && sent.length > 0) {
        parts.push(pick(sent))
      } else if (roll < 0.7) {
        const frame = rawFrame(descriptor, payload, address)
        frame[Math.floor(next() * frame.length)]! ^= 1 << Math.floor(next() * 8)
        parts.push(frame)
      } else if (roll < 0.75) {
        const frame = rawFrame(descriptor, payload, address)
        parts.push(frame.subarray(0, Math.floor(next() * frame.length)))
      } else if (roll < 0.8) {
        parts.push(rawFrame(descriptor, payload, { ...address, messageId: pick(unknownIds) }))
      } else if (roll < 0.85) {
        parts.push(rawFrame(descriptor, payload, { ...address, incompatFlags: pick([2, 3, 4, 0x80]), compatFlags: pick([0, 1]) }))
      } else {
        parts.push(
          Uint8Array.from({ length: 1 + Math.floor(next() * 12) }, () =>
            next() < 0.15 ? pick([0xfd, 0xfe]) : Math.floor(next() * 256)
          )
        )
      }
    }
    return concat(...parts)
  }

  it('produce the same events, counters and signing state in every mode and chunking', () => {
    const next = random(0x5eed)
    const seen = new Map<string, number>()
    for (let trial = 0; trial < 40; trial++) {
      const stream = randomStream(next)
      const mode = (['no key', 'key', 'key, allow even ids'] as const)[trial % 3]!
      const chunks = trial % 4 === 0 ? [stream] : chunked(stream, next, trial % 4 === 1 ? 8 : 300)
      for (const event of compare(mode, chunks)) {
        const kind =
          event.kind === 'message'
            ? `message v${event.message.header.version}${event.message.signature?.verified === true ? ' verified' : ''}`
            : kinds([event])[0]!
        seen.set(kind, (seen.get(kind) ?? 0) + 1)
      }
    }
    // Every path was taken, several times.
    for (const kind of [
      'message v1',
      'message v2',
      'message v2 verified',
      'unknown',
      'garbage:noise',
      'garbage:crc',
      'garbage:incompat-flags',
      'rejected:replayed',
      'rejected:stale-stream',
      'rejected:bad-signature',
      'rejected:unsigned'
    ])
      expect(seen.get(kind) ?? 0, kind).toBeGreaterThan(3)
  })
})
