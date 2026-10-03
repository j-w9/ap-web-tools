/**
 * Loads the original JsDataflashParser (`upstream/modules/JsDataflashParser/parser.js`) unchanged.
 * Loader lines copied from `packages/dataflash/src/test-support/upstream-parser.ts`.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const parserPath = join(root, 'upstream', 'modules', 'JsDataflashParser', 'parser.js')

/** Path of a shared DataFlash fixture. */
export function fixturePath(name: string): string {
  return join(root, 'packages', 'dataflash', 'test-fixtures', name)
}

export interface UpstreamFmt {
  Name: string
  Format: string
  Size?: number
  units?: unknown[]
  multipliers?: unknown[]
}

export interface UpstreamMessageType {
  expressions: string[]
  instances?: Record<string, string>
  complexFields: Record<string, { name: string; units: string; multiplier: number | undefined }>
}

/** The parts of the original parser the proofs use. */
export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  populateUnits(): void
  messageTypes: Record<string, UpstreamMessageType>
  messages: Record<string, Record<string, ArrayLike<unknown>>>
  files: Record<string, Uint8Array>
  FMT: (UpstreamFmt | undefined)[]
  offset: number
  get(name: string, field?: string): unknown
  parseAtOffset(name: string): void
  processFiles(): void
  stats(): Record<string, { count: number; msg_size: number; size: number }>
}
type UpstreamCtor = new (sendPostMessage: boolean) => UpstreamParser

/** Import the original parser class (it registers a Worker listener at module scope, so `self` is stubbed). */
export async function loadUpstreamParser(): Promise<UpstreamCtor> {
  if (!('self' in globalThis)) {
    Object.defineProperty(globalThis, 'self', {
      value: { addEventListener: () => undefined, postMessage: () => undefined },
      configurable: true
    })
  }
  const mod = (await import(/* @vite-ignore */ parserPath)) as { default: UpstreamCtor }
  return mod.default
}

/** Run `fn` with `console.log` captured (the original logs while parsing). */
export function capturingLog<T>(fn: () => T): { result: T; logged: unknown[][] } {
  const orig = console.log
  const logged: unknown[][] = []
  console.log = (...args: unknown[]) => {
    logged.push(args)
  }
  try {
    return { result: fn(), logged }
  } finally {
    console.log = orig
  }
}

/** Copy bytes into a standalone ArrayBuffer, as the page's FileReader hands it over. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/** Parse `bytes` with the original, processing no messages up front (as Hardware Report and Stream Stats do). */
export async function upstreamParse(bytes: Uint8Array): Promise<{ parser: UpstreamParser; logged: unknown[][] }> {
  const Upstream = await loadUpstreamParser()
  const { result, logged } = capturingLog(() => {
    const parser = new Upstream(false)
    parser.processData(toArrayBuffer(bytes), [])
    return parser
  })
  return { parser: result, logged }
}

/** The original's embedded files, built as Hardware Report does (`parseAtOffset('FILE')` + `processFiles()`). */
export function upstreamFiles(parser: UpstreamParser): Record<string, Uint8Array> {
  capturingLog(() => {
    parser.parseAtOffset('FILE')
    parser.processFiles()
  })
  return parser.files
}
