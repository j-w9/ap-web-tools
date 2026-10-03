// Test-only: runs the vendored upstream LogFinder.js (with LogHelpers.js and Param_Helpers.js)
// in a vm context, backed by the upstream JsDataflashParser, so the port can be compared on the
// same fixture logs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../../..')

/** Upstream `load_log` result, with luxon's DateTime stubbed to the raw `Date`. */
export interface UpstreamInfo {
  size: number
  fw_string?: string
  git_hash?: string
  board_id?: number
  fc_string?: string
  os_string?: string
  board_name?: string
  build_type?: number
  params: Record<string, number>
  time_stamp: Date | undefined
  flight_time?: number
  watchdog: boolean
  crash_dump?: boolean
  distance_traveled: number | null
  available_log_messages: string[]
}

export interface UpstreamDiff {
  added: Record<string, number>
  missing: Record<string, number>
  changed: Record<string, { from: number; to: number }>
}

export interface UpstreamLogFinder {
  load_log(buffer: ArrayBuffer): UpstreamInfo | undefined
  get_param_diff(params: Record<string, number>, prev: Record<string, number>): UpstreamDiff
  param_diff_ignore: { name: string; fun: (name: string) => boolean; check: { checked: boolean } }[]
  param_to_string(value: number): string
  get_param_download_text(params: Record<string, number>): string
  setBoardTypes(text: string): void
}

let cached: UpstreamLogFinder | undefined

/** Load (once) upstream LogFinder in a vm context. */
export async function loadUpstreamLogFinder(): Promise<UpstreamLogFinder> {
  if (cached !== undefined) return cached
  // parser.js registers a Worker message listener at module scope.
  if (!('self' in globalThis)) {
    Reflect.set(globalThis, 'self', { addEventListener: () => undefined, postMessage: () => undefined })
  }
  const parserPath = resolve(root, 'upstream/modules/JsDataflashParser/parser.js')
  const mod: { default: unknown } = await import(/* @vite-ignore */ parserPath)

  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
  // Drop the dynamic import of the parser; the class is provided by the context instead.
  const logFinder = read('upstream/LogFinder/LogFinder.js').replace(/^import\(.*$/m, '')
  const source = [read('upstream/Libraries/LogHelpers.js'), read('upstream/Libraries/Param_Helpers.js'), logFinder].join('\n')
  const context = createContext({
    DataflashParser: mod.default,
    luxon: { DateTime: { fromJSDate: (d: Date | undefined) => d } },
    console: { log: () => undefined, error: () => undefined }
  })
  runInContext(source, context, { filename: 'upstream-log-finder.js' })
  runInContext(
    `param_diff_ignore.forEach((i) => { i.check = { checked: true } })
     function setBoardTypes(text) {
       for (const line of text.match(/[^\\r\\n]+/g)) {
         const match = line.match(/(^[-\\w]+)\\s+(\\d+)/)
         if (match) board_types[match[2]] = match[1].replace(/^TARGET_HW_/, '').replace(/^EXT_HW_/, '').replace(/^AP_HW_/, '')
       }
     }`,
    context
  )
  cached = runInContext(
    '({ load_log, get_param_diff, param_diff_ignore, param_to_string, get_param_download_text, setBoardTypes })',
    context
  ) as UpstreamLogFinder
  cached.setBoardTypes(read('upstream/LogFinder/board_types.txt'))
  return cached
}

/** Path of a shared DataFlash fixture. */
export function fixturePath(name: string): string {
  return resolve(root, 'packages/dataflash/test-fixtures', name)
}

/** Read a fixture into a fresh ArrayBuffer. */
export function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(fixturePath(name))
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(buf)
  return out
}

export const FIXTURES = ['copter-sitl.bin', 'copter-files.bin'] as const
