/**
 * DataFlash (`.bin`) message statistics: record counts, sizes and record times per message type.
 *
 * Port of the data gathering in upstream `plot_log` (`StreamStats/StreamStats.js`).
 */
import { FMT_DEFINITION, type DataflashLog } from '@apwt/dataflash'

/** One message type of a DataFlash log. */
export interface BinMessageStream {
  readonly name: string
  readonly count: number
  /** Bytes per record, including the 3-byte record header. */
  readonly recordBytes: number
  /** Bytes used by every record of this type. */
  readonly totalBytes: number
  /**
   * Time of every record in seconds (all instances, concatenated instance by instance), or
   * `null` when the message has no `TimeUS` field and so cannot contribute to rate plots.
   */
  readonly time: Float64Array | null
}

/** Statistics of a whole DataFlash log. */
export interface BinLog {
  /** Size of the log file in bytes. */
  readonly byteLength: number
  /** Every format defined in the log, in format-id order, including types with no records (count 0). */
  readonly messages: readonly BinMessageStream[]
  /** Names of every message type present, for the "Open in" hand-off. */
  readonly messageTypes: readonly string[]
}

const US_TO_S = 1 / 1_000_000

function timeSeconds(log: DataflashLog, name: string, instance: number | undefined): Float64Array {
  const column = log.getNumbers(name, 'TimeUS', instance)
  if (column === undefined) return new Float64Array(0)
  // Upstream `array_scale(TimeUS, 1 / 1000000)`: multiply, not divide, to match exactly.
  return Float64Array.from(column, (t) => t * US_TO_S)
}

/** Bytes of the record header every DataFlash record starts with. */
const RECORD_HEADER_BYTES = 3

/**
 * Gather per-message statistics and record times from a parsed DataFlash log. Like upstream's
 * `stats()`, every format defined in the log is listed (in format-id order), including those
 * with no records.
 */
export function binStreams(log: DataflashLog): BinLog {
  const stats = log.stats()
  const byName = new Map<string, { count: number; recordBytes: number; totalBytes: number }>()
  for (const fmt of log.formats()) {
    const count = stats.get(fmt.name)?.count ?? 0
    // Upstream bug reproduced: the parser's built-in FMT definition (used when the log never
    // defines FMT itself) has no Size, so its sizes are NaN (docs/upstream-bugs.md).
    const recordBytes = fmt === FMT_DEFINITION ? Number.NaN : (stats.get(fmt.name)?.recordSize ?? fmt.size + RECORD_HEADER_BYTES)
    byName.set(fmt.name, { count, recordBytes, totalBytes: recordBytes * count })
  }
  const messages: BinMessageStream[] = []
  for (const [name, s] of byName) {
    const info = log.messageType(name)
    let time: Float64Array | null = null
    if (s.count > 0 && info?.fieldNames.includes('TimeUS')) {
      const instances = info.instances
      if (instances === undefined) {
        time = timeSeconds(log, name, undefined)
      } else {
        const parts = [...instances.keys()].map((i) => timeSeconds(log, name, i))
        time = new Float64Array(parts.reduce((n, p) => n + p.length, 0))
        let at = 0
        for (const part of parts) {
          time.set(part, at)
          at += part.length
        }
      }
    }
    messages.push({ name, ...s, time })
  }
  return { byteLength: log.byteLength, messages, messageTypes: [...log.messageTypes().keys()] }
}
