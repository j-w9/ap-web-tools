/**
 * Columnar decoding: turn a list of record offsets into one typed array per
 * field. Columns, not row objects, keep plotting fast and memory light.
 */
import { TYPE_SIZES, readInt64, readString, readUint64, type FormatDefinition, type TypeCode } from './format.js'

/** Numeric column types. Each type code maps to its natural typed array. */
export type NumericColumn =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array

/**
 * One decoded field across all records of a message type.
 *
 * - numeric codes decode to a {@link NumericColumn}
 * - `n`, `N`, `Z` decode to `string[]`
 * - `a` (int16[32]) decodes to `Int16Array[]`, one 32-element view per record
 */
export type Column = NumericColumn | string[] | Int16Array[]

/** Typed array constructor used for each numeric type code. */
export function columnConstructor(type: TypeCode):
  | Float64ArrayConstructor
  | Float32ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | undefined {
  switch (type) {
    case 'b':
      return Int8Array
    case 'B':
    case 'M':
      return Uint8Array
    case 'h':
      return Int16Array
    case 'H':
      return Uint16Array
    case 'i':
    case 'L':
      return Int32Array
    case 'I':
      return Uint32Array
    case 'f':
      return Float32Array
    case 'd':
    case 'c':
    case 'C':
    case 'e':
    case 'E':
    case 'q':
    case 'Q':
      return Float64Array
    case 'a':
    case 'n':
    case 'N':
    case 'Z':
      return undefined
  }
}

/** Rows between progress callbacks while decoding. */
const PROGRESS_ROWS = 4096

/**
 * Decode a single field.
 *
 * @param offsets Body offsets of every record to decode.
 * @param fieldOffset Byte offset of the field within the body.
 * @param type Field type code.
 * @param onProgress Optional 0..1 progress callback.
 */
export function decodeColumn(
  view: DataView,
  bytes: Uint8Array,
  offsets: Uint32Array,
  fieldOffset: number,
  type: TypeCode,
  onProgress?: (fraction: number) => void
): Column {
  const len = offsets.length
  const tick = (i: number): void => {
    if (onProgress !== undefined && i % PROGRESS_ROWS === 0) onProgress(i / len)
  }
  const at = (i: number): number => (offsets[i] as number) + fieldOffset

  switch (type) {
    case 'n':
    case 'N':
    case 'Z': {
      const size = TYPE_SIZES[type]
      const out = new Array<string>(len)
      for (let i = 0; i < len; i++) {
        out[i] = readString(bytes, at(i), size)
        tick(i)
      }
      return out
    }
    case 'a': {
      const flat = new Int16Array(len * 32)
      const out = new Array<Int16Array>(len)
      for (let i = 0; i < len; i++) {
        const base = at(i)
        for (let j = 0; j < 32; j++) flat[i * 32 + j] = view.getInt16(base + j * 2, true)
        out[i] = flat.subarray(i * 32, i * 32 + 32)
        tick(i)
      }
      return out
    }
    case 'b': {
      const out = new Int8Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getInt8(at(i))
        tick(i)
      }
      return out
    }
    case 'B':
    case 'M': {
      const out = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getUint8(at(i))
        tick(i)
      }
      return out
    }
    case 'h': {
      const out = new Int16Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getInt16(at(i), true)
        tick(i)
      }
      return out
    }
    case 'H': {
      const out = new Uint16Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getUint16(at(i), true)
        tick(i)
      }
      return out
    }
    case 'i':
    case 'L': {
      const out = new Int32Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getInt32(at(i), true)
        tick(i)
      }
      return out
    }
    case 'I': {
      const out = new Uint32Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getUint32(at(i), true)
        tick(i)
      }
      return out
    }
    case 'f': {
      const out = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getFloat32(at(i), true)
        tick(i)
      }
      return out
    }
    case 'd': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getFloat64(at(i), true)
        tick(i)
      }
      return out
    }
    case 'c': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getInt16(at(i), true) / 100
        tick(i)
      }
      return out
    }
    case 'C': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getUint16(at(i), true) / 100
        tick(i)
      }
      return out
    }
    case 'e': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getInt32(at(i), true) / 100
        tick(i)
      }
      return out
    }
    case 'E': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = view.getUint32(at(i), true) / 100
        tick(i)
      }
      return out
    }
    case 'q': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = readInt64(view, at(i))
        tick(i)
      }
      return out
    }
    case 'Q': {
      const out = new Float64Array(len)
      for (let i = 0; i < len; i++) {
        out[i] = readUint64(view, at(i))
        tick(i)
      }
      return out
    }
  }
}

/**
 * Decode every field of a message type for the given records.
 * Progress is reported across all fields combined.
 */
export function decodeAllColumns(
  view: DataView,
  bytes: Uint8Array,
  offsets: Uint32Array,
  fmt: FormatDefinition,
  onProgress?: (fraction: number) => void
): Record<string, Column> {
  const out: Record<string, Column> = {}
  const n = fmt.types.length
  for (let i = 0; i < n; i++) {
    const type = fmt.types[i] as TypeCode
    const name = fmt.columns[i] as string
    const fieldOffset = fmt.fieldOffsets[i] as number
    const progress = onProgress === undefined ? undefined : (f: number) => onProgress((i + f) / n)
    out[name] = decodeColumn(view, bytes, offsets, fieldOffset, type, progress)
  }
  onProgress?.(1)
  return out
}
