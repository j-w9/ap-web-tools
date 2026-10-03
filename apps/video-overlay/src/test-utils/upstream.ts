/**
 * Oracles: the upstream JavaScript run side by side with the port. The DataflashParser module is
 * imported as-is; VideoOverlay's log functions are cut out of `VideoOverlay.js` by name and run
 * with their globals (`log`, `document`, `luxon`) supplied.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as luxon from 'luxon'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(here, '..', '..', '..', '..')
export const upstreamDir = join(repoRoot, 'upstream')
export const fixturesDir = join(repoRoot, 'packages', 'dataflash', 'test-fixtures')

export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs?: string[]): unknown
  messageTypes: Record<string, { expressions: string[]; instances?: Record<string, string> }>
  get(name: string, field?: string): unknown
  get_instance(name: string, instance: unknown, field?: string): unknown
  extractStartTime(): Date | undefined
  buffer: ArrayBuffer
}
type UpstreamCtor = new (sendPostMessage?: boolean) => UpstreamParser

export async function loadUpstreamParser(): Promise<UpstreamCtor> {
  const g = globalThis as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ join(upstreamDir, 'modules', 'JsDataflashParser', 'parser.js'))) as {
    default: UpstreamCtor
  }
  return mod.default
}

/** Parse with upstream, silencing its console chatter. */
export async function parseUpstream(buffer: ArrayBuffer): Promise<UpstreamParser> {
  const Parser = await loadUpstreamParser()
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

/** Source of a top-level `function name(...) { ... }` in an upstream file, found by brace matching. */
export function functionSource(file: string, name: string): string {
  const text = readFileSync(join(upstreamDir, file), 'utf8')
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`${name} not found in ${file}`)
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

export interface UpstreamVideoOverlayLog {
  getFlightTime(): string
  getLogDurationUS(): number | undefined
  /** Runs upstream `setDefaultOffset` and returns what it writes into the offset input. */
  defaultOffset(): unknown
}

/** Upstream VideoOverlay's log functions bound to a parsed upstream log. */
export function upstreamLogFunctions(log: UpstreamParser): UpstreamVideoOverlayLog {
  const file = join('VideoOverlay', 'VideoOverlay.js')
  const source = ['getFlightTime', 'setDefaultOffset', 'getLogDurationUS'].map((n) => functionSource(file, n)).join('\n')
  const input = { value: undefined as unknown }
  const document = { getElementById: () => input }
  const fns = runInNewContext(`${source}\n;({ getFlightTime, setDefaultOffset, getLogDurationUS })`, {
    log,
    document,
    luxon
  }) as {
    getFlightTime(log: UpstreamParser): string
    setDefaultOffset(): void
    getLogDurationUS(): number | undefined
  }
  return {
    getFlightTime: () => fns.getFlightTime(log),
    getLogDurationUS: () => fns.getLogDurationUS(),
    defaultOffset: () => {
      fns.setDefaultOffset()
      return input.value
    }
  }
}

/** An upstream function evaluated on its own, e.g. a pure helper. */
export function upstreamFunction(file: string, name: string): unknown {
  return runInNewContext(`${functionSource(file, name)}\n;${name}`, {})
}

export function toArrayBuffer(buf: Buffer | Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

export function readFixture(name: string): ArrayBuffer {
  return toArrayBuffer(readFileSync(join(fixturesDir, name)))
}
