/**
 * File-type dispatch: Stream Stats reads DataFlash `.bin` logs and MAVLink `.tlog` telemetry
 * logs, told apart by file extension as upstream `load` does.
 */
import { DataflashLog } from '@apwt/dataflash'
import { binStreams, type BinLog } from './bin.js'
import { parseTlog, type Tlog } from './tlog.js'

export type LogFormat = 'bin' | 'tlog'

/** File extensions accepted by the file picker. */
export const ACCEPTED_EXTENSIONS = '.bin,.tlog'

/**
 * Format of a file from its name, or `null` if it is neither. A log handed over by another tool
 * without a name is a DataFlash log (upstream's "Open in" only ever loads `.bin`).
 */
export function logFormat(name: string | null): LogFormat | null {
  if (name === null) return 'bin'
  const lower = name.toLowerCase()
  if (lower.endsWith('.bin')) return 'bin'
  if (lower.endsWith('.tlog')) return 'tlog'
  return null
}

export type LoadedLog = { readonly kind: 'tlog'; readonly tlog: Tlog } | { readonly kind: 'bin'; readonly log: BinLog }

/** Parse a log of the given format. Throws with a readable message if nothing usable is found. */
export function loadLog(buffer: ArrayBuffer, format: LogFormat): LoadedLog {
  switch (format) {
    case 'tlog': {
      const tlog = parseTlog(buffer)
      if (tlog.components.length === 0) {
        throw new Error('No valid MAVLink messages found. Check that the file is a MAVLink telemetry log (.tlog).')
      }
      return { kind: 'tlog', tlog }
    }
    case 'bin': {
      const log = binStreams(DataflashLog.parse(buffer))
      if (log.messages.length === 0) {
        throw new Error('No messages found. Check that the file is an ArduPilot DataFlash log (.bin).')
      }
      return { kind: 'bin', log }
    }
  }
}
