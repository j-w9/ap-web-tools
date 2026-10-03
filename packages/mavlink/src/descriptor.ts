/**
 * Runtime description of a message's wire layout. The generator emits one `MessageDescriptor` per
 * message (see `generated/messages.ts`); the encoder and decoder interpret them, so supporting a
 * message costs one small object rather than generated code.
 */

/** MAVLink field types and their sizes in bytes (array fields: size of one element). */
export const FIELD_TYPE_SIZE = {
  char: 1,
  int8_t: 1,
  uint8_t: 1,
  int16_t: 2,
  uint16_t: 2,
  int32_t: 4,
  uint32_t: 4,
  float: 4,
  int64_t: 8,
  uint64_t: 8,
  double: 8
} as const satisfies Readonly<Record<string, 1 | 2 | 4 | 8>>

export type FieldType = keyof typeof FIELD_TYPE_SIZE

/** A generated enum object, e.g. `MavType`: entry name to value. */
export type EnumObject = Readonly<Record<string, number>>

export interface FieldDescriptor {
  /** camelCase field name, the key in the message's fields object. */
  readonly name: string
  readonly type: FieldType
  /** Byte offset in the (untruncated) payload. */
  readonly offset: number
  /** Element count; present for arrays and `char[n]` strings, absent for scalars. */
  readonly arrayLength?: number
  /** Present on MAVLink 2 extension fields, which MAVLink 1 frames omit. */
  readonly extension?: true
  /** The enum named by the XML's `enum=` attribute, for display. */
  readonly enum?: EnumObject
  /** Present when the value is a combination of `enum` flags rather than one entry. */
  readonly bitmask?: true
}

export interface MessageDescriptor<N extends string = string> {
  readonly id: number
  readonly name: N
  /** CRC_EXTRA seed byte, derived from the message layout. */
  readonly crcExtra: number
  /** Payload length of the base fields: the MAVLink 1 payload length. */
  readonly baseLength: number
  /** Payload length including extension fields: the untruncated MAVLink 2 payload length. */
  readonly length: number
  /** Fields in XML order; `offset` gives the wire layout. */
  readonly fields: readonly FieldDescriptor[]
}
