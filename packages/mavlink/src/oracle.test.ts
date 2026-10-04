// Oracle tests for the definitions and the payload codec: upstream mavlink.js (pymavlink's
// JavaScript generator, run in node:vm) must define exactly the same messages and enums, decode
// random frames of every message field for field like this package, and re-encode them to the same
// bytes. Framing and signing are compared in parser.oracle.test.ts.
import { beforeAll, describe, expect, it } from 'vitest'
import { camelCase, pascalCase } from '../scripts/emit.js'
import { crcAccumulate, crcX25 } from './crc.js'
import { decodePayload, type FieldValue } from './decode.js'
import { FIELD_TYPE_SIZE, type EnumObject, type FieldType, type MessageDescriptor } from './descriptor.js'
import { encodeFrame } from './encode.js'
import * as enums from './generated/enums.js'
import {
  ALL_MESSAGES,
  AUTOPILOT_VERSION,
  BATTERY_STATUS,
  COMMAND_INT,
  DISTANCE_SENSOR,
  FILE_TRANSFER_PROTOCOL,
  HOME_POSITION,
  SET_ATTITUDE_TARGET,
  STATUSTEXT,
  TEST_TYPES,
  WHEEL_DISTANCE,
  type MessageName
} from './generated/messages.js'
import { MESSAGE_TABLE } from './generated/table.js'
import { MavlinkParser } from './parser.js'
import { random } from './test-utils/random.js'
import {
  loadFixtures,
  loadUpstream,
  loadUpstreamEnums,
  type UpstreamMavlink,
  type UpstreamMessage
} from './test-utils/upstream.js'

let upstream: UpstreamMavlink
beforeAll(async () => {
  upstream = await loadUpstream()
})

const STRUCT_CODE: Readonly<Record<FieldType, string>> = {
  char: 'c',
  int8_t: 'b',
  uint8_t: 'B',
  int16_t: 'h',
  uint16_t: 'H',
  int32_t: 'i',
  uint32_t: 'I',
  float: 'f',
  double: 'd',
  int64_t: 'q',
  uint64_t: 'Q'
}

/** The jspack format mavgen writes for a message: fields in wire order, byte arrays as strings. */
function structFormat(descriptor: MessageDescriptor): string {
  const wire = [...descriptor.fields].sort((a, b) => a.offset - b.offset)
  return (
    '<' +
    wire
      .map((f) => {
        if (f.arrayLength === undefined) return STRUCT_CODE[f.type]
        const byteArray = f.type === 'char' || f.type === 'uint8_t' || f.type === 'int8_t'
        return `${f.arrayLength}${byteArray ? 's' : STRUCT_CODE[f.type]}`
      })
      .join('')
  )
}

/**
 * A random payload that survives a decode/encode round trip: any bytes, except that floats are
 * never NaN (NaN payload bits are not preserved by DataView).
 */
function randomPayload(descriptor: MessageDescriptor, next: () => number): Uint8Array {
  const payload = Uint8Array.from({ length: descriptor.length }, () => Math.floor(next() * 256))
  for (const field of descriptor.fields) {
    const size = FIELD_TYPE_SIZE[field.type]
    if (field.type === 'float' || field.type === 'double') {
      // Clear the exponent's lowest bit in the most significant byte, so it is never all ones.
      for (let i = 0; i < (field.arrayLength ?? 1); i++) payload[field.offset + i * size + size - 1]! &= 0xbf
    } else if (field.type === 'char' && next() < 0.5) {
      // NUL-padded text half of the time, sometimes with a NUL inside it.
      const count = field.arrayLength ?? 1
      const length = Math.floor(next() * (count + 1))
      payload.fill(0, field.offset + length, field.offset + count)
      if (length > 2 && next() < 0.3) payload[field.offset + 1] = 0
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
  // Upstream keeps the NUL padding; the package returns the string its tools display, padding stripped.
  if (typeof ours === 'string') return (value as string).replace(/\0+$/, '')
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

const hex = (bytes: ArrayLike<number>): string => Buffer.from(Uint8Array.from(bytes)).toString('hex')

/** A MAVLink 2 frame from 42/1 carrying `payload`, truncated as MAVLink 2 requires. */
function payloadFrame(descriptor: MessageDescriptor, payload: Uint8Array, sequence: number): Uint8Array {
  let length = payload.length
  while (length > 1 && payload[length - 1] === 0) length--
  const id = descriptor.id
  const frame = new Uint8Array(10 + length + 2)
  frame.set([0xfd, length, 0, 0, sequence, 42, 1, id & 0xff, (id >> 8) & 0xff, id >> 16])
  frame.set(payload.subarray(0, length), 10)
  const crc = crcAccumulate(descriptor.crcExtra, crcX25(frame.subarray(1, 10 + length)))
  frame[10 + length] = crc & 0xff
  frame[11 + length] = crc >> 8
  return frame
}

/** XML names of the fields upstream defines for a message, in XML order. */
function upstreamFieldNames(id: number): readonly string[] {
  const Type = upstream.mavlink20.map[id]!.type
  return new Type().fieldnames
}

const GENERATED_ENUMS: ReadonlyMap<string, EnumObject> = new Map(Object.entries(enums))

describe('definitions are the ones upstream mavlink.js was generated from', () => {
  it('defines the same message ids, names and CRC_EXTRA', () => {
    const theirs = Object.entries(upstream.mavlink20.map)
      .map(([id, entry]) => ({ id: Number(id), name: new entry.type()._name, crcExtra: entry.crc_extra }))
      .sort((a, b) => a.id - b.id)
    expect(theirs).toHaveLength(347)
    expect(ALL_MESSAGES.map(({ id, name, crcExtra }) => ({ id, name, crcExtra }))).toEqual(theirs)
    expect(MESSAGE_TABLE.map((m) => ({ ...m }))).toEqual(theirs)
  })

  it('gives every message the same fields, in XML order, with the same wire layout', () => {
    for (const descriptor of ALL_MESSAGES) {
      const names = upstreamFieldNames(descriptor.id)
      expect(
        descriptor.fields.map((f) => f.name),
        descriptor.name
      ).toEqual(names.map(camelCase))
      expect(structFormat(descriptor), descriptor.name).toBe(upstream.mavlink20.map[descriptor.id]!.format)
      expect(new Set(names.map(camelCase)).size, descriptor.name).toBe(names.length)
    }
  })

  it('defines the same enums with the same entries and values (mavgen adds NAME_ENUM_END = last + 1)', () => {
    const theirs = loadUpstreamEnums()
    expect(theirs.size).toBe(205)
    expect([...GENERATED_ENUMS.keys()].sort()).toEqual([...theirs.keys()].map(pascalCase).sort())
    let entries = 0
    for (const [name, upstreamEntries] of theirs) {
      const ours = GENERATED_ENUMS.get(pascalCase(name))!
      const values = Object.values(ours)
      const expected = new Map(Object.entries(ours))
      expected.set(`${name}_ENUM_END`, (values.length === 0 ? -1 : Math.max(...values)) + 1)
      expect(new Map([...expected].sort()), name).toEqual(new Map([...upstreamEntries].sort()))
      entries += upstreamEntries.size
    }
    expect(entries).toBeGreaterThan(2000)
  })

  it('covers every fixture message', () => {
    const names = new Set<string>(ALL_MESSAGES.map((d) => d.name))
    for (const fixture of loadFixtures().messages) expect(names.has(fixture.name.toUpperCase())).toBe(true)
  })
})

describe('upstream mavlink.js payload oracle', () => {
  it('decodes random frames of every message identically and re-encodes them to the same bytes', () => {
    const next = random(0x6d61766c)
    let compared = 0
    const unpackable = new Set<string>()
    for (const descriptor of ALL_MESSAGES) {
      const names = upstreamFieldNames(descriptor.id)
      for (let round = 0; round < 8; round++) {
        const payload = randomPayload(descriptor, next)
        const fields = decodePayload(descriptor, payload)
        const sequence = round * 31
        const frame = payloadFrame(descriptor, payload, sequence)

        // Our encoder reproduces the random payload (modulo truncation), TEST_TYPES included, which
        // upstream cannot encode (proven upstream bug #154, asserted below).
        const address = { systemId: 42, componentId: 1, sequence }
        expect(hex(encodeFrame(descriptor, fields as never, address)), descriptor.name).toBe(hex(frame))
        const [message] = new MavlinkParser({ messages: [descriptor] }).push(frame)
        expect(message?.name).toBe(descriptor.name)

        const processor = new upstream.MAVLink20Processor(null, 42, 1)
        const theirs = processor.decode(frame)
        expect(theirs._name).toBe(descriptor.name)
        descriptor.fields.forEach((field, i) => {
          // Upstream stores the frame checksum in `message.crc`, overwriting a field of that name.
          if (names[i] === 'crc') return
          const ours: FieldValue = Reflect.get(message!.fields, field.name)
          expect(comparable(ours), `${descriptor.name}.${field.name}`).toEqual(
            normalizeUpstream(theirs[names[i]!], ours, field.type)
          )
          compared++
        })

        if (names.includes('crc')) continue
        processor.seq = sequence
        let packed: number[]
        try {
          packed = repackable(theirs).pack(processor)
        } catch {
          // Upstream's jspack has no encoder for a scalar `char` (its _EnChar is commented out):
          // proven upstream bug #154, fixed in the port (see docs/bug-proofs/mavlink.md).
          unpackable.add(descriptor.name)
          continue
        }
        expect(hex(packed), descriptor.name).toBe(hex(frame))
      }
    }
    expect(compared).toBeGreaterThan(20000)
    expect([...unpackable]).toEqual(['TEST_TYPES'])
  })
})

describe('upstream jspack value packing', () => {
  /** Upstream: the message built with `args` in XML order, packed by a processor with the same address. */
  function theirs(name: string, args: readonly unknown[]): string {
    const message = new upstream.mavlink20.messages[name]!(...args)
    return Buffer.from(Uint8Array.from(message.pack(new upstream.MAVLink20Processor(null, 1, 1)))).toString('hex')
  }
  function ours(descriptor: MessageDescriptor<MessageName>, fields: Readonly<Record<string, unknown>>): string {
    return Buffer.from(encodeFrame(descriptor, fields as never, { systemId: 1, componentId: 1, sequence: 0 })).toString('hex')
  }
  const lower = Math.fround(89.6)
  const bits = new DataView(new ArrayBuffer(4))
  bits.setFloat32(0, lower)
  bits.setUint32(0, bits.getUint32(0) + 1)
  /** Exactly halfway between two float32 values: jspack rounds away from zero, DataView to even. */
  const tie = (lower + bits.getFloat32(0)) / 2

  it('clamps and truncates integers, rounds float32 ties away from zero, packs NaN its way and -0 with its sign', () => {
    const args = [300, -5, 2.7, 70000, Number.NaN, Infinity, tie, -0, Number.NaN, -tie, 2 ** 31, -2.5, 1e39]
    const fields = Object.fromEntries(COMMAND_INT.fields.map((f, i) => [f.name, args[i]]))
    // Proven upstream bug #153 (see docs/bug-proofs/mavlink.md): jspack packs -0 as +0. The port keeps
    // the sign: the bytes upstream gives a negative value that rounds to zero (-1e-50).
    const withZero = (zero: number): unknown[] => args.map((a) => (Object.is(a, -0) ? zero : a))
    expect(theirs('command_int', args)).toBe(theirs('command_int', withZero(0)))
    expect(theirs('command_int', args)).not.toBe(theirs('command_int', withZero(-1e-50)))
    expect(ours(COMMAND_INT, fields)).toBe(theirs('command_int', withZero(-1e-50)))
    expect(ours(COMMAND_INT, Object.fromEntries(COMMAND_INT.fields.map((f, i) => [f.name, withZero(0)[i]])))).toBe(
      theirs('command_int', withZero(0))
    )
    for (const value of [0.1, 1 / 3, -1e-45, 3e-46, 1e-40, 3.4028235677973366e38, -Infinity]) {
      const more = [1, 1, 0, 16, 0, 0, value, value, value, value, 0, 0, value]
      expect(ours(COMMAND_INT, Object.fromEntries(COMMAND_INT.fields.map((f, i) => [f.name, more[i]]))), String(value)).toBe(
        theirs('command_int', more)
      )
    }
  })

  /** Upstream's decoding of a frame the port packed. */
  function theirDecoding(frame: string): UpstreamMessage {
    return new upstream.MAVLink20Processor(null, 1, 1).decode(Uint8Array.from(Buffer.from(frame, 'hex')))
  }

  it('packs -0 with its sign in floats and doubles, where upstream packs +0 (proven bug #153)', () => {
    const distance = (first: number): number[] => [first, ...new Array<number>(15).fill(0)]
    // Upstream: -0 gives exactly the bytes of +0.
    expect(theirs('wheel_distance', [[0, 0], 1, distance(-0)])).toBe(theirs('wheel_distance', [[0, 0], 1, distance(0)]))
    const wheel = (first: number): string => ours(WHEEL_DISTANCE, { timeUsec: 0n, count: 1, distance: distance(first) })
    expect(wheel(0)).toBe(theirs('wheel_distance', [[0, 0], 1, distance(0)]))
    // Port: the sign bit is set, and upstream's own decoder reads the value back as -0.
    const frame = wheel(-0)
    expect(frame.slice(2 * (10 + 15), 2 * (10 + 16))).toBe('80')
    expect(Object.is((theirDecoding(frame)['distance'] as number[])[0], -0)).toBe(true)
    const args = [1, 1, 0, 16, 0, 0, -0, 0, 0, 0, 0, 0, 0]
    const attitude = theirDecoding(ours(COMMAND_INT, Object.fromEntries(COMMAND_INT.fields.map((f, i) => [f.name, args[i]]))))
    expect(Object.is(attitude['param1'], -0)).toBe(true)
  })

  it('packs a scalar char as its character code, where upstream cannot pack TEST_TYPES at all (proven bug #154)', () => {
    // Upstream's arguments in XML order; 64-bit values as [lowBits, highBits] (jspack README note 6).
    const big = (n: number): number[] => [n, 0]
    const args = [
      'A',
      'hello',
      1,
      2,
      3,
      big(4),
      5,
      6,
      7,
      big(8),
      1.5,
      2.5,
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [big(1), big(2), big(3)],
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [big(1), big(2), big(3)],
      [1, 2, 3],
      [1, 2, 3]
    ]
    expect(() => theirs('test_types', args)).toThrow(/fxn is not a function/)
    const fields = {
      c: 'A',
      s: 'hello',
      u8: 1,
      u16: 2,
      u32: 3,
      u64: 4n,
      s8: 5,
      s16: 6,
      s32: 7,
      s64: 8n,
      f: 1.5,
      d: 2.5,
      u8Array: [1, 2, 3],
      u16Array: [1, 2, 3],
      u32Array: [1, 2, 3],
      u64Array: [1n, 2n, 3n],
      s8Array: [1, 2, 3],
      s16Array: [1, 2, 3],
      s32Array: [1, 2, 3],
      s64Array: [1n, 2n, 3n],
      fArray: [1, 2, 3],
      dArray: [1, 2, 3]
    }
    const frame = ours(TEST_TYPES, fields)
    // Byte 160 of the payload holds 'A'; upstream's decoder reads the frame back as given.
    expect(frame.slice(2 * (10 + 160), 2 * (10 + 161))).toBe('41')
    const decoded = theirDecoding(frame)
    // (Upstream keeps a string's NUL padding.)
    expect([decoded['c'], decoded['s'], decoded['u8'], decoded['f'], decoded['d']]).toEqual(['A', 'hello\0\0\0\0\0', 1, 1.5, 2.5])
    // An empty string packs 0, as an empty string array element does.
    expect(ours(TEST_TYPES, { ...fields, c: '' }).slice(2 * (10 + 160), 2 * (10 + 161))).toBe('00')
  })

  it('cuts strings to the field and keeps the low byte of each character code', () => {
    const text = 'caf\u00e9 \u0100\u0141 ' + 'x'.repeat(60)
    expect(ours(STATUSTEXT, { severity: 6, text })).toBe(theirs('statustext', [6, text]))
  })

  it('stores byte array elements in a byte (low 8 bits, NaN as 0) and cuts long arrays', () => {
    const payload = [-1, 256, 1.5, Number.NaN, 300, ...new Array<number>(260).fill(7)]
    expect(ours(FILE_TRANSFER_PROTOCOL, { targetNetwork: 0, targetSystem: 1, targetComponent: 1, payload })).toBe(
      theirs('file_transfer_protocol', [0, 1, 1, payload])
    )
  })

  it('shifts the fields after an omitted extension array, and leaves its bytes out of the checksum (upstream bug)', () => {
    const base = [3, 1, 1, 2500, [12000, 12100], -1, 100, 2000, 80, 0, 1]
    const named = (values: readonly unknown[]): Record<string, unknown> =>
      Object.fromEntries(BATTERY_STATUS.fields.map((f, i) => [f.name, values[i]]))
    // voltages_ext omitted: mode packs undefined (0) and fault_bitmask packs mode's 5, so the hole
    // is followed by data and the frame's checksum is computed without it.
    for (const extensions of [[undefined, 5, 6], [[1, 2], 5, 6], [undefined, undefined, 6], [undefined]]) {
      const args = [...base, ...extensions]
      const frame = ours(BATTERY_STATUS, named(args))
      expect(frame, JSON.stringify(extensions)).toBe(theirs('battery_status', args))
    }
    const broken = Uint8Array.from(Buffer.from(ours(BATTERY_STATUS, named([...base, undefined, 5, 6])), 'hex'))
    // The bad checksum drops the start marker, then the rest is noise (proven upstream bug #150 fixed).
    expect(new MavlinkParser({ messages: [BATTERY_STATUS] }).parse(broken).map((e) => e.kind)).toEqual(['garbage', 'garbage'])
  })

  it('packs missing float array elements and omitted float extensions as NaN, omitted arrays as zeros', () => {
    const attitude = [5, 1, 1, 0, [0.5], 0, 0, 0, 0.5]
    expect(ours(SET_ATTITUDE_TARGET, Object.fromEntries(SET_ATTITUDE_TARGET.fields.map((f, i) => [f.name, attitude[i]])))).toBe(
      theirs('set_attitude_target', attitude)
    )
    const base = [1000, 20, 4000, 150, 0, 1, 25, 0]
    const named = (values: readonly unknown[]): Record<string, unknown> =>
      Object.fromEntries(DISTANCE_SENSOR.fields.slice(0, values.length).map((f, i) => [f.name, values[i]]))
    for (const extensions of [[], [0.25], [0.25, 0.5, [1, 0.5]], [0.25, 0.5, [1, 0, 0, 0], 90], [0.25, 0.5, undefined, 90]]) {
      const args = [...base, ...extensions]
      expect(ours(DISTANCE_SENSOR, named(args)), JSON.stringify(extensions)).toBe(theirs('distance_sensor', args))
    }
  })

  it('throws where upstream pack throws: omitted byte arrays and 64-bit values', () => {
    const version = [
      [0, 0],
      1,
      2,
      3,
      4,
      [1, 2, 3, 4, 5, 6, 7, 8],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      5,
      6,
      [0, 0]
    ]
    expect(() => theirs('autopilot_version', version)).toThrow(/charCodeAt/)
    const fields = Object.fromEntries(
      AUTOPILOT_VERSION.fields.slice(0, 11).map((f, i) => [f.name, i === 0 || i === 10 ? 0n : version[i]])
    )
    expect(() => ours(AUTOPILOT_VERSION, fields)).toThrow(/uid2: upstream mavlink.js cannot encode this/)
    expect(ours(AUTOPILOT_VERSION, { ...fields, uid2: [9] })).toBe(theirs('autopilot_version', [...version, [9]]))
    const home = [1, 2, 3, 0, 0, 0, [1, 0, 0, 0], 0, 0, 0]
    expect(() => theirs('home_position', home)).toThrow(/length/)
    expect(() =>
      ours(HOME_POSITION, Object.fromEntries(HOME_POSITION.fields.slice(0, 10).map((f, i) => [f.name, home[i]])))
    ).toThrow(/timeUsec: upstream mavlink.js cannot encode this/)
  })
})
