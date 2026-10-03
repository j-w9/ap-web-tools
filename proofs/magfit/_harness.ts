// Test-only: runs the upstream MAGFit JavaScript (magfit.js, wmm.js, quaternion.js and the
// shared Libraries it uses) inside a node:vm context with a stub DOM, so the TypeScript port
// can be compared against it on the same log. The upstream mljs build and DataFlash parser are
// the real vendored copies from upstream/modules.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../upstream')

/** Path of a fixture log in packages/dataflash/test-fixtures. */
export function fixturePath(name: string): string {
  return resolve(here, '../../packages/dataflash/test-fixtures', name)
}

/** Read a fixture log as an `ArrayBuffer`. */
export function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(fixturePath(name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// Properties a stub element reports as unset rather than auto-creating (so `if (el.checked)`
// and `await el` behave like a fresh DOM element).
const UNSET = new Set<PropertyKey>(['checked', 'disabled', 'hidden', 'value', 'then', 'dataset'])

/**
 * A permissive fake DOM node: any property read returns a nested stub (remembered), writes are
 * stored, and it can be called or constructed. Enough for upstream's DOM and Plotly calls.
 */
export function stub(): object {
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

/** Handle on an upstream MAGFit instance running in a vm context. */
export interface UpstreamMagfit {
  readonly context: Context
  /** Evaluate an expression in the upstream context (e.g. `MAG_Data`), typed by the caller. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- upstream JS is untyped
  evaluate<T>(code: string): T
  /** Messages passed to `alert`. */
  readonly alerts: string[]
  /** Messages passed to `confirm` (always answered yes). */
  readonly confirms: string[]
  /** Text of files passed to `saveAs`. */
  readonly saved: string[]
  /** Element objects by id (`TimeStart`, ...). */
  element(id: string): Record<string, unknown>
  /** Set the value returned by `document.querySelector(selector).value`. */
  setRadio(selector: string, value: string): void
}

type ParserCtor = new (sendPostMessage: boolean) => unknown

let parserCtor: ParserCtor | undefined

/** Import (once) the upstream JsDataflashParser class. */
export async function loadUpstreamParser(): Promise<ParserCtor> {
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

/** Create a fresh upstream MAGFit context (plots set up, no log loaded). */
export async function createUpstreamMagfit(): Promise<UpstreamMagfit> {
  const Parser = await loadUpstreamParser()
  const alerts: string[] = []
  const saved: string[] = []
  const confirms: string[] = []
  const elements = new Map<string, object>()
  const radios = new Map<string, object>()
  const element = (id: string): object => {
    let el = elements.get(id)
    if (el === undefined) {
      el = stub()
      elements.set(id, el)
    }
    return el
  }
  const radio = (selector: string): object => {
    let el = radios.get(selector)
    if (el === undefined) {
      el = stub()
      ;(el as Record<string, unknown>)['value'] = '0'
      radios.set(selector, el)
    }
    return el
  }
  const document = stub() as Record<string, unknown>
  document['getElementById'] = element
  document['querySelector'] = radio
  document['createElement'] = () => stub()

  class FakeBlob {
    readonly text: string
    constructor(parts: string[]) {
      this.text = parts.join('')
    }
  }

  const context = createContext({
    console: { log: () => undefined, warn: () => undefined },
    performance: { now: () => 0 },
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
    __Parser: Parser,
    open_in_update: () => undefined,
    plot_default_color: () => '#000000',
    link_plot_axis_range: () => undefined,
    link_plot_reset: () => undefined,
    parameter_set_value: () => undefined
  })

  const read = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')
  const magfit = read('MAGFit/magfit.js').replace(
    /^var DataflashParser\nconst import_done = import\(.*$/m,
    'var DataflashParser = __Parser\nconst import_done = Promise.resolve()'
  )
  if (!magfit.includes('__Parser')) throw new Error('upstream magfit.js import line not found')

  for (const [name, source] of [
    ['matrix.umd.js', read('modules/build/matrix/matrix.umd.js')],
    ['Array_Math.js', read('Libraries/Array_Math.js')],
    ['Param_Helpers.js', read('Libraries/Param_Helpers.js')],
    ['DecodeDevID.js', read('Libraries/DecodeDevID.js')],
    ['wmm.js', read('MAGFit/wmm.js')],
    ['quaternion.js', read('MAGFit/quaternion.js')],
    ['magfit.js', magfit]
  ] as const) {
    runInContext(source, context, { filename: name })
  }
  runInContext('setup_plots()', context)

  return {
    context,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- upstream JS is untyped
    evaluate: <T>(code: string): T => runInContext(code, context) as T,
    alerts,
    confirms,
    saved,
    element: (id) => element(id) as Record<string, unknown>,
    setRadio: (selector, value) => {
      ;(radio(selector) as Record<string, unknown>)['value'] = value
    }
  }
}

/** Load a log into upstream MAGFit (runs upstream `load`, which ends with `calculate`). */
export async function upstreamLoad(up: UpstreamMagfit, buffer: ArrayBuffer): Promise<void> {
  ;(up.context as Record<string, unknown>)['__buffer'] = buffer
  await up.evaluate<Promise<void>>('load(__buffer)')
}
