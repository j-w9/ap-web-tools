/**
 * DataFlash (`.bin`) message statistics: record counts, sizes and record times per message type.
 *
 * Port of the data gathering in upstream `plot_log` (`StreamStats/StreamStats.js`).
 */
import type { DataflashLog } from '@apwt/dataflash'

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
  /** Message types with at least one record, in format-id order. */
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

/** Gather per-message statistics and record times from a parsed DataFlash log. */
export function binStreams(log: DataflashLog): BinLog {
  const messages: BinMessageStream[] = []
  for (const [name, stats] of log.stats()) {
    if (stats.count === 0) continue
    const info = log.messageType(name)
    let time: Float64Array | null = null
    if (info?.fieldNames.includes('TimeUS')) {
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
    messages.push({ name, count: stats.count, recordBytes: stats.recordSize, totalBytes: stats.bytes, time })
  }
  return { byteLength: log.byteLength, messages, messageTypes: [...log.messageTypes().keys()] }
}
