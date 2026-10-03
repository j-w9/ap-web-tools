/**
 * Test-only: runs upstream AILogAnalyzer/logAnalyzer.js in `node:vm` on a minimal fake DOM, with a
 * fake of the v4 OpenAI SDK calls it makes answered by an in-process {@link FakeOpenAiServer}, and
 * the upstream JsDataflashParser. Loader lines adapted from the app's oracle harness
 * (apps/ai-log-analyzer/src/test-utils/upstream-analyzer.ts and fake-openai.ts). No request leaves
 * the process.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** One request as the API would see it; uploads are reduced to their fields. */
export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'DELETE'
  readonly path: string
  readonly body: Json
}

export interface StreamEvent {
  readonly event: string
  readonly data: Json
}

export interface ScriptedFailure {
  readonly method: ApiRequest['method']
  readonly path: RegExp
  readonly status: number
  readonly message: string
  /** How many matching requests fail (default: all). */
  times?: number
}

/** The error the SDK throws for an error response, reduced to what logAnalyzer.js reads. */
export class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(`${String(status)} ${message}`)
  }
}

type Response =
  { kind: 'json'; body: Json } | { kind: 'sse'; events: readonly StreamEvent[] } | { kind: 'error'; error: FakeApiError }

/** A local stand-in for the OpenAI REST API. */
export class FakeOpenAiServer {
  readonly log: ApiRequest[] = []
  assistants: { id: string; name: string | null }[] = []
  files: { id: string; filename: string }[] = []
  /** One event list per run started (create, stream or submit_tool_outputs), in order. */
  runs: StreamEvent[][] = []
  failures: ScriptedFailure[] = []
  /** When set, `files.list` waits for this promise before answering. */
  holdFilesList: Promise<void> | null = null
  /** When true, `files.del` is logged but never answers (and the file is not removed). */
  holdDeletes = false
  private counters = { asst: 0, thread: 0, msg: 0, file: 0 }

  handle(request: ApiRequest): Response {
    this.log.push(request)
    const failure = this.failures.find((f) => f.method === request.method && f.path.test(request.path) && (f.times ?? 1) > 0)
    if (failure) {
      if (failure.times !== undefined) failure.times--
      return { kind: 'error', error: new FakeApiError(failure.status, failure.message) }
    }
    const { method, path } = request
    const ok = (body: Json): Response => ({ kind: 'json', body })
    const nextRun = (): Response => ({ kind: 'sse', events: this.runs.shift() ?? [] })
    let m: RegExpExecArray | null
    if (method === 'GET' && path === '/assistants') return ok({ object: 'list', data: this.assistants })
    if (method === 'POST' && path === '/assistants') {
      const id = `asst_${String(++this.counters.asst)}`
      this.assistants.push({ id, name: 'Log Analyzer' })
      return ok({ id, object: 'assistant', name: 'Log Analyzer' })
    }
    if (method === 'POST' && path === '/threads') return ok({ id: `thread_${String(++this.counters.thread)}`, object: 'thread' })
    if (method === 'POST' && /^\/threads\/[^/]+\/messages$/.test(path)) {
      return ok({ id: `msg_${String(++this.counters.msg)}`, object: 'thread.message' })
    }
    if (method === 'POST' && /^\/threads\/[^/]+\/runs$/.test(path)) return nextRun()
    if (method === 'POST' && /^\/threads\/[^/]+\/runs\/[^/]+\/submit_tool_outputs$/.test(path)) return nextRun()
    if (method === 'POST' && (m = /^\/threads\/[^/]+\/runs\/([^/]+)\/cancel$/.exec(path))) {
      return ok({ id: m[1] ?? '', object: 'thread.run', status: 'cancelling' })
    }
    if (method === 'GET' && path === '/files') return ok({ object: 'list', data: this.files })
    if (method === 'DELETE' && (m = /^\/files\/([^/]+)$/.exec(path))) {
      const id = m[1] ?? ''
      this.files = this.files.filter((f) => f.id !== id)
      return ok({ id, object: 'file', deleted: true })
    }
    if (method === 'POST' && path === '/files') {
      const id = `file_${String(++this.counters.file)}`
      this.files.push({ id, filename: 'output.json' })
      return ok({ id, object: 'file', filename: 'output.json', purpose: 'assistants' })
    }
    return { kind: 'error', error: new FakeApiError(404, `No route ${method} ${path}`) }
  }

  /** The `METHOD path` lines of the request log. */
  lines(): string[] {
    return this.log.map((r) => `${r.method} ${r.path}`)
  }

  /** Bodies of the requests whose path matches. */
  bodies(method: ApiRequest['method'], path: RegExp): Json[] {
    return this.log.filter((r) => r.method === method && path.test(r.path)).map((r) => r.body)
  }
}

/** A JSON round trip, which is what the SDK sends for a request body. */
function asJson(value: unknown): Json {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json)
}

// ------------------------------------------------------------------------------------ fake DOM

type Listener = (event: { preventDefault(): void }) => unknown

export class FakeElement {
  id = ''
  className = ''
  textContent: unknown = ''
  value = ''
  placeholder = ''
  disabled = false
  scrollTop = 0
  readonly scrollHeight = 0
  src = ''
  readonly style: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  children: FakeElement[] = []
  parent: FakeElement | null = null
  readonly listeners = new Map<string, Listener[]>()
  private html = ''
  readonly classList = {
    add: (...names: string[]) => {
      const set = new Set(this.classes())
      names.forEach((n) => set.add(n))
      this.className = [...set].join(' ')
    },
    remove: (...names: string[]) => {
      this.className = this.classes()
        .filter((c) => !names.includes(c))
        .join(' ')
    },
    contains: (name: string) => this.classes().includes(name)
  }

  constructor(readonly tagName: string) {}

  private classes(): string[] {
    return this.className.split(' ').filter((c) => c !== '')
  }
  get innerHTML(): string {
    return this.html
  }
  set innerHTML(value: string) {
    this.html = value
    if (value === '') this.children = []
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null
  }
  get nextSibling(): FakeElement | null {
    const siblings = this.parent?.children ?? []
    return siblings[siblings.indexOf(this) + 1] ?? null
  }
  appendChild(child: FakeElement): FakeElement {
    child.remove()
    child.parent = this
    this.children.push(child)
    return child
  }
  insertBefore(child: FakeElement, ref: FakeElement | null): FakeElement {
    child.remove()
    child.parent = this
    const index = ref === null ? -1 : this.children.indexOf(ref)
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  setAttribute(): void {}
  cloneNode(): FakeElement {
    return new FakeElement(this.tagName)
  }
  querySelector(selector: string): FakeElement | null {
    // Every child of the chat is a div, so `:last-of-type` is the last child.
    if (selector === '.ai-message:last-of-type:not(.image-message)') {
      const last = this.children.at(-1)
      return last?.classList.contains('ai-message') && !last.classList.contains('image-message') ? last : null
    }
    return this.querySelectorAll(selector)[0] ?? null
  }
  querySelectorAll(selector: string): FakeElement[] {
    if (!selector.startsWith('.')) throw new Error(`Unsupported selector ${selector}`)
    const name = selector.slice(1)
    return this.descendants().filter((e) => e.classList.contains(name))
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.descendants()])
  }
  fire(type: string): unknown[] {
    return (this.listeners.get(type) ?? []).map((l) => l({ preventDefault: () => undefined }))
  }
}

// ------------------------------------------------------------------------- fake v4 OpenAI SDK

function makeOpenAI(server: FakeOpenAiServer) {
  const call = (method: ApiRequest['method'], path: string, body: unknown = null) => {
    const r = server.handle({ method, path, body: asJson(body) })
    if (r.kind === 'error') throw r.error
    return r
  }
  const json = async (method: ApiRequest['method'], path: string, body?: unknown) => {
    await Promise.resolve()
    const r = call(method, path, body)
    return r.kind === 'json' ? r.body : null
  }
  async function* events(list: readonly StreamEvent[]): AsyncGenerator<StreamEvent> {
    for (const e of list) {
      await Promise.resolve()
      yield e
    }
  }
  const stream = async (path: string, body: unknown) => {
    await Promise.resolve()
    const r = call('POST', path, body)
    return events(r.kind === 'sse' ? r.events : [])
  }

  return class OpenAI {
    readonly beta
    readonly files
    constructor() {
      this.beta = {
        assistants: {
          list: () => json('GET', '/assistants'),
          create: (body: unknown) => json('POST', '/assistants', body),
          del: (id: string) => json('DELETE', `/assistants/${id}`)
        },
        threads: {
          create: () => json('POST', '/threads', {}),
          messages: { create: (t: string, body: unknown) => json('POST', `/threads/${t}/messages`, body) },
          runs: {
            // v4 `runs.stream` returns an AssistantStream at once; request errors surface while iterating.
            stream: (t: string, body: object) => {
              let started: Promise<AsyncGenerator<StreamEvent>> | null = null
              return {
                async *[Symbol.asyncIterator]() {
                  started ??= stream(`/threads/${t}/runs`, { ...body, stream: true })
                  yield* await started
                }
              }
            },
            submitToolOutputs: (t: string, r: string, body: unknown) =>
              stream(`/threads/${t}/runs/${r}/submit_tool_outputs`, body),
            create: (t: string, body: unknown) => stream(`/threads/${t}/runs`, body),
            cancel: (t: string, r: string) => json('POST', `/threads/${t}/runs/${r}/cancel`)
          }
        }
      }
      this.files = {
        list: async () => {
          if (server.holdFilesList) await server.holdFilesList
          return json('GET', '/files')
        },
        del: (id: string) => {
          if (!server.holdDeletes) return json('DELETE', `/files/${id}`)
          server.log.push({ method: 'DELETE', path: `/files/${id}`, body: null })
          return new Promise<never>(() => undefined)
        },
        create: async ({ file, purpose }: { file: File; purpose: string }) => {
          const text = await file.text()
          return json('POST', '/files', { file: { name: file.name, type: file.type, text }, purpose })
        },
        content: () => Promise.reject(new Error('not used'))
      }
    }
  }
}

// ------------------------------------------------------------------------------------- harness

export type ChatLine =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'notice'; readonly tone: 'info' | 'error'; readonly text: string }

/** The script without its ES imports (OpenAI, marked, DOMPurify and the parser are injected). */
function upstreamSource(): string {
  return readFileSync(resolve(repo, 'upstream/AILogAnalyzer/logAnalyzer.js'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('import ') && !line.startsWith('import_done[0] = import('))
    .join('\n')
}

/** Lets every pending promise and stream in the upstream code run to completion. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r))
}

export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  messageTypes: Record<string, { instances?: Record<string, unknown> }>
  get_instance(name: string, instance: string): unknown
}
export type UpstreamParserCtor = new () => UpstreamParser

/** The upstream JsDataflashParser class (upstream/modules/JsDataflashParser/parser.js). */
export async function loadUpstreamParser(): Promise<UpstreamParserCtor> {
  // parser.js registers a Worker message listener at module scope.
  const g = globalThis as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ resolve(repo, 'upstream/modules/JsDataflashParser/parser.js'))) as {
    default: UpstreamParserCtor
  }
  return mod.default
}

/** The SITL copter log in packages/dataflash/test-fixtures, as an ArrayBuffer. */
export function fixtureLog(): ArrayBuffer {
  const buf = readFileSync(resolve(repo, 'packages/dataflash/test-fixtures/copter-sitl.bin'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

export class UpstreamAnalyzer {
  readonly context: vm.Context
  private readonly elements = new Map<string, FakeElement>()
  private readonly body = new FakeElement('body')
  private apiKeyForm = new FakeElement('form')
  private apiKeyInput = new FakeElement('input')
  /** Times the API key prompt was shown. */
  prompts = 0

  constructor(server: FakeOpenAiServer, Parser: UpstreamParserCtor) {
    for (const [id, tag] of [
      ['chatMessages', 'div'],
      ['fileInput', 'input'],
      ['messageInput', 'input'],
      ['sendBtn', 'button'],
      ['vizArea', 'div'],
      ['updateAssistantBtn', 'button']
    ] as const) {
      const el = new FakeElement(tag)
      el.id = id
      this.elements.set(id, el)
      this.body.appendChild(el)
    }
    // index.html's initial placeholder text
    this.el('messageInput').placeholder = 'Ask about your flight data...'
    const label = new FakeElement('label')
    label.className = 'file-upload-label'
    this.elements.set('label', label)
    const hooks: { ready?: () => unknown } = {}
    const document = {
      body: this.body,
      createElement: (tag: string) => new FakeElement(tag),
      getElementById: (id: string): FakeElement | null => {
        if (id === 'apiKeyForm') return this.apiKeyForm
        if (id === 'apiKeyInput') return this.apiKeyInput
        return this.body.descendants().find((e) => e.id === id) ?? null
      },
      querySelector: (selector: string) => (selector === '.file-upload-label' ? label : null),
      addEventListener: (type: string, listener: () => unknown) => {
        if (type === 'DOMContentLoaded') hooks.ready = listener
      }
    }
    const quiet = { log: () => undefined, error: () => undefined, warn: () => undefined }
    this.context = vm.createContext({
      document,
      console: quiet,
      OpenAI: makeOpenAI(server),
      DataflashParser: Parser,
      marked: { parse: (s: string) => s },
      DOMPurify: { sanitize: (s: string) => s },
      fetch: (path: string) =>
        Promise.resolve(new globalThis.Response(readFileSync(resolve(repo, 'upstream/AILogAnalyzer', path)))),
      Blob,
      File,
      URL,
      Promise,
      setInterval: () => 0,
      clearInterval: () => undefined,
      setTimeout: () => 0
    })
    vm.runInContext('var window = globalThis;', this.context)
    vm.runInContext(upstreamSource(), this.context)
    if (hooks.ready === undefined) throw new Error('logAnalyzer.js did not register DOMContentLoaded')
    this.watchPrompts()
    hooks.ready()
  }

  private watchPrompts(): void {
    const append = this.body.appendChild.bind(this.body)
    this.body.appendChild = (child: FakeElement) => {
      if (child.className === 'modal') {
        this.prompts++
        this.apiKeyForm = new FakeElement('form')
        this.apiKeyInput = new FakeElement('input')
      }
      return append(child)
    }
  }

  el(id: string): FakeElement {
    const el = this.elements.get(id)
    if (!el) throw new Error(id)
    return el
  }

  /** Evaluate an expression in the upstream script's scope (its top-level `let`s are visible). */
  evaluate(code: string): unknown {
    return vm.runInContext(code, this.context) as unknown
  }

  /** Enter a key in the modal and submit it. */
  async submitKey(key: string): Promise<void> {
    this.apiKeyInput.value = key
    this.apiKeyForm.fire('submit')
    await settle()
  }

  /** Load a log the way `handleFileUpload`'s FileReader callback does for a .bin file. */
  async loadLog(buffer: ArrayBuffer): Promise<void> {
    const loadLog = this.evaluate('loadLog') as (b: ArrayBuffer) => Promise<void>
    await loadLog(buffer)
  }

  /** Type a message and press Send, without waiting. */
  sendNoWait(text: string): void {
    this.el('messageInput').value = text
    this.el('sendBtn').fire('click')
  }

  /** Type a message and press Send. */
  async send(text: string): Promise<void> {
    this.sendNoWait(text)
    await settle()
  }

  /** The chat, without the thinking indicator. */
  chat(): ChatLine[] {
    return this.el('chatMessages').children.flatMap((e): ChatLine[] => {
      const text = String(e.textContent)
      if (e.classList.contains('user-message')) return [{ kind: 'user', text }]
      if (e.classList.contains('ai-message')) return [{ kind: 'assistant', text: e.innerHTML !== '' ? e.innerHTML : text }]
      if (e.classList.contains('system-message')) {
        return [{ kind: 'notice', tone: e.classList.contains('error-message') ? 'error' : 'info', text }]
      }
      return []
    })
  }

  /** Whether the thinking indicator is in the chat. */
  thinking(): boolean {
    return this.el('chatMessages').children.some((e) => e.id === 'thinking-message')
  }
}

// ----------------------------------------------------------------------------- stream events

export const textEvent = (id: string, text: Json): StreamEvent => ({
  event: 'thread.message.delta',
  data: { id, object: 'thread.message.delta', delta: { content: [{ index: 0, type: 'text', text }] } }
})
export const requiresAction = (runId: string, ...calls: [string, string][]): StreamEvent => ({
  event: 'thread.run.requires_action',
  data: {
    id: runId,
    object: 'thread.run',
    status: 'requires_action',
    required_action: {
      type: 'submit_tool_outputs',
      submit_tool_outputs: {
        tool_calls: calls.map(([name, args], i): Json => ({
          id: `call_${String(i)}`,
          type: 'function',
          function: { name, arguments: args }
        }))
      }
    }
  }
})
export const completed: StreamEvent = {
  event: 'thread.run.completed',
  data: { id: 'run', object: 'thread.run', status: 'completed' }
}
