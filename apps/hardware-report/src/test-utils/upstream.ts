// Test-only: runs the vendored upstream HardwareReport.js (with DecodeDevID.js, Array_Math.js,
// Param_Helpers.js and LogHelpers.js) in a vm context against a small fake DOM, backed by the
// upstream JsDataflashParser, so the port can be compared on identical inputs.
//
// The fake DOM records what upstream renders: every element keeps its children, attributes and
// text, `getElementById` finds static (index.html) and dynamically created elements, Plotly calls
// store their data and layout on the element, and `saveAs`/`alert` calls are captured.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')

/** One fake DOM node. Text nodes have `nodeName === '#text'`. */
export class FakeElement {
  id = ''
  hidden = false
  checked = false
  disabled = false
  value = ''
  title = ''
  href = ''
  className = ''
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, (() => void)[]>()
  parentElement: FakeElement | null = null
  /** Plotly data and layout, set by the Plotly stub. */
  data: unknown
  layout: unknown
  private ownText = ''
  private prev: FakeElement | undefined

  constructor(
    readonly nodeName: string,
    private readonly dom: FakeDom,
    text = ''
  ) {
    this.ownText = text
  }

  get tagName(): string {
    return this.nodeName.toUpperCase()
  }

  get childNodes(): FakeElement[] {
    return this.children
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null
  }

  get lastChild(): FakeElement | null {
    return this.children[this.children.length - 1] ?? null
  }

  /** Concatenated text of this node and its descendants. */
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('')
  }

  set textContent(text: string) {
    this.children.length = 0
    this.ownText = text
  }

  get innerHTML(): string {
    return this.textContent
  }

  set innerHTML(html: string) {
    this.textContent = html
  }

  get innerText(): string {
    return this.textContent
  }

  set innerText(text: string) {
    this.textContent = text
  }

  private labelEl: FakeElement | undefined

  /** The `<label for>` of an input. */
  get labels(): FakeElement[] {
    this.labelEl ??= new FakeElement('label', this.dom)
    return [this.labelEl]
  }

  /** A stand-in for the static sibling (the section header) upstream toggles with the element. */
  get previousElementSibling(): FakeElement {
    this.prev ??= new FakeElement('div', this.dom)
    return this.prev
  }

  readonly classList = {
    add: (...names: string[]) => {
      this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ')
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(' ')
        .filter((c) => c !== '' && !names.includes(c))
        .join(' ')
    },
    contains: (name: string) => this.className.split(' ').includes(name),
    toggle: (name: string) => {
      if (this.classList.contains(name)) this.classList.remove(name)
      else this.classList.add(name)
    }
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value))
    if (name === 'id') {
      this.id = String(value)
      this.dom.register(this)
    }
    if (name === 'checked') this.checked = true
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  appendChild<T extends FakeElement>(child: T): T {
    // As in the DOM, a node has one parent: appending moves it.
    child.parentElement?.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    if (child.id !== '') this.dom.register(child)
    return child
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? this.dom.createTextNode(n) : n)
  }

  insertBefore<T extends FakeElement>(child: T, ref: FakeElement | null): T {
    child.parentElement?.removeChild(child)
    const at = ref === null ? -1 : this.children.indexOf(ref)
    child.parentElement = this
    if (at === -1) this.children.push(child)
    else this.children.splice(at, 0, child)
    return child
  }

  removeChild<T extends FakeElement>(child: T): T {
    const at = this.children.indexOf(child)
    if (at !== -1) this.children.splice(at, 1)
    child.parentElement = null
    return child
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const c of this.children) c.parentElement = null
    this.children.length = 0
    this.ownText = ''
    for (const n of nodes) this.appendChild(n)
  }

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  /** Fire the listeners registered for `type` (e.g. a download link's `click`). */
  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }

  getElementsByTagName(tag: string): FakeElement[] {
    const out: FakeElement[] = []
    const walk = (e: FakeElement): void => {
      for (const c of e.children) {
        if (c.nodeName.toLowerCase() === tag.toLowerCase()) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }

  querySelectorAll(): FakeElement[] {
    return []
  }

  querySelector(): FakeElement | null {
    return null
  }
}

/** Element registry and factory backing `document`. */
export class FakeDom {
  readonly byId = new Map<string, FakeElement>()
  readonly forms: Record<string, FakeElement> = {}
  title = ''

  /** Build the static `params` form of index.html: its checkbox inputs, in page order. */
  constructor(indexHtml: string) {
    const form = this.getElementById('params')
    const body = /<form id="params"[\s\S]*?<\/form>/.exec(indexHtml)?.[0] ?? ''
    for (const tag of body.match(/<input[^>]*>/g) ?? []) {
      const input = this.createElement('input')
      input.setAttribute('type', /type="(\w+)"/.exec(tag)?.[1] ?? 'text')
      input.setAttribute('id', /id="([\w-]+)"/.exec(tag)?.[1] ?? '')
      if (/\schecked\b/.test(tag)) input.checked = true
      form.appendChild(input)
    }
  }

  register(el: FakeElement): void {
    this.byId.set(el.id, el)
    if (el.nodeName === 'form') this.forms[el.id] = el
  }

  getElementById(id: string): FakeElement {
    let el = this.byId.get(id)
    if (el === undefined) {
      // Static element from index.html: created on first access.
      el = new FakeElement(id === 'params' ? 'form' : 'div', this)
      el.id = id
      this.register(el)
      // Static elements sit in a container (upstream hides plots through `parentElement`).
      new FakeElement('div', this).appendChild(el)
    }
    return el
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag.toLowerCase(), this)
  }

  createTextNode(text: unknown): FakeElement {
    return new FakeElement('#text', this, String(text))
  }
}

/** A file upstream offered for download with `saveAs`. */
export interface SavedFile {
  readonly name: string
  readonly parts: readonly unknown[]
}

/** The upstream page running in a vm context. */
export interface UpstreamHardwareReport {
  readonly dom: FakeDom
  readonly saved: SavedFile[]
  readonly alerts: string[]
  /** Evaluate an expression in the upstream context (e.g. `'ins'`, `'Temperature.data'`). */
  get(expression: string): unknown
  /** Call an upstream global function with `args` and return its result. */
  call(name: string, ...args: unknown[]): unknown
  /** Run upstream `reset()` then `load_log(buffer)` (async upstream). */
  loadLog(bytes: Uint8Array): Promise<void>
  /** Run upstream `reset()` then `load_param_file(text)`. */
  loadParamFile(text: string): void
}

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

/** Copy into a standalone ArrayBuffer, as FileReader hands it to upstream. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength)
  out.set(bytes)
  return out.buffer
}

let parserClass: unknown

/**
 * Create a fresh upstream Hardware Report page. Each call gets its own context, so upstream's
 * global state (`params`, `ins`, plots, ...) never leaks between tests.
 */
export async function createUpstreamHardwareReport(): Promise<UpstreamHardwareReport> {
  if (parserClass === undefined) {
    if (!('self' in globalThis)) {
      Reflect.set(globalThis, 'self', { addEventListener: () => undefined, postMessage: () => undefined })
    }
    const mod: { default: unknown } = await import(
      /* @vite-ignore */ resolve(root, 'upstream/modules/JsDataflashParser/parser.js')
    )
    parserClass = mod.default
  }

  const dom = new FakeDom(read('upstream/HardwareReport/index.html'))
  const saved: SavedFile[] = []
  const alerts: string[] = []
  const plotly = {
    newPlot: (el: FakeElement, data: unknown, layout: unknown) => {
      el.data = data
      el.layout = layout
    },
    purge: () => undefined,
    redraw: () => undefined,
    relayout: () => undefined
  }

  // Drop the module-level side effects that need a browser: dynamic imports, the page load
  // hook (its `initial_load()` is run below) and the canvas patch. Everything else is evaluated verbatim.
  const page = read('upstream/HardwareReport/HardwareReport.js')
    .replace(/^import_done\[0\] = import\(.*$/m, '')
    .replace(/^import_done\[1\] = import\([\s\S]*?\.catch\(error => console\.log\(error\)\)$/m, '')
    .replace(/^import_done\[2\] = new Promise\([\s\S]*?^\}\)$/m, '')
    .replace(/^configurePlotlyCanvas\(\)$/m, '')

  const source = [
    read('upstream/Libraries/DecodeDevID.js'),
    read('upstream/Libraries/Array_Math.js'),
    read('upstream/Libraries/Param_Helpers.js'),
    read('upstream/Libraries/LogHelpers.js'),
    page
  ].join('\n;\n')

  const context: Context = createContext({
    DataflashParser: parserClass,
    document: dom,
    window: { addEventListener: () => undefined },
    Plotly: plotly,
    Blob: class {
      constructor(readonly parts: unknown[]) {}
    },
    saveAs: (blob: { parts: unknown[] }, name: string) => saved.push({ name, parts: blob.parts }),
    alert: (msg: unknown) => alerts.push(String(msg)),
    performance: { now: () => 0 },
    open_in_update: () => undefined,
    // Only the page's own board_types.txt is fetched (upstream `initial_load`); served from disk.
    fetch: (url: string) =>
      url === 'board_types.txt'
        ? Promise.resolve({ text: () => Promise.resolve(read('upstream/HardwareReport/board_types.txt')) })
        : Promise.reject(new Error(`no network in tests: ${url}`)),
    console: { log: () => undefined, error: () => undefined, warn: () => undefined }
  })
  runInContext(source, context, { filename: 'upstream-hardware-report.js' })
  // The GitHub release check needs the network: keep the original reachable for tests that stub
  // `octokitRequest`, and make the one `load_log` calls a no-op.
  runInContext('var check_release_original = check_release; check_release = async function () {}', context)
  // The page runs `initial_load()` (the board names) on window load, before any file is opened.
  await (runInContext('initial_load()', context) as Promise<void>)

  const get = (expression: string): unknown => runInContext(`(${expression})`, context)
  const call = (name: string, ...args: unknown[]): unknown => {
    context['__args'] = args
    return runInContext(`${name}(...__args)`, context)
  }
  return {
    dom,
    saved,
    alerts,
    get,
    call,
    async loadLog(bytes) {
      call('reset')
      await call('load_log', toArrayBuffer(bytes))
    },
    loadParamFile(text) {
      call('reset')
      call('load_param_file', text)
    }
  }
}

/** Path of a shared DataFlash fixture. */
export function fixturePath(name: string): string {
  return resolve(root, 'packages/dataflash/test-fixtures', name)
}
