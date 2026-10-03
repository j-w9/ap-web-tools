// Test-only: runs the original Telemetry Dashboard JavaScript (TelemetryDashboard.js, the widget
// classes in Widgets/, the SandBox.html page script) and the original MAVLink library
// (modules/MAVLink/mavlink.js) in node:vm contexts over small recording fakes for the DOM,
// tippy, GridStack, Formio, WebSocket, fetch and BroadcastChannel. Loader lines follow the app's
// oracle harnesses (apps/telemetry-dashboard/src/test-support, sandbox/page.test.ts,
// layout/loader.test.ts); nothing here imports app or package source.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'

export const UPSTREAM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../upstream')
const DASHBOARD_DIR = resolve(UPSTREAM_DIR, 'TelemetryDashboard')
const UPSTREAM_MAVLINK = resolve(UPSTREAM_DIR, 'modules/MAVLink/mavlink.js')

/** Reads a property of a vm-realm object. */
export function get(target: unknown, key: string): unknown {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return undefined
  return Reflect.get(target, key)
}

/** Calls a handler property (e.g. `onclick`) of a vm-realm object. */
export function fire(target: unknown, key: string, ...args: unknown[]): unknown {
  const handler = get(target, key)
  if (typeof handler !== 'function') throw new Error(`${key} is not a function`)
  return Reflect.apply(handler, target, args)
}

// ---------------------------------------------------------------- MAVLink (mavlink.js, Node path)

export interface UpstreamMessage {
  readonly _name: string
  readonly _id: number
  pack(processor: UpstreamProcessor): number[]
}

export interface UpstreamProcessor {
  seq: number
  srcSystem: number
  srcComponent: number
  readonly signing: { secret_key: Uint8Array; sign_outgoing: boolean }
  parseChar(c: number): UpstreamMessage | null
}

export interface UpstreamMavlink {
  readonly mavlink20: Record<string, unknown> & {
    readonly messages: Readonly<Record<string, new (...args: unknown[]) => UpstreamMessage>>
    readonly ready: Promise<void>
    sha256(data: Uint8Array): ArrayLike<number>
  }
  readonly MAVLink20Processor: new (logger?: null, srcSystem?: number, srcComponent?: number) => UpstreamProcessor
}

function isUpstreamMavlink(value: unknown): value is UpstreamMavlink {
  return typeof value === 'object' && value !== null && 'mavlink20' in value && 'MAVLink20Processor' in value
}

/** Loads upstream mavlink.js as apps/telemetry-dashboard/src/test-support/upstream-mavlink.ts does. */
export async function loadUpstreamMavlink(): Promise<UpstreamMavlink> {
  const module: { exports: unknown } = { exports: {} }
  const sandbox: Record<string, unknown> = { require: createRequire(UPSTREAM_MAVLINK), module, process, console, Buffer }
  sandbox.global = sandbox
  runInContext(readFileSync(UPSTREAM_MAVLINK, 'utf8'), createContext(sandbox), { filename: UPSTREAM_MAVLINK })
  const exported = module.exports
  if (!isUpstreamMavlink(exported)) throw new Error('upstream mavlink.js did not export mavlink20')
  await exported.mavlink20.ready
  return exported
}

/** An unsigned MAVLink 2 HEARTBEAT from system 1, component 1, as bytes. */
export function heartbeatFrame(mav: UpstreamMavlink, seq: number): Uint8Array {
  const sender = new mav.MAVLink20Processor(null, 1, 1)
  sender.seq = seq
  const Heartbeat = mav.mavlink20.messages.heartbeat
  if (Heartbeat === undefined) throw new Error('no heartbeat class')
  const msg = new Heartbeat(2, 3, 81, 0, 4)
  return new Uint8Array(msg.pack(sender))
}

/** Copies bytes into a fresh ArrayBuffer, as a binary WebSocket frame with binaryType "arraybuffer". */
export function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length)
  new Uint8Array(out).set(bytes)
  return out
}

// ---------------------------------------------------------------- fake DOM

/** A permissive element: any property can be set; each selector yields a remembered child. */
export class FakeElement {
  readonly style: Record<string, unknown> = {}
  readonly classList = { add: (): void => undefined }
  readonly children: unknown[] = []
  readonly attributes: Record<string, unknown> = {}
  readonly queried = new Map<string, FakeElement>()
  constructor(private readonly registry: FakeElement[]) {
    registry.push(this)
  }
  appendChild(child: unknown): unknown {
    this.children.push(child)
    return child
  }
  addEventListener(): void {}
  removeChild(): void {}
  setAttribute(name: string, value: unknown): void {
    this.attributes[name] = value
  }
  getAttribute(name: string): unknown {
    return this.attributes[name]
  }
  checkValidity(): boolean {
    return true
  }
  focus(): void {}
  querySelector(selector: string): FakeElement {
    let found = this.queried.get(selector)
    if (found === undefined) {
      found = new FakeElement(this.registry)
      this.queried.set(selector, found)
    }
    return found
  }
}

/** Elements created so far that were asked for `selector`, in creation order, with that child. */
export function queriedChildren(registry: readonly FakeElement[], selector: string): FakeElement[] {
  const out: FakeElement[] = []
  for (const el of registry) {
    const child = el.queried.get(selector)
    if (child !== undefined) out.push(child)
  }
  return out
}

// ---------------------------------------------------------------- fake WebSocket

/**
 * A WebSocket that never touches the network. `accept()` plays the server accepting the
 * connection (`onopen`); `receive()` delivers one message event; `close()` moves straight to
 * CLOSED (the close handshake is not modelled; no assertion depends on it).
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  closeCalls = 0
  readonly sent: unknown[] = []
  constructor(
    readonly url: string,
    registry: FakeWebSocket[]
  ) {
    registry.push(this)
  }
  accept(): void {
    this.readyState = FakeWebSocket.OPEN
    fire(this, 'onopen')
  }
  receive(data: ArrayBuffer | string): void {
    fire(this, 'onmessage', { data })
  }
  send(data: unknown): void {
    this.sent.push(data)
  }
  close(): void {
    this.closeCalls++
    this.readyState = FakeWebSocket.CLOSED
  }
}

// ---------------------------------------------------------------- dashboard page

export interface DashboardPage {
  readonly context: Context
  readonly elements: FakeElement[]
  readonly sockets: FakeWebSocket[]
  /** Messages posted on the "MAVLinkMSG" BroadcastChannel. */
  readonly broadcasts: UpstreamMessage[]
  readonly alerts: string[]
  run(code: string): unknown
}

/**
 * The dashboard page: the given upstream files (relative to TelemetryDashboard/) evaluated in one
 * vm context with the page globals index.html creates (`broadcast`, `MAVLink`, `grid`), plus
 * `extra` globals overriding the defaults.
 */
export function loadDashboard(
  files: readonly string[],
  extra: Record<string, unknown> = {},
  mav?: UpstreamMavlink
): DashboardPage {
  const elements: FakeElement[] = []
  const sockets: FakeWebSocket[] = []
  const broadcasts: UpstreamMessage[] = []
  const alerts: string[] = []
  const tip = (): Record<string, unknown> => ({
    show: () => undefined,
    hide: () => undefined,
    destroy: () => undefined,
    setProps: () => undefined
  })
  const fakeSubGrid = (): Record<string, unknown> => ({
    addWidget: () => undefined,
    destroy: () => undefined,
    column: () => undefined,
    cellHeight: () => undefined,
    getGridItems: () => [],
    update: () => undefined,
    on: () => undefined
  })
  const dashboardDiv = new FakeElement(elements)
  dashboardDiv.style.backgroundColor = 'rgb(255, 255, 255)'
  const context: Record<string, unknown> = {
    console: { log: () => undefined },
    HTMLElement: class extends FakeElement {
      constructor() {
        super(elements)
      }
    },
    customElements: { define: () => undefined },
    document: {
      createElement: () => new FakeElement(elements),
      // Templates; the settings popup is not in the document unless shown (see the tests).
      getElementById: (id: string) => (id === 'dashboard' ? dashboardDiv : id === 'settings_tip_div' ? null : { content: {} }),
      importNode: () => ({})
    },
    tippy: tip,
    // Form promises are never resolved, so no form callbacks run.
    Formio: { createForm: () => new Promise(() => undefined) },
    GridStack: { init: fakeSubGrid },
    ResizeObserver: class {
      observe(): void {}
    },
    WebSocket: Object.assign(
      function (this: unknown, url: string) {
        return new FakeWebSocket(url, sockets)
      },
      { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }
    ),
    window: { location: { hash: '' } },
    setInterval: () => 0,
    clearInterval: () => undefined,
    alert: (text: string) => alerts.push(text),
    broadcast: { postMessage: (data: { MAVLink: UpstreamMessage }) => broadcasts.push(data.MAVLink) },
    grid: { opts: { column: 12, maxRow: 12 } },
    TextEncoder,
    URLSearchParams,
    ...(mav === undefined ? {} : { mavlink20: mav.mavlink20, MAVLink: new mav.MAVLink20Processor() }),
    ...extra
  }
  const vm = createContext(context)
  for (const file of files) {
    const path = resolve(DASHBOARD_DIR, file)
    runInContext(readFileSync(path, 'utf8'), vm, { filename: path })
  }
  return { context: vm, elements, sockets, broadcasts, alerts, run: (code): unknown => runInContext(code, vm) as unknown }
}

/** One upstream function's source text, by brace matching (as layout/loader.test.ts does). */
export function functionSource(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`${name} not found`)
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

export const DASHBOARD_SOURCE = readFileSync(resolve(DASHBOARD_DIR, 'TelemetryDashboard.js'), 'utf8')

// ---------------------------------------------------------------- sandbox page (SandBox.html)

export class SandboxText {
  constructor(public nodeValue: string | null) {}
}

export class SandboxElement {
  readonly style: Record<string, unknown> = {}
  readonly children: (SandboxElement | SandboxText)[] = []
  innerHTML = ''
  constructor(readonly tag: string) {}
  appendChild(node: SandboxElement | SandboxText): void {
    this.children.push(node)
  }
}

export interface SandboxPage {
  /** A `postMessage` from the widget (`{script, options}` or `{options}`); returns whether it threw. */
  frame(data: unknown): boolean
  /** A BroadcastChannel message; returns whether it threw. */
  broadcast(data: unknown): boolean
  /** The page body's children. */
  body(): SandboxElement[]
  /** Evaluates an expression in the page's realm (e.g. a user global). */
  run(code: string): unknown
}

/** Runs SandBox.html's module script as apps/telemetry-dashboard/src/sandbox/page.test.ts does. */
export function loadSandboxPage(): SandboxPage {
  const html = readFileSync(resolve(DASHBOARD_DIR, 'Widgets/SandBox.html'), 'utf8')
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (script === undefined) throw new Error('no module script in SandBox.html')
  let children: SandboxElement[] = []
  let onFrame: ((e: { data: unknown }) => void) | undefined
  let channel: { onmessage?: ((e: { data: unknown }) => void) | undefined } | undefined
  const context: Record<string, unknown> = {
    document: {
      body: {
        replaceChildren: (...nodes: SandboxElement[]) => {
          children = nodes
        }
      },
      createElement: (tag: string) => new SandboxElement(tag),
      createTextNode: (text: string) => new SandboxText(text)
    },
    console: { log: () => undefined },
    BroadcastChannel: class {
      onmessage: ((e: { data: unknown }) => void) | undefined = undefined
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the script sets onmessage on this instance
        channel = this
      }
    },
    window: {
      addEventListener: (_type: string, listener: (e: { data: unknown }) => void) => {
        onFrame = listener
      },
      clearInterval: () => undefined
    }
  }
  const vm = createContext(context)
  // A module script is strict code.
  runInContext(`'use strict';\n${script}`, vm, { filename: 'http://localhost/TelemetryDashboard/Widgets/SandBox.html' })
  const attempt = (action: () => void): boolean => {
    try {
      action()
      return false
    } catch {
      return true
    }
  }
  return {
    frame: (data) => attempt(() => onFrame?.({ data })),
    broadcast: (data) => attempt(() => channel?.onmessage?.({ data })),
    body: () => children,
    run: (code): unknown => runInContext(code, vm) as unknown
  }
}

/** All text in a sandbox element tree, depth first. */
export function sandboxText(node: SandboxElement | SandboxText): string {
  if (node instanceof SandboxText) return node.nodeValue ?? ''
  return node.innerHTML + node.children.map(sandboxText).join('')
}
