// Oracle tests: the legacy adapter must give widgets exactly the object upstream's mavlink.js
// produced for the same bytes, for every message both define.
import {
  ALL_MESSAGES,
  FIELD_TYPE_SIZE,
  MavlinkParser,
  MavlinkSigning,
  crcAccumulate,
  crcX25,
  signingKeyFromPassphrase
} from '@apwt/mavlink'
import type { MessageDescriptor, MessageName, ReceivedMessage } from '@apwt/mavlink'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadUpstreamMavlink,
  plain,
  random,
  type UpstreamMavlink,
  type UpstreamMessage
} from '../test-support/upstream-mavlink.js'
import { DESCRIPTORS_BY_ID, legacyMessageInfo, toLegacyMessage } from './legacy-message.js'

let upstream: UpstreamMavlink
beforeAll(async () => {
  upstream = await loadUpstreamMavlink()
})

function parseOne(frame: Uint8Array, signing?: MavlinkSigning): ReceivedMessage {
  const parser = new MavlinkParser(signing === undefined ? { messages: ALL_MESSAGES } : { messages: ALL_MESSAGES, signing })
  const [message] = parser.push(frame)
  if (message === undefined) throw new Error('frame did not parse')
  return message
}

/** Upstream's message for `frame` as a widget received it: structured-cloned, with `_timeStamp`. */
function theirs(frame: Uint8Array, timeStamp: number): Record<string, unknown> {
  const processor = new upstream.MAVLink20Processor(null, 255, 0)
  let decoded: UpstreamMessage | null = null
  for (const byte of frame) decoded = processor.parseChar(byte) ?? decoded
  if (decoded === null) throw new Error('upstream did not decode the frame')
  const clone = plain(decoded) as Record<string, unknown>
  clone._timeStamp = timeStamp
  return clone
}

function ours(frame: Uint8Array, timeStamp: number, signing?: MavlinkSigning): Record<string, unknown> {
  return plain(toLegacyMessage(parseOne(frame, signing), timeStamp)) as Record<string, unknown>
}

/** Messages whose definition (fields and CRC_EXTRA) is identical in upstream's mavlink.js. */
function sharedDescriptors(): MessageDescriptor<MessageName>[] {
  return ALL_MESSAGES.filter((d) => {
    const entry = upstream.mavlink20.map[d.id]
    return entry !== undefined && entry.crc_extra === d.crcExtra && new entry.type().fieldnames.length === d.fields.length
  })
}

function randomPayload(descriptor: MessageDescriptor, next: () => number): Uint8Array {
  const payload = Uint8Array.from({ length: descriptor.length }, () => Math.floor(next() * 256))
  for (const field of descriptor.fields) {
    if (field.type === 'float' || field.type === 'double') {
      // Keep floats finite and non-NaN so both decoders' numbers compare equal.
      const size = FIELD_TYPE_SIZE[field.type]
      for (let i = 0; i < (field.arrayLength ?? 1); i++) payload[field.offset + i * size + size - 1]! &= 0xbf
    }
  }
  if (next() < 0.3) payload.fill(0, Math.floor(next() * payload.length))
  return payload
}

describe('legacy message adapter', () => {
  it('matches upstream for random frames of every shared message, bytes after string terminators included', () => {
    const shared = sharedDescriptors()
    expect(shared.length).toBeGreaterThan(250)
    const next = random(0x7464)
    for (const descriptor of shared) {
      for (let round = 0; round < 4; round++) {
        const payload = randomPayload(descriptor, next)
        const fixed = rawFrame(descriptor, payload, 1 + round, round * 17)
        const expected = theirs(fixed, 1234)
        const actual = ours(fixed, 1234)
        expect(actual, descriptor.name).toStrictEqual(expected)
        expect(Object.keys(actual), descriptor.name).toEqual(Object.keys(expected))
      }
    }
  })

  it('matches upstream for signed frames, exposing _signed and _link_id', () => {
    const processor = new upstream.MAVLink20Processor(null, 7, 1)
    processor.signing.secret_key = Uint8Array.from(upstream.mavlink20.sha256(new TextEncoder().encode('secret')))
    processor.signing.sign_outgoing = true
    processor.signing.link_id = 3
    const attitude = new upstream.mavlink20.messages.attitude!(1000, 0.1, -0.2, 0.3, 0, 0, 0)
    const frame = Uint8Array.from(attitude.pack(processor))
    const signing = new MavlinkSigning({ secretKey: signingKeyFromPassphrase('secret'), timestamp: 0 })

    const verifier = new upstream.MAVLink20Processor(null, 255, 0)
    verifier.signing.secret_key = Uint8Array.from(upstream.mavlink20.sha256(new TextEncoder().encode('secret')))
    let decoded: UpstreamMessage | null = null
    for (const byte of frame) decoded = verifier.parseChar(byte) ?? decoded
    const expected = plain(decoded) as Record<string, unknown>
    expected._timeStamp = 5
    const actual = ours(frame, 5, signing)
    expect(actual).toStrictEqual(expected)
    expect(actual._signed).toBe(true)
    expect(actual._link_id).toBe(3)
  })

  it('names fields as upstream does, including irregular XML names', () => {
    for (const descriptor of sharedDescriptors()) {
      const Type = upstream.mavlink20.map[descriptor.id]!.type
      expect(legacyMessageInfo(descriptor).fieldnames, descriptor.name).toEqual(new Type().fieldnames)
    }
  })

  it('knows every message upstream defines, with the same definition', () => {
    expect(DESCRIPTORS_BY_ID.size).toBe(ALL_MESSAGES.length)
    expect(
      sharedDescriptors()
        .map((d) => String(d.id))
        .sort()
    ).toEqual(Object.keys(upstream.mavlink20.map).sort())
  })
})

/** The package uses upstream's definitions, so every message must be identical. */
function expectSameAsUpstream(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  expect(actual).toStrictEqual(expected)
}

/** A MAVLink 2 frame carrying `payload`'s exact bytes (truncated as MAVLink 2 requires). */
function rawFrame(descriptor: MessageDescriptor, payload: Uint8Array, systemId: number, sequence: number): Uint8Array {
  let length = payload.length
  while (length > 1 && payload[length - 1] === 0) length--
  const out = new Uint8Array(10 + length + 2)
  out.set([0xfd, length, 0, 0, sequence, systemId, 190, descriptor.id & 0xff, (descriptor.id >> 8) & 0xff, descriptor.id >> 16])
  out.set(payload.subarray(0, length), 10)
  const end = out.length - 2
  out[end] = 0
  const crc = crcAccumulate(descriptor.crcExtra, crcX25(out.subarray(1, end)))
  out[end] = crc & 0xff
  out[end + 1] = crc >> 8
  return out
}

/**
 * The fields the bundled sandbox widgets (`SandBoxWidgets/*.json`, `Default_Layout.json`) read,
 * built with upstream's own message constructors and compared through the adapter.
 */
describe('messages the bundled widgets read', () => {
  const cases: readonly { readonly name: string; readonly args: readonly unknown[]; readonly reads: readonly string[] }[] = [
    // Value widget in Default_Layout: SYS_STATUS current_battery / voltage_battery.
    {
      name: 'sys_status',
      args: [1, 2, 3, 500, 12600, 1550, 80, 0, 0, 0, 0, 0, 0],
      reads: ['current_battery', 'voltage_battery']
    },
    // Value widgets (alt, relative_alt) and the Map widget (lat, lon, hdg).
    {
      name: 'global_position_int',
      args: [1000, -353632610, 1491652370, 584000, 12000, 100, -50, 3, 18000],
      reads: ['alt', 'relative_alt', 'lat', 'lon', 'hdg']
    },
    // Graph widgets: VFR_HUD groundspeed / airspeed.
    { name: 'vfr_hud', args: [21.5, 19.25, 90, 55, 584.5, 0.5], reads: ['groundspeed', 'airspeed'] },
    // Attitude gauge.
    { name: 'attitude', args: [1000, 0.25, -0.125, 1.5, 0, 0, 0], reads: ['roll', 'pitch'] },
    // Messages widget.
    { name: 'statustext', args: [4, 'PreArm: Compass not calibrated', 7, 1], reads: ['severity', 'text', 'id', 'chunk_seq'] },
    // Map widget: home, navigation target and position target.
    {
      name: 'home_position',
      args: [-353632610, 1491652370, 584000, 0, 0, 0, [1, 0, 0, 0], 0, 0, 0, [0, 0]],
      reads: ['latitude', 'longitude']
    },
    { name: 'nav_controller_output', args: [0, 0, 90, 45, 120, 0, 0, 0], reads: ['wp_dist', 'target_bearing'] },
    {
      name: 'position_target_global_int',
      args: [1000, 6, 0xfff8, -353600000, 1491600000, 50, 0, 0, 0, 0, 0, 0, 0, 0],
      reads: ['type_mask', 'lat_int', 'lon_int']
    }
  ]

  for (const { name, args, reads } of cases) {
    it(`${name.toUpperCase()}: ${reads.join(', ')}`, () => {
      const processor = new upstream.MAVLink20Processor(null, 1, 1)
      const message = new upstream.mavlink20.messages[name]!(...args)
      const frame = Uint8Array.from(message.pack(processor))
      const expected = theirs(frame, 99)
      const actual = ours(frame, 99)
      expectSameAsUpstream(actual, expected)
      for (const field of reads) expect(actual[field], field).toStrictEqual(expected[field])
      // Read by the Map, Messages, Inspector and Stats widgets.
      const header = actual._header as Record<string, unknown>
      expect(header.srcSystem).toBe(1)
      expect(header.srcComponent).toBe(1)
      expect(typeof header.mlen).toBe('number')
      expect(actual._timeStamp).toBe(99)
    })
  }

  it('keeps STATUSTEXT NUL padding, which the Messages widget strips itself', () => {
    const processor = new upstream.MAVLink20Processor(null, 1, 1)
    const frame = Uint8Array.from(new upstream.mavlink20.messages.statustext!(6, 'hello', 0, 0).pack(processor))
    const text = ours(frame, 0).text
    expect(text).toBe('hello' + '\0'.repeat(45))
  })
})
