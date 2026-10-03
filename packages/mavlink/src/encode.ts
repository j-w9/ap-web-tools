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

const INTEGER_RANGE: Readonly<
  Record<Exclude<FieldType, 'float' | 'double' | 'int64_t' | 'uint64_t'>, readonly [number, number]>
> = {
  char: [0, 0xff],
  uint8_t: [0, 0xff],
  int8_t: [-0x80, 0x7f],
  uint16_t: [0, 0xffff],
  int16_t: [-0x8000, 0x7fff],
  uint32_t: [0, 0xffffffff],
  int32_t: [-0x80000000, 0x7fffffff]
}

let utf8: TextEncoder | undefined

function fail(descriptor: MessageDescriptor, field: FieldDescriptor, problem: string): never {
  throw new RangeError(`${descriptor.name}.${field.name}: ${problem}`)
}

function writeNumber(
  view: DataView,
  type: Exclude<FieldType, 'int64_t' | 'uint64_t'>,
  offset: number,
  value: number,
  onError: (problem: string) => never
): void {
  if (type === 'float') return view.setFloat32(offset, value, true)
  if (type === 'double') return view.setFloat64(offset, value, true)
  const [min, max] = INTEGER_RANGE[type]
  if (!Number.isInteger(value) || value < min || value > max) onError(`${value} is not a ${type}`)
  switch (type) {
    case 'char':
    case 'uint8_t':
      return view.setUint8(offset, value)
    case 'int8_t':
      return view.setInt8(offset, value)
    case 'uint16_t':
      return view.setUint16(offset, value, true)
    case 'int16_t':
      return view.setInt16(offset, value, true)
    case 'uint32_t':
      return view.setUint32(offset, value, true)
    case 'int32_t':
      return view.setInt32(offset, value, true)
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

function writeValue(view: DataView, type: FieldType, offset: number, value: unknown, onError: (problem: string) => never): void {
  if (type === 'int64_t' || type === 'uint64_t') {
    if (typeof value !== 'bigint') onError(`expected a bigint, got ${typeof value}`)
    writeBigInt(view, type, offset, value, onError)
  } else {
    if (typeof value !== 'number') onError(`expected a number, got ${typeof value}`)
    writeNumber(view, type, offset, value, onError)
  }
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return typeof value === 'object' && value !== null && 'length' in value && typeof value.length === 'number'
}

/**
 * Encodes fields into an untruncated payload: `descriptor.length` bytes for MAVLink 2,
 * `descriptor.baseLength` (no extensions) for MAVLink 1. Throws `RangeError` for values that do not
 * fit their field, so mistakes surface instead of wrapping silently.
 */
export function encodePayload<N extends MessageName>(
  descriptor: MessageDescriptor<N>,
  fields: NoInfer<MessageInput<N>>,
  version: 1 | 2 = 2
): Uint8Array {
  const payload = new Uint8Array(version === 1 ? descriptor.baseLength : descriptor.length)
  const view = new DataView(payload.buffer)
  for (const field of descriptor.fields) {
    if (version === 1 && field.extension === true) continue
    const onError: (problem: string) => never = (problem) => fail(descriptor, field, problem)
    const value: unknown = Reflect.get(fields, field.name)
    if (value === undefined) {
      if (field.extension === true) continue
      onError('missing')
    }
    const size = FIELD_TYPE_SIZE[field.type]
    if (field.type === 'char') {
      if (typeof value !== 'string') onError(`expected a string, got ${typeof value}`)
      utf8 ??= new TextEncoder()
      const bytes = utf8.encode(value)
      const capacity = field.arrayLength ?? 1
      if (bytes.length > capacity) onError(`"${value}" is ${bytes.length} bytes, the field holds ${capacity}`)
      payload.set(bytes, field.offset)
    } else if (field.arrayLength === undefined) {
      writeValue(view, field.type, field.offset, value, onError)
    } else {
      if (!isArrayLike(value)) onError('expected an array')
      if (value.length > field.arrayLength) onError(`${value.length} elements, the field holds ${field.arrayLength}`)
      for (let i = 0; i < value.length; i++) writeValue(view, field.type, field.offset + i * size, value[i], onError)
    }
  }
  return payload
}

/** Length of `payload` without trailing zero bytes, keeping at least one byte (MAVLink 2 truncation). */
export function truncatedLength(payload: Uint8Array): number {
  let length = payload.length
  while (length > 1 && payload[length - 1] === 0) length--
  return length
}

function encodeFrameImpl(
  descriptor: MessageDescriptor,
  payload: Uint8Array,
  address: FrameAddress,
  format: Mavlink1Format | Mavlink2Format
): Uint8Array {
  const v1 = format.version === 1
  if (v1 && descriptor.id > 0xff) throw new RangeError(`${descriptor.name} (id ${descriptor.id}) cannot be sent as MAVLink 1`)
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
  const crc = crcAccumulate(descriptor.crcExtra, crcX25(frame.subarray(1, headerLength + length)))
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
  return encodeFrameImpl(descriptor, encodePayload(descriptor, fields, format.version ?? 2), address, format)
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
    const frame = encodeFrameImpl(descriptor, encodePayload(descriptor, fields, this.format.version ?? 2), address, this.format)
    this.sequence = (this.sequence + 1) & 0xff
    return frame
  }
}
