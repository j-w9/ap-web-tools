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

/**
 * Embedded files in first-seen order (`DataflashLog.files()`): chunks placed at their `Offset`,
 * `Length` bytes each, the last copy of a file written twice. Upstream `processFiles()` appends
 * every chunk's text instead (proven upstream bug, fixed: docs/bug-proofs/js-dataflash-parser.md).
 */
export function readEmbeddedFiles(log: DataflashLog): EmbeddedFile[] {
  if (!log.has('FILE')) return []
  return [...log.files()].map(([name, data]) => ({ name, data, isCrashDump: name.endsWith('crash_dump.bin') }))
}
