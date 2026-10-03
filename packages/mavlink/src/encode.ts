import { crcAccumulate, crcX25 } from './crc.js'
import { FIELD_TYPE_SIZE, type FieldDescriptor, type FieldType, type MessageDescriptor } from './descriptor.js'
import type { Mavlink1MessageName, MessageName } from './generated/messages.js'
import type { MessageInput } from './message.js'
import { INCOMPAT_FLAG_SIGNED, type MavlinkSigning } from './signing.js'

export const MAVLINK1_MARKER = 0xfe
export const MAVLINK2_MARKER = 0xfd
export const MAVLINK1_HEADER_LENGTH = 6
export const MAVLINK2_HEADER_LENGTH = 10

/** Source address and sequence number written into a frame header. */
export interface FrameAddress {
  readonly systemId: number
  readonly componentId: number
  /** 0-255. */
  readonly sequence: number
}

/** MAVLink 2 framing, optionally signed. */
export interface Mavlink2Format {
  readonly version?: 2
  readonly signing?: MavlinkSigning
}

/** MAVLink 1 framing: no extensions, no signing, ids up to 255. */
export interface Mavlink1Format {
  readonly version: 1
}

/**
 * Field values are packed as upstream's jspack packs them (`_EnInt`, `_En754`, `_EnString`), so the
 * same input gives the same bytes. `RangeError` is thrown for what the types already forbid (a field
 * of the wrong type, a required field left out), for 64-bit values outside their type, and where
 * upstream's `pack` throws.
 */

const INTEGER_RANGE: Readonly<
  Record<'uint8_t' | 'int8_t' | 'uint16_t' | 'int16_t' | 'uint32_t' | 'int32_t', readonly [number, number]>
> = {
  uint8_t: [0, 0xff],
  int8_t: [-0x80, 0x7f],
  uint16_t: [0, 0xffff],
  int16_t: [-0x8000, 0x7fff],
  uint32_t: [0, 0xffffffff],
  int32_t: [-0x80000000, 0x7fffffff]
}

/** jspack's bit patterns for NaN (and for a value it was not given): mantissa 1, exponent all ones. */
const NAN_FLOAT_BITS = 0x7f800001
const NAN_DOUBLE_HIGH_BITS = 0x7ff00000

/** Where upstream's generated `pack` throws (a crash), the encoder throws `RangeError` with this. */
const UPSTREAM_THROWS = 'upstream mavlink.js cannot encode this'

function fail(descriptor: MessageDescriptor, field: FieldDescriptor, problem: string): never {
  throw new RangeError(`${descriptor.name}.${field.name}: ${problem}`)
}

/** jspack `_EnInt`: clamped to the type's range, then truncated toward zero (`val & 255`); NaN packs as 0. */
function writeInteger(view: DataView, type: keyof typeof INTEGER_RANGE, offset: number, value: number): void {
  const [min, max] = INTEGER_RANGE[type]
  const clamped = value < min ? min : value > max ? max : value
  const integer = Number.isNaN(clamped) ? 0 : Math.trunc(clamped)
  const size = FIELD_TYPE_SIZE[type]
  if (size === 1) view.setUint8(offset, integer & 0xff)
  else if (size === 2) view.setUint16(offset, integer & 0xffff, true)
  else view.setUint32(offset, integer >>> 0, true)
}

const bits = new DataView(new ArrayBuffer(4))

/**
 * jspack `_En754` for float32: the nearest float32, ties away from zero (DataView rounds ties to
 * even). Verified against jspack in the oracle tests.
 */
function float32TiesAway(value: number): number {
  const nearest = Math.fround(value)
  if (nearest === value || !Number.isFinite(nearest)) return nearest
  bits.setFloat32(0, nearest)
  const pattern = bits.getUint32(0)
  // The float32 on the other side of `value`: one step up or down in magnitude.
  bits.setUint32(0, Math.abs(nearest) < Math.abs(value) ? pattern + 1 : pattern - 1)
  const other = bits.getFloat32(0)
  return Math.abs(value - nearest) === Math.abs(other - value) && Math.abs(other) > Math.abs(nearest) ? other : nearest
}

/** jspack `_En754`: NaN as mantissa 1, and +0 for -0 (its sign test is `v < 0`). */
function writeFloat(view: DataView, type: 'float' | 'double', offset: number, value: number): void {
  if (Number.isNaN(value)) {
    if (type === 'float') view.setUint32(offset, NAN_FLOAT_BITS, true)
    else view.setBigUint64(offset, (BigInt(NAN_DOUBLE_HIGH_BITS) << 32n) | 1n, true)
  } else if (type === 'float') {
    view.setFloat32(offset, value === 0 ? 0 : float32TiesAway(value), true)
  } else {
    view.setFloat64(offset, value === 0 ? 0 : value, true)
  }
}

function writeBigInt(
  view: DataView,
  type: 'int64_t' | 'uint64_t',
  offset: number,
  value: bigint,
  onError: (problem: string) => never
): void {
  if (type === 'uint64_t') {
    if (value < 0n || value > 0xffffffffffffffffn) onError(`${value} is not a uint64_t`)
    view.setBigUint64(offset, value, true)
  } else {
    if (value < -0x8000000000000000n || value > 0x7fffffffffffffffn) onError(`${value} is not an int64_t`)
    view.setBigInt64(offset, value, true)
  }
}

/**
 * One numeric element. `undefined` (an omitted scalar extension field or a missing element of an
 * array) packs as jspack packs `undefined`: 0 for integers, NaN for float and double (upstream bug,
 * see `docs/upstream-bugs.md`); for 64-bit integers upstream throws, and so does this.
 */
function writeElement(
  view: DataView,
  type: Exclude<FieldType, 'char'>,
  offset: number,
  value: unknown,
  onError: (problem: string) => never
): void {
  if (type === 'int64_t' || type === 'uint64_t') {
    if (value === undefined) onError(UPSTREAM_THROWS + ' (jspack cannot pack an omitted 64-bit value)')
    if (typeof value !== 'bigint') onError(`expected a bigint, got ${typeof value}`)
    writeBigInt(view, type, offset, value, onError)
    return
  }
  if (value !== undefined && typeof value !== 'number') onError(`expected a number, got ${typeof value}`)
  const number = value ?? Number.NaN
  if (type === 'float' || type === 'double') writeFloat(view, type, offset, number)
  else writeInteger(view, type, offset, number)
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return typeof value === 'object' && value !== null && 'length' in value && typeof value.length === 'number'
}

/** A payload as jspack builds it: bytes, and which of them it never wrote (holes in its array). */
interface PackedPayload {
  readonly bytes: Uint8Array
  /** 1 where jspack left a hole (see `packPayload`); null when every byte was written. */
  readonly holes: Uint8Array | null
}

/**
 * jspack `Pack` over the message's fields in wire order, as upstream's generated `pack` calls it.
 * jspack takes one value per field from a cursor, except that a numeric array field given no array
 * (an omitted extension array) writes nothing and does not advance the cursor: every later field
 * then packs its predecessor's value (upstream bug, see `docs/upstream-bugs.md`). Bytes it does not
 * write stay holes in its array: 0 on the wire, but skipped by the checksum.
 */
function packPayload(descriptor: MessageDescriptor, fields: object, version: 1 | 2): PackedPayload {
  const payload = new Uint8Array(version === 1 ? descriptor.baseLength : descriptor.length)
  const view = new DataView(payload.buffer)
  let holes: Uint8Array | null = null
  const wire = [...descriptor.fields].sort((a, b) => a.offset - b.offset).filter((f) => version === 2 || f.extension !== true)
  for (const field of descriptor.fields) {
    if (field.extension !== true && Reflect.get(fields, field.name) === undefined) fail(descriptor, field, 'missing')
  }
  const values = wire.map((f): unknown => Reflect.get(fields, f.name))
  let cursor = 0
  for (const field of wire) {
    const onError: (problem: string) => never = (problem) => fail(descriptor, field, problem)
    const value = values[cursor]
    const count = field.arrayLength ?? 1
    const type = field.type
    if (type === 'char') {
      // `_EnString`: each character's code, stored in a byte (so its low 8 bits); NUL after the end.
      if (field.arrayLength === undefined) onError(UPSTREAM_THROWS + ' (jspack cannot pack a scalar char)')
      if (value === undefined) onError(UPSTREAM_THROWS + ' (jspack cannot pack an omitted string)')
      if (typeof value !== 'string') onError(`expected a string, got ${typeof value}`)
      for (let i = 0; i < Math.min(count, value.length); i++) payload[field.offset + i] = value.charCodeAt(i)
    } else if (field.arrayLength !== undefined && (type === 'uint8_t' || type === 'int8_t')) {
      // Byte arrays are jspack strings: each element stored in a byte (low 8 bits, NaN as 0).
      if (value === undefined) onError(UPSTREAM_THROWS + ' (jspack cannot pack an omitted byte array)')
      if (!isArrayLike(value)) onError('expected an array')
      for (let i = 0; i < Math.min(count, value.length); i++) {
        const element = value[i]
        if (typeof element !== 'number') onError(`expected numbers, got ${typeof element}`)
        payload[field.offset + i] = element
      }
    } else if (field.arrayLength !== undefined || isArrayLike(value)) {
      const size = FIELD_TYPE_SIZE[type]
      if (field.arrayLength === undefined || !isArrayLike(value)) {
        // No array for an array field (or an array for a scalar): nothing written, cursor stays.
        holes ??= new Uint8Array(payload.length)
        holes.fill(1, field.offset, field.offset + size * count)
        continue
      }
      for (let i = 0; i < count; i++) writeElement(view, type, field.offset + i * size, value[i], onError)
    } else {
      writeElement(view, type, field.offset, value, onError)
    }
    cursor++
  }
  return { bytes: payload, holes }
}

/**
 * Encodes fields into an untruncated payload: `descriptor.length` bytes for MAVLink 2,
 * `descriptor.baseLength` (no extensions) for MAVLink 1. Values are packed as upstream's jspack
 * packs them: integers clamped to their type, strings and arrays cut to the field's length,
 * strings and byte arrays one byte per element (its low 8 bits).
 */
export function encodePayload<N extends MessageName>(
  descriptor: MessageDescriptor<N>,
  fields: NoInfer<MessageInput<N>>,
  version: 1 | 2 = 2
): Uint8Array {
  return packPayload(descriptor, fields, version).bytes
}

/** Length of `payload` without trailing zero bytes, keeping at least one byte (MAVLink 2 truncation). */
export function truncatedLength(payload: Uint8Array): number {
  let length = payload.length
  while (length > 1 && payload[length - 1] === 0) length--
  return length
}

function encodeFrameImpl(
  descriptor: MessageDescriptor,
  fields: object,
  address: FrameAddress,
  format: Mavlink1Format | Mavlink2Format
): Uint8Array {
  const v1 = format.version === 1
  if (v1 && descriptor.id > 0xff) throw new RangeError(`${descriptor.name} (id ${descriptor.id}) cannot be sent as MAVLink 1`)
  const { bytes: payload, holes } = packPayload(descriptor, fields, v1 ? 1 : 2)
  const signing = format.version === 1 ? undefined : format.signing
  const length = v1 ? payload.length : truncatedLength(payload)
  const headerLength = v1 ? MAVLINK1_HEADER_LENGTH : MAVLINK2_HEADER_LENGTH
  const frame = new Uint8Array(headerLength + length + 2)
  const sequence = address.sequence & 0xff
  if (v1) {
    frame.set([MAVLINK1_MARKER, length, sequence, address.systemId, address.componentId, descriptor.id])
  } else {
    const flags = signing === undefined ? 0 : INCOMPAT_FLAG_SIGNED
    const id = descriptor.id
    frame.set([
      MAVLINK2_MARKER,
      length,
      flags,
      0,
      sequence,
      address.systemId,
      address.componentId,
      id & 0xff,
      (id >> 8) & 0xff,
      id >> 16
    ])
  }
  frame.set(payload.subarray(0, length), headerLength)
  let crc = crcX25(frame.subarray(1, headerLength))
  // Upstream's x25Crc iterates with forEach, which skips the holes jspack left in the payload.
  for (let i = 0; i < length; i++) if (holes?.[i] !== 1) crc = crcAccumulate(payload[i]!, crc)
  crc = crcAccumulate(descriptor.crcExtra, crc)
  frame[headerLength + length] = crc & 0xff
  frame[headerLength + length + 1] = crc >> 8
  return signing === undefined ? frame : signing.sign(frame)
}

/**
 * Encodes one complete frame. MAVLink 2 by default (truncated, signed if `format.signing` is set);
 * pass `{ version: 1 }` for MAVLink 1, which only accepts messages with ids up to 255.
 *
 *   encodeFrame(HEARTBEAT, { type: MavType.MAV_TYPE_GCS, ... }, { systemId: 255, componentId: 190, sequence: 0 })
 */
export function encodeFrame<N extends MessageName>(
  descriptor: MessageDescriptor<N>,
  fields: NoInfer<MessageInput<N>>,
  address: FrameAddress,
  format?: Mavlink2Format
): Uint8Array
export function encodeFrame<N extends Mavlink1MessageName>(
  descriptor: MessageDescriptor<N>,
  fields: NoInfer<MessageInput<N>>,
  address: FrameAddress,
  format: Mavlink1Format
): Uint8Array
export function encodeFrame<N extends MessageName>(
  descriptor: MessageDescriptor<N>,
  fields: NoInfer<MessageInput<N>>,
  address: FrameAddress,
  format: Mavlink1Format | Mavlink2Format = {}
): Uint8Array {
  return encodeFrameImpl(descriptor, fields, address, format)
}

/** Messages an encoder of protocol version `V` can send. */
export type EncodableName<V extends 1 | 2> = V extends 1 ? Mavlink1MessageName : MessageName

export interface EncoderOptions<V extends 1 | 2> {
  readonly systemId: number
  readonly componentId: number
  /** Protocol version, default 2. */
  readonly version?: V
  /** Signs every frame (MAVLink 2 only). */
  readonly signing?: V extends 2 ? MavlinkSigning : never
  /** First sequence number, default 0. */
  readonly sequence?: number
}

/**
 * Encodes frames for one source address, numbering them. Upstream `MAVLink20Processor.send`
 * without the transport.
 */
export class MavlinkEncoder<V extends 1 | 2 = 2> {
  readonly systemId: number
  readonly componentId: number
  /** Sequence number of the next frame; wraps at 256. */
  sequence: number
  private readonly format: Mavlink1Format | Mavlink2Format

  constructor(options: EncoderOptions<V>) {
    this.systemId = options.systemId
    this.componentId = options.componentId
    this.sequence = options.sequence ?? 0
    this.format = options.version === 1 ? { version: 1 } : options.signing === undefined ? {} : { signing: options.signing }
  }

  /** Encodes one frame and advances the sequence number. */
  encode<N extends EncodableName<V>>(descriptor: MessageDescriptor<N>, fields: NoInfer<MessageInput<N>>): Uint8Array {
    const address = { systemId: this.systemId, componentId: this.componentId, sequence: this.sequence }
    const frame = encodeFrameImpl(descriptor, fields, address, this.format)
    this.sequence = (this.sequence + 1) & 0xff
    return frame
  }
}
