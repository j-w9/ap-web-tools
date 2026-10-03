import { describe, expect, expectTypeOf, it } from 'vitest'
import { decodePayload } from './decode.js'
import { FIELD_TYPE_SIZE, type MessageDescriptor } from './descriptor.js'
import { encodeFrame, encodePayload, MavlinkEncoder, truncatedLength } from './encode.js'
import { enumEntries, enumName, flagNames } from './enums.js'
import { MavAutopilot, MavComponent, MavModeFlag, MavState, MavType } from './generated/enums.js'
import {
  AIRLINK_AUTH_RESPONSE,
  ALL_MESSAGES,
  ATTITUDE,
  AUTOPILOT_VERSION,
  BATTERY_STATUS,
  FILE_TRANSFER_PROTOCOL,
  HEARTBEAT,
  NAMED_VALUE_FLOAT,
  STATUSTEXT,
  type Heartbeat,
  type MessageName
} from './generated/messages.js'
import type { Message, ReceivedMessage } from './message.js'
import { MavlinkParser } from './parser.js'
import { MavlinkSigning } from './signing.js'
import { MESSAGE_TABLE } from './generated/table.js'
import { mavComponentName, mavComponents, mavlinkMessage } from './tables.js'

const heartbeat = {
  type: MavType.MAV_TYPE_QUADROTOR,
  autopilot: MavAutopilot.MAV_AUTOPILOT_ARDUPILOTMEGA,
  baseMode: MavModeFlag.MAV_MODE_FLAG_SAFETY_ARMED | MavModeFlag.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  customMode: 4,
  systemStatus: MavState.MAV_STATE_ACTIVE,
  mavlinkVersion: 3
} as const satisfies Heartbeat

const address = { systemId: 1, componentId: 1, sequence: 0 }

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('round trip', () => {
  it('every message survives encode then parse, with random contents', () => {
    const next = random(1)
    for (const descriptor of ALL_MESSAGES) {
      const payload = Uint8Array.from({ length: descriptor.length }, () => Math.floor(next() * 256))
      for (const field of descriptor.fields) {
        const size = FIELD_TYPE_SIZE[field.type]
        for (let i = 0; i < (field.arrayLength ?? 1); i++) {
          const at = field.offset + i * size
          if (field.type === 'char') payload[at] = 32 + Math.floor(next() * 95)
          if (field.type === 'float' || field.type === 'double') payload[at + size - 1]! &= 0xbf
        }
      }
      const fields = decodePayload(descriptor, payload)
      const frame = encodeFrame(descriptor, fields as never, address)
      const [message] = new MavlinkParser({ messages: ALL_MESSAGES }).push(frame)
      expect(message?.name).toBe(descriptor.name)
      expect(message?.fields).toEqual(fields)
      expect(encodePayload(descriptor, fields as never)).toEqual(payload)
    }
  })

  it('decodes any fragmentation of a stream of frames', () => {
    const encoder = new MavlinkEncoder({ systemId: 1, componentId: 1 })
    const frames = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0
        ? encoder.encode(HEARTBEAT, { ...heartbeat, customMode: i })
        : encoder.encode(ATTITUDE, { timeBootMs: i, roll: 0.5, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 })
    )
    const stream = Uint8Array.from(frames.flatMap((f) => [...f]))
    const next = random(2)
    for (let trial = 0; trial < 20; trial++) {
      const parser = new MavlinkParser({ messages: [HEARTBEAT, ATTITUDE] })
      const received: ReceivedMessage<'HEARTBEAT' | 'ATTITUDE'>[] = []
      for (let at = 0; at < stream.length;) {
        const size = 1 + Math.floor(next() * 40)
        received.push(...parser.push(stream.subarray(at, at + size)))
        at += size
      }
      expect(received.map((m) => m.header.sequence)).toEqual(frames.map((_, i) => i))
      expect(parser.buffered).toBe(0)
    }
  })

  it('handles a large stream in one push with bounded buffering', () => {
    const encoder = new MavlinkEncoder({ systemId: 1, componentId: 1 })
    const frame = encoder.encode(FILE_TRANSFER_PROTOCOL, {
      targetNetwork: 0,
      targetSystem: 1,
      targetComponent: 1,
      payload: new Uint8Array(251).fill(7)
    })
    const stream = new Uint8Array(frame.length * 1000)
    for (let i = 0; i < 1000; i++) stream.set(frame, i * frame.length)
    const parser = new MavlinkParser({ messages: [FILE_TRANSFER_PROTOCOL] })
    expect(parser.push(stream)).toHaveLength(1000)
    expect(parser.stats).toMatchObject({ bytesReceived: stream.length, messagesReceived: 1000, droppedBytes: 0 })
  })
})

describe('encoding', () => {
  it('truncates trailing zeros in MAVLink 2 but keeps one payload byte', () => {
    expect(truncatedLength(Uint8Array.of(1, 0, 2, 0, 0))).toBe(3)
    expect(truncatedLength(new Uint8Array(4))).toBe(1)
    const frame = encodeFrame(
      ATTITUDE,
      { timeBootMs: 0, roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      address
    )
    expect(frame[1]).toBe(1)
    const [message] = new MavlinkParser({ messages: [ATTITUDE] }).push(frame)
    expect(message?.fields.yawspeed).toBe(0)
  })

  it('makes extension fields optional and omits them from MAVLink 1', () => {
    const fields = {
      id: 0,
      batteryFunction: 0,
      type: 0,
      temperature: 2500,
      voltages: [12000],
      currentBattery: -1,
      currentConsumed: 0,
      energyConsumed: 0,
      batteryRemaining: 50
    } as const
    const v2 = encodeFrame(BATTERY_STATUS, { ...fields, chargeState: 2, voltagesExt: [1, 2] }, address)
    const [message] = new MavlinkParser({ messages: [BATTERY_STATUS] }).push(v2)
    expect(message?.fields.chargeState).toBe(2)
    expect(Array.from(message?.fields.voltages ?? [])).toEqual([12000, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(message?.fields.voltagesExt).toEqual(Uint16Array.of(1, 2, 0, 0))

    const v1 = encodeFrame(BATTERY_STATUS, { ...fields, chargeState: 2 }, address, { version: 1 })
    expect(v1[1]).toBe(BATTERY_STATUS.baseLength)
    const [old] = new MavlinkParser({ messages: [BATTERY_STATUS] }).push(v1)
    expect(old?.header.version).toBe(1)
    expect(old?.fields.chargeState).toBe(0)
  })

  it('encodes 64-bit fields as bigint and strings as zero-padded bytes', () => {
    const fields = {
      capabilities: 0xffff_ffff_ffffn,
      flightSwVersion: 1,
      middlewareSwVersion: 2,
      osSwVersion: 3,
      boardVersion: 4,
      flightCustomVersion: [1, 2, 3, 4, 5, 6, 7, 8],
      middlewareCustomVersion: new Uint8Array(8),
      osCustomVersion: new Uint8Array(8),
      vendorId: 5,
      productId: 6,
      uid: 0xfedc_ba98_7654_3210n
    }
    const [message] = new MavlinkParser({ messages: [AUTOPILOT_VERSION] }).push(encodeFrame(AUTOPILOT_VERSION, fields, address))
    expect(message?.fields.uid).toBe(0xfedc_ba98_7654_3210n)
    expect(message?.fields.capabilities).toBe(0xffff_ffff_ffffn)
    expect(message?.fields.uid2).toEqual(new Uint8Array(18))

    const text = encodeFrame(STATUSTEXT, { severity: 6, text: 'Boat ready' }, address)
    const [status] = new MavlinkParser({ messages: [STATUSTEXT] }).push(text)
    expect(status?.fields.text).toBe('Boat ready')
  })

  it('rejects values that do not fit their fields', () => {
    expect(() => encodeFrame(HEARTBEAT, { ...heartbeat, customMode: -1 }, address)).toThrow(
      /HEARTBEAT.customMode: -1 is not a uint32_t/
    )
    expect(() => encodeFrame(HEARTBEAT, { ...heartbeat, customMode: 1.5 }, address)).toThrow(RangeError)
    expect(() => encodeFrame(STATUSTEXT, { severity: 6, text: 'x'.repeat(51) }, address)).toThrow(/51 bytes, the field holds 50/)
    expect(() =>
      encodeFrame(
        BATTERY_STATUS,
        {
          ...{
            id: 0,
            batteryFunction: 0,
            type: 0,
            temperature: 0,
            currentBattery: 0,
            currentConsumed: 0,
            energyConsumed: 0,
            batteryRemaining: 0
          },
          voltages: new Array<number>(11).fill(0)
        },
        address
      )
    ).toThrow(/11 elements/)
    expect(() =>
      encodeFrame(
        AUTOPILOT_VERSION,
        {
          ...{
            flightSwVersion: 0,
            middlewareSwVersion: 0,
            osSwVersion: 0,
            boardVersion: 0,
            flightCustomVersion: [],
            middlewareCustomVersion: [],
            osCustomVersion: [],
            vendorId: 0,
            productId: 0,
            uid: 0n
          },
          capabilities: -1n
        },
        address
      )
    ).toThrow(/uint64_t/)
    // @ts-expect-error -- deliberately incomplete, to show the runtime check behind the types
    expect(() => encodeFrame(HEARTBEAT, { type: 1 }, address)).toThrow(/autopilot: missing/)
  })

  it('numbers frames and wraps the sequence at 256', () => {
    const encoder = new MavlinkEncoder({ systemId: 9, componentId: 8, sequence: 255 })
    expect(encoder.encode(HEARTBEAT, heartbeat)[4]).toBe(255)
    expect(encoder.encode(HEARTBEAT, heartbeat)[4]).toBe(0)
  })

  it('signs every frame of a signing encoder', () => {
    const signing = new MavlinkSigning({ secretKey: new Uint8Array(32).fill(1), timestamp: 100 })
    const encoder = new MavlinkEncoder({ systemId: 9, componentId: 8, signing })
    const frame = encoder.encode(HEARTBEAT, heartbeat)
    expect(frame[2]).toBe(1)
    const parser = new MavlinkParser({
      messages: [HEARTBEAT],
      signing: new MavlinkSigning({ secretKey: new Uint8Array(32).fill(1), timestamp: 0 })
    })
    expect(parser.push(frame)[0]?.signature).toEqual({ linkId: 0, timestamp: 100, verified: true })
    expect(() => new MavlinkSigning({ secretKey: new Uint8Array(31) })).toThrow(RangeError)
  })
})

describe('parsing', () => {
  it('reports frames for messages it was not given as unknown, consuming the whole frame', () => {
    const frame = encodeFrame(
      ATTITUDE,
      { timeBootMs: 1, roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      address
    )
    const parser = new MavlinkParser({ messages: [HEARTBEAT] })
    const events = parser.parse(Uint8Array.from([...frame, ...encodeFrame(HEARTBEAT, heartbeat, address)]))
    expect(events.map((e) => e.kind)).toEqual(['unknown', 'message'])
    expect(events[0]).toMatchObject({ kind: 'unknown', header: { messageId: 30, version: 2 }, frame })
    expect(parser.stats.unknownMessages).toBe(1)
  })

  it('ignores payload bytes beyond the known fields (newer dialect)', () => {
    const descriptor: MessageDescriptor<'HEARTBEAT'> = {
      ...HEARTBEAT,
      length: 5,
      fields: HEARTBEAT.fields.filter((f) => f.offset < 5)
    }
    expect(decodePayload(descriptor, Uint8Array.of(1, 0, 0, 0, 2, 3, 4)).type).toBe(2)
  })

  it('reset drops a partial frame', () => {
    const parser = new MavlinkParser({ messages: [HEARTBEAT] })
    const frame = encodeFrame(HEARTBEAT, heartbeat, address)
    parser.push(frame.subarray(0, 7))
    parser.reset()
    expect(parser.push(frame)).toHaveLength(1)
  })
})

describe('types', () => {
  it('narrows decoded messages on name, to the messages the parser was given', () => {
    const parser = new MavlinkParser({ messages: [HEARTBEAT, NAMED_VALUE_FLOAT] })
    const [message] = parser.push(encodeFrame(NAMED_VALUE_FLOAT, { timeBootMs: 1, name: 'RPM', value: 1500 }, address))
    expectTypeOf(message).toEqualTypeOf<ReceivedMessage<'HEARTBEAT' | 'NAMED_VALUE_FLOAT'> | undefined>()
    if (message?.name === 'NAMED_VALUE_FLOAT') {
      expectTypeOf(message.fields.name).toBeString()
      expectTypeOf(message.id).toEqualTypeOf<251>()
      expect(message.fields).toEqual({ timeBootMs: 1, name: 'RPM', value: 1500 })
    } else {
      expect.unreachable()
    }
    expectTypeOf<Message<'HEARTBEAT'>['fields']['type']>().toEqualTypeOf<MavType>()
    expectTypeOf<Message<'HEARTBEAT'>['fields']['baseMode']>().toEqualTypeOf<number>()
    expectTypeOf<Message<'AUTOPILOT_VERSION'>['fields']['uid']>().toEqualTypeOf<bigint>()
    expectTypeOf<Message<'BATTERY_STATUS'>['fields']['voltages']>().toEqualTypeOf<Uint16Array>()
    expectTypeOf<Message<'STATUSTEXT'>['fields']['text']>().toEqualTypeOf<string>()
    expectTypeOf<Message['name']>().toEqualTypeOf<MessageName>()
  })

  it('checks encoder input per message', () => {
    // @ts-expect-error -- customMode is required
    expect(() => encodeFrame(HEARTBEAT, { ...heartbeat, customMode: undefined }, address)).toThrow()
    // @ts-expect-error -- 77 is not a MAV_STATE
    encodeFrame(HEARTBEAT, { ...heartbeat, systemStatus: 77 }, address)
    // @ts-expect-error -- 64-bit fields take bigint
    expect(() => encodeFrame(AUTOPILOT_VERSION, { capabilities: 1 }, address)).toThrow()
    encodeFrame(AIRLINK_AUTH_RESPONSE, { respType: 0 }, address)
    const v1Frame = (): Uint8Array =>
      // @ts-expect-error -- AIRLINK_AUTH_RESPONSE (id 52001) does not fit a MAVLink 1 header
      encodeFrame(AIRLINK_AUTH_RESPONSE, { respType: 0 }, address, { version: 1 })
    expect(v1Frame).toThrow(/cannot be sent as MAVLink 1/)
    const v1 = new MavlinkEncoder({ systemId: 1, componentId: 1, version: 1 })
    expectTypeOf(v1).toEqualTypeOf<MavlinkEncoder<1>>()
    // @ts-expect-error -- nor does a MAVLink 1 encoder accept it
    expect(() => v1.encode(AIRLINK_AUTH_RESPONSE, { respType: 0 })).toThrow()
    const signing = new MavlinkSigning({ secretKey: new Uint8Array(32) })
    // @ts-expect-error -- MAVLink 1 encoders cannot sign
    expect(new MavlinkEncoder({ systemId: 1, componentId: 1, version: 1, signing }).sequence).toBe(0)
  })
})

describe('enums and tables', () => {
  it('looks up enum names, entries and flags', () => {
    expect(enumName(MavType, 2)).toBe('MAV_TYPE_QUADROTOR')
    expect(enumName(MavType, 99999)).toBeUndefined()
    expect(enumEntries(MavState)[0]).toEqual({ name: 'MAV_STATE_UNINIT', value: 0 })
    expect(flagNames(MavModeFlag, heartbeat.baseMode)).toEqual([
      'MAV_MODE_FLAG_CUSTOM_MODE_ENABLED',
      'MAV_MODE_FLAG_SAFETY_ARMED'
    ])
    expect(HEARTBEAT.fields.find((f) => f.name === 'baseMode')).toMatchObject({ enum: MavModeFlag, bitmask: true })
  })

  it('provides the message and component tables Stream Stats uses', () => {
    expect(mavlinkMessage(0)).toMatchObject({ name: 'HEARTBEAT', crcExtra: 50 })
    expect(mavlinkMessage(147)?.crcExtra).toBe(154)
    expect(mavlinkMessage(99999)).toBeUndefined()
    expect(mavComponentName(1)).toBe('MAV_COMP_ID_AUTOPILOT1')
    expect(mavComponentName(2)).toBeUndefined()
    expect(mavComponents().find((c) => c.id === 190)?.name).toBe('MAV_COMP_ID_MISSIONPLANNER')
    expect(mavComponents().length).toBe(Object.keys(MavComponent).length)
    const ids = ALL_MESSAGES.map((m) => m.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(MESSAGE_TABLE.map((m) => ({ ...m }))).toEqual(ALL_MESSAGES.map(({ id, name, crcExtra }) => ({ id, name, crcExtra })))
  })
})
