import { FIELD_TYPE_SIZE, type FieldDescriptor, type FieldType, type MessageDescriptor } from './descriptor.js'
import type { MessageMap, MessageName } from './generated/messages.js'

/** Any decoded field value. */
export type FieldValue =
  | number
  | bigint
  | string
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

/** Reads one scalar; every type except the 64-bit integers fits in a `number`. */
function readScalar(view: DataView, type: FieldType, offset: number): number | bigint {
  switch (type) {
    case 'char':
    case 'uint8_t':
      return view.getUint8(offset)
    case 'int8_t':
      return view.getInt8(offset)
    case 'uint16_t':
      return view.getUint16(offset, true)
    case 'int16_t':
      return view.getInt16(offset, true)
    case 'uint32_t':
      return view.getUint32(offset, true)
    case 'int32_t':
      return view.getInt32(offset, true)
    case 'float':
      return view.getFloat32(offset, true)
    case 'double':
      return view.getFloat64(offset, true)
    case 'uint64_t':
      return view.getBigUint64(offset, true)
    case 'int64_t':
      return view.getBigInt64(offset, true)
  }
}

function readNumberArray<A extends { [index: number]: number }>(
  view: DataView,
  field: FieldDescriptor,
  length: number,
  array: A
): A {
  const size = FIELD_TYPE_SIZE[field.type]
  for (let i = 0; i < length; i++) array[i] = Number(readScalar(view, field.type, field.offset + i * size))
  return array
}

function readArray(view: DataView, field: FieldDescriptor, length: number): FieldValue {
  const { type, offset } = field
  switch (type) {
    case 'char': {
      // Upstream (jspack) maps each byte to one character, String.fromCharCode(byte), keeping the
      // NUL padding, which its tools strip with `replace(/\0+$/, '')`. The string here is that
      // stripped value: trailing NULs removed, anything before them (even a NUL) kept.
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length)
      let end = length
      while (end > 0 && bytes[end - 1] === 0) end--
      let text = ''
      for (let i = 0; i < end; i++) text += String.fromCharCode(bytes[i]!)
      return text
    }
    case 'uint8_t':
      return new Uint8Array(view.buffer.slice(view.byteOffset + offset, view.byteOffset + offset + length))
    case 'int8_t':
      return readNumberArray(view, field, length, new Int8Array(length))
    case 'uint16_t':
      return readNumberArray(view, field, length, new Uint16Array(length))
    case 'int16_t':
      return readNumberArray(view, field, length, new Int16Array(length))
    case 'uint32_t':
      return readNumberArray(view, field, length, new Uint32Array(length))
    case 'int32_t':
      return readNumberArray(view, field, length, new Int32Array(length))
    case 'float':
      return readNumberArray(view, field, length, new Float32Array(length))
    case 'double':
      return readNumberArray(view, field, length, new Float64Array(length))
    case 'uint64_t': {
      const array = new BigUint64Array(length)
      for (let i = 0; i < length; i++) array[i] = view.getBigUint64(offset + i * 8, true)
      return array
    }
    case 'int64_t': {
      const array = new BigInt64Array(length)
      for (let i = 0; i < length; i++) array[i] = view.getBigInt64(offset + i * 8, true)
      return array
    }
  }
}

/**
 * Decodes a payload into the message's fields object. Short payloads (MAVLink 2 trailing-zero
 * truncation, MAVLink 1 frames without extensions) are zero-extended; bytes beyond the descriptor's
 * length (fields from a newer dialect) are ignored.
 */
export function decodePayload<N extends MessageName>(descriptor: MessageDescriptor<N>, payload: Uint8Array): MessageMap[N]
// The descriptor and the fields interface are generated from the same XML, so the record built here
// has exactly the interface's shape; the overload states that without a cast.
export function decodePayload(descriptor: MessageDescriptor, payload: Uint8Array): Record<string, FieldValue> {
  const bytes = new Uint8Array(descriptor.length)
  bytes.set(payload.length > descriptor.length ? payload.subarray(0, descriptor.length) : payload)
  const view = new DataView(bytes.buffer)
  const fields: Record<string, FieldValue> = {}
  for (const field of descriptor.fields) {
    fields[field.name] =
      field.arrayLength === undefined && field.type !== 'char'
        ? readScalar(view, field.type, field.offset)
        : readArray(view, field, field.arrayLength ?? 1)
  }
  return fields
}
