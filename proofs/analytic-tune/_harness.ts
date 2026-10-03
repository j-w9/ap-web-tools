// Loads the original Analytic Tune page (AnalyticTune.js and the Libraries scripts its index.html
// includes, in that order, plus the page's inline script and its body onload handlers) into a
// node:vm context with a small DOM built from upstream's index.html. Element values follow the
// HTML specification's rules for the element kinds involved (number inputs, check boxes, file
// inputs, drop-downs), so `parameter_set_value`, `load_param_inputs` and the page code run
// unmodified. The log parser is replaced by a fake that serves arrays given by the test.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import FFT from 'fft.js'

const here = dirname(fileURLToPath(import.meta.url))
export const upstreamDir = resolve(here, '../../upstream')

export type Pair = [number[], number[]]

/** One fake log: message name -> field name -> values. */
export type FakeLog = Record<string, Record<string, readonly (number | string)[]>>

/** HTML "valid floating-point number" grammar, which a number input's value must match. */
function isValidFloatingPointNumber(text: string): boolean {
  return /^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/.test(text)
}

/** Minimal DOM element. */
class El {
  readonly tagName: string
  readonly attributes = new Map<string, string>()
  children: El[] = []
  parentElement: El | null = null
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  classList = { contains: (): boolean => false }
  labels = [{ style: {}, nextSibling: null }]
  innerHTML = ''
  name = ''
  checked = false
  disabled = false
  hidden = false
  onchange: unknown = null
  onclick: unknown = null
  nextSibling = null
  private stored = ''
  private hasStored = false

  constructor(
    private readonly doc: MiniDocument,
    tagName: string
  ) {
    this.tagName = tagName.toUpperCase()
  }

  get nodeName(): string {
    return this.tagName
  }

  get id(): string {
    return this.attributes.get('id') ?? ''
  }

  get type(): string {
    return (this.attributes.get('type') ?? (this.tagName === 'INPUT' ? 'text' : '')).toLowerCase()
  }

  get htmlFor(): string | undefined {
    return this.tagName === 'LABEL' ? (this.attributes.get('for') ?? '') : undefined
  }

  /** Option elements of a drop-down. */
  private options(): El[] {
    return this.children.filter((c) => c.tagName === 'OPTION')
  }

  get value(): string {
    if (this.tagName === 'SELECT') {
      // A drop-down's value is that of its selected option, or "" when none is selected.
      const selected = this.options().find((o) => o.checked)
      return selected === undefined ? '' : (selected.attributes.get('value') ?? '')
    }
    if (this.tagName === 'INPUT' && (this.type === 'checkbox' || this.type === 'radio') && !this.hasStored) {
      // Default value of a check box or radio button without a value attribute.
      return this.attributes.get('value') ?? 'on'
    }
    return this.hasStored ? this.stored : (this.attributes.get('value') ?? '')
  }

  set value(v: unknown) {
    const text = String(v)
    if (this.tagName === 'SELECT') {
      // Setting a drop-down's value selects the first option with that value and deselects all
      // others; with no such option nothing is selected.
      let found = false
      for (const o of this.options()) {
        o.checked = !found && o.attributes.get('value') === text
        if (o.checked) found = true
      }
      return
    }
    if (this.tagName === 'INPUT' && this.type === 'file') {
      // A file input may only be set to the empty string; anything else throws.
      if (text !== '') throw new Error('InvalidStateError: a file input may only be set to the empty string')
      return
    }
    this.hasStored = true
    this.stored = this.tagName === 'INPUT' && this.type === 'number' && !isValidFloatingPointNumber(text) ? '' : text
  }

  setAttribute(name: string, value: unknown): void {
    const text = String(value)
    this.attributes.set(name, text)
    if (name === 'id') this.doc.register(this)
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
      this.dataset[key] = text
    }
  }

  appendChild(child: El): El {
    child.parentElement = this
    this.children.push(child)
    // A drop-down with no selected option selects its first option when options are added.
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && !this.options().some((o) => o.checked)) {
      child.checked = true
    }
    return child
  }

  insertBefore(child: El, ref: El): El {
    child.parentElement = this
    const i = this.children.indexOf(ref)
    this.children.splice(i < 0 ? this.children.length : i, 0, child)
    return child
  }

  removeChild(child: El): El {
    this.children = this.children.filter((c) => c !== child)
    child.parentElement = null
    this.doc.unregister(child)
    return child
  }

  replaceChildren(...children: (El | undefined)[]): void {
    this.children = children.filter((c): c is El => c !== undefined)
  }

  addEventListener(): void {
    // Events are not dispatched in these reproductions.
  }

  /** Plotly's event registration on a plot element. */
  on(): void {
    // Plot events are not dispatched in these reproductions.
  }

  /** All descendants in tree order. */
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()])
  }

  querySelectorAll(selector: string): El[] {
    const m = /^(\w+)\[type=(\w+)\]$/.exec(selector)
    if (m === null) throw new Error(`Unsupported selector ${selector}`)
    const tag = (m[1] ?? '').toUpperCase()
    const type = m[2] ?? ''
    return this.descendants().filter((e) => e.tagName === tag && e.type === type)
  }

  getElementsByTagName(tag: string): El[] {
    return this.descendants().filter((e) => tag === '*' || e.tagName === tag.toUpperCase())
  }
}

/** Document: every element of index.html that has an id, each in its own paragraph, in source order. */
class MiniDocument {
  readonly byId = new Map<string, El>()
  readonly root: El
  readonly forms: Record<string, El> = {}

  constructor(html: string) {
    this.root = new El(this, 'body')
    let form: El = this.root
    for (const m of html.matchAll(/<(\/?)(\w+)\b([^>]*)>/g)) {
      const closing = m[1] ?? ''
      const tag = m[2] ?? ''
      const attrs = m[3] ?? ''
      if (tag === 'form') {
        if (closing === '/') {
          form = this.root
        } else {
          form = new El(this, 'form')
          this.root.appendChild(form)
          const id = /\bid="([^"]*)"/.exec(attrs)?.[1]
          if (id !== undefined) this.forms[id] = form
        }
        continue
      }
      if (closing === '/') continue
      const id = /\bid=["']([^"']*)["']/.exec(attrs)?.[1]
      if (id === undefined) continue
      const e = new El(this, tag)
      for (const a of attrs.matchAll(/([\w-]+)=["']([^"']*)["']/g)) e.setAttribute(a[1]!, a[2]!)
      e.name = e.attributes.get('name') ?? ''
      e.checked = /\schecked\b/.test(attrs)
      const p = new El(this, 'p')
      form.appendChild(p)
      p.appendChild(e)
    }
  }

  register(e: El): void {
    this.byId.set(e.id, e)
  }

  unregister(e: El): void {
    if (this.byId.get(e.id) === e) this.byId.delete(e.id)
  }

  getElementById(id: string): El | null {
    return this.byId.get(id) ?? null
  }

  getElementsByTagName(tag: string): El[] {
    return this.root.getElementsByTagName(tag)
  }

  createElement(tag: string): El {
    return new El(this, tag)
  }

  createTextNode(text: unknown): El {
    const node = new El(this, '#text')
    node.innerHTML = String(text)
    return node
  }
}

/** The page's global state and functions, as the test reaches them. */
export interface Page {
  /** Evaluate code in the page's global scope. */
  run(code: string): unknown
  /** Set a global visible to `run`. */
  set(name: string, value: unknown): void
  /** Element value as the page reads it. */
  value(id: string): string
  setValue(id: string, value: string): void
  setChecked(id: string, checked: boolean): void
  hasElement(id: string): boolean
  /** File name and text of the last `saveAs` call. */
  saved(): { name: string; text: string } | undefined
}

function read(path: string): string {
  return readFileSync(resolve(upstreamDir, path), 'utf8')
}

/** The page's inline script (the last `<script>` block of index.html). */
function inlineScript(html: string): string {
  const start = html.lastIndexOf('<script>')
  return html.slice(start + '<script>'.length, html.indexOf('</script>', start))
}

/** Fake `DataflashParser`: `processData` takes the FakeLog object itself. */
const fakeParserSource = `
DataflashParser = class {
  processData(data) {
    this.data = data
    this.messageTypes = {}
    for (const name of Object.keys(data)) this.messageTypes[name] = {}
  }
  get(msg, field) {
    if (field === undefined) return this.data[msg]
    return this.data[msg][field]
  }
}`

/**
 * Load a fresh page, with parameter metadata loaded and the body onload handlers run. `patch`
 * edits AnalyticTune.js before it runs; it is used only to show the output of a proposed fix.
 */
export async function loadPage(patch: (source: string) => string = (s) => s): Promise<Page> {
  const html = read('AnalyticTune/index.html')
  const doc = new MiniDocument(html)
  let saved: { name: string; text: string } | undefined
  const metadata = read('AnalyticTune/params.json')
  const context = createContext({
    document: doc,
    window: { addEventListener: () => undefined, location: { href: 'https://example.invalid/AnalyticTune/' } },
    Plotly: { purge: () => undefined, newPlot: () => undefined, redraw: () => undefined },
    FFTJS: FFT,
    alert: (msg: string) => {
      throw new Error(`alert: ${msg}`)
    },
    console: { log: () => undefined },
    performance: { now: () => 0 },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(JSON.parse(metadata) as unknown) }),
    Blob: class {
      readonly text: string
      constructor(parts: string[]) {
        this.text = parts.join('')
      }
    },
    saveAs: (blob: { text: string }, name: string) => {
      saved = { name, text: blob.text }
    }
  })
  // Script order of index.html; FileSaver, OpenIn, LoadingOverlay and LogHelpers define nothing these
  // reproductions use. The page's dynamic import of the parser is replaced by the fake parser.
  const scripts = [
    patch(read('AnalyticTune/AnalyticTune.js').replace(/^import\(.*$/m, '')),
    read('Libraries/Array_Math.js'),
    read('Libraries/ParameterMetadata.js'),
    read('Libraries/Param_Helpers.js'),
    read('Libraries/Plotly_helpers.js'),
    read('Libraries/fft.js'),
    fakeParserSource,
    inlineScript(html)
  ]
  scripts.forEach((s, i) => {
    runInContext(s, context, { filename: `analytic-tune-${i}.js` })
  })
  // Let the metadata fetch resolve (drop-downs and bitmask check boxes are created), then onload.
  await new Promise((r) => setImmediate(r))
  runInContext('load(); update_all_hidden(); setup_plots();', context)
  const element = (id: string): El => {
    const e = doc.getElementById(id)
    if (e === null) throw new Error(`No element ${id}`)
    return e
  }
  return {
    run: (code): unknown => runInContext(code, context) as unknown,
    set: (name, value) => {
      ;(context as Record<string, unknown>)[name] = value
    },
    value: (id) => element(id).value,
    setValue: (id, value) => {
      element(id).value = value
    },
    setChecked: (id, checked) => {
      element(id).checked = checked
    },
    hasElement: (id) => doc.getElementById(id) !== null,
    saved: () => saved
  }
}

/** Run `fn` and return the error it throws (or rejects with) as text, e.g. "TypeError: ...". */
export async function thrown(fn: () => unknown): Promise<string> {
  try {
    await fn()
  } catch (e) {
    // Errors thrown in the vm context are not instances of this realm's Error.
    return String(e)
  }
  throw new Error('expected a throw')
}

/** Evenly spaced microsecond time stamps: `n` samples at `rateHz` starting at `startS` seconds. */
export function timesUs(n: number, rateHz: number, startS = 0): number[] {
  return Array.from({ length: n }, (_, i) => Math.round((startS + i / rateHz) * 1e6))
}

/** Constant array of length `n`. */
export function fill(n: number, v: number): number[] {
  return new Array<number>(n).fill(v)
}
