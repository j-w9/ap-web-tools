/**
 * Logging health and log composition (upstream `load_log()` "DSF" and `log.stats()` sections).
 */
import type { DataflashLog } from '@apwt/dataflash'
import { fieldSeries, type Series } from './series.js'

/** Logger dropped-message and buffer series (DSF). */
export interface LoggingData {
  /** Dropped messages (`Dp`). */
  readonly dropped: Series | undefined
  /** Maximum free buffer space, bytes (`FMx`). */
  readonly bufferMax: Series | undefined
  /** Average free buffer space, bytes (`FAv`). */
  readonly bufferAverage: Series | undefined
  /** Minimum free buffer space, bytes (`FMn`). */
  readonly bufferMin: Series | undefined
}

/** DSF series, or `undefined` without DSF records. */
export function readLogging(log: DataflashLog): LoggingData | undefined {
  if (!log.has('DSF')) return undefined
  return {
    dropped: fieldSeries(log, 'Dropped', 'DSF', 'Dp'),
    bufferMax: fieldSeries(log, 'Maximum', 'DSF', 'FMx'),
    bufferAverage: fieldSeries(log, 'Average', 'DSF', 'FAv'),
    bufferMin: fieldSeries(log, 'Minimum', 'DSF', 'FMn')
  }
}

/** Bytes used by one message type. */
export interface MessageSize {
  /** Message name. */
  readonly name: string
  /** Record count. */
  readonly count: number
  /** Total bytes including record headers. */
  readonly bytes: number
}

/** Log size and composition. */
export interface LogStats {
  /** File size in bytes. */
  readonly totalBytes: number
  /** Per message type with records, in format-id order. */
  readonly messages: readonly MessageSize[]
}

/** Log composition for the size pie chart (`DataflashLog.stats()` omits types with no records). */
export function readLogStats(log: DataflashLog): LogStats {
  const messages: MessageSize[] = []
  for (const [name, s] of log.stats()) messages.push({ name, count: s.count, bytes: s.bytes })
  return { totalBytes: log.byteLength, messages }
}
