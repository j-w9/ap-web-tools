/**
 * Loads the upstream JsDataflashParser (`upstream/modules/JsDataflashParser/parser.js`) for oracle
 * tests. Tests only.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamPath = join(here, '..', '..', '..', '..', 'upstream', 'modules', 'JsDataflashParser', 'parser.js')

/** Minimal typing of the upstream parser surface the oracle tests exercise. */
export interface UpstreamMessageType {
  expressions: string[]
  instances?: Record<string, string>
  complexFields: Record<string, { name: string; units: string; multiplier: number | undefined }>
}
export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  messageTypes: Record<string, UpstreamMessageType>
  messages: Record<string, Record<string, unknown>>
  files: Record<string, Uint8Array>
  get(name: string, field?: string): unknown
  get_instance(name: string, instance: string, field?: string): unknown
  parseAtOffset(name: string): void
  processFiles(): void
  extractStartTime(): Date | undefined
  stats(): Record<string, { count: number; msg_size: number; size: number }>
}
type UpstreamCtor = new (sendPostMessage: boolean) => UpstreamParser

interface WorkerScope {
  addEventListener: () => undefined
  postMessage: () => undefined
}

/** Import the upstream parser class. It registers a Worker listener at module scope, so `self` is stubbed. */
export async function loadUpstreamParser(): Promise<UpstreamCtor> {
  const scope: WorkerScope = { addEventListener: () => undefined, postMessage: () => undefined }
  if (!('self' in globalThis)) Object.defineProperty(globalThis, 'self', { value: scope, configurable: true })
  const mod: { default: UpstreamCtor } = await import(/* @vite-ignore */ upstreamPath)
  return mod.default
}

/** Run `fn` with `console.log` silenced (upstream logs on every message type it parses). */
export function quietly<T>(fn: () => T): T {
  const orig = console.log
  console.log = () => undefined
  try {
    return fn()
  } finally {
    console.log = orig
  }
}

/** Copy bytes into a standalone ArrayBuffer, as upstream's FileReader would hand it. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/** Parse `bytes` with upstream, processing no messages up front (as Hardware Report and Log Finder do). */
export async function upstreamParse(bytes: Uint8Array): Promise<UpstreamParser> {
  const Upstream = await loadUpstreamParser()
  return quietly(() => {
    const up = new Upstream(false)
    up.processData(toArrayBuffer(bytes), [])
    return up
  })
}

/** Upstream's embedded files, built exactly as Hardware Report does (`parseAtOffset('FILE')` + `processFiles()`). */
export function upstreamFiles(up: UpstreamParser): Record<string, Uint8Array> {
  if (!('FILE' in up.messageTypes)) return {}
  quietly(() => {
    up.parseAtOffset('FILE')
    up.processFiles()
  })
  return up.files
}
