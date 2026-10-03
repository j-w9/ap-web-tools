// Runs the original SysID page (upstream/SysID/index.html's inline script, SysID.js and
// Libraries/Array_Math.js) in node:vm against a small DOM that keeps index.html's element order,
// with the upstream JsDataflashParser and a fake Pyodide that records what is handed to Python.
// Loader lines adapted from apps/sysid/src/test-utils/upstream.ts (copied, not imported).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
export const upstreamDir = resolve(here, '../../upstream')

export function upstreamText(path: string): string {
  return readFileSync(resolve(upstreamDir, path), 'utf8')
}

type Listener = (this: El) => unknown

/** A DOM element with only what the SysID page uses. Lookups walk the tree in document order. */
export class El {
  readonly tagName: string
  id = ''
  name = ''
  type = ''
  checked = false
  disabled = false
  text = ''
  htmlFor = ''
  textContent = ''
  style: Record<string, string> = {}
  children: El[] = []
  parent: El | null = null
  onchange: (() => void) | null = null
  private listeners = new Map<string, Listener[]>()
  private rawValue = ''
  private selected = -1
  /** Every value written to `value`, in order (used to see text that was later wiped). */
  readonly writes: string[] = []

  constructor(tagName: string, id = '') {
    this.tagName = tagName.toUpperCase()
    this.id = id
  }

  get value(): string {
    if (this.tagName !== 'SELECT') return this.rawValue
    const options = this.children.filter((c) => c.tagName === 'OPTION')
    const index = this.selected === -1 && options.length > 0 ? 0 : this.selected
    return index >= 0 && index < options.length ? options[index]!.value : ''
  }

  set value(v: unknown) {
    const s = String(v)
    this.writes.push(s)
    if (this.tagName !== 'SELECT') {
      this.rawValue = s
      return
    }
    // HTML: setting a select's value to one no option has leaves no option selected.
    const options = this.children.filter((c) => c.tagName === 'OPTION')
    const index = options.findIndex((o) => o.value === s)
    this.selected = index === -1 ? -2 : index
  }

  set innerHTML(_html: string) {
    for (const c of this.children) c.parent = null
    this.children = []
    this.selected = -1
  }

  get firstElementChild(): El | null {
    return this.children[0] ?? null
  }

  appendChild(child: El): El {
    child.parent = this
    this.children.push(child)
    return child
  }

  replaceChildren(...nodes: (El | null)[]): void {
    this.innerHTML = ''
    for (const n of nodes) if (n) this.appendChild(n)
  }

  insertRow(): El {
    return this.appendChild(new El('tr'))
  }

  insertCell(): El {
    return this.appendChild(new El('td'))
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0
  }

  /** Run the listeners for `type` synchronously; returns their results (promises for async ones). */
  dispatch(type: string): unknown[] {
    return (this.listeners.get(type) ?? []).map((fn) => fn.call(this))
  }

  /** Plotly's `on`, used on the FlightData div. */
  on(): void {}

  *walk(): Generator<El> {
    for (const c of this.children) {
      yield c
      yield* c.walk()
    }
  }

  querySelectorAll(selector: string): El[] {
    return [...this.walk()].filter((e) => e.tagName === selector.toUpperCase())
  }

  querySelector(selector: string): El | null {
    // `#matrixA input[name=matrixA_r0_c0]`
    const cell = /^#(\S+) input\[name=([^\]]+)\]$/.exec(selector)
    if (cell) {
      const [, table, name] = cell
      const scope = [...this.walk()].find((e) => e.id === table)
      return scope ? ([...scope.walk()].find((e) => e.tagName === 'INPUT' && e.name === name) ?? null) : null
    }
    // `select[id= output_field_1]`
    const select = /^select\[id= ?([^\]]+)\]$/.exec(selector)
    if (select) return [...this.walk()].find((e) => e.tagName === 'SELECT' && e.id === select[1]) ?? null
    throw new Error(`unsupported selector ${selector}`)
  }
}

/** The elements of upstream/SysID/index.html that the scripts touch, in document order. */
function buildBody(): El {
  const body = new El('body')
  const ids: [string, string, string?][] = [
    ['input', 'starttime', '0'], // index.html:53
    ['input', 'endtime', '0'], // index.html:55
    ['input', 'fileItem'], // index.html:60
    ['div', 'FlightData'], // index.html:73
    ['textarea', 'output'], // index.html:77
    ['input', 'tf_select'], // index.html:82
    ['input', 'ss_select'] // index.html:85
  ]
  for (const [tag, id, value] of ids) {
    const e = body.appendChild(new El(tag, id))
    if (value !== undefined) e.value = value
  }
  const tf = body.appendChild(new El('div', 'tf_form')) // index.html:91
  for (const [tag, id] of [
    ['div', 'tf_inputFieldsContainer'], // index.html:93
    ['div', 'tf_outputFieldsContainer'], // index.html:96
    ['input', 'customNumerator'], // index.html:100
    ['input', 'customDenominator'], // index.html:103
    ['input', 'tf_params'], // index.html:106
    ['div', 'plotDiv'] // index.html:108
  ] as const)
    tf.appendChild(new El(tag, id))
  const ss = body.appendChild(new El('div', 'ss_form')) // index.html:113
  for (const [tag, id] of [
    ['div', 'autopopulateContainer'],
    ['input', 'num_Outputs'],
    ['input', 'A_order'],
    ['input', 'num_params'],
    ['input', 'num_cons'],
    ['button', 'createFieldsButton'],
    ['div', 'inputFieldsContainer'],
    ['div', 'outputFieldsContainer'],
    ['div', 'symbolicparams'],
    ['div', 'boundsContainer'],
    ['div', 'matrixAlabel'],
    ['table', 'matrixA'],
    ['div', 'matrixBlabel'],
    ['table', 'matrixB'],
    ['div', 'constraintsinput'],
    ['div', 'H0label'],
    ['table', 'H0'],
    ['div', 'H1label'],
    ['table', 'H1'],
    ['div', 'plotDiv_ss']
  ] as const)
    ss.appendChild(new El(tag, id)) // index.html:115-165
  for (const id of ['startfreq', 'endfreq', 'cutofffreq']) body.appendChild(new El('input', id)) // index.html:170-176
  body.appendChild(new El('button', 'parseButton')).disabled = true // index.html:178
  return body
}

export interface PyodideCall {
  /** Globals passed to `pyodide.globals.set`, copied into this realm. */
  globals: Record<string, unknown>
  /** Python sources passed to `runPython`. */
  python: string[]
}

function toRealm(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { length?: unknown }).length === 'number') {
    return Array.from(value as ArrayLike<unknown>, toRealm)
  }
  return value
}

export interface Page {
  body: El
  byId(id: string): El
  /** Every element with this id, in document order. */
  allById(id: string): El[]
  alerts: string[]
  /** Load a log as `readFile` does (SysID.js `load`). */
  load(bytes: Uint8Array): void
  /** Select a model type radio as a click does: only the newly checked radio fires `change`. */
  choose(kind: 'tf' | 'ss'): void
  /** Upstream's `run_transfer_function_ID(log)` / `run_SS_ID(log)`, as the Submit handler calls them. */
  submit(kind: 'tf' | 'ss'): Promise<PyodideCall>
  /** Upstream `populate_log_message_select` message list (options of a message select). */
  options(select: El): string[]
}

export interface ParserCtor {
  new (sendPostMessage: boolean): {
    processData(buffer: ArrayBuffer, msgs: string[]): unknown
    messageTypes: Record<string, { expressions: string[]; instances?: Record<string, string> }>
    get(name: string, field: string): unknown
  }
}

export async function upstreamParserCtor(): Promise<ParserCtor> {
  const g = globalThis as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ resolve(upstreamDir, 'modules/JsDataflashParser/parser.js'))) as {
    default: ParserCtor
  }
  return mod.default
}

/** Load the page: Array_Math.js, SysID.js, then index.html's inline script, in a shared vm context. */
export async function loadPage(): Promise<Page> {
  const Parser = await upstreamParserCtor()
  const body = buildBody()
  const all = (id: string) => [...body.walk()].filter((e) => e.id === id)
  const byId = (id: string) => {
    const e = all(id)[0]
    if (!e) throw new Error(`no element ${id}`)
    return e
  }
  const alerts: string[] = []
  let call: PyodideCall = { globals: {}, python: [] }
  const pyodide = {
    globals: {
      set: (name: string, value: unknown) => {
        call.globals[name] = toRealm(value)
      },
      get: () => []
    },
    runPython: (src: string) => {
      call.python.push(src)
    }
  }
  const document = {
    getElementById: (id: string) => all(id)[0] ?? null,
    createElement: (tag: string) => new El(tag),
    querySelector: (selector: string) => body.querySelector(selector)
  }
  const quietParser = class extends Parser {
    override processData(buffer: ArrayBuffer, msgs: string[]) {
      const log = console.log
      console.log = () => undefined
      try {
        return super.processData(buffer, msgs)
      } finally {
        console.log = log
      }
    }
  }
  const context = createContext({
    document,
    console: { log: () => undefined, error: () => undefined },
    alert: (text: string) => alerts.push(text),
    // init_pyodide awaits this forever; the tests install the recording fake below instead.
    loadPyodide: () => new Promise(() => undefined),
    Plotly: { purge: () => undefined, newPlot: () => undefined, redraw: () => undefined },
    FileReader: function FileReader() {},
    DataflashParser: undefined
  })
  const sysid = upstreamText('SysID/SysID.js').replace(/^import\(.*$/m, '// dynamic parser import removed')
  const html = upstreamText('SysID/index.html')
  const inline = /<script type="text\/javascript">\n([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (inline === undefined) throw new Error('inline script not found in index.html')
  runInContext(upstreamText('Libraries/Array_Math.js'), context, { filename: 'Array_Math.js' })
  runInContext(sysid, context, { filename: 'SysID.js' })
  runInContext(inline, context, { filename: 'index.html' })
  runInContext(
    'globalThis.__hooks = { setPyodide: (p) => { pyodide = p }, setParser: (c) => { DataflashParser = c }, log: () => log }',
    context
  )
  const ctx = context as Record<string, unknown>
  const hooks = ctx['__hooks'] as {
    setPyodide(p: unknown): void
    setParser(c: unknown): void
    log(): unknown
  }
  // Let main()'s synchronous part finish (it is async but has no await before its handlers).
  await Promise.resolve()
  hooks.setPyodide(pyodide)
  hooks.setParser(quietParser)

  return {
    body,
    byId,
    allById: all,
    alerts,
    load: (bytes) => (ctx['load'] as (b: ArrayBuffer) => void)(bytes.slice().buffer),
    choose: (kind) => {
      const on = byId(kind === 'tf' ? 'tf_select' : 'ss_select')
      const off = byId(kind === 'tf' ? 'ss_select' : 'tf_select')
      off.checked = false
      on.checked = true
      on.dispatch('change')
    },
    submit: async (kind) => {
      call = { globals: {}, python: [] }
      const fn = ctx[kind === 'tf' ? 'run_transfer_function_ID' : 'run_SS_ID'] as (log: unknown) => Promise<void>
      await fn(hooks.log())
      return call
    },
    options: (select) => select.children.map((o) => o.value)
  }
}

/** Minimal DataFlash writer: FMT, FMTU and data messages with the format characters used here. */
export class LogBytes {
  private parts: number[] = []
  private formats = new Map<string, { id: number; format: string }>()

  private push(id: number, format: string, values: (number | string)[]): void {
    const bytes: number[] = [0xa3, 0x95, id]
    const view = new DataView(new ArrayBuffer(8))
    format.split('').forEach((c, i) => {
      const v = values[i]!
      const str = (len: number) => {
        const s = String(v)
        for (let k = 0; k < len; k++) bytes.push(k < s.length ? s.charCodeAt(k) : 0)
      }
      switch (c) {
        case 'B':
          bytes.push(Number(v) & 0xff)
          break
        case 'f':
          view.setFloat32(0, Number(v), true)
          for (let k = 0; k < 4; k++) bytes.push(view.getUint8(k))
          break
        case 'Q':
          view.setBigUint64(0, BigInt(Number(v)), true)
          for (let k = 0; k < 8; k++) bytes.push(view.getUint8(k))
          break
        case 'n':
          str(4)
          break
        case 'N':
          str(16)
          break
        case 'Z':
          str(64)
          break
        default:
          throw new Error(`format ${c} not supported`)
      }
    })
    this.parts.push(...bytes)
  }

  constructor() {
    this.push(128, 'BBnNZ', [128, 89, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns'])
  }

  define(id: number, name: string, format: string, columns: string): this {
    const size: Record<string, number> = { B: 1, f: 4, Q: 8, n: 4, N: 16, Z: 64 }
    const length = 3 + format.split('').reduce((a, c) => a + size[c]!, 0)
    this.formats.set(name, { id, format })
    this.push(128, 'BBnNZ', [id, length, name, format, columns])
    return this
  }

  write(name: string, values: (number | string)[]): this {
    const f = this.formats.get(name)
    if (!f) throw new Error(`format ${name} not defined`)
    this.push(f.id, f.format, values)
    return this
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}
