// Test-only: loads the vendored upstream FilterReview JavaScript (plus the Libraries it uses)
// into a node:vm context with a minimal DOM stub, so the TypeScript port can be compared
// against it on identical inputs. Each call returns a fresh, isolated instance.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { RealFft } from '@apwt/signal'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../../upstream')

/** Stand-in for a DOM element: just the properties FilterReview reads and writes. */
export interface StubElement {
  value: string
  checked: boolean
  disabled: boolean
  innerHTML: string
  style: Record<string, string>
  dataset: Record<string, string>
  firstElementChild: { innerHTML: string }
  min?: number
  max?: number
  on(): void
}

/** Handle on one upstream FilterReview instance. */
export interface UpstreamFilterReview {
  /** Evaluate code in the script scope (sees `let`/`const`/`class` declarations). */
  run(code: string): unknown
  /** Set a global visible to `run`. */
  set(name: string, value: unknown): void
  /** The stub element with this id (created on first access). */
  element(id: string): StubElement
  /** Messages passed to `alert`. */
  readonly alerts: string[]
}

const libraries = ['Libraries/Array_Math.js', 'Libraries/fft.js', 'Libraries/Param_Helpers.js', 'Libraries/LogHelpers.js']
const tool = [
  'FilterReview/FilterReview.js',
  'FilterReview/tracking/Atmosphere_model.js',
  'FilterReview/tracking/BaseClass.js',
  'FilterReview/tracking/Static.js',
  'FilterReview/tracking/Throttle.js',
  'FilterReview/tracking/RPM.js',
  'FilterReview/tracking/ESC.js',
  'FilterReview/tracking/FFT.js',
  'FilterReview/tracking/Logged.js'
]

let source: string | undefined

function upstreamSource(): string {
  if (source !== undefined) return source
  const parts = [...libraries, ...tool].map((file) => {
    let text = readFileSync(resolve(upstreamDir, file), 'utf8')
    // The parser is imported dynamically by the page; tests pass parsed logs in directly.
    if (file.endsWith('FilterReview.js')) text = text.replace(/^const import_done = import\(.*$/m, '')
    return text
  })
  source = parts.join('\n;\n') + '\n;({ run: (code) => eval(code) })'
  return source
}

function makeElement(): StubElement {
  return {
    value: '0',
    checked: false,
    disabled: false,
    innerHTML: '',
    style: {},
    dataset: {},
    firstElementChild: { innerHTML: '' },
    on: () => undefined
  }
}

/** Load a fresh upstream FilterReview into its own vm context. */
export function loadFilterReviewUpstream(): UpstreamFilterReview {
  const elements = new Map<string, StubElement>()
  const element = (id: string): StubElement => {
    let e = elements.get(id)
    if (e === undefined) {
      e = makeElement()
      elements.set(id, e)
    }
    return e
  }
  const alerts: string[] = []
  const noop = (): void => undefined
  const context = createContext({
    // Upstream only calls createComplexArray() and realTransform(), which RealFft mirrors
    FFTJS: RealFft,
    document: { getElementById: element, title: '' },
    alert: (msg: string) => alerts.push(msg),
    console: { log: noop, error: noop, warn: noop },
    performance: { now: () => 0 },
    Plotly: { newPlot: noop, purge: noop, redraw: noop },
    link_plot_axis_range: noop,
    link_plot_reset: noop,
    plot_default_color: () => '#000'
  })
  const api = runInContext(upstreamSource(), context, { filename: 'upstream-filter-review.js' }) as {
    run: (code: string) => unknown
  }
  return {
    run: (code) => api.run(code),
    set: (name, value) => {
      ;(context as Record<string, unknown>)[name] = value
    },
    element,
    alerts
  }
}

/** Subset of the upstream JsDataflashParser used by FilterReview. */
export interface UpstreamLog {
  messageTypes: Record<string, { expressions: string[]; instances?: Record<string, unknown> }>
  get(name: string, field?: string): unknown
  get_instance(name: string, instance: string | number, field?: string): unknown
}

type UpstreamParserCtor = new (
  sendPostMessage: boolean
) => UpstreamLog & { processData(buffer: ArrayBuffer, msgs: string[]): void }

let parserCtor: Promise<UpstreamParserCtor> | undefined

/** Parse a log with the upstream JsDataflashParser. */
export async function parseWithUpstream(bytes: Uint8Array): Promise<UpstreamLog> {
  parserCtor ??= (async () => {
    // parser.js registers a Worker message listener at module scope.
    const g = globalThis as unknown as Record<string, unknown>
    g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
    const path = resolve(upstreamDir, 'modules/JsDataflashParser/parser.js')
    const mod = (await import(/* @vite-ignore */ path)) as { default: UpstreamParserCtor }
    return mod.default
  })()
  const Parser = await parserCtor
  const log = new Parser(false)
  // The parser logs every parameter change; keep test output clean.
  const original = console.log
  console.log = () => undefined
  try {
    log.processData(bytes.slice().buffer, [])
  } finally {
    console.log = original
  }
  return log
}

/** Upstream complex vector as `[re[], im[]]`. */
export type Pair = [ArrayLike<number>, ArrayLike<number>]
