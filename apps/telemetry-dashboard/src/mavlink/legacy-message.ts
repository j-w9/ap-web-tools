/**
 * Adapter from `@apwt/mavlink` messages to the objects upstream's pymavlink-generated `mavlink.js`
 * produced, which is what dashboard widgets receive (`{ MAVLink: message }` on the `MAVLinkMSG`
 * BroadcastChannel). User widgets read these objects directly (`msg._id`, `msg._header.srcSystem`,
 * `msg.current_battery`, ...), so the shape is a public contract: field names as in the XML, values
 * as jspack unpacked them, and the same metadata properties. See `WIDGETS.md`.
 */
import { ALL_MESSAGES } from '@apwt/mavlink'
import type { FieldDescriptor, FieldType, FieldValue, MessageDescriptor, MessageName, ReceivedMessage } from '@apwt/mavlink'
import { INSTANCE_FIELDS, XML_NAME_EXCEPTIONS } from './legacy-tables.js'

/** jspack's 64-bit integer: unsigned low and high 32-bit words and whether the type is unsigned. */
export type LegacyInt64 = [low: number, high: number, unsigned: boolean]

/**
 * A field value as jspack unpacks it: numbers; `char[n]` and byte arrays (`uint8_t[n]`,
 * `int8_t[n]`) as strings of one character per byte, NUL padding included; other arrays as plain
 * arrays; 64-bit integers as {@link LegacyInt64}.
 */
export type LegacyFieldValue = number | string | LegacyInt64 | number[] | LegacyInt64[]

/** Upstream `mavlink20.header` as decoded. */
export interface LegacyHeader {
  mlen: number
  seq: number
  srcSystem: number
  srcComponent: number
  msgId: number
  incompat_flags: number
  compat_flags: number
}

/** Properties every upstream message object has from its constructor. */
export interface LegacyMessageInfo {
  /** jspack struct format of the payload, fields in wire order. */
  _format: string
  _id: number
  /** For each field in XML order, its position in wire order. */
  order_map: number[]
  /** Per field in wire order: element count, 1 for scalars and `char[n]` strings. */
  len_map: number[]
  /** Per field in wire order: array length, 0 for scalars. */
  array_len_map: number[]
  crc_extra: number
  _name: string
  _instance_field: string | undefined
  _instance_offset: number
  /** Field names in XML order. */
  fieldnames: string[]
}

/** Properties the decoder adds to a received message, plus the dashboard's receive time. */
export interface LegacyFrameInfo {
  /** True only for a signed frame whose signature was verified. */
  _signed: boolean
  /** Present only when `_signed` is true. */
  _link_id?: number
  _msgbuf: Uint8Array
  /** Payload, zero-extended to the full (untruncated) length. */
  _payload: Uint8Array
  /**
   * Frame checksum, except on a message with its own `crc` field (CUBEPILOT_FIRMWARE_UPDATE_START),
   * where `crc` stays that field's value. Upstream overwrote the field with the checksum; proven bug
   * #155 (docs/bug-proofs/mavlink.md).
   */
  crc: number
  _header: LegacyHeader
  /** `Date.now()` when the dashboard decoded the message. */
  _timeStamp: number
}

/** A received message as widgets see it: XML-named fields plus metadata. */
export type LegacyMessage = LegacyMessageInfo & LegacyFrameInfo & { readonly [field: string]: unknown }

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/** The XML (upstream) name of a field of `descriptor`. */
export function xmlFieldName(descriptor: MessageDescriptor<MessageName>, field: FieldDescriptor): string {
  const exceptions = XML_NAME_EXCEPTIONS[descriptor.name]
  return exceptions?.[field.name] ?? snakeCase(field.name)
}

const STRUCT_CODE: Readonly<Record<Exclude<FieldType, 'char'>, string>> = {
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

/** Whether jspack unpacks the field as a string: `char[n]` and byte arrays. */
function isStringField(field: FieldDescriptor): boolean {
  return field.arrayLength !== undefined && (field.type === 'char' || field.type === 'uint8_t' || field.type === 'int8_t')
}

function structCode(field: FieldDescriptor): string {
  if (isStringField(field)) return `${field.arrayLength ?? 1}s`
  if (field.type === 'char') return 'c'
  const code = STRUCT_CODE[field.type]
  return field.arrayLength === undefined ? code : `${field.arrayLength}${code}`
}

const infoCache = new Map<MessageDescriptor<MessageName>, LegacyMessageInfo>()

/** Every message the dashboard decodes, by id. Upstream decoded every message `mavlink.js` defined. */
export const DESCRIPTORS_BY_ID: ReadonlyMap<number, MessageDescriptor<MessageName>> = new Map(ALL_MESSAGES.map((d) => [d.id, d]))

/** The constructor-set properties of upstream's message class for `descriptor`. */
export function legacyMessageInfo(descriptor: MessageDescriptor<MessageName>): LegacyMessageInfo {
  const cached = infoCache.get(descriptor)
  if (cached !== undefined) return cached
  const wireOrder = [...descriptor.fields].sort((a, b) => a.offset - b.offset)
  const instanceKey = INSTANCE_FIELDS[descriptor.name]
  const instanceField = descriptor.fields.find((f) => f.name === instanceKey)
  const info: LegacyMessageInfo = {
    _format: `<${wireOrder.map(structCode).join('')}`,
    _id: descriptor.id,
    order_map: descriptor.fields.map((f) => wireOrder.indexOf(f)),
    len_map: wireOrder.map((f) => (f.arrayLength === undefined || f.type === 'char' ? 1 : f.arrayLength)),
    array_len_map: wireOrder.map((f) => f.arrayLength ?? 0),
    crc_extra: descriptor.crcExtra,
    _name: descriptor.name,
    _instance_field: instanceField === undefined ? undefined : xmlFieldName(descriptor, instanceField),
    _instance_offset: instanceField === undefined ? -1 : instanceField.offset,
    fieldnames: descriptor.fields.map((f) => xmlFieldName(descriptor, f))
  }
  infoCache.set(descriptor, info)
  return info
}

function legacyInt64(value: bigint, unsigned: boolean): LegacyInt64 {
  const raw = BigInt.asUintN(64, value)
  return [Number(raw & 0xffffffffn), Number(raw >> 32n), unsigned]
}

function bytesToString(bytes: ArrayLike<number>): string {
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]! & 0xff)
  return text
}

/**
 * One field in jspack's representation. Numbers come from the package's decoded value; strings
 * come from the raw payload bytes because jspack keeps every byte (NUL padding and anything after
 * the terminator) and maps each byte to one character, where the package returns a UTF-8 C string.
 */
function legacyValue(field: FieldDescriptor, value: FieldValue, payload: Uint8Array): LegacyFieldValue {
  if (field.type === 'char') {
    return bytesToString(payload.subarray(field.offset, field.offset + (field.arrayLength ?? 1)))
  }
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return legacyInt64(value, field.type === 'uint64_t')
  if (typeof value === 'string') return value
  if (isStringField(field)) return bytesToString(Array.from(value, Number))
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) {
    return Array.from(value, (v) => legacyInt64(v, field.type === 'uint64_t'))
  }
  return Array.from(value)
}

/**
 * Converts a parsed message into upstream's shape. `timeStamp` is the dashboard's receive time,
 * set as upstream did right after decoding (`m._timeStamp = Date.now()`).
 */
export function toLegacyMessage(message: ReceivedMessage, timeStamp: number): LegacyMessage {
  const descriptor = DESCRIPTORS_BY_ID.get(message.id)
  if (descriptor === undefined) throw new Error(`Unknown MAVLink message ID (${message.id})`)
  const info = legacyMessageInfo(descriptor)
  const { header, frame, signature } = message
  const headerLength = header.version === 2 ? 10 : 6
  const crcOffset = headerLength + header.payloadLength
  // Upstream: the bytes between header and checksum, zero-extended to the full payload length.
  const received = frame.slice(headerLength, crcOffset)
  const payload = received.length >= descriptor.length ? received : new Uint8Array(descriptor.length)
  if (payload !== received) payload.set(received)

  const out: Record<string, unknown> = {}
  const fields: ReadonlyMap<string, FieldValue> = new Map(Object.entries(message.fields))
  descriptor.fields.forEach((field, i) => {
    const value = fields.get(field.name)
    if (value !== undefined) out[info.fieldnames[i]!] = legacyValue(field, value, payload)
  })
  const verified = signature?.verified === true
  // Proven bug #155: a payload field called `crc` keeps its value instead of the frame checksum.
  const crcField = out.crc
  const frameInfo: LegacyFrameInfo = {
    _signed: verified,
    ...(verified ? { _link_id: signature.linkId } : {}),
    _msgbuf: frame,
    _payload: payload,
    crc: typeof crcField === 'number' ? crcField : frame[crcOffset]! | (frame[crcOffset + 1]! << 8),
    _header: {
      mlen: header.payloadLength,
      seq: header.sequence,
      srcSystem: header.systemId,
      srcComponent: header.componentId,
      msgId: header.messageId,
      incompat_flags: header.incompatFlags,
      compat_flags: header.compatFlags
    },
    _timeStamp: timeStamp
  }
  return Object.assign(out, structuredClone(info), frameInfo)
}
