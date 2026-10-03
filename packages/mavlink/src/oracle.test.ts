// Oracle tests: random frames decoded by this package and by upstream mavlink.js (pymavlink's
// JavaScript generator, run in node:vm) must agree field for field, and upstream must re-encode
// them to the same bytes this package produces.
import { beforeAll, describe, expect, it } from 'vitest'
import { camelCase } from '../scripts/emit.js'
import { decodePayload, type FieldValue } from './decode.js'
import { FIELD_TYPE_SIZE, type FieldType, type MessageDescriptor } from './descriptor.js'
import { encodeFrame } from './encode.js'
import { ALL_MESSAGES, type MessageName } from './generated/messages.js'
import { MavlinkParser } from './parser.js'
import { loadFixtures, loadUpstream, type UpstreamMavlink, type UpstreamMessage } from './test-utils/upstream.js'

let upstream: UpstreamMavlink
beforeAll(async () => {
  upstream = await loadUpstream()
})

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A random payload that survives a decode/encode round trip: strings are printable ASCII followed
 * by NUL padding, and floats are never NaN (NaN payload bits are not preserved by DataView).
 */
function randomPayload(descriptor: MessageDescriptor, next: () => number): Uint8Array {
  const payload = Uint8Array.from({ length: descriptor.length }, () => Math.floor(next() * 256))
  for (const field of descriptor.fields) {
    const count = field.arrayLength ?? 1
    const size = FIELD_TYPE_SIZE[field.type]
    if (field.type === 'char') {
      const length = Math.floor(next() * (count + 1))
      for (let i = 0; i < count; i++) payload[field.offset + i] = i < length ? 32 + Math.floor(next() * 95) : 0
    } else if (field.type === 'float' || field.type === 'double') {
      // Clear the exponent's lowest bit in the most significant byte, so it is never all ones.
      for (let i = 0; i < count; i++) payload[field.offset + i * size + size - 1]! &= 0xbf
    }
  }
  // Sometimes leave trailing zeros, to exercise MAVLink 2 truncation.
  if (next() < 0.3) payload.fill(0, Math.floor(next() * payload.length))
  return payload
}

/** An upstream field value converted to this package's representation, for comparison. */
function normalizeUpstream(value: unknown, ours: FieldValue, type: FieldType): unknown {
  const int64 = (v: unknown): bigint => {
    const [low, high] = v as [number, number]
    const unsigned = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0)
    return type === 'int64_t' ? BigInt.asIntN(64, unsigned) : unsigned
  }
  if (typeof ours === 'bigint') return int64(value)
  if (typeof ours === 'string') return (value as string).split('\0')[0]
  if (typeof ours === 'number') return value
  // Upstream unpacks byte arrays (including int8_t[] ones) as strings of char codes.
  if (typeof value === 'string')
    return Array.from(value, (c) => (type === 'int8_t' ? (c.charCodeAt(0) << 24) >> 24 : c.charCodeAt(0)))
  if (ours instanceof BigInt64Array || ours instanceof BigUint64Array) return (value as unknown[]).map(int64)
  return Array.from(value as number[])
}

function comparable(value: FieldValue): unknown {
  return typeof value === 'object' ? Array.from(value as ArrayLike<number | bigint>) : value
}

/** Upstream message with its 64-bit values in the `[low, high]` form its own encoder accepts. */
function repackable(message: UpstreamMessage): UpstreamMessage {
  for (const name of message.fieldnames) {
    const value = message[name]
    if (Array.isArray(value) && value.length === 3 && typeof value[2] === 'boolean') Reflect.set(message, name, value.slice(0, 2))
  }
  return message
}

describe('upstream mavlink.js oracle', () => {
  const shared = (): MessageDescriptor<MessageName>[] =>
    ALL_MESSAGES.filter((d) => upstream.mavlink20.map[d.id]?.crc_extra === d.crcExtra)

  it('agrees on the CRC_EXTRA of nearly every message both define', () => {
    const differing = ALL_MESSAGES.filter((d) => {
      const entry = upstream.mavlink20.map[d.id]
      return entry !== undefined && entry.crc_extra !== d.crcExtra
    }).map((d) => d.name)
    // Upstream was generated from an older definitions snapshot; these messages changed since.
    expect(differing).toEqual([])
    expect(shared().length).toBeGreaterThan(280)
  })

  it('covers every fixture message', () => {
    const names = new Set<string>(shared().map((d) => d.name))
    for (const fixture of loadFixtures().messages) expect(names.has(fixture.name.toUpperCase())).toBe(true)
  })

  it('has the same fields in the same XML order, plus extensions added since', () => {
    for (const descriptor of shared()) {
      const known = upstreamFields(descriptor)
      expect(known, descriptor.name).toEqual(descriptor.fields.slice(0, known.length).map((f) => f.name))
      expect(descriptor.fields.slice(known.length).every((f) => f.extension === true)).toBe(true)
    }
  })

  it('decodes random frames of every shared message identically and re-encodes them to the same bytes', () => {
    const next = random(0x6d61766c)
    let compared = 0
    for (const descriptor of shared()) {
      for (let round = 0; round < 8; round++) {
        const payload = randomPayload(descriptor, next)
        // Extensions newer than upstream's definitions stay zero, so its re-encoding can match.
        const known = new Set(upstreamFields(descriptor))
        // Upstream stores the frame checksum in `message.crc`, overwriting a field of that name.
        const clobbered = known.delete('crc')
        for (const field of descriptor.fields) {
          if (!known.has(field.name))
            payload.fill(0, field.offset, field.offset + FIELD_TYPE_SIZE[field.type] * (field.arrayLength ?? 1))
        }
        const fields = decodePayload(descriptor, payload)
        const sequence = round * 31
        const frame = encodeFrame(descriptor, fields as never, { systemId: 42, componentId: 1, sequence })

        // Our encoder reproduces the random payload (modulo truncation).
        const [message] = new MavlinkParser({ messages: [descriptor] }).push(frame)
        expect(message?.name).toBe(descriptor.name)
        let end = payload.length
        while (end > 1 && payload[end - 1] === 0) end--
        expect(Array.from(frame.subarray(10, frame.length - 2)), descriptor.name).toEqual(Array.from(payload.subarray(0, end)))

        const processor = new upstream.MAVLink20Processor(null, 42, 1)
        const theirs = processor.decode(frame)
        expect(theirs._name).toBe(descriptor.name)
        for (const field of descriptor.fields.filter((f) => known.has(f.name))) {
          const ours: FieldValue = Reflect.get(message!.fields, field.name)
          expect(comparable(ours), `${descriptor.name}.${field.name}`).toEqual(
            normalizeUpstream(theirs[upstreamName(theirs, field.name)], ours, field.type)
          )
          compared++
        }

        processor.seq = sequence
        if (!clobbered)
          expect(Buffer.from(repackable(theirs).pack(processor)).toString('hex'), descriptor.name).toBe(
            Buffer.from(frame).toString('hex')
          )
      }
    }
    expect(compared).toBeGreaterThan(10000)
  })
})

/** camelCase names of the fields upstream defines for a message. */
function upstreamFields(descriptor: MessageDescriptor): string[] {
  const Type = upstream.mavlink20.map[descriptor.id]!.type
  return new Type().fieldnames.map(camelCase)
}

/** The upstream (XML) name of a camelCase field. */
function upstreamName(message: UpstreamMessage, camel: string): string {
  return message.fieldnames.find((name) => camelCase(name) === camel) ?? camel
}
