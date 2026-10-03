/**
 * Runs pieces of the original Video Overlay (`upstream/VideoOverlay/`) and the original
 * JsDataflashParser unchanged. Functions and handlers are cut out of the upstream files by brace
 * matching and evaluated in `node:vm` with fake globals, as the Video Overlay oracle harness does
 * (`functionSource` and the parser loader are copied from `apps/video-overlay/src/test-utils/upstream.ts`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, runInNewContext, type Context } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(here, '..', '..')
export const upstreamDir = join(repoRoot, 'upstream')

export const upstreamText = (file: string): string => readFileSync(join(upstreamDir, file), 'utf8')

/** Text from `start` to the brace that closes the first `{` at or after `start`. */
function braceMatched(text: string, start: number, what: string): string {
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${what}`)
}

/** Source of a `function name(...) { ... }` (top level or nested) in an upstream file. */
export function functionSource(file: string, name: string): string {
  const text = upstreamText(file)
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`${name} not found in ${file}`)
  return braceMatched(text, start, name)
}

/**
 * Source of an inline function in an upstream file: the first `startToken` after `anchor`, up to
 * its closing brace (e.g. anchor `overlayInput.onchange = `, token `() =>`).
 */
export function inlineSource(file: string, anchor: string, startToken: string): string {
  const text = upstreamText(file)
  const at = text.indexOf(anchor)
  if (at === -1) throw new Error(`${anchor} not found in ${file}`)
  const start = text.indexOf(startToken, at)
  if (start === -1) throw new Error(`${startToken} not found after ${anchor}`)
  return braceMatched(text, start, anchor)
}

/** Evaluate an upstream function expression with the given globals. */
export function evalFunction(source: string, globals: Record<string, unknown>): (...args: unknown[]) => unknown {
  return runInNewContext(`(${source})`, globals) as (...args: unknown[]) => unknown
}

// ----------------------------------------------------------------------------- JsDataflashParser

export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs?: string[]): unknown
  messageTypes: Record<string, { expressions: string[]; instances?: Record<string, string> }>
  FMT: ({ Name: string; OffsetArray?: number[]; InstancesOffsetArray?: Record<string, number[]> } | undefined)[]
  get(name: string, field?: string): unknown
  get_instance(name: string, instance: unknown, field?: string): unknown
}
type UpstreamCtor = new (sendPostMessage?: boolean) => UpstreamParser

/** Import the original parser (it registers a Worker listener at module scope, so `self` is stubbed). */
export async function loadUpstreamParser(): Promise<UpstreamCtor> {
  if (!('self' in globalThis)) {
    Object.defineProperty(globalThis, 'self', {
      value: { addEventListener: () => undefined, postMessage: () => undefined },
      configurable: true
    })
  }
  const mod = (await import(/* @vite-ignore */ join(upstreamDir, 'modules', 'JsDataflashParser', 'parser.js'))) as {
    default: UpstreamCtor
  }
  return mod.default
}

/** Parse a shared DataFlash fixture with the original parser, silencing its console output. */
export async function parseFixture(name: string): Promise<UpstreamParser> {
  const Parser = await loadUpstreamParser()
  const bytes = readFileSync(join(repoRoot, 'packages', 'dataflash', 'test-fixtures', name))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const log = console.log
  console.log = () => undefined
  try {
    const parser = new Parser()
    parser.processData(buffer, [])
    return parser
  } finally {
    console.log = log
  }
}

// ----------------------------------------------------------------------------- Sandbox widgets

export interface FakeIframe {
  src: string
  sandbox: string
  scrolling: string
  style: Record<string, string>
  readonly loadListeners: (() => void)[]
  readonly posts: unknown[]
  contentWindow: { postMessage(data: unknown, origin: string): void } | null
  addEventListener(type: string, fn: () => void): void
}

export interface SandboxWorld {
  readonly context: Context
  readonly iframes: FakeIframe[]
  /** `new WidgetSandBoxVideoOverlay(options)` from the original sources. */
  create(options?: Record<string, unknown>): { iframe: FakeIframe; loadLog(): void; initDone: Promise<void> }
}

/**
 * The original `TelemetryDashboard/Widgets/SandBox.js` and `VideoOverlay/Widgets/SandBox.js`,
 * loaded in that order into one context (as `VideoOverlay/index.html` does) on a fake `WidgetBase`.
 */
export function sandboxWorld(): SandboxWorld {
  const iframes: FakeIframe[] = []
  const document = {
    createElement: (): FakeIframe => {
      const iframe: FakeIframe = {
        src: '',
        sandbox: '',
        scrolling: '',
        style: {},
        loadListeners: [],
        posts: [],
        contentWindow: null,
        addEventListener(type, fn) {
          if (type === 'load') this.loadListeners.push(fn)
        }
      }
      iframe.contentWindow = { postMessage: (data) => void iframe.posts.push(data) }
      iframes.push(iframe)
      return iframe
    }
  }
  const context = createContext({ document, customElements: { define: () => undefined }, log: undefined })
  runInContext(
    `class WidgetBase {
       constructor(options) { this.options = options }
       appendChild() {}
       get_form_content() { return { label: 'x' } }
     }`,
    context
  )
  runInContext(upstreamText('TelemetryDashboard/Widgets/SandBox.js'), context)
  runInContext(upstreamText('VideoOverlay/Widgets/SandBox.js'), context)
  const Ctor = runInContext('WidgetSandBoxVideoOverlay', context) as new (options?: Record<string, unknown>) => {
    iframe: FakeIframe
    loadLog(): void
    initDone: Promise<void>
  }
  return { context, iframes, create: (options) => new Ctor(options) }
}
