// Test-only: runs upstream PIDReview.js (with Libraries/Array_Math.js, fft.js and LogHelpers.js and
// the real upstream DataFlash parser) inside node:vm with a small fake DOM, so the port can be
// compared with it on identical logs and inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'
import FFT from 'fft.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../upstream')
const read = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')

/** Read a fixture log from packages/dataflash/test-fixtures as an `ArrayBuffer`. */
export function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(here, '../../../../packages/dataflash/test-fixtures', name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
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

/** The radio group (`name`) of an element id in index.html, if it is a radio button. */
function radioGroup(id: string): string | undefined {
  if (id.startsWith('Spec_')) return 'Spec'
  if (id.startsWith('type_')) return 'Axis'
  if (['ScaleLinear', 'ScaleLog', 'ScalePSD'].includes(id)) return 'Scale'
  if (['freq_ScaleLinear', 'freq_ScaleLog'].includes(id)) return 'feq_scale'
  if (['freq_Scale_Hz', 'freq_Scale_RPM'].includes(id)) return 'feq_unit'
  return undefined
}

/** Minimal DOM element: the properties PIDReview.js reads and writes. Radio buttons uncheck their group. */
class FakeElement {
  private isChecked = false
  id = ''
  get checked(): boolean {
    return this.isChecked
  }
  set checked(value: boolean) {
    this.isChecked = value
    const group = radioGroup(this.id)
    if (!value || group === undefined) return
    for (const [id, el] of this.registry) {
      if (el !== this && radioGroup(id) === group) el.isChecked = false
    }
  }
  disabled = false
  value = ''
  defaultValue = ''
  innerHTML = ''
  min = ''
  max = ''
  readonly style: Record<string, string> = {}
  readonly children: unknown[] = []
  private readonly attributes = new Map<string, string>()
  constructor(private readonly registry: Map<string, FakeElement>) {}
  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value))
    if (name === 'id') this.registry.set(String(value), this)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }
  appendChild(child: unknown): void {
    this.children.push(child)
  }
  replaceChildren(): void {
    this.children.length = 0
  }
  on(): void {}
  removeAllListeners(): void {}
  querySelectorAll(): unknown[] {
    return []
  }
}

/** A Plotly trace as upstream builds it. */
export interface UpTrace {
  x?: ArrayLike<number>
  y?: ArrayLike<number>
  z?: ArrayLike<number>[]
  visible?: boolean
  meta?: string
}

/** Handle on an upstream PID Review page running in a vm context. */
export interface UpstreamPidReview {
  readonly context: Context
  readonly alerts: string[]
  /** Evaluate an expression in the page, typed by the caller. */
  evaluate(code: string): unknown
  element(id: string): FakeElement
  /** `await load(buffer)`; resolves with the error when upstream throws (window.onerror). */
  load(buffer: ArrayBuffer): Promise<unknown>
  /** Run a page function by name (e.g. `re_calc`, `redraw`, `setup_axis`), returning any thrown error. */
  call(name: string): unknown
}

/** Create a fresh upstream PID Review page with its HTML defaults applied. */
export async function createUpstreamPidReview(): Promise<UpstreamPidReview> {
  const Parser = await loadUpstreamParser()
  const alerts: string[] = []
  const registry = new Map<string, FakeElement>()
  const element = (id: string): FakeElement => {
    let el = registry.get(id)
    if (el === undefined) {
      el = new FakeElement(registry)
      el.id = id
      registry.set(id, el)
    }
    return el
  }
  // index.html defaults.
  element('FFTWindow_size').value = '512'
  element('FFTWindow_size').defaultValue = '512'
  element('TimeStart').value = '0'
  element('TimeEnd').value = '0'
  element('ScaleLog').checked = true
  element('freq_ScaleLinear').checked = true
  element('freq_Scale_Hz').checked = true

  const document = {
    title: '',
    getElementById: element,
    createElement: () => new FakeElement(registry),
    createTextNode: (text: unknown) => ({ text })
  }
  const noop = () => undefined
  const context = createContext({
    console: { log: noop, warn: noop, error: noop },
    document,
    performance: { now: () => 0 },
    Plotly: { purge: noop, newPlot: noop, redraw: noop },
    FFTJS: FFT,
    alert: (msg: string) => alerts.push(msg),
    __Parser: Parser,
    plot_default_color: (i: number) => `#color${i}`,
    link_plot_axis_range: noop,
    link_plot_reset: noop,
    open_in_update: noop
  })

  const page = read('PIDReview/PIDReview.js').replace(
    /^var DataflashParser\nconst import_done = import\(.*$/m,
    'var DataflashParser = __Parser\nconst import_done = Promise.resolve()'
  )
  if (!page.includes('__Parser')) throw new Error('upstream PIDReview.js import line not found')

  for (const [name, source] of [
    ['Array_Math.js', read('Libraries/Array_Math.js')],
    ['fft.js', read('Libraries/fft.js')],
    ['LogHelpers.js', read('Libraries/LogHelpers.js')],
    ['PIDReview.js', page],
    ['setup', 'setup_plots()\nreset()']
  ] as const) {
    runInContext(source, context, { filename: name })
  }

  const evaluate = (code: string): unknown => runInContext(code, context)
  return {
    context,
    alerts,
    evaluate,
    element,
    async load(buffer) {
      Reflect.set(context, '__buffer', buffer)
      try {
        await (evaluate('load(__buffer)') as Promise<void>)
        return undefined
      } catch (e) {
        return e
      }
    },
    call(name) {
      try {
        evaluate(`${name}()`)
        return undefined
      } catch (e) {
        return e
      }
    }
  }
}
