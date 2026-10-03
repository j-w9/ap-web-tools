/**
 * DataFlash FMT record decoding and per-field type codes.
 *
 * Every DataFlash message body is described by a format string whose
 * characters each name one field's binary encoding. The codes mirror
 * ArduPilot's `AP_Logger/LogStructure.h`.
 */

/** Byte that starts every DataFlash record header. */
export const HEAD1 = 0xa3
/** Second header byte of every DataFlash record. */
export const HEAD2 = 0x95
/** Message id of the FMT (format definition) record. */
export const FMT_TYPE = 0x80
/** Bytes in the record header (HEAD1, HEAD2, message id). */
export const HEADER_SIZE = 3

/** One-character field encodings used in DataFlash format strings. */
export type TypeCode =
  | 'a' // int16_t[32]
  | 'b' // int8_t
  | 'B' // uint8_t
  | 'h' // int16_t
  | 'H' // uint16_t
  | 'i' // int32_t
  | 'I' // uint32_t
  | 'f' // float
  | 'd' // double
  | 'n' // char[4]
  | 'N' // char[16]
  | 'Z' // char[64]
  | 'c' // int16_t * 100
  | 'C' // uint16_t * 100
  | 'e' // int32_t * 100
  | 'E' // uint32_t * 100
  | 'L' // int32_t latitude/longitude (degrees * 1e7)
  | 'M' // uint8_t flight mode
  | 'q' // int64_t
  | 'Q' // uint64_t

/** Encoded size in bytes of each field type. */
export const TYPE_SIZES: Readonly<Record<TypeCode, number>> = {
  a: 64,
  b: 1,
  B: 1,
  h: 2,
  H: 2,
  i: 4,
  I: 4,
  f: 4,
  d: 8,
  n: 4,
  N: 16,
  Z: 64,
  c: 2,
  C: 2,
  e: 4,
  E: 4,
  L: 4,
  M: 1,
  q: 8,
  Q: 8
}

/** Type codes that decode to text rather than numbers. */
export const STRING_TYPES: ReadonlySet<TypeCode> = new Set<TypeCode>(['n', 'N', 'Z'])

/** Whether `code` is a recognised DataFlash type code. */
export function isTypeCode(code: string): code is TypeCode {
  return Object.prototype.hasOwnProperty.call(TYPE_SIZES, code)
}

/**
 * Decoded FMT record: the layout of one message type.
 */
export interface FormatDefinition {
  /** Message id (0-255) used in record headers. */
  readonly id: number
  /** Total record length including the 3-byte header, as written in FMT. */
  readonly length: number
  /** Message name, e.g. `"ATT"`. */
  readonly name: string
  /** Format string, one {@link TypeCode} per field. */
  readonly format: string
  /** Field type codes, parallel to `columns`. */
  readonly types: readonly TypeCode[]
  /** Field names, parallel to `types`. */
  readonly columns: readonly string[]
  /** Byte offset of each field from the start of the message body. */
  readonly fieldOffsets: readonly number[]
  /** Body size in bytes (record length minus header). */
  readonly size: number
}

/** Built-in definition of the FMT record itself, needed to bootstrap parsing. */
export const FMT_DEFINITION: FormatDefinition = makeFormat(
  FMT_TYPE,
  89,
  'FMT',
  'BBnNZ',
  'Type,Length,Name,Format,Columns'
)

/**
 * Build a {@link FormatDefinition} from raw FMT fields.
 *
 * @returns the definition, or `undefined` when the format string contains
 * unknown type codes (such a message can not be sized, so it is ignored).
 */
export function makeFormat(
  id: number,
  length: number,
  name: string,
  format: string,
  columns: string
): FormatDefinition
export function makeFormat(
  id: number,
  length: number,
  name: string,
  format: string,
  columns: string,
  lenient: true
): FormatDefinition | undefined
export function makeFormat(
  id: number,
  length: number,
  name: string,
  format: string,
  columns: string,
  lenient?: true
): FormatDefinition | undefined {
  const types: TypeCode[] = []
  const fieldOffsets: number[] = []
  let size = 0
  for (const code of format) {
    if (!isTypeCode(code)) {
      if (lenient) return undefined
      throw new Error(`Unknown DataFlash type code '${code}' in format for ${name}`)
    }
    types.push(code)
    fieldOffsets.push(size)
    size += TYPE_SIZES[code]
  }
  const names = columns.length === 0 ? [] : columns.split(',')
  // Column lists shorter than the format are padded so indices stay aligned.
  while (names.length < types.length) names.push(`field${names.length}`)
  return { id, length, name, format, types, columns: names.slice(0, types.length), fieldOffsets, size }
}

/**
 * Decode a fixed-width, NUL-padded string. Trailing NULs are stripped;
 * bytes are interpreted as Latin-1 like the upstream parser.
 */
export function readString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset + length
  while (end > offset && bytes[end - 1] === 0) end--
  let out = ''
  for (let i = offset; i < end; i++) out += String.fromCharCode(bytes[i] as number)
  return out
}

/** Read an unsigned 64-bit little-endian integer as a JS number (exact to 2^53). */
export function readUint64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true)
  const high = view.getUint32(offset + 4, true)
  return high * 4294967296 + low
}

/** Read a signed 64-bit little-endian integer as a JS number (exact to 2^53). */
export function readInt64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true)
  const high = view.getInt32(offset + 4, true)
  return high * 4294967296 + low
}

/**
 * Read one numeric field. Not valid for string types (`n`, `N`, `Z`) or the
 * array type `a`; use {@link readString} / the column decoder for those.
 */
export function readNumber(view: DataView, offset: number, type: TypeCode): number {
  switch (type) {
    case 'b':
      return view.getInt8(offset)
    case 'B':
    case 'M':
      return view.getUint8(offset)
    case 'h':
      return view.getInt16(offset, true)
    case 'H':
      return view.getUint16(offset, true)
    case 'i':
    case 'L':
      return view.getInt32(offset, true)
    case 'I':
      return view.getUint32(offset, true)
    case 'f':
      return view.getFloat32(offset, true)
    case 'd':
      return view.getFloat64(offset, true)
    case 'c':
      return view.getInt16(offset, true) / 100
    case 'C':
      return view.getUint16(offset, true) / 100
    case 'e':
      return view.getInt32(offset, true) / 100
    case 'E':
      return view.getUint32(offset, true) / 100
    case 'q':
      return readInt64(view, offset)
    case 'Q':
      return readUint64(view, offset)
    case 'a':
    case 'n':
    case 'N':
    case 'Z':
      throw new Error(`Type code '${type}' is not numeric`)
  }
}

/**
 * Decode the body of a FMT record at `offset` into a {@link FormatDefinition}.
 * Returns `undefined` if the format is unusable.
 */
export function decodeFmtRecord(bytes: Uint8Array, view: DataView, offset: number): FormatDefinition | undefined {
  const id = view.getUint8(offset)
  const length = view.getUint8(offset + 1)
  const name = readString(bytes, offset + 2, 4)
  const format = readString(bytes, offset + 6, 16)
  const columns = readString(bytes, offset + 22, 64)
  return makeFormat(id, length, name, format, columns, true)
}
