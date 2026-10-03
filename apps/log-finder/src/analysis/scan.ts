/**
 * The scanning loop (upstream LogFinder `load_from_dir` / `get_logs`) as an async generator, so
 * the caller can render progress and stop early between files.
 */
import { readLogSummary, type SummaryFailure } from './summary.js'
import type { ScannedLog } from './table.js'

/** A candidate log file, independent of where it came from (input, drop or directory handle). */
export interface LogFileRef<F> {
  readonly relativePath: string
  readonly name: string
  /** The caller's handle, carried through to the result (e.g. a `File` for "Open in"). */
  readonly file: F
  read(): Promise<ArrayBuffer>
}

/** Why a file was skipped. */
export type SkipReason = SummaryFailure | 'unreadable'

/** A file that is not in the results, and why. */
export interface SkippedFile {
  readonly relativePath: string
  readonly reason: SkipReason
}

/** Progress events from {@link scanLogs}; `done` counts files finished so far out of `total`. */
export type ScanEvent<F> =
  | { readonly kind: 'start'; readonly total: number }
  | { readonly kind: 'loaded'; readonly done: number; readonly total: number; readonly log: ScannedLog<F> }
  | { readonly kind: 'skipped'; readonly done: number; readonly total: number; readonly skipped: SkippedFile }

/** True for names the finder scans; upstream only opens `.bin` files. */
export function isLogFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.bin')
}

/** Resolve on a later macrotask so the browser can paint between files. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Read and summarise each file in turn. Yields `start` once, then one event per file. Files that
 * cannot be read or parsed are reported as `skipped` (upstream logs them to the console).
 */
export async function* scanLogs<F>(files: readonly LogFileRef<F>[]): AsyncGenerator<ScanEvent<F>, void, undefined> {
  const total = files.length
  yield { kind: 'start', total }
  let done = 0
  for (const ref of files) {
    let buffer: ArrayBuffer
    try {
      buffer = await ref.read()
    } catch {
      done++
      yield { kind: 'skipped', done, total, skipped: { relativePath: ref.relativePath, reason: 'unreadable' } }
      continue
    }
    const result = readLogSummary(buffer)
    done++
    if (result.ok) {
      yield {
        kind: 'loaded',
        done,
        total,
        log: { relativePath: ref.relativePath, name: ref.name, file: ref.file, summary: result.summary }
      }
    } else {
      yield { kind: 'skipped', done, total, skipped: { relativePath: ref.relativePath, reason: result.reason } }
    }
    await yieldToEventLoop()
  }
}
