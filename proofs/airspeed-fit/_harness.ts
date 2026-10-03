// Test-only: runs the upstream AirspeedFit JavaScript inside node:vm so the TypeScript port can be
// compared against it on identical inputs. `loadUpstreamCore` evaluates airspeedfit_core.js alone
// (with the vendored ml-matrix build); `createUpstreamTool` also runs airspeedfit.js and the
// shared Libraries with a stub DOM and the real upstream DataFlash parser.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../upstream')

const read = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')

/** Read a fixture log from packages/dataflash/test-fixtures as an `ArrayBuffer`. */
export function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(here, '../../packages/dataflash/test-fixtures', name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

type Arr = ArrayLike<number>

/** Upstream `calibrate` result. */
export interface UpCal {
  ratio: number
  k: number
  ratio_stderr: number
  wind_ne: [number, number]
  residual_rms: number
  n_samples: number
  course_spread_deg: number
  warnings: string[]
}

/** Upstream `calibrate_combined` result. */
export interface UpCombined {
  t: number[]
  wind_ne: [number, number][]
  wind_sigma: [number, number][]
  wind_drift: number
  r_meas: number
  iterations: number
  D: number[]
  per_sensor: {
    k: number
    ratio: number
    ratio_stderr: number
    residual_rms: number
    u: number[]
    pred: number[]
    resid: number[]
  }[]
  n_samples: number
}

/** The functions airspeedfit_core.js exports. */
export interface UpstreamCore {
  isa_temperature_at_alt_c(alt: number): number
  air_temperature_c(ground: number, relAlt: number, lapse?: number): number
  eas2tas(p: number, t: number): number
  density_altitude_m(e2t: number): number
  auto_window(t: Arr, dp: Arr, lo: number, hi: number): { start: number; end: number; mean_dp: number }
  course_spread_deg(vn: Arr, ve: Arr): number
  refine(
    vn: Arr,
    ve: Arr,
    vd: Arr,
    u: Arr,
    wn: number,
    we: number,
    k: number,
    iters?: number,
    tol?: number
  ): { Wn: number; We: number; k: number; residual_rms: number; cov: number[][] }
  calibrate(vn: Arr, ve: Arr, vd: Arr, u: Arr, opts?: object): UpCal
  wind_smoother(
    dt: number,
    vn: Arr,
    ve: Arr,
    vd: Arr,
    u: Arr,
    k: number,
    q: number,
    r: number,
    x0: [number, number],
    p0: [[number, number], [number, number]],
    iters?: number
  ): { xs: [number, number][]; Ps: [[number, number], [number, number]][] }
  calibrate_combined(t: Arr, vn: Arr, ve: Arr, vd: Arr, uList: Arr[], seeds: UpCal[], opts?: object): UpCombined
}

const CORE_NAMES = [
  'isa_temperature_at_alt_c',
  'air_temperature_c',
  'eas2tas',
  'density_altitude_m',
  'auto_window',
  'course_spread_deg',
  'refine',
  'calibrate',
  'wind_smoother',
  'calibrate_combined'
] as const

/** Evaluate upstream airspeedfit_core.js with the vendored ml-matrix build. */
export function loadUpstreamCore(): UpstreamCore {
  const context = createContext({})
  runInContext(read('modules/build/matrix/matrix.umd.js'), context, { filename: 'matrix.umd.js' })
  runInContext(read('AirspeedFit/airspeedfit_core.js'), context, { filename: 'airspeedfit_core.js' })
  return runInContext(`({ ${CORE_NAMES.join(', ')} })`, context) as UpstreamCore
}

// Properties a stub element reports as unset rather than auto-creating.
const UNSET = new Set<PropertyKey>(['checked', 'disabled', 'hidden', 'value', 'then', 'dataset'])

/** A permissive fake DOM node: reads return remembered nested stubs, writes are stored, calls return stubs. */
function stub(): object {
  const store = new Map<PropertyKey, unknown>()
  const proxy: object = new Proxy(function () {}, {
    get(_target, key) {
      if (store.has(key)) return store.get(key)
      if (key === Symbol.toPrimitive) return () => ''
      if (typeof key === 'symbol' || UNSET.has(key)) return undefined
      const child = stub()
      store.set(key, child)
      return child
    },
    set(_target, key, value) {
      store.set(key, value)
      return true
    },
    apply: () => stub(),
    construct: () => stub()
  })
  return proxy
}

/** Handle on an upstream AirspeedFit instance running in a vm context. */
export interface UpstreamTool {
  readonly context: Context
  /** Evaluate an expression in the upstream context, typed by the caller. */
  evaluate(code: string): unknown
  readonly alerts: string[]
  readonly confirms: string[]
  /** Text of files passed to `saveAs`. */
  readonly saved: string[]
  /** URLs passed to `fetch`. */
  readonly fetched: string[]
  /** Element objects by id (`TimeStart`, ...). */
  element(id: string): Record<string, unknown>
}

type ParserCtor = new (sendPostMessage: boolean) => unknown
let parserCtor: ParserCtor | undefined

async function loadUpstreamParser(): Promise<ParserCtor> {
  if (parserCtor !== undefined) return parserCtor
  // parser.js registers a Worker message listener at module scope.
  if (!('self' in globalThis)) {
    Reflect.set(globalThis, 'self', { addEventListener: () => undefined, postMessage: () => undefined })
  }
  const path = resolve(upstreamDir, 'modules/JsDataflashParser/parser.js')
  const mod = (await import(/* @vite-ignore */ path)) as { default: ParserCtor }
  parserCtor = mod.default
  return parserCtor
}

/**
 * Create a fresh upstream AirspeedFit context. `weather` is what the stub `fetch` answers with
 * (the parsed JSON), or null to make the lookup fail.
 */
export async function createUpstreamTool(weather: unknown = null): Promise<UpstreamTool> {
  const Parser = await loadUpstreamParser()
  const alerts: string[] = []
  const saved: string[] = []
  const confirms: string[] = []
  const fetched: string[] = []
  const elements = new Map<string, object>()
  const element = (id: string): object => {
    let el = elements.get(id)
    if (el === undefined) {
      el = stub()
      elements.set(id, el)
    }
    return el
  }
  // The q slider starts at upstream's default position.
  Reflect.set(element('q_slider'), 'value', '-1.5')
  const document = stub()
  Reflect.set(document, 'getElementById', element)
  Reflect.set(document, 'createElement', () => stub())

  class FakeBlob {
    readonly text: string
    constructor(parts: string[]) {
      this.text = parts.join('')
    }
  }

  const context = createContext({
    console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    document,
    Plotly: stub(),
    tippy: () => undefined,
    alert: (msg: string) => alerts.push(msg),
    confirm: (msg: string) => {
      confirms.push(msg)
      return true
    },
    saveAs: (blob: FakeBlob) => saved.push(blob.text),
    Blob: FakeBlob,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    fetch: (url: string) => {
      fetched.push(url)
      return weather === null
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve(weather) })
    },
    __Parser: Parser,
    plot_default_color: () => '#000000',
    parameter_set_value: () => true
  })

  const tool = read('AirspeedFit/airspeedfit.js').replace(
    /^var DataflashParser\nconst import_done = import\(.*$/m,
    'var DataflashParser = __Parser\nconst import_done = Promise.resolve()'
  )
  if (!tool.includes('__Parser')) throw new Error('upstream airspeedfit.js import line not found')

  for (const [name, source] of [
    ['matrix.umd.js', read('modules/build/matrix/matrix.umd.js')],
    ['Array_Math.js', read('Libraries/Array_Math.js')],
    ['Param_Helpers.js', read('Libraries/Param_Helpers.js')],
    ['DecodeDevID.js', read('Libraries/DecodeDevID.js')],
    ['airspeedfit_core.js', read('AirspeedFit/airspeedfit_core.js')],
    ['airspeedfit.js', tool],
    ['setup', 'var open_in_update = () => undefined\nsetup_plots()']
  ] as const) {
    runInContext(source, context, { filename: name })
  }

  return {
    context,
    evaluate: (code): unknown => runInContext(code, context) as unknown,
    alerts,
    confirms,
    saved,
    fetched,
    element: (id) => {
      const el = element(id)
      return new Proxy<Record<string, unknown>>(
        {},
        {
          get: (_t, key): unknown => Reflect.get(el, key) as unknown,
          set: (_t, key, value) => Reflect.set(el, key, value)
        }
      )
    }
  }
}

/** Load a log into upstream AirspeedFit (upstream `load`, which ends with `calculate`). */
export async function upstreamLoad(up: UpstreamTool, buffer: ArrayBuffer): Promise<void> {
  Reflect.set(up.context, '__buffer', buffer)
  await (up.evaluate('load(__buffer)') as Promise<void>)
}
