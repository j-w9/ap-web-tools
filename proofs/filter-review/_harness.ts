// Proof harness: the original FilterReview page (upstream/FilterReview plus the Libraries it loads)
// in a node:vm context, with a DOM stub that keeps the input semantics of the HTML specification
// that upstream relies on: radio groups untick their siblings, a <select> only takes one of its
// option values (anything else selects nothing, value ""), a number input drops text that is not
// a valid floating-point number, and setting a file input's value to a non-empty string throws.
// Logs are passed in as plain objects with the JsDataflashParser interface FilterReview uses.
// Adapted from apps/filter-review/src/analysis/test-utils/upstream-page.ts.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import FFT from 'fft.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../upstream')

/** Scripts in the order FilterReview/index.html loads them. */
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
        // The page imports the log parser dynamically; logs are passed in directly instead.
        return file.endsWith('FilterReview.js')
          ? text.replace(/^const import_done = import\(.*$/m, 'const import_done = undefined')
          : text
      })
      .join('\n;\n') + '\n;({ run: (code) => eval(code) })'
  return source
}

/** HTML number input value sanitization: anything that is not a valid floating-point number becomes "". */
function sanitizeNumber(value: string): string {
  if (value === '') return ''
  if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value) || value.endsWith('.')) return ''
  return Number.isFinite(Number(value)) ? value : ''
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

/**
 * Inputs `load_param_inputs` replaces by drop-downs: the parameters with `Values` in
 * FilterReview/params.json, with those values as the options.
 */
const SELECTS: Record<string, string[]> = {
  INS_HNTCH_ENABLE: ['0', '1'],
  INS_HNTCH_MODE: ['0', '1', '2', '3', '4', '5'],
  INS_HNTC2_ENABLE: ['0', '1'],
  INS_HNTC2_MODE: ['0', '1', '2', '3', '4', '5']
}
/** Bitmask parameters, which `load_param_inputs` gives a `data-type`. */
const BITMASKS = ['INS_HNTCH_HMNCS', 'INS_HNTCH_OPTS', 'INS_HNTC2_HMNCS', 'INS_HNTC2_OPTS']

/** Minimal DOM element. */
export interface PageElement {
  readonly id: string
  get value(): string
  set value(v: unknown)
  get checked(): boolean
  set checked(c: unknown)
  disabled: boolean
}

/** Log in the JsDataflashParser shape FilterReview reads. */
export interface FakeLog {
  messageTypes: Record<string, { expressions: string[]; instances?: Record<string, unknown> }>
  get(name: string, field?: string): unknown
  get_instance(name: string, instance: string | number, field: string): unknown
  processData(): void
}

/** Plain description of a log: per message the field arrays, optionally per instance. */
export interface LogSpec {
  params?: Record<string, number>
  messages?: Record<string, Record<string, number[]>>
  instances?: Record<string, Record<string, Record<string, number[]>>>
}

/** A log with the parser interface, holding exactly the given data. */
export function fakeLog(spec: LogSpec): FakeLog {
  const messages: Record<string, Record<string, unknown>> = { ...(spec.messages ?? {}) }
  if (spec.params !== undefined) {
    messages['PARM'] = { Name: Object.keys(spec.params), Value: Object.values(spec.params) }
  }
  const messageTypes: FakeLog['messageTypes'] = {}
  for (const [name, fields] of Object.entries(messages)) messageTypes[name] = { expressions: Object.keys(fields) }
  for (const [name, insts] of Object.entries(spec.instances ?? {})) {
    const first = Object.values(insts)[0] ?? {}
    messageTypes[name] = {
      expressions: Object.keys(first),
      instances: Object.fromEntries(Object.keys(insts).map((k) => [k, {}]))
    }
  }
  return {
    messageTypes,
    get: (name, field) => (field === undefined ? messages[name] : messages[name]?.[field]),
    get_instance: (name, instance, field) => spec.instances?.[name]?.[String(instance)]?.[field],
    processData: () => undefined
  }
}

/** Handle on one upstream page. */
export interface UpstreamPage {
  /** Evaluate code in the page's global scope (sees its `let`/`const`/`class` declarations). */
  run(code: string): unknown
  /** Set a global visible to `run`. */
  set(name: string, value: unknown): void
  element(id: string): PageElement
  /** Messages passed to `alert`. */
  readonly alerts: string[]
  /** Run upstream `load()` as the file input does, with `log` as what the parser produces. */
  load(log: FakeLog): Promise<void>
  /** Run upstream `load_parameters()` with a file holding `text`. */
  loadParameters(text: string): Promise<void>
}

/** A fresh upstream FilterReview page, after the start-up index.html runs (`setup_plots(); reset()`). */
export function loadPage(): UpstreamPage {
  const elements = new Map<string, PageElement>()
  const groups = new Map<string, PageElement[]>()
  const make = (id: string, type: string, tagName: string, name: string, initial: string, checked: boolean): PageElement => {
    let value = initial
    let isChecked = checked
    const el = {
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
        else if (type === 'number') value = sanitizeNumber(text)
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
      min: 0,
      max: 0,
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
  for (const spec of pageInputs()) {
    if (spec.id in SELECTS) make(spec.id, 'select-one', 'SELECT', spec.name, spec.value, false)
    else make(spec.id, spec.type, 'INPUT', spec.name, spec.value, spec.checked)
  }
  const element = (id: string): PageElement => elements.get(id) ?? make(id, 'div', 'DIV', '', '', false)

  const alerts: string[] = []
  const noop = (): void => undefined
  const context = createContext({
    FFTJS: FFT,
    document: { getElementById: element, title: '' },
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
  const api = runInContext(pageSource(), context, { filename: 'upstream-filter-review.js' }) as {
    run: (code: string) => unknown
  }
  const run = (code: string): unknown => api.run(code)
  const set = (name: string, value: unknown): void => {
    ;(context as Record<string, unknown>)[name] = value
  }
  run('setup_plots(); reset()')

  return {
    run,
    set,
    element,
    alerts,
    load: async (log) => {
      set('__log', log)
      // `new DataflashParser()` yields the given log; its processData does nothing.
      run('DataflashParser = function () { return __log }')
      await (run('load(undefined)') as Promise<void>)
    },
    loadParameters: async (text) => {
      set('__file', { text: () => Promise.resolve(text) })
      await (run('load_parameters(__file)') as Promise<void>)
    }
  }
}

/** `n` evenly spaced values from `start` with step `step`. */
export function ramp(n: number, start: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step)
}
