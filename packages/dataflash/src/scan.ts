/**
 * First pass over a DataFlash log: locate every record and build the format
 * table. Nothing except FMT records is decoded here; the result is an index
 * of body offsets per message id that later lazy decoding reads from.
 */
import { FMT_DEFINITION, FMT_TYPE, HEAD1, HEAD2, HEADER_SIZE, decodeFmtRecord, type FormatDefinition } from './format.js'

/** Growable list of uint32 offsets. */
class OffsetList {
  private data = new Uint32Array(64)
  length = 0

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Uint32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    this.data[this.length++] = value
  }

  /** Finished, exactly-sized view of the offsets. */
  finish(): Uint32Array {
    return this.data.subarray(0, this.length)
  }
}

/** Output of {@link scanLog}. Both arrays are indexed by message id (0-255). */
export interface ScanResult {
  /** Format table; `undefined` for ids that never had a FMT record. */
  readonly formats: readonly (FormatDefinition | undefined)[]
  /**
   * Body offsets (just past the 3-byte header) for every record of each id.
   * Empty for ids with no records.
   */
  readonly offsets: readonly Uint32Array[]
}

/** How often (in bytes scanned) the progress callback fires. */
const PROGRESS_INTERVAL = 1 << 20

/**
 * Scan `bytes` for DataFlash records.
 *
 * Records are found by searching for the `A3 95` header. Once a FMT record
 * for a message id has been seen, subsequent records of that id are skipped
 * by their known size; records of unknown ids are stepped over one byte at a
 * time (matching ArduPilot's own reader). A trailing record that would run
 * past the end of the buffer is dropped.
 *
 * @param onProgress Called with a 0..1 fraction as the scan proceeds.
 */
export function scanLog(bytes: Uint8Array, view: DataView, onProgress?: (fraction: number) => void): ScanResult {
  const formats: (FormatDefinition | undefined)[] = new Array<FormatDefinition | undefined>(256).fill(undefined)
  formats[FMT_TYPE] = FMT_DEFINITION
  const lists: (OffsetList | undefined)[] = new Array<OffsetList | undefined>(256).fill(undefined)

  const end = bytes.byteLength
  let offset = 0
  let lastReport = 0

  while (offset < end - HEADER_SIZE) {
    if (bytes[offset] !== HEAD1 || bytes[offset + 1] !== HEAD2) {
      offset++
      continue
    }
    const id = bytes[offset + 2] as number
    offset += HEADER_SIZE

    let list = lists[id]
    if (list === undefined) {
      list = new OffsetList()
      lists[id] = list
    }
    list.push(offset)

    const fmt = formats[id]
    if (fmt !== undefined) {
      if (id === FMT_TYPE) {
        if (offset + fmt.size > end) {
          // Truncated FMT at the end of the log; resync byte by byte.
          offset++
          continue
        }
        const decoded = decodeFmtRecord(bytes, view, offset)
        if (decoded !== undefined) formats[decoded.id] = decoded
      }
      // Skip the body. A truncated final record is removed from the index below.
      offset += fmt.size
    }

    if (onProgress !== undefined && offset - lastReport > PROGRESS_INTERVAL) {
      onProgress(offset / end)
      lastReport = offset
    }
  }

  const offsets: Uint32Array[] = new Array<Uint32Array>(256)
  for (let id = 0; id < 256; id++) {
    const list = lists[id]
    const fmt = formats[id]
    if (list === undefined || fmt === undefined) {
      offsets[id] = new Uint32Array(0)
      continue
    }
    let finished = list.finish()
    const last = finished[finished.length - 1]
    if (last !== undefined && last + fmt.size > end) {
      finished = finished.subarray(0, finished.length - 1)
    }
    offsets[id] = finished
  }

  onProgress?.(1)
  return { formats, offsets }
}
