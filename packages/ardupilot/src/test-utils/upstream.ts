// Test-only: loads the upstream JS (DecodeDevID.js, LogHelpers.js, Param_Helpers.js)
// into a vm context so the TypeScript port can be compared against it on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import type { DataflashLog } from '@apwt/dataflash'

/** Shape of upstream `decode_devid` results. */
export interface UpstreamDevId {
  type: string
  bus_type: string
  bus_type_index: number
  bus: number
  address: number
  name: string
  devtype?: number
  sensor_id?: number
}

/** Shape of upstream `get_version_and_board` results. */
export interface UpstreamVersion {
  flight_controller?: string | undefined
  board_id?: number | undefined
  fw_string?: string | undefined
  fw_hash?: string | undefined
  os_string?: string | undefined
  build_type?: number | undefined
  filter_version?: number | undefined
}

/** Minimal upstream JsDataflashParser surface used by `get_version_and_board`. */
export interface UpstreamLog {
  messageTypes: Record<string, unknown>
  get(name: string): Record<string, ArrayLike<number> | string[]>
}

/** Upstream functions under test. */
export interface Upstream {
  decode_devid(id: number, type: number): UpstreamDevId | undefined
  get_version_and_board(log: UpstreamLog): UpstreamVersion
  get_param_name_vector3(prefix: string): string[]
  get_compass_param_names(index: number): Record<string, string | string[]>
  param_to_string(value: number): string
  get_param_download_text(params: Record<string, number>): string
  get_param_value(paramLog: { Name: string[]; Value: number[] }, name: string, allowChange?: boolean): number | undefined
}

/** Text upstream passed to `console.log` and `alert`, in call order. */
export const upstreamOutput: { log: string[]; alert: string[] } = { log: [], alert: [] }

let cached: Upstream | undefined

/** Load (once) the upstream helpers from upstream/Libraries into an isolated vm context. */
export function loadUpstream(): Upstream {
  if (cached !== undefined) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  const libDir = resolve(here, '../../../../upstream/Libraries')
  const names = [
    'decode_devid',
    'get_version_and_board',
    'get_param_name_vector3',
    'get_compass_param_names',
    'param_to_string',
    'get_param_download_text',
    'get_param_value'
  ]
  const source =
    ['DecodeDevID.js', 'LogHelpers.js', 'Param_Helpers.js'].map((f) => readFileSync(resolve(libDir, f), 'utf8')).join('\n') +
    `\n;({ ${names.join(', ')} })`
  const context = createContext({
    console: { log: (m: string) => upstreamOutput.log.push(m), error: () => undefined },
    alert: (m: string) => upstreamOutput.alert.push(m)
  })
  cached = runInContext(source, context, { filename: 'upstream-libraries.js' }) as Upstream
  return cached
}

/** Wrap a parsed log in the subset of the upstream parser API that LogHelpers.js uses. */
export function upstreamLogView(log: DataflashLog): UpstreamLog {
  return {
    messageTypes: Object.fromEntries(log.messageTypes()),
    get(name: string) {
      const msg = log.getMessage(name)
      if (msg === undefined) throw new Error('no ' + name)
      return msg.columns as Record<string, ArrayLike<number> | string[]>
    }
  }
}

/** Directory of the shared DataFlash fixtures. */
export function fixturePath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../../../packages/dataflash/test-fixtures', name)
}

/** Read a fixture log into a fresh ArrayBuffer. */
export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)))
}

/** Deterministic PRNG (mulberry32) so random oracle comparisons are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
