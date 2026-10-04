/**
 * Gated real-log tests: the `*.real-logs.test.ts` files run only when `APWT_REAL_LOGS` names a
 * directory of DataFlash logs, and skip otherwise (CI has none). The logs are private flight logs:
 * tests read them in place and must never write them, or values taken from them, anywhere.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The directory named by `APWT_REAL_LOGS`, or `undefined` when real-log tests are off. */
export const realLogDir: string | undefined = process.env['APWT_REAL_LOGS'] || undefined

/** Names of the `.bin` logs in {@link realLogDir}, sorted; empty when real-log tests are off. */
export function realLogFiles(): string[] {
  if (realLogDir === undefined) return []
  return readdirSync(realLogDir)
    .filter((name) => name.toLowerCase().endsWith('.bin'))
    .sort()
}

/** Read one real log into a fresh ArrayBuffer, as a browser FileReader hands it over. */
export function readRealLog(name: string): ArrayBuffer {
  if (realLogDir === undefined) throw new Error('APWT_REAL_LOGS is not set')
  const buf = readFileSync(join(realLogDir, name))
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(buf)
  return out
}

/** Timeout for one real-log test: big logs take minutes on both parsers. */
export const REAL_LOG_TIMEOUT_MS = 30 * 60_000

/**
 * Let the event loop run. Long synchronous comparisons call this between steps so Vitest's
 * worker keeps answering its RPC heartbeats (they time out after 60 s of blocking).
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
