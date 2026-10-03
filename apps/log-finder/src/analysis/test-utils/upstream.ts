// Test-only: runs the vendored upstream LogFinder.js (with LogHelpers.js and Param_Helpers.js)
// in a vm context, backed by the upstream JsDataflashParser, so the port can be compared on the
// same fixture logs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import * as luxon from 'luxon'

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

/** Upstream row data as `setup_table` hands it to Tabulator. */
export interface UpstreamRowData {
  info: Record<string, unknown> & { params: Record<string, number> }
  fileHandle: { relativePath: string; name: string }
  param_diff?: UpstreamDiff | null
}

/** Minimal Tabulator row component. */
export interface UpstreamRow {
  getData(): UpstreamRowData
}

/** The formatters and calcs nested in upstream `setup_table`, lifted out verbatim. */
export interface UpstreamFormatters {
  size_format(cell: UpstreamCell): string
  flight_time_format(cell: UpstreamCell): string
  get_dist_string(cell: UpstreamCell): string
  total_param_diff_calc(values: unknown[], data: UpstreamRowData[]): UpstreamDiff | null
  get_common_path(logs: UpstreamRowData[]): string
}

export interface UpstreamCell {
  getRow(): UpstreamRow
}

export interface UpstreamLogFinder {
  load_log(buffer: ArrayBuffer): UpstreamInfo | undefined
  update_param_diff(table: { redraw(force: boolean): void }, rows: UpstreamRow[]): void
  formatters: UpstreamFormatters
  /** The polyline points upstream's map tooltip draws (`tippy_show` reader body, verbatim). */
  map_latlngs(buffer: ArrayBuffer): [number, number][] | undefined
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
    // `load_log` stores `luxon.DateTime.fromJSDate(start)`; the raw Date is kept for comparison.
    luxon: { DateTime: { fromJSDate: (d: Date | undefined) => d }, Duration: luxon.Duration },
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
  const formatterNames = ['size_format', 'flight_time_format', 'get_dist_string', 'total_param_diff_calc', 'get_common_path']
  const nested = formatterNames.map((name) => extractFunction(logFinder, name)).join('\n')
  runInContext(`var formatters = (function () {\n${nested}\nreturn { ${formatterNames.join(', ')} } })()`, context)
  // Body of the FileReader `onload` in upstream `tippy_show`, with `L.polyline(latlngs)` replaced
  // by returning the points.
  const onload = /reader\.onload = function \(e\) \{\n\s+let log = new DataflashParser\(\)([\s\S]*?)var polyline/.exec(
    logFinder
  )?.[1]
  if (onload === undefined) throw new Error('map tooltip loader not found upstream')
  runInContext(
    `function map_latlngs(buffer) { const reader = { result: buffer }; let log = new DataflashParser()${onload}return latlngs }`,
    context
  )
  cached = runInContext(
    '({ load_log, update_param_diff, formatters, map_latlngs, get_param_diff, param_diff_ignore, param_to_string, get_param_download_text, setBoardTypes })',
    context
  ) as UpstreamLogFinder
  cached.setBoardTypes(read('upstream/LogFinder/board_types.txt'))
  return cached
}

/** Source of the function declaration `name` (matched by braces), from upstream text. */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`no function ${name} upstream`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`unbalanced function ${name}`)
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
