/**
 * Reproductions of the MAVLink rows of docs/upstream-bugs.md, run on upstream `mavlink.js` and its
 * bundled jspack. Verdicts and evidence: docs/bug-proofs/mavlink.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hex, loadUpstream, wire, type Loaded, type MessageConstructor, type UpstreamProcessor } from './_harness.js'

let u: Loaded
let tx: UpstreamProcessor

beforeEach(async () => {
  // jspack (loaded through `require`, outside the vm) prints its warnings with the real console.
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  u = await loadUpstream()
  tx = new u.MAVLink20Processor(null, 1, 1)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function message(name: string): MessageConstructor {
  const type = u.mavlink20.messages[name]
  if (type === undefined) throw new Error(`no upstream message ${name}`)
  return type
}

/** Frames upstream's own parser produces from `bytes`, as [name, reason]. */
function receive(bytes: Uint8Array): [string, string | undefined][] {
  const rx = new u.MAVLink20Processor(null, 255, 0)
  return (rx.parseBuffer(bytes) ?? []).map((m) => [m._name, m._reason])
}

function heartbeat(seq: number): Uint8Array {
  tx.seq = seq
  return wire(new (message('heartbeat'))(2, 3, 81, 0, 4, 3).pack(tx))
}

/** IEEE 754 binary32, little-endian, as ECMAScript's DataView writes it. */
function float32le(value: number): number[] {
  const view = new DataView(new ArrayBuffer(4))
  view.setFloat32(0, value, true)
  return [...new Uint8Array(view.buffer)]
}

describe('#150 parser discards the length a frame claims before checking it', () => {
  it('drops a good frame that starts inside a false start', () => {
    const good0 = heartbeat(0)
    const good1 = heartbeat(1)
    expect(hex(good0)).toBe('fd 09 00 00 00 01 01 00 00 00 00 00 00 00 02 03 51 04 03 e7 1e')
    // Each frame alone decodes.
    expect(receive(good0)).toEqual([['HEARTBEAT', undefined]])
    expect(receive(good1)).toEqual([['HEARTBEAT', undefined]])

    // A false start `FD 05 00` claims 5 + 10 + 2 = 17 bytes; the first good frame starts 3 bytes in.
    const rx = new u.MAVLink20Processor(null, 255, 0)
    const out = rx.parseBuffer(Uint8Array.from([0xfd, 0x05, 0x00, ...good0, ...good1])) ?? []
    expect(out.map((m) => [m._name, m._reason, m._name === 'HEARTBEAT' ? (m._header as { seq: number }).seq : null])).toEqual([
      ['BAD_DATA', 'Unknown MAVLink message ID (65792)', null],
      ['BAD_DATA', 'Bad prefix (2)', null],
      ['HEARTBEAT', undefined, 1]
    ])
    // The 17 bytes cut off as one bad frame are the false start plus the first 14 bytes of frame 0.
    expect(hex(out[0]!._msgbuf as Uint8Array)).toBe(hex([0xfd, 0x05, 0x00, ...good0.slice(0, 14)]))
  })
})

describe('#151 omitted float values are packed as NaN', () => {
  it('sends 0x7F800001 for an omitted float extension and a short float array', () => {
    const DistanceSensor = message('distance_sensor')
    const omitted = wire(new DistanceSensor(1, 2, 3, 4, 0, 0, 25, 255).pack(tx))
    // Payload offsets 14..17 horizontal_fov, 18..21 vertical_fov (`<IHHHBBBBff4fB`); then trimmed.
    expect(hex(omitted.slice(10 + 14, 10 + 22))).toBe('01 00 80 7f 01 00 80 7f')
    expect(omitted[1]).toBe(22)

    const short = wire(new DistanceSensor(1, 2, 3, 4, 0, 0, 25, 255, 0, 0, [0.5], 9).pack(tx))
    expect(hex(short.slice(10 + 22, 10 + 38))).toBe(
      hex([...float32le(0.5), 1, 0, 0x80, 0x7f, 1, 0, 0x80, 0x7f, 1, 0, 0x80, 0x7f])
    )
  })
})

describe('#152 an omitted numeric array shifts the following fields and corrupts the checksum', () => {
  it('BATTERY_STATUS without voltages_ext: mode is sent as 0, fault_bitmask as mode, the CRC skips bytes', () => {
    const BatteryStatus = message('battery_status')
    const voltages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const packed = new BatteryStatus(0, 0, 0, 0, voltages, 0, 0, 0, 0, 0, 0, undefined, 2, 5).pack(tx)
    // `pack` returns a sparse array: the 8 voltages_ext bytes were never written.
    expect(packed.length).toBe(63)
    expect(Object.keys(packed).length).toBe(55)
    const frame = wire(packed)
    // `<iih10HhBBBbiB4HBI`: voltages_ext at payload 41..48, mode at 49, fault_bitmask at 50..53.
    expect(frame[1]).toBe(51)
    expect([frame[10 + 49], frame[10 + 50]]).toEqual([0, 2])
    // CRC-16/MCRF4XX (upstream `x25Crc`) of the bytes on the wire, then CRC_EXTRA 154, versus the
    // checksum the frame carries.
    const onWire = u.mavlink20.x25Crc([154], u.mavlink20.x25Crc(frame.slice(1, -2)))
    expect([onWire, frame[frame.length - 2]! | (frame[frame.length - 1]! << 8)]).toEqual([20557, 54216])
    // Upstream's own parser rejects the frame upstream's own encoder produced.
    expect(receive(frame)).toEqual([
      ['BAD_DATA', 'invalid MAVLink CRC in msgID 147, got 54216 checksum, calculated payload checksum as 20557']
    ])
    // Control: with voltages_ext given, the same message round-trips.
    const control = wire(new BatteryStatus(0, 0, 0, 0, voltages, 0, 0, 0, 0, 0, 0, [0, 0, 0, 0], 2, 5).pack(tx))
    const rx = new u.MAVLink20Processor(null, 255, 0)
    expect((rx.parseBuffer(control) ?? []).map((m) => [m._name, m.mode, m.fault_bitmask])).toEqual([['BATTERY_STATUS', 2, 5]])
  })
})

describe('#153 -0 is packed as +0', () => {
  it('drops the sign of -0 but keeps it for a negative value that rounds to zero', () => {
    const Attitude = message('attitude')
    const negZero = wire(new Attitude(1, -0, 1, 1, 1, 1, 1).pack(tx))
    const tiny = wire(new Attitude(1, -1e-50, 1, 1, 1, 1, 1).pack(tx))
    // roll is payload bytes 4..7 (`<Iffffff`).
    expect(hex(negZero.slice(14, 18))).toBe('00 00 00 00')
    expect(hex(float32le(-0))).toBe('00 00 00 80')
    expect(hex(tiny.slice(14, 18))).toBe('00 00 00 80')
    // Upstream's decoder honours the sign bit, so its own round trip differs for the two inputs.
    const rx = new u.MAVLink20Processor(null, 255, 0)
    const [a] = rx.parseBuffer(negZero) ?? []
    const [b] = rx.parseBuffer(tiny) ?? []
    expect(Object.is(a?.roll, 0)).toBe(true)
    expect(Object.is(b?.roll, -0)).toBe(true)
  })
})

describe('#154 some messages cannot be packed', () => {
  it('TEST_TYPES with every field given throws (jspack has no char encoder)', () => {
    const TestTypes = message('test_types')
    const fields = [
      'A', // c
      'hello', // s
      1, // u8
      2, // u16
      3, // u32
      [4, 0], // u64 ([lowBits, highBits], jspack README note 6)
      5, // s8
      6, // s16
      7, // s32
      [8, 0], // s64
      1.5, // f
      2.5, // d
      [1, 2, 3], // u8_array
      [1, 2, 3], // u16_array
      [1, 2, 3], // u32_array
      [
        [1, 0],
        [2, 0],
        [3, 0]
      ], // u64_array
      [1, 2, 3], // s8_array
      [1, 2, 3], // s16_array
      [1, 2, 3], // s32_array
      [
        [1, 0],
        [2, 0],
        [3, 0]
      ], // s64_array
      [1, 2, 3], // f_array
      [1, 2, 3] // d_array
    ]
    expect(() => new TestTypes(...fields).pack(tx)).toThrow(new TypeError('fxn is not a function'))
  })

  it('omitted string and 64-bit extensions throw', () => {
    const AutopilotVersion = message('autopilot_version')
    const HomePosition = message('home_position')
    expect(() => new AutopilotVersion([1, 0], 1, 1, 1, 1, 'abcdefgh', 'abcdefgh', 'abcdefgh', 1, 1, [1, 0]).pack(tx)).toThrow(
      new TypeError("Cannot read properties of undefined (reading 'charCodeAt')")
    )
    expect(() => new HomePosition(1, 1, 1, 1, 1, 1, [1, 0, 0, 0], 1, 1, 1).pack(tx)).toThrow(
      new TypeError("Cannot read properties of undefined (reading 'length')")
    )
  })
})

describe('#155 frame checksum overwrites a field called crc', () => {
  it('CUBEPILOT_FIRMWARE_UPDATE_START crc reads as the frame checksum', () => {
    const frame = wire(new (message('cubepilot_firmware_update_start'))(1, 1, 1000, 0x12345678).pack(tx))
    expect(hex(frame)).toBe('fd 0a 00 00 00 01 01 54 c3 00 e8 03 00 00 78 56 34 12 01 01 ca 3f')
    const rx = new u.MAVLink20Processor(null, 255, 0)
    const [m] = rx.parseBuffer(frame) ?? []
    expect(m?.fieldnames).toEqual(['target_system', 'target_component', 'size', 'crc'])
    expect(m?.size).toBe(1000)
    // The payload carries 0x12345678; the decoded field holds the frame checksum 0x3fca.
    expect(m?.crc).toBe(0x3fca)
  })
})

describe('#157 keys that are not 32 bytes are padded or cut', () => {
  it('a 16-byte key signs as its zero-padded 32-byte form; a 40-byte key as its first 32 bytes', () => {
    const data = Uint8Array.from({ length: 20 }, (_, i) => i)
    const key16 = Uint8Array.from({ length: 16 }, (_, i) => i + 1)
    const padded = new Uint8Array(32)
    padded.set(key16)
    expect(hex(u.mavlink20.create_signature(key16, data))).toBe(hex(u.mavlink20.create_signature(padded, data)))

    const key40 = Uint8Array.from({ length: 40 }, (_, i) => 200 - i)
    expect(hex(u.mavlink20.create_signature(key40, data))).toBe(hex(u.mavlink20.create_signature(key40.slice(0, 32), data)))

    const key60 = new Uint8Array(60)
    expect(() => u.mavlink20.create_signature(key60, data)).toThrow('offset is out of bounds')
  })
})
