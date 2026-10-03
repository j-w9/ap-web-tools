// Test-only: the whole upstream FilterReview page in a node:vm context, with a DOM stub that
// keeps the input semantics upstream relies on (radio groups, drop-downs that only take their
// option values, number inputs that drop invalid text, file inputs that refuse a value). It runs
// upstream `load()`, `load_parameters()`, `save_parameters()` and `open_in_filter_tool()` as
// the page does, so the port's page-level decisions can be compared with them.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { RealFft } from '@apwt/signal'
import { sanitizeNumberInput } from '../page-values.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../../upstream')

const files = [
  'Libraries/DecodeDevID.js',
  'Libraries/Array_Math.js',
  'Libraries/ParameterMetadata.js',
  'Libraries/Param_Helpers.js',
  'Libraries/fft.js',
  'Libraries/LogHelpers.js',
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
function pageSource(): string {
  source ??=
    files
      .map((file) => {
        const text = readFileSync(resolve(upstreamDir, file), 'utf8')
        return file.endsWith('FilterReview.js')
          ? text.replace(/^const import_done = import\(.*$/m, 'const import_done = undefined')
          : text
      })
      .join('\n;\n') + '\n;({ run: (code) => eval(code) })'
  return source
}

interface InputSpec {
  id: string
  type: string
  name: string
  value: string
  checked: boolean
}

/** `<input>` elements of upstream index.html, in document order. */
function pageInputs(): InputSpec[] {
  const html = readFileSync(resolve(upstreamDir, 'FilterReview/index.html'), 'utf8')
  return [...html.matchAll(/<input\b[^>]*>/g)].flatMap((m) => {
    const tag = m[0]
    const attr = (name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
    const id = attr('id')
    if (id === undefined) return []
    return [
      { id, type: attr('type') ?? 'text', name: attr('name') ?? '', value: attr('value') ?? '', checked: /\bchecked\b/.test(tag) }
    ]
  })
}

/** Parameters `load_param_inputs` turns into drop-downs, with their option values. */
const SELECTS: Record<string, string[]> = {
  INS_HNTCH_ENABLE: ['0', '1'],
  INS_HNTCH_MODE: ['0', '1', '2', '3', '4', '5'],
  INS_HNTC2_ENABLE: ['0', '1'],
  INS_HNTC2_MODE: ['0', '1', '2', '3', '4', '5']
}
const BITMASKS = ['INS_HNTCH_HMNCS', 'INS_HNTCH_OPTS', 'INS_HNTC2_HMNCS', 'INS_HNTC2_OPTS']

/** Minimal DOM element. */
export interface PageElement {
  id: string
  name: string
  type: string
  tagName: string
  get value(): string
  /** Upstream assigns numbers as well as strings. */
  set value(v: unknown)
  get checked(): boolean
  set checked(c: unknown)
  disabled: boolean
  innerHTML: string
  min?: number
  max?: number
  style: Record<string, string>
  dataset: Record<string, string>
  firstElementChild: { innerHTML: string }
  parentElement: { querySelectorAll(): never[] }
  on(): void
}

/** Handle on one upstream page. */
export interface UpstreamPage {
  run(code: string): unknown
  set(name: string, value: unknown): void
  element(id: string): PageElement
  readonly alerts: string[]
  /** Run upstream `load()` on log bytes (parsed by the upstream JsDataflashParser). */
  load(bytes: Uint8Array): Promise<void>
  /** Run upstream `load_parameters()` with a file holding `text`. */
  loadParameters(text: string): Promise<void>
  /** Text upstream `save_parameters()` downloads. */
  saveParameters(): string
  /** URL upstream `open_in_filter_tool()` opens, from a page at `href`. */
  openInFilterTool(href: string): string
}

type ParserCtor = new () => { processData(buffer: ArrayBuffer, msgs: string[]): void }
let parser: Promise<ParserCtor> | undefined

/** Load a fresh upstream FilterReview page. */
export async function loadFilterReviewPage(): Promise<UpstreamPage> {
  parser ??= (async () => {
    const g = globalThis as unknown as Record<string, unknown>
    g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
    const mod = (await import(/* @vite-ignore */ resolve(upstreamDir, 'modules/JsDataflashParser/parser.js'))) as {
      default: ParserCtor
    }
    return mod.default
  })()
  const Parser = await parser

  const elements = new Map<string, PageElement>()
  const groups = new Map<string, PageElement[]>()
  const make = (id: string, type: string, tagName: string, name: string, initial: string, checked: boolean): PageElement => {
    let value = initial
    let isChecked = checked
    const el: PageElement = {
      id,
      name,
      type,
      tagName,
      get value(): string {
        return value
      },
      set value(v: unknown) {
        const text = String(v)
        if (tagName === 'SELECT') value = (SELECTS[id] ?? []).includes(text) ? text : ''
        else if (type === 'number') value = sanitizeNumberInput(text)
        else if (type === 'file') {
          if (text !== '') throw new Error(`InvalidStateError: ${id}`)
        } else value = text
      },
      get checked(): boolean {
        return isChecked
      },
      set checked(c: unknown) {
        isChecked = Boolean(c)
        if (isChecked && type === 'radio') {
          for (const other of groups.get(name) ?? []) if (other !== el) other.checked = false
        }
      },
      disabled: false,
      innerHTML: '',
      style: {},
      dataset: BITMASKS.includes(id) ? { type: '32' } : {},
      firstElementChild: { innerHTML: '' },
      parentElement: { querySelectorAll: () => [] },
      on: () => undefined
    }
    if (type === 'radio') groups.set(name, [...(groups.get(name) ?? []), el])
    elements.set(id, el)
    return el
  }
  const inputs: PageElement[] = []
  const selects: PageElement[] = []
  for (const spec of pageInputs()) {
    if (spec.id in SELECTS) selects.push(make(spec.id, 'select-one', 'SELECT', spec.name, spec.value, false))
    else inputs.push(make(spec.id, spec.type, 'INPUT', spec.name, spec.value, spec.checked))
  }
  const element = (id: string): PageElement => elements.get(id) ?? make(id, 'div', 'DIV', '', '', false)

  const alerts: string[] = []
  let saved = ''
  let opened = ''
  let href = ''
  const noop = (): void => undefined
  const context = createContext({
    FFTJS: RealFft,
    URL,
    document: {
      getElementById: element,
      getElementsByTagName: (tag: string) => (tag === 'input' ? inputs : tag === 'select' ? selects : []),
      title: ''
    },
    window: {
      get location() {
        return { href }
      },
      open: (url: string) => (opened = url)
    },
    Blob: class {
      readonly parts: string[]
      constructor(parts: string[]) {
        this.parts = parts
      }
    },
    saveAs: (blob: { parts: string[] }) => (saved = blob.parts.join('')),
    alert: (msg: string) => alerts.push(msg),
    error: (msg: string) => alerts.push(msg),
    console: { log: noop, error: noop, warn: noop },
    performance: { now: () => 0 },
    Plotly: { newPlot: noop, purge: noop, redraw: noop },
    link_plot_axis_range: noop,
    link_plot_reset: noop,
    plot_default_color: () => '#000',
    open_in_update: noop
  })
  const api = runInContext(pageSource(), context, { filename: 'upstream-filter-review-page.js' }) as {
    run: (code: string) => unknown
  }
  const run = (code: string): unknown => api.run(code)
  const set = (name: string, value: unknown): void => {
    ;(context as Record<string, unknown>)[name] = value
  }
  set('__Parser', Parser)
  // Page start-up, as index.html does
  run('DataflashParser = __Parser; setup_plots(); reset()')

  return {
    run,
    set,
    element,
    alerts,
    load: async (bytes) => {
      set('__buffer', bytes.slice().buffer)
      const original = console.log
      console.log = noop
      try {
        await (run('load(__buffer)') as Promise<void>)
      } finally {
        console.log = original
      }
    },
    loadParameters: async (text) => {
      set('__file', { text: () => Promise.resolve(text) })
      await (run('load_parameters(__file)') as Promise<void>)
    },
    saveParameters: () => {
      run('save_parameters()')
      return saved
    },
    openInFilterTool: (pageHref) => {
      href = pageHref
      run('open_in_filter_tool()')
      return opened
    }
  }
}
