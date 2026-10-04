// Test-only: the whole upstream FilterTool page (filters.js with Array_Math.js,
// ParameterMetadata.js and Param_Helpers.js) in a node:vm context, over a stub DOM built from
// upstream `index.html` and `params.json`. Unlike `upstream.ts`, which calls the filter maths
// directly, this runs the page functions (`calculate_filter`, `calculate_pid`, `load`,
// `load_parameters`, `save_parameters`, `update_all_hidden`) so the port's plots, files, links
// and visibility rules can be compared with what the page itself does.
//
// The stub models the two browser rules those functions rely on: a number input keeps only a
// valid floating-point number (else ""), and a <select> keeps only one of its option values
// (else ""). Parameters with `Values` metadata become selects when `finishMetadata()` is called,
// as `load_param_inputs` does when `params.json` arrives; `SCHED_LOOP_RATE` stays a number
// (`data-paramValues="false"`).
//
// Note: upstream's page does not load `Param_Helpers.js`, so its `save_parameters` throws
// `param_to_string is not defined`. The harness loads it to get the text the function builds.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { patchChainedSpread } from './chained-spread.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../../upstream')

const VALID_FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/

type Kind = 'number' | 'radio' | 'checkbox' | 'select' | 'other'

export class StubElement {
  kind: Kind
  /** Radios sharing this one's name in its form; checking one unchecks the others. */
  group: StubElement[] = []
  private isChecked = false
  disabled = false
  hidden = false
  innerHTML = ''
  options: readonly string[] | null = null
  readonly dataset: Record<string, string> = {}
  readonly parentElement = { querySelectorAll: () => [] }
  private raw = ''

  constructor(
    readonly id: string,
    readonly name: string,
    kind: Kind,
    value: string
  ) {
    this.kind = kind
    this.value = value
  }

  get checked(): boolean {
    return this.isChecked
  }

  set checked(v: boolean) {
    if (v && this.kind === 'radio') for (const other of this.group) other.isChecked = false
    this.isChecked = v
  }

  get type(): string {
    return this.kind === 'select' ? 'select-one' : this.kind
  }

  get value(): string {
    return this.raw
  }

  set value(v: unknown) {
    const text = String(v)
    if (this.kind === 'number') this.raw = VALID_FLOAT.test(text) ? text : ''
    else if (this.kind === 'select') this.raw = this.options!.includes(text) ? text : ''
    else this.raw = text
  }
}

interface FormModel {
  readonly elements: StubElement[]
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1]
}

function parseForm(html: string, id: string): FormModel {
  const start = html.indexOf(`<form id="${id}"`)
  const body = html.slice(start, html.indexOf('</form>', start))
  const elements: StubElement[] = []
  for (const m of body.matchAll(/<input ([^>]*)>/g)) {
    const a = m[1]!
    const type = attr(a, 'type')
    const kind: Kind = type === 'number' ? 'number' : type === 'radio' ? 'radio' : type === 'checkbox' ? 'checkbox' : 'other'
    const el = new StubElement(attr(a, 'id') ?? '', attr(a, 'name') ?? '', kind, attr(a, 'value') ?? '')
    el.checked = /(?:^|\s)checked(?:\s|\/|$)/.test(a)
    const pv = attr(a, 'data-paramValues')
    if (pv !== undefined) el.dataset.paramvalues = pv
    elements.push(el)
  }
  for (const e of elements) if (e.kind === 'radio') e.group = elements.filter((o) => o.kind === 'radio' && o.name === e.name)
  return { elements }
}

/** Upstream `ParameterMetadata.js` lookup in `params.json`. */
function findMetadata(tree: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  for (const [key, value] of Object.entries(tree)) {
    if (!name.startsWith(key)) continue
    if (key === name) return value as Record<string, unknown>
    const found = findMetadata(value as Record<string, unknown>, name)
    if (found) return found
  }
  return undefined
}

export interface UpstreamPage {
  readonly context: Record<string, unknown>
  el(id: string): StubElement
  /** `parseFloat` of an input, as `get_form` reads it. */
  read(id: string): number
  /** Convert `Values` parameters to selects, as `load_param_inputs` does once `params.json` loads. */
  finishMetadata(): void
  call(fn: string, ...args: unknown[]): unknown
  readonly saved: { name: string; text: string }[]
  readonly clipboard: string[]
  setHref(href: string): void
}

let sources: string | undefined

export interface PageOptions {
  /** Apply `patchChainedSpread` (the reference for the port's fix of the proven chained-spread bug). */
  fixChainedSpread?: boolean
}

export function loadUpstreamPage(options: PageOptions = {}): UpstreamPage {
  const html = readFileSync(resolve(upstreamDir, 'FilterTool/index.html'), 'utf8')
  const metadata = JSON.parse(readFileSync(resolve(upstreamDir, 'FilterTool/params.json'), 'utf8')) as Record<string, unknown>
  sources ??= ['Libraries/Array_Math.js', 'Libraries/ParameterMetadata.js', 'Libraries/Param_Helpers.js', 'FilterTool/filters.js']
    .map((f) => readFileSync(resolve(upstreamDir, f), 'utf8'))
    .join('\n;\n')

  const forms: Record<string, FormModel> = { params: parseForm(html, 'params'), PID_params: parseForm(html, 'PID_params') }
  const byId = new Map<string, StubElement>()
  for (const form of Object.values(forms)) for (const e of form.elements) if (e.id !== '') byId.set(e.id, e)
  const el = (id: string): StubElement => {
    let e = byId.get(id)
    if (e === undefined) {
      e = new StubElement(id, '', 'other', '')
      byId.set(id, e)
    }
    return e
  }
  const known = (id: unknown): StubElement | null => (typeof id === 'string' ? (byId.get(id) ?? null) : null)
  // Containers and labels the page writes to.
  for (const id of ['PID_title', 'Throttle_input', 'ESC_input', 'RPM_input', 'Bode', 'BodePID']) el(id)

  const formApi = (form: FormModel) => ({
    getElementsByTagName: (tag: string) =>
      form.elements.filter((e) =>
        tag === '*' ? true : tag === 'select' ? e.kind === 'select' : tag === 'input' ? e.kind !== 'select' : false
      ),
    querySelectorAll: () => form.elements
  })

  const saved: { name: string; text: string }[] = []
  const clipboard: string[] = []
  const location = { href: 'https://example.org/FilterTool/' }
  const noop = () => undefined
  const context = createContext({
    document: {
      getElementById: known,
      forms: { params: formApi(forms.params!), PID_params: formApi(forms.PID_params!) },
      cookie: ''
    },
    window: { location },
    navigator: { clipboard: { writeText: (t: string) => clipboard.push(t) } },
    URL,
    performance: { now: () => 0 },
    console: { log: noop },
    Plotly: { purge: noop, newPlot: noop, redraw: noop },
    link_plot_axis_range: noop,
    Blob: class {
      constructor(readonly parts: string[]) {}
    },
    saveAs: (blob: { parts: string[] }, name: string) => saved.push({ name, text: blob.parts.join('') })
  }) as Record<string, unknown>
  runInContext(options.fixChainedSpread === true ? patchChainedSpread(sources) : sources, context, {
    filename: 'upstream-filter-tool-page.js'
  })

  return {
    context,
    el,
    read: (id) => parseFloat(el(id).value),
    finishMetadata: () => {
      for (const e of byId.values()) {
        if (e.kind !== 'number') continue
        const meta = findMetadata(metadata, e.id)
        if (meta === undefined || !('Values' in meta) || e.dataset.paramvalues === 'false') continue
        const value = e.value
        e.kind = 'select'
        e.options = Object.keys(meta.Values as Record<string, string>)
        e.value = value
      }
    },
    call: (fn: string, ...args: unknown[]) => (context[fn] as (...a: unknown[]) => unknown)(...args),
    saved,
    clipboard,
    setHref: (href) => {
      location.href = href
    }
  }
}
