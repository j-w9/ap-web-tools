/**
 * Files embedded in the log with FILE records (upstream `load_log()` "FILES" section).
 */
import type { DataflashLog } from '@apwt/dataflash'

/** One embedded file. */
export interface EmbeddedFile {
  /** File name, e.g. `"@SYS/uarts.txt"`. */
  readonly name: string
  /** Contents. */
  readonly data: Uint8Array
  /** A crash dump the dev team wants to hear about (name ends with `crash_dump.bin`). */
  readonly isCrashDump: boolean
}

/** Embedded files in first-seen order; chunks are placed at their offsets by `DataflashLog.files()`. */
export function readEmbeddedFiles(log: DataflashLog): EmbeddedFile[] {
  if (!log.has('FILE')) return []
  return [...log.files()].map(([name, data]) => ({ name, data, isCrashDump: name.endsWith('crash_dump.bin') }))
}
