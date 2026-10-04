/**
 * Runs upstream AILogAnalyzer/logAnalyzer.js in `node:vm` on a minimal fake DOM, with a fake of
 * the v4 OpenAI SDK calls it makes answered by {@link FakeOpenAiServer}, and the upstream
 * JsDataflashParser. Used by the oracle tests to compare request sequences and chat lines with
 * the port.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { apiErrorFor, asJson, type ApiRequest, type FakeOpenAiServer, type Json, type StreamEvent } from './fake-openai.js'

const repo = resolve(__dirname, '../../../..')

export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  messageTypes: Record<string, object>
  get(name: string): unknown
  get_instance(name: string, instance: string): unknown
}
export type UpstreamParserCtor = new (sendPostMessage: boolean) => UpstreamParser

/** The upstream JsDataflashParser class. */
export async function loadUpstreamParser(): Promise<UpstreamParserCtor> {
  // parser.js registers a Worker message listener at module scope.
  const g = globalThis as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ resolve(repo, 'upstream/modules/JsDataflashParser/parser.js'))) as {
    default: UpstreamParserCtor
  }
  return mod.default
}

// ------------------------------------------------------------------------------------ fake DOM

type Listener = (event: { preventDefault(): void; key?: string; shiftKey?: boolean }) => unknown

class FakeElement {
  id = ''
  className = ''
  textContent = ''
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
  fire(type: string, event: Partial<{ key: string; shiftKey: boolean }> = {}): unknown[] {
    return (this.listeners.get(type) ?? []).map((l) => l({ preventDefault: () => undefined, ...event }))
  }
}

// ------------------------------------------------------------------------- fake v4 OpenAI SDK

function makeOpenAI(server: FakeOpenAiServer, clients: string[]) {
  const call = (method: ApiRequest['method'], path: string, body: Json = null, query: Record<string, string> = {}) => {
    const response = server.handle({ method, path, query, body })
    if (response.kind === 'json' && response.status >= 400) return { error: apiErrorFor(response) }
    return { response }
  }
  const json = async (method: ApiRequest['method'], path: string, body?: unknown, query?: Record<string, string>) => {
    await Promise.resolve()
    const r = call(method, path, asJson(body), query)
    if ('error' in r) throw r.error
    return r.response.kind === 'json' ? r.response.body : null
  }
  /** v4 `Stream`: iterating yields `{event, data}`; an `error` event throws an APIError. */
  async function* events(list: readonly StreamEvent[]): AsyncGenerator<StreamEvent> {
    for (const e of list) {
      await Promise.resolve()
      if (e.event === 'error') {
        const data = e.data
        const message = typeof data === 'object' && data !== null && !Array.isArray(data) ? data['message'] : undefined
        throw new Error(typeof message === 'string' ? message : 'stream error')
      }
      yield e
    }
  }
  const stream = async (path: string, body: unknown) => {
    await Promise.resolve()
    const r = call('POST', path, asJson(body))
    if ('error' in r) throw r.error
    return events(r.response.kind === 'sse' ? r.response.events : [])
  }

  return class OpenAI {
    readonly beta
    readonly files
    constructor(options: { apiKey: string; dangerouslyAllowBrowser: boolean }) {
      clients.push(options.apiKey)
      this.beta = {
        assistants: {
          list: (q: { order: string; limit: number }) =>
            json('GET', '/assistants', undefined, { order: q.order, limit: String(q.limit) }),
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
        list: () => json('GET', '/files'),
        del: (id: string) => json('DELETE', `/files/${id}`),
        create: async ({ file, purpose }: { file: File; purpose: string }) => {
          const text = await file.text()
          return json('POST', '/files', { file: { name: file.name, type: file.type, text }, purpose })
        },
        content: async (id: string) => {
          await Promise.resolve()
          const r = call('GET', `/files/${id}/content`)
          if ('error' in r) throw r.error
          const bytes = r.response.kind === 'binary' ? r.response.bytes : ''
          return { blob: () => Promise.resolve(new Blob([bytes])) }
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------------- harness

export type ChatLine =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'notice'; readonly tone: 'info' | 'error'; readonly text: string }

function upstreamSource(): string {
  return readFileSync(resolve(repo, 'upstream/AILogAnalyzer/logAnalyzer.js'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('import ') && !line.startsWith('import_done[0] = import('))
    .join('\n')
}

const settle = async () => {
  for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r))
}

export class UpstreamAnalyzer {
  /** API keys each OpenAI client was created with, in order. */
  readonly clients: string[] = []
  private readonly context: vm.Context
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
      // index.html's button label
      if (id === 'updateAssistantBtn') el.textContent = 'Update Assistant'
      this.elements.set(id, el)
      this.body.appendChild(el)
    }
    const label = new FakeElement('label')
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
      OpenAI: makeOpenAI(server, this.clients),
      DataflashParser: Parser,
      marked: { parse: (s: string) => s },
      DOMPurify: { sanitize: (s: string) => s },
      // loadInstructions / loadTools fetch the files next to the page.
      fetch: (path: string) => Promise.resolve(new Response(readFileSync(resolve(repo, 'upstream/AILogAnalyzer', path)))),
      Blob,
      File,
      URL,
      Promise,
      setInterval: () => 0,
      clearInterval: () => undefined,
      // Only the 3 s button reset uses setTimeout; it is not needed by the tests.
      setTimeout: () => 0
    })
    vm.runInContext('var window = globalThis;', this.context)
    vm.runInContext(upstreamSource(), this.context)
    if (hooks.ready === undefined) throw new Error('logAnalyzer.js did not register DOMContentLoaded')
    // The modal is created on load because there is no key yet.
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

  private el(id: string): FakeElement {
    const el = this.elements.get(id)
    if (!el) throw new Error(id)
    return el
  }

  /** Enter a key in the modal and submit it. */
  async submitKey(key: string): Promise<void> {
    this.apiKeyInput.value = key
    this.apiKeyForm.fire('submit')
    await settle()
  }

  /** Load a log the way `handleFileUpload` does for a .bin file once the FileReader is done. */
  async loadLog(buffer: ArrayBuffer): Promise<void> {
    const loadLog: unknown = vm.runInContext('loadLog', this.context)
    if (typeof loadLog !== 'function') throw new Error('loadLog')
    await (loadLog as (b: ArrayBuffer) => Promise<void>)(buffer)
  }

  /** Call upstream's `get` tool (`window.get`) directly: the uploaded file id, or its falsy output. */
  async callGet(message: unknown): Promise<unknown> {
    const get: unknown = vm.runInContext('window.get', this.context)
    if (typeof get !== 'function') throw new Error('window.get')
    return (get as (m: unknown) => Promise<unknown>)(message)
  }

  /** Type a message and press Send. */
  async send(text: string): Promise<void> {
    this.el('messageInput').value = text
    this.el('sendBtn').fire('click')
    await settle()
  }

  async updateAssistant(): Promise<void> {
    this.el('updateAssistantBtn').fire('click')
    await settle()
  }

  get updateLabel(): string {
    return this.el('updateAssistantBtn').textContent
  }

  /** The chat, without the thinking indicator. */
  chat(): ChatLine[] {
    return this.el('chatMessages').children.flatMap((e): ChatLine[] => {
      if (e.classList.contains('user-message')) return [{ kind: 'user', text: e.textContent }]
      if (e.classList.contains('ai-message'))
        return [{ kind: 'assistant', text: e.innerHTML !== '' ? e.innerHTML : e.textContent }]
      if (e.classList.contains('system-message')) {
        return [{ kind: 'notice', tone: e.classList.contains('error-message') ? 'error' : 'info', text: e.textContent }]
      }
      return []
    })
  }

  /** Number of charts in the visualization area. */
  charts(): number {
    return this.el('vizArea').querySelectorAll('.graph-container').length
  }
}
