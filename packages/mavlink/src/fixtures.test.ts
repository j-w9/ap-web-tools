// Port of upstream tests/mavlink.test.cjs against tests/fixtures/mavlink.json (wire bytes produced
// by pymavlink, see generate_mavlink.py).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { camelCase } from '../scripts/emit.js'
import { crcAccumulate, crcX25 } from './crc.js'
import { MavlinkEncoder } from './encode.js'
import { ALL_MESSAGES, HEARTBEAT, MISSION_CLEAR_ALL, type MessageName } from './generated/messages.js'
import type { MessageDescriptor } from './descriptor.js'
import { MavlinkParser, type ParseEvent } from './parser.js'
import { sha256 } from './sha256.js'
import { createSignature, MavlinkSigning } from './signing.js'
import { loadFixtures } from './test-utils/upstream.js'

const fixtures = loadFixtures()
const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'))
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const key = Uint8Array.from({ length: 32 }, (_, i) => i)
const heartbeatFields = { type: 11, autopilot: 3, baseMode: 137, customMode: 5, systemStatus: 4, mavlinkVersion: 3 } as const

function descriptorNamed(name: string): MessageDescriptor<MessageName> {
  const descriptor = ALL_MESSAGES.find((m) => m.name === name.toUpperCase())
  if (descriptor === undefined) throw new Error(`no descriptor for ${name}`)
  return descriptor
}

/** Fixture fields (pymavlink names and values) as encoder input. */
function toInput(descriptor: MessageDescriptor, fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(fields)) {
    const field = descriptor.fields.find((f) => f.name === camelCase(name))
    if (field === undefined) throw new Error(`${descriptor.name} has no field ${name}`)
    input[field.name] = field.type.endsWith('64_t') ? BigInt(value as number) : value
  }
  return input
}

const parser = (signing?: MavlinkSigning): MavlinkParser =>
  new MavlinkParser(signing === undefined ? { messages: ALL_MESSAGES } : { messages: ALL_MESSAGES, signing })
const encoder = (signing?: MavlinkSigning): MavlinkEncoder =>
  new MavlinkEncoder(
    signing === undefined
      ? { systemId: 42, componentId: 1, sequence: 17 }
      : { systemId: 42, componentId: 1, sequence: 17, signing }
  )
const kinds = (events: readonly ParseEvent[]): string[] =>
  events.map((e) => (e.kind === 'message' ? e.message.name : `${e.kind}:${'reason' in e ? e.reason : ''}`))

describe('pymavlink fixtures', () => {
  for (const fixture of fixtures.messages) {
    it(`${fixture.name}: encode matches pymavlink and decode handles fragmented input`, () => {
      const descriptor = descriptorNamed(fixture.name)
      // The fixture table is dynamic; `encode` only accepts fields checked against one message.
      const packet = encoder().encode(descriptor, toInput(descriptor, fixture.fields) as never)
      expect(toHex(packet)).toBe(fixture.hex)

      const p = parser()
      const decoded = [...packet].flatMap((byte) => p.push(Uint8Array.of(byte)))
      expect(decoded).toHaveLength(1)
      const message = decoded[0]!
      expect(message.name).toBe(fixture.name.toUpperCase())
      expect(message.header.systemId).toBe(42)
      expect(message.header.componentId).toBe(1)
      expect(message.header.sequence).toBe(17)
      for (const [name, expected] of Object.entries(fixture.fields)) {
        const actual: unknown = Reflect.get(message.fields, camelCase(name))
        if (typeof actual === 'bigint') expect(actual).toBe(BigInt(expected as number))
        else if (typeof expected === 'number') expect(actual as number).toBeCloseTo(expected, 6)
        else if (typeof expected === 'string') expect(actual).toBe(expected)
        else expect(Array.from(actual as ArrayLike<number>)).toEqual(expected)
      }
    })
  }

  it('encodes MAVLink 1 like pymavlink', () => {
    const v1 = new MavlinkEncoder({ systemId: 42, componentId: 1, sequence: 17, version: 1 })
    expect(toHex(v1.encode(HEARTBEAT, heartbeatFields))).toBe(fixtures.v1)
  })
})

describe('signing', () => {
  it('SHA-256 and MAVLink signatures match node:crypto', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 239, 1024]) {
      const input = Uint8Array.from({ length }, (_, i) => i & 255)
      expect(toHex(sha256(input))).toBe(createHash('sha256').update(input).digest('hex'))
    }
    const packet = fromHex(fixtures.messages[0]!.hex)
    expect(toHex(createSignature(key, packet))).toBe(
      createHash('sha256').update(key).update(packet).digest().subarray(0, 6).toString('hex')
    )
  })

  it('signed packet bytes, timestamp, link id and signature match pymavlink', () => {
    const tx = new MavlinkSigning({ secretKey: key, timestamp: 1000000000000, linkId: 7 })
    const e = encoder(tx)
    expect(toHex(e.encode(HEARTBEAT, heartbeatFields))).toBe(fixtures.signed)
    expect(tx.timestamp).toBe(1000000000001)

    const rx = parser(new MavlinkSigning({ secretKey: key, timestamp: 0 }))
    const [message] = rx.push(fromHex(fixtures.signed))
    expect(message?.name).toBe('HEARTBEAT')
    expect(message?.signature).toEqual({ linkId: 7, timestamp: 1000000000000, verified: true })
    expect(kinds(rx.parse(fromHex(fixtures.signed)))).toEqual(['rejected:replayed'])

    // A newer valid packet advances the stream's replay watermark too.
    e.sequence = 17
    const next = e.encode(HEARTBEAT, heartbeatFields)
    expect(kinds(rx.parse(next))).toEqual(['HEARTBEAT'])
    expect(kinds(rx.parse(next))).toEqual(['rejected:replayed'])
    expect(rx.stats.signatureErrors).toBe(2)
  })

  it('invalid signatures cannot poison a new stream timestamp', () => {
    const signing = new MavlinkSigning({ secretKey: key, timestamp: 0 })
    const rx = parser(signing)
    const packet = fromHex(fixtures.signed)
    const forged = packet.slice()
    forged[forged.length - 7] = forged[forged.length - 7]! ^ 1
    expect(kinds(rx.parse(forged))).toEqual(['rejected:bad-signature'])
    expect(signing.streamTimestamps.size).toBe(0)
    expect(kinds(rx.parse(packet))).toEqual(['HEARTBEAT'])
    expect(kinds(rx.parse(fromHex(fixtures.messages[0]!.hex)))).toEqual(['rejected:unsigned'])
  })

  it('allowUnsigned can let a badly signed frame through, marked unverified', () => {
    const signing = new MavlinkSigning({ secretKey: key.map((b) => b ^ 1), timestamp: 0, allowUnsigned: () => true })
    const [message] = parser(signing).push(fromHex(fixtures.signed))
    expect(message?.signature).toEqual({ linkId: 7, timestamp: 1000000000000, verified: false })
    expect(signing.stats).toMatchObject({ badSignatures: 1, acceptedUnsigned: 1 })
  })

  it('allowUnsigned lets unsigned frames through and counts them', () => {
    const signing = new MavlinkSigning({ secretKey: key, timestamp: 0, allowUnsigned: (header) => header.messageId === 0 })
    const rx = parser(signing)
    const [message] = rx.push(fromHex(fixtures.messages[0]!.hex))
    expect(message?.signature).toBeNull()
    expect(signing.stats).toEqual({ goodSignatures: 0, badSignatures: 0, acceptedUnsigned: 1, rejected: 0 })
  })

  it('a new signing stream accepts exactly the 60-second boundary and rejects older packets', () => {
    for (const age of [6000000, 6000001]) {
      const rx = parser(new MavlinkSigning({ secretKey: key, timestamp: 1000000000000 + age }))
      expect(kinds(rx.parse(fromHex(fixtures.signed)))).toEqual(age === 6000000 ? ['HEARTBEAT'] : ['rejected:stale-stream'])
    }
  })

  it('without a key, signed frames are delivered unverified', () => {
    const [message] = parser().push(fromHex(fixtures.signed))
    expect(message?.signature).toEqual({ linkId: 7, timestamp: 1000000000000, verified: false })
  })
})

describe('framing', () => {
  it('MAVLink 1, coalesced frames, noise and bad CRC recover to the next frame', () => {
    const p = parser()
    expect(kinds(p.parse(fromHex(fixtures.v1)))).toEqual(['HEARTBEAT'])
    const packet = fromHex(fixtures.messages[0]!.hex)
    const bad = packet.slice()
    bad[10] = bad[10]! ^ 1
    const events = p.parse(Uint8Array.from([1, 2, 3, ...packet, ...bad, ...packet]))
    expect(kinds(events)).toEqual(['garbage:noise', 'HEARTBEAT', 'garbage:crc', 'HEARTBEAT'])
    expect(p.stats).toMatchObject({ messagesReceived: 3, crcErrors: 1, droppedBytes: 3 + bad.length })
    expect(p.parse(new Uint8Array(0))).toEqual([])
  })

  it('a corrupted length byte loses only the corrupted frame', () => {
    // Upstream drops as many bytes as the bad length claims; resynchronising keeps the next frame.
    const packet = fromHex(fixtures.messages[0]!.hex)
    const bad = packet.slice()
    bad[1] = 200
    const p = parser()
    const events = p.parse(Uint8Array.from([...bad, ...packet, ...new Uint8Array(200)]))
    expect(kinds(events).filter((k) => k === 'HEARTBEAT')).toHaveLength(1)
  })

  it('unknown incompatibility flags and truncated packets are not delivered', () => {
    const packet = fromHex(fixtures.messages[0]!.hex)
    packet[2] = 2
    expect(kinds(parser().parse(packet))).toEqual(['garbage:incompat-flags'])
    const p = parser()
    expect(p.parse(fromHex(fixtures.messages[0]!.hex).subarray(0, 5))).toEqual([])
    expect(p.buffered).toBe(5)
  })

  it('a short MAVLink 1 packet is parsed without waiting for a MAVLink 2 header', () => {
    // MISSION_CLEAR_ALL has a two-byte MAVLink 1 payload.
    const bytes = [254, 2, 17, 42, 1, 45, 255, 190]
    const crc = crcAccumulate(MISSION_CLEAR_ALL.crcExtra, crcX25(Uint8Array.from(bytes.slice(1))))
    bytes.push(crc & 255, crc >> 8)
    const [message] = parser().push(Uint8Array.from(bytes))
    expect(message?.name).toBe('MISSION_CLEAR_ALL')
    if (message?.name === 'MISSION_CLEAR_ALL') expect(message.fields.targetSystem).toBe(255)
    expect(message?.header.version).toBe(1)
  })

  it('noise resynchronises to the earliest MAVLink 1 or MAVLink 2 marker', () => {
    for (const frames of [
      [fixtures.v1, fixtures.messages[0]!.hex],
      [fixtures.messages[0]!.hex, fixtures.v1]
    ]) {
      const bytes = Uint8Array.from([1, 2, 3, ...frames.flatMap((hex) => [...fromHex(hex)])])
      expect(
        parser()
          .push(bytes)
          .map((m) => m.name)
      ).toEqual(['HEARTBEAT', 'HEARTBEAT'])
    }
  })
})
