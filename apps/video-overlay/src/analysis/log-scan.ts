/**
 * Record-offset scan of a DataFlash log, ported from upstream `DataflashParser.DfReader()`
 * (`modules/JsDataflashParser/parser.js`), reduced to what VideoOverlay needs: the file position of
 * the first and last record of every message type.
 *
 * VideoOverlay's `setDefaultOffset()` and `getLogDurationUS()` pick timestamps by *file position*
 * (the earliest first record and the latest last record), not by timestamp value. `@apwt/dataflash`
 * exposes `firstTimeUs()` but no file positions or last timestamp, so the scan is reproduced here.
 */

const HEAD1 = 0xa3
const HEAD2 = 0x95
const FMT_ID = 128

/** One message format as upstream's `FMT[]` table holds it after the scan. */
export interface ScannedFormat {
  readonly name: string
  readonly format: string
  readonly columns: readonly string[]
  /** Byte offset of each field within the record body; undefined for the built-in FMT entry. */
  readonly fieldOffsets: readonly number[] | undefined
  /** Record body size in bytes; undefined for the built-in FMT entry. */
  readonly size: number | undefined
  /** Body offsets of every complete record of this type, in file order. */
  readonly offsets: readonly number[]
}

/** Field sizes, upstream `get_size_of()`. */
const TYPE_SIZE: Readonly<Record<string, number>> = {
  b: 1,
  B: 1,
  M: 1,
  h: 2,
  H: 2,
  c: 2,
  C: 2,
  i: 4,
  I: 4,
  f: 4,
  n: 4,
  E: 4,
  e: 4,
  L: 4,
  d: 8,
  Q: 8,
  q: 8,
  N: 16,
  a: 64,
  Z: 64
}

interface MutableFormat {
  name: string
  format: string
  columns: string[]
  fieldOffsets: number[] | undefined
  size: number | undefined
}

/** Reader with upstream `parse_type()` semantics: the offset advances after every successful read. */
class Cursor {
  offset = 0
  constructor(
    private readonly buffer: ArrayBuffer,
    private readonly view: DataView
  ) {}

  private text(length: number): string {
    const bytes = new Uint8Array(this.buffer, this.offset, length)
    this.offset += length
    // eslint-disable-next-line no-control-regex -- upstream strips trailing NULs only
    return String.fromCharCode(...bytes).replace(/\x00+$/g, '')
  }

  /** Parse the fields of an FMT record (format `BBnNZ`). Throws a RangeError past the end. */
  readFmt(): { type: number; name: string; format: string; columns: string } {
    const type = this.view.getUint8(this.offset)
    this.offset += 1
    this.view.getUint8(this.offset) // Length, unused
    this.offset += 1
    const name = this.text(4)
    const format = this.text(16)
    const columns = this.text(64)
    return { type, name, format, columns }
  }
}

/**
 * Scan the log once and return every known format with the offsets of its records, indexed by
 * message id. Mirrors `DfReader()`, including its resynchronisation (skip one byte on a bad
 * header, or after an FMT record that runs past the end) and the removal of a final record
 * that would overflow the buffer.
 */
export function scanRecordOffsets(buffer: ArrayBuffer): ReadonlyMap<number, ScannedFormat> {
  const view = new DataView(buffer)
  const cursor = new Cursor(buffer, view)
  const formats = new Map<number, MutableFormat>([
    [
      FMT_ID,
      {
        name: 'FMT',
        format: 'BBnNZ',
        columns: ['Type', 'Length', 'Name', 'Format', 'Columns'],
        fieldOffsets: undefined,
        size: undefined
      }
    ]
  ])
  const offsets = new Map<number, number[]>()

  while (cursor.offset < buffer.byteLength - 3) {
    if (view.getUint8(cursor.offset) !== HEAD1 || view.getUint8(cursor.offset + 1) !== HEAD2) {
      cursor.offset += 1
      continue
    }
    cursor.offset += 2
    const id = view.getUint8(cursor.offset)
    cursor.offset += 1

    let list = offsets.get(id)
    if (list === undefined) {
      list = []
      offsets.set(id, list)
    }
    list.push(cursor.offset)

    const known = formats.get(id)
    if (known === undefined) continue
    if (id === FMT_ID) {
      try {
        const value = cursor.readFmt()
        const fieldOffsets: number[] = []
        let size = 0
        for (const code of value.format) {
          fieldOffsets.push(size)
          size += TYPE_SIZE[code] ?? Number.NaN
        }
        formats.set(value.type, { name: value.name, format: value.format, columns: value.columns.split(','), fieldOffsets, size })
      } catch {
        // Upstream: "reached log end?" — step one byte past wherever the failed read stopped.
        cursor.offset += 1
      }
    } else if (known.size !== undefined) {
      cursor.offset += known.size
    } else {
      // Upstream adds `undefined` here, which turns the offset into NaN and ends the scan.
      cursor.offset = Number.NaN
    }
  }

  const result = new Map<number, ScannedFormat>()
  for (const [id, fmt] of formats) {
    const list = offsets.get(id) ?? []
    const last = list[list.length - 1]
    if (last !== undefined && fmt.size !== undefined && last + fmt.size > buffer.byteLength) list.pop()
    result.set(id, { ...fmt, offsets: list })
  }
  return result
}

/** First and last `TimeUS` by file position, as upstream reads them. */
export interface TimestampBounds {
  /** `TimeUS` of the earliest timestamped record in the file, microseconds since boot. */
  readonly firstTimeUs: number
  /** `TimeUS` of the latest timestamped record in the file, microseconds since boot. */
  readonly lastTimeUs: number
}

/** Upstream `parse_type('Q')`: low word plus high word times 2^32. */
function readUint64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true)
  return view.getUint32(offset + 4, true) * 4294967296.0 + low
}

/**
 * The earliest first and latest last timestamp record across all message types with a `Q`-typed
 * `TimeUS` field (upstream `setDefaultOffset()` / `getLogDurationUS()`). `undefined` when no such
 * record exists.
 */
export function timestampBounds(
  buffer: ArrayBuffer,
  formats: ReadonlyMap<number, ScannedFormat> = scanRecordOffsets(buffer)
): TimestampBounds | undefined {
  let firstOffset: number | undefined
  let lastOffset: number | undefined
  for (const fmt of formats.values()) {
    const index = fmt.columns.indexOf('TimeUS')
    if (index === -1 || fmt.format.charAt(index) !== 'Q' || fmt.fieldOffsets === undefined) continue
    const fieldOffset = fmt.fieldOffsets[index]
    const first = fmt.offsets[0]
    const last = fmt.offsets[fmt.offsets.length - 1]
    if (fieldOffset === undefined || first === undefined || last === undefined) continue
    if (firstOffset === undefined || first + fieldOffset < firstOffset) firstOffset = first + fieldOffset
    if (lastOffset === undefined || last + fieldOffset > lastOffset) lastOffset = last + fieldOffset
  }
  if (firstOffset === undefined || lastOffset === undefined) return undefined
  const view = new DataView(buffer)
  return { firstTimeUs: readUint64(view, firstOffset), lastTimeUs: readUint64(view, lastOffset) }
}
